import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { canReadAllFirmMatters, type SessionUser } from '../policy.js';
import { appendAudit, appendTimeline, type AuditContext } from '../store.js';
import type { ClosureBlocker, ClosureDecisionInput, LegalHoldInput, PrepareClosureInput, ReopenMatterInput } from './types.js';

type Row = Record<string, string | number | null>;

export type ClosureStoreErrorCode =
  | 'NOT_FOUND' | 'CONFLICT' | 'INVALID_STATE' | 'IDEMPOTENCY_KEY_REUSED'
  | 'INDEPENDENCE_REQUIRED' | 'STALE_REVIEW' | 'INVALID_LINK';

export class ClosureStoreError extends Error {
  constructor(readonly code: ClosureStoreErrorCode, message: string) {
    super(message);
    this.name = 'ClosureStoreError';
  }
}

function canonical(value: unknown): string {
  const visit = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(visit);
    if (input && typeof input === 'object') return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, visit(child)]),
    );
    return input;
  };
  return JSON.stringify(visit(value));
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

export class ClosureStore {
  constructor(private readonly database: DatabaseSync, private readonly now: () => Date = () => new Date()) {}

  canRead(user: SessionUser, matterId: string): boolean {
    if (canReadAllFirmMatters(user)) return Boolean(this.database.prepare(
      'SELECT 1 FROM matters WHERE id=? AND firm_id=?',
    ).get(matterId, user.firmId));
    return Boolean(this.database.prepare(`SELECT 1 FROM matters m WHERE m.id=? AND m.firm_id=? AND
      (m.owner_user_id=? OR EXISTS (SELECT 1 FROM matter_members mm WHERE mm.firm_id=m.firm_id AND mm.matter_id=m.id AND mm.user_id=?))`)
      .get(matterId, user.firmId, user.id, user.id));
  }

  private requireMatter(user: SessionUser, matterId: string): Row {
    if (!this.canRead(user, matterId)) throw new ClosureStoreError('NOT_FOUND', 'The closure workspace was not found.');
    return this.database.prepare(`SELECT id,status,opened_at AS openedAt,owner_user_id AS ownerUserId
      FROM matters WHERE id=? AND firm_id=?`).get(matterId, user.firmId) as Row;
  }

