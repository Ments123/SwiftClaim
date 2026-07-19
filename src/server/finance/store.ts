import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
  ActivateFinanceRateVersionInput,
  AddFinanceRateVersionInput,
  ApproveFinanceJournalInput,
  ApproveFinanceTimeInput,
  CreateFinanceDisbursementInput,
  CreateFinanceEstimateVersionInput,
  CreateFinanceRateCardInput,
  DecideFinanceActivitySuggestionInput,
  PostFinanceJournalInput,
  PrepareFinanceJournalInput,
  RecordFinanceDisbursementEventInput,
  RecordFinanceWarningEventInput,
  ReverseFinanceTimeInput,
  ReverseFinanceJournalInput,
  StartFinanceTimerInput,
  StopFinanceTimerInput,
  SubmitFinanceTimeInput,
} from '../../shared/contracts.js';
import {
  canReadAllFirmMatters,
  hasCapability,
  type Capability,
  type SessionUser,
} from '../policy.js';
import { appendAudit, appendTimeline, type AuditContext } from '../store.js';
import type { suggestTimeFromActivity } from './activity.js';
import { calculateTimeValue, validateJournalLines } from './calculations.js';
import { findPotentialDisbursementDuplicates } from './duplicates.js';
import { projectAccountBalances } from './journal.js';
import { projectMatterFinance } from './projections.js';

type Row = Record<string, string | number | null>;
type ScopeKind = 'firm' | 'matter';
type FinanceActivitySuggestion = ReturnType<typeof suggestTimeFromActivity>;

export type FinanceStoreErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'INVALID_LINK'
  | 'INVALID_STATE'
  | 'INDEPENDENCE_REQUIRED'
  | 'RATE_NOT_FOUND';

export class FinanceStoreError extends Error {
  constructor(readonly code: FinanceStoreErrorCode, message: string) {
    super(message);
    this.name = 'FinanceStoreError';
  }
}

function canonicalJson(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .filter(([, child]) => child !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, canonical(child)]),
      );
    }
    return input;
  };
  return JSON.stringify(canonical(value));
}

const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');

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

function canonicalTimestamp(value: string, label: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new FinanceStoreError('INVALID_STATE', `${label} is invalid.`);
  return new Date(timestamp).toISOString();
}

function elapsedMinutes(startedAt: string, stoppedAt: string): number {
  const difference = Date.parse(stoppedAt) - Date.parse(startedAt);
  if (difference <= 0) throw new FinanceStoreError('INVALID_STATE', 'A timer must stop after it starts.');
  const minutes = Math.ceil(difference / 60_000);
  if (!Number.isSafeInteger(minutes)) throw new FinanceStoreError('INVALID_STATE', 'Timer duration is outside the safe integer range.');
  return minutes;
}

