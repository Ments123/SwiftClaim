import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
  CreateResponseTrackInput,
  CreateStatementVersionInput,
  RecordStatementEventInput,
  RecordAmendmentAuthorityInput,
  CreateDefaultReviewInput,
  CompleteDefaultReviewInput,
  ReviewPleadingDeadlineInput,
} from '../../shared/contracts.js';
import type { SessionUser } from '../policy.js';
import { appendAudit, appendTimeline, type AuditContext } from '../store.js';
import { projectStatement, type StatementProjectionEvent } from './projections.js';

type Row = Record<string, string | number | null>;

export type PleadingsStoreErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'INVALID_LINK';

export class PleadingsStoreError extends Error {
  constructor(readonly code: PleadingsStoreErrorCode, message: string) {
    super(message);
    this.name = 'PleadingsStoreError';
  }
}

function canonicalJson(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]));
    }
    return input;
  };
  return JSON.stringify(canonical(value));
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

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

function mapTrack(row: Row) {
  return {
    id: String(row.id),
    proceedingId: String(row.proceedingId),
    claimantPartyId: String(row.claimantPartyId),
    defendantPartyId: String(row.defendantPartyId),
    claimFormDocumentVersionId: String(row.claimFormDocumentVersionId),
    particularsDocumentVersionId: row.particularsDocumentVersionId
      ? String(row.particularsDocumentVersionId) : null,
    regime: String(row.regime),
    serviceRecordId: row.serviceRecordId ? String(row.serviceRecordId) : null,
    currentState: String(row.currentState),
    version: Number(row.version),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

const trackSelect = `SELECT id, proceeding_id AS proceedingId,
  claimant_party_id AS claimantPartyId, defendant_party_id AS defendantPartyId,
  claim_form_document_version_id AS claimFormDocumentVersionId,
  particulars_document_version_id AS particularsDocumentVersionId,
  regime, service_record_id AS serviceRecordId, current_state AS currentState,
  version, created_at AS createdAt, updated_at AS updatedAt
  FROM claim_response_tracks`;

export class PleadingsStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  getTrack(firmId: string, matterId: string, trackId: string) {
    const row = this.database.prepare(
      `${trackSelect} WHERE firm_id = ? AND matter_id = ? AND id = ?`,
    ).get(firmId, matterId, trackId) as Row | undefined;
    return row ? mapTrack(row) : undefined;
  }

  private receipt<T>(
    firmId: string, matterId: string, scope: string, idempotencyKey: string, input: unknown,
  ): T | undefined {
    const found = this.database.prepare(`SELECT input_hash AS inputHash,
      response_json AS responseJson FROM pleadings_command_receipts
      WHERE firm_id = ? AND matter_id = ? AND command_scope = ? AND idempotency_key = ?`)
      .get(firmId, matterId, scope, idempotencyKey) as
      | { inputHash: string; responseJson: string } | undefined;
    if (!found) return undefined;
    if (found.inputHash !== digest(input)) {
      throw new PleadingsStoreError('IDEMPOTENCY_KEY_REUSED', 'The idempotency key was already used with different input.');
    }
    return JSON.parse(found.responseJson) as T;
  }

  private saveReceipt(
    user: SessionUser, matterId: string, proceedingId: string, scope: string,
    routeEntityId: string, idempotencyKey: string, input: unknown, response: unknown,
    createdAt: string,
  ): void {
    this.database.prepare(`INSERT INTO pleadings_command_receipts (
      id, firm_id, matter_id, proceeding_id, command_scope, route_entity_id,
      idempotency_key, input_hash, response_json, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), user.firmId, matterId, proceedingId, scope, routeEntityId,
        idempotencyKey, digest(input), canonicalJson(response), user.id, createdAt);
  }

  private appendOperational(
    user: SessionUser, matterId: string,
    details: { action: string; entityType: string; entityId: string; title: string;
      idempotencyKey: string; after: unknown; occurredAt: string },
    audit: AuditContext,
  ): void {
    appendTimeline(this.database, {
      firmId: user.firmId, matterId, type: details.action, title: details.title,
      actorUserId: user.id, occurredAt: details.occurredAt,
      metadata: { entityType: details.entityType, entityId: details.entityId },
    });
    appendAudit(this.database, {
      firmId: user.firmId, matterId, userId: user.id, action: details.action,
      entityType: details.entityType, entityId: details.entityId, after: details.after,
      requestId: audit.requestId, ipAddress: audit.ipAddress, createdAt: details.occurredAt,
    });
    this.database.prepare(`INSERT INTO domain_events (
      id, firm_id, matter_id, type, occurred_on, actor_user_id,
      idempotency_key, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), user.firmId, matterId, details.action,
        details.occurredAt.slice(0, 10), user.id,
        `pleadings:${details.action}:${details.idempotencyKey}`,
        canonicalJson({ entityType: details.entityType, entityId: details.entityId }),
        details.occurredAt);
    this.database.prepare(`INSERT INTO integration_outbox (
      id, firm_id, matter_id, topic, payload_json, status, attempts,
      available_at, created_at, deduplication_key
    ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`)
      .run(randomUUID(), user.firmId, matterId, details.action,
        canonicalJson({ matterId, entityType: details.entityType, entityId: details.entityId }),
        details.occurredAt, details.occurredAt,
        `pleadings:${user.firmId}:${matterId}:${details.action}:${details.idempotencyKey}`);
  }

  getStatement(firmId: string, matterId: string, statementId: string) {
    const row = this.database.prepare(`SELECT id, proceeding_id AS proceedingId,
      track_id AS trackId, statement_type AS statementType, party_id AS partyId,
      current_version_id AS currentVersionId, version, created_at AS createdAt,
      updated_at AS updatedAt FROM statements_of_case
      WHERE id = ? AND firm_id = ? AND matter_id = ?`)
      .get(statementId, firmId, matterId) as Row | undefined;
    if (!row) return undefined;
    const version = row.currentVersionId ? this.database.prepare(`SELECT id,
      version_number AS versionNumber, document_version_id AS documentVersionId,
      predecessor_version_id AS predecessorVersionId,
      statement_of_truth_status AS statementOfTruthStatus,
      signatory_name AS signatoryName, signatory_capacity AS signatoryCapacity,
      signed_at AS signedAt, response_position AS responsePosition,
      amendment_route AS amendmentRoute, amendment_reason AS amendmentReason,
      prepared_by_user_id AS preparedByUserId, created_at AS createdAt
      FROM statement_of_case_versions WHERE id = ? AND firm_id = ? AND matter_id = ?`)
      .get(row.currentVersionId, firmId, matterId) as Row | undefined : undefined;
    const eventRows = this.database.prepare(`SELECT id, event_type AS eventType,
      occurred_at AS occurredAt, note, filing_id AS filingId,
      service_record_id AS serviceRecordId, source_document_version_id AS sourceDocumentVersionId,
      supersedes_event_id AS supersedesEventId, correction_reason AS correctionReason,
      recorded_by AS recordedBy, recorded_at AS recordedAt
      FROM statement_of_case_events WHERE statement_id = ? AND firm_id = ? AND matter_id = ?
      ORDER BY occurred_at, recorded_at, id`).all(statementId, firmId, matterId) as Row[];
    const events = eventRows.map((event) => ({
      id: String(event.id), eventType: String(event.eventType), occurredAt: String(event.occurredAt),
      note: String(event.note), filingId: event.filingId ? String(event.filingId) : null,
      serviceRecordId: event.serviceRecordId ? String(event.serviceRecordId) : null,
      sourceDocumentVersionId: event.sourceDocumentVersionId ? String(event.sourceDocumentVersionId) : null,
      supersedesEventId: event.supersedesEventId ? String(event.supersedesEventId) : null,
      correctionReason: String(event.correctionReason), recordedBy: String(event.recordedBy),
      recordedAt: String(event.recordedAt),
    }));
    const amendmentAuthorities = (this.database.prepare(`SELECT id,
      statement_version_id AS statementVersionId, route,
      consent_document_version_id AS consentDocumentVersionId,
      application_id AS applicationId, sealed_order_id AS sealedOrderId,
      reviewed_by AS reviewedBy, reviewed_at AS reviewedAt, note, created_at AS createdAt
      FROM statement_amendment_authorities
      WHERE statement_id = ? AND firm_id = ? AND matter_id = ?
      ORDER BY created_at, id`).all(statementId, firmId, matterId) as Row[])
      .map((authority) => ({
        id: String(authority.id), statementVersionId: String(authority.statementVersionId),
        route: String(authority.route),
        consentDocumentVersionId: authority.consentDocumentVersionId ? String(authority.consentDocumentVersionId) : null,
        applicationId: authority.applicationId ? String(authority.applicationId) : null,
        sealedOrderId: authority.sealedOrderId ? String(authority.sealedOrderId) : null,
        reviewedBy: String(authority.reviewedBy), reviewedAt: String(authority.reviewedAt),
        note: String(authority.note), createdAt: String(authority.createdAt),
      }));
    return {
      id: String(row.id), proceedingId: String(row.proceedingId),
      trackId: row.trackId ? String(row.trackId) : null,
      statementType: String(row.statementType), partyId: String(row.partyId),
      version: Number(row.version), createdAt: String(row.createdAt), updatedAt: String(row.updatedAt),
      currentVersion: version ? {
        id: String(version.id), versionNumber: Number(version.versionNumber),
        statementType: String(row.statementType), documentVersionId: String(version.documentVersionId),
        predecessorVersionId: version.predecessorVersionId ? String(version.predecessorVersionId) : null,
        statementOfTruthStatus: String(version.statementOfTruthStatus),
        signatoryName: String(version.signatoryName), signatoryCapacity: String(version.signatoryCapacity),
        signedAt: version.signedAt ? String(version.signedAt) : null,
        responsePosition: String(version.responsePosition), amendmentRoute: String(version.amendmentRoute),
        amendmentReason: String(version.amendmentReason), preparedByUserId: String(version.preparedByUserId),
        createdAt: String(version.createdAt),
      } : null,
      events,
      amendmentAuthorities,
      projection: projectStatement(events as StatementProjectionEvent[]),
    };
  }

  getDefaultReview(firmId: string, matterId: string, reviewId: string) {
    const row = this.database.prepare(`SELECT id, track_id AS trackId,
      statement_version_id AS statementVersionId,
      deadline_projection_id AS deadlineProjectionId, claim_type AS claimType,
      requested_method AS requestedMethod, outcome, blockers_json AS blockersJson,
      note, version, reviewed_by AS reviewedBy, reviewed_at AS reviewedAt,
      created_at AS createdAt, updated_at AS updatedAt
      FROM default_judgment_reviews WHERE id = ? AND firm_id = ? AND matter_id = ?`)
      .get(reviewId, firmId, matterId) as Row | undefined;
    if (!row) return undefined;
    const events = (this.database.prepare(`SELECT id, outcome, blockers_json AS blockersJson,
      note, reviewed_by AS reviewedBy, reviewed_at AS reviewedAt, recorded_at AS recordedAt
      FROM default_judgment_review_events WHERE review_id = ? AND firm_id = ? AND matter_id = ?
      ORDER BY reviewed_at, recorded_at, id`).all(reviewId, firmId, matterId) as Row[])
      .map((event) => ({
        id: String(event.id), outcome: String(event.outcome),
        blockers: JSON.parse(String(event.blockersJson)) as string[], note: String(event.note),
        reviewedBy: String(event.reviewedBy), reviewedAt: String(event.reviewedAt),
        recordedAt: String(event.recordedAt),
      }));
    return {
      id: String(row.id), trackId: String(row.trackId),
      statementVersionId: row.statementVersionId ? String(row.statementVersionId) : null,
      deadlineProjectionId: row.deadlineProjectionId ? String(row.deadlineProjectionId) : null,
      claimType: String(row.claimType), requestedMethod: String(row.requestedMethod),
      outcome: String(row.outcome), blockers: JSON.parse(String(row.blockersJson)) as string[],
      note: String(row.note), version: Number(row.version),
      reviewedBy: row.reviewedBy ? String(row.reviewedBy) : null,
      reviewedAt: row.reviewedAt ? String(row.reviewedAt) : null,
      createdAt: String(row.createdAt), updatedAt: String(row.updatedAt), events,
    };
  }

  getWorkspace(firmId: string, matterId: string, proceedingId: string) {
    if (!this.database.prepare(`SELECT 1 FROM court_proceedings
      WHERE id = ? AND firm_id = ? AND matter_id = ?`)
      .get(proceedingId, firmId, matterId)) return undefined;

    const rows = this.database.prepare(`${trackSelect}
      WHERE firm_id = ? AND matter_id = ? AND proceeding_id = ?
      ORDER BY created_at, id`).all(firmId, matterId, proceedingId) as Row[];
    const parties = new Map((this.database.prepare(`SELECT id, name, kind FROM parties
      WHERE firm_id = ? AND matter_id = ? ORDER BY name, id`)
      .all(firmId, matterId) as Row[]).map((row) => [String(row.id), {
        id: String(row.id), name: String(row.name), kind: String(row.kind),
      }]));
    const documents = (this.database.prepare(`SELECT dv.id, d.title, dv.version,
      dv.original_name AS originalName FROM document_versions dv
      JOIN documents d ON d.id = dv.document_id AND d.firm_id = dv.firm_id
      WHERE dv.firm_id = ? AND d.matter_id = ? ORDER BY d.title, dv.version DESC`)
      .all(firmId, matterId) as Row[]).map((row) => ({
        id: String(row.id), title: String(row.title), version: Number(row.version),
        originalName: String(row.originalName),
      }));
    const tracks = rows.map((row) => {
      const track = mapTrack(row);
      const events = (this.database.prepare(`SELECT id, event_type AS eventType,
        occurred_at AS occurredAt, note, source_document_version_id AS sourceDocumentVersionId,
        supersedes_event_id AS supersedesEventId, correction_reason AS correctionReason,
        recorded_by AS recordedBy, recorded_at AS recordedAt
        FROM claim_response_track_events WHERE firm_id = ? AND matter_id = ? AND track_id = ?
        ORDER BY occurred_at, recorded_at, id`).all(firmId, matterId, track.id) as Row[])
        .map((event) => ({
          id: String(event.id), eventType: String(event.eventType),
          occurredAt: String(event.occurredAt), note: String(event.note),
          sourceDocumentVersionId: event.sourceDocumentVersionId ? String(event.sourceDocumentVersionId) : null,
          supersedesEventId: event.supersedesEventId ? String(event.supersedesEventId) : null,
          correctionReason: String(event.correctionReason), recordedBy: String(event.recordedBy),
          recordedAt: String(event.recordedAt),
        }));
      const statements = (this.database.prepare(`SELECT id FROM statements_of_case
        WHERE firm_id = ? AND matter_id = ? AND track_id = ? ORDER BY created_at, id`)
        .all(firmId, matterId, track.id) as Array<{ id: string }>)
        .map(({ id }) => this.getStatement(firmId, matterId, id)).filter(Boolean);
      const deadlines = (this.database.prepare(`SELECT id, kind, outcome,
        trigger_date AS triggerDate, projected_date AS projectedDate,
        rule_key AS ruleKey, rule_version AS ruleVersion, source_title AS sourceTitle,
        source_url AS sourceUrl, source_document_version_id AS sourceDocumentVersionId,
        reviewed_at AS reviewedAt, created_at AS createdAt
        FROM pleading_deadline_projections WHERE firm_id = ? AND matter_id = ? AND track_id = ?
        ORDER BY projected_date, created_at, id`).all(firmId, matterId, track.id) as Row[])
        .map((deadline) => ({
          id: String(deadline.id), kind: String(deadline.kind), outcome: String(deadline.outcome),
          triggerDate: deadline.triggerDate ? String(deadline.triggerDate) : null,
          projectedDate: deadline.projectedDate ? String(deadline.projectedDate) : null,
          ruleKey: String(deadline.ruleKey), ruleVersion: String(deadline.ruleVersion),
          sourceTitle: String(deadline.sourceTitle), sourceUrl: String(deadline.sourceUrl),
          sourceDocumentVersionId: deadline.sourceDocumentVersionId ? String(deadline.sourceDocumentVersionId) : null,
          reviewedAt: deadline.reviewedAt ? String(deadline.reviewedAt) : null,
          createdAt: String(deadline.createdAt),
        }));
      const defaultReviews = (this.database.prepare(`SELECT id FROM default_judgment_reviews
        WHERE firm_id = ? AND matter_id = ? AND track_id = ? ORDER BY created_at DESC, id`)
        .all(firmId, matterId, track.id) as Array<{ id: string }>)
        .map(({ id }) => this.getDefaultReview(firmId, matterId, id)).filter(Boolean);
      return {
        ...track,
        claimant: parties.get(track.claimantPartyId) ?? null,
        defendant: parties.get(track.defendantPartyId) ?? null,
        events,
        statements,
        deadlines,
        defaultReviews,
      };
    });
    return {
      proceedingId,
      tracks,
      sources: { documents, parties: [...parties.values()] },
    };
  }

  private requireScoped(
    table: 'court_proceedings' | 'parties' | 'court_service_records',
    firmId: string,
    matterId: string,
    id: string,
  ): void {
    if (!this.database.prepare(`SELECT 1 FROM ${table}
      WHERE id = ? AND firm_id = ? AND matter_id = ?`).get(id, firmId, matterId)) {
      throw new PleadingsStoreError('INVALID_LINK', 'A linked source was not found.');
    }
  }

  assertDocumentVersion(firmId: string, matterId: string, documentVersionId: string): void {
    if (!this.database.prepare(`SELECT 1 FROM document_versions dv
      JOIN documents d ON d.id = dv.document_id AND d.firm_id = dv.firm_id
      WHERE dv.id = ? AND dv.firm_id = ? AND d.matter_id = ?`)
      .get(documentVersionId, firmId, matterId)) {
      throw new PleadingsStoreError('INVALID_LINK', 'The exact document version was not found.');
    }
  }

  openTrack(
    user: SessionUser,
    matterId: string,
    proceedingId: string,
    input: CreateResponseTrackInput,
    audit: AuditContext,
  ) {
    const scope = `open_track:${proceedingId}`;
    const receipt = this.database.prepare(`SELECT input_hash AS inputHash,
      response_json AS responseJson FROM pleadings_command_receipts
      WHERE firm_id = ? AND matter_id = ? AND command_scope = ? AND idempotency_key = ?`)
      .get(user.firmId, matterId, scope, input.idempotencyKey) as
      | { inputHash: string; responseJson: string } | undefined;
    if (receipt) {
      if (receipt.inputHash !== digest(input)) {
        throw new PleadingsStoreError('IDEMPOTENCY_KEY_REUSED', 'The idempotency key was already used with different input.');
      }
      return JSON.parse(receipt.responseJson) as ReturnType<typeof mapTrack>;
    }

    return transaction(this.database, () => {
      this.requireScoped('court_proceedings', user.firmId, matterId, proceedingId);
      this.requireScoped('parties', user.firmId, matterId, input.claimantPartyId);
      this.requireScoped('parties', user.firmId, matterId, input.defendantPartyId);
      this.assertDocumentVersion(user.firmId, matterId, input.claimFormDocumentVersionId);
      if (input.particularsDocumentVersionId) {
        this.assertDocumentVersion(user.firmId, matterId, input.particularsDocumentVersionId);
      }
      if (input.serviceRecordId) {
        this.requireScoped('court_service_records', user.firmId, matterId, input.serviceRecordId);
      }
      const createdAt = this.now().toISOString();
      const id = randomUUID();
      this.database.prepare(`INSERT INTO claim_response_tracks (
        id, firm_id, matter_id, proceeding_id, claimant_party_id, defendant_party_id,
        claim_form_document_version_id, particulars_document_version_id, regime,
        service_record_id, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, user.firmId, matterId, proceedingId, input.claimantPartyId,
          input.defendantPartyId, input.claimFormDocumentVersionId,
          input.particularsDocumentVersionId, input.regime, input.serviceRecordId,
          user.id, createdAt, createdAt);
      this.database.prepare(`INSERT INTO claim_response_track_events (
        id, firm_id, matter_id, track_id, event_type, occurred_at, note,
        recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, 'track_opened', ?, ?, ?, ?)`)
        .run(randomUUID(), user.firmId, matterId, id, createdAt, input.note, user.id, createdAt);
      const created = this.getTrack(user.firmId, matterId, id);
      if (!created) throw new PleadingsStoreError('CONFLICT', 'The response track could not be read after creation.');

      appendTimeline(this.database, {
        firmId: user.firmId, matterId, type: 'pleadings.track_opened',
        title: 'Pleading response track opened', actorUserId: user.id,
        occurredAt: createdAt, metadata: { proceedingId, trackId: id },
      });
      appendAudit(this.database, {
        firmId: user.firmId, matterId, userId: user.id,
        action: 'pleadings.track_opened', entityType: 'claim_response_track',
        entityId: id, after: created, requestId: audit.requestId,
        ipAddress: audit.ipAddress, createdAt,
      });
      this.database.prepare(`INSERT INTO domain_events (
        id, firm_id, matter_id, type, occurred_on, actor_user_id,
        idempotency_key, payload_json, created_at
      ) VALUES (?, ?, ?, 'pleadings.track_opened', ?, ?, ?, ?, ?)`)
        .run(randomUUID(), user.firmId, matterId, createdAt.slice(0, 10), user.id,
          `pleadings:track:${input.idempotencyKey}`, canonicalJson({ proceedingId, trackId: id }), createdAt);
      this.database.prepare(`INSERT INTO integration_outbox (
        id, firm_id, matter_id, topic, payload_json, status, attempts,
        available_at, created_at, deduplication_key
      ) VALUES (?, ?, ?, 'pleadings.track_opened', ?, 'pending', 0, ?, ?, ?)`)
        .run(randomUUID(), user.firmId, matterId, canonicalJson({ matterId, proceedingId, trackId: id }),
          createdAt, createdAt, `pleadings:${user.firmId}:${matterId}:track:${input.idempotencyKey}`);
      this.database.prepare(`INSERT INTO pleadings_command_receipts (
        id, firm_id, matter_id, proceeding_id, command_scope, route_entity_id,
        idempotency_key, input_hash, response_json, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), user.firmId, matterId, proceedingId, scope, id,
          input.idempotencyKey, digest(input), canonicalJson(created), user.id, createdAt);
      return created;
    });
  }

  createStatementVersion(
    user: SessionUser, matterId: string, proceedingId: string, trackId: string,
    input: CreateStatementVersionInput, audit: AuditContext,
  ) {
    const scope = `create_statement:${trackId}`;
    const replay = this.receipt<NonNullable<ReturnType<PleadingsStore['getStatement']>>>(
      user.firmId, matterId, scope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      const track = this.getTrack(user.firmId, matterId, trackId);
      if (!track || track.proceedingId !== proceedingId) throw new PleadingsStoreError('NOT_FOUND', 'The response track was not found.');
      this.requireScoped('parties', user.firmId, matterId, input.partyId);
      this.assertDocumentVersion(user.firmId, matterId, input.documentVersionId);
      if (!this.database.prepare('SELECT 1 FROM users WHERE id = ? AND firm_id = ?')
        .get(input.preparedByUserId, user.firmId)) throw new PleadingsStoreError('INVALID_LINK', 'The preparer was not found.');
      if (input.predecessorVersionId && !this.database.prepare(`SELECT 1 FROM statement_of_case_versions
        WHERE id = ? AND firm_id = ? AND matter_id = ?`).get(input.predecessorVersionId, user.firmId, matterId)) {
        throw new PleadingsStoreError('INVALID_LINK', 'The predecessor version was not found.');
      }
      const createdAt = this.now().toISOString();
      const statementId = randomUUID();
      const versionId = randomUUID();
      this.database.prepare(`INSERT INTO statements_of_case (
        id, firm_id, matter_id, proceeding_id, track_id, statement_type, party_id,
        current_version_id, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(statementId, user.firmId, matterId, proceedingId, trackId, input.statementType,
          input.partyId, versionId, user.id, createdAt, createdAt);
      this.database.prepare(`INSERT INTO statement_of_case_versions (
        id, firm_id, matter_id, statement_id, version_number, document_version_id,
        predecessor_version_id, prepared_by_user_id, statement_of_truth_status,
        signatory_name, signatory_capacity, signed_at, response_position,
        amendment_route, amendment_reason, idempotency_key, command_payload_json, created_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(versionId, user.firmId, matterId, statementId, input.documentVersionId,
          input.predecessorVersionId, input.preparedByUserId, input.statementOfTruthStatus,
          input.signatoryName, input.signatoryCapacity, input.signedAt, input.responsePosition,
          input.amendmentRoute, input.amendmentReason, input.idempotencyKey, canonicalJson(input), createdAt);
      this.database.prepare(`INSERT INTO statement_of_case_events (
        id, firm_id, matter_id, statement_id, statement_version_id, event_type,
        occurred_at, note, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, ?, 'prepared', ?, ?, ?, ?)`)
        .run(randomUUID(), user.firmId, matterId, statementId, versionId, createdAt,
          'The exact statement-of-case version was retained as prepared.', user.id, createdAt);
      const created = this.getStatement(user.firmId, matterId, statementId);
      if (!created) throw new PleadingsStoreError('CONFLICT', 'The statement could not be read after creation.');
      this.appendOperational(user, matterId, {
        action: 'pleadings.statement_version_created', entityType: 'statement_of_case',
        entityId: statementId, title: 'Statement-of-case version retained',
        idempotencyKey: input.idempotencyKey, after: created, occurredAt: createdAt,
      }, audit);
      this.saveReceipt(user, matterId, proceedingId, scope, statementId,
        input.idempotencyKey, input, created, createdAt);
      return created;
    });
  }

  recordStatementEvent(
    user: SessionUser, matterId: string, proceedingId: string, statementId: string,
    input: RecordStatementEventInput, audit: AuditContext,
  ) {
    const scope = `statement_event:${statementId}`;
    const replay = this.receipt<NonNullable<ReturnType<PleadingsStore['getStatement']>>>(
      user.firmId, matterId, scope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      const statement = this.getStatement(user.firmId, matterId, statementId);
      if (!statement || statement.proceedingId !== proceedingId) throw new PleadingsStoreError('NOT_FOUND', 'The statement was not found.');
      if (statement.version !== input.expectedVersion) throw new PleadingsStoreError('CONFLICT', 'The statement changed. Refresh and try again.');
      if (input.filingId) this.requireScoped('court_proceedings', user.firmId, matterId, proceedingId);
      if (input.filingId && !this.database.prepare(`SELECT 1 FROM court_filings
        WHERE id = ? AND firm_id = ? AND matter_id = ? AND proceeding_id = ?`)
        .get(input.filingId, user.firmId, matterId, proceedingId)) throw new PleadingsStoreError('INVALID_LINK', 'The filing record was not found.');
      if (input.serviceRecordId) this.requireScoped('court_service_records', user.firmId, matterId, input.serviceRecordId);
      if (input.sourceDocumentVersionId) this.assertDocumentVersion(user.firmId, matterId, input.sourceDocumentVersionId);
      const recordedAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO statement_of_case_events (
        id, firm_id, matter_id, statement_id, statement_version_id, event_type,
        occurred_at, note, filing_id, service_record_id, source_document_version_id,
        supersedes_event_id, correction_reason, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), user.firmId, matterId, statementId, statement.currentVersion!.id,
          input.eventType, input.occurredAt, input.note, input.filingId, input.serviceRecordId,
          input.sourceDocumentVersionId, input.supersedesEventId, input.correctionReason,
          user.id, recordedAt);
      const updated = this.database.prepare(`UPDATE statements_of_case SET version = version + 1,
        updated_at = ? WHERE id = ? AND firm_id = ? AND matter_id = ? AND version = ?`)
        .run(recordedAt, statementId, user.firmId, matterId, input.expectedVersion);
      if (updated.changes !== 1) throw new PleadingsStoreError('CONFLICT', 'The statement changed. Refresh and try again.');
      const result = this.getStatement(user.firmId, matterId, statementId)!;
      this.appendOperational(user, matterId, {
        action: `pleadings.statement_${input.eventType}`, entityType: 'statement_of_case',
        entityId: statementId, title: `Statement of case ${input.eventType.replaceAll('_', ' ')}`,
        idempotencyKey: input.idempotencyKey, after: result, occurredAt: recordedAt,
      }, audit);
      this.saveReceipt(user, matterId, proceedingId, scope, statementId,
        input.idempotencyKey, input, result, recordedAt);
      return result;
    });
  }

  recordAmendmentAuthority(
    user: SessionUser, matterId: string, proceedingId: string, statementVersionId: string,
    input: RecordAmendmentAuthorityInput, audit: AuditContext,
  ) {
    const scope = `amendment_authority:${statementVersionId}`;
    const replay = this.receipt<Record<string, unknown>>(
      user.firmId, matterId, scope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      const row = this.database.prepare(`SELECT s.id AS statementId, s.version,
        s.proceeding_id AS proceedingId FROM statement_of_case_versions v
        JOIN statements_of_case s ON s.id = v.statement_id AND s.firm_id = v.firm_id
          AND s.matter_id = v.matter_id
        WHERE v.id = ? AND v.firm_id = ? AND v.matter_id = ?`)
        .get(statementVersionId, user.firmId, matterId) as Row | undefined;
      if (!row || String(row.proceedingId) !== proceedingId) {
        throw new PleadingsStoreError('NOT_FOUND', 'The statement version was not found.');
      }
      if (Number(row.version) !== input.expectedVersion) {
        throw new PleadingsStoreError('CONFLICT', 'The statement changed. Refresh and try again.');
      }
      if (input.consentDocumentVersionId) this.assertDocumentVersion(user.firmId, matterId, input.consentDocumentVersionId);
      if (input.applicationId && !this.database.prepare(`SELECT 1 FROM court_applications
        WHERE id = ? AND firm_id = ? AND matter_id = ? AND proceeding_id = ?`)
        .get(input.applicationId, user.firmId, matterId, proceedingId)) {
        throw new PleadingsStoreError('INVALID_LINK', 'The amendment application was not found.');
      }
      if (input.sealedOrderId && !this.database.prepare(`SELECT 1 FROM court_orders
        WHERE id = ? AND firm_id = ? AND matter_id = ? AND proceeding_id = ?`)
        .get(input.sealedOrderId, user.firmId, matterId, proceedingId)) {
        throw new PleadingsStoreError('INVALID_LINK', 'The sealed amendment order was not found.');
      }
      const id = randomUUID();
      const createdAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO statement_amendment_authorities (
        id, firm_id, matter_id, statement_id, statement_version_id, route,
        consent_document_version_id, application_id, sealed_order_id,
        reviewed_by, reviewed_at, note, idempotency_key, command_payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, user.firmId, matterId, row.statementId, statementVersionId, input.route,
          input.consentDocumentVersionId, input.applicationId, input.sealedOrderId,
          user.id, input.reviewedAt, input.note, input.idempotencyKey, canonicalJson(input), createdAt);
      const authority = {
        id, statementVersionId, route: input.route,
        consentDocumentVersionId: input.consentDocumentVersionId,
        applicationId: input.applicationId, sealedOrderId: input.sealedOrderId,
        reviewedBy: user.id, reviewedAt: input.reviewedAt, note: input.note, createdAt,
      };
      this.appendOperational(user, matterId, {
        action: 'pleadings.amendment_authority_recorded', entityType: 'statement_amendment_authority',
        entityId: id, title: 'Amendment authority source retained',
        idempotencyKey: input.idempotencyKey, after: authority, occurredAt: createdAt,
      }, audit);
      this.saveReceipt(user, matterId, proceedingId, scope, id,
        input.idempotencyKey, input, authority, createdAt);
      return authority;
    });
  }

  createDefaultReview(
    user: SessionUser, matterId: string, proceedingId: string, trackId: string,
    input: CreateDefaultReviewInput, audit: AuditContext,
  ) {
    const scope = `create_default_review:${trackId}`;
    const replay = this.receipt<NonNullable<ReturnType<PleadingsStore['getDefaultReview']>>>(
      user.firmId, matterId, scope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      const track = this.getTrack(user.firmId, matterId, trackId);
      if (!track || track.proceedingId !== proceedingId) throw new PleadingsStoreError('NOT_FOUND', 'The response track was not found.');
      if (input.statementVersionId && !this.database.prepare(`SELECT 1 FROM statement_of_case_versions
        WHERE id = ? AND firm_id = ? AND matter_id = ?`).get(input.statementVersionId, user.firmId, matterId)) {
        throw new PleadingsStoreError('INVALID_LINK', 'The statement version was not found.');
      }
      if (input.deadlineProjectionId && !this.database.prepare(`SELECT 1 FROM pleading_deadline_projections
        WHERE id = ? AND firm_id = ? AND matter_id = ? AND track_id = ?`)
        .get(input.deadlineProjectionId, user.firmId, matterId, trackId)) {
        throw new PleadingsStoreError('INVALID_LINK', 'The deadline projection was not found.');
      }
      const id = randomUUID();
      const createdAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO default_judgment_reviews (
        id, firm_id, matter_id, track_id, statement_version_id, deadline_projection_id,
        claim_type, requested_method, outcome, blockers_json, note, version,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'review_incomplete', '[]', ?, 1, ?, ?, ?)`)
        .run(id, user.firmId, matterId, trackId, input.statementVersionId,
          input.deadlineProjectionId, input.claimType, input.requestedMethod,
          input.note, user.id, createdAt, createdAt);
      this.database.prepare(`INSERT INTO default_judgment_review_events (
        id, firm_id, matter_id, review_id, outcome, blockers_json, note,
        reviewed_by, reviewed_at, recorded_at
      ) VALUES (?, ?, ?, ?, 'review_incomplete', '[]', ?, ?, ?, ?)`)
        .run(randomUUID(), user.firmId, matterId, id, input.note, user.id, createdAt, createdAt);
      const result = this.getDefaultReview(user.firmId, matterId, id)!;
      this.appendOperational(user, matterId, {
        action: 'pleadings.default_review_created', entityType: 'default_judgment_review',
        entityId: id, title: 'Default judgment review opened',
        idempotencyKey: input.idempotencyKey, after: result, occurredAt: createdAt,
      }, audit);
      this.saveReceipt(user, matterId, proceedingId, scope, id,
        input.idempotencyKey, input, result, createdAt);
      return result;
    });
  }

  completeDefaultReview(
    user: SessionUser, matterId: string, proceedingId: string, reviewId: string,
    input: CompleteDefaultReviewInput, audit: AuditContext,
  ) {
    const scope = `complete_default_review:${reviewId}`;
    const replay = this.receipt<NonNullable<ReturnType<PleadingsStore['getDefaultReview']>>>(
      user.firmId, matterId, scope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      const review = this.getDefaultReview(user.firmId, matterId, reviewId);
      if (!review) throw new PleadingsStoreError('NOT_FOUND', 'The default review was not found.');
      const track = this.getTrack(user.firmId, matterId, review.trackId);
      if (!track || track.proceedingId !== proceedingId) throw new PleadingsStoreError('NOT_FOUND', 'The default review was not found.');
      if (review.version !== input.expectedVersion) throw new PleadingsStoreError('CONFLICT', 'The default review changed. Refresh and try again.');
      const recordedAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO default_judgment_review_events (
        id, firm_id, matter_id, review_id, outcome, blockers_json, note,
        reviewed_by, reviewed_at, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), user.firmId, matterId, reviewId, input.outcome,
          JSON.stringify(input.blockers), input.note, user.id, input.reviewedAt, recordedAt);
      const updated = this.database.prepare(`UPDATE default_judgment_reviews SET
        outcome = ?, blockers_json = ?, note = ?, version = version + 1,
        reviewed_by = ?, reviewed_at = ?, updated_at = ?
        WHERE id = ? AND firm_id = ? AND matter_id = ? AND version = ?`)
        .run(input.outcome, JSON.stringify(input.blockers), input.note, user.id,
          input.reviewedAt, recordedAt, reviewId, user.firmId, matterId, input.expectedVersion);
      if (updated.changes !== 1) throw new PleadingsStoreError('CONFLICT', 'The default review changed. Refresh and try again.');
      const result = this.getDefaultReview(user.firmId, matterId, reviewId)!;
      this.appendOperational(user, matterId, {
        action: 'pleadings.default_review_recorded', entityType: 'default_judgment_review',
        entityId: reviewId, title: 'Human default judgment review recorded',
        idempotencyKey: input.idempotencyKey, after: result, occurredAt: recordedAt,
      }, audit);
      this.saveReceipt(user, matterId, proceedingId, scope, reviewId,
        input.idempotencyKey, input, result, recordedAt);
      return result;
    });
  }

  reviewDeadline(
    user: SessionUser, matterId: string, proceedingId: string, trackId: string,
    input: ReviewPleadingDeadlineInput, audit: AuditContext,
  ) {
    const scope = `review_deadline:${trackId}:${input.kind}`;
    const replay = this.receipt<Record<string, unknown>>(
      user.firmId, matterId, scope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      const track = this.getTrack(user.firmId, matterId, trackId);
      if (!track || track.proceedingId !== proceedingId) throw new PleadingsStoreError('NOT_FOUND', 'The response track was not found.');
      if (track.version !== input.expectedVersion) throw new PleadingsStoreError('CONFLICT', 'The response track changed. Refresh and try again.');
      if (input.sourceDocumentVersionId) this.assertDocumentVersion(user.firmId, matterId, input.sourceDocumentVersionId);
      const predecessor = this.database.prepare(`SELECT id FROM pleading_deadline_projections
        WHERE firm_id = ? AND matter_id = ? AND track_id = ? AND kind = ?
        ORDER BY created_at DESC, id DESC LIMIT 1`)
        .get(user.firmId, matterId, trackId, input.kind) as { id: string } | undefined;
      const id = randomUUID();
      const createdAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO pleading_deadline_projections (
        id, firm_id, matter_id, track_id, kind, outcome, trigger_date,
        projected_date, source_document_version_id, rule_key, rule_version,
        source_title, source_url, calculation_inputs_json, reviewed_by,
        reviewed_at, supersedes_projection_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, user.firmId, matterId, trackId, input.kind, input.outcome,
          input.triggerDate, input.projectedDate, input.sourceDocumentVersionId,
          input.ruleKey, input.ruleVersion, input.sourceTitle, input.sourceUrl,
          canonicalJson({ triggerDate: input.triggerDate, outcome: input.outcome }),
          user.id, input.reviewedAt, predecessor?.id ?? null, createdAt);
      this.database.prepare(`INSERT INTO claim_response_track_events (
        id, firm_id, matter_id, track_id, event_type, occurred_at, note,
        source_document_version_id, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, 'deadline_reviewed', ?, ?, ?, ?, ?)`)
        .run(randomUUID(), user.firmId, matterId, trackId, input.reviewedAt,
          input.note, input.sourceDocumentVersionId, user.id, createdAt);
      const updated = this.database.prepare(`UPDATE claim_response_tracks SET
        version = version + 1, updated_at = ? WHERE id = ? AND firm_id = ?
        AND matter_id = ? AND version = ?`)
        .run(createdAt, trackId, user.firmId, matterId, input.expectedVersion);
      if (updated.changes !== 1) throw new PleadingsStoreError('CONFLICT', 'The response track changed. Refresh and try again.');
      const result = {
        id, trackId, kind: input.kind, outcome: input.outcome,
        triggerDate: input.triggerDate, projectedDate: input.projectedDate,
        sourceDocumentVersionId: input.sourceDocumentVersionId,
        ruleKey: input.ruleKey, ruleVersion: input.ruleVersion,
        sourceTitle: input.sourceTitle, sourceUrl: input.sourceUrl,
        reviewedBy: user.id, reviewedAt: input.reviewedAt,
        supersedesProjectionId: predecessor?.id ?? null, createdAt,
      };
      this.appendOperational(user, matterId, {
        action: 'pleadings.deadline_reviewed', entityType: 'pleading_deadline_projection',
        entityId: id, title: 'Pleading response date reviewed',
        idempotencyKey: input.idempotencyKey, after: result, occurredAt: createdAt,
      }, audit);
      this.saveReceipt(user, matterId, proceedingId, scope, id,
        input.idempotencyKey, input, result, createdAt);
      return result;
    });
  }
}
