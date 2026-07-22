import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
  ApproveFinanceBillInput,
  AllocateFinanceReceiptInput,
  ApproveFinanceClientOfficeTransferInput,
  ApproveFinanceClientPaymentInput,
  IssueFinanceBillInput,
  ImportFinanceBankStatementInput,
  PostFinanceClientOfficeTransferInput,
  PrepareFinanceClientOfficeTransferInput,
  PrepareFinanceClientPaymentInput,
  PrepareFinanceBillInput,
  RecordFinanceClientPaymentInput,
  RecordFinanceReceiptInput,
  ReverseFinanceReceiptAllocationInput,
  RecordFinanceBillDeliveryInput,
  SubmitFinanceBillInput,
} from '../../shared/contracts.js';
import { canReadAllFirmMatters, hasCapability, type Capability, type SessionUser } from '../policy.js';
import { appendAudit, appendTimeline, type AuditContext } from '../store.js';
import { calculateBillTotals, calculateVat, type VatCalculation, type VatTreatment } from './billing-calculations.js';
import { projectBill, type BillLifecycleEvent, type BillVersionSnapshot } from './billing.js';
import { projectCreditImpact } from './billing.js';
import { projectMatterMoney } from './cashroom.js';
import { calculateReconciliation, nextReviewDueOn, suggestBankMatches } from './reconciliation.js';

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

export interface RetainedFinancialEvidenceInput {
  idempotencyKey: string;
  matterId: string;
  title: string;
  originalName: string;
  mimeType: string;
  storageKey: string;
  sizeBytes: number;
  sha256: string;
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

export interface PrepareReconciliationInput {
  idempotencyKey: string;
  bankAccountId: string;
  statementBatchId: string;
  ledgerClearedBalanceMinor: number;
  outstandingLodgementsMinor: number;
  unpresentedPaymentsMinor: number;
  documentedAdjustmentsMinor: number;
  items: Array<{
    itemKind: 'statement_match' | 'outstanding_lodgement' | 'unpresented_payment' | 'adjustment';
    statementLineId: string | null;
    journalId: string | null;
    amountMinor: number;
    evidenceDocumentVersionId: string | null;
    explanation: string;
  }>;
  note: string;
  explicitHumanConfirmation: true;
}

export interface SignoffReconciliationInput {
  expectedVersion: number;
  idempotencyKey: string;
  signedOffAt: string;
  note: string;
  explicitHumanApproval: true;
}

export interface DecideReconciliationMatchInput {
  expectedVersion: number;
  idempotencyKey: string;
  statementLineId: string;
  decision: 'confirm' | 'split' | 'reject';
  matches: Array<{ journalId: string; amountMinor: number }>;
  explanation: string;
  explicitHumanConfirmation: true;
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