  getSnapshot(user: SessionUser, matterId: string) {
    this.requireMatter(user, matterId);
    const blockers: ClosureBlocker[] = [];
    const tasks = this.database.prepare(`SELECT id,title FROM tasks WHERE firm_id=? AND matter_id=? AND status IN ('open','in_progress') ORDER BY id`)
      .all(user.firmId, matterId) as Row[];
    for (const task of tasks) blockers.push({
      key: `task:${String(task.id)}`, category: 'task', label: String(task.title), severity: 'residual',
      transferable: true, sourceId: String(task.id),
    });

    const deadlines = this.database.prepare(`SELECT md.id,md.title FROM matter_deadlines md WHERE md.firm_id=? AND md.matter_id=?
      AND COALESCE((SELECT dse.status FROM deadline_status_events dse WHERE dse.firm_id=md.firm_id AND dse.deadline_id=md.id
        ORDER BY dse.occurred_at DESC,dse.id DESC LIMIT 1),md.initial_status)='pending' ORDER BY md.id`)
      .all(user.firmId, matterId) as Row[];
    for (const deadline of deadlines) blockers.push({
      key: `deadline:${String(deadline.id)}`, category: 'court_deadline', label: String(deadline.title),
      severity: 'critical', transferable: false, sourceId: String(deadline.id),
    });

    const obligations = this.database.prepare(`SELECT so.id,so.description FROM settlement_obligations so WHERE so.firm_id=? AND so.matter_id=?
      AND COALESCE((SELECT soe.event_type FROM settlement_obligation_events soe WHERE soe.firm_id=so.firm_id
        AND soe.matter_id=so.matter_id AND soe.obligation_id=so.id AND NOT EXISTS
        (SELECT 1 FROM settlement_obligation_events correction WHERE correction.firm_id=soe.firm_id
          AND correction.matter_id=soe.matter_id AND correction.supersedes_event_id=soe.id)
        ORDER BY soe.occurred_at DESC,soe.recorded_at DESC,soe.id DESC LIMIT 1),'open') NOT IN ('satisfied','waived') ORDER BY so.id`)
      .all(user.firmId, matterId) as Row[];
    for (const obligation of obligations) blockers.push({
      key: `settlement:${String(obligation.id)}`, category: 'settlement_obligation', label: String(obligation.description),
      severity: 'critical', transferable: false, sourceId: String(obligation.id),
    });

    const clientFunds = this.database.prepare(`SELECT a.client_party_id AS clientId,
      SUM(CASE WHEN a.designation='client' THEN a.amount_minor ELSE 0 END) -
      COALESCE((SELECT SUM(p.amount_minor) FROM finance_payment_requisitions p WHERE p.firm_id=a.firm_id AND p.matter_id=a.matter_id
        AND p.client_party_id=a.client_party_id AND EXISTS (SELECT 1 FROM finance_payment_events e WHERE e.firm_id=p.firm_id
          AND e.matter_id=p.matter_id AND e.payment_id=p.id AND e.event_type='recorded_external')),0) -
      COALESCE((SELECT SUM(t.amount_minor) FROM finance_client_office_transfers t WHERE t.firm_id=a.firm_id AND t.matter_id=a.matter_id
        AND t.client_party_id=a.client_party_id AND EXISTS (SELECT 1 FROM finance_transfer_events e WHERE e.firm_id=t.firm_id
          AND e.matter_id=t.matter_id AND e.transfer_id=t.id AND e.event_type='posted')),0) AS balance
      FROM finance_receipt_allocations a WHERE a.firm_id=? AND a.matter_id=? AND a.reverses_allocation_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM finance_receipt_allocations r WHERE r.firm_id=a.firm_id AND r.reverses_allocation_id=a.id)
      GROUP BY a.client_party_id HAVING balance<>0 ORDER BY a.client_party_id`).all(user.firmId, matterId) as Row[];
    for (const funds of clientFunds) blockers.push({
      key: `client-money:${String(funds.clientId)}`, category: 'client_money',
      label: `Client balance must be cleared (${Number(funds.balance)} minor units).`, severity: 'critical', transferable: false,
      sourceId: String(funds.clientId),
    });

    const billIds = (this.database.prepare('SELECT id FROM finance_bills WHERE firm_id=? AND matter_id=? ORDER BY id')
      .all(user.firmId, matterId) as Row[]).map((row) => String(row.id));
    for (const billId of billIds) {
      const bill = this.database.prepare(`SELECT bv.gross_minor AS gross FROM finance_bill_versions bv
        JOIN finance_bill_events be ON be.bill_version_id=bv.id AND be.firm_id=bv.firm_id AND be.matter_id=bv.matter_id
        WHERE bv.firm_id=? AND bv.matter_id=? AND bv.bill_id=? AND be.event_type IN ('issued','delivered')
        ORDER BY bv.version_number DESC LIMIT 1`).get(user.firmId, matterId, billId) as Row | undefined;
      if (!bill) continue;
      const paid = this.database.prepare(`SELECT
        COALESCE((SELECT SUM(amount_minor) FROM finance_receipt_allocations a WHERE a.firm_id=? AND a.matter_id=? AND a.bill_id=?
          AND a.designation='office' AND a.reverses_allocation_id IS NULL AND NOT EXISTS
          (SELECT 1 FROM finance_receipt_allocations r WHERE r.firm_id=a.firm_id AND r.reverses_allocation_id=a.id)),0)+
        COALESCE((SELECT SUM(t.amount_minor) FROM finance_client_office_transfers t WHERE t.firm_id=? AND t.matter_id=? AND t.bill_id=?
          AND EXISTS (SELECT 1 FROM finance_transfer_events e WHERE e.firm_id=t.firm_id AND e.matter_id=t.matter_id
            AND e.transfer_id=t.id AND e.event_type='posted')),0) AS paid`)
        .get(user.firmId, matterId, billId, user.firmId, matterId, billId) as Row;
      const outstanding = Number(bill.gross) - Number(paid.paid);
      if (outstanding !== 0) blockers.push({ key: `office-balance:${billId}`, category: 'office_balance',
        label: `Issued bill has ${outstanding} minor units outstanding.`, severity: 'critical', transferable: false, sourceId: billId });
    }

    blockers.sort((a, b) => a.key.localeCompare(b.key));
    return { blockers, hash: hash(blockers), calculatedAt: this.now().toISOString() };
  }

