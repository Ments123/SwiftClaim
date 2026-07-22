import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
  ApproveFinanceBillInput,
  IssueFinanceBillInput,
  PrepareFinanceBillInput,
  RecordFinanceBillDeliveryInput,
  SubmitFinanceBillInput,
} from '../../shared/contracts.js';
import { canReadAllFirmMatters, hasCapability, type Capability, type SessionUser } from '../policy.js';
import { appendAudit, appendTimeline, type AuditContext } from '../store.js';
import { calculateBillTotals, calculateVat, type VatCalculation, type VatTreatment } from './billing-calculations.js';
import { projectBill, type BillLifecycleEvent, type BillVersionSnapshot } from './billing.js';
import { projectCreditImpact } from './billing.js';

type Row = Record<string, string | number | null>;

export type BillingCashroomStoreErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'INVALID_LINK'
  | 'INVALID_STATE'
  | 'INDEPENDENCE_REQUIRED';

export class BillingCashroomStoreError extends Error {
  constructor(readonly code: BillingCashroomStoreErrorCode, message: string) {
    super(message);
    this.name = 'BillingCashroomStoreError';
  }
}

export interface GeneratedBillDocument {
  billReference: string;
  originalName: string;
  mimeType: 'text/html';
  content: string;
}

export interface GeneratedBillFile extends GeneratedBillDocument {
  storageKey: string;
  sizeBytes: number;
  sha256: string;
  discard?: () => void;
}

export type GeneratedBillWriter = (document: GeneratedBillDocument) => GeneratedBillFile;

export interface PrepareCreditNoteInput {
  idempotencyKey: string;
  reason: string;
  lines: Array<{ billLineId: string; netMinor: number; vatMinor: number }>;
  explicitHumanConfirmation: true;
}

export interface IssueCreditNoteInput {
  expectedVersion: number;
  idempotencyKey: string;
  issuedAt: string;
  explicitHumanApproval: true;
}

type PreparedLine = {
  id: string;
  lineNumber: number;
  sourceKind: 'time' | 'disbursement' | 'adjustment';
  sourceId: string;
  narrative: string;
  netMinor: number;
  vatTreatment: VatTreatment;
  vatRateId: string | null;
  vat: VatCalculation;
  grossMinor: number;
};

function canonical(value: unknown): string {
  const normalise = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalise);
    if (input && typeof input === 'object') return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalise(child)]),
    );
    return input;
  };
  return JSON.stringify(normalise(value));
}

const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');

function transaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function isoTimestamp(value: string, label: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new BillingCashroomStoreError('INVALID_STATE', `${label} is invalid.`);
  return new Date(parsed).toISOString();
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

export class BillingCashroomStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
    private readonly writeGeneratedBill: GeneratedBillWriter = () => {
      throw new BillingCashroomStoreError('INVALID_STATE', 'Generated bill document storage is not configured.');
    },
  ) {}

  private requireCapability(user: SessionUser, capability: Capability): void {
    if (!hasCapability(user, capability)) throw new BillingCashroomStoreError('FORBIDDEN', 'The billing action is not permitted.');
  }

  private canReadMatter(user: SessionUser, matterId: string): boolean {
    if (!hasCapability(user, 'finance.read_matter')) return false;
    if (canReadAllFirmMatters(user)) return Boolean(this.database.prepare(
      'SELECT 1 FROM matters WHERE id = ? AND firm_id = ?',
    ).get(matterId, user.firmId));
    return Boolean(this.database.prepare(`SELECT 1 FROM matters m WHERE m.id = ? AND m.firm_id = ? AND (
      m.owner_user_id = ? OR EXISTS (SELECT 1 FROM matter_members mm WHERE mm.firm_id = m.firm_id
      AND mm.matter_id = m.id AND mm.user_id = ?))`).get(matterId, user.firmId, user.id, user.id));
  }

  private requireMatter(user: SessionUser, matterId: string, capability: Capability): void {
    this.requireCapability(user, capability);
    if (!this.canReadMatter(user, matterId)) throw new BillingCashroomStoreError('NOT_FOUND', 'The billing workspace was not found.');
  }

  private replay<T>(user: SessionUser, matterId: string, scope: string, key: string, input: unknown): T | undefined {
    const row = this.database.prepare(`SELECT input_hash AS inputHash, response_json AS responseJson
      FROM finance_command_receipts WHERE firm_id = ? AND scope_kind = 'matter' AND matter_id = ?
      AND command_scope = ? AND idempotency_key = ?`).get(user.firmId, matterId, scope, key) as Row | undefined;
    if (!row) return undefined;
    if (String(row.inputHash) !== hash(input)) throw new BillingCashroomStoreError(
      'IDEMPOTENCY_KEY_REUSED', 'The idempotency key was already used with different input.',
    );
    return JSON.parse(String(row.responseJson)) as T;
  }

  private saveReplay(user: SessionUser, matterId: string, scope: string, entityId: string, key: string, input: unknown, response: unknown, at: string): void {
    this.database.prepare(`INSERT INTO finance_command_receipts (
      id, firm_id, matter_id, scope_kind, command_scope, route_entity_id, idempotency_key,
      input_hash, response_json, created_by, created_at
    ) VALUES (?, ?, ?, 'matter', ?, ?, ?, ?, ?, ?, ?)`).run(
      randomUUID(), user.firmId, matterId, scope, entityId, key, hash(input), canonical(response), user.id, at,
    );
  }

  private appendOperational(user: SessionUser, matterId: string, action: string, entityId: string, title: string, key: string, at: string, safeAfter: Record<string, unknown>, audit: AuditContext): void {
    appendTimeline(this.database, { firmId: user.firmId, matterId, type: action, title, actorUserId: user.id, occurredAt: at, metadata: { entityType: 'finance_bill', entityId } });
    appendAudit(this.database, { firmId: user.firmId, matterId, userId: user.id, action, entityType: 'finance_bill', entityId, after: { entityId, ...safeAfter }, requestId: audit.requestId, ipAddress: audit.ipAddress, createdAt: at });
    this.database.prepare(`INSERT INTO domain_events (
      id, firm_id, matter_id, type, occurred_on, actor_user_id, idempotency_key, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      randomUUID(), user.firmId, matterId, action, at.slice(0, 10), user.id,
      `finance:${action}:${entityId}:${key}`, canonical({ entityId, ...safeAfter }), at,
    );
    this.database.prepare(`INSERT INTO integration_outbox (
      id, firm_id, matter_id, topic, payload_json, status, attempts, available_at, created_at, deduplication_key
    ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`).run(
      randomUUID(), user.firmId, matterId, action, canonical({ matterId, entityId, ...safeAfter }), at, at,
      `finance:${user.firmId}:${matterId}:${action}:${entityId}:${key}`,
    );
  }

  private activeVatRate(firmId: string, on: string) {
    const rates = this.database.prepare(`SELECT id, treatment, rate_numerator AS rateNumerator,
      rate_denominator AS rateDenominator FROM finance_vat_rates WHERE firm_id = ?
      AND treatment = 'standard' AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY effective_from DESC`).all(firmId, on, on) as Row[];
    if (rates.length !== 1) throw new BillingCashroomStoreError('INVALID_STATE', 'Exactly one effective standard VAT rate is required.');
    return { id: String(rates[0]!.id), rateNumerator: Number(rates[0]!.rateNumerator), rateDenominator: Number(rates[0]!.rateDenominator) };
  }

  private sourceValue(firmId: string, matterId: string, kind: 'time' | 'disbursement', sourceId: string) {
    if (kind === 'time') {
      const row = this.database.prepare(`SELECT a.charge_minor AS netMinor
        FROM finance_time_approvals a JOIN finance_time_entries t ON t.id = a.time_entry_id
          AND t.firm_id = a.firm_id AND t.matter_id = a.matter_id
        WHERE a.time_entry_id = ? AND a.firm_id = ? AND a.matter_id = ? AND t.chargeable = 1
        AND (SELECT e.event_type FROM finance_time_entry_events e WHERE e.time_entry_id = a.time_entry_id
          AND e.firm_id = a.firm_id AND e.matter_id = a.matter_id ORDER BY e.sequence DESC LIMIT 1) = 'approved'`)
        .get(sourceId, firmId, matterId) as Row | undefined;
      if (!row) throw new BillingCashroomStoreError('INVALID_LINK', 'An approved chargeable time source was not found.');
      return { netMinor: Number(row.netMinor), vatMinor: null };
    }
    const row = this.database.prepare(`SELECT d.net_minor AS netMinor, d.vat_minor AS vatMinor
      FROM finance_disbursements d WHERE d.id = ? AND d.firm_id = ? AND d.matter_id = ?
      AND (SELECT e.event_type FROM finance_disbursement_events e WHERE e.disbursement_id = d.id
        AND e.firm_id = d.firm_id AND e.matter_id = d.matter_id ORDER BY e.sequence DESC LIMIT 1)
      IN ('incurred','paid_external')`).get(sourceId, firmId, matterId) as Row | undefined;
    if (!row) throw new BillingCashroomStoreError('INVALID_LINK', 'An incurred disbursement source was not found.');
    return { netMinor: Number(row.netMinor), vatMinor: Number(row.vatMinor) };
  }

  private buildLines(user: SessionUser, matterId: string, input: PrepareFinanceBillInput, preparedOn: string): PreparedLine[] {
    const standard = this.activeVatRate(user.firmId, preparedOn);
    const lines: PreparedLine[] = [];
    const sourceLines = new Map<string, PreparedLine>();
    for (const entry of input.sourceEntries) {
      const source = this.sourceValue(user.firmId, matterId, entry.sourceKind, entry.sourceId);
      if (entry.netMinor <= 0 || entry.netMinor > source.netMinor) throw new BillingCashroomStoreError('INVALID_STATE', 'A bill source amount exceeds its eligible approved value.');
      if (entry.sourceKind === 'disbursement' && entry.netMinor !== source.netMinor) throw new BillingCashroomStoreError('INVALID_STATE', 'A disbursement must be billed from its exact incurred net snapshot.');
      const outsideScope = entry.sourceKind === 'disbursement' && source.vatMinor === 0;
      const vat = outsideScope
        ? calculateVat({ netMinor: entry.netMinor, treatment: 'outside_scope' })
        : calculateVat({ netMinor: entry.netMinor, treatment: 'standard', rateNumerator: standard.rateNumerator, rateDenominator: standard.rateDenominator });
      const line: PreparedLine = { id: randomUUID(), lineNumber: lines.length + 1, sourceKind: entry.sourceKind, sourceId: entry.sourceId,
        narrative: entry.narrative, netMinor: entry.netMinor, vatTreatment: vat.treatment,
        vatRateId: outsideScope ? null : standard.id, vat, grossMinor: entry.netMinor + vat.vatMinor };
      lines.push(line);
      sourceLines.set(entry.sourceId, line);
    }
    for (const adjustment of input.adjustments) {
      const sourceLine = sourceLines.get(adjustment.sourceId);
      if (!sourceLine) throw new BillingCashroomStoreError('INVALID_LINK', 'A bill adjustment must reference a selected exact source.');
      if (adjustment.amountMinor >= sourceLine.netMinor) throw new BillingCashroomStoreError('INVALID_STATE', 'A reduction cannot eliminate or exceed its source line.');
      const vat = sourceLine.vatTreatment === 'standard'
        ? calculateVat({ netMinor: adjustment.amountMinor, treatment: 'standard', rateNumerator: sourceLine.vat.rateNumerator, rateDenominator: sourceLine.vat.rateDenominator })
        : calculateVat({ netMinor: adjustment.amountMinor, treatment: sourceLine.vatTreatment });
      lines.push({ id: randomUUID(), lineNumber: lines.length + 1, sourceKind: 'adjustment', sourceId: adjustment.sourceId,
        narrative: `${adjustment.adjustmentKind === 'write_off' ? 'Write-off' : 'Reduction'}: ${adjustment.reason}`,
        netMinor: adjustment.amountMinor, vatTreatment: vat.treatment, vatRateId: sourceLine.vatRateId, vat,
        grossMinor: adjustment.amountMinor + vat.vatMinor });
    }
    return lines;
  }

  private totals(lines: PreparedLine[]) {
    const positive = calculateBillTotals(lines.filter((line) => line.sourceKind !== 'adjustment').map((line) => ({ netMinor: line.netMinor, vatMinor: line.vat.vatMinor })));
    const reductions = calculateBillTotals(lines.filter((line) => line.sourceKind === 'adjustment').map((line) => ({ netMinor: line.netMinor, vatMinor: line.vat.vatMinor })));
    if (reductions.netMinor > positive.netMinor || reductions.vatMinor > positive.vatMinor) throw new BillingCashroomStoreError('INVALID_STATE', 'Bill reductions exceed selected source value.');
    return { netMinor: positive.netMinor - reductions.netMinor, vatMinor: positive.vatMinor - reductions.vatMinor,
      grossMinor: positive.grossMinor - reductions.grossMinor };
  }

  getBill(user: SessionUser, matterId: string, billId: string) {
    if (!this.canReadMatter(user, matterId)) return null;
    const bill = this.database.prepare(`SELECT id, client_party_id AS clientPartyId, series_id AS seriesId,
      bill_number AS billNumber, bill_reference AS billReference, currency, due_on AS dueOn,
      prepared_by AS preparedBy, prepared_at AS preparedAt FROM finance_bills
      WHERE id = ? AND firm_id = ? AND matter_id = ?`).get(billId, user.firmId, matterId) as Row | undefined;
    if (!bill) return null;
    const versionRows = this.database.prepare(`SELECT id, version_number AS versionNumber, due_on AS dueOn,
      net_minor AS netMinor, vat_minor AS vatMinor, gross_minor AS grossMinor, currency
      FROM finance_bill_versions WHERE bill_id = ? AND firm_id = ? AND matter_id = ? ORDER BY version_number`)
      .all(billId, user.firmId, matterId) as Row[];
    const allLines = this.database.prepare(`SELECT id, bill_version_id AS billVersionId, line_number AS lineNumber,
      source_kind AS sourceKind, source_id AS sourceId, narrative, net_minor AS netMinor,
      vat_treatment AS vatTreatment, vat_rate_id AS vatRateId, rate_numerator AS rateNumerator,
      rate_denominator AS rateDenominator, vat_minor AS vatMinor, gross_minor AS grossMinor,
      rounding_snapshot_json AS roundingSnapshotJson FROM finance_bill_lines
      WHERE bill_id = ? AND firm_id = ? AND matter_id = ? ORDER BY line_number`)
      .all(billId, user.firmId, matterId) as Row[];
    const versions: BillVersionSnapshot[] = versionRows.map((version) => ({
      id: String(version.id), versionNumber: Number(version.versionNumber), dueOn: String(version.dueOn),
      netMinor: Number(version.netMinor), vatMinor: Number(version.vatMinor), grossMinor: Number(version.grossMinor), currency: 'GBP',
      lines: allLines.filter((line) => line.billVersionId === version.id).map((line) => ({ id: String(line.id),
        sourceKind: line.sourceKind as 'time' | 'disbursement' | 'adjustment', sourceId: String(line.sourceId),
        netMinor: Number(line.netMinor), vatMinor: Number(line.vatMinor), grossMinor: Number(line.grossMinor) })),
    }));
    const eventRows = this.database.prepare(`SELECT sequence, event_type AS eventType, bill_version_id AS billVersionId,
      occurred_at AS occurredAt FROM finance_bill_events WHERE bill_id = ? AND firm_id = ? AND matter_id = ? ORDER BY sequence`)
      .all(billId, user.firmId, matterId) as Row[];
    const events: BillLifecycleEvent[] = eventRows.map((event) => ({ sequence: Number(event.sequence),
      eventType: event.eventType as BillLifecycleEvent['eventType'], billVersionId: String(event.billVersionId),
      occurredAt: String(event.occurredAt), ...(event.eventType === 'issued' ? { billReference: String(bill.billReference) } : {}) }));
    const issuedCredits = this.database.prepare(`SELECT cnl.gross_minor AS grossMinor FROM finance_credit_note_lines cnl
      JOIN finance_credit_notes cn ON cn.id = cnl.credit_note_id AND cn.firm_id = cnl.firm_id AND cn.matter_id = cnl.matter_id
      WHERE cn.bill_id = ? AND cn.firm_id = ? AND cn.matter_id = ? AND EXISTS (
        SELECT 1 FROM finance_credit_note_events e WHERE e.credit_note_id = cn.id AND e.firm_id = cn.firm_id
        AND e.matter_id = cn.matter_id AND e.event_type = 'issued')`).all(billId, user.firmId, matterId) as Row[];
    const projected = projectBill({ billId, versions, events, payments: [],
      credits: issuedCredits.map((credit) => ({ grossMinor: Number(credit.grossMinor), issued: true })) });
    const document = this.database.prepare(`SELECT bd.tax_point AS taxPoint, bd.document_version_id AS documentVersionId,
      bd.sha256 FROM finance_bill_documents bd WHERE bd.bill_id = ? AND bd.firm_id = ? AND bd.matter_id = ?`)
      .get(billId, user.firmId, matterId) as Row | undefined;
    const delivered = [...eventRows].reverse().find((event) => event.eventType === 'delivered');
    return { ...projected, id: billId, clientPartyId: String(bill.clientPartyId), preparedBy: String(bill.preparedBy),
      preparedAt: String(bill.preparedAt), version: events.length, taxPoint: document ? String(document.taxPoint) : null,
      documentVersionId: document ? String(document.documentVersionId) : null, documentSha256: document ? String(document.sha256) : null,
      deliveredAt: delivered ? String(delivered.occurredAt) : null,
      lines: allLines.filter((line) => line.billVersionId === projected.currentVersionId).map((line) => ({
        id: String(line.id), lineNumber: Number(line.lineNumber), sourceKind: String(line.sourceKind), sourceId: String(line.sourceId),
        narrative: String(line.narrative), netMinor: Number(line.netMinor), vatTreatment: String(line.vatTreatment),
        vatMinor: Number(line.vatMinor), grossMinor: Number(line.grossMinor),
      })), events: eventRows,
    };
  }

  prepareBill(user: SessionUser, matterId: string, input: PrepareFinanceBillInput, audit: AuditContext) {
    this.requireMatter(user, matterId, 'finance.prepare_bill');
    const scope = `prepare_bill:${user.id}`;
    const replay = this.replay<NonNullable<ReturnType<typeof this.getBill>>>(user, matterId, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      if (!this.database.prepare(`SELECT 1 FROM parties WHERE id = ? AND firm_id = ? AND matter_id = ? AND kind = 'client'`)
        .get(input.clientPartyId, user.firmId, matterId)) throw new BillingCashroomStoreError('INVALID_LINK', 'The exact matter client was not found.');
      const preparedAt = this.now().toISOString();
      const lines = this.buildLines(user, matterId, input, preparedAt.slice(0, 10));
      const totals = this.totals(lines);
      const billId = randomUUID();
      const versionId = randomUUID();
      this.database.prepare(`INSERT INTO finance_bills (
        id, firm_id, matter_id, client_party_id, series_id, bill_number, bill_reference,
        currency, due_on, prepared_by, prepared_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, 'GBP', ?, ?, ?)`).run(
        billId, user.firmId, matterId, input.clientPartyId, input.dueOn, user.id, preparedAt,
      );
      this.database.prepare(`INSERT INTO finance_bill_versions (
        id, firm_id, matter_id, bill_id, version_number, due_on, net_minor, vat_minor,
        gross_minor, currency, note, prepared_by, created_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 'GBP', ?, ?, ?)`).run(
        versionId, user.firmId, matterId, billId, input.dueOn, totals.netMinor, totals.vatMinor, totals.grossMinor,
        'Draft assembled from exact eligible sources and explicit adjustments.', user.id, preparedAt,
      );
      const insertLine = this.database.prepare(`INSERT INTO finance_bill_lines (
        id, firm_id, matter_id, bill_id, bill_version_id, line_number, source_kind, source_id,
        narrative, net_minor, vat_treatment, vat_rate_id, rate_numerator, rate_denominator,
        vat_minor, gross_minor, rounding_snapshot_json, currency
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GBP')`);
      for (const line of lines) insertLine.run(
        line.id, user.firmId, matterId, billId, versionId, line.lineNumber, line.sourceKind, line.sourceId,
        line.narrative, line.netMinor, line.vatTreatment, line.vatRateId, line.vat.rateNumerator,
        line.vat.rateDenominator, line.vat.vatMinor, line.grossMinor, canonical(line.vat),
      );
      this.insertEvent(user, matterId, billId, 1, 'prepared', versionId, 'Draft bill prepared from governed sources.', preparedAt, null);
      const response = this.getBill(user, matterId, billId)!;
      this.saveReplay(user, matterId, scope, billId, input.idempotencyKey, input, response, preparedAt);
      this.appendOperational(user, matterId, 'finance.bill_prepared', billId, 'Draft bill prepared', input.idempotencyKey,
        preparedAt, { netMinor: totals.netMinor, vatMinor: totals.vatMinor, grossMinor: totals.grossMinor, currency: 'GBP' }, audit);
      return response;
    });
  }

  private insertEvent(user: SessionUser, matterId: string, billId: string, sequence: number, type: BillLifecycleEvent['eventType'], versionId: string, note: string, occurredAt: string, evidenceId: string | null) {
    this.database.prepare(`INSERT INTO finance_bill_events (
      id, firm_id, matter_id, bill_id, sequence, event_type, bill_version_id, note,
      evidence_document_version_id, occurred_at, recorded_by, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      randomUUID(), user.firmId, matterId, billId, sequence, type, versionId, note, evidenceId,
      occurredAt, user.id, this.now().toISOString(),
    );
  }

  submitBill(user: SessionUser, matterId: string, billId: string, input: SubmitFinanceBillInput, audit: AuditContext) {
    return this.transitionBill(user, matterId, billId, input, audit, 'finance.prepare_bill', 'submitted', 'finance.bill_submitted', 'Bill submitted for independent approval');
  }

  approveBill(user: SessionUser, matterId: string, billId: string, input: ApproveFinanceBillInput, audit: AuditContext) {
    this.requireMatter(user, matterId, 'finance.approve_bill');
    const scope = `approve_bill:${billId}`;
    const replay = this.replay<NonNullable<ReturnType<typeof this.getBill>>>(user, matterId, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      const bill = this.getBill(user, matterId, billId);
      if (!bill) throw new BillingCashroomStoreError('NOT_FOUND', 'The bill was not found.');
      if (bill.preparedBy === user.id) throw new BillingCashroomStoreError('INDEPENDENCE_REQUIRED', 'Bill approval requires an independent approver.');
      if (bill.version !== input.expectedVersion) throw new BillingCashroomStoreError('CONFLICT', 'The bill version is stale.');
      if (bill.status !== 'submitted') throw new BillingCashroomStoreError('INVALID_STATE', 'Only a submitted bill can be approved.');
      const approvedAt = isoTimestamp(input.approvedAt, 'Bill approval timestamp');
      if (Date.parse(approvedAt) <= Date.parse(bill.preparedAt)) throw new BillingCashroomStoreError('INVALID_STATE', 'Bill approval must occur after preparation.');
      this.insertEvent(user, matterId, billId, bill.version + 1, 'approved', bill.currentVersionId, input.note, approvedAt, null);
      const response = this.getBill(user, matterId, billId)!;
      this.saveReplay(user, matterId, scope, billId, input.idempotencyKey, input, response, this.now().toISOString());
      this.appendOperational(user, matterId, 'finance.bill_approved', billId, 'Bill independently approved', input.idempotencyKey,
        approvedAt, { billVersionId: bill.currentVersionId, grossMinor: bill.grossMinor, currency: 'GBP' }, audit);
      return response;
    });
  }

  private transitionBill(user: SessionUser, matterId: string, billId: string, input: SubmitFinanceBillInput, audit: AuditContext,
    capability: Capability, eventType: 'submitted', action: string, title: string) {
    this.requireMatter(user, matterId, capability);
    const scope = `${eventType}_bill:${billId}`;
    const replay = this.replay<NonNullable<ReturnType<typeof this.getBill>>>(user, matterId, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      const bill = this.getBill(user, matterId, billId);
      if (!bill) throw new BillingCashroomStoreError('NOT_FOUND', 'The bill was not found.');
      if (bill.version !== input.expectedVersion) throw new BillingCashroomStoreError('CONFLICT', 'The bill version is stale.');
      if (bill.status !== 'draft') throw new BillingCashroomStoreError('INVALID_STATE', 'Only a draft bill can be submitted.');
      const at = this.now().toISOString();
      this.insertEvent(user, matterId, billId, bill.version + 1, eventType, bill.currentVersionId, input.note, at, null);
      const response = this.getBill(user, matterId, billId)!;
      this.saveReplay(user, matterId, scope, billId, input.idempotencyKey, input, response, at);
      this.appendOperational(user, matterId, action, billId, title, input.idempotencyKey, at,
        { billVersionId: bill.currentVersionId, grossMinor: bill.grossMinor, currency: 'GBP' }, audit);
      return response;
    });
  }

  issueBill(user: SessionUser, matterId: string, billId: string, input: IssueFinanceBillInput, audit: AuditContext) {
    this.requireMatter(user, matterId, 'finance.issue_bill');
    const scope = `issue_bill:${billId}`;
    const replay = this.replay<NonNullable<ReturnType<typeof this.getBill>>>(user, matterId, scope, input.idempotencyKey, input);
    if (replay) return replay;
    let stagedFile: GeneratedBillFile | undefined;
    try {
      return transaction(this.database, () => {
      const bill = this.getBill(user, matterId, billId);
      if (!bill) throw new BillingCashroomStoreError('NOT_FOUND', 'The bill was not found.');
      if (bill.version !== input.expectedVersion) throw new BillingCashroomStoreError('CONFLICT', 'The bill version is stale.');
      if (bill.status !== 'approved' || bill.approvedVersionId !== bill.currentVersionId) throw new BillingCashroomStoreError('INVALID_STATE', 'Only the exact approved bill version can be issued.');
      const standard = this.activeVatRate(user.firmId, input.taxPoint);
      for (const line of bill.lines) if (line.vatTreatment === 'standard') {
        const stored = this.database.prepare(`SELECT vat_rate_id AS vatRateId, rate_numerator AS rateNumerator,
          rate_denominator AS rateDenominator FROM finance_bill_lines WHERE id = ? AND firm_id = ?`).get(line.id, user.firmId) as Row;
        if (stored.vatRateId !== standard.id || Number(stored.rateNumerator) !== standard.rateNumerator || Number(stored.rateDenominator) !== standard.rateDenominator) {
          throw new BillingCashroomStoreError('CONFLICT', 'The VAT rate changed before issue; prepare and approve a new exact bill version.');
        }
      }
      for (const line of bill.lines.filter((candidate) => candidate.sourceKind !== 'adjustment')) {
        const source = this.sourceValue(user.firmId, matterId, line.sourceKind as 'time' | 'disbursement', line.sourceId);
        const consumed = this.database.prepare(`SELECT COALESCE(SUM(a.allocated_net_minor),0) AS amount
          FROM finance_bill_source_allocations a JOIN finance_bill_events e ON e.bill_id = a.bill_id
            AND e.firm_id = a.firm_id AND e.matter_id = a.matter_id AND e.event_type = 'issued'
          WHERE a.firm_id = ? AND a.matter_id = ? AND a.source_kind = ? AND a.source_id = ?`)
          .get(user.firmId, matterId, line.sourceKind, line.sourceId) as Row;
        if (Number(consumed.amount) + line.netMinor > source.netMinor) throw new BillingCashroomStoreError('CONFLICT', 'A selected source has already been consumed or is no longer eligible.');
      }
      const seriesRows = this.database.prepare(`SELECT id, prefix, year_pattern AS yearPattern,
        next_number AS nextNumber, padding FROM finance_bill_series WHERE firm_id = ? AND active = 1 ORDER BY created_at, id`)
        .all(user.firmId) as Row[];
      if (seriesRows.length !== 1) throw new BillingCashroomStoreError('INVALID_STATE', 'Exactly one active bill series is required.');
      const series = seriesRows[0]!;
      const number = Number(series.nextNumber);
      const reference = `${String(series.prefix)}${String(series.yearPattern).replace('YYYY', input.taxPoint.slice(0, 4))}${String(number).padStart(Number(series.padding), '0')}`;
      const client = this.database.prepare('SELECT name, organisation, address, email FROM parties WHERE id = ? AND firm_id = ? AND matter_id = ?')
        .get(bill.clientPartyId, user.firmId, matterId) as Row;
      const content = this.renderBill(user, bill, reference, input.taxPoint, client);
      const generated = this.writeGeneratedBill({ billReference: reference, originalName: `${reference}.html`, mimeType: 'text/html', content });
      stagedFile = generated;
      const bytes = new TextEncoder().encode(content);
      const expectedChecksum = createHash('sha256').update(bytes).digest('hex');
      if (generated.sha256 !== expectedChecksum || generated.sizeBytes !== bytes.byteLength || !generated.storageKey
        || generated.content !== content || generated.billReference !== reference) {
        throw new BillingCashroomStoreError('INVALID_STATE', 'Generated bill storage returned invalid exact-file metadata.');
      }
      const issuedAt = this.now().toISOString();
      this.database.prepare(`UPDATE finance_bills SET series_id = ?, bill_number = ?, bill_reference = ?
        WHERE id = ? AND firm_id = ? AND matter_id = ? AND bill_number IS NULL`).run(series.id, number, reference, billId, user.firmId, matterId);
      this.database.prepare('UPDATE finance_bill_series SET next_number = next_number + 1 WHERE id = ? AND firm_id = ? AND next_number = ?')
        .run(series.id, user.firmId, number);
      const documentId = randomUUID();
      const documentVersionId = randomUUID();
      this.database.prepare(`INSERT INTO documents (id, firm_id, matter_id, title, category, created_by, created_at)
        VALUES (?, ?, ?, ?, 'Finance - Bills', ?, ?)`).run(documentId, user.firmId, matterId, `Bill ${reference}`, user.id, issuedAt);
      this.database.prepare(`INSERT INTO document_versions (
        id, firm_id, document_id, version, original_name, mime_type, size_bytes, sha256, storage_key, uploaded_by, created_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`).run(documentVersionId, user.firmId, documentId,
        generated.originalName, generated.mimeType, generated.sizeBytes, generated.sha256, generated.storageKey, user.id, issuedAt);
      this.database.prepare(`INSERT INTO finance_bill_documents (
        id, firm_id, matter_id, bill_id, bill_version_id, document_version_id, tax_point, sha256, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), user.firmId, matterId, billId,
        bill.currentVersionId, documentVersionId, input.taxPoint, generated.sha256, issuedAt);
      const sourceLines = bill.lines.filter((line) => line.sourceKind !== 'adjustment');
      const insertAllocation = this.database.prepare(`INSERT INTO finance_bill_source_allocations (
        id, firm_id, matter_id, bill_id, bill_line_id, source_kind, source_id, allocated_net_minor, currency, allocated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'GBP', ?)`);
      for (const line of sourceLines) insertAllocation.run(randomUUID(), user.firmId, matterId, billId, line.id,
        line.sourceKind, line.sourceId, line.netMinor, issuedAt);
      this.postBillJournal(user, matterId, bill, input.taxPoint, issuedAt);
      this.insertEvent(user, matterId, billId, bill.version + 1, 'issued', bill.currentVersionId,
        `Bill ${reference} issued from exact approved version.`, issuedAt, documentVersionId);
      const response = this.getBill(user, matterId, billId)!;
      this.saveReplay(user, matterId, scope, billId, input.idempotencyKey, input, response, issuedAt);
      this.appendOperational(user, matterId, 'finance.bill_issued', billId, `Bill ${reference} issued`, input.idempotencyKey,
        issuedAt, { billReference: reference, billVersionId: bill.currentVersionId, documentVersionId,
          sha256: generated.sha256, grossMinor: bill.grossMinor, currency: 'GBP' }, audit);
      return response;
      });
    } catch (error) {
      stagedFile?.discard?.();
      throw error;
    }
  }

  private renderBill(user: SessionUser, bill: NonNullable<ReturnType<typeof this.getBill>>, reference: string, taxPoint: string, client: Row): string {
    const money = (minor: number) => `£${(minor / 100).toFixed(2)}`;
    const rows = bill.lines.map((line) => `<tr><td>${escapeHtml(line.narrative)}</td><td>${escapeHtml(line.vatTreatment)}</td><td>${money(line.sourceKind === 'adjustment' ? -line.netMinor : line.netMinor)}</td><td>${money(line.sourceKind === 'adjustment' ? -line.vatMinor : line.vatMinor)}</td></tr>`).join('');
    return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Bill ${escapeHtml(reference)}</title><body><h1>${escapeHtml(user.firmName)}</h1><h2>Invoice ${escapeHtml(reference)}</h2><p>Tax point: ${taxPoint}</p><p>Due: ${bill.dueOn}</p><p>Client: ${escapeHtml(String(client.name || client.organisation))}<br>${escapeHtml(String(client.address || ''))}</p><table><thead><tr><th>Description</th><th>VAT treatment</th><th>Net</th><th>VAT</th></tr></thead><tbody>${rows}</tbody></table><p>Net: ${money(bill.netMinor)}<br>VAT: ${money(bill.vatMinor)}<br><strong>Total: ${money(bill.grossMinor)}</strong></p></body></html>`;
  }

  private postBillJournal(user: SessionUser, matterId: string, bill: NonNullable<ReturnType<typeof this.getBill>>, accountingDate: string, at: string): void {
    const periodRows = this.database.prepare(`SELECT id FROM finance_accounting_periods WHERE firm_id = ? AND status = 'open'
      AND starts_on <= ? AND ends_on >= ?`).all(user.firmId, accountingDate, accountingDate) as Row[];
    if (periodRows.length !== 1) throw new BillingCashroomStoreError('INVALID_STATE', 'Bill issue requires exactly one open accounting period.');
    const account = (accountClass: string) => {
      const rows = this.database.prepare(`SELECT id FROM finance_accounts WHERE firm_id = ? AND active = 1
        AND account_class = ? AND designation = 'office' ORDER BY code`).all(user.firmId, accountClass) as Row[];
      if (rows.length !== 1) throw new BillingCashroomStoreError('INVALID_STATE', `Bill issue requires exactly one active ${accountClass} office account.`);
      return String(rows[0]!.id);
    };
    const receivable = account('office_asset');
    const income = account('income');
    const vat = bill.vatMinor > 0 ? account('vat_control') : null;
    const neutralAccount = (accountClass: string) => {
      const rows = this.database.prepare(`SELECT id FROM finance_accounts WHERE firm_id = ? AND active = 1
        AND account_class = ? AND designation = 'neutral' ORDER BY code`).all(user.firmId, accountClass) as Row[];
      if (rows.length !== 1) throw new BillingCashroomStoreError('INVALID_STATE', `Bill issue requires exactly one active ${accountClass} neutral account.`);
      return String(rows[0]!.id);
    };
    const timeSources = bill.lines.filter((line) => line.sourceKind === 'time');
    const consumedWipMinor = timeSources.reduce((total, line) => total + line.netMinor, 0);
    const journalId = randomUUID();
    const approver = this.database.prepare(`SELECT recorded_by AS recordedBy FROM finance_bill_events
      WHERE bill_id = ? AND firm_id = ? AND matter_id = ? AND event_type = 'approved' ORDER BY sequence DESC LIMIT 1`)
      .get(bill.id, user.firmId, matterId) as Row;
    this.database.prepare(`INSERT INTO finance_journals (
      id, firm_id, matter_id, period_id, accounting_date, source_kind, source_id, description,
      currency, reverses_journal_id, prepared_by, prepared_at
    ) VALUES (?, ?, ?, ?, ?, 'other', ?, ?, 'GBP', NULL, ?, ?)`).run(journalId, user.firmId, matterId,
      periodRows[0]!.id, accountingDate, bill.id, 'Recognise issued bill receivable, fee income and VAT.', approver.recordedBy, at);
    const insertLine = this.database.prepare(`INSERT INTO finance_journal_lines (
      id, firm_id, matter_id, journal_id, line_number, account_id, debit_minor, credit_minor, currency, memo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'GBP', ?)`);
    insertLine.run(randomUUID(), user.firmId, matterId, journalId, 1, receivable, bill.grossMinor, 0, 'Recognise gross trade debtor');
    insertLine.run(randomUUID(), user.firmId, matterId, journalId, 2, income, 0, bill.netMinor, 'Recognise net fee and disbursement recovery income');
    let nextLine = 3;
    if (vat) insertLine.run(randomUUID(), user.firmId, matterId, journalId, nextLine++, vat, 0, bill.vatMinor, 'Recognise VAT liability');
    if (consumedWipMinor > 0) {
      insertLine.run(randomUUID(), user.firmId, matterId, journalId, nextLine++, neutralAccount('suspense'), consumedWipMinor, 0, 'Release billed WIP offset control');
      insertLine.run(randomUUID(), user.firmId, matterId, journalId, nextLine, neutralAccount('wip_asset'), 0, consumedWipMinor, 'Release consumed approved WIP');
    }
    const insertEvent = this.database.prepare(`INSERT INTO finance_journal_events (
      id, firm_id, matter_id, journal_id, sequence, event_type, note, occurred_at, recorded_by, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insertEvent.run(randomUUID(), user.firmId, matterId, journalId, 1, 'prepared', 'Generated from the independently approved exact bill version.', at, approver.recordedBy, at);
    insertEvent.run(randomUUID(), user.firmId, matterId, journalId, 2, 'approved', 'Bill approval supplies independent posting authority.', at, user.id, at);
    insertEvent.run(randomUUID(), user.firmId, matterId, journalId, 3, 'posted', 'Bill issue journal posted atomically with explicit human confirmation.', at, user.id, at);
  }

  recordBillDelivery(user: SessionUser, matterId: string, billId: string, input: RecordFinanceBillDeliveryInput, audit: AuditContext) {
    this.requireMatter(user, matterId, 'finance.issue_bill');
    const scope = `deliver_bill:${billId}`;
    const replay = this.replay<NonNullable<ReturnType<typeof this.getBill>>>(user, matterId, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      const bill = this.getBill(user, matterId, billId);
      if (!bill) throw new BillingCashroomStoreError('NOT_FOUND', 'The bill was not found.');
      if (bill.version !== input.expectedVersion) throw new BillingCashroomStoreError('CONFLICT', 'The bill version is stale.');
      if (bill.status !== 'issued' || !input.evidenceDocumentVersionId) throw new BillingCashroomStoreError('INVALID_STATE', 'Only an issued bill with exact delivery evidence can be delivered.');
      if (!this.database.prepare(`SELECT 1 FROM document_versions dv JOIN documents d ON d.id = dv.document_id AND d.firm_id = dv.firm_id
        WHERE dv.id = ? AND dv.firm_id = ? AND d.matter_id = ?`).get(input.evidenceDocumentVersionId, user.firmId, matterId)) {
        throw new BillingCashroomStoreError('INVALID_LINK', 'The exact delivery evidence version was not found.');
      }
      const deliveredAt = isoTimestamp(input.deliveredAt, 'Bill delivery timestamp');
      if (!bill.issuedAt || Date.parse(deliveredAt) < Date.parse(bill.issuedAt)) throw new BillingCashroomStoreError('INVALID_STATE', 'Bill delivery cannot predate issue.');
      this.insertEvent(user, matterId, billId, bill.version + 1, 'delivered', bill.currentVersionId,
        `Delivered by ${input.channel} to ${input.recipient}.`, deliveredAt, input.evidenceDocumentVersionId);
      const response = this.getBill(user, matterId, billId)!;
      this.saveReplay(user, matterId, scope, billId, input.idempotencyKey, input, response, this.now().toISOString());
      this.appendOperational(user, matterId, 'finance.bill_delivered', billId, `Bill ${bill.billReference} delivery recorded`,
        input.idempotencyKey, deliveredAt, { billReference: bill.billReference, channel: input.channel,
          evidenceDocumentVersionId: input.evidenceDocumentVersionId }, audit);
      return response;
    });
  }

  getCreditNote(user: SessionUser, matterId: string, creditNoteId: string) {
    if (!this.canReadMatter(user, matterId)) return null;
    const row = this.database.prepare(`SELECT id, bill_id AS billId, credit_reference AS creditReference,
      reason, prepared_by AS preparedBy, prepared_at AS preparedAt FROM finance_credit_notes
      WHERE id = ? AND firm_id = ? AND matter_id = ?`).get(creditNoteId, user.firmId, matterId) as Row | undefined;
    if (!row) return null;
    const lines = this.database.prepare(`SELECT id, bill_line_id AS billLineId, line_number AS lineNumber,
      net_minor AS netMinor, vat_minor AS vatMinor, gross_minor AS grossMinor
      FROM finance_credit_note_lines WHERE credit_note_id = ? AND firm_id = ? AND matter_id = ? ORDER BY line_number`)
      .all(creditNoteId, user.firmId, matterId) as Row[];
    const events = this.database.prepare(`SELECT sequence, event_type AS eventType, note, occurred_at AS occurredAt,
      recorded_by AS recordedBy FROM finance_credit_note_events WHERE credit_note_id = ? AND firm_id = ? AND matter_id = ? ORDER BY sequence`)
      .all(creditNoteId, user.firmId, matterId) as Row[];
    const status = events.some((event) => event.eventType === 'issued') ? 'issued' : 'prepared';
    return { id: String(row.id), billId: String(row.billId), creditReference: row.creditReference ? String(row.creditReference) : null,
      reason: String(row.reason), preparedBy: String(row.preparedBy), preparedAt: String(row.preparedAt), status,
      version: events.length, netMinor: lines.reduce((total, line) => total + Number(line.netMinor), 0),
      vatMinor: lines.reduce((total, line) => total + Number(line.vatMinor), 0),
      grossMinor: lines.reduce((total, line) => total + Number(line.grossMinor), 0),
      currency: 'GBP' as const, lines: lines.map((line) => ({ id: String(line.id), billLineId: String(line.billLineId),
        lineNumber: Number(line.lineNumber), netMinor: Number(line.netMinor), vatMinor: Number(line.vatMinor), grossMinor: Number(line.grossMinor) })), events };
  }

  prepareCreditNote(user: SessionUser, matterId: string, billId: string, input: PrepareCreditNoteInput, audit: AuditContext) {
    this.requireMatter(user, matterId, 'finance.approve_bill');
    const scope = `prepare_credit_note:${billId}`;
    const replay = this.replay<NonNullable<ReturnType<typeof this.getCreditNote>>>(user, matterId, scope, input.idempotencyKey, input);
    if (replay) return replay;
    if (input.reason.trim().length < 10 || input.lines.length === 0) throw new BillingCashroomStoreError('INVALID_STATE', 'A credit note requires a clear reason and exact bill lines.');
    return transaction(this.database, () => {
      const bill = this.getBill(user, matterId, billId);
      if (!bill || !['issued', 'delivered', 'part_paid', 'paid'].includes(bill.status)) throw new BillingCashroomStoreError('NOT_FOUND', 'An issued bill was not found.');
      const creditId = randomUUID();
      const at = this.now().toISOString();
      this.database.prepare(`INSERT INTO finance_credit_notes (
        id, firm_id, matter_id, bill_id, credit_reference, reason, currency, prepared_by, prepared_at
      ) VALUES (?, ?, ?, ?, NULL, ?, 'GBP', ?, ?)`).run(creditId, user.firmId, matterId, billId, input.reason.trim(), user.id, at);
      const insertLine = this.database.prepare(`INSERT INTO finance_credit_note_lines (
        id, firm_id, matter_id, credit_note_id, bill_line_id, line_number, net_minor, vat_minor, gross_minor, currency
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'GBP')`);
      const seen = new Set<string>();
      input.lines.forEach((line, index) => {
        if (seen.has(line.billLineId)) throw new BillingCashroomStoreError('INVALID_STATE', 'A bill line can appear only once in a credit note.');
        seen.add(line.billLineId);
        const original = this.database.prepare(`SELECT source_kind AS sourceKind, net_minor AS netMinor, vat_minor AS vatMinor,
          gross_minor AS grossMinor, vat_treatment AS vatTreatment, rate_numerator AS rateNumerator,
          rate_denominator AS rateDenominator
          FROM finance_bill_lines WHERE id = ? AND bill_id = ? AND firm_id = ? AND matter_id = ?`)
          .get(line.billLineId, billId, user.firmId, matterId) as Row | undefined;
        if (!original || original.sourceKind === 'adjustment' || line.netMinor <= 0 || line.vatMinor < 0 || line.netMinor > Number(original.netMinor)
          || line.vatMinor > Number(original.vatMinor)) throw new BillingCashroomStoreError('INVALID_LINK', 'A credit line exceeds or does not match its exact issued bill line.');
        const exactVat = original.vatTreatment === 'standard'
          ? calculateVat({ netMinor: line.netMinor, treatment: 'standard', rateNumerator: Number(original.rateNumerator), rateDenominator: Number(original.rateDenominator) }).vatMinor
          : 0;
        if (line.vatMinor !== exactVat) throw new BillingCashroomStoreError('INVALID_STATE', 'Credit VAT must preserve the exact issued line treatment and rate.');
        const prior = this.database.prepare(`SELECT COALESCE(SUM(cnl.gross_minor),0) AS amount FROM finance_credit_note_lines cnl
          JOIN finance_credit_note_events cne ON cne.credit_note_id = cnl.credit_note_id AND cne.firm_id = cnl.firm_id
            AND cne.matter_id = cnl.matter_id AND cne.event_type = 'issued'
          WHERE cnl.firm_id = ? AND cnl.matter_id = ? AND cnl.bill_line_id = ?`).get(user.firmId, matterId, line.billLineId) as Row;
        projectCreditImpact({ originalGrossMinor: Number(original.grossMinor), priorIssuedCreditsMinor: Number(prior.amount),
          proposedGrossMinor: line.netMinor + line.vatMinor });
        insertLine.run(randomUUID(), user.firmId, matterId, creditId, line.billLineId, index + 1,
          line.netMinor, line.vatMinor, line.netMinor + line.vatMinor);
      });
      this.database.prepare(`INSERT INTO finance_credit_note_events (
        id, firm_id, matter_id, credit_note_id, sequence, event_type, note, occurred_at, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, 1, 'prepared', ?, ?, ?, ?)`).run(randomUUID(), user.firmId, matterId, creditId,
        input.reason.trim(), at, user.id, at);
      const response = this.getCreditNote(user, matterId, creditId)!;
      this.saveReplay(user, matterId, scope, creditId, input.idempotencyKey, input, response, at);
      this.appendOperational(user, matterId, 'finance.credit_note_prepared', creditId, 'Credit note prepared', input.idempotencyKey,
        at, { billId, grossMinor: response.grossMinor, currency: 'GBP' }, audit);
      return response;
    });
  }

  issueCreditNote(user: SessionUser, matterId: string, creditNoteId: string, input: IssueCreditNoteInput, audit: AuditContext) {
    this.requireMatter(user, matterId, 'finance.issue_bill');
    const scope = `issue_credit_note:${creditNoteId}`;
    const replay = this.replay<NonNullable<ReturnType<typeof this.getCreditNote>>>(user, matterId, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      const credit = this.getCreditNote(user, matterId, creditNoteId);
      if (!credit) throw new BillingCashroomStoreError('NOT_FOUND', 'The credit note was not found.');
      if (credit.preparedBy === user.id) throw new BillingCashroomStoreError('INDEPENDENCE_REQUIRED', 'Credit-note issue requires an independent approver.');
      if (credit.version !== input.expectedVersion) throw new BillingCashroomStoreError('CONFLICT', 'The credit-note version is stale.');
      if (credit.status !== 'prepared') throw new BillingCashroomStoreError('INVALID_STATE', 'Only a prepared credit note can be issued.');
      const issuedAt = isoTimestamp(input.issuedAt, 'Credit-note issue timestamp');
      if (Date.parse(issuedAt) <= Date.parse(credit.preparedAt)) throw new BillingCashroomStoreError('INVALID_STATE', 'Credit-note issue must occur after preparation.');
      for (const line of credit.lines) {
        const original = this.database.prepare('SELECT gross_minor AS grossMinor FROM finance_bill_lines WHERE id = ? AND firm_id = ? AND matter_id = ?')
          .get(line.billLineId, user.firmId, matterId) as Row;
        const prior = this.database.prepare(`SELECT COALESCE(SUM(cnl.gross_minor),0) AS amount FROM finance_credit_note_lines cnl
          JOIN finance_credit_note_events cne ON cne.credit_note_id = cnl.credit_note_id AND cne.firm_id = cnl.firm_id
            AND cne.matter_id = cnl.matter_id AND cne.event_type = 'issued'
          WHERE cnl.firm_id = ? AND cnl.matter_id = ? AND cnl.bill_line_id = ? AND cnl.credit_note_id <> ?`)
          .get(user.firmId, matterId, line.billLineId, creditNoteId) as Row;
        projectCreditImpact({ originalGrossMinor: Number(original.grossMinor), priorIssuedCreditsMinor: Number(prior.amount), proposedGrossMinor: line.grossMinor });
      }
      const bill = this.getBill(user, matterId, credit.billId)!;
      const sequenceRow = this.database.prepare(`SELECT COUNT(*) AS count FROM finance_credit_note_events e
        JOIN finance_credit_notes c ON c.id = e.credit_note_id AND c.firm_id = e.firm_id AND c.matter_id = e.matter_id
        WHERE c.firm_id = ? AND c.matter_id = ? AND c.bill_id = ? AND e.event_type = 'issued'`)
        .get(user.firmId, matterId, credit.billId) as Row;
      const reference = `CN-${bill.billReference}-${String(Number(sequenceRow.count) + 1).padStart(3, '0')}`;
      const content = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeHtml(reference)}</title><body><h1>${escapeHtml(user.firmName)}</h1><h2>Credit note ${escapeHtml(reference)}</h2><p>Original bill: ${escapeHtml(String(bill.billReference))}</p><p>Reason: ${escapeHtml(credit.reason)}</p><p>Net credit: £${(credit.netMinor / 100).toFixed(2)}<br>VAT credit: £${(credit.vatMinor / 100).toFixed(2)}<br><strong>Total credit: £${(credit.grossMinor / 100).toFixed(2)}</strong></p></body></html>`;
      const generated = this.writeGeneratedBill({ billReference: reference, originalName: `${reference}.html`, mimeType: 'text/html', content });
      const bytes = new TextEncoder().encode(content);
      const expectedChecksum = createHash('sha256').update(bytes).digest('hex');
      if (generated.sha256 !== expectedChecksum || generated.sizeBytes !== bytes.byteLength || generated.content !== content) throw new BillingCashroomStoreError('INVALID_STATE', 'Generated credit-note storage returned invalid exact-file metadata.');
      this.database.prepare('UPDATE finance_credit_notes SET credit_reference = ? WHERE id = ? AND firm_id = ? AND credit_reference IS NULL')
        .run(reference, creditNoteId, user.firmId);
      const documentId = randomUUID();
      const versionId = randomUUID();
      this.database.prepare(`INSERT INTO documents (id, firm_id, matter_id, title, category, created_by, created_at)
        VALUES (?, ?, ?, ?, 'Finance - Credit notes', ?, ?)`).run(documentId, user.firmId, matterId, `Credit note ${reference}`, user.id, issuedAt);
      this.database.prepare(`INSERT INTO document_versions (
        id, firm_id, document_id, version, original_name, mime_type, size_bytes, sha256, storage_key, uploaded_by, created_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`).run(versionId, user.firmId, documentId, generated.originalName,
        generated.mimeType, generated.sizeBytes, generated.sha256, generated.storageKey, user.id, issuedAt);
      this.database.prepare(`INSERT INTO finance_credit_note_documents (
        id, firm_id, matter_id, credit_note_id, document_version_id, sha256, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), user.firmId, matterId, creditNoteId, versionId, generated.sha256, issuedAt);
      this.postCreditJournal(user, matterId, credit, issuedAt.slice(0, 10), issuedAt);
      const insertEvent = this.database.prepare(`INSERT INTO finance_credit_note_events (
        id, firm_id, matter_id, credit_note_id, sequence, event_type, note, occurred_at, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      insertEvent.run(randomUUID(), user.firmId, matterId, creditNoteId, 2, 'approved', 'Credit-note value and original lines independently approved.', issuedAt, user.id, this.now().toISOString());
      insertEvent.run(randomUUID(), user.firmId, matterId, creditNoteId, 3, 'issued', `Credit note ${reference} issued.`, issuedAt, user.id, this.now().toISOString());
      const response = this.getCreditNote(user, matterId, creditNoteId)!;
      this.saveReplay(user, matterId, scope, creditNoteId, input.idempotencyKey, input, response, this.now().toISOString());
      this.appendOperational(user, matterId, 'finance.credit_note_issued', creditNoteId, `Credit note ${reference} issued`,
        input.idempotencyKey, issuedAt, { billId: credit.billId, creditReference: reference, grossMinor: credit.grossMinor, currency: 'GBP' }, audit);
      return response;
    });
  }

  private postCreditJournal(user: SessionUser, matterId: string, credit: NonNullable<ReturnType<typeof this.getCreditNote>>, accountingDate: string, at: string): void {
    const periodRows = this.database.prepare(`SELECT id FROM finance_accounting_periods WHERE firm_id = ? AND status = 'open'
      AND starts_on <= ? AND ends_on >= ?`).all(user.firmId, accountingDate, accountingDate) as Row[];
    if (periodRows.length !== 1) throw new BillingCashroomStoreError('INVALID_STATE', 'Credit-note issue requires exactly one open accounting period.');
    const account = (accountClass: string) => {
      const rows = this.database.prepare(`SELECT id FROM finance_accounts WHERE firm_id = ? AND active = 1
        AND account_class = ? AND designation = 'office' ORDER BY code`).all(user.firmId, accountClass) as Row[];
      if (rows.length !== 1) throw new BillingCashroomStoreError('INVALID_STATE', `Credit-note issue requires exactly one active ${accountClass} office account.`);
      return String(rows[0]!.id);
    };
    const journalId = randomUUID();
    this.database.prepare(`INSERT INTO finance_journals (
      id, firm_id, matter_id, period_id, accounting_date, source_kind, source_id, description,
      currency, reverses_journal_id, prepared_by, prepared_at
    ) VALUES (?, ?, ?, ?, ?, 'other', ?, ?, 'GBP', NULL, ?, ?)`).run(journalId, user.firmId, matterId,
      periodRows[0]!.id, accountingDate, credit.id, 'Recognise issued credit note against receivable, income and VAT.', credit.preparedBy, at);
    const insertLine = this.database.prepare(`INSERT INTO finance_journal_lines (
      id, firm_id, matter_id, journal_id, line_number, account_id, debit_minor, credit_minor, currency, memo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'GBP', ?)`);
    let line = 1;
    insertLine.run(randomUUID(), user.firmId, matterId, journalId, line++, account('income'), credit.netMinor, 0, 'Reverse credited income');
    if (credit.vatMinor > 0) insertLine.run(randomUUID(), user.firmId, matterId, journalId, line++, account('vat_control'), credit.vatMinor, 0, 'Reverse credited VAT liability');
    insertLine.run(randomUUID(), user.firmId, matterId, journalId, line, account('office_asset'), 0, credit.grossMinor, 'Reduce trade debtor by issued credit');
    const event = this.database.prepare(`INSERT INTO finance_journal_events (
      id, firm_id, matter_id, journal_id, sequence, event_type, note, occurred_at, recorded_by, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    event.run(randomUUID(), user.firmId, matterId, journalId, 1, 'prepared', 'Generated from exact credit-note lines.', at, credit.preparedBy, at);
    event.run(randomUUID(), user.firmId, matterId, journalId, 2, 'approved', 'Credit-note issue independently approved.', at, user.id, at);
    event.run(randomUUID(), user.firmId, matterId, journalId, 3, 'posted', 'Credit-note journal posted atomically.', at, user.id, at);
  }
}