export class FinanceStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private requireCapability(user: SessionUser, capability: Capability): void {
    if (!hasCapability(user, capability)) {
      throw new FinanceStoreError('FORBIDDEN', 'The finance action is not permitted.');
    }
  }

  private canReadMatter(user: SessionUser, matterId: string): boolean {
    if (!hasCapability(user, 'finance.read_matter')) return false;
    if (canReadAllFirmMatters(user)) {
      return Boolean(this.database.prepare('SELECT 1 FROM matters WHERE id = ? AND firm_id = ?')
        .get(matterId, user.firmId));
    }
    return Boolean(this.database.prepare(`SELECT 1 FROM matters m WHERE m.id = ? AND m.firm_id = ? AND (
      m.owner_user_id = ? OR EXISTS (SELECT 1 FROM matter_members mm WHERE mm.firm_id = m.firm_id
        AND mm.matter_id = m.id AND mm.user_id = ?)
    )`).get(matterId, user.firmId, user.id, user.id));
  }

  private requireMatter(user: SessionUser, matterId: string, capability: Capability): void {
    this.requireCapability(user, capability);
    if (!this.canReadMatter(user, matterId)) {
      throw new FinanceStoreError('NOT_FOUND', 'The finance workspace was not found.');
    }
  }

  private receipt<T>(
    user: SessionUser,
    scopeKind: ScopeKind,
    matterId: string | null,
    commandScope: string,
    idempotencyKey: string,
    input: unknown,
  ): T | undefined {
    const found = this.database.prepare(`SELECT input_hash AS inputHash, response_json AS responseJson
      FROM finance_command_receipts WHERE firm_id = ? AND scope_kind = ? AND matter_id IS ?
      AND command_scope = ? AND idempotency_key = ?`)
      .get(user.firmId, scopeKind, matterId, commandScope, idempotencyKey) as Row | undefined;
    if (!found) return undefined;
    if (String(found.inputHash) !== digest(input)) {
      throw new FinanceStoreError('IDEMPOTENCY_KEY_REUSED', 'The idempotency key was already used with different input.');
    }
    return JSON.parse(String(found.responseJson)) as T;
  }

  private saveReceipt(
    user: SessionUser,
    scopeKind: ScopeKind,
    matterId: string | null,
    commandScope: string,
    routeEntityId: string,
    idempotencyKey: string,
    input: unknown,
    response: unknown,
    createdAt: string,
  ): void {
    this.database.prepare(`INSERT INTO finance_command_receipts (
      id, firm_id, matter_id, scope_kind, command_scope, route_entity_id,
      idempotency_key, input_hash, response_json, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      randomUUID(), user.firmId, matterId, scopeKind, commandScope, routeEntityId,
      idempotencyKey, digest(input), canonicalJson(response), user.id, createdAt,
    );
  }

  private appendMatterOperational(
    user: SessionUser,
    matterId: string,
    details: {
      action: string; entityType: string; entityId: string; title: string;
      idempotencyKey: string; safeAfter: Record<string, unknown>; occurredAt: string;
    },
    audit: AuditContext,
  ): void {
    const safeMetadata = { entityType: details.entityType, entityId: details.entityId, ...details.safeAfter };
    appendTimeline(this.database, {
      firmId: user.firmId, matterId, type: details.action, title: details.title,
      actorUserId: user.id, occurredAt: details.occurredAt,
      metadata: { entityType: details.entityType, entityId: details.entityId },
    });
    appendAudit(this.database, {
      firmId: user.firmId, matterId, userId: user.id, action: details.action,
      entityType: details.entityType, entityId: details.entityId, after: safeMetadata,
      requestId: audit.requestId, ipAddress: audit.ipAddress, createdAt: details.occurredAt,
    });
    this.database.prepare(`INSERT INTO domain_events (
      id, firm_id, matter_id, type, occurred_on, actor_user_id,
      idempotency_key, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      randomUUID(), user.firmId, matterId, details.action, details.occurredAt.slice(0, 10), user.id,
      `finance:${details.action}:${details.entityId}:${details.idempotencyKey}`,
      canonicalJson(safeMetadata), details.occurredAt,
    );
    this.database.prepare(`INSERT INTO integration_outbox (
      id, firm_id, matter_id, topic, payload_json, status, attempts,
      available_at, created_at, deduplication_key
    ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`).run(
      randomUUID(), user.firmId, matterId, details.action,
      canonicalJson({ matterId, ...safeMetadata }), details.occurredAt, details.occurredAt,
      `finance:${user.firmId}:${matterId}:${details.action}:${details.entityId}:${details.idempotencyKey}`,
    );
  }

  private appendFirmOperational(
    user: SessionUser,
    details: {
      action: string; entityType: string; entityId: string;
      idempotencyKey: string; safeAfter: Record<string, unknown>; occurredAt: string;
    },
    audit: AuditContext,
  ): void {
    const safeMetadata = { entityType: details.entityType, entityId: details.entityId, ...details.safeAfter };
    appendAudit(this.database, {
      firmId: user.firmId, matterId: null, userId: user.id, action: details.action,
      entityType: details.entityType, entityId: details.entityId, after: safeMetadata,
      requestId: audit.requestId, ipAddress: audit.ipAddress, createdAt: details.occurredAt,
    });
    this.database.prepare(`INSERT INTO finance_firm_events (
      id, firm_id, type, actor_user_id, idempotency_key, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      randomUUID(), user.firmId, details.action, user.id,
      `finance:${details.action}:${details.entityId}:${details.idempotencyKey}`,
      canonicalJson(safeMetadata), details.occurredAt,
    );
    this.database.prepare(`INSERT INTO finance_integration_outbox (
      id, firm_id, matter_id, scope_kind, topic, payload_json, status, attempts,
      available_at, created_at, deduplication_key
    ) VALUES (?, ?, NULL, 'firm', ?, ?, 'pending', 0, ?, ?, ?)`).run(
      randomUUID(), user.firmId, details.action, canonicalJson(safeMetadata),
      details.occurredAt, details.occurredAt,
      `finance:${user.firmId}:firm:${details.action}:${details.entityId}:${details.idempotencyKey}`,
    );
  }

  private assertFirmUser(firmId: string, userId: string | null): void {
    if (userId && !this.database.prepare('SELECT 1 FROM users WHERE id = ? AND firm_id = ? AND active = 1')
      .get(userId, firmId)) {
      throw new FinanceStoreError('INVALID_LINK', 'A linked finance record was not found.');
    }
  }

  private assertFirmMatter(firmId: string, matterId: string | null): void {
    if (matterId && !this.database.prepare('SELECT 1 FROM matters WHERE id = ? AND firm_id = ?')
      .get(matterId, firmId)) {
      throw new FinanceStoreError('INVALID_LINK', 'A linked finance record was not found.');
    }
  }

  private assertDocumentVersion(firmId: string, matterId: string, versionId: string | null): void {
    if (!versionId) return;
    if (!this.database.prepare(`SELECT 1 FROM document_versions dv JOIN documents d
      ON d.id = dv.document_id AND d.firm_id = dv.firm_id
      WHERE dv.id = ? AND dv.firm_id = ? AND d.matter_id = ?`).get(versionId, firmId, matterId)) {
      throw new FinanceStoreError('INVALID_LINK', 'The exact finance evidence version was not found.');
    }
  }

  canAccessEvidenceVersion(user: SessionUser, matterId: string, versionId: string): boolean {
    if (user.role !== 'finance' || !hasCapability(user, 'finance.read_firm') || !this.canReadMatter(user, matterId)) {
      return false;
    }
    return Boolean(this.database.prepare(`SELECT 1
      FROM document_versions dv JOIN documents d
        ON d.id = dv.document_id AND d.firm_id = dv.firm_id
      WHERE dv.id = ? AND dv.firm_id = ? AND d.matter_id = ? AND (
        EXISTS (SELECT 1 FROM finance_estimate_versions estimate
          WHERE estimate.firm_id = dv.firm_id AND estimate.matter_id = d.matter_id
          AND estimate.source_document_version_id = dv.id)
        OR EXISTS (SELECT 1 FROM finance_warning_events warning
          WHERE warning.firm_id = dv.firm_id AND warning.matter_id = d.matter_id
          AND warning.evidence_document_version_id = dv.id)
        OR EXISTS (SELECT 1 FROM finance_disbursements disbursement
          WHERE disbursement.firm_id = dv.firm_id AND disbursement.matter_id = d.matter_id
          AND disbursement.source_document_version_id = dv.id)
        OR EXISTS (SELECT 1 FROM finance_disbursement_events event
          WHERE event.firm_id = dv.firm_id AND event.matter_id = d.matter_id
          AND event.evidence_document_version_id = dv.id)
        OR EXISTS (SELECT 1 FROM finance_journals journal
          WHERE journal.firm_id = dv.firm_id AND journal.matter_id = d.matter_id
          AND journal.source_kind = 'other' AND journal.source_id = dv.id)
      ) LIMIT 1`).get(versionId, user.firmId, matterId));
  }

  private getRateVersion(firmId: string, rateCardId: string, rateVersionId: string) {
    const version = this.database.prepare(`SELECT rv.id, rv.rate_card_id AS rateCardId,
      rv.version_number AS versionNumber, rv.effective_from AS effectiveFrom,
      rv.effective_to AS effectiveTo, rv.note, rv.prepared_by AS preparedBy,
      rv.created_at AS createdAt FROM finance_rate_versions rv
      WHERE rv.id = ? AND rv.firm_id = ? AND rv.rate_card_id = ?`)
      .get(rateVersionId, firmId, rateCardId) as Row | undefined;
    if (!version) return undefined;
    const events = (this.database.prepare(`SELECT id, sequence, event_type AS eventType, note,
      occurred_at AS occurredAt, recorded_by AS recordedBy, recorded_at AS recordedAt
      FROM finance_rate_version_events WHERE firm_id = ? AND rate_version_id = ?
      ORDER BY sequence`).all(firmId, rateVersionId) as Row[]).map((event) => ({
        id: String(event.id), eventType: String(event.eventType) as 'prepared' | 'activated' | 'retired',
        sequence: Number(event.sequence),
        note: String(event.note), occurredAt: String(event.occurredAt),
        recordedBy: String(event.recordedBy), recordedAt: String(event.recordedAt),
      }));
    const entries = (this.database.prepare(`SELECT id, grade, user_id AS userId,
      activity_code AS activityCode, matter_id AS matterId, hourly_rate_minor AS hourlyRateMinor,
      currency FROM finance_rate_entries WHERE firm_id = ? AND rate_version_id = ? ORDER BY id`)
      .all(firmId, rateVersionId) as Row[]).map((entry) => ({
        id: String(entry.id), grade: String(entry.grade), userId: entry.userId ? String(entry.userId) : null,
        activityCode: String(entry.activityCode), matterId: entry.matterId ? String(entry.matterId) : null,
        hourlyRateMinor: Number(entry.hourlyRateMinor), currency: 'GBP' as const,
      }));
    const latestEvent = events.at(-1)?.eventType ?? 'prepared';
    return {
      id: String(version.id), rateCardId: String(version.rateCardId),
      versionNumber: Number(version.versionNumber), effectiveFrom: String(version.effectiveFrom),
      effectiveTo: version.effectiveTo ? String(version.effectiveTo) : null,
      note: String(version.note), preparedBy: String(version.preparedBy), createdAt: String(version.createdAt),
      status: latestEvent === 'activated' ? 'active' as const : latestEvent === 'retired' ? 'retired' as const : 'draft' as const,
      events, entries,
    };
  }

  getRateCard(user: SessionUser, rateCardId: string) {
    if (!hasCapability(user, 'finance.read_firm')) return undefined;
    const card = this.database.prepare(`SELECT id, name, description, currency, version,
      created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt
      FROM finance_rate_cards WHERE id = ? AND firm_id = ?`)
      .get(rateCardId, user.firmId) as Row | undefined;
    if (!card) return undefined;
    const versionIds = this.database.prepare(`SELECT id FROM finance_rate_versions
      WHERE firm_id = ? AND rate_card_id = ? ORDER BY version_number`)
      .all(user.firmId, rateCardId) as Array<{ id: string }>;
    return {
      id: String(card.id), name: String(card.name), description: String(card.description), currency: 'GBP' as const,
      version: Number(card.version), createdBy: String(card.createdBy),
      createdAt: String(card.createdAt), updatedAt: String(card.updatedAt),
      versions: versionIds.map(({ id }) => this.getRateVersion(user.firmId, rateCardId, id)!),
    };
  }

  listRateCards(user: SessionUser) {
    if (!hasCapability(user, 'finance.read_firm')) return undefined;
    const ids = this.database.prepare(`SELECT id FROM finance_rate_cards
      WHERE firm_id = ? ORDER BY name COLLATE NOCASE, created_at, id`)
      .all(user.firmId) as Array<{ id: string }>;
    return ids.map(({ id }) => this.getRateCard(user, id)!);
  }

  createRateCard(user: SessionUser, input: CreateFinanceRateCardInput, audit: AuditContext) {
    this.requireCapability(user, 'finance.manage_rates');
    const replay = this.receipt<NonNullable<ReturnType<typeof this.getRateCard>>>(
      user, 'firm', null, 'create_rate_card', input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      const createdAt = this.now().toISOString();
      const id = randomUUID();
      this.database.prepare(`INSERT INTO finance_rate_cards (
        id, firm_id, name, description, currency, version, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`).run(
        id, user.firmId, input.name, input.description, input.currency, user.id, createdAt, createdAt,
      );
      const response = this.getRateCard(user, id)!;
      this.saveReceipt(user, 'firm', null, 'create_rate_card', id, input.idempotencyKey, input, response, createdAt);
      this.appendFirmOperational(user, {
        action: 'finance.rate_card_created', entityType: 'finance_rate_card', entityId: id,
        idempotencyKey: input.idempotencyKey, occurredAt: createdAt,
        safeAfter: { currency: input.currency, version: 1 },
      }, audit);
      return response;
    });
  }

  addRateVersion(
    user: SessionUser,
    rateCardId: string,
    input: AddFinanceRateVersionInput,
    audit: AuditContext,
  ) {
    this.requireCapability(user, 'finance.manage_rates');
    const replay = this.receipt<NonNullable<ReturnType<typeof this.getRateVersion>>>(
      user, 'firm', null, `add_rate_version:${rateCardId}`, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      const card = this.getRateCard(user, rateCardId);
      if (!card) throw new FinanceStoreError('NOT_FOUND', 'The rate card was not found.');
      if (card.version !== input.expectedVersion) throw new FinanceStoreError('CONFLICT', 'The rate card version is stale.');
      if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
        throw new FinanceStoreError('INVALID_STATE', 'The rate version end date precedes its start date.');
      }
      for (const entry of input.entries) {
        this.assertFirmUser(user.firmId, entry.userId);
        this.assertFirmMatter(user.firmId, entry.matterId);
      }
      const createdAt = this.now().toISOString();
      const id = randomUUID();
      const versionNumber = card.versions.length + 1;
      this.database.prepare(`INSERT INTO finance_rate_versions (
        id, firm_id, rate_card_id, version_number, effective_from, effective_to,
        note, prepared_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, user.firmId, rateCardId, versionNumber, input.effectiveFrom,
        input.effectiveTo, input.note, user.id, createdAt,
      );
      const insertEntry = this.database.prepare(`INSERT INTO finance_rate_entries (
        id, firm_id, rate_version_id, grade, user_id, activity_code, matter_id,
        hourly_rate_minor, currency
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const entry of input.entries) insertEntry.run(
        randomUUID(), user.firmId, id, entry.grade, entry.userId,
        entry.activityCode, entry.matterId, entry.hourlyRateMinor, entry.currency,
      );
      this.database.prepare(`INSERT INTO finance_rate_version_events (
        id, firm_id, rate_version_id, sequence, event_type, note, occurred_at, recorded_by, recorded_at
      ) VALUES (?, ?, ?, 1, 'prepared', ?, ?, ?, ?)`).run(
        randomUUID(), user.firmId, id, input.note, createdAt, user.id, createdAt,
      );
      const updated = this.database.prepare(`UPDATE finance_rate_cards SET version = version + 1,
        updated_at = ? WHERE id = ? AND firm_id = ? AND version = ?`)
        .run(createdAt, rateCardId, user.firmId, input.expectedVersion);
      if (Number(updated.changes) !== 1) throw new FinanceStoreError('CONFLICT', 'The rate card version is stale.');
      const response = this.getRateVersion(user.firmId, rateCardId, id)!;
      this.saveReceipt(user, 'firm', null, `add_rate_version:${rateCardId}`, id,
        input.idempotencyKey, input, response, createdAt);
      this.appendFirmOperational(user, {
        action: 'finance.rate_version_prepared', entityType: 'finance_rate_version', entityId: id,
        idempotencyKey: input.idempotencyKey, occurredAt: createdAt,
        safeAfter: { rateCardId, versionNumber, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo },
      }, audit);
      return response;
    });
  }

  activateRateVersion(
    user: SessionUser,
    rateCardId: string,
    input: ActivateFinanceRateVersionInput,
    audit: AuditContext,
  ) {
    this.requireCapability(user, 'finance.manage_rates');
    const replay = this.receipt<NonNullable<ReturnType<typeof this.getRateVersion>>>(
      user, 'firm', null, `activate_rate_version:${rateCardId}`, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      const card = this.getRateCard(user, rateCardId);
      if (!card) throw new FinanceStoreError('NOT_FOUND', 'The rate card was not found.');
      if (card.version !== input.expectedVersion) throw new FinanceStoreError('CONFLICT', 'The rate card version is stale.');
      const version = this.getRateVersion(user.firmId, rateCardId, input.rateVersionId);
      if (!version) throw new FinanceStoreError('NOT_FOUND', 'The rate version was not found.');
      if (version.preparedBy === user.id) {
        throw new FinanceStoreError('INDEPENDENCE_REQUIRED', 'Rate activation requires an independent approver.');
      }
      if (version.status !== 'draft') throw new FinanceStoreError('INVALID_STATE', 'Only a draft rate version can be activated.');
      const approvedAt = canonicalTimestamp(input.approvedAt, 'Rate approval timestamp');
      if (Date.parse(approvedAt) <= Date.parse(version.createdAt)) {
        throw new FinanceStoreError('INVALID_STATE', 'Rate approval must occur after preparation.');
      }
      this.database.prepare(`INSERT INTO finance_rate_version_events (
        id, firm_id, rate_version_id, sequence, event_type, note, occurred_at, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, 'activated', ?, ?, ?, ?)`).run(
        randomUUID(), user.firmId, version.id, version.events.length + 1,
        input.approvalNote, approvedAt, user.id, this.now().toISOString(),
      );
      const updated = this.database.prepare(`UPDATE finance_rate_cards SET version = version + 1,
        updated_at = ? WHERE id = ? AND firm_id = ? AND version = ?`)
        .run(approvedAt, rateCardId, user.firmId, input.expectedVersion);
      if (Number(updated.changes) !== 1) throw new FinanceStoreError('CONFLICT', 'The rate card version is stale.');
      const response = this.getRateVersion(user.firmId, rateCardId, version.id)!;
      this.saveReceipt(user, 'firm', null, `activate_rate_version:${rateCardId}`, version.id,
        input.idempotencyKey, input, response, approvedAt);
      this.appendFirmOperational(user, {
        action: 'finance.rate_version_activated', entityType: 'finance_rate_version', entityId: version.id,
        idempotencyKey: input.idempotencyKey, occurredAt: approvedAt,
        safeAfter: { rateCardId, versionNumber: version.versionNumber, effectiveFrom: version.effectiveFrom },
      }, audit);
      return response;
    });
  }

  getSuggestion(user: SessionUser, matterId: string, suggestionId: string) {
    if (!this.canReadMatter(user, matterId)) return undefined;
    const suggestion = this.database.prepare(`SELECT id, user_id AS userId, source_kind AS sourceKind,
      source_id AS sourceId, observed_minutes AS observedMinutes, observed_at AS observedAt,
      proposed_activity_code AS proposedActivityCode, proposed_costs_phase AS proposedCostsPhase,
      proposed_narrative AS proposedNarrative, confidence, explanation, model,
      policy_version AS policyVersion, input_hash AS inputHash, version, created_at AS createdAt
      FROM finance_activity_suggestions WHERE id = ? AND firm_id = ? AND matter_id = ?`)
      .get(suggestionId, user.firmId, matterId) as Row | undefined;
    if (!suggestion) return undefined;
    const decisions = (this.database.prepare(`SELECT id, decision, reason, decided_by AS decidedBy,
      decided_at AS decidedAt FROM finance_activity_suggestion_decisions
      WHERE suggestion_id = ? AND firm_id = ? AND matter_id = ? ORDER BY decided_at, id`)
      .all(suggestionId, user.firmId, matterId) as Row[]).map((decision) => ({
        id: String(decision.id), decision: String(decision.decision) as 'accept' | 'edit' | 'split' | 'reject',
        reason: user.role === 'finance' ? null : String(decision.reason),
        decidedBy: String(decision.decidedBy), decidedAt: String(decision.decidedAt),
      }));
    return {
      id: String(suggestion.id), userId: String(suggestion.userId), sourceKind: String(suggestion.sourceKind),
      sourceId: String(suggestion.sourceId), minutes: Number(suggestion.observedMinutes),
      observedAt: String(suggestion.observedAt),
      proposedActivityCode: String(suggestion.proposedActivityCode),
      proposedCostsPhase: String(suggestion.proposedCostsPhase),
      proposedNarrative: String(suggestion.proposedNarrative), confidence: String(suggestion.confidence),
      explanation: String(suggestion.explanation), model: String(suggestion.model),
      policyVersion: String(suggestion.policyVersion), inputHash: String(suggestion.inputHash),
      version: Number(suggestion.version) + decisions.length,
      status: decisions.at(-1)?.decision ?? 'pending', decisions, createdAt: String(suggestion.createdAt),
      provisional: true as const, label: 'AI suggestion — human review required' as const,
    };
  }

  createSuggestion(
    user: SessionUser,
    matterId: string,
    input: FinanceActivitySuggestion,
    audit: AuditContext,
  ) {
    this.requireMatter(user, matterId, 'finance.record_time');
    if (input.firmId !== user.firmId || input.matterId !== matterId || input.userId !== user.id) {
      throw new FinanceStoreError('INVALID_LINK', 'The activity source was not found.');
    }
    const sourceKey = `${input.sourceKind}:${input.sourceId}:${user.id}`;
    const replay = this.receipt<NonNullable<ReturnType<typeof this.getSuggestion>>>(
      user, 'matter', matterId, 'create_activity_suggestion', sourceKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      const id = randomUUID();
      const createdAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO finance_activity_suggestions (
        id, firm_id, matter_id, user_id, source_kind, source_id, observed_minutes, observed_at,
        proposed_activity_code, proposed_costs_phase, proposed_narrative, confidence,
        explanation, model, policy_version, input_hash, version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(
        id, user.firmId, matterId, user.id, input.sourceKind, input.sourceId, input.minutes,
        input.observedAt, input.proposedActivityCode, input.proposedCostsPhase, input.proposedNarrative, input.confidence,
        input.explanation, input.model, input.policyVersion, input.inputHash, createdAt,
      );
      const response = this.getSuggestion(user, matterId, id)!;
      this.saveReceipt(user, 'matter', matterId, 'create_activity_suggestion', id,
        sourceKey, input, response, createdAt);
      this.appendMatterOperational(user, matterId, {
        action: 'finance.activity_suggested', entityType: 'finance_activity_suggestion', entityId: id,
        title: 'Provisional time suggestion created', idempotencyKey: sourceKey, occurredAt: createdAt,
        safeAfter: { sourceKind: input.sourceKind, sourceId: input.sourceId, minutes: input.minutes, provisional: true },
      }, audit);
      return response;
    });
  }

  decideSuggestion(
    user: SessionUser,
    matterId: string,
    suggestionId: string,
    input: DecideFinanceActivitySuggestionInput,
    audit: AuditContext,
  ) {
    this.requireMatter(user, matterId, 'finance.record_time');
    const replay = this.receipt<NonNullable<ReturnType<typeof this.getSuggestion>>>(
      user, 'matter', matterId, `decide_suggestion:${suggestionId}`, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      const suggestion = this.getSuggestion(user, matterId, suggestionId);
      if (!suggestion || suggestion.userId !== user.id) throw new FinanceStoreError('NOT_FOUND', 'The time suggestion was not found.');
      if (suggestion.version !== input.expectedVersion) throw new FinanceStoreError('CONFLICT', 'The suggestion version is stale.');
      if (suggestion.status !== 'pending') throw new FinanceStoreError('INVALID_STATE', 'The suggestion was already decided.');
      const decidedAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO finance_activity_suggestion_decisions (
        id, firm_id, matter_id, suggestion_id, decision, reason, decided_by, decided_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        randomUUID(), user.firmId, matterId, suggestionId, input.decision, input.reason, user.id, decidedAt,
      );
      const response = this.getSuggestion(user, matterId, suggestionId)!;
      this.saveReceipt(user, 'matter', matterId, `decide_suggestion:${suggestionId}`, suggestionId,
        input.idempotencyKey, input, response, decidedAt);
      this.appendMatterOperational(user, matterId, {
        action: 'finance.activity_suggestion_decided', entityType: 'finance_activity_suggestion', entityId: suggestionId,
        title: 'Time suggestion reviewed', idempotencyKey: input.idempotencyKey, occurredAt: decidedAt,
        safeAfter: { decision: input.decision, version: response.version },
      }, audit);
      return response;
    });
  }

  private timerRow(user: SessionUser, matterId: string, timerId: string): Row | undefined {
    if (!this.canReadMatter(user, matterId)) return undefined;
    return this.database.prepare(`SELECT id, matter_id AS matterId, user_id AS userId,
      activity_code AS activityCode, costs_phase AS costsPhase, narrative, status,
      started_at AS startedAt, stopped_at AS stoppedAt, version,
      created_at AS createdAt, updated_at AS updatedAt FROM finance_timer_sessions
      WHERE id = ? AND firm_id = ? AND matter_id = ?`).get(timerId, user.firmId, matterId) as Row | undefined;
  }

  getTimer(user: SessionUser, matterId: string, timerId: string) {
    const timer = this.timerRow(user, matterId, timerId);
    if (!timer) return undefined;
    return {
      id: String(timer.id), matterId: String(timer.matterId), userId: String(timer.userId),
      activityCode: String(timer.activityCode), costsPhase: String(timer.costsPhase),
      narrative: user.role === 'finance' ? null : String(timer.narrative),
      status: String(timer.status) as 'running' | 'stopped' | 'cancelled',
      startedAt: String(timer.startedAt), stoppedAt: timer.stoppedAt ? String(timer.stoppedAt) : null,
      elapsedMinutes: timer.stoppedAt ? elapsedMinutes(String(timer.startedAt), String(timer.stoppedAt)) : null,
      version: Number(timer.version), createdAt: String(timer.createdAt), updatedAt: String(timer.updatedAt),
    };
  }

  startTimer(user: SessionUser, matterId: string, input: StartFinanceTimerInput, audit: AuditContext) {
    this.requireMatter(user, matterId, 'finance.record_time');
    const commandScope = `start_timer:${user.id}`;
    const replay = this.receipt<NonNullable<ReturnType<typeof this.getTimer>>>(
      user, 'matter', matterId, commandScope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      const startedAt = this.now().toISOString();
      const recordedAt = startedAt;
      const running = this.database.prepare(`SELECT id, matter_id AS matterId, started_at AS startedAt,
        version FROM finance_timer_sessions WHERE firm_id = ? AND user_id = ? AND status = 'running'`)
        .get(user.firmId, user.id) as Row | undefined;
      const id = randomUUID();
      if (running) {
        elapsedMinutes(String(running.startedAt), startedAt);
        this.database.prepare(`UPDATE finance_timer_sessions SET status = 'stopped', stopped_at = ?,
          version = version + 1, updated_at = ? WHERE id = ? AND firm_id = ? AND status = 'running'`)
          .run(startedAt, recordedAt, running.id, user.firmId);
        this.database.prepare(`INSERT INTO finance_timer_events (
          id, firm_id, matter_id, timer_id, sequence, event_type, occurred_at, recorded_by, recorded_at
        ) VALUES (?, ?, ?, ?, 2, 'stopped', ?, ?, ?)`).run(
          randomUUID(), user.firmId, running.matterId, running.id, startedAt, user.id, recordedAt,
        );
        this.appendMatterOperational(user, String(running.matterId), {
          action: 'finance.timer_auto_stopped', entityType: 'finance_timer', entityId: String(running.id),
          title: 'Running timer stopped before another began',
          idempotencyKey: `${input.idempotencyKey}:auto-stop:${String(running.id)}`, occurredAt: startedAt,
          safeAfter: { supersededByTimerId: id },
        }, audit);
      }
      this.database.prepare(`INSERT INTO finance_timer_sessions (
        id, firm_id, matter_id, user_id, activity_code, costs_phase, narrative,
        status, started_at, stopped_at, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, NULL, 1, ?, ?)`).run(
        id, user.firmId, matterId, user.id, input.activityCode, input.costsPhase,
        input.narrative, startedAt, recordedAt, recordedAt,
      );
      this.database.prepare(`INSERT INTO finance_timer_events (
        id, firm_id, matter_id, timer_id, sequence, event_type, occurred_at, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, 1, 'started', ?, ?, ?)`).run(
        randomUUID(), user.firmId, matterId, id, startedAt, user.id, recordedAt,
      );
      const response = this.getTimer(user, matterId, id)!;
      this.saveReceipt(user, 'matter', matterId, commandScope, id,
        input.idempotencyKey, input, response, recordedAt);
      this.appendMatterOperational(user, matterId, {
        action: 'finance.timer_started', entityType: 'finance_timer', entityId: id,
        title: 'Finance timer started', idempotencyKey: input.idempotencyKey, occurredAt: startedAt,
        safeAfter: { activityCode: input.activityCode, costsPhase: input.costsPhase },
      }, audit);
      return response;
    });
  }

  stopTimer(
    user: SessionUser,
    matterId: string,
    timerId: string,
    input: StopFinanceTimerInput,
    audit: AuditContext,
  ) {
    this.requireMatter(user, matterId, 'finance.record_time');
    const replay = this.receipt<NonNullable<ReturnType<typeof this.getTimer>>>(
      user, 'matter', matterId, `stop_timer:${timerId}`, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      const timer = this.timerRow(user, matterId, timerId);
      if (!timer || String(timer.userId) !== user.id) throw new FinanceStoreError('NOT_FOUND', 'The timer was not found.');
      if (Number(timer.version) !== input.expectedVersion) throw new FinanceStoreError('CONFLICT', 'The timer version is stale.');
      if (timer.status !== 'running') throw new FinanceStoreError('INVALID_STATE', 'Only a running timer can be stopped.');
      const stoppedAt = this.now().toISOString();
      const minutes = elapsedMinutes(String(timer.startedAt), stoppedAt);
      const recordedAt = stoppedAt;
      const updated = this.database.prepare(`UPDATE finance_timer_sessions SET status = 'stopped', stopped_at = ?,
        version = version + 1, updated_at = ? WHERE id = ? AND firm_id = ? AND matter_id = ? AND version = ? AND status = 'running'`)
        .run(stoppedAt, recordedAt, timerId, user.firmId, matterId, input.expectedVersion);
      if (Number(updated.changes) !== 1) throw new FinanceStoreError('CONFLICT', 'The timer version is stale.');
      this.database.prepare(`INSERT INTO finance_timer_events (
        id, firm_id, matter_id, timer_id, sequence, event_type, occurred_at, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, ?, 'stopped', ?, ?, ?)`).run(
        randomUUID(), user.firmId, matterId, timerId, input.expectedVersion + 1, stoppedAt, user.id, recordedAt,
      );
      const response = this.getTimer(user, matterId, timerId)!;
      this.saveReceipt(user, 'matter', matterId, `stop_timer:${timerId}`, timerId,
        input.idempotencyKey, input, response, recordedAt);
      this.appendMatterOperational(user, matterId, {
        action: 'finance.timer_stopped', entityType: 'finance_timer', entityId: timerId,
        title: 'Finance timer stopped', idempotencyKey: input.idempotencyKey, occurredAt: stoppedAt,
        safeAfter: { minutes, version: response.version },
      }, audit);
      return response;
    });
  }

  private assertTimeSource(
    user: SessionUser,
    matterId: string,
    input: SubmitFinanceTimeInput,
  ): void {
    if (input.sourceKind === 'manual') {
      if (input.sourceId !== null) throw new FinanceStoreError('INVALID_LINK', 'Manual time cannot claim an automated source.');
      return;
    }
    if (!input.sourceId) throw new FinanceStoreError('INVALID_LINK', 'The exact activity source was not found.');
    if (input.sourceKind === 'timer') {
      const timer = this.database.prepare(`SELECT started_at AS startedAt, stopped_at AS stoppedAt,
        activity_code AS activityCode, costs_phase AS costsPhase FROM finance_timer_sessions
        WHERE id = ? AND firm_id = ? AND matter_id = ? AND user_id = ? AND status = 'stopped'`)
        .get(input.sourceId, user.firmId, matterId, user.id) as Row | undefined;
      if (!timer?.stoppedAt) {
        throw new FinanceStoreError('INVALID_LINK', 'The exact activity source was not found.');
      }
      const observedMinutes = elapsedMinutes(String(timer.startedAt), String(timer.stoppedAt));
      if (input.minutes !== observedMinutes) {
        throw new FinanceStoreError('INVALID_STATE', 'Timer-derived time must match the exact elapsed minutes.');
      }
      if (input.workDate !== String(timer.startedAt).slice(0, 10)
        || input.activityCode !== String(timer.activityCode)
        || input.costsPhase !== String(timer.costsPhase)) {
        throw new FinanceStoreError('INVALID_STATE', 'Timer-derived time must retain its exact date and coding.');
      }
      if (this.database.prepare(`SELECT 1 FROM finance_time_entries WHERE firm_id = ? AND matter_id = ?
        AND user_id = ? AND source_kind = 'timer' AND source_id = ? LIMIT 1`)
        .get(user.firmId, matterId, user.id, input.sourceId)) {
        throw new FinanceStoreError('CONFLICT', 'This timer has already been submitted as time.');
      }
      return;
    }
    const source = this.database.prepare(`SELECT id, observed_minutes AS observedMinutes,
      observed_at AS observedAt, proposed_activity_code AS proposedActivityCode,
      proposed_costs_phase AS proposedCostsPhase, proposed_narrative AS proposedNarrative
      FROM finance_activity_suggestions WHERE firm_id = ? AND matter_id = ?
      AND user_id = ? AND source_kind = ? AND source_id = ?`).get(
      user.firmId, matterId, user.id, input.sourceKind, input.sourceId,
    ) as Row | undefined;
    if (!source) throw new FinanceStoreError('INVALID_LINK', 'The exact activity source was not found.');
    const decision = this.database.prepare(`SELECT decision FROM finance_activity_suggestion_decisions
      WHERE firm_id = ? AND matter_id = ? AND suggestion_id = ? ORDER BY decided_at DESC, id DESC LIMIT 1`)
      .get(user.firmId, matterId, source.id) as { decision: string } | undefined;
    if (!decision) throw new FinanceStoreError('INVALID_STATE', 'Activity-derived time requires explicit human review.');
    if (decision.decision === 'reject') throw new FinanceStoreError('INVALID_STATE', 'A rejected activity suggestion cannot create time.');
    if (decision.decision === 'accept' && (
      input.minutes !== Number(source.observedMinutes)
      || input.workDate !== String(source.observedAt).slice(0, 10)
      || input.activityCode !== String(source.proposedActivityCode)
      || input.costsPhase !== String(source.proposedCostsPhase)
      || input.narrative !== String(source.proposedNarrative)
    )) throw new FinanceStoreError('INVALID_STATE', 'Accepted activity time must retain the reviewed suggestion exactly.');
    if (decision.decision === 'split') {
      const existingParts = this.database.prepare(`SELECT minutes FROM finance_time_entries
        WHERE firm_id = ? AND matter_id = ? AND user_id = ? AND source_kind = ? AND source_id = ?`)
        .all(user.firmId, matterId, user.id, input.sourceKind, input.sourceId) as Array<{ minutes: number }>;
      let totalMinutes = input.minutes;
      for (const part of existingParts) {
        totalMinutes += Number(part.minutes);
        if (!Number.isSafeInteger(totalMinutes)) {
          throw new FinanceStoreError('INVALID_STATE', 'Split activity duration exceeded the safe integer range.');
        }
      }
      if (totalMinutes > Number(source.observedMinutes)) {
        throw new FinanceStoreError('INVALID_STATE', 'Split activity time cannot exceed the exact observed duration.');
      }
    }
    if (decision.decision !== 'split' && this.database.prepare(`SELECT 1 FROM finance_time_entries
      WHERE firm_id = ? AND matter_id = ? AND user_id = ? AND source_kind = ? AND source_id = ? LIMIT 1`)
      .get(user.firmId, matterId, user.id, input.sourceKind, input.sourceId)) {
      throw new FinanceStoreError('CONFLICT', 'This activity source has already been submitted as time.');
    }
  }

  getTimeEntry(user: SessionUser, matterId: string, timeEntryId: string) {
    if (!this.canReadMatter(user, matterId)) return undefined;
    const entry = this.database.prepare(`SELECT id, user_id AS userId, work_date AS workDate,
      minutes, narrative, activity_code AS activityCode, costs_phase AS costsPhase,
      chargeable, source_kind AS sourceKind, source_id AS sourceId, currency,
      created_by AS createdBy, created_at AS createdAt FROM finance_time_entries
      WHERE id = ? AND firm_id = ? AND matter_id = ?`)
      .get(timeEntryId, user.firmId, matterId) as Row | undefined;
    if (!entry) return undefined;
    const events = (this.database.prepare(`SELECT id, sequence, event_type AS eventType, reason,
      replacement_entry_id AS replacementEntryId, occurred_at AS occurredAt,
      recorded_by AS recordedBy, recorded_at AS recordedAt FROM finance_time_entry_events
      WHERE time_entry_id = ? AND firm_id = ? AND matter_id = ? ORDER BY sequence`)
      .all(timeEntryId, user.firmId, matterId) as Row[]).map((event) => ({
        id: String(event.id), eventType: String(event.eventType) as 'submitted' | 'approved' | 'rejected' | 'reversed' | 'replacement_linked',
        sequence: Number(event.sequence),
        reason: user.role === 'finance' ? null : String(event.reason),
        replacementEntryId: event.replacementEntryId ? String(event.replacementEntryId) : null,
        occurredAt: String(event.occurredAt), recordedBy: String(event.recordedBy), recordedAt: String(event.recordedAt),
      }));
    const statusEvent = [...events].reverse().find(({ eventType }) => eventType !== 'replacement_linked');
    const approval = this.database.prepare(`SELECT id, rate_version_id AS rateVersionId,
      rate_entry_id AS rateEntryId, grade_snapshot AS gradeSnapshot,
      hourly_rate_minor AS hourlyRateMinor, charge_minor AS chargeMinor,
      remainder_numerator AS remainderNumerator, denominator, currency,
      approval_note AS approvalNote, approved_by AS approvedBy,
      approved_at AS approvedAt, created_at AS approvalCreatedAt
      FROM finance_time_approvals WHERE time_entry_id = ? AND firm_id = ? AND matter_id = ?`)
      .get(timeEntryId, user.firmId, matterId) as Row | undefined;
    return {
      id: String(entry.id), userId: String(entry.userId), workDate: String(entry.workDate),
      minutes: Number(entry.minutes), narrative: user.role === 'finance' ? null : String(entry.narrative),
      activityCode: String(entry.activityCode),
      costsPhase: String(entry.costsPhase), chargeable: Boolean(entry.chargeable),
      sourceKind: String(entry.sourceKind), sourceId: entry.sourceId ? String(entry.sourceId) : null,
      currency: 'GBP' as const, status: (statusEvent?.eventType ?? 'submitted') as 'submitted' | 'approved' | 'rejected' | 'reversed',
      version: events.length, createdBy: String(entry.createdBy), createdAt: String(entry.createdAt), events,
      approvalId: approval ? String(approval.id) : null,
      rateVersionId: approval ? String(approval.rateVersionId) : null,
      rateEntryId: approval ? String(approval.rateEntryId) : null,
      gradeSnapshot: approval ? String(approval.gradeSnapshot) : null,
      hourlyRateMinor: approval ? Number(approval.hourlyRateMinor) : null,
      chargeMinor: approval ? Number(approval.chargeMinor) : null,
      remainderNumerator: approval ? Number(approval.remainderNumerator) : null,
      denominator: approval ? Number(approval.denominator) : null,
      approvedBy: approval ? String(approval.approvedBy) : null,
      approvedAt: approval ? String(approval.approvedAt) : null,
      approvalNote: approval && user.role !== 'finance' ? String(approval.approvalNote) : null,
    };
  }

  submitTime(user: SessionUser, matterId: string, input: SubmitFinanceTimeInput, audit: AuditContext) {
    this.requireMatter(user, matterId, 'finance.record_time');
    const commandScope = `submit_time:${user.id}`;
    const replay = this.receipt<NonNullable<ReturnType<typeof this.getTimeEntry>>>(
      user, 'matter', matterId, commandScope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      this.assertTimeSource(user, matterId, input);
      const id = randomUUID();
      const createdAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO finance_time_entries (
        id, firm_id, matter_id, user_id, work_date, minutes, narrative,
        activity_code, costs_phase, chargeable, source_kind, source_id,
        currency, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GBP', ?, ?)`).run(
        id, user.firmId, matterId, user.id, input.workDate, input.minutes, input.narrative,
        input.activityCode, input.costsPhase, input.chargeable ? 1 : 0,
        input.sourceKind, input.sourceId, user.id, createdAt,
      );
      this.database.prepare(`INSERT INTO finance_time_entry_events (
        id, firm_id, matter_id, time_entry_id, sequence, event_type, reason, replacement_entry_id,
        occurred_at, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, 1, 'submitted', ?, NULL, ?, ?, ?)`).run(
        randomUUID(), user.firmId, matterId, id, 'Submitted by the fee earner for human approval.',
        createdAt, user.id, createdAt,
      );
      const response = this.getTimeEntry(user, matterId, id)!;
      this.saveReceipt(user, 'matter', matterId, commandScope, id,
        input.idempotencyKey, input, response, createdAt);
      this.appendMatterOperational(user, matterId, {
        action: 'finance.time_submitted', entityType: 'finance_time_entry', entityId: id,
        title: 'Time submitted for approval', idempotencyKey: input.idempotencyKey, occurredAt: createdAt,
        safeAfter: { minutes: input.minutes, workDate: input.workDate, sourceKind: input.sourceKind, chargeable: input.chargeable },
      }, audit);
      return response;
    });
  }

  private resolveRate(firmId: string, matterId: string, userId: string, activityCode: string, workDate: string) {
    const user = this.database.prepare('SELECT role FROM users WHERE id = ? AND firm_id = ? AND active = 1')
      .get(userId, firmId) as { role: string } | undefined;
    if (!user) throw new FinanceStoreError('RATE_NOT_FOUND', 'No exact active rate could be resolved.');
    const candidates = this.database.prepare(`SELECT re.id, re.rate_version_id AS rateVersionId,
      re.grade, re.hourly_rate_minor AS hourlyRateMinor, re.currency,
      CASE WHEN re.matter_id = ? THEN 1 ELSE 0 END AS matterSpecific,
      CASE WHEN re.user_id = ? THEN 1 ELSE 0 END AS userSpecific,
      CASE WHEN re.activity_code = ? THEN 1 ELSE 0 END AS activitySpecific,
      rv.effective_from AS effectiveFrom, rv.version_number AS versionNumber
      FROM finance_rate_entries re JOIN finance_rate_versions rv
        ON rv.id = re.rate_version_id AND rv.firm_id = re.firm_id
      WHERE re.firm_id = ? AND rv.effective_from <= ?
        AND (rv.effective_to IS NULL OR rv.effective_to >= ?)
        AND EXISTS (SELECT 1 FROM finance_rate_version_events activation
          WHERE activation.firm_id = rv.firm_id AND activation.rate_version_id = rv.id
          AND activation.event_type = 'activated')
        AND (re.matter_id IS NULL OR re.matter_id = ?)
        AND (re.user_id = ? OR (re.user_id IS NULL AND re.grade = ?))
        AND (re.activity_code = '' OR re.activity_code = ?)
      ORDER BY matterSpecific DESC, userSpecific DESC, activitySpecific DESC,
        rv.effective_from DESC, rv.version_number DESC, re.id
      LIMIT 2`).all(
        matterId, userId, activityCode, firmId, workDate, workDate,
        matterId, userId, user.role, activityCode,
      ) as Row[];
    const selected = candidates[0];
    if (!selected) throw new FinanceStoreError('RATE_NOT_FOUND', 'No exact active rate could be resolved.');
    const next = candidates[1];
    if (next && Number(next.matterSpecific) === Number(selected.matterSpecific)
      && Number(next.userSpecific) === Number(selected.userSpecific)
      && Number(next.activitySpecific) === Number(selected.activitySpecific)
      && String(next.effectiveFrom) === String(selected.effectiveFrom)
      && Number(next.versionNumber) === Number(selected.versionNumber)) {
      throw new FinanceStoreError('CONFLICT', 'More than one equally specific active rate matched this time entry.');
    }
    return {
      rateEntryId: String(selected.id), rateVersionId: String(selected.rateVersionId),
      gradeSnapshot: String(selected.grade), hourlyRateMinor: Number(selected.hourlyRateMinor),
      currency: 'GBP' as const,
    };
  }

  approveTime(
    user: SessionUser,
    matterId: string,
    timeEntryId: string,
    input: ApproveFinanceTimeInput,
    audit: AuditContext,
  ) {
    this.requireMatter(user, matterId, 'finance.approve_time');
    const replay = this.receipt<NonNullable<ReturnType<typeof this.getTimeEntry>>>(
      user, 'matter', matterId, `approve_time:${timeEntryId}`, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      const entry = this.getTimeEntry(user, matterId, timeEntryId);
      if (!entry) throw new FinanceStoreError('NOT_FOUND', 'The time entry was not found.');
      if (entry.userId === user.id) throw new FinanceStoreError('INDEPENDENCE_REQUIRED', 'Time approval requires a separate supervisor.');
      if (entry.version !== input.expectedVersion) throw new FinanceStoreError('CONFLICT', 'The time entry version is stale.');
      if (entry.status !== 'submitted') throw new FinanceStoreError('INVALID_STATE', 'Only submitted time can be approved.');
      const rate = this.resolveRate(user.firmId, matterId, entry.userId, entry.activityCode, entry.workDate);
      const value = entry.chargeable
        ? calculateTimeValue({ minutes: entry.minutes, hourlyRateMinor: rate.hourlyRateMinor })
        : { chargeMinor: 0, remainderNumerator: 0, denominator: 60 as const };
      const approvedAt = canonicalTimestamp(input.approvedAt, 'Time approval timestamp');
      if (Date.parse(approvedAt) <= Date.parse(entry.createdAt)) {
        throw new FinanceStoreError('INVALID_STATE', 'Time approval must occur after submission.');
      }
      const recordedAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO finance_time_approvals (
        id, firm_id, matter_id, time_entry_id, rate_version_id, rate_entry_id,
        grade_snapshot, hourly_rate_minor, charge_minor, remainder_numerator,
        denominator, currency, approval_note, approved_by, approved_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GBP', ?, ?, ?, ?)`).run(
        randomUUID(), user.firmId, matterId, timeEntryId, rate.rateVersionId, rate.rateEntryId,
        rate.gradeSnapshot, rate.hourlyRateMinor, value.chargeMinor, value.remainderNumerator,
        value.denominator, input.approvalNote, user.id, approvedAt, recordedAt,
      );
      this.database.prepare(`INSERT INTO finance_time_entry_events (
        id, firm_id, matter_id, time_entry_id, sequence, event_type, reason, replacement_entry_id,
        occurred_at, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, ?, 'approved', ?, NULL, ?, ?, ?)`).run(
        randomUUID(), user.firmId, matterId, timeEntryId, input.expectedVersion + 1,
        input.approvalNote, approvedAt, user.id, recordedAt,
      );
      this.openEstimateWarnings(user, matterId, approvedAt, input.idempotencyKey, audit);
      const response = this.getTimeEntry(user, matterId, timeEntryId)!;
      this.saveReceipt(user, 'matter', matterId, `approve_time:${timeEntryId}`, timeEntryId,
        input.idempotencyKey, input, response, recordedAt);
      this.appendMatterOperational(user, matterId, {
        action: 'finance.time_approved', entityType: 'finance_time_entry', entityId: timeEntryId,
        title: 'Time approved into WIP', idempotencyKey: input.idempotencyKey, occurredAt: approvedAt,
        safeAfter: { minutes: entry.minutes, chargeMinor: value.chargeMinor, currency: 'GBP', rateVersionId: rate.rateVersionId },
      }, audit);
      return response;
    });
  }

  reverseTime(
    user: SessionUser,
    matterId: string,
    timeEntryId: string,
    input: ReverseFinanceTimeInput,
    audit: AuditContext,
  ) {
    this.requireMatter(user, matterId, 'finance.approve_time');
    const replay = this.receipt<NonNullable<ReturnType<typeof this.getTimeEntry>>>(
      user, 'matter', matterId, `reverse_time:${timeEntryId}`, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      const entry = this.getTimeEntry(user, matterId, timeEntryId);
      if (!entry) throw new FinanceStoreError('NOT_FOUND', 'The time entry was not found.');
      if (entry.version !== input.expectedVersion) throw new FinanceStoreError('CONFLICT', 'The time entry version is stale.');
      if (entry.status !== 'approved') throw new FinanceStoreError('INVALID_STATE', 'Only approved time can be reversed.');
      if (input.replacementEntryId) {
        if (input.replacementEntryId === timeEntryId || !this.getTimeEntry(user, matterId, input.replacementEntryId)) {
          throw new FinanceStoreError('INVALID_LINK', 'The replacement time entry was not found.');
        }
      }
      const reversedAt = canonicalTimestamp(input.reversedAt, 'Time reversal timestamp');
      if (!entry.approvedAt || Date.parse(reversedAt) <= Date.parse(entry.approvedAt)) {
        throw new FinanceStoreError('INVALID_STATE', 'Time reversal must occur after approval.');
      }
      const recordedAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO finance_time_entry_events (
        id, firm_id, matter_id, time_entry_id, sequence, event_type, reason, replacement_entry_id,
        occurred_at, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, ?, 'reversed', ?, ?, ?, ?, ?)`).run(
        randomUUID(), user.firmId, matterId, timeEntryId, input.expectedVersion + 1, input.reason,
        input.replacementEntryId, reversedAt, user.id, recordedAt,
      );
      const response = this.getTimeEntry(user, matterId, timeEntryId)!;
      this.saveReceipt(user, 'matter', matterId, `reverse_time:${timeEntryId}`, timeEntryId,
        input.idempotencyKey, input, response, recordedAt);
      this.appendMatterOperational(user, matterId, {
        action: 'finance.time_reversed', entityType: 'finance_time_entry', entityId: timeEntryId,
        title: 'Approved time reversed', idempotencyKey: input.idempotencyKey, occurredAt: reversedAt,
        safeAfter: { chargeMinor: entry.chargeMinor, currency: 'GBP', replacementEntryId: input.replacementEntryId },
      }, audit);
      return response;
    });
  }

  getEstimateVersion(user: SessionUser, matterId: string, estimateVersionId: string) {
    if (!this.canReadMatter(user, matterId)) return undefined;
    const version = this.database.prepare(`SELECT ev.id, ev.estimate_id AS estimateId,
      ev.version_number AS versionNumber, ev.effective_on AS effectiveOn, ev.scope,
      ev.fees_minor AS feesMinor, ev.disbursements_minor AS disbursementsMinor,
      ev.vat_minor AS vatMinor, ev.overall_limit_minor AS overallLimitMinor, ev.currency,
      ev.review_on AS reviewOn, ev.source_document_version_id AS sourceDocumentVersionId,
      ev.approval_note AS approvalNote, ev.approved_by AS approvedBy, ev.created_at AS createdAt
      FROM finance_estimate_versions ev WHERE ev.id = ? AND ev.firm_id = ? AND ev.matter_id = ?`)
      .get(estimateVersionId, user.firmId, matterId) as Row | undefined;
    if (!version) return undefined;
    const thresholds = (this.database.prepare(`SELECT id, threshold_percent AS thresholdPercent
      FROM finance_estimate_thresholds WHERE estimate_version_id = ? AND firm_id = ? AND matter_id = ?
      ORDER BY threshold_percent`).all(estimateVersionId, user.firmId, matterId) as Row[]).map((threshold) => ({
        id: String(threshold.id), thresholdPercent: Number(threshold.thresholdPercent),
      }));
    return {
      id: String(version.id), estimateId: String(version.estimateId), versionNumber: Number(version.versionNumber),
      effectiveOn: String(version.effectiveOn),
      scope: user.role === 'finance' ? null : String(version.scope),
      feesMinor: Number(version.feesMinor), disbursementsMinor: Number(version.disbursementsMinor),
      vatMinor: Number(version.vatMinor), overallLimitMinor: Number(version.overallLimitMinor),
      currency: 'GBP' as const, reviewOn: version.reviewOn ? String(version.reviewOn) : null,
      sourceDocumentVersionId: version.sourceDocumentVersionId ? String(version.sourceDocumentVersionId) : null,
      approvalNote: user.role === 'finance' ? null : String(version.approvalNote),
      approvedBy: String(version.approvedBy), createdAt: String(version.createdAt), thresholds,
    };
  }

  private listEstimateVersions(user: SessionUser, matterId: string) {
    const ids = this.database.prepare(`SELECT id FROM finance_estimate_versions
      WHERE firm_id = ? AND matter_id = ? ORDER BY effective_on, version_number, id`)
      .all(user.firmId, matterId) as Array<{ id: string }>;
    return ids.map(({ id }) => this.getEstimateVersion(user, matterId, id)!);
  }

  private activeEstimateVersion(user: SessionUser, matterId: string, asOf: string) {
    const row = this.database.prepare(`SELECT id FROM finance_estimate_versions WHERE firm_id = ?
      AND matter_id = ? AND effective_on <= ? ORDER BY effective_on DESC, version_number DESC, id DESC LIMIT 1`)
      .get(user.firmId, matterId, asOf) as { id: string } | undefined;
    return row ? this.getEstimateVersion(user, matterId, row.id) : null;
  }

  getWarning(user: SessionUser, matterId: string, warningId: string) {
    if (!this.canReadMatter(user, matterId)) return undefined;
    const warning = this.database.prepare(`SELECT w.id, w.threshold_id AS thresholdId,
      w.crossed_at AS crossedAt, w.exposure_minor AS exposureMinor, w.currency,
      t.threshold_percent AS thresholdPercent, t.estimate_version_id AS estimateVersionId
      FROM finance_estimate_warnings w JOIN finance_estimate_thresholds t
        ON t.id = w.threshold_id AND t.firm_id = w.firm_id AND t.matter_id = w.matter_id
      WHERE w.id = ? AND w.firm_id = ? AND w.matter_id = ?`)
      .get(warningId, user.firmId, matterId) as Row | undefined;
    if (!warning) return undefined;
    const events = (this.database.prepare(`SELECT id, sequence, event_type AS eventType, note,
      evidence_document_version_id AS evidenceDocumentVersionId, occurred_at AS occurredAt,
      recorded_by AS recordedBy, recorded_at AS recordedAt FROM finance_warning_events
      WHERE warning_id = ? AND firm_id = ? AND matter_id = ? ORDER BY sequence`)
      .all(warningId, user.firmId, matterId) as Row[]).map((event) => ({
        id: String(event.id), eventType: String(event.eventType) as 'opened' | 'reviewed' | 'client_notified' | 'closed_by_new_estimate',
        sequence: Number(event.sequence),
        note: user.role === 'finance' ? null : String(event.note),
        evidenceDocumentVersionId: event.evidenceDocumentVersionId ? String(event.evidenceDocumentVersionId) : null,
        occurredAt: String(event.occurredAt), recordedBy: String(event.recordedBy), recordedAt: String(event.recordedAt),
      }));
    const latest = events.at(-1)?.eventType ?? 'opened';
    return {
      id: String(warning.id), thresholdId: String(warning.thresholdId),
      estimateVersionId: String(warning.estimateVersionId), thresholdPercent: Number(warning.thresholdPercent),
      crossedAt: String(warning.crossedAt), exposureMinor: Number(warning.exposureMinor), currency: 'GBP' as const,
      state: latest === 'closed_by_new_estimate' ? 'closed_by_new_estimate' as const : 'open' as const,
      latestEvent: latest, version: events.length, events,
    };
  }

  private listWarnings(user: SessionUser, matterId: string) {
    const ids = this.database.prepare(`SELECT id FROM finance_estimate_warnings
      WHERE firm_id = ? AND matter_id = ? ORDER BY crossed_at, id`)
      .all(user.firmId, matterId) as Array<{ id: string }>;
    return ids.map(({ id }) => this.getWarning(user, matterId, id)!);
  }

  private currentApprovedExposureMinor(firmId: string, matterId: string): number {
    const wip = this.database.prepare(`SELECT a.charge_minor AS amount
      FROM finance_time_approvals a WHERE a.firm_id = ? AND a.matter_id = ?
      AND (SELECT e.event_type FROM finance_time_entry_events e
        WHERE e.time_entry_id = a.time_entry_id AND e.firm_id = a.firm_id AND e.matter_id = a.matter_id
        AND e.event_type <> 'replacement_linked' ORDER BY e.sequence DESC LIMIT 1) = 'approved'`)
      .all(firmId, matterId) as Array<{ amount: number }>;
    const disbursements = this.database.prepare(`SELECT d.gross_minor AS amount
      FROM finance_disbursements d WHERE d.firm_id = ? AND d.matter_id = ?
      AND (SELECT e.event_type FROM finance_disbursement_events e
        WHERE e.disbursement_id = d.id AND e.firm_id = d.firm_id AND e.matter_id = d.matter_id
        ORDER BY e.sequence DESC LIMIT 1)
        IN ('approved','incurred','paid_external')`).all(firmId, matterId) as Array<{ amount: number }>;
    let total = 0;
    for (const row of [...wip, ...disbursements]) {
      total += Number(row.amount);
      if (!Number.isSafeInteger(total)) {
        throw new FinanceStoreError('INVALID_STATE', 'Finance exposure exceeded the safe integer range.');
      }
    }
    return total;
  }

  private openEstimateWarnings(
    user: SessionUser,
    matterId: string,
    occurredAt: string,
    triggerKey: string,
    audit: AuditContext,
  ): void {
    const active = this.activeEstimateVersion(user, matterId, occurredAt.slice(0, 10));
    if (!active || active.overallLimitMinor <= 0) return;
    const exposureMinor = this.currentApprovedExposureMinor(user.firmId, matterId);
    for (const threshold of active.thresholds) {
      const crossed = BigInt(exposureMinor) * 100n
        >= BigInt(active.overallLimitMinor) * BigInt(threshold.thresholdPercent);
      if (!crossed || this.database.prepare(`SELECT 1 FROM finance_estimate_warnings
        WHERE firm_id = ? AND matter_id = ? AND threshold_id = ?`).get(
        user.firmId, matterId, threshold.id,
      )) continue;
      const warningId = randomUUID();
      const recordedAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO finance_estimate_warnings (
        id, firm_id, matter_id, threshold_id, crossed_at, exposure_minor, currency
      ) VALUES (?, ?, ?, ?, ?, ?, 'GBP')`).run(
        warningId, user.firmId, matterId, threshold.id, occurredAt, exposureMinor,
      );
      this.database.prepare(`INSERT INTO finance_warning_events (
        id, firm_id, matter_id, warning_id, sequence, event_type, note,
        evidence_document_version_id, occurred_at, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, 1, 'opened', ?, NULL, ?, ?, ?)`).run(
        randomUUID(), user.firmId, matterId, warningId,
        `Approved exposure crossed the configured ${threshold.thresholdPercent}% threshold.`,
        occurredAt, user.id, recordedAt,
      );
      this.appendMatterOperational(user, matterId, {
        action: 'finance.estimate_warning_opened', entityType: 'finance_estimate_warning', entityId: warningId,
        title: `Client cost warning opened at ${threshold.thresholdPercent}%`,
        idempotencyKey: `${triggerKey}:warning:${threshold.id}`, occurredAt,
        safeAfter: { estimateVersionId: active.id, thresholdPercent: threshold.thresholdPercent, exposureMinor, currency: 'GBP' },
      }, audit);
    }
  }

  addEstimateVersion(
    user: SessionUser,
    matterId: string,
    input: CreateFinanceEstimateVersionInput,
    audit: AuditContext,
  ) {
    this.requireMatter(user, matterId, 'finance.manage_estimates');
    const commandScope = `add_estimate_version:${user.id}`;
    const replay = this.receipt<NonNullable<ReturnType<typeof this.getEstimateVersion>>>(
      user, 'matter', matterId, commandScope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      this.assertDocumentVersion(user.firmId, matterId, input.sourceDocumentVersionId);
      const recordedAt = this.now().toISOString();
      let estimate = this.database.prepare(`SELECT id FROM finance_estimates WHERE firm_id = ? AND matter_id = ?`)
        .get(user.firmId, matterId) as { id: string } | undefined;
      if (!estimate) {
        estimate = { id: randomUUID() };
        this.database.prepare(`INSERT INTO finance_estimates (
          id, firm_id, matter_id, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?)`).run(estimate.id, user.firmId, matterId, user.id, recordedAt);
      }
      const count = this.database.prepare(`SELECT COUNT(*) AS count FROM finance_estimate_versions
        WHERE firm_id = ? AND matter_id = ? AND estimate_id = ?`)
        .get(user.firmId, matterId, estimate.id) as { count: number };
      const id = randomUUID();
      const versionNumber = Number(count.count) + 1;
      this.database.prepare(`INSERT INTO finance_estimate_versions (
        id, firm_id, matter_id, estimate_id, version_number, effective_on, scope,
        fees_minor, disbursements_minor, vat_minor, overall_limit_minor, currency,
        review_on, source_document_version_id, approval_note, approved_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, user.firmId, matterId, estimate.id, versionNumber, input.effectiveOn, input.scope,
        input.feesMinor, input.disbursementsMinor, input.vatMinor, input.overallLimitMinor,
        input.currency, input.reviewOn, input.sourceDocumentVersionId, input.approvalNote, user.id, recordedAt,
      );
      const insertThreshold = this.database.prepare(`INSERT INTO finance_estimate_thresholds (
        id, firm_id, matter_id, estimate_version_id, threshold_percent
      ) VALUES (?, ?, ?, ?, ?)`);
      for (const thresholdPercent of [80, 100]) insertThreshold.run(
        randomUUID(), user.firmId, matterId, id, thresholdPercent,
      );
      const priorWarnings = this.listWarnings(user, matterId).filter(({ state }) => state === 'open');
      for (const warning of priorWarnings) {
        const priorOccurredAt = warning.events.at(-1)?.occurredAt;
        const closeAt = priorOccurredAt && Date.parse(priorOccurredAt) >= Date.parse(recordedAt)
          ? new Date(Date.parse(priorOccurredAt) + 1).toISOString()
          : recordedAt;
        this.database.prepare(`INSERT INTO finance_warning_events (
          id, firm_id, matter_id, warning_id, sequence, event_type, note,
          evidence_document_version_id, occurred_at, recorded_by, recorded_at
        ) VALUES (?, ?, ?, ?, ?, 'closed_by_new_estimate', ?, ?, ?, ?, ?)`).run(
          randomUUID(), user.firmId, matterId, warning.id, warning.version + 1,
          'Warning closed because a new approved estimate version now governs the matter.',
          input.sourceDocumentVersionId, closeAt, user.id, recordedAt,
        );
        this.appendMatterOperational(user, matterId, {
          action: 'finance.estimate_warning_closed', entityType: 'finance_estimate_warning', entityId: warning.id,
          title: 'Cost warning closed by a new estimate',
          idempotencyKey: `${input.idempotencyKey}:close-warning:${warning.id}`, occurredAt: closeAt,
          safeAfter: { newEstimateVersionId: id },
        }, audit);
      }
      const response = this.getEstimateVersion(user, matterId, id)!;
      this.saveReceipt(user, 'matter', matterId, commandScope, id,
        input.idempotencyKey, input, response, recordedAt);
      this.appendMatterOperational(user, matterId, {
        action: 'finance.estimate_version_approved', entityType: 'finance_estimate_version', entityId: id,
        title: 'Client cost estimate approved', idempotencyKey: input.idempotencyKey, occurredAt: recordedAt,
        safeAfter: { versionNumber, effectiveOn: input.effectiveOn, overallLimitMinor: input.overallLimitMinor, currency: 'GBP' },
      }, audit);
      this.openEstimateWarnings(user, matterId, recordedAt, input.idempotencyKey, audit);
      return response;
    });
  }

  recordWarningEvent(
    user: SessionUser,
    matterId: string,
    warningId: string,
    input: RecordFinanceWarningEventInput,
    audit: AuditContext,
  ) {
    this.requireMatter(user, matterId, 'finance.manage_estimates');
    const commandScope = `record_warning_event:${warningId}`;
    const replay = this.receipt<NonNullable<ReturnType<typeof this.getWarning>>>(
      user, 'matter', matterId, commandScope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      const warning = this.getWarning(user, matterId, warningId);
      if (!warning) throw new FinanceStoreError('NOT_FOUND', 'The finance warning was not found.');
      if (warning.version !== input.expectedVersion) throw new FinanceStoreError('CONFLICT', 'The warning version is stale.');
      if (warning.state !== 'open') throw new FinanceStoreError('INVALID_STATE', 'The warning is already closed.');
      this.assertDocumentVersion(user.firmId, matterId, input.evidenceDocumentVersionId);
      const occurredAt = canonicalTimestamp(input.occurredAt, 'Warning event timestamp');
      const latestAt = warning.events.at(-1)?.occurredAt;
      if (latestAt && Date.parse(occurredAt) <= Date.parse(latestAt)) {
        throw new FinanceStoreError('INVALID_STATE', 'Warning events must be recorded in chronological order.');
      }
      const recordedAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO finance_warning_events (
        id, firm_id, matter_id, warning_id, sequence, event_type, note,
        evidence_document_version_id, occurred_at, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        randomUUID(), user.firmId, matterId, warningId, input.expectedVersion + 1, input.eventType, input.note,
        input.evidenceDocumentVersionId, occurredAt, user.id, recordedAt,
      );
      const response = this.getWarning(user, matterId, warningId)!;
      this.saveReceipt(user, 'matter', matterId, commandScope, warningId,
        input.idempotencyKey, input, response, recordedAt);
      this.appendMatterOperational(user, matterId, {
        action: 'finance.estimate_warning_reviewed', entityType: 'finance_estimate_warning', entityId: warningId,
        title: 'Client cost warning reviewed', idempotencyKey: input.idempotencyKey, occurredAt,
        safeAfter: { eventType: input.eventType, evidenceDocumentVersionId: input.evidenceDocumentVersionId },
      }, audit);
      return response;
    });
  }

  getDisbursement(user: SessionUser, matterId: string, disbursementId: string) {
    if (!this.canReadMatter(user, matterId)) return undefined;
    const disbursement = this.database.prepare(`SELECT id, supplier, invoice_reference AS invoiceReference,
      category, description, net_minor AS netMinor, vat_minor AS vatMinor,
      gross_minor AS grossMinor, currency, invoice_date AS invoiceDate, due_on AS dueOn,
      source_document_version_id AS sourceDocumentVersionId, created_by AS createdBy, created_at AS createdAt
      FROM finance_disbursements WHERE id = ? AND firm_id = ? AND matter_id = ?`)
      .get(disbursementId, user.firmId, matterId) as Row | undefined;
    if (!disbursement) return undefined;
    const events = (this.database.prepare(`SELECT id, sequence, event_type AS eventType, note,
      evidence_document_version_id AS evidenceDocumentVersionId, occurred_at AS occurredAt,
      recorded_by AS recordedBy, recorded_at AS recordedAt FROM finance_disbursement_events
      WHERE disbursement_id = ? AND firm_id = ? AND matter_id = ? ORDER BY sequence`)
      .all(disbursementId, user.firmId, matterId) as Row[]).map((event) => ({
        id: String(event.id), eventType: String(event.eventType) as 'proposed' | 'approved' | 'incurred' | 'paid_external' | 'cancelled' | 'corrected',
        sequence: Number(event.sequence),
        note: String(event.note), evidenceDocumentVersionId: event.evidenceDocumentVersionId ? String(event.evidenceDocumentVersionId) : null,
        occurredAt: String(event.occurredAt), recordedBy: String(event.recordedBy), recordedAt: String(event.recordedAt),
      }));
    const status = events.at(-1)?.eventType ?? 'proposed';
    const eventTypes = new Set(events.map(({ eventType }) => eventType));
    const existing = (this.database.prepare(`SELECT id, supplier, invoice_reference AS invoiceReference,
      gross_minor AS grossMinor, invoice_date AS invoiceDate FROM finance_disbursements
      WHERE firm_id = ? AND matter_id = ? AND id <> ?`).all(user.firmId, matterId, disbursementId) as Row[]).map((row) => ({
        id: String(row.id), supplier: String(row.supplier), invoiceReference: String(row.invoiceReference),
        grossMinor: Number(row.grossMinor), invoiceDate: row.invoiceDate ? String(row.invoiceDate) : null,
      }));
    return {
      id: String(disbursement.id), supplier: String(disbursement.supplier),
      invoiceReference: String(disbursement.invoiceReference), category: String(disbursement.category),
      description: String(disbursement.description), netMinor: Number(disbursement.netMinor),
      vatMinor: Number(disbursement.vatMinor), grossMinor: Number(disbursement.grossMinor), currency: 'GBP' as const,
      invoiceDate: disbursement.invoiceDate ? String(disbursement.invoiceDate) : null,
      dueOn: disbursement.dueOn ? String(disbursement.dueOn) : null,
      sourceDocumentVersionId: disbursement.sourceDocumentVersionId ? String(disbursement.sourceDocumentVersionId) : null,
      createdBy: String(disbursement.createdBy), createdAt: String(disbursement.createdAt),
      status, version: events.length, events,
      approved: eventTypes.has('approved') || eventTypes.has('incurred') || eventTypes.has('paid_external'),
      incurred: eventTypes.has('incurred') || eventTypes.has('paid_external'),
      paidExternally: eventTypes.has('paid_external'), cancelled: status === 'cancelled', corrected: status === 'corrected',
      billed: false as const, recovered: false as const,
      duplicateFindings: findPotentialDisbursementDuplicates(existing, {
        supplier: String(disbursement.supplier), invoiceReference: String(disbursement.invoiceReference),
        grossMinor: Number(disbursement.grossMinor), invoiceDate: disbursement.invoiceDate ? String(disbursement.invoiceDate) : null,
      }),
    };
  }

  private listDisbursements(user: SessionUser, matterId: string) {
    const ids = this.database.prepare(`SELECT id FROM finance_disbursements
      WHERE firm_id = ? AND matter_id = ? ORDER BY created_at, id`)
      .all(user.firmId, matterId) as Array<{ id: string }>;
    return ids.map(({ id }) => this.getDisbursement(user, matterId, id)!);
  }

  createDisbursement(
    user: SessionUser,
    matterId: string,
    input: CreateFinanceDisbursementInput,
    audit: AuditContext,
  ) {
    this.requireMatter(user, matterId, 'finance.manage_disbursements');
    const commandScope = `create_disbursement:${user.id}`;
    const replay = this.receipt<NonNullable<ReturnType<typeof this.getDisbursement>>>(
      user, 'matter', matterId, commandScope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      if (!Number.isSafeInteger(input.netMinor + input.vatMinor)
        || input.netMinor + input.vatMinor !== input.grossMinor) {
        throw new FinanceStoreError('INVALID_STATE', 'Disbursement gross must equal net plus VAT exactly.');
      }
      this.assertDocumentVersion(user.firmId, matterId, input.sourceDocumentVersionId);
      const id = randomUUID();
      const createdAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO finance_disbursements (
        id, firm_id, matter_id, supplier, invoice_reference, category, description,
        net_minor, vat_minor, gross_minor, currency, invoice_date, due_on,
        source_document_version_id, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, user.firmId, matterId, input.supplier, input.invoiceReference, input.category,
        input.description, input.netMinor, input.vatMinor, input.grossMinor, input.currency,
        input.invoiceDate, input.dueOn, input.sourceDocumentVersionId, user.id, createdAt,
      );
      this.database.prepare(`INSERT INTO finance_disbursement_events (
        id, firm_id, matter_id, disbursement_id, sequence, event_type, note,
        evidence_document_version_id, occurred_at, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, 1, 'proposed', ?, ?, ?, ?, ?)`).run(
        randomUUID(), user.firmId, matterId, id, 'Disbursement proposed for governed human review.',
        input.sourceDocumentVersionId, createdAt, user.id, createdAt,
      );
      const response = this.getDisbursement(user, matterId, id)!;
      this.saveReceipt(user, 'matter', matterId, commandScope, id,
        input.idempotencyKey, input, response, createdAt);
      this.appendMatterOperational(user, matterId, {
        action: 'finance.disbursement_proposed', entityType: 'finance_disbursement', entityId: id,
        title: 'Disbursement proposed', idempotencyKey: input.idempotencyKey, occurredAt: createdAt,
        safeAfter: { grossMinor: input.grossMinor, currency: 'GBP', sourceDocumentVersionId: input.sourceDocumentVersionId },
      }, audit);
      return response;
    });
  }

  recordDisbursementEvent(
    user: SessionUser,
    matterId: string,
    disbursementId: string,
    input: RecordFinanceDisbursementEventInput,
    audit: AuditContext,
  ) {
    this.requireMatter(user, matterId, 'finance.manage_disbursements');
    const commandScope = `record_disbursement_event:${disbursementId}`;
    const replay = this.receipt<NonNullable<ReturnType<typeof this.getDisbursement>>>(
      user, 'matter', matterId, commandScope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      const disbursement = this.getDisbursement(user, matterId, disbursementId);
      if (!disbursement) throw new FinanceStoreError('NOT_FOUND', 'The disbursement was not found.');
      if (disbursement.version !== input.expectedVersion) throw new FinanceStoreError('CONFLICT', 'The disbursement version is stale.');
      const transitions: Record<string, readonly string[]> = {
        proposed: ['approved', 'cancelled', 'corrected'],
        approved: ['incurred', 'cancelled', 'corrected'],
        incurred: ['paid_external', 'corrected'],
        paid_external: ['corrected'],
        cancelled: [], corrected: [],
      };
      if (!transitions[disbursement.status]?.includes(input.eventType)) {
        throw new FinanceStoreError('INVALID_STATE', `A ${disbursement.status} disbursement cannot become ${input.eventType}.`);
      }
      if (input.eventType === 'paid_external' && !input.evidenceDocumentVersionId) {
        throw new FinanceStoreError('INVALID_LINK', 'External payment requires exact retained evidence.');
      }
      this.assertDocumentVersion(user.firmId, matterId, input.evidenceDocumentVersionId);
      const occurredAt = canonicalTimestamp(input.occurredAt, 'Disbursement event timestamp');
      const latestAt = disbursement.events.at(-1)?.occurredAt;
      if (latestAt && Date.parse(occurredAt) <= Date.parse(latestAt)) {
        throw new FinanceStoreError('INVALID_STATE', 'Disbursement events must be recorded in chronological order.');
      }
      const recordedAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO finance_disbursement_events (
        id, firm_id, matter_id, disbursement_id, sequence, event_type, note,
        evidence_document_version_id, occurred_at, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        randomUUID(), user.firmId, matterId, disbursementId, input.expectedVersion + 1, input.eventType, input.note,
        input.evidenceDocumentVersionId, occurredAt, user.id, recordedAt,
      );
      if (['approved', 'incurred', 'paid_external'].includes(input.eventType)) {
        this.openEstimateWarnings(user, matterId, occurredAt, input.idempotencyKey, audit);
      }
      const response = this.getDisbursement(user, matterId, disbursementId)!;
      this.saveReceipt(user, 'matter', matterId, commandScope, disbursementId,
        input.idempotencyKey, input, response, recordedAt);
      this.appendMatterOperational(user, matterId, {
        action: `finance.disbursement_${input.eventType}`, entityType: 'finance_disbursement', entityId: disbursementId,
        title: `Disbursement ${input.eventType.replaceAll('_', ' ')}`,
        idempotencyKey: input.idempotencyKey, occurredAt,
        safeAfter: { eventType: input.eventType, grossMinor: disbursement.grossMinor, currency: 'GBP', evidenceDocumentVersionId: input.evidenceDocumentVersionId },
      }, audit);
      return response;
    });
  }

  private resolveOpenPeriod(firmId: string, accountingDate: string) {
    const periods = this.database.prepare(`SELECT id, starts_on AS startsOn, ends_on AS endsOn
      FROM finance_accounting_periods WHERE firm_id = ? AND status = 'open'
      AND starts_on <= ? AND ends_on >= ? ORDER BY starts_on DESC, id`)
      .all(firmId, accountingDate, accountingDate) as Row[];
    if (periods.length !== 1) {
      throw new FinanceStoreError('INVALID_STATE', periods.length === 0
        ? 'No open accounting period covers this date.'
        : 'More than one open accounting period covers this date.');
    }
    return { id: String(periods[0]!.id), startsOn: String(periods[0]!.startsOn), endsOn: String(periods[0]!.endsOn) };
  }

  private validateJournalInput(
    user: SessionUser,
    matterId: string,
    accountingDate: string,
    lines: PrepareFinanceJournalInput['lines'],
  ) {
    const period = this.resolveOpenPeriod(user.firmId, accountingDate);
    const totals = validateJournalLines(lines);
    const normalisedLines = lines.map((line, index) => {
      if (line.matterId && line.matterId !== matterId) {
        throw new FinanceStoreError('INVALID_LINK', 'A journal line belongs to another matter.');
      }
      const account = this.database.prepare(`SELECT id, account_class AS accountClass,
        designation, currency, active FROM finance_accounts WHERE id = ? AND firm_id = ?`)
        .get(line.accountId, user.firmId) as Row | undefined;
      if (!account || !Boolean(account.active)) throw new FinanceStoreError('INVALID_LINK', 'A journal account was not found.');
      if (account.currency !== line.currency) throw new FinanceStoreError('INVALID_STATE', 'Journal and account currencies must match.');
      if (account.designation !== 'neutral') {
        throw new FinanceStoreError(
          'INVALID_STATE',
          'Client and office account posting is unavailable until the governed cashroom is connected.',
        );
      }
      return {
        lineNumber: index + 1, accountId: String(account.id), accountClass: String(account.accountClass),
        designation: String(account.designation) as 'neutral', matterId,
        debitMinor: line.debitMinor, creditMinor: line.creditMinor, currency: 'GBP' as const, memo: line.memo,
      };
    });
    return { period, totals, lines: normalisedLines };
  }

  private assertJournalSource(
    user: SessionUser,
    matterId: string,
    sourceKind: PrepareFinanceJournalInput['sourceKind'],
    sourceId: string,
  ): void {
    if (sourceKind === 'reversal') {
      throw new FinanceStoreError('INVALID_STATE', 'Use the governed reversal command for reversal journals.');
    }
    if (sourceKind === 'wip_control') {
      const time = this.getTimeEntry(user, matterId, sourceId);
      if (!time || time.status !== 'approved') throw new FinanceStoreError('INVALID_LINK', 'The approved WIP source was not found.');
      return;
    }
    if (sourceKind === 'disbursement_control') {
      const disbursement = this.getDisbursement(user, matterId, sourceId);
      if (!disbursement || !['approved', 'incurred', 'paid_external'].includes(disbursement.status)) {
        throw new FinanceStoreError('INVALID_LINK', 'The approved disbursement source was not found.');
      }
      return;
    }
    this.assertDocumentVersion(user.firmId, matterId, sourceId);
  }

  getJournal(user: SessionUser, matterId: string, journalId: string) {
    if (!this.canReadMatter(user, matterId)) return undefined;
    const journal = this.database.prepare(`SELECT id, period_id AS periodId,
      accounting_date AS accountingDate, source_kind AS sourceKind, source_id AS sourceId,
      description, currency, reverses_journal_id AS reversesJournalId,
      prepared_by AS preparedBy, prepared_at AS preparedAt FROM finance_journals
      WHERE id = ? AND firm_id = ? AND matter_id = ?`)
      .get(journalId, user.firmId, matterId) as Row | undefined;
    if (!journal) return undefined;
    const lines = (this.database.prepare(`SELECT jl.id, jl.line_number AS lineNumber,
      jl.account_id AS accountId, jl.debit_minor AS debitMinor, jl.credit_minor AS creditMinor,
      jl.currency, jl.memo, jl.matter_id AS matterId, a.account_class AS accountClass,
      a.designation, a.code AS accountCode, a.name AS accountName
      FROM finance_journal_lines jl JOIN finance_accounts a
        ON a.id = jl.account_id AND a.firm_id = jl.firm_id
      WHERE jl.journal_id = ? AND jl.firm_id = ? AND jl.matter_id = ? ORDER BY jl.line_number`)
      .all(journalId, user.firmId, matterId) as Row[]).map((line) => ({
        id: String(line.id), lineNumber: Number(line.lineNumber), accountId: String(line.accountId),
        accountClass: String(line.accountClass), designation: String(line.designation) as 'client' | 'office' | 'neutral',
        accountCode: String(line.accountCode), accountName: String(line.accountName), matterId: String(line.matterId),
        debitMinor: Number(line.debitMinor), creditMinor: Number(line.creditMinor), currency: 'GBP' as const, memo: String(line.memo),
      }));
    const events = (this.database.prepare(`SELECT id, sequence, event_type AS eventType, note,
      occurred_at AS occurredAt, recorded_by AS recordedBy, recorded_at AS recordedAt
      FROM finance_journal_events WHERE journal_id = ? AND firm_id = ? AND matter_id = ? ORDER BY sequence`)
      .all(journalId, user.firmId, matterId) as Row[]).map((event) => ({
        id: String(event.id), sequence: Number(event.sequence),
        eventType: String(event.eventType) as 'prepared' | 'approved' | 'posted' | 'rejected' | 'reversed',
        note: String(event.note), occurredAt: String(event.occurredAt),
        recordedBy: String(event.recordedBy), recordedAt: String(event.recordedAt),
      }));
    const latest = events.at(-1)?.eventType ?? 'prepared';
    const status = latest === 'prepared' ? 'draft' as const : latest;
    const totals = validateJournalLines(lines);
    return {
      id: String(journal.id), periodId: String(journal.periodId), accountingDate: String(journal.accountingDate),
      sourceKind: String(journal.sourceKind) as 'wip_control' | 'disbursement_control' | 'reversal' | 'other',
      sourceId: String(journal.sourceId), description: String(journal.description), currency: 'GBP' as const,
      reversesJournalId: journal.reversesJournalId ? String(journal.reversesJournalId) : null,
      preparedBy: String(journal.preparedBy), preparedAt: String(journal.preparedAt),
      approvedBy: [...events].reverse().find(({ eventType }) => eventType === 'approved')?.recordedBy ?? null,
      approvedAt: [...events].reverse().find(({ eventType }) => eventType === 'approved')?.occurredAt ?? null,
      postedBy: [...events].reverse().find(({ eventType }) => eventType === 'posted')?.recordedBy ?? null,
      postedAt: [...events].reverse().find(({ eventType }) => eventType === 'posted')?.occurredAt ?? null,
      status, version: events.length, totalDebitMinor: totals.debitMinor,
      totalCreditMinor: totals.creditMinor, lines, events,
    };
  }

  private validateExistingJournal(user: SessionUser, matterId: string, journal: NonNullable<ReturnType<typeof this.getJournal>>) {
    const validated = this.validateJournalInput(user, matterId, journal.accountingDate, journal.lines.map((line) => ({
      accountId: line.accountId, debitMinor: line.debitMinor, creditMinor: line.creditMinor,
      currency: line.currency, matterId: line.matterId, memo: line.memo,
    })));
    if (validated.period.id !== journal.periodId) throw new FinanceStoreError('INVALID_STATE', 'The journal accounting period changed.');
    return validated;
  }

  prepareJournal(
    user: SessionUser,
    matterId: string,
    input: PrepareFinanceJournalInput,
    audit: AuditContext,
  ) {
    this.requireMatter(user, matterId, 'finance.prepare_journal');
    const commandScope = `prepare_journal:${user.id}`;
    const replay = this.receipt<NonNullable<ReturnType<typeof this.getJournal>>>(
      user, 'matter', matterId, commandScope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      this.assertJournalSource(user, matterId, input.sourceKind, input.sourceId);
      if (this.database.prepare(`SELECT 1 FROM finance_journals WHERE firm_id = ?
        AND source_kind = ? AND source_id = ?`).get(user.firmId, input.sourceKind, input.sourceId)) {
        throw new FinanceStoreError('CONFLICT', 'This exact source already has a finance journal.');
      }
      const validated = this.validateJournalInput(user, matterId, input.accountingDate, input.lines);
      const id = randomUUID();
      const preparedAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO finance_journals (
        id, firm_id, matter_id, period_id, accounting_date, source_kind, source_id,
        description, currency, reverses_journal_id, prepared_by, prepared_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'GBP', NULL, ?, ?)`).run(
        id, user.firmId, matterId, validated.period.id, input.accountingDate,
        input.sourceKind, input.sourceId, input.description, user.id, preparedAt,
      );
      const insertLine = this.database.prepare(`INSERT INTO finance_journal_lines (
        id, firm_id, matter_id, journal_id, line_number, account_id,
        debit_minor, credit_minor, currency, memo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'GBP', ?)`);
      for (const line of validated.lines) insertLine.run(
        randomUUID(), user.firmId, matterId, id, line.lineNumber, line.accountId,
        line.debitMinor, line.creditMinor, line.memo,
      );
      this.database.prepare(`INSERT INTO finance_journal_events (
        id, firm_id, matter_id, journal_id, sequence, event_type, note,
        occurred_at, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, 1, 'prepared', ?, ?, ?, ?)`).run(
        randomUUID(), user.firmId, matterId, id,
        'Balanced journal prepared for independent approval.', preparedAt, user.id, preparedAt,
      );
      const response = this.getJournal(user, matterId, id)!;
      this.saveReceipt(user, 'matter', matterId, commandScope, id,
        input.idempotencyKey, input, response, preparedAt);
      this.appendMatterOperational(user, matterId, {
        action: 'finance.journal_prepared', entityType: 'finance_journal', entityId: id,
        title: 'Balanced finance journal prepared', idempotencyKey: input.idempotencyKey, occurredAt: preparedAt,
        safeAfter: { sourceKind: input.sourceKind, sourceId: input.sourceId, debitMinor: validated.totals.debitMinor, creditMinor: validated.totals.creditMinor, currency: 'GBP' },
      }, audit);
      return response;
    });
  }

  approveJournal(
    user: SessionUser,
    matterId: string,
    journalId: string,
    input: ApproveFinanceJournalInput,
    audit: AuditContext,
  ) {
    this.requireMatter(user, matterId, 'finance.approve_journal');
    const commandScope = `approve_journal:${journalId}`;
    const replay = this.receipt<NonNullable<ReturnType<typeof this.getJournal>>>(
      user, 'matter', matterId, commandScope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      const journal = this.getJournal(user, matterId, journalId);
      if (!journal) throw new FinanceStoreError('NOT_FOUND', 'The journal was not found.');
      if (journal.preparedBy === user.id) throw new FinanceStoreError('INDEPENDENCE_REQUIRED', 'Journal approval requires an independent approver.');
      if (journal.version !== input.expectedVersion) throw new FinanceStoreError('CONFLICT', 'The journal version is stale.');
      if (journal.status !== 'draft') throw new FinanceStoreError('INVALID_STATE', 'Only a draft journal can be approved.');
      const approvedAt = canonicalTimestamp(input.approvedAt, 'Journal approval timestamp');
      if (Date.parse(approvedAt) <= Date.parse(journal.preparedAt)) {
        throw new FinanceStoreError('INVALID_STATE', 'Journal approval must occur after preparation.');
      }
      this.validateExistingJournal(user, matterId, journal);
      const recordedAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO finance_journal_events (
        id, firm_id, matter_id, journal_id, sequence, event_type, note,
        occurred_at, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?)`).run(
        randomUUID(), user.firmId, matterId, journalId, input.expectedVersion + 1,
        input.note, approvedAt, user.id, recordedAt,
      );
      const response = this.getJournal(user, matterId, journalId)!;
      this.saveReceipt(user, 'matter', matterId, commandScope, journalId,
        input.idempotencyKey, input, response, recordedAt);
      this.appendMatterOperational(user, matterId, {
        action: 'finance.journal_approved', entityType: 'finance_journal', entityId: journalId,
        title: 'Finance journal independently approved', idempotencyKey: input.idempotencyKey, occurredAt: approvedAt,
        safeAfter: { debitMinor: journal.totalDebitMinor, creditMinor: journal.totalCreditMinor, currency: 'GBP' },
      }, audit);
      return response;
    });
  }

  postJournal(
    user: SessionUser,
    matterId: string,
    journalId: string,
    input: PostFinanceJournalInput,
    audit: AuditContext,
  ) {
    this.requireMatter(user, matterId, 'finance.post_journal');
    const commandScope = `post_journal:${journalId}`;
    const replay = this.receipt<NonNullable<ReturnType<typeof this.getJournal>>>(
      user, 'matter', matterId, commandScope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      const journal = this.getJournal(user, matterId, journalId);
      if (!journal) throw new FinanceStoreError('NOT_FOUND', 'The journal was not found.');
      if (journal.preparedBy === user.id) throw new FinanceStoreError('INDEPENDENCE_REQUIRED', 'A journal preparer cannot post their own journal.');
      if (journal.version !== input.expectedVersion) throw new FinanceStoreError('CONFLICT', 'The journal version is stale.');
      if (journal.status !== 'approved' || !journal.approvedBy) throw new FinanceStoreError('INVALID_STATE', 'Only an approved journal can be posted.');
      const postedAt = canonicalTimestamp(input.postedAt, 'Journal posting timestamp');
      if (!journal.approvedAt || Date.parse(postedAt) <= Date.parse(journal.approvedAt)) {
        throw new FinanceStoreError('INVALID_STATE', 'Journal posting must occur after approval.');
      }
      this.validateExistingJournal(user, matterId, journal);
      const recordedAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO finance_journal_events (
        id, firm_id, matter_id, journal_id, sequence, event_type, note,
        occurred_at, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?)`).run(
        randomUUID(), user.firmId, matterId, journalId, input.expectedVersion + 1,
        'Balanced journal posted after explicit human confirmation.', postedAt, user.id, recordedAt,
      );
      if (journal.reversesJournalId) {
        const original = this.getJournal(user, matterId, journal.reversesJournalId);
        if (!original || original.status !== 'posted') {
          throw new FinanceStoreError('INVALID_STATE', 'The original journal is not available for reversal.');
        }
        this.database.prepare(`INSERT INTO finance_journal_events (
          id, firm_id, matter_id, journal_id, sequence, event_type, note,
          occurred_at, recorded_by, recorded_at
        ) VALUES (?, ?, ?, ?, ?, 'reversed', ?, ?, ?, ?)`).run(
          randomUUID(), user.firmId, matterId, original.id, original.version + 1,
          `Reversed by posted journal ${journal.id}.`, postedAt, user.id, recordedAt,
        );
        this.appendMatterOperational(user, matterId, {
          action: 'finance.journal_reversed', entityType: 'finance_journal', entityId: original.id,
          title: 'Posted finance journal reversed',
          idempotencyKey: `${input.idempotencyKey}:original:${original.id}`, occurredAt: postedAt,
          safeAfter: { reversalJournalId: journal.id },
        }, audit);
      }
      const response = this.getJournal(user, matterId, journalId)!;
      this.saveReceipt(user, 'matter', matterId, commandScope, journalId,
        input.idempotencyKey, input, response, recordedAt);
      this.appendMatterOperational(user, matterId, {
        action: 'finance.journal_posted', entityType: 'finance_journal', entityId: journalId,
        title: 'Balanced finance journal posted', idempotencyKey: input.idempotencyKey, occurredAt: postedAt,
        safeAfter: { debitMinor: journal.totalDebitMinor, creditMinor: journal.totalCreditMinor, currency: 'GBP', reversesJournalId: journal.reversesJournalId },
      }, audit);
      return response;
    });
  }

  reverseJournal(
    user: SessionUser,
    matterId: string,
    journalId: string,
    input: ReverseFinanceJournalInput,
    audit: AuditContext,
  ) {
    this.requireMatter(user, matterId, 'finance.prepare_journal');
    const commandScope = `reverse_journal:${journalId}`;
    const replay = this.receipt<NonNullable<ReturnType<typeof this.getJournal>>>(
      user, 'matter', matterId, commandScope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      const original = this.getJournal(user, matterId, journalId);
      if (!original) throw new FinanceStoreError('NOT_FOUND', 'The journal was not found.');
      if (original.status !== 'posted') throw new FinanceStoreError('INVALID_STATE', 'Only a posted journal can be reversed.');
      if (this.database.prepare(`SELECT 1 FROM finance_journals WHERE firm_id = ? AND matter_id = ?
        AND reverses_journal_id = ?`).get(user.firmId, matterId, journalId)) {
        throw new FinanceStoreError('CONFLICT', 'A reversal journal already exists for this journal.');
      }
      const period = this.resolveOpenPeriod(user.firmId, input.accountingDate);
      const inverted = original.lines.map((line) => ({
        accountId: line.accountId, debitMinor: line.creditMinor, creditMinor: line.debitMinor,
        currency: line.currency, matterId, memo: `Reversal: ${line.memo}`,
      }));
      const totals = validateJournalLines(inverted);
      const id = randomUUID();
      const preparedAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO finance_journals (
        id, firm_id, matter_id, period_id, accounting_date, source_kind, source_id,
        description, currency, reverses_journal_id, prepared_by, prepared_at
      ) VALUES (?, ?, ?, ?, ?, 'reversal', ?, ?, 'GBP', ?, ?, ?)`).run(
        id, user.firmId, matterId, period.id, input.accountingDate, journalId,
        `Reversal: ${input.reason}`, journalId, user.id, preparedAt,
      );
      const insertLine = this.database.prepare(`INSERT INTO finance_journal_lines (
        id, firm_id, matter_id, journal_id, line_number, account_id,
        debit_minor, credit_minor, currency, memo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'GBP', ?)`);
      inverted.forEach((line, index) => insertLine.run(
        randomUUID(), user.firmId, matterId, id, index + 1, line.accountId,
        line.debitMinor, line.creditMinor, line.memo,
      ));
      this.database.prepare(`INSERT INTO finance_journal_events (
        id, firm_id, matter_id, journal_id, sequence, event_type, note,
        occurred_at, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, 1, 'prepared', ?, ?, ?, ?)`).run(
        randomUUID(), user.firmId, matterId, id, input.reason, preparedAt, user.id, preparedAt,
      );
      const response = this.getJournal(user, matterId, id)!;
      this.saveReceipt(user, 'matter', matterId, commandScope, id,
        input.idempotencyKey, input, response, preparedAt);
      this.appendMatterOperational(user, matterId, {
        action: 'finance.journal_reversal_prepared', entityType: 'finance_journal', entityId: id,
        title: 'Finance journal reversal prepared', idempotencyKey: input.idempotencyKey, occurredAt: preparedAt,
        safeAfter: { reversesJournalId: journalId, debitMinor: totals.debitMinor, creditMinor: totals.creditMinor, currency: 'GBP' },
      }, audit);
      return response;
    });
  }

  getWorkspace(user: SessionUser, matterId: string) {
    if (!this.canReadMatter(user, matterId)) return undefined;
    const suggestionIds = this.database.prepare(`SELECT id FROM finance_activity_suggestions
      WHERE firm_id = ? AND matter_id = ? ORDER BY created_at, id`)
      .all(user.firmId, matterId) as Array<{ id: string }>;
    const suggestions = suggestionIds.map(({ id }) => this.getSuggestion(user, matterId, id)!);
    const timerIds = this.database.prepare(`SELECT id FROM finance_timer_sessions
      WHERE firm_id = ? AND matter_id = ? ORDER BY created_at, id`)
      .all(user.firmId, matterId) as Array<{ id: string }>;
    const timers = timerIds.map(({ id }) => this.getTimer(user, matterId, id)!);
    const timeIds = this.database.prepare(`SELECT id FROM finance_time_entries
      WHERE firm_id = ? AND matter_id = ? ORDER BY work_date, created_at, id`)
      .all(user.firmId, matterId) as Array<{ id: string }>;
    const timeEntries = timeIds.map(({ id }) => this.getTimeEntry(user, matterId, id)!);
    const estimates = this.listEstimateVersions(user, matterId);
    const activeEstimate = this.activeEstimateVersion(user, matterId, this.now().toISOString().slice(0, 10));
    const warnings = this.listWarnings(user, matterId);
    const disbursements = this.listDisbursements(user, matterId);
    const journalIds = this.database.prepare(`SELECT id FROM finance_journals
      WHERE firm_id = ? AND matter_id = ? ORDER BY accounting_date, prepared_at, id`)
      .all(user.firmId, matterId) as Array<{ id: string }>;
    const journals = journalIds.map(({ id }) => this.getJournal(user, matterId, id)!);
    const balances = projectAccountBalances(journals.map((journal) => ({
      id: journal.id,
      status: journal.status,
      lines: journal.lines.map((line) => ({
        accountId: line.accountId, matterId: line.matterId, designation: line.designation,
        debitMinor: line.debitMinor, creditMinor: line.creditMinor, currency: line.currency,
      })),
    })));
    const submittedActivitySources = new Set(timeEntries.flatMap((entry) => entry.sourceId ? [
      `${entry.userId}\u0000${entry.sourceKind}\u0000${entry.sourceId}`,
    ] : []));
    const submittedTimerIds = new Set(timeEntries.flatMap((entry) =>
      entry.sourceKind === 'timer' && entry.sourceId ? [entry.sourceId] : []));
    const provisionalTime = [
      ...suggestions.filter((suggestion) => suggestion.status === 'pending' || (
        suggestion.status === 'accept'
        && !submittedActivitySources.has(
          `${suggestion.userId}\u0000${suggestion.sourceKind}\u0000${suggestion.sourceId}`,
        )
      )).map((suggestion) => ({
        minutes: suggestion.minutes, estimatedChargeMinor: this.estimateRate(
          user.firmId, matterId, suggestion.userId, suggestion.proposedActivityCode,
          String(suggestion.observedAt).slice(0, 10), suggestion.minutes,
        ),
      })),
      ...timers.filter((timer) => timer.status === 'stopped'
        && timer.elapsedMinutes !== null
        && !submittedTimerIds.has(timer.id)).map((timer) => ({
        minutes: timer.elapsedMinutes!, estimatedChargeMinor: this.estimateRate(
          user.firmId, matterId, timer.userId, timer.activityCode,
          String(timer.startedAt).slice(0, 10), timer.elapsedMinutes!,
        ),
      })),
      ...timeEntries.filter(({ status }) => status === 'submitted').map((entry) => ({
        minutes: entry.minutes,
        estimatedChargeMinor: entry.chargeable ? this.estimateRate(
          user.firmId, matterId, entry.userId, entry.activityCode, entry.workDate, entry.minutes,
        ) : 0,
      })),
    ];
    const snapshot = projectMatterFinance({
      provisionalTime,
      approvedTime: timeEntries.filter(({ status }) => status === 'approved').map((entry) => ({
        minutes: entry.minutes, chargeMinor: entry.chargeMinor ?? 0,
      })),
      disbursements: disbursements.flatMap((disbursement) => {
        if (!['proposed', 'approved', 'incurred', 'paid_external', 'cancelled'].includes(disbursement.status)) return [];
        return [{
          id: disbursement.id,
          status: disbursement.status as 'proposed' | 'approved' | 'incurred' | 'paid_external' | 'cancelled',
          grossMinor: disbursement.grossMinor,
        }];
      }),
      activeEstimate: activeEstimate
        ? { versionId: activeEstimate.id, overallLimitMinor: activeEstimate.overallLimitMinor }
        : null,
    });
    const sourceVersionIds = new Set<string>();
    if (user.role !== 'finance') {
      for (const suggestion of suggestions) {
        if (suggestion.sourceKind === 'document_version') sourceVersionIds.add(suggestion.sourceId);
      }
      for (const entry of timeEntries) {
        if (entry.sourceKind === 'document_version' && entry.sourceId) sourceVersionIds.add(entry.sourceId);
      }
    }
    for (const estimate of estimates) {
      if (estimate.sourceDocumentVersionId) sourceVersionIds.add(estimate.sourceDocumentVersionId);
    }
    for (const warning of warnings) {
      for (const event of warning.events) {
        if (event.evidenceDocumentVersionId) sourceVersionIds.add(event.evidenceDocumentVersionId);
      }
    }
    for (const disbursement of disbursements) {
      if (disbursement.sourceDocumentVersionId) sourceVersionIds.add(disbursement.sourceDocumentVersionId);
      for (const event of disbursement.events) {
        if (event.evidenceDocumentVersionId) sourceVersionIds.add(event.evidenceDocumentVersionId);
      }
    }
    for (const journal of journals) {
      if (journal.sourceKind === 'other') sourceVersionIds.add(journal.sourceId);
    }
    const sourceQuery = this.database.prepare(`SELECT dv.id, d.id AS documentId,
      d.title, d.category, dv.version, dv.original_name AS originalName
      FROM document_versions dv JOIN documents d
        ON d.id = dv.document_id AND d.firm_id = dv.firm_id
      WHERE dv.id = ? AND dv.firm_id = ? AND d.matter_id = ?`);
    const sourceDocuments = [...sourceVersionIds].sort().flatMap((versionId) => {
      const source = sourceQuery.get(versionId, user.firmId, matterId) as Row | undefined;
      return source ? [{
        id: String(source.id), documentId: String(source.documentId), title: String(source.title),
        category: String(source.category), version: Number(source.version), originalName: String(source.originalName),
      }] : [];
    });
    return {
      matterId,
      actingUserId: user.id,
      permissions: {
        canRecordTime: hasCapability(user, 'finance.record_time'),
        canApproveTime: hasCapability(user, 'finance.approve_time'),
        canManageRates: hasCapability(user, 'finance.manage_rates'),
        canManageEstimates: hasCapability(user, 'finance.manage_estimates'),
        canManageDisbursements: hasCapability(user, 'finance.manage_disbursements'),
        canPrepareJournal: hasCapability(user, 'finance.prepare_journal'),
        canApproveJournal: hasCapability(user, 'finance.approve_journal'),
        canPostJournal: hasCapability(user, 'finance.post_journal'),
      },
      suggestions,
      timers,
      timeEntries,
      warnings,
      estimates,
      disbursements,
      ledger: { journals, balances },
      snapshot,
      sources: { documents: sourceDocuments },
    };
  }

  private estimateRate(
    firmId: string,
    matterId: string,
    userId: string,
    activityCode: string,
    workDate: string,
    minutes: number,
  ): number | null {
    try {
      const rate = this.resolveRate(firmId, matterId, userId, activityCode, workDate);
      return calculateTimeValue({ minutes, hourlyRateMinor: rate.hourlyRateMinor }).chargeMinor;
    } catch (error) {
      if (error instanceof FinanceStoreError && (error.code === 'RATE_NOT_FOUND' || error.code === 'CONFLICT')) return null;
      throw error;
    }
  }
}