  private replay(user: SessionUser, matterId: string, type: string, key: string, input: unknown): boolean {
    const found = this.database.prepare(`SELECT payload_hash AS payloadHash FROM closure_command_receipts
      WHERE firm_id=? AND matter_id=? AND command_type=? AND idempotency_key=?`)
      .get(user.firmId, matterId, type, key) as Row | undefined;
    if (!found) return false;
    if (String(found.payloadHash) !== hash(input)) throw new ClosureStoreError('IDEMPOTENCY_KEY_REUSED', 'The idempotency key was reused with different input.');
    return true;
  }

  private saveReceipt(user: SessionUser, matterId: string, type: string, key: string, input: unknown, result: unknown, at: string) {
    this.database.prepare(`INSERT INTO closure_command_receipts
      (id,firm_id,matter_id,command_type,idempotency_key,payload_hash,result_json,actor_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(randomUUID(), user.firmId, matterId, type, key, hash(input), canonical(result), user.id, at);
  }

  private appendEvent(user: SessionUser, matterId: string, type: 'prepared'|'approved'|'closed'|'reopened', reviewId: string | null,
    reason: string, ownerId: string | null, at: string) {
    const id = randomUUID();
    const sequence = Number((this.database.prepare('SELECT COUNT(*)+1 AS next FROM matter_closure_events WHERE firm_id=? AND matter_id=?')
      .get(user.firmId, matterId) as Row).next);
    this.database.prepare(`INSERT INTO matter_closure_events
      (id,firm_id,matter_id,sequence,event_type,review_id,reason,responsible_owner_user_id,explicit_human_authority,recorded_by,recorded_at)
      VALUES (?,?,?,?,?,?,?,?,1,?,?)`).run(id, user.firmId, matterId, sequence, type, reviewId, reason, ownerId, user.id, at);
    return id;
  }

  private operational(user: SessionUser, matterId: string, action: string, entityId: string, at: string, audit: AuditContext) {
    appendTimeline(this.database, { firmId: user.firmId, matterId, type: action, title: action === 'matter.closed' ? 'Matter closed' : 'Matter closure reviewed', actorUserId: user.id, occurredAt: at, metadata: { entityType: 'matter_closure_review', entityId } });
    appendAudit(this.database, { firmId: user.firmId, matterId, userId: user.id, action, entityType: 'matter_closure_review', entityId,
      after: { reviewId: entityId }, requestId: audit.requestId, ipAddress: audit.ipAddress, createdAt: at });
    this.database.prepare(`INSERT INTO integration_outbox (id,firm_id,matter_id,topic,payload_json,status,attempts,available_at,created_at,deduplication_key)
      VALUES (?,?,?,?,?,'pending',0,?,?,?)`).run(randomUUID(), user.firmId, matterId, action, canonical({ matterId, reviewId: entityId }), at, at,
      `closure:${user.firmId}:${matterId}:${action}:${entityId}`);
  }

  prepare(user: SessionUser, matterId: string, input: PrepareClosureInput, expectedHash: string, audit: AuditContext) {
    this.requireMatter(user, matterId);
    if (this.replay(user, matterId, 'prepare', input.idempotencyKey, input)) return this.getWorkspace(user, matterId);
    return transaction(this.database, () => {
      const matter = this.requireMatter(user, matterId);
      if (String(matter.status) !== 'open' && String(matter.status) !== 'on_hold') throw new ClosureStoreError('INVALID_STATE', 'Only an active matter can enter closure review.');
      const snapshot = this.getSnapshot(user, matterId);
      if (snapshot.hash !== expectedHash) throw new ClosureStoreError('STALE_REVIEW', 'The closure facts changed before preparation.');
      if (!this.database.prepare(`SELECT 1 FROM document_versions dv JOIN documents d ON d.id=dv.document_id AND d.firm_id=dv.firm_id
        WHERE dv.id=? AND dv.firm_id=? AND d.matter_id=?`).get(input.finalClientReportDocumentVersionId, user.firmId, matterId))
        throw new ClosureStoreError('INVALID_LINK', 'The exact final client report version was not found.');
      const at = this.now().toISOString();
      const reviewId = randomUUID();
      const sequence = Number((this.database.prepare('SELECT COUNT(*)+1 AS next FROM matter_closure_reviews WHERE firm_id=? AND matter_id=?')
        .get(user.firmId, matterId) as Row).next);
      this.database.prepare(`INSERT INTO matter_closure_reviews
        (id,firm_id,matter_id,sequence,snapshot_hash,outcome,closure_reason,lessons,final_client_report_status,
        final_client_report_document_version_id,documents_position,documents_note,retention_basis,retention_until,
        undertakings_confirmed_clear,complaints_confirmed_clear,attestation_note,prepared_by,prepared_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,?,?,?)`).run(reviewId, user.firmId, matterId, sequence, snapshot.hash,
        input.outcome, input.closureReason, input.lessons, input.finalClientReportStatus, input.finalClientReportDocumentVersionId,
        input.documentsPosition, input.documentsNote, input.retentionBasis, input.retentionUntil, input.attestationNote, user.id, at);
      const insertBlocker = this.database.prepare(`INSERT INTO matter_closure_blockers
        (id,firm_id,matter_id,review_id,blocker_key,category,label,severity,transferable,source_id,source_fingerprint)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
      for (const blocker of snapshot.blockers) insertBlocker.run(randomUUID(), user.firmId, matterId, reviewId, blocker.key,
        blocker.category, blocker.label, blocker.severity, blocker.transferable ? 1 : 0, blocker.sourceId, hash(blocker));
      const insertObligation = this.database.prepare(`INSERT INTO post_closure_obligations
        (id,firm_id,matter_id,review_id,blocker_key,title,reason,owner_user_id,due_on,status,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,'open',?,?)`);
      for (const transfer of input.transfers) {
        const blocker = snapshot.blockers.find(({ key }) => key === transfer.blockerKey)!;
        if (!this.database.prepare('SELECT 1 FROM users WHERE id=? AND firm_id=? AND active=1').get(transfer.ownerUserId, user.firmId))
          throw new ClosureStoreError('INVALID_LINK', 'The post-closure obligation owner was not found.');
        insertObligation.run(randomUUID(), user.firmId, matterId, reviewId, transfer.blockerKey, blocker.label,
          transfer.reason, transfer.ownerUserId, transfer.dueOn, user.id, at);
      }
      this.appendEvent(user, matterId, 'prepared', reviewId, input.closureReason, null, at);
      this.operational(user, matterId, 'matter.closure_prepared', reviewId, at, audit);
      this.saveReceipt(user, matterId, 'prepare', input.idempotencyKey, input, { reviewId }, at);
      return this.getWorkspace(user, matterId);
    });
  }

  approve(user: SessionUser, matterId: string, reviewId: string, input: ClosureDecisionInput, audit: AuditContext) {
    this.requireMatter(user, matterId);
    if (this.replay(user, matterId, 'approve', input.idempotencyKey, { reviewId, input })) return this.getWorkspace(user, matterId);
    return transaction(this.database, () => {
      const review = this.database.prepare(`SELECT prepared_by AS preparedBy,snapshot_hash AS snapshotHash FROM matter_closure_reviews
        WHERE id=? AND firm_id=? AND matter_id=?`).get(reviewId, user.firmId, matterId) as Row | undefined;
      if (!review) throw new ClosureStoreError('NOT_FOUND', 'The closure review was not found.');
      if (String(review.preparedBy) === user.id) throw new ClosureStoreError('INDEPENDENCE_REQUIRED', 'Closure approval requires an independent person.');
      if (this.getSnapshot(user, matterId).hash !== String(review.snapshotHash)) throw new ClosureStoreError('STALE_REVIEW', 'The closure facts changed after preparation.');
      if (this.database.prepare(`SELECT 1 FROM matter_closure_events WHERE firm_id=? AND matter_id=? AND review_id=? AND event_type IN ('approved','closed')`)
        .get(user.firmId, matterId, reviewId)) throw new ClosureStoreError('INVALID_STATE', 'The closure review has already been decided.');
      const at = this.now().toISOString();
      this.appendEvent(user, matterId, 'approved', reviewId, input.note, null, at);
      this.operational(user, matterId, 'matter.closure_approved', reviewId, at, audit);
      this.saveReceipt(user, matterId, 'approve', input.idempotencyKey, { reviewId, input }, { reviewId }, at);
      return this.getWorkspace(user, matterId);
    });
  }

  close(user: SessionUser, matterId: string, reviewId: string, input: ClosureDecisionInput, audit: AuditContext) {
    this.requireMatter(user, matterId);
    if (this.replay(user, matterId, 'close', input.idempotencyKey, { reviewId, input })) return this.getWorkspace(user, matterId);
    return transaction(this.database, () => {
      const matter = this.requireMatter(user, matterId);
      const review = this.database.prepare(`SELECT snapshot_hash AS snapshotHash,retention_basis AS retentionBasis,
        retention_until AS retentionUntil FROM matter_closure_reviews WHERE id=? AND firm_id=? AND matter_id=?`)
        .get(reviewId, user.firmId, matterId) as Row | undefined;
      if (!review) throw new ClosureStoreError('NOT_FOUND', 'The closure review was not found.');
      if (!this.database.prepare(`SELECT 1 FROM matter_closure_events WHERE firm_id=? AND matter_id=? AND review_id=? AND event_type='approved'`)
        .get(user.firmId, matterId, reviewId)) throw new ClosureStoreError('INVALID_STATE', 'The exact closure review requires independent approval.');
      if (this.getSnapshot(user, matterId).hash !== String(review.snapshotHash)) throw new ClosureStoreError('STALE_REVIEW', 'The closure facts changed after approval.');
      if (String(matter.status) === 'closed' || String(matter.status) === 'archived') throw new ClosureStoreError('INVALID_STATE', 'The matter is already closed.');
      const at = this.now().toISOString();
      const eventId = this.appendEvent(user, matterId, 'closed', reviewId, input.note, null, at);
      const ordinal = Number((this.database.prepare('SELECT COUNT(*)+1 AS next FROM matter_active_periods WHERE firm_id=? AND matter_id=?')
        .get(user.firmId, matterId) as Row).next);
      const reopened = this.database.prepare(`SELECT id,recorded_at AS recordedAt FROM matter_closure_events WHERE firm_id=? AND matter_id=?
        AND event_type='reopened' ORDER BY sequence DESC LIMIT 1`).get(user.firmId, matterId) as Row | undefined;
      const openedAt = reopened ? String(reopened.recordedAt) : `${String(matter.openedAt)}T00:00:00.000Z`;
      this.database.prepare(`INSERT INTO matter_active_periods
        (id,firm_id,matter_id,ordinal,opened_at,closed_at,closure_event_id,opened_by_event_id) VALUES (?,?,?,?,?,?,?,?)`)
        .run(randomUUID(), user.firmId, matterId, ordinal, openedAt, at, eventId, reopened ? String(reopened.id) : null);
      this.database.prepare(`INSERT INTO retention_schedules
        (id,firm_id,matter_id,review_id,basis,retention_until,destruction_eligible_on,automatic_destruction,recorded_by,recorded_at)
        VALUES (?,?,?,?,?,?,?,0,?,?)`).run(randomUUID(), user.firmId, matterId, reviewId, review.retentionBasis,
        review.retentionUntil, review.retentionUntil, user.id, at);
      this.database.prepare(`UPDATE matters SET status='closed',stage='Closed',updated_at=? WHERE id=? AND firm_id=?`).run(at, matterId, user.firmId);
      this.operational(user, matterId, 'matter.closed', reviewId, at, audit);
      this.saveReceipt(user, matterId, 'close', input.idempotencyKey, { reviewId, input }, { reviewId, eventId }, at);
      return this.getWorkspace(user, matterId);
    });
  }

  reopen(user: SessionUser, matterId: string, input: ReopenMatterInput, audit: AuditContext) {
    this.requireMatter(user, matterId);
    if (this.replay(user, matterId, 'reopen', input.idempotencyKey, input)) return this.getWorkspace(user, matterId);
    return transaction(this.database, () => {
      const matter = this.requireMatter(user, matterId);
      if (String(matter.status) !== 'closed' && String(matter.status) !== 'archived')
        throw new ClosureStoreError('INVALID_STATE', 'Only a closed or archived matter can be reopened.');
      if (!this.database.prepare('SELECT 1 FROM users WHERE id=? AND firm_id=? AND active=1')
        .get(input.newOwnerUserId, user.firmId)) throw new ClosureStoreError('INVALID_LINK', 'The new responsible owner was not found.');
      const at = this.now().toISOString();
      const eventId = this.appendEvent(user, matterId, 'reopened', null, input.reason, input.newOwnerUserId, at);
      this.database.prepare(`UPDATE matters SET status='open',stage='Reopened',owner_user_id=?,updated_at=? WHERE id=? AND firm_id=?`)
        .run(input.newOwnerUserId, at, matterId, user.firmId);
      this.operational(user, matterId, 'matter.reopened', eventId, at, audit);
      this.saveReceipt(user, matterId, 'reopen', input.idempotencyKey, input, { eventId }, at);
      return this.getWorkspace(user, matterId);
    });
  }

  applyLegalHold(user: SessionUser, matterId: string, input: LegalHoldInput, audit: AuditContext) {
    this.requireMatter(user, matterId);
    if (this.replay(user, matterId, 'apply_hold', input.idempotencyKey, input)) return this.getWorkspace(user, matterId);
    return transaction(this.database, () => {
      const at = this.now().toISOString();
      const holdId = randomUUID();
      this.database.prepare(`INSERT INTO legal_holds (id,firm_id,matter_id,reason,created_by,created_at) VALUES (?,?,?,?,?,?)`)
        .run(holdId, user.firmId, matterId, input.reason, user.id, at);
      this.database.prepare(`INSERT INTO legal_hold_events
        (id,firm_id,matter_id,legal_hold_id,sequence,event_type,reason,explicit_human_authority,recorded_by,recorded_at)
        VALUES (?,?,?,?,1,'applied',?,1,?,?)`).run(randomUUID(), user.firmId, matterId, holdId, input.reason, user.id, at);
      this.operational(user, matterId, 'matter.legal_hold_applied', holdId, at, audit);
      this.saveReceipt(user, matterId, 'apply_hold', input.idempotencyKey, input, { holdId }, at);
      return this.getWorkspace(user, matterId);
    });
  }

  releaseLegalHold(user: SessionUser, matterId: string, holdId: string, input: LegalHoldInput, audit: AuditContext) {
    this.requireMatter(user, matterId);
    if (this.replay(user, matterId, 'release_hold', input.idempotencyKey, { holdId, input })) return this.getWorkspace(user, matterId);
    return transaction(this.database, () => {
      const hold = this.database.prepare(`SELECT 1 FROM legal_holds WHERE id=? AND firm_id=? AND matter_id=?`).get(holdId, user.firmId, matterId);
      if (!hold) throw new ClosureStoreError('NOT_FOUND', 'The legal hold was not found.');
      const latest = this.database.prepare(`SELECT event_type AS type,sequence FROM legal_hold_events WHERE legal_hold_id=? AND firm_id=? AND matter_id=?
        ORDER BY sequence DESC LIMIT 1`).get(holdId, user.firmId, matterId) as Row;
      if (latest.type !== 'applied') throw new ClosureStoreError('INVALID_STATE', 'The legal hold is not active.');
      const at = this.now().toISOString();
      this.database.prepare(`INSERT INTO legal_hold_events
        (id,firm_id,matter_id,legal_hold_id,sequence,event_type,reason,explicit_human_authority,recorded_by,recorded_at)
        VALUES (?,?,?,?,?,'released',?,1,?,?)`).run(randomUUID(), user.firmId, matterId, holdId, Number(latest.sequence) + 1, input.reason, user.id, at);
      this.operational(user, matterId, 'matter.legal_hold_released', holdId, at, audit);
      this.saveReceipt(user, matterId, 'release_hold', input.idempotencyKey, { holdId, input }, { holdId }, at);
      return this.getWorkspace(user, matterId);
    });
  }

  getWorkspace(user: SessionUser, matterId: string) {
    const matter = this.requireMatter(user, matterId);
    const review = this.database.prepare(`SELECT id,sequence,snapshot_hash AS snapshotHash,outcome,closure_reason AS closureReason,
      lessons,final_client_report_status AS finalClientReportStatus,final_client_report_document_version_id AS finalClientReportDocumentVersionId,
      documents_position AS documentsPosition,documents_note AS documentsNote,retention_basis AS retentionBasis,
      retention_until AS retentionUntil,prepared_by AS preparedBy,prepared_at AS preparedAt
      FROM matter_closure_reviews WHERE firm_id=? AND matter_id=? ORDER BY sequence DESC LIMIT 1`)
      .get(user.firmId, matterId) as Row | undefined;
    const blockers = review ? this.database.prepare(`SELECT blocker_key AS key,category,label,severity,transferable,source_id AS sourceId
      FROM matter_closure_blockers WHERE firm_id=? AND matter_id=? AND review_id=? ORDER BY blocker_key`)
      .all(user.firmId, matterId, review.id).map((value) => ({ ...(value as Row), transferable: Boolean((value as Row).transferable) })) : [];
    const events = this.database.prepare(`SELECT id,sequence,event_type AS eventType,review_id AS reviewId,reason,
      responsible_owner_user_id AS responsibleOwnerUserId,recorded_by AS recordedBy,recorded_at AS recordedAt
      FROM matter_closure_events WHERE firm_id=? AND matter_id=? ORDER BY sequence`).all(user.firmId, matterId) as Row[];
    const obligations = this.database.prepare(`SELECT id,review_id AS reviewId,blocker_key AS blockerKey,title,reason,
      owner_user_id AS ownerUserId,due_on AS dueOn,status,created_at AS createdAt FROM post_closure_obligations
      WHERE firm_id=? AND matter_id=? ORDER BY due_on,id`).all(user.firmId, matterId) as Row[];
    const holds = this.database.prepare(`SELECT h.id,h.reason,h.created_at AS createdAt,
      (SELECT e.event_type FROM legal_hold_events e WHERE e.firm_id=h.firm_id AND e.matter_id=h.matter_id
       AND e.legal_hold_id=h.id ORDER BY e.sequence DESC LIMIT 1) AS status FROM legal_holds h
      WHERE h.firm_id=? AND h.matter_id=? ORDER BY h.created_at,h.id`).all(user.firmId, matterId) as Row[];
    const activeHold = holds.some((hold) => hold.status === 'applied');
    const latestEvent = events.at(-1);
    const status = String(matter.status) === 'closed' || String(matter.status) === 'archived' ? 'closed'
      : latestEvent?.eventType === 'reopened' ? 'active'
      : latestEvent?.eventType === 'approved' ? 'approved' : review ? 'prepared' : 'active';
    const mappedReview = review ? {
      id: String(review.id), sequence: Number(review.sequence), snapshotHash: String(review.snapshotHash),
      outcome: String(review.outcome), closureReason: String(review.closureReason), lessons: String(review.lessons),
      finalClientReportStatus: String(review.finalClientReportStatus),
      finalClientReportDocumentVersionId: String(review.finalClientReportDocumentVersionId),
      documentsPosition: String(review.documentsPosition), documentsNote: String(review.documentsNote),
      retentionBasis: String(review.retentionBasis), retentionUntil: String(review.retentionUntil),
      preparedBy: String(review.preparedBy), preparedAt: String(review.preparedAt),
    } : null;
    return { matterId, actingUserId: user.id, status, readOnly: status === 'closed', currentReadiness: this.getSnapshot(user, matterId),
      review: mappedReview, blockers, obligations, holds,
      destructionSuspended: activeHold, events };
  }
}