  getMatterBillingWorkspace(user: SessionUser, matterId: string) {
    this.requireMatter(user, matterId, 'finance.read_matter');
    const clients = (this.database.prepare(`SELECT id,COALESCE(NULLIF(name,''),organisation) AS name
      FROM parties WHERE firm_id=? AND matter_id=? AND kind='client' ORDER BY name,id`)
      .all(user.firmId, matterId) as Row[]).map((row) => ({ id: String(row.id), name: String(row.name) }));
    const billIds = (this.database.prepare(`SELECT id FROM finance_bills WHERE firm_id=? AND matter_id=? ORDER BY prepared_at DESC,id`)
      .all(user.firmId, matterId) as Row[]).map((row) => String(row.id));
    const paymentIds = (this.database.prepare(`SELECT id FROM finance_payment_requisitions WHERE firm_id=? AND matter_id=? ORDER BY prepared_at DESC,id`)
      .all(user.firmId, matterId) as Row[]).map((row) => String(row.id));
    const transferIds = (this.database.prepare(`SELECT id FROM finance_client_office_transfers WHERE firm_id=? AND matter_id=? ORDER BY prepared_at DESC,id`)
      .all(user.firmId, matterId) as Row[]).map((row) => String(row.id));
    const timeSources = (this.database.prepare(`SELECT t.id,'time' AS kind,t.narrative,a.charge_minor AS netMinor,NULL AS vatMinor
      FROM finance_time_entries t JOIN finance_time_approvals a ON a.time_entry_id=t.id AND a.firm_id=t.firm_id AND a.matter_id=t.matter_id
      WHERE t.firm_id=? AND t.matter_id=? AND t.chargeable=1
      AND (SELECT e.event_type FROM finance_time_entry_events e WHERE e.time_entry_id=t.id AND e.firm_id=t.firm_id
        AND e.matter_id=t.matter_id ORDER BY e.sequence DESC LIMIT 1)='approved'
      AND NOT EXISTS (SELECT 1 FROM finance_bill_source_allocations s WHERE s.firm_id=t.firm_id AND s.matter_id=t.matter_id
        AND s.source_kind='time' AND s.source_id=t.id) ORDER BY t.work_date,t.id`)
      .all(user.firmId, matterId) as Row[]);
    const disbursementSources = (this.database.prepare(`SELECT d.id,'disbursement' AS kind,d.description AS narrative,
      d.net_minor AS netMinor,d.vat_minor AS vatMinor FROM finance_disbursements d WHERE d.firm_id=? AND d.matter_id=?
      AND (SELECT e.event_type FROM finance_disbursement_events e WHERE e.disbursement_id=d.id AND e.firm_id=d.firm_id
        AND e.matter_id=d.matter_id ORDER BY e.sequence DESC LIMIT 1) IN ('incurred','paid_external')
      AND NOT EXISTS (SELECT 1 FROM finance_bill_source_allocations s WHERE s.firm_id=d.firm_id AND s.matter_id=d.matter_id
        AND s.source_kind='disbursement' AND s.source_id=d.id) ORDER BY d.invoice_date,d.id`)
      .all(user.firmId, matterId) as Row[]);
    const eligibleSources = [...timeSources, ...disbursementSources].map((row) => ({
      id: String(row.id), kind: row.kind as 'time' | 'disbursement', narrative: String(row.narrative),
      netMinor: Number(row.netMinor), vatMinor: row.vatMinor === null ? null : Number(row.vatMinor),
    }));
    const exceptions = (this.database.prepare(`SELECT id,exception_kind AS kind,severity,safe_summary AS summary,
      amount_minor AS amountMinor,raised_at AS raisedAt FROM finance_exceptions WHERE firm_id=? AND matter_id=?
      ORDER BY raised_at DESC,id`).all(user.firmId, matterId) as Row[]).map((row) => ({
      id: String(row.id), kind: String(row.kind), severity: String(row.severity), summary: String(row.summary),
      amountMinor: row.amountMinor === null ? null : Number(row.amountMinor), raisedAt: String(row.raisedAt),
    }));
    const historyQueries = [
      [`SELECT id,'bill' AS kind,bill_id AS recordId,event_type AS status,occurred_at AS occurredAt,note AS summary
        FROM finance_bill_events WHERE firm_id=? AND matter_id=?`, 'bill'],
      [`SELECT id,'payment' AS kind,payment_id AS recordId,event_type AS status,occurred_at AS occurredAt,note AS summary
        FROM finance_payment_events WHERE firm_id=? AND matter_id=?`, 'payment'],
      [`SELECT id,'transfer' AS kind,transfer_id AS recordId,event_type AS status,occurred_at AS occurredAt,note AS summary
        FROM finance_transfer_events WHERE firm_id=? AND matter_id=?`, 'transfer'],
    ] as const;
    const history = historyQueries.flatMap(([sql]) => this.database.prepare(sql).all(user.firmId, matterId) as Row[])
      .map((row) => ({ id: String(row.id), kind: String(row.kind), recordId: String(row.recordId),
        status: String(row.status), occurredAt: String(row.occurredAt), summary: String(row.summary) }))
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id));
    return {
      matterId, actingUserId: user.id,
      permissions: {
        canPrepareBill: hasCapability(user, 'finance.prepare_bill'),
        canApproveBill: hasCapability(user, 'finance.approve_bill'),
        canIssueBill: hasCapability(user, 'finance.issue_bill'),
        canPrepareTransfer: hasCapability(user, 'finance.prepare_client_payment'),
        canApproveTransfer: hasCapability(user, 'finance.approve_client_payment'),
        canPostTransfer: hasCapability(user, 'finance.post_cashroom'),
      },
      clients, eligibleSources,
      bills: billIds.map((id) => this.getBill(user, matterId, id)!),
      money: clients.map((client) => ({ clientPartyId: client.id, ...this.getMatterMoney(user, matterId, client.id) })),
      payments: paymentIds.map((id) => {
        const payment = this.getClientPayment(user, matterId, id)!;
        return { id: payment.id, clientPartyId: payment.clientPartyId, amountMinor: payment.amountMinor,
          purpose: payment.purpose, preparedBy: payment.preparedBy, preparedAt: payment.preparedAt,
          currency: payment.currency, version: payment.version, status: payment.status, events: payment.events };
      }),
      transfers: transferIds.map((id) => this.getClientOfficeTransfer(user, matterId, id)!),
      exceptions, history,
    };
  }

  getFirmCashroomWorkspace(user: SessionUser) {
    this.requireCapability(user, 'finance.read_firm');
    const billIds = (this.database.prepare(`SELECT id,matter_id AS matterId FROM finance_bills
      WHERE firm_id=? AND bill_reference IS NOT NULL ORDER BY bill_number DESC,id`)
      .all(user.firmId) as Row[]);
    const bills = billIds.map((row) => {
      const bill = this.getBill(user, String(row.matterId), String(row.id))!;
      const days = Math.floor((Date.parse(bill.dueOn) - Date.parse(this.now().toISOString().slice(0, 10))) / 86_400_000);
      const ageBucket = bill.outstandingMinor === 0 ? 'paid' : days >= 0 ? 'not_due'
        : days >= -30 ? '1_30' : days >= -60 ? '31_60' : days >= -90 ? '61_90' : '90_plus';
      const matter = this.database.prepare(`SELECT reference FROM matters WHERE id=? AND firm_id=?`)
        .get(row.matterId, user.firmId) as Row;
      return { id: bill.id, matterId: String(row.matterId), matterReference: String(matter.reference),
        clientPartyId: bill.clientPartyId, billReference: bill.billReference!, dueOn: bill.dueOn,
        grossMinor: bill.grossMinor, creditedMinor: bill.creditedMinor, paidMinor: bill.paidMinor,
        outstandingMinor: bill.outstandingMinor, currency: bill.currency, status: bill.status, ageBucket };
    });
    const receiptIds = (this.database.prepare(`SELECT id FROM finance_receipts WHERE firm_id=? ORDER BY received_on DESC,id`)
      .all(user.firmId) as Row[]).map((row) => String(row.id));
    const receipts = receiptIds.map((id) => {
      const receipt = this.getReceipt(user, id)!;
      const reversed = new Set(receipt.allocations.filter((allocation) => allocation.reversesAllocationId)
        .map((allocation) => allocation.reversesAllocationId));
      const active = receipt.allocations.filter((allocation) => !allocation.reversesAllocationId && !reversed.has(allocation.id));
      const activeAllocatedMinor = active.filter((allocation) => allocation.designation !== 'suspense')
        .reduce((total, allocation) => total + allocation.amountMinor, 0);
      const suspenseMinor = active.filter((allocation) => allocation.designation === 'suspense')
        .reduce((total, allocation) => total + allocation.amountMinor, 0);
      return { id: receipt.id, bankAccountId: receipt.bankAccountId, amountMinor: receipt.amountMinor,
        allocatedMinor: activeAllocatedMinor, unallocatedMinor: receipt.amountMinor - activeAllocatedMinor,
        receivedOn: receipt.receivedOn, reference: receipt.reference, currency: receipt.currency,
        status: suspenseMinor === receipt.amountMinor ? 'suspense' : activeAllocatedMinor === 0 ? 'unallocated'
          : activeAllocatedMinor === receipt.amountMinor ? 'allocated' : 'part_allocated' };
    });
    const payments = (this.database.prepare(`SELECT p.id,p.matter_id AS matterId,m.reference AS matterReference,
      p.client_party_id AS clientPartyId,p.amount_minor AS amountMinor,p.currency,p.purpose,p.prepared_by AS preparedBy,
      p.prepared_at AS preparedAt,(SELECT e.event_type FROM finance_payment_events e WHERE e.payment_id=p.id
      AND e.firm_id=p.firm_id AND e.matter_id=p.matter_id ORDER BY e.sequence DESC LIMIT 1) AS status
      FROM finance_payment_requisitions p JOIN matters m ON m.id=p.matter_id AND m.firm_id=p.firm_id
      WHERE p.firm_id=? ORDER BY p.prepared_at DESC,p.id`).all(user.firmId) as Row[]).map((row) => ({
        id: String(row.id), matterId: String(row.matterId), matterReference: String(row.matterReference),
        clientPartyId: String(row.clientPartyId), amountMinor: Number(row.amountMinor), currency: 'GBP' as const,
        purpose: String(row.purpose), preparedBy: String(row.preparedBy), preparedAt: String(row.preparedAt), status: String(row.status),
      }));
    const bankAccounts = (this.database.prepare(`SELECT b.id,b.name,b.designation,b.account_identifier_masked AS accountIdentifierMasked,
      b.currency,b.active,MAX(s.statement_to) AS latestStatementTo FROM finance_bank_accounts b
      LEFT JOIN finance_bank_statement_batches s ON s.bank_account_id=b.id AND s.firm_id=b.firm_id
      WHERE b.firm_id=? GROUP BY b.id ORDER BY b.designation,b.name,b.id`).all(user.firmId) as Row[]).map((row) => ({
        id: String(row.id), name: String(row.name), designation: String(row.designation),
        accountIdentifierMasked: String(row.accountIdentifierMasked), currency: 'GBP' as const,
        active: Boolean(row.active), latestStatementTo: row.latestStatementTo ? String(row.latestStatementTo) : null,
      }));
    const reconciliationIds = (this.database.prepare(`SELECT id FROM finance_reconciliations WHERE firm_id=?
      ORDER BY statement_closing_on DESC,id`).all(user.firmId) as Row[]).map((row) => String(row.id));
    const reconciliations = reconciliationIds.map((id) => {
      const value = this.getReconciliation(user, id)!;
      return { id: value.id, bankAccountId: value.bankAccountId, statementBatchId: value.statementBatchId,
        statementClosingOn: value.statementClosingOn, statementClosingBalanceMinor: value.statementClosingBalanceMinor,
        ledgerClearedBalanceMinor: value.ledgerClearedBalanceMinor, differenceMinor: value.differenceMinor,
        currency: value.currency, preparedBy: value.preparedBy, preparedAt: value.preparedAt,
        version: value.version, status: value.status, nextReviewDueOn: value.nextReviewDueOn };
    });
    const statementIds = (this.database.prepare(`SELECT id FROM finance_bank_statement_batches WHERE firm_id=?
      ORDER BY statement_to DESC,id`).all(user.firmId) as Row[]).map((row) => String(row.id));
    const statements = statementIds.map((id) => {
      const statement = this.getBankStatementBatch(user, id)!;
      const reconciliation = reconciliations.find((item) => item.statementBatchId === id);
      const retained = reconciliation ? this.getReconciliation(user, reconciliation.id)! : null;
      const decisions = new Map(retained?.items.filter((item) => item.statementLineId)
        .map((item) => [item.statementLineId!, item]) ?? []);
      const journals = (this.database.prepare(`SELECT j.id,j.accounting_date AS accountingDate,
        (l.debit_minor-l.credit_minor) AS amountMinor,j.description AS reference
        FROM finance_bank_accounts b JOIN finance_journal_lines l ON l.account_id=b.ledger_account_id AND l.firm_id=b.firm_id
        JOIN finance_journals j ON j.id=l.journal_id AND j.firm_id=l.firm_id AND j.matter_id=l.matter_id
        WHERE b.id=? AND b.firm_id=? AND EXISTS (SELECT 1 FROM finance_journal_events e WHERE e.journal_id=j.id
        AND e.firm_id=j.firm_id AND e.matter_id=j.matter_id AND e.event_type='posted') ORDER BY j.accounting_date,j.id`)
        .all(statement.bankAccountId, user.firmId) as Row[]).map((row) => ({ id: String(row.id),
          accountingDate: String(row.accountingDate), amountMinor: Number(row.amountMinor), reference: String(row.reference) }));
      const suggestions = new Map(suggestBankMatches({ statementLines: statement.lines.map((line) => ({
        id: line.id, transactionDate: line.transactionDate, amountMinor: line.amountMinor, reference: line.reference,
      })), journalEntries: journals }).map((suggestion) => [suggestion.statementLineId, suggestion]));
      return { id: statement.id, bankAccountId: statement.bankAccountId, statementFrom: statement.statementFrom,
        statementTo: statement.statementTo, closingBalanceMinor: statement.closingBalanceMinor, currency: statement.currency,
        reconciliationId: reconciliation?.id ?? null, reconciliationStatus: reconciliation?.status ?? null,
        reconciliationVersion: reconciliation?.version ?? null,
        lines: statement.lines.map((line) => ({ id: line.id, transactionDate: line.transactionDate,
          amountMinor: line.amountMinor, reference: line.reference,
          decision: decisions.has(line.id)
            ? decisions.get(line.id)!.journalId ? 'human_confirmed' as const : 'human_rejected' as const
            : null,
          suggestion: decisions.has(line.id) ? null : suggestions.get(line.id) ?? null })),
      };
    });
    const exceptions = (this.database.prepare(`SELECT id,matter_id AS matterId,exception_kind AS kind,severity,
      safe_summary AS summary,amount_minor AS amountMinor,currency,raised_at AS raisedAt FROM finance_exceptions
      WHERE firm_id=? ORDER BY CASE severity WHEN 'blocker' THEN 0 ELSE 1 END,raised_at DESC,id`)
      .all(user.firmId) as Row[]).map((row) => ({ id: String(row.id), matterId: row.matterId ? String(row.matterId) : null,
        kind: String(row.kind), severity: String(row.severity), summary: String(row.summary),
        amountMinor: row.amountMinor === null ? null : Number(row.amountMinor), currency: row.currency ? 'GBP' as const : null,
        raisedAt: String(row.raisedAt) }));
    return {
      actingUserId: user.id,
      permissions: {
        canRecordBankActivity: hasCapability(user, 'finance.record_bank_activity'),
        canAllocateMoney: hasCapability(user, 'finance.allocate_money'),
        canPreparePayment: hasCapability(user, 'finance.prepare_client_payment'),
        canApprovePayment: hasCapability(user, 'finance.approve_client_payment'),
        canPostCashroom: hasCapability(user, 'finance.post_cashroom'),
        canPrepareReconciliation: hasCapability(user, 'finance.prepare_reconciliation'),
        canSignoffReconciliation: hasCapability(user, 'finance.signoff_reconciliation'),
        canExport: hasCapability(user, 'finance.export_accounts'),
      },
      summary: {
        issuedGrossMinor: bills.reduce((sum, bill) => sum + bill.grossMinor, 0),
        outstandingMinor: bills.reduce((sum, bill) => sum + bill.outstandingMinor, 0),
        overdueBills: bills.filter((bill) => !['not_due','paid'].includes(bill.ageBucket)).length,
        unallocatedReceiptsMinor: receipts.reduce((sum, receipt) => sum + receipt.unallocatedMinor, 0),
        blockerExceptions: exceptions.filter((exception) => exception.severity === 'blocker').length,
      },
      bills, receipts, payments, bankAccounts, statements, reconciliations, exceptions,
      exports: ['bills','cashbook','reconciliations'].map((kind) => ({ kind, href: `/api/finance/cashroom/exports/${kind}` })),
    };
  }

  retainStatementEvidence(user: SessionUser, input: RetainedFinancialEvidenceInput, audit: AuditContext) {
    this.requireCapability(user, 'finance.record_bank_activity');
    if (!this.canReadMatter(user, input.matterId)) throw new BillingCashroomStoreError('NOT_FOUND', 'The evidence matter was not found.');
    const scope = `retain_statement_evidence:${input.sha256}`;
    const replayInput = { ...input, storageKey: undefined };
    const replay = this.replay<{ documentId: string; documentVersionId: string; sha256: string; storageKey: string }>(
      user, input.matterId, scope, input.idempotencyKey, replayInput,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      if (!/^[a-f0-9]{64}$/.test(input.sha256) || !input.storageKey || input.sizeBytes <= 0 ||
        !Number.isSafeInteger(input.sizeBytes)) throw new BillingCashroomStoreError('INVALID_STATE', 'The retained evidence metadata is invalid.');
      const documentId = randomUUID();
      const documentVersionId = randomUUID();
      const at = this.now().toISOString();
      this.database.prepare(`INSERT INTO documents (
        id,firm_id,matter_id,title,category,external_source,external_id,import_batch_id,created_by,created_at
      ) VALUES (?,?,?,?,'Finance - Bank statements',NULL,NULL,NULL,?,?)`).run(
        documentId, user.firmId, input.matterId, input.title, user.id, at,
      );
      this.database.prepare(`INSERT INTO document_versions (
        id,firm_id,document_id,version,original_name,mime_type,size_bytes,sha256,storage_key,uploaded_by,created_at
      ) VALUES (?,?,?,1,?,?,?,?,?,?,?)`).run(documentVersionId, user.firmId, documentId, input.originalName,
        input.mimeType, input.sizeBytes, input.sha256, input.storageKey, user.id, at);
      const response = { documentId, documentVersionId, sha256: input.sha256, storageKey: input.storageKey };
      this.saveReplay(user, input.matterId, scope, documentVersionId, input.idempotencyKey, replayInput, response, at);
      this.appendOperational(user, input.matterId, 'finance.statement_evidence_retained', documentVersionId,
        'Bank statement evidence retained', input.idempotencyKey, at,
        { documentId, documentVersionId, sha256: input.sha256, sizeBytes: input.sizeBytes }, audit,
        'finance_statement_evidence');
      return response;
    });
  }

  getFinancialDocumentFile(
    user: SessionUser,
    input: {
      kind: 'bill' | 'credit_note' | 'receipt' | 'payment' | 'statement' | 'reconciliation';
      recordId: string;
      documentVersionId: string;
      matterId?: string;
    },
  ) {
    if (input.kind === 'payment') {
      if (!hasCapability(user, 'finance.prepare_client_payment') && !hasCapability(user, 'finance.approve_client_payment'))
        throw new BillingCashroomStoreError('FORBIDDEN', 'The payment evidence is not permitted.');
    } else this.requireCapability(user,
      input.kind === 'statement' || input.kind === 'receipt' || input.kind === 'reconciliation'
        ? 'finance.read_firm' : 'finance.read_matter');
    const common = [input.documentVersionId, user.firmId] as const;
    let granted = false;
    if (input.kind === 'bill' && input.matterId) {
      granted = this.canReadMatter(user, input.matterId) && Boolean(this.database.prepare(`SELECT 1 FROM finance_bill_documents
        WHERE bill_id=? AND document_version_id=? AND firm_id=? AND matter_id=?`).get(
        input.recordId, input.documentVersionId, user.firmId, input.matterId,
      ));
    } else if (input.kind === 'credit_note' && input.matterId) {
      granted = this.canReadMatter(user, input.matterId) && Boolean(this.database.prepare(`SELECT 1 FROM finance_credit_note_documents
        WHERE credit_note_id=? AND document_version_id=? AND firm_id=? AND matter_id=?`).get(
        input.recordId, input.documentVersionId, user.firmId, input.matterId,
      ));
    } else if (input.kind === 'receipt') {
      granted = Boolean(this.database.prepare(`SELECT 1 FROM finance_receipts
        WHERE id=? AND evidence_document_version_id=? AND firm_id=?`).get(input.recordId, ...common));
    } else if (input.kind === 'statement') {
      granted = Boolean(this.database.prepare(`SELECT 1 FROM finance_bank_statement_batches
        WHERE id=? AND evidence_document_version_id=? AND firm_id=?`).get(input.recordId, ...common));
    } else if (input.kind === 'payment' && input.matterId) {
      granted = this.canReadMatter(user, input.matterId) && Boolean(this.database.prepare(`SELECT 1 FROM finance_payment_requisitions p
        WHERE p.id=? AND p.firm_id=? AND p.matter_id=? AND (p.beneficiary_evidence_document_version_id=? OR EXISTS (
          SELECT 1 FROM finance_payment_events e WHERE e.payment_id=p.id AND e.firm_id=p.firm_id AND e.matter_id=p.matter_id
          AND e.evidence_document_version_id=?))`).get(input.recordId, user.firmId, input.matterId,
        input.documentVersionId, input.documentVersionId));
    } else if (input.kind === 'reconciliation') {
      granted = Boolean(this.database.prepare(`SELECT 1 FROM finance_reconciliation_items
        WHERE reconciliation_id=? AND evidence_document_version_id=? AND firm_id=?`).get(input.recordId, ...common));
    }
    if (!granted) return null;
    const row = this.database.prepare(`SELECT dv.original_name AS originalName,dv.mime_type AS mimeType,
      dv.size_bytes AS sizeBytes,dv.sha256,dv.storage_key AS storageKey FROM document_versions dv
      WHERE dv.id=? AND dv.firm_id=?`).get(input.documentVersionId, user.firmId) as Row | undefined;
    return row ? { originalName: String(row.originalName), mimeType: String(row.mimeType),
      sizeBytes: Number(row.sizeBytes), sha256: String(row.sha256), storageKey: String(row.storageKey) } : null;
  }

  exportRegister(user: SessionUser, kind: 'bills' | 'cashbook' | 'reconciliations'):
    { csv: string; manifestId: string; sha256: string } {
    this.requireCapability(user, 'finance.export_accounts');
    const escape = (value: unknown) => {
      const raw = String(value ?? '');
      const protectedValue = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
      return /[",\r\n]/.test(protectedValue) ? `"${protectedValue.replaceAll('"', '""')}"` : protectedValue;
    };
    let header: string[];
    let rows: Row[];
    let csv: string;
    if (kind === 'bills') {
      header = ['bill_reference','matter_id','client_party_id','due_on','net_minor','vat_minor','gross_minor','currency','status'];
      rows = this.database.prepare(`SELECT b.bill_reference AS billReference,b.matter_id AS matterId,
        b.client_party_id AS clientPartyId,v.due_on AS dueOn,v.net_minor AS netMinor,v.vat_minor AS vatMinor,
        v.gross_minor AS grossMinor,v.currency,(SELECT e.event_type FROM finance_bill_events e WHERE e.bill_id=b.id
        AND e.firm_id=b.firm_id AND e.matter_id=b.matter_id ORDER BY e.sequence DESC LIMIT 1) AS status
        FROM finance_bills b JOIN finance_bill_versions v ON v.id=(SELECT e.bill_version_id FROM finance_bill_events e
        WHERE e.bill_id=b.id AND e.firm_id=b.firm_id AND e.matter_id=b.matter_id AND e.event_type='issued' LIMIT 1)
        WHERE b.firm_id=? AND b.bill_reference IS NOT NULL ORDER BY b.bill_number`).all(user.firmId) as Row[];
      csv = `${header.join(',')}\n${rows.map((row) => [row.billReference,row.matterId,row.clientPartyId,row.dueOn,row.netMinor,
        row.vatMinor,row.grossMinor,row.currency,row.status].map(escape).join(',')).join('\n')}${rows.length ? '\n' : ''}`;
    } else if (kind === 'cashbook') {
      header = ['accounting_date','journal_id','matter_id','source_kind','source_id','account_code','debit_minor','credit_minor','currency'];
      rows = this.database.prepare(`SELECT j.accounting_date AS accountingDate,j.id AS journalId,j.matter_id AS matterId,
        j.source_kind AS sourceKind,j.source_id AS sourceId,a.code,l.debit_minor AS debitMinor,l.credit_minor AS creditMinor,l.currency
        FROM finance_journals j JOIN finance_journal_lines l ON l.journal_id=j.id AND l.firm_id=j.firm_id AND l.matter_id=j.matter_id
        JOIN finance_accounts a ON a.id=l.account_id AND a.firm_id=l.firm_id WHERE j.firm_id=? AND EXISTS (
          SELECT 1 FROM finance_journal_events e WHERE e.journal_id=j.id AND e.firm_id=j.firm_id AND e.matter_id=j.matter_id
          AND e.event_type='posted') ORDER BY j.accounting_date,j.id,l.line_number`).all(user.firmId) as Row[];
      csv = `${header.join(',')}\n${rows.map((row) => [row.accountingDate,row.journalId,row.matterId,row.sourceKind,row.sourceId,row.code,
        row.debitMinor,row.creditMinor,row.currency].map(escape).join(',')).join('\n')}${rows.length ? '\n' : ''}`;
    } else {
      header = ['reconciliation_id','bank_account_id','statement_closing_on','statement_closing_balance_minor','ledger_cleared_balance_minor','difference_minor','currency','status','next_review_due_on'];
      rows = this.database.prepare(`SELECT r.id,r.bank_account_id AS bankAccountId,r.statement_closing_on AS statementClosingOn,
      r.statement_closing_balance_minor AS statementClosingBalanceMinor,r.ledger_cleared_balance_minor AS ledgerClearedBalanceMinor,
      r.difference_minor AS differenceMinor,r.currency,CASE WHEN s.id IS NOT NULL THEN 'signed_off' WHEN EXISTS (
        SELECT 1 FROM finance_reconciliation_events e WHERE e.reconciliation_id=r.id AND e.firm_id=r.firm_id AND e.event_type='completed'
      ) THEN 'completed' ELSE 'prepared' END AS status,s.next_review_due_on AS nextReviewDueOn
      FROM finance_reconciliations r LEFT JOIN finance_reconciliation_signoffs s ON s.reconciliation_id=r.id AND s.firm_id=r.firm_id
      WHERE r.firm_id=? ORDER BY r.statement_closing_on,r.id`).all(user.firmId) as Row[];
      csv = `${header.join(',')}\n${rows.map((row) => [row.id,row.bankAccountId,row.statementClosingOn,row.statementClosingBalanceMinor,
      row.ledgerClearedBalanceMinor,row.differenceMinor,row.currency,row.status,row.nextReviewDueOn].map(escape).join(',')).join('\n')}${rows.length ? '\n' : ''}`;
    }
    const sha256 = createHash('sha256').update(csv).digest('hex');
    const manifestId = randomUUID();
    this.database.prepare(`INSERT INTO finance_export_manifests
      (id,firm_id,export_kind,filters_json,columns_json,row_count,sha256,generated_by,generated_at)
      VALUES (?, ?, ?, '{}', ?, ?, ?, ?, ?)`).run(manifestId, user.firmId, kind, JSON.stringify(header), rows.length,
      sha256, user.id, this.now().toISOString());
    return { csv, manifestId, sha256 };
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

  private replayFirm<T>(user: SessionUser, scope: string, key: string, input: unknown): T | undefined {
    const row = this.database.prepare(`SELECT input_hash AS inputHash, response_json AS responseJson
      FROM finance_command_receipts WHERE firm_id = ? AND scope_kind = 'firm' AND matter_id IS NULL
      AND command_scope = ? AND idempotency_key = ?`).get(user.firmId, scope, key) as Row | undefined;
    if (!row) return undefined;
    if (String(row.inputHash) !== hash(input)) throw new BillingCashroomStoreError(
      'IDEMPOTENCY_KEY_REUSED', 'The idempotency key was already used with different input.',
    );
    return JSON.parse(String(row.responseJson)) as T;
  }

  private saveFirmReplay(user: SessionUser, scope: string, entityId: string, key: string, input: unknown, response: unknown, at: string): void {
    this.database.prepare(`INSERT INTO finance_command_receipts (
      id, firm_id, matter_id, scope_kind, command_scope, route_entity_id, idempotency_key,
      input_hash, response_json, created_by, created_at
    ) VALUES (?, ?, NULL, 'firm', ?, ?, ?, ?, ?, ?, ?)`).run(
      randomUUID(), user.firmId, scope, entityId, key, hash(input), canonical(response), user.id, at,
    );
  }

  private appendFirmOperational(user: SessionUser, action: string, entityId: string, key: string, at: string, safeAfter: Record<string, unknown>, audit: AuditContext, entityType = 'finance_receipt'): void {
    appendAudit(this.database, { firmId: user.firmId, matterId: null, userId: user.id, action,
      entityType, entityId, after: { entityId, ...safeAfter }, requestId: audit.requestId,
      ipAddress: audit.ipAddress, createdAt: at });
    this.database.prepare(`INSERT INTO finance_firm_events
      (id, firm_id, type, actor_user_id, idempotency_key, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), user.firmId, action, user.id,
      `finance:${action}:${entityId}:${key}`, canonical({ entityId, ...safeAfter }), at);
    this.database.prepare(`INSERT INTO finance_integration_outbox
      (id, firm_id, matter_id, scope_kind, topic, payload_json, status, attempts, available_at, created_at, deduplication_key)
      VALUES (?, ?, NULL, 'firm', ?, ?, 'pending', 0, ?, ?, ?)`).run(randomUUID(), user.firmId, action,
      canonical({ entityId, ...safeAfter }), at, at, `finance:${user.firmId}:${action}:${entityId}:${key}`);
  }

  private appendOperational(user: SessionUser, matterId: string, action: string, entityId: string, title: string, key: string, at: string, safeAfter: Record<string, unknown>, audit: AuditContext, entityType = 'finance_bill'): void {
    appendTimeline(this.database, { firmId: user.firmId, matterId, type: action, title, actorUserId: user.id, occurredAt: at, metadata: { entityType, entityId } });
    appendAudit(this.database, { firmId: user.firmId, matterId, userId: user.id, action, entityType, entityId, after: { entityId, ...safeAfter }, requestId: audit.requestId, ipAddress: audit.ipAddress, createdAt: at });
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
    const receiptPayments = this.database.prepare(`SELECT a.amount_minor AS amountMinor FROM finance_receipt_allocations a
      WHERE a.bill_id=? AND a.firm_id=? AND a.matter_id=? AND a.designation='office' AND a.reverses_allocation_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM finance_receipt_allocations r WHERE r.reverses_allocation_id=a.id AND r.firm_id=a.firm_id)`)
      .all(billId, user.firmId, matterId) as Row[];
    const transfers = this.database.prepare(`SELECT t.amount_minor AS amountMinor FROM finance_client_office_transfers t
      WHERE t.bill_id=? AND t.firm_id=? AND t.matter_id=? AND EXISTS (SELECT 1 FROM finance_transfer_events e
      WHERE e.transfer_id=t.id AND e.firm_id=t.firm_id AND e.matter_id=t.matter_id AND e.event_type='posted')`)
      .all(billId, user.firmId, matterId) as Row[];
    const projected = projectBill({ billId, versions, events,
      payments: [...receiptPayments, ...transfers].map((payment) => ({ amountMinor: Number(payment.amountMinor), posted: true })),
      credits: issuedCredits.map((credit) => ({ grossMinor: Number(credit.grossMinor), issued: true })) });
    const document = this.database.prepare(`SELECT bd.tax_point AS taxPoint, bd.document_version_id AS documentVersionId,
      bd.sha256 FROM finance_bill_documents bd WHERE bd.bill_id = ? AND bd.firm_id = ? AND bd.matter_id = ?`)
      .get(billId, user.firmId, matterId) as Row | undefined;
    const delivered = [...eventRows].reverse().find((event) => event.eventType === 'delivered');
    return { ...projected, paidMinor: projected.allocatedMinor, id: billId, clientPartyId: String(bill.clientPartyId), preparedBy: String(bill.preparedBy),
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
    const receivable = this.activeAccount(user.firmId, 'TRADE-DEBTORS');
    const income = account('income');
    const vat = bill.vatMinor > 0 ? account('vat_control') : null;
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
      insertLine.run(randomUUID(), user.firmId, matterId, journalId, nextLine++,
        this.activeAccount(user.firmId, 'WIP-OFFSET'), consumedWipMinor, 0, 'Release billed WIP offset control');
      insertLine.run(randomUUID(), user.firmId, matterId, journalId, nextLine,
        this.activeAccount(user.firmId, 'WIP-CONTROL'), 0, consumedWipMinor, 'Release consumed approved WIP');
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
        at, { billId, grossMinor: response.grossMinor, currency: 'GBP' }, audit, 'finance_credit_note');
      return response;
    });
  }

  issueCreditNote(user: SessionUser, matterId: string, creditNoteId: string, input: IssueCreditNoteInput, audit: AuditContext) {
    this.requireMatter(user, matterId, 'finance.issue_bill');
    const scope = `issue_credit_note:${creditNoteId}`;
    const replay = this.replay<NonNullable<ReturnType<typeof this.getCreditNote>>>(user, matterId, scope, input.idempotencyKey, input);
    if (replay) return replay;
    let stagedFile: GeneratedBillFile | undefined;
    try {
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
      stagedFile = generated;
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
        input.idempotencyKey, issuedAt, { billId: credit.billId, creditReference: reference, grossMinor: credit.grossMinor, currency: 'GBP' }, audit, 'finance_credit_note');
      return response;
      });
    } catch (error) {
      stagedFile?.discard?.();
      throw error;
    }
  }

  private exactEvidence(firmId: string, versionId: string, matterId?: string): boolean {
    return Boolean(this.database.prepare(`SELECT 1 FROM document_versions dv
      JOIN documents d ON d.id = dv.document_id AND d.firm_id = dv.firm_id
      WHERE dv.id = ? AND dv.firm_id = ? ${matterId ? 'AND d.matter_id = ?' : ''}`)
      .get(...(matterId ? [versionId, firmId, matterId] : [versionId, firmId])));
  }

  private activeAccount(firmId: string, code: string): string {
    const rows = this.database.prepare(`SELECT id FROM finance_accounts WHERE firm_id = ? AND code = ? AND active = 1`)
      .all(firmId, code) as Row[];
    if (rows.length !== 1) throw new BillingCashroomStoreError('INVALID_STATE', `Cashroom requires exactly one active ${code} account.`);
    return String(rows[0]!.id);
  }

  private openPeriod(firmId: string, accountingDate: string): string {
    const rows = this.database.prepare(`SELECT id FROM finance_accounting_periods WHERE firm_id = ? AND status = 'open'
      AND starts_on <= ? AND ends_on >= ?`).all(firmId, accountingDate, accountingDate) as Row[];
    if (rows.length !== 1) throw new BillingCashroomStoreError('INVALID_STATE', 'Cashroom posting requires exactly one open accounting period.');
    return String(rows[0]!.id);
  }

  private postCashJournal(user: SessionUser, matterId: string, sourceId: string, description: string,
    accountingDate: string, preparedBy: string, approvedBy: string, debitAccount: string,
    creditAccount: string, amountMinor: number, at: string): string {
    const journalId = randomUUID();
    this.database.prepare(`INSERT INTO finance_journals
      (id,firm_id,matter_id,period_id,accounting_date,source_kind,source_id,description,currency,reverses_journal_id,prepared_by,prepared_at)
      VALUES (?,?,?,?,?,'other',?,?,'GBP',NULL,?,?)`).run(journalId, user.firmId, matterId,
      this.openPeriod(user.firmId, accountingDate), accountingDate, sourceId, description, preparedBy, at);
    const line = this.database.prepare(`INSERT INTO finance_journal_lines
      (id,firm_id,matter_id,journal_id,line_number,account_id,debit_minor,credit_minor,currency,memo)
      VALUES (?,?,?,?,?,?,?,?,'GBP',?)`);
    line.run(randomUUID(), user.firmId, matterId, journalId, 1, debitAccount, amountMinor, 0, description);
    line.run(randomUUID(), user.firmId, matterId, journalId, 2, creditAccount, 0, amountMinor, description);
    const event = this.database.prepare(`INSERT INTO finance_journal_events
      (id,firm_id,matter_id,journal_id,sequence,event_type,note,occurred_at,recorded_by,recorded_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    event.run(randomUUID(), user.firmId, matterId, journalId, 1, 'prepared', 'Prepared from immutable cashroom evidence.', at, preparedBy, at);
    event.run(randomUUID(), user.firmId, matterId, journalId, 2, 'approved',
      preparedBy === approvedBy ? 'Cashroom allocation explicitly authorised by the recording user.' : 'Cashroom posting independently authorised.',
      at, approvedBy, at);
    event.run(randomUUID(), user.firmId, matterId, journalId, 3, 'posted', 'Balanced cashroom journal posted.', at, user.id, at);
    return journalId;
  }

  getReceipt(user: SessionUser, receiptId: string) {
    this.requireCapability(user, 'finance.read_firm');
    const row = this.database.prepare(`SELECT id, bank_account_id AS bankAccountId, amount_minor AS amountMinor,
      received_on AS receivedOn, payer, reference, evidence_document_version_id AS evidenceDocumentVersionId,
      recorded_by AS recordedBy, recorded_at AS recordedAt FROM finance_receipts WHERE id = ? AND firm_id = ?`)
      .get(receiptId, user.firmId) as Row | undefined;
    if (!row) return null;
    const events = this.database.prepare(`SELECT sequence,event_type AS eventType,note,occurred_at AS occurredAt,
      recorded_by AS recordedBy FROM finance_receipt_events WHERE receipt_id=? AND firm_id=? ORDER BY sequence`)
      .all(receiptId, user.firmId) as Row[];
    const allocations = this.database.prepare(`SELECT id,designation,matter_id AS matterId,client_party_id AS clientPartyId,
      bill_id AS billId,journal_id AS journalId,amount_minor AS amountMinor,cleared,restricted,
      reverses_allocation_id AS reversesAllocationId FROM finance_receipt_allocations WHERE receipt_id=? AND firm_id=?`)
      .all(receiptId, user.firmId) as Row[];
    const reversed = new Set(allocations.filter((allocation) => allocation.reversesAllocationId).map((allocation) => String(allocation.reversesAllocationId)));
    const active = allocations.filter((allocation) => !allocation.reversesAllocationId && !reversed.has(String(allocation.id)));
    return { id: String(row.id), bankAccountId: String(row.bankAccountId), amountMinor: Number(row.amountMinor), currency: 'GBP' as const,
      receivedOn: String(row.receivedOn), payer: String(row.payer), reference: String(row.reference),
      evidenceDocumentVersionId: String(row.evidenceDocumentVersionId), recordedBy: String(row.recordedBy),
      recordedAt: String(row.recordedAt), version: events.length, status: events.at(-1)?.eventType ?? 'recorded',
      allocatedMinor: active.reduce((total, allocation) => total + Number(allocation.amountMinor), 0),
      allocations: allocations.map((allocation) => ({ id: String(allocation.id),
        designation: allocation.designation as 'client' | 'office' | 'suspense',
        matterId: allocation.matterId ? String(allocation.matterId) : null,
        clientPartyId: allocation.clientPartyId ? String(allocation.clientPartyId) : null,
        billId: allocation.billId ? String(allocation.billId) : null,
        journalId: allocation.journalId ? String(allocation.journalId) : null,
        amountMinor: Number(allocation.amountMinor), cleared: Boolean(allocation.cleared),
        restricted: Boolean(allocation.restricted),
        reversesAllocationId: allocation.reversesAllocationId ? String(allocation.reversesAllocationId) : null })), events };
  }

  recordReceipt(user: SessionUser, input: RecordFinanceReceiptInput, audit: AuditContext) {
    this.requireCapability(user, 'finance.record_bank_activity');
    const scope = `record_receipt:${input.bankAccountId}`;
    const replay = this.replayFirm<NonNullable<ReturnType<typeof this.getReceipt>>>(user, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      if (!this.database.prepare(`SELECT 1 FROM finance_bank_accounts WHERE id=? AND firm_id=? AND active=1`)
        .get(input.bankAccountId, user.firmId)) throw new BillingCashroomStoreError('NOT_FOUND', 'The bank account was not found.');
      if (!this.exactEvidence(user.firmId, input.evidenceDocumentVersionId)) throw new BillingCashroomStoreError('INVALID_LINK', 'Exact receipt evidence was not found.');
      if (input.statementLineId && !this.database.prepare(`SELECT 1 FROM finance_bank_statement_lines WHERE id=? AND firm_id=? AND bank_account_id=?`)
        .get(input.statementLineId, user.firmId, input.bankAccountId)) throw new BillingCashroomStoreError('INVALID_LINK', 'The statement line was not found.');
      if (this.database.prepare('SELECT 1 FROM finance_receipts WHERE firm_id=? AND fingerprint=?').get(user.firmId, input.fingerprint)) {
        throw new BillingCashroomStoreError('CONFLICT', 'A receipt with the same evidence fingerprint already exists.');
      }
      const id = randomUUID();
      const at = this.now().toISOString();
      this.database.prepare(`INSERT INTO finance_receipts
        (id,firm_id,bank_account_id,statement_line_id,amount_minor,currency,received_on,payer,reference,
          evidence_document_version_id,fingerprint,recorded_by,recorded_at)
        VALUES (?,?,?,?,?,'GBP',?,?,?,?,?,?,?)`).run(id, user.firmId, input.bankAccountId, input.statementLineId,
        input.amountMinor, input.receivedOn, input.payer, input.reference, input.evidenceDocumentVersionId,
        input.fingerprint, user.id, at);
      this.database.prepare(`INSERT INTO finance_receipt_events
        (id,firm_id,receipt_id,sequence,event_type,note,occurred_at,recorded_by,recorded_at)
        VALUES (?,?,?,1,'recorded','Receipt evidence recorded without posting.',?,?,?)`)
        .run(randomUUID(), user.firmId, id, at, user.id, at);
      const response = this.getReceipt(user, id)!;
      this.saveFirmReplay(user, scope, id, input.idempotencyKey, input, response, at);
      this.appendFirmOperational(user, 'finance.receipt_recorded', id, input.idempotencyKey, at,
        { amountMinor: input.amountMinor, currency: 'GBP', bankAccountId: input.bankAccountId }, audit);
      return response;
    });
  }

  allocateReceipt(user: SessionUser, receiptId: string, input: AllocateFinanceReceiptInput, audit: AuditContext) {
    this.requireCapability(user, 'finance.allocate_money');
    const scope = `allocate_receipt:${receiptId}`;
    const replay = this.replayFirm<NonNullable<ReturnType<typeof this.getReceipt>>>(user, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      const receipt = this.getReceipt(user, receiptId);
      if (!receipt) throw new BillingCashroomStoreError('NOT_FOUND', 'The receipt was not found.');
      if (receipt.version !== input.expectedVersion || receipt.status !== 'recorded') throw new BillingCashroomStoreError('CONFLICT', 'The receipt version or state is stale.');
      const total = input.allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0);
      if (!Number.isSafeInteger(total) || total !== receipt.amountMinor) throw new BillingCashroomStoreError('INVALID_STATE', 'Receipt allocations must equal the exact receipt amount.');
      const bank = this.database.prepare('SELECT designation FROM finance_bank_accounts WHERE id=? AND firm_id=?')
        .get(receipt.bankAccountId, user.firmId) as Row;
      const bankAccount = this.activeAccount(user.firmId, bank.designation === 'client' ? 'CLIENT-BANK' : 'OFFICE-BANK');
      const at = this.now().toISOString();
      input.allocations.forEach((allocation, index) => {
        if (allocation.designation !== 'suspense' && !this.database.prepare(`SELECT 1 FROM parties
          WHERE id=? AND firm_id=? AND matter_id=? AND kind='client'`).get(allocation.clientPartyId, user.firmId, allocation.matterId)) {
          throw new BillingCashroomStoreError('INVALID_LINK', 'The exact matter client was not found.');
        }
        if (allocation.billId && !this.database.prepare(`SELECT 1 FROM finance_bills WHERE id=? AND firm_id=? AND matter_id=? AND client_party_id=?`)
          .get(allocation.billId, user.firmId, allocation.matterId, allocation.clientPartyId)) {
          throw new BillingCashroomStoreError('INVALID_LINK', 'The allocated bill was not found for the exact matter client.');
        }
        const id = randomUUID();
        let journalId: string | null = null;
        if (allocation.designation !== 'suspense') {
          const credit = this.activeAccount(user.firmId, allocation.designation === 'client' ? 'CLIENT-LIABILITY' : 'TRADE-DEBTORS');
          journalId = this.postCashJournal(user, allocation.matterId!, `${receiptId}:${id}`,
            `${allocation.designation} receipt allocation`, receipt.receivedOn, user.id, user.id,
            bankAccount, credit, allocation.amountMinor, at);
        }
        this.database.prepare(`INSERT INTO finance_receipt_allocations
          (id,firm_id,receipt_id,designation,matter_id,client_party_id,bill_id,journal_id,amount_minor,currency,
            cleared,restricted,reverses_allocation_id,allocated_by,allocated_at)
          VALUES (?,?,?,?,?,?,?,?,?,'GBP',?,?,NULL,?,?)`).run(id, user.firmId, receiptId, allocation.designation,
          allocation.matterId, allocation.clientPartyId, allocation.billId, journalId, allocation.amountMinor,
          allocation.cleared ? 1 : 0, allocation.restricted ? 1 : 0, user.id, at);
      });
      const event = this.database.prepare(`INSERT INTO finance_receipt_events
        (id,firm_id,receipt_id,sequence,event_type,note,occurred_at,recorded_by,recorded_at)
        VALUES (?,?,?,?,?,?,?,?,?)`);
      event.run(randomUUID(), user.firmId, receiptId, 2, 'classified', input.note, at, user.id, at);
      event.run(randomUUID(), user.firmId, receiptId, 3, 'allocated', input.note, at, user.id, at);
      const response = this.getReceipt(user, receiptId)!;
      this.saveFirmReplay(user, scope, receiptId, input.idempotencyKey, input, response, at);
      appendAudit(this.database, { firmId: user.firmId, userId: user.id, action: 'finance.receipt_allocated',
        entityType: 'finance_receipt', entityId: receiptId, after: { allocatedMinor: total, currency: 'GBP' },
        requestId: audit.requestId, ipAddress: audit.ipAddress, createdAt: at });
      return response;
    });
  }

  reverseReceiptAllocation(user: SessionUser, receiptId: string, input: ReverseFinanceReceiptAllocationInput, audit: AuditContext) {
    this.requireCapability(user, 'finance.allocate_money');
    const scope = `reverse_receipt_allocation:${receiptId}`;
    const replay = this.replayFirm<NonNullable<ReturnType<typeof this.getReceipt>>>(user, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      const receipt = this.getReceipt(user, receiptId);
      if (!receipt) throw new BillingCashroomStoreError('NOT_FOUND', 'The receipt was not found.');
      if (receipt.version !== input.expectedVersion) throw new BillingCashroomStoreError('CONFLICT', 'The receipt version is stale.');
      const original = receipt.allocations.find((allocation) => allocation.id === input.allocationId && !allocation.reversesAllocationId);
      if (!original || receipt.allocations.some((allocation) => allocation.reversesAllocationId === input.allocationId)) {
        throw new BillingCashroomStoreError('INVALID_STATE', 'Only an active exact receipt allocation can be reversed.');
      }
      const at = this.now().toISOString();
      const reversalId = randomUUID();
      let journalId: string | null = null;
      if (original.designation !== 'suspense') {
        const lines = this.database.prepare(`SELECT account_id AS accountId,debit_minor AS debitMinor,credit_minor AS creditMinor
          FROM finance_journal_lines WHERE journal_id=? AND firm_id=? AND matter_id=? ORDER BY line_number`)
          .all(original.journalId, user.firmId, original.matterId) as Row[];
        const debitOriginal = lines.find((line) => Number(line.debitMinor) > 0);
        const creditOriginal = lines.find((line) => Number(line.creditMinor) > 0);
        if (!debitOriginal || !creditOriginal) throw new BillingCashroomStoreError('INVALID_STATE', 'The original allocation journal is incomplete.');
        journalId = this.postCashJournal(user, String(original.matterId), `${receiptId}:${reversalId}`,
          'Reverse exact receipt allocation', at.slice(0, 10), user.id, user.id,
          String(creditOriginal.accountId), String(debitOriginal.accountId), Number(original.amountMinor), at);
      }
      this.database.prepare(`INSERT INTO finance_receipt_allocations
        (id,firm_id,receipt_id,designation,matter_id,client_party_id,bill_id,journal_id,amount_minor,currency,
          cleared,restricted,reverses_allocation_id,allocated_by,allocated_at)
        VALUES (?,?,?,?,?,?,?,?,?,'GBP',?,?,?,?,?)`).run(reversalId, user.firmId, receiptId, original.designation,
        original.matterId, original.clientPartyId, original.billId, journalId, original.amountMinor,
        original.cleared ? 1 : 0, original.restricted ? 1 : 0, input.allocationId, user.id, at);
      this.database.prepare(`INSERT INTO finance_receipt_events
        (id,firm_id,receipt_id,sequence,event_type,note,occurred_at,recorded_by,recorded_at)
        VALUES (?,?,?,?, 'reversed',?,?,?,?)`).run(randomUUID(), user.firmId, receiptId, receipt.version + 1,
        input.note, at, user.id, at);
      const response = this.getReceipt(user, receiptId)!;
      this.saveFirmReplay(user, scope, receiptId, input.idempotencyKey, input, response, at);
      appendAudit(this.database, { firmId: user.firmId, matterId: original.matterId ? String(original.matterId) : null,
        userId: user.id, action: 'finance.receipt_allocation_reversed', entityType: 'finance_receipt_allocation',
        entityId: input.allocationId, after: { reversalId, amountMinor: original.amountMinor, currency: 'GBP' },
        requestId: audit.requestId, ipAddress: audit.ipAddress, createdAt: at });
      return response;
    });
  }

  getMatterMoney(user: SessionUser, matterId: string, clientPartyId: string) {
    this.requireMatter(user, matterId, 'finance.read_matter');
    const rows = this.database.prepare(`SELECT a.id,a.designation,a.amount_minor AS amountMinor,a.cleared,a.restricted,
      EXISTS(SELECT 1 FROM finance_receipt_allocations r WHERE r.reverses_allocation_id=a.id AND r.firm_id=a.firm_id) AS reversed
      FROM finance_receipt_allocations a WHERE a.firm_id=? AND a.matter_id=? AND a.client_party_id=?
      AND a.reverses_allocation_id IS NULL`).all(user.firmId, matterId, clientPartyId) as Row[];
    const base = projectMatterMoney(rows.map((row) => ({ id: String(row.id), designation: row.designation as 'client' | 'office' | 'suspense',
      amountMinor: Number(row.amountMinor), cleared: Boolean(row.cleared), restricted: Boolean(row.restricted), reversed: Boolean(row.reversed) })));
    const paymentRow = this.database.prepare(`SELECT COALESCE(SUM(p.amount_minor),0) AS amount FROM finance_payment_requisitions p
      WHERE p.firm_id=? AND p.matter_id=? AND p.client_party_id=? AND EXISTS (SELECT 1 FROM finance_payment_events e
      WHERE e.payment_id=p.id AND e.firm_id=p.firm_id AND e.matter_id=p.matter_id AND e.event_type='recorded_external')`)
      .get(user.firmId, matterId, clientPartyId) as Row;
    const transferRow = this.database.prepare(`SELECT COALESCE(SUM(t.amount_minor),0) AS amount FROM finance_client_office_transfers t
      WHERE t.firm_id=? AND t.matter_id=? AND t.client_party_id=? AND EXISTS (SELECT 1 FROM finance_transfer_events e
      WHERE e.transfer_id=t.id AND e.firm_id=t.firm_id AND e.matter_id=t.matter_id AND e.event_type='posted')`)
      .get(user.firmId, matterId, clientPartyId) as Row;
    const pendingPaymentRow = this.database.prepare(`SELECT COALESCE(SUM(p.amount_minor),0) AS amount FROM finance_payment_requisitions p
      WHERE p.firm_id=? AND p.matter_id=? AND p.client_party_id=? AND EXISTS (SELECT 1 FROM finance_payment_events e
      WHERE e.payment_id=p.id AND e.firm_id=p.firm_id AND e.matter_id=p.matter_id AND e.event_type='approved')
      AND NOT EXISTS (SELECT 1 FROM finance_payment_events e WHERE e.payment_id=p.id AND e.firm_id=p.firm_id
        AND e.matter_id=p.matter_id AND e.event_type IN ('recorded_external','rejected','reversed'))`)
      .get(user.firmId, matterId, clientPartyId) as Row;
    const pendingTransferRow = this.database.prepare(`SELECT COALESCE(SUM(t.amount_minor),0) AS amount FROM finance_client_office_transfers t
      WHERE t.firm_id=? AND t.matter_id=? AND t.client_party_id=? AND EXISTS (SELECT 1 FROM finance_transfer_events e
      WHERE e.transfer_id=t.id AND e.firm_id=t.firm_id AND e.matter_id=t.matter_id AND e.event_type='approved')
      AND NOT EXISTS (SELECT 1 FROM finance_transfer_events e WHERE e.transfer_id=t.id AND e.firm_id=t.firm_id
        AND e.matter_id=t.matter_id AND e.event_type IN ('posted','rejected','reversed'))`)
      .get(user.firmId, matterId, clientPartyId) as Row;
    const outgoing = Number(paymentRow.amount) + Number(transferRow.amount);
    const reserved = Number(pendingPaymentRow.amount) + Number(pendingTransferRow.amount);
    const available = base.clientAvailableMinor - outgoing - reserved;
    const held = base.clientHeldMinor - outgoing;
    const cleared = base.clientClearedMinor - outgoing;
    if (![available, held, cleared].every((value) => Number.isSafeInteger(value) && value >= 0)) {
      throw new BillingCashroomStoreError('INVALID_STATE', 'Client-money projection would become negative.');
    }
    return { ...base, clientHeldMinor: held, clientClearedMinor: cleared, clientAvailableMinor: available,
      clientReservedMinor: reserved, officeHeldMinor: base.officeHeldMinor + Number(transferRow.amount) };
  }

  getClientPayment(user: SessionUser, matterId: string, paymentId: string) {
    if (!this.canReadMatter(user, matterId)) return null;
    const row = this.database.prepare(`SELECT id,client_party_id AS clientPartyId,bank_account_id AS bankAccountId,
      amount_minor AS amountMinor,purpose,beneficiary_name AS beneficiaryName,beneficiary_fingerprint AS beneficiaryFingerprint,
      prepared_by AS preparedBy,prepared_at AS preparedAt FROM finance_payment_requisitions
      WHERE id=? AND firm_id=? AND matter_id=?`).get(paymentId, user.firmId, matterId) as Row | undefined;
    if (!row) return null;
    const events = this.database.prepare(`SELECT sequence,event_type AS eventType,note,occurred_at AS occurredAt,
      recorded_by AS recordedBy,evidence_document_version_id AS evidenceDocumentVersionId,journal_id AS journalId
      FROM finance_payment_events WHERE payment_id=? AND firm_id=? AND matter_id=? ORDER BY sequence`)
      .all(paymentId, user.firmId, matterId) as Row[];
    return { id: String(row.id), clientPartyId: String(row.clientPartyId), bankAccountId: String(row.bankAccountId),
      amountMinor: Number(row.amountMinor), purpose: String(row.purpose), beneficiaryName: String(row.beneficiaryName),
      beneficiaryFingerprint: String(row.beneficiaryFingerprint), preparedBy: String(row.preparedBy),
      preparedAt: String(row.preparedAt), currency: 'GBP' as const, version: events.length,
      status: String(events.at(-1)?.eventType ?? 'prepared'), events };
  }

  prepareClientPayment(user: SessionUser, matterId: string, input: PrepareFinanceClientPaymentInput, audit: AuditContext) {
    this.requireMatter(user, matterId, 'finance.prepare_client_payment');
    const scope = `prepare_client_payment:${user.id}`;
    const replay = this.replay<NonNullable<ReturnType<typeof this.getClientPayment>>>(user, matterId, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      if (!this.database.prepare(`SELECT 1 FROM parties WHERE id=? AND firm_id=? AND matter_id=? AND kind='client'`)
        .get(input.clientPartyId, user.firmId, matterId)) throw new BillingCashroomStoreError('INVALID_LINK', 'The exact matter client was not found.');
      if (!this.database.prepare(`SELECT 1 FROM finance_bank_accounts WHERE id=? AND firm_id=? AND designation='client' AND active=1`)
        .get(input.bankAccountId, user.firmId)) throw new BillingCashroomStoreError('INVALID_LINK', 'The active client bank account was not found.');
      if (!this.exactEvidence(user.firmId, input.beneficiaryEvidenceDocumentVersionId, matterId)) throw new BillingCashroomStoreError('INVALID_LINK', 'Exact beneficiary evidence was not found.');
      const id = randomUUID();
      const at = this.now().toISOString();
      this.database.prepare(`INSERT INTO finance_payment_requisitions
        (id,firm_id,matter_id,client_party_id,bank_account_id,amount_minor,currency,purpose,beneficiary_name,
          beneficiary_fingerprint,beneficiary_evidence_document_version_id,requested_payment_method,prepared_by,prepared_at)
        VALUES (?,?,?,?,?,?,'GBP',?,?,?,?,?,?,?)`).run(id, user.firmId, matterId, input.clientPartyId,
        input.bankAccountId, input.amountMinor, input.purpose, input.beneficiaryName, input.beneficiaryFingerprint,
        input.beneficiaryEvidenceDocumentVersionId, input.requestedPaymentMethod, user.id, at);
      this.database.prepare(`INSERT INTO finance_payment_events
        (id,firm_id,matter_id,payment_id,sequence,event_type,evidence_document_version_id,journal_id,note,occurred_at,recorded_by,recorded_at)
        VALUES (?,?,?,?,1,'prepared',?,NULL,?,?,?,?)`).run(randomUUID(), user.firmId, matterId, id,
        input.beneficiaryEvidenceDocumentVersionId, input.purpose, at, user.id, at);
      const prior = this.database.prepare(`SELECT p.beneficiary_fingerprint AS beneficiaryFingerprint
        FROM finance_payment_requisitions p WHERE p.firm_id=? AND p.matter_id=? AND p.client_party_id=? AND p.id<>?
        AND EXISTS (SELECT 1 FROM finance_payment_events e WHERE e.payment_id=p.id AND e.firm_id=p.firm_id
          AND e.matter_id=p.matter_id AND e.event_type='recorded_external') ORDER BY p.prepared_at DESC LIMIT 1`)
        .get(user.firmId, matterId, input.clientPartyId, id) as Row | undefined;
      if (prior && prior.beneficiaryFingerprint !== input.beneficiaryFingerprint) {
        this.database.prepare(`INSERT INTO finance_exceptions
          (id,firm_id,matter_id,exception_kind,severity,source_kind,source_id,safe_summary,amount_minor,currency,raised_at)
          VALUES (?,?,?,'changed_beneficiary','blocker','client_payment',?,
            'Beneficiary details differ from the last externally completed payment and require independent reverification.',?,'GBP',?)`)
          .run(randomUUID(), user.firmId, matterId, id, input.amountMinor, at);
      }
      const response = this.getClientPayment(user, matterId, id)!;
      this.saveReplay(user, matterId, scope, id, input.idempotencyKey, input, response, at);
      this.appendOperational(user, matterId, 'finance.client_payment_prepared', id, 'Client payment prepared',
        input.idempotencyKey, at, { amountMinor: input.amountMinor, currency: 'GBP' }, audit, 'finance_payment');
      return response;
    });
  }

  approveClientPayment(user: SessionUser, matterId: string, paymentId: string, input: ApproveFinanceClientPaymentInput, audit: AuditContext) {
    this.requireMatter(user, matterId, 'finance.approve_client_payment');
    const scope = `approve_client_payment:${paymentId}`;
    const replay = this.replay<NonNullable<ReturnType<typeof this.getClientPayment>>>(user, matterId, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      const payment = this.getClientPayment(user, matterId, paymentId);
      if (!payment) throw new BillingCashroomStoreError('NOT_FOUND', 'The client payment was not found.');
      if (payment.preparedBy === user.id) throw new BillingCashroomStoreError('INDEPENDENCE_REQUIRED', 'Client-payment approval requires another person.');
      if (payment.version !== input.expectedVersion || payment.status !== 'prepared') throw new BillingCashroomStoreError('CONFLICT', 'The client-payment version or state is stale.');
      if (!this.exactEvidence(user.firmId, input.beneficiaryEvidenceDocumentVersionId, matterId)) throw new BillingCashroomStoreError('INVALID_LINK', 'Exact beneficiary verification evidence was not found.');
      const balance = this.getMatterMoney(user, matterId, String(payment.clientPartyId));
      if (Number(payment.amountMinor) > balance.clientAvailableMinor) throw new BillingCashroomStoreError('INVALID_STATE', 'The payment exceeds cleared unrestricted funds for this exact matter client.');
      const approvedAt = isoTimestamp(input.approvedAt, 'Payment approval timestamp');
      if (Date.parse(approvedAt) <= Date.parse(String(payment.preparedAt))) throw new BillingCashroomStoreError('INVALID_STATE', 'Payment approval must occur after preparation.');
      const event = this.database.prepare(`INSERT INTO finance_payment_events
        (id,firm_id,matter_id,payment_id,sequence,event_type,evidence_document_version_id,journal_id,note,occurred_at,recorded_by,recorded_at)
        VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?)`);
      event.run(randomUUID(), user.firmId, matterId, paymentId, 2, 'beneficiary_verified', input.beneficiaryEvidenceDocumentVersionId,
        input.note, approvedAt, user.id, this.now().toISOString());
      event.run(randomUUID(), user.firmId, matterId, paymentId, 3, 'approved', input.beneficiaryEvidenceDocumentVersionId,
        input.note, approvedAt, user.id, this.now().toISOString());
      const response = this.getClientPayment(user, matterId, paymentId)!;
      this.saveReplay(user, matterId, scope, paymentId, input.idempotencyKey, input, response, this.now().toISOString());
      this.appendOperational(user, matterId, 'finance.client_payment_approved', paymentId, 'Client payment approved',
        input.idempotencyKey, approvedAt, { amountMinor: payment.amountMinor, currency: 'GBP' }, audit, 'finance_payment');
      return response;
    });
  }

  recordClientPayment(user: SessionUser, matterId: string, paymentId: string, input: RecordFinanceClientPaymentInput, audit: AuditContext) {
    this.requireMatter(user, matterId, 'finance.post_cashroom');
    const scope = `record_client_payment:${paymentId}`;
    const replay = this.replay<NonNullable<ReturnType<typeof this.getClientPayment>>>(user, matterId, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      const payment = this.getClientPayment(user, matterId, paymentId);
      if (!payment) throw new BillingCashroomStoreError('NOT_FOUND', 'The client payment was not found.');
      const approver = payment.events.find((event) => event.eventType === 'approved');
      if (!approver || approver.recordedBy === user.id) throw new BillingCashroomStoreError('INDEPENDENCE_REQUIRED', 'Payment recording requires a person other than the approver.');
      if (payment.version !== input.expectedVersion || payment.status !== 'approved') throw new BillingCashroomStoreError('CONFLICT', 'The client-payment version or state is stale.');
      if (!this.exactEvidence(user.firmId, input.evidenceDocumentVersionId, matterId)) throw new BillingCashroomStoreError('INVALID_LINK', 'Exact external payment evidence was not found.');
      const balance = this.getMatterMoney(user, matterId, String(payment.clientPartyId));
      if (Number(payment.amountMinor) > balance.clientAvailableMinor + Number(payment.amountMinor)) throw new BillingCashroomStoreError('INVALID_STATE', 'The payment exceeds current cleared unrestricted funds.');
      const at = isoTimestamp(input.completedAt, 'External payment timestamp');
      if (Date.parse(at) <= Date.parse(String(approver.occurredAt))) throw new BillingCashroomStoreError('INVALID_STATE', 'External payment completion must occur after approval.');
      const journalId = this.postCashJournal(user, matterId, paymentId, 'Externally completed client payment', at.slice(0, 10),
        String(payment.preparedBy), String(approver.recordedBy), this.activeAccount(user.firmId, 'CLIENT-LIABILITY'),
        this.activeAccount(user.firmId, 'CLIENT-BANK'), Number(payment.amountMinor), at);
      this.database.prepare(`INSERT INTO finance_payment_events
        (id,firm_id,matter_id,payment_id,sequence,event_type,evidence_document_version_id,journal_id,note,occurred_at,recorded_by,recorded_at)
        VALUES (?,?,?,?,?,'recorded_external',?,?,?,?,?,?)`).run(randomUUID(), user.firmId, matterId, paymentId,
        payment.version + 1, input.evidenceDocumentVersionId, journalId, input.note, at, user.id, this.now().toISOString());
      const response = this.getClientPayment(user, matterId, paymentId)!;
      this.saveReplay(user, matterId, scope, paymentId, input.idempotencyKey, input, response, this.now().toISOString());
      this.appendOperational(user, matterId, 'finance.client_payment_recorded_external', paymentId, 'External client payment recorded',
        input.idempotencyKey, at, { amountMinor: payment.amountMinor, currency: 'GBP', evidenceDocumentVersionId: input.evidenceDocumentVersionId }, audit, 'finance_payment');
      return response;
    });
  }

  getClientOfficeTransfer(user: SessionUser, matterId: string, transferId: string) {
    if (!this.canReadMatter(user, matterId)) return null;
    const row = this.database.prepare(`SELECT id,client_party_id AS clientPartyId,bill_id AS billId,amount_minor AS amountMinor,
      prepared_by AS preparedBy,prepared_at AS preparedAt FROM finance_client_office_transfers
      WHERE id=? AND firm_id=? AND matter_id=?`).get(transferId, user.firmId, matterId) as Row | undefined;
    if (!row) return null;
    const events = this.database.prepare(`SELECT sequence,event_type AS eventType,note,occurred_at AS occurredAt,
      recorded_by AS recordedBy,client_journal_id AS clientJournalId,office_journal_id AS officeJournalId
      FROM finance_transfer_events WHERE transfer_id=? AND firm_id=? AND matter_id=? ORDER BY sequence`)
      .all(transferId, user.firmId, matterId) as Row[];
    return { id: String(row.id), clientPartyId: String(row.clientPartyId), billId: String(row.billId),
      amountMinor: Number(row.amountMinor), preparedBy: String(row.preparedBy), preparedAt: String(row.preparedAt),
      currency: 'GBP' as const, version: events.length, status: String(events.at(-1)?.eventType ?? 'prepared'), events };
  }

  prepareClientOfficeTransfer(user: SessionUser, matterId: string, input: PrepareFinanceClientOfficeTransferInput, audit: AuditContext) {
    this.requireMatter(user, matterId, 'finance.prepare_client_payment');
    const scope = `prepare_client_office_transfer:${user.id}`;
    const replay = this.replay<NonNullable<ReturnType<typeof this.getClientOfficeTransfer>>>(user, matterId, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      const bill = this.getBill(user, matterId, input.billId);
      if (!bill || !['delivered', 'part_paid'].includes(bill.status) || bill.clientPartyId !== input.clientPartyId) {
        throw new BillingCashroomStoreError('INVALID_LINK', 'A delivered bill for the exact matter client was not found.');
      }
      const balance = this.getMatterMoney(user, matterId, input.clientPartyId);
      if (input.amountMinor > Math.min(balance.clientAvailableMinor, bill.outstandingMinor)) {
        throw new BillingCashroomStoreError('INVALID_STATE', 'The transfer exceeds the delivered bill balance or exact available client funds.');
      }
      const id = randomUUID();
      const at = this.now().toISOString();
      this.database.prepare(`INSERT INTO finance_client_office_transfers
        (id,firm_id,matter_id,client_party_id,bill_id,amount_minor,currency,prepared_by,prepared_at)
        VALUES (?,?,?,?,?,?,'GBP',?,?)`).run(id, user.firmId, matterId, input.clientPartyId, input.billId, input.amountMinor, user.id, at);
      this.database.prepare(`INSERT INTO finance_transfer_events
        (id,firm_id,matter_id,transfer_id,sequence,event_type,client_journal_id,office_journal_id,note,occurred_at,recorded_by,recorded_at)
        VALUES (?,?,?,?,1,'prepared',NULL,NULL,?,?,?,?)`).run(randomUUID(), user.firmId, matterId, id, input.note, at, user.id, at);
      const response = this.getClientOfficeTransfer(user, matterId, id)!;
      this.saveReplay(user, matterId, scope, id, input.idempotencyKey, input, response, at);
      this.appendOperational(user, matterId, 'finance.client_office_transfer_prepared', id, 'Client-to-office transfer prepared',
        input.idempotencyKey, at, { billId: input.billId, amountMinor: input.amountMinor, currency: 'GBP' }, audit, 'finance_transfer');
      return response;
    });
  }

  approveClientOfficeTransfer(user: SessionUser, matterId: string, transferId: string, input: ApproveFinanceClientOfficeTransferInput, audit: AuditContext) {
    this.requireMatter(user, matterId, 'finance.approve_client_payment');
    const scope = `approve_client_office_transfer:${transferId}`;
    const replay = this.replay<NonNullable<ReturnType<typeof this.getClientOfficeTransfer>>>(user, matterId, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      const transfer = this.getClientOfficeTransfer(user, matterId, transferId);
      if (!transfer) throw new BillingCashroomStoreError('NOT_FOUND', 'The transfer was not found.');
      if (transfer.preparedBy === user.id) throw new BillingCashroomStoreError('INDEPENDENCE_REQUIRED', 'Transfer approval requires another person.');
      if (transfer.version !== input.expectedVersion || transfer.status !== 'prepared') throw new BillingCashroomStoreError('CONFLICT', 'The transfer version or state is stale.');
      const bill = this.getBill(user, matterId, String(transfer.billId));
      const balance = this.getMatterMoney(user, matterId, String(transfer.clientPartyId));
      if (!bill || !['delivered', 'part_paid'].includes(bill.status) || Number(transfer.amountMinor) > Math.min(balance.clientAvailableMinor, bill.outstandingMinor)) {
        throw new BillingCashroomStoreError('INVALID_STATE', 'The transfer no longer fits the delivered bill or exact available client funds.');
      }
      const at = isoTimestamp(input.approvedAt, 'Transfer approval timestamp');
      if (Date.parse(at) <= Date.parse(String(transfer.preparedAt))) throw new BillingCashroomStoreError('INVALID_STATE', 'Transfer approval must occur after preparation.');
      this.database.prepare(`INSERT INTO finance_transfer_events
        (id,firm_id,matter_id,transfer_id,sequence,event_type,client_journal_id,office_journal_id,note,occurred_at,recorded_by,recorded_at)
        VALUES (?,?,?,?,2,'approved',NULL,NULL,?,?,?,?)`).run(randomUUID(), user.firmId, matterId, transferId, input.note, at, user.id, this.now().toISOString());
      const response = this.getClientOfficeTransfer(user, matterId, transferId)!;
      this.saveReplay(user, matterId, scope, transferId, input.idempotencyKey, input, response, this.now().toISOString());
      this.appendOperational(user, matterId, 'finance.client_office_transfer_approved', transferId, 'Client-to-office transfer approved',
        input.idempotencyKey, at, { billId: transfer.billId, amountMinor: transfer.amountMinor, currency: 'GBP' }, audit, 'finance_transfer');
      return response;
    });
  }

  postClientOfficeTransfer(user: SessionUser, matterId: string, transferId: string, input: PostFinanceClientOfficeTransferInput, audit: AuditContext) {
    this.requireMatter(user, matterId, 'finance.post_cashroom');
    const scope = `post_client_office_transfer:${transferId}`;
    const replay = this.replay<NonNullable<ReturnType<typeof this.getClientOfficeTransfer>>>(user, matterId, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      const transfer = this.getClientOfficeTransfer(user, matterId, transferId);
      if (!transfer) throw new BillingCashroomStoreError('NOT_FOUND', 'The transfer was not found.');
      const approval = transfer.events.find((event) => event.eventType === 'approved');
      if (!approval || approval.recordedBy === user.id) throw new BillingCashroomStoreError('INDEPENDENCE_REQUIRED', 'Transfer posting requires a person other than the approver.');
      if (transfer.version !== input.expectedVersion || transfer.status !== 'approved') throw new BillingCashroomStoreError('CONFLICT', 'The transfer version or state is stale.');
      const bill = this.getBill(user, matterId, String(transfer.billId));
      const balance = this.getMatterMoney(user, matterId, String(transfer.clientPartyId));
      if (!bill || Number(transfer.amountMinor) > Math.min(balance.clientAvailableMinor + Number(transfer.amountMinor), bill.outstandingMinor)) {
        throw new BillingCashroomStoreError('INVALID_STATE', 'The transfer no longer fits the bill or exact available client funds.');
      }
      const at = isoTimestamp(input.postedAt, 'Transfer posting timestamp');
      if (Date.parse(at) <= Date.parse(String(approval.occurredAt))) throw new BillingCashroomStoreError('INVALID_STATE', 'Transfer posting must occur after approval.');
      const clientJournalId = this.postCashJournal(user, matterId, `${transferId}:client`, 'Client side of bill transfer',
        at.slice(0, 10), String(transfer.preparedBy), String(approval.recordedBy), this.activeAccount(user.firmId, 'CLIENT-LIABILITY'),
        this.activeAccount(user.firmId, 'CLIENT-BANK'), Number(transfer.amountMinor), at);
      const officeJournalId = this.postCashJournal(user, matterId, `${transferId}:office`, 'Office side of bill transfer',
        at.slice(0, 10), String(transfer.preparedBy), String(approval.recordedBy), this.activeAccount(user.firmId, 'OFFICE-BANK'),
        this.activeAccount(user.firmId, 'TRADE-DEBTORS'), Number(transfer.amountMinor), at);
      this.database.prepare(`INSERT INTO finance_transfer_events
        (id,firm_id,matter_id,transfer_id,sequence,event_type,client_journal_id,office_journal_id,note,occurred_at,recorded_by,recorded_at)
        VALUES (?,?,?,?,3,'posted',?,?,?,?,?,?)`).run(randomUUID(), user.firmId, matterId, transferId,
        clientJournalId, officeJournalId, 'Linked client and office journals posted after final sufficiency recheck.', at, user.id, this.now().toISOString());
      const response = this.getClientOfficeTransfer(user, matterId, transferId)!;
      this.saveReplay(user, matterId, scope, transferId, input.idempotencyKey, input, response, this.now().toISOString());
      this.appendOperational(user, matterId, 'finance.client_office_transfer_posted', transferId, 'Client-to-office transfer posted',
        input.idempotencyKey, at, { billId: transfer.billId, amountMinor: transfer.amountMinor, currency: 'GBP' }, audit, 'finance_transfer');
      return response;
    });
  }

  getBankStatementBatch(user: SessionUser, batchId: string) {
    this.requireCapability(user, 'finance.read_firm');
    const row = this.database.prepare(`SELECT id,bank_account_id AS bankAccountId,source,statement_from AS statementFrom,
      statement_to AS statementTo,opening_balance_minor AS openingBalanceMinor,closing_balance_minor AS closingBalanceMinor,
      evidence_document_version_id AS evidenceDocumentVersionId,raw_checksum AS rawChecksum,imported_by AS importedBy,
      imported_at AS importedAt FROM finance_bank_statement_batches WHERE id=? AND firm_id=?`)
      .get(batchId, user.firmId) as Row | undefined;
    if (!row) return null;
    const lines = this.database.prepare(`SELECT id,line_number AS lineNumber,provider_line_id AS providerLineId,
      transaction_date AS transactionDate,value_date AS valueDate,amount_minor AS amountMinor,reference,
      payer_payee AS payerPayee,raw_line_hash AS rawLineHash FROM finance_bank_statement_lines
      WHERE batch_id=? AND firm_id=? ORDER BY line_number`).all(batchId, user.firmId) as Row[];
    return { id: String(row.id), bankAccountId: String(row.bankAccountId), source: String(row.source),
      statementFrom: String(row.statementFrom), statementTo: String(row.statementTo),
      openingBalanceMinor: Number(row.openingBalanceMinor), closingBalanceMinor: Number(row.closingBalanceMinor),
      currency: 'GBP' as const, evidenceDocumentVersionId: String(row.evidenceDocumentVersionId),
      rawChecksum: String(row.rawChecksum), importedBy: String(row.importedBy), importedAt: String(row.importedAt),
      lineCount: lines.length, lines: lines.map((line) => ({ id: String(line.id), lineNumber: Number(line.lineNumber),
        providerLineId: line.providerLineId ? String(line.providerLineId) : null, transactionDate: String(line.transactionDate),
        valueDate: line.valueDate ? String(line.valueDate) : null, amountMinor: Number(line.amountMinor),
        reference: String(line.reference), payerPayee: String(line.payerPayee), rawLineHash: String(line.rawLineHash) })) };
  }

  importBankStatement(user: SessionUser, input: ImportFinanceBankStatementInput, audit: AuditContext) {
    this.requireCapability(user, 'finance.record_bank_activity');
    const scope = `import_bank_statement:${input.bankAccountId}`;
    const replay = this.replayFirm<NonNullable<ReturnType<typeof this.getBankStatementBatch>>>(user, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      if (!this.database.prepare(`SELECT 1 FROM finance_bank_accounts WHERE id=? AND firm_id=? AND active=1 AND currency='GBP'`)
        .get(input.bankAccountId, user.firmId)) throw new BillingCashroomStoreError('NOT_FOUND', 'The bank account was not found.');
      if (!this.exactEvidence(user.firmId, input.evidenceDocumentVersionId)) throw new BillingCashroomStoreError('INVALID_LINK', 'Exact statement evidence was not found.');
      if (input.statementTo < input.statementFrom) throw new BillingCashroomStoreError('INVALID_STATE', 'The statement closing date cannot precede its opening date.');
      if (this.database.prepare(`SELECT 1 FROM finance_bank_statement_batches WHERE firm_id=? AND bank_account_id=? AND raw_checksum=?`)
        .get(user.firmId, input.bankAccountId, input.rawChecksum)) throw new BillingCashroomStoreError('CONFLICT', 'This exact statement evidence was already imported.');
      const lineNumbers = new Set<number>();
      const providerIds = new Set<string>();
      const rawHashes = new Set<string>();
      let movementMinor = 0;
      for (const line of input.lines) {
        if (line.transactionDate < input.statementFrom || line.transactionDate > input.statementTo) {
          throw new BillingCashroomStoreError('INVALID_STATE', 'Every statement line must fall within the exact statement period.');
        }
        movementMinor += line.amountMinor;
        if (!Number.isSafeInteger(movementMinor)) throw new BillingCashroomStoreError('INVALID_STATE', 'Statement movements exceed safe integer money limits.');
        if (lineNumbers.has(line.lineNumber) || rawHashes.has(line.rawLineHash) || (line.providerLineId && providerIds.has(line.providerLineId))) {
          throw new BillingCashroomStoreError('CONFLICT', 'The statement contains a duplicate line.');
        }
        lineNumbers.add(line.lineNumber); rawHashes.add(line.rawLineHash);
        if (line.providerLineId) providerIds.add(line.providerLineId);
        const existing = this.database.prepare(`SELECT 1 FROM finance_bank_statement_lines WHERE firm_id=? AND bank_account_id=?
          AND (raw_line_hash=? OR (? IS NOT NULL AND provider_line_id=?))`).get(user.firmId, input.bankAccountId,
          line.rawLineHash, line.providerLineId, line.providerLineId);
        if (existing) throw new BillingCashroomStoreError('CONFLICT', 'A statement line with the same provider identity or raw evidence already exists.');
      }
      const derivedClosingMinor = input.openingBalanceMinor + movementMinor;
      if (!Number.isSafeInteger(derivedClosingMinor) || derivedClosingMinor !== input.closingBalanceMinor) {
        throw new BillingCashroomStoreError('INVALID_STATE', 'Opening balance plus exact statement movements must equal the closing balance.');
      }
      const id = randomUUID();
      const at = this.now().toISOString();
      this.database.prepare(`INSERT INTO finance_bank_statement_batches
        (id,firm_id,bank_account_id,source,statement_from,statement_to,opening_balance_minor,closing_balance_minor,
          currency,evidence_document_version_id,raw_checksum,imported_by,imported_at)
        VALUES (?,?,?,'csv',?,?,?,?,'GBP',?,?,?,?)`).run(id, user.firmId, input.bankAccountId,
        input.statementFrom, input.statementTo, input.openingBalanceMinor, input.closingBalanceMinor,
        input.evidenceDocumentVersionId, input.rawChecksum, user.id, at);
      const insert = this.database.prepare(`INSERT INTO finance_bank_statement_lines
        (id,firm_id,bank_account_id,batch_id,line_number,provider_line_id,transaction_date,value_date,amount_minor,
          currency,reference,payer_payee,raw_line_hash) VALUES (?,?,?,?,?,?,?,?,?,'GBP',?,?,?)`);
      for (const line of input.lines) insert.run(randomUUID(), user.firmId, input.bankAccountId, id, line.lineNumber,
        line.providerLineId, line.transactionDate, line.valueDate, line.amountMinor, line.reference, line.payerPayee, line.rawLineHash);
      const response = this.getBankStatementBatch(user, id)!;
      this.saveFirmReplay(user, scope, id, input.idempotencyKey, input, response, at);
      this.appendFirmOperational(user, 'finance.bank_statement_imported', id, input.idempotencyKey, at,
        { bankAccountId: input.bankAccountId, statementTo: input.statementTo, lineCount: input.lines.length,
          closingBalanceMinor: input.closingBalanceMinor, currency: 'GBP', rawChecksum: input.rawChecksum }, audit, 'finance_bank_statement_batch');
      return response;
    });
  }

  getReconciliation(user: SessionUser, reconciliationId: string) {
    this.requireCapability(user, 'finance.read_firm');
    const row = this.database.prepare(`SELECT id,bank_account_id AS bankAccountId,statement_batch_id AS statementBatchId,
      statement_closing_on AS statementClosingOn,statement_closing_balance_minor AS statementClosingBalanceMinor,
      ledger_cleared_balance_minor AS ledgerClearedBalanceMinor,outstanding_lodgements_minor AS outstandingLodgementsMinor,
      unpresented_payments_minor AS unpresentedPaymentsMinor,documented_adjustments_minor AS documentedAdjustmentsMinor,
      difference_minor AS differenceMinor,prepared_by AS preparedBy,prepared_at AS preparedAt
      FROM finance_reconciliations WHERE id=? AND firm_id=?`).get(reconciliationId, user.firmId) as Row | undefined;
    if (!row) return null;
    const events = this.database.prepare(`SELECT sequence,event_type AS eventType,note,occurred_at AS occurredAt,
      recorded_by AS recordedBy FROM finance_reconciliation_events WHERE reconciliation_id=? AND firm_id=? ORDER BY sequence`)
      .all(reconciliationId, user.firmId) as Row[];
    const items = this.database.prepare(`SELECT id,item_kind AS itemKind,statement_line_id AS statementLineId,
      journal_id AS journalId,amount_minor AS amountMinor,evidence_document_version_id AS evidenceDocumentVersionId,
      explanation,created_by AS createdBy,created_at AS createdAt FROM finance_reconciliation_items
      WHERE reconciliation_id=? AND firm_id=? ORDER BY created_at,id`).all(reconciliationId, user.firmId) as Row[];
    const signoff = this.database.prepare(`SELECT signed_off_by AS signedOffBy,signed_off_at AS signedOffAt,note,
      next_review_due_on AS nextReviewDueOn,calculation_snapshot_json AS calculationSnapshotJson
      FROM finance_reconciliation_signoffs WHERE reconciliation_id=? AND firm_id=?`).get(reconciliationId, user.firmId) as Row | undefined;
    const completed = events.some((event) => event.eventType === 'completed');
    return { id: String(row.id), bankAccountId: String(row.bankAccountId), statementBatchId: String(row.statementBatchId),
      statementClosingOn: String(row.statementClosingOn), statementClosingBalanceMinor: Number(row.statementClosingBalanceMinor),
      ledgerClearedBalanceMinor: Number(row.ledgerClearedBalanceMinor), outstandingLodgementsMinor: Number(row.outstandingLodgementsMinor),
      unpresentedPaymentsMinor: Number(row.unpresentedPaymentsMinor), documentedAdjustmentsMinor: Number(row.documentedAdjustmentsMinor),
      differenceMinor: Number(row.differenceMinor), currency: 'GBP' as const, preparedBy: String(row.preparedBy),
      preparedAt: String(row.preparedAt), version: events.length, status: signoff ? 'signed_off' : completed ? 'completed' : 'prepared',
      nextReviewDueOn: signoff ? String(signoff.nextReviewDueOn) : null,
      signoff: signoff ? { signedOffBy: String(signoff.signedOffBy), signedOffAt: String(signoff.signedOffAt), note: String(signoff.note),
        calculationSnapshot: JSON.parse(String(signoff.calculationSnapshotJson)) as unknown } : null,
      items: items.map((item) => ({ id: String(item.id), itemKind: String(item.itemKind),
        statementLineId: item.statementLineId ? String(item.statementLineId) : null,
        journalId: item.journalId ? String(item.journalId) : null, amountMinor: Number(item.amountMinor),
        evidenceDocumentVersionId: item.evidenceDocumentVersionId ? String(item.evidenceDocumentVersionId) : null,
        explanation: String(item.explanation), createdBy: String(item.createdBy), createdAt: String(item.createdAt) })), events };
  }

  prepareReconciliation(user: SessionUser, input: PrepareReconciliationInput, audit: AuditContext) {
    this.requireCapability(user, 'finance.prepare_reconciliation');
    const scope = `prepare_reconciliation:${input.bankAccountId}`;
    const replay = this.replayFirm<NonNullable<ReturnType<typeof this.getReconciliation>>>(user, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      const batch = this.getBankStatementBatch(user, input.statementBatchId);
      if (!batch || batch.bankAccountId !== input.bankAccountId) throw new BillingCashroomStoreError('NOT_FOUND', 'The exact statement batch was not found for this bank account.');
      if (this.database.prepare(`SELECT 1 FROM finance_reconciliations WHERE firm_id=? AND bank_account_id=? AND statement_batch_id=?`)
        .get(user.firmId, input.bankAccountId, input.statementBatchId)) throw new BillingCashroomStoreError('CONFLICT', 'This statement batch already has a reconciliation.');
      const ledger = this.database.prepare(`SELECT COALESCE(SUM(l.debit_minor-l.credit_minor),0) AS balanceMinor
        FROM finance_bank_accounts b JOIN finance_journal_lines l ON l.account_id=b.ledger_account_id AND l.firm_id=b.firm_id
        JOIN finance_journals j ON j.id=l.journal_id AND j.firm_id=l.firm_id AND j.matter_id=l.matter_id
        WHERE b.id=? AND b.firm_id=? AND j.accounting_date<=? AND EXISTS (
          SELECT 1 FROM finance_journal_events e WHERE e.journal_id=j.id AND e.firm_id=j.firm_id
          AND e.matter_id=j.matter_id AND e.event_type='posted')`).get(input.bankAccountId, user.firmId, batch.statementTo) as Row;
      const derivedLedgerBalanceMinor = Number(ledger.balanceMinor);
      if (!Number.isSafeInteger(derivedLedgerBalanceMinor) || derivedLedgerBalanceMinor !== input.ledgerClearedBalanceMinor) {
        throw new BillingCashroomStoreError('CONFLICT', 'The supplied ledger balance no longer matches the exact posted ledger at the statement closing date.');
      }
      let calculation;
      try {
        calculation = calculateReconciliation({ statementClosingBalanceMinor: batch.closingBalanceMinor,
          ledgerClearedBalanceMinor: derivedLedgerBalanceMinor, outstandingLodgementsMinor: input.outstandingLodgementsMinor,
          unpresentedPaymentsMinor: input.unpresentedPaymentsMinor, documentedAdjustmentsMinor: input.documentedAdjustmentsMinor });
      } catch (error) { throw new BillingCashroomStoreError('INVALID_STATE', error instanceof Error ? error.message : 'The reconciliation calculation is invalid.'); }
      const id = randomUUID();
      const at = this.now().toISOString();
      this.database.prepare(`INSERT INTO finance_reconciliations
        (id,firm_id,bank_account_id,statement_batch_id,statement_closing_on,statement_closing_balance_minor,
          ledger_cleared_balance_minor,outstanding_lodgements_minor,unpresented_payments_minor,documented_adjustments_minor,
          difference_minor,currency,prepared_by,prepared_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'GBP',?,?)`)
        .run(id, user.firmId, input.bankAccountId, input.statementBatchId, batch.statementTo, batch.closingBalanceMinor,
          derivedLedgerBalanceMinor, input.outstandingLodgementsMinor, input.unpresentedPaymentsMinor,
          input.documentedAdjustmentsMinor, calculation.differenceMinor, user.id, at);
      const lineIds = new Set(batch.lines.map((line) => line.id));
      const insertItem = this.database.prepare(`INSERT INTO finance_reconciliation_items
        (id,firm_id,reconciliation_id,item_kind,statement_line_id,journal_id,amount_minor,evidence_document_version_id,
          explanation,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
      for (const item of input.items) {
        if (!Number.isSafeInteger(item.amountMinor) || item.amountMinor === 0 || (item.statementLineId && !lineIds.has(item.statementLineId))) {
          throw new BillingCashroomStoreError('INVALID_LINK', 'A reconciliation item does not belong to the exact statement snapshot.');
        }
        if (item.journalId && !this.database.prepare(`SELECT 1 FROM finance_journals WHERE id=? AND firm_id=?`).get(item.journalId, user.firmId)) {
          throw new BillingCashroomStoreError('INVALID_LINK', 'A reconciliation journal was not found.');
        }
        if (item.evidenceDocumentVersionId && !this.exactEvidence(user.firmId, item.evidenceDocumentVersionId)) {
          throw new BillingCashroomStoreError('INVALID_LINK', 'Exact reconciliation adjustment evidence was not found.');
        }
        insertItem.run(randomUUID(), user.firmId, id, item.itemKind, item.statementLineId, item.journalId,
          item.amountMinor, item.evidenceDocumentVersionId, item.explanation, user.id, at);
      }
      this.database.prepare(`INSERT INTO finance_reconciliation_events
        (id,firm_id,reconciliation_id,sequence,event_type,note,occurred_at,recorded_by,recorded_at)
        VALUES (?,?,?,1,'prepared',?,?,?,?)`).run(randomUUID(), user.firmId, id, input.note, at, user.id, at);
      const response = this.getReconciliation(user, id)!;
      this.saveFirmReplay(user, scope, id, input.idempotencyKey, input, response, at);
      this.appendFirmOperational(user, 'finance.reconciliation_prepared', id, input.idempotencyKey, at,
        { bankAccountId: input.bankAccountId, statementBatchId: input.statementBatchId,
          differenceMinor: calculation.differenceMinor, currency: 'GBP' }, audit, 'finance_reconciliation');
      return response;
    });
  }

  decideReconciliationMatch(user: SessionUser, reconciliationId: string, input: DecideReconciliationMatchInput, audit: AuditContext) {
    this.requireCapability(user, 'finance.prepare_reconciliation');
    const scope = `decide_reconciliation_match:${reconciliationId}:${input.statementLineId}`;
    const replay = this.replayFirm<NonNullable<ReturnType<typeof this.getReconciliation>>>(user, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      const reconciliation = this.getReconciliation(user, reconciliationId);
      if (!reconciliation) throw new BillingCashroomStoreError('NOT_FOUND', 'The reconciliation was not found.');
      if (reconciliation.version !== input.expectedVersion || reconciliation.status !== 'prepared') {
        throw new BillingCashroomStoreError('CONFLICT', 'The reconciliation version or state is stale.');
      }
      const line = this.database.prepare(`SELECT amount_minor AS amountMinor FROM finance_bank_statement_lines
        WHERE id=? AND firm_id=? AND batch_id=? AND bank_account_id=?`).get(input.statementLineId, user.firmId,
        reconciliation.statementBatchId, reconciliation.bankAccountId) as Row | undefined;
      if (!line) throw new BillingCashroomStoreError('INVALID_LINK', 'The statement line does not belong to this reconciliation.');
      if (reconciliation.items.some((item) => item.statementLineId === input.statementLineId)) {
        throw new BillingCashroomStoreError('CONFLICT', 'This statement line already has a retained match decision.');
      }
      if (input.decision === 'reject' && input.matches.length !== 0) throw new BillingCashroomStoreError('INVALID_STATE', 'A rejected suggestion cannot retain journal matches.');
      if (input.decision === 'confirm' && input.matches.length !== 1) throw new BillingCashroomStoreError('INVALID_STATE', 'A confirmed match requires one journal.');
      if (input.decision === 'split' && input.matches.length < 2) throw new BillingCashroomStoreError('INVALID_STATE', 'A split match requires at least two journals.');
      const matchedTotal = input.matches.reduce((total, match) => total + match.amountMinor, 0);
      if (!Number.isSafeInteger(matchedTotal) || (input.decision !== 'reject' && matchedTotal !== Number(line.amountMinor))) {
        throw new BillingCashroomStoreError('INVALID_STATE', 'Confirmed match amounts must equal the exact statement-line amount.');
      }
      const at = this.now().toISOString();
      const insertItem = this.database.prepare(`INSERT INTO finance_reconciliation_items
        (id,firm_id,reconciliation_id,item_kind,statement_line_id,journal_id,amount_minor,evidence_document_version_id,
          explanation,created_by,created_at) VALUES (?, ?, ?, 'statement_match', ?, ?, ?, NULL, ?, ?, ?)`);
      if (input.decision === 'reject') {
        insertItem.run(randomUUID(), user.firmId, reconciliationId, input.statementLineId, null,
          Number(line.amountMinor), input.explanation, user.id, at);
      }
      for (const match of input.matches) {
        const posted = this.database.prepare(`SELECT 1 FROM finance_journals j WHERE j.id=? AND j.firm_id=? AND EXISTS (
          SELECT 1 FROM finance_journal_events e WHERE e.journal_id=j.id AND e.firm_id=j.firm_id AND e.matter_id=j.matter_id
          AND e.event_type='posted')`).get(match.journalId, user.firmId);
        if (!posted) throw new BillingCashroomStoreError('INVALID_LINK', 'Only an exact posted journal can be confirmed as a bank match.');
        if (!Number.isSafeInteger(match.amountMinor) || match.amountMinor === 0) throw new BillingCashroomStoreError('INVALID_STATE', 'Match amounts must be non-zero safe integer minor units.');
        insertItem.run(randomUUID(), user.firmId, reconciliationId, input.statementLineId, match.journalId,
          match.amountMinor, input.explanation, user.id, at);
      }
      this.database.prepare(`INSERT INTO finance_reconciliation_events
        (id,firm_id,reconciliation_id,sequence,event_type,note,occurred_at,recorded_by,recorded_at)
        VALUES (?,?,?,?,?,?,?, ?,?)`).run(randomUUID(), user.firmId, reconciliationId, reconciliation.version + 1,
        input.decision === 'reject' ? 'item_rejected' : 'item_matched', input.explanation, at, user.id, at);
      const response = this.getReconciliation(user, reconciliationId)!;
      this.saveFirmReplay(user, scope, reconciliationId, input.idempotencyKey, input, response, at);
      this.appendFirmOperational(user, `finance.reconciliation_match_${input.decision}`, reconciliationId,
        input.idempotencyKey, at, { statementLineId: input.statementLineId, decision: input.decision,
          matchCount: input.matches.length, amountMinor: Number(line.amountMinor), currency: 'GBP' }, audit, 'finance_reconciliation');
      return response;
    });
  }

  completeReconciliation(user: SessionUser, reconciliationId: string, input: { expectedVersion: number; idempotencyKey: string; completedAt: string; explicitHumanConfirmation: true }, audit: AuditContext) {
    this.requireCapability(user, 'finance.prepare_reconciliation');
    const scope = `complete_reconciliation:${reconciliationId}`;
    const replay = this.replayFirm<NonNullable<ReturnType<typeof this.getReconciliation>>>(user, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      const reconciliation = this.getReconciliation(user, reconciliationId);
      if (!reconciliation) throw new BillingCashroomStoreError('NOT_FOUND', 'The reconciliation was not found.');
      if (reconciliation.version !== input.expectedVersion || reconciliation.status !== 'prepared') throw new BillingCashroomStoreError('CONFLICT', 'The reconciliation version or state is stale.');
      if (reconciliation.differenceMinor !== 0) throw new BillingCashroomStoreError('INVALID_STATE', 'A reconciliation with a difference cannot be completed.');
      const completedAt = isoTimestamp(input.completedAt, 'Reconciliation completion timestamp');
      if (Date.parse(completedAt) <= Date.parse(reconciliation.preparedAt)) throw new BillingCashroomStoreError('INVALID_STATE', 'Reconciliation completion must occur after preparation.');
      this.database.prepare(`INSERT INTO finance_reconciliation_events
        (id,firm_id,reconciliation_id,sequence,event_type,note,occurred_at,recorded_by,recorded_at)
        VALUES (?,?,?,?, 'completed','Zero-difference reconciliation frozen for independent sign-off.',?,?,?)`)
        .run(randomUUID(), user.firmId, reconciliationId, reconciliation.version + 1, completedAt, user.id, this.now().toISOString());
      const response = this.getReconciliation(user, reconciliationId)!;
      this.saveFirmReplay(user, scope, reconciliationId, input.idempotencyKey, input, response, this.now().toISOString());
      this.appendFirmOperational(user, 'finance.reconciliation_completed', reconciliationId, input.idempotencyKey, completedAt,
        { bankAccountId: reconciliation.bankAccountId, statementBatchId: reconciliation.statementBatchId, differenceMinor: 0, currency: 'GBP' }, audit, 'finance_reconciliation');
      return response;
    });
  }

  signoffReconciliation(user: SessionUser, reconciliationId: string, input: SignoffReconciliationInput, audit: AuditContext) {
    this.requireCapability(user, 'finance.signoff_reconciliation');
    const scope = `signoff_reconciliation:${reconciliationId}`;
    const replay = this.replayFirm<NonNullable<ReturnType<typeof this.getReconciliation>>>(user, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      const reconciliation = this.getReconciliation(user, reconciliationId);
      if (!reconciliation) throw new BillingCashroomStoreError('NOT_FOUND', 'The reconciliation was not found.');
      if (reconciliation.preparedBy === user.id) throw new BillingCashroomStoreError('INDEPENDENCE_REQUIRED', 'Reconciliation sign-off requires a person other than the preparer.');
      if (reconciliation.version !== input.expectedVersion || reconciliation.status !== 'completed') throw new BillingCashroomStoreError('CONFLICT', 'Only the exact completed reconciliation can be signed off.');
      const completed = reconciliation.events.find((event) => event.eventType === 'completed');
      const signedOffAt = isoTimestamp(input.signedOffAt, 'Reconciliation sign-off timestamp');
      if (!completed || Date.parse(signedOffAt) <= Date.parse(String(completed.occurredAt))) throw new BillingCashroomStoreError('INVALID_STATE', 'Reconciliation sign-off must occur after completion.');
      const snapshot = { bankAccountId: reconciliation.bankAccountId, statementBatchId: reconciliation.statementBatchId,
        statementClosingOn: reconciliation.statementClosingOn, statementClosingBalanceMinor: reconciliation.statementClosingBalanceMinor,
        ledgerClearedBalanceMinor: reconciliation.ledgerClearedBalanceMinor,
        outstandingLodgementsMinor: reconciliation.outstandingLodgementsMinor,
        unpresentedPaymentsMinor: reconciliation.unpresentedPaymentsMinor,
        documentedAdjustmentsMinor: reconciliation.documentedAdjustmentsMinor, differenceMinor: reconciliation.differenceMinor,
        itemIds: reconciliation.items.map((item) => item.id), completedEventSequence: Number(completed.sequence) };
      this.database.prepare(`INSERT INTO finance_reconciliation_signoffs
        (id,firm_id,reconciliation_id,signed_off_by,signed_off_at,note,next_review_due_on,calculation_snapshot_json)
        VALUES (?,?,?,?,?,?,?,?)`).run(randomUUID(), user.firmId, reconciliationId, user.id, signedOffAt, input.note,
        nextReviewDueOn(reconciliation.statementClosingOn), canonical(snapshot));
      const response = this.getReconciliation(user, reconciliationId)!;
      this.saveFirmReplay(user, scope, reconciliationId, input.idempotencyKey, input, response, this.now().toISOString());
      this.appendFirmOperational(user, 'finance.reconciliation_signed_off', reconciliationId, input.idempotencyKey, signedOffAt,
        { bankAccountId: reconciliation.bankAccountId, statementBatchId: reconciliation.statementBatchId,
          nextReviewDueOn: response.nextReviewDueOn, differenceMinor: 0, currency: 'GBP' }, audit, 'finance_reconciliation');
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
    insertLine.run(randomUUID(), user.firmId, matterId, journalId, line,
      this.activeAccount(user.firmId, 'TRADE-DEBTORS'), 0, credit.grossMinor, 'Reduce trade debtor by issued credit');
    const event = this.database.prepare(`INSERT INTO finance_journal_events (
      id, firm_id, matter_id, journal_id, sequence, event_type, note, occurred_at, recorded_by, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    event.run(randomUUID(), user.firmId, matterId, journalId, 1, 'prepared', 'Generated from exact credit-note lines.', at, credit.preparedBy, at);
    event.run(randomUUID(), user.firmId, matterId, journalId, 2, 'approved', 'Credit-note issue independently approved.', at, user.id, at);
    event.run(randomUUID(), user.firmId, matterId, journalId, 3, 'posted', 'Credit-note journal posted atomically.', at, user.id, at);
  }
}
