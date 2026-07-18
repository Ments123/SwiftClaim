import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
  CreateCourtApplicationInput,
  CreateCourtFilingInput,
  CreateCourtDirectionInput,
  CreateCourtHearingInput,
  CreateCourtOrderInput,
  CreateCourtServiceRecordInput,
  CreateProceedingAuthorityVersionInput,
  CreateProceedingInput,
  RecordCourtFilingEventInput,
  RecordCourtApplicationEventInput,
  RecordCourtDirectionEventInput,
  RecordCourtHearingEventInput,
  RecordCourtServiceEventInput,
  RecordProceedingEventInput,
} from '../../shared/contracts.js';
import {
  canReadAllFirmMatters,
  canWriteAllFirmMatters,
  hasCapability,
  type SessionUser,
} from '../policy.js';
import { appendAudit, appendTimeline, type AuditContext } from '../store.js';
import {
  projectApplication,
  projectFiling,
  projectDirection,
  projectHearing,
  projectProceeding,
  projectService,
  type ProjectionEvent,
} from './projections.js';

type Row = Record<string, string | number | null>;

export type ProceedingsStoreErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'INVALID_LINK';

export class ProceedingsStoreError extends Error {
  constructor(readonly code: ProceedingsStoreErrorCode, message: string) {
    super(message);
    this.name = 'ProceedingsStoreError';
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

function parseJson<T>(value: string | number | null, fallback: T): T {
  try {
    return JSON.parse(String(value ?? '')) as T;
  } catch {
    return fallback;
  }
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

function mapProceeding(value: Row) {
  return {
    id: String(value.id),
    proceedingReference: String(value.proceedingReference),
    procedureType: String(value.procedureType),
    jurisdiction: String(value.jurisdiction),
    courtName: String(value.courtName),
    courtCode: value.courtCode ? String(value.courtCode) : null,
    hearingCentre: value.hearingCentre ? String(value.hearingCentre) : null,
    caseNumber: value.caseNumber ? String(value.caseNumber) : null,
    track: value.track ? String(value.track) : null,
    currentState: String(value.currentState),
    currentAuthorityVersionId: value.currentAuthorityVersionId
      ? String(value.currentAuthorityVersionId) : null,
    sealedClaimFormVersionId: value.sealedClaimFormVersionId
      ? String(value.sealedClaimFormVersionId) : null,
    issuedAt: value.issuedAt ? String(value.issuedAt) : null,
    disposalPosition: String(value.disposalPosition),
    version: Number(value.version),
    active: Boolean(value.active),
    createdAt: String(value.createdAt),
    updatedAt: String(value.updatedAt),
  };
}

const proceedingSelect = `SELECT id, proceeding_reference AS proceedingReference,
  procedure_type AS procedureType, jurisdiction, court_name AS courtName,
  court_code AS courtCode, hearing_centre AS hearingCentre, case_number AS caseNumber,
  track, current_state AS currentState,
  current_authority_version_id AS currentAuthorityVersionId,
  sealed_claim_form_version_id AS sealedClaimFormVersionId, issued_at AS issuedAt,
  disposal_position AS disposalPosition, version, active, created_at AS createdAt,
  updated_at AS updatedAt FROM court_proceedings`;

function mapAuthority(value: Row) {
  return {
    id: String(value.id),
    proceedingId: String(value.proceedingId),
    version: Number(value.version),
    clientInstructionId: String(value.clientInstructionId),
    procedureType: String(value.procedureType),
    scope: String(value.scope),
    defendantPartyIds: parseJson<string[]>(value.defendantPartyIdsJson, []),
    claimFormDocumentVersionId: String(value.claimFormDocumentVersionId),
    particularsDocumentVersionId: value.particularsDocumentVersionId
      ? String(value.particularsDocumentVersionId) : null,
    preparedByUserId: String(value.preparedByUserId),
    approvedByUserId: String(value.approvedByUserId),
    limitationPosition: String(value.limitationPosition),
    risks: String(value.risks),
    reviewNote: String(value.reviewNote),
    expiresAt: value.expiresAt ? String(value.expiresAt) : null,
    reviewOn: value.reviewOn ? String(value.reviewOn) : null,
    createdAt: String(value.createdAt),
  };
}

const authoritySelect = `SELECT id, proceeding_id AS proceedingId, version,
  client_instruction_id AS clientInstructionId, procedure_type AS procedureType,
  scope, defendant_party_ids_json AS defendantPartyIdsJson,
  claim_form_document_version_id AS claimFormDocumentVersionId,
  particulars_document_version_id AS particularsDocumentVersionId,
  prepared_by_user_id AS preparedByUserId, approved_by_user_id AS approvedByUserId,
  limitation_position AS limitationPosition, risks, review_note AS reviewNote,
  expires_at AS expiresAt, review_on AS reviewOn, created_at AS createdAt
  FROM proceeding_authority_versions`;

function mapProceedingEvent(value: Row) {
  return {
    id: String(value.id),
    eventType: String(value.eventType),
    occurredAt: String(value.occurredAt),
    note: String(value.note),
    sourceDocumentVersionId: value.sourceDocumentVersionId
      ? String(value.sourceDocumentVersionId) : null,
    courtName: String(value.courtName),
    caseNumber: String(value.caseNumber),
    track: value.track ? String(value.track) : null,
    supersedesEventId: value.supersedesEventId ? String(value.supersedesEventId) : null,
    correctionReason: String(value.correctionReason),
    recordedBy: String(value.recordedBy),
    recordedAt: String(value.recordedAt),
  };
}

const proceedingEventSelect = `SELECT id, event_type AS eventType,
  occurred_at AS occurredAt, note, source_document_version_id AS sourceDocumentVersionId,
  court_name AS courtName, case_number AS caseNumber, track,
  supersedes_event_id AS supersedesEventId, correction_reason AS correctionReason,
  recorded_by AS recordedBy, recorded_at AS recordedAt FROM court_proceeding_events`;

function mapFiling(value: Row, documentVersionIds: string[], events: unknown[]) {
  return {
    id: String(value.id), proceedingId: String(value.proceedingId),
    filingReference: String(value.filingReference), purpose: String(value.purpose),
    submissionChannel: String(value.submissionChannel), feePosition: String(value.feePosition),
    feeMinor: value.feeMinor === null ? null : Number(value.feeMinor),
    currency: String(value.currency), currentState: String(value.currentState),
    version: Number(value.version), documentVersionIds, events,
    createdAt: String(value.createdAt), updatedAt: String(value.updatedAt),
  };
}

const filingSelect = `SELECT id, proceeding_id AS proceedingId,
  filing_reference AS filingReference, purpose, submission_channel AS submissionChannel,
  fee_position AS feePosition, fee_minor AS feeMinor, currency,
  current_state AS currentState, version, created_at AS createdAt,
  updated_at AS updatedAt FROM court_filings`;

function mapFilingEvent(value: Row) {
  return {
    id: String(value.id), eventType: String(value.eventType),
    occurredAt: String(value.occurredAt), note: String(value.note),
    receiptDocumentVersionId: value.receiptDocumentVersionId
      ? String(value.receiptDocumentVersionId) : null,
    externalReference: value.externalReference ? String(value.externalReference) : null,
    rejectionReason: String(value.rejectionReason),
    supersedesEventId: value.supersedesEventId ? String(value.supersedesEventId) : null,
    correctionReason: String(value.correctionReason),
    recordedBy: String(value.recordedBy), recordedAt: String(value.recordedAt),
  };
}

const filingEventSelect = `SELECT id, event_type AS eventType, occurred_at AS occurredAt,
  note, receipt_document_version_id AS receiptDocumentVersionId,
  external_reference AS externalReference, rejection_reason AS rejectionReason,
  supersedes_event_id AS supersedesEventId, correction_reason AS correctionReason,
  recorded_by AS recordedBy, recorded_at AS recordedAt FROM court_filing_events`;

function mapServiceRecord(value: Row, events: unknown[]) {
  return {
    id: String(value.id), proceedingId: String(value.proceedingId),
    serviceReference: String(value.serviceReference),
    courtDocumentVersionId: String(value.courtDocumentVersionId),
    recipientPartyId: String(value.recipientPartyId), method: String(value.method),
    serviceAddress: String(value.serviceAddress),
    jurisdictionPosition: String(value.jurisdictionPosition),
    currentState: String(value.currentState), version: Number(value.version), events,
    createdAt: String(value.createdAt), updatedAt: String(value.updatedAt),
  };
}

const serviceSelect = `SELECT id, proceeding_id AS proceedingId,
  service_reference AS serviceReference, court_document_version_id AS courtDocumentVersionId,
  recipient_party_id AS recipientPartyId, method, service_address AS serviceAddress,
  jurisdiction_position AS jurisdictionPosition, current_state AS currentState,
  version, created_at AS createdAt, updated_at AS updatedAt FROM court_service_records`;

function mapServiceEvent(value: Row) {
  return {
    id: String(value.id), eventType: String(value.eventType),
    occurredAt: String(value.occurredAt), note: String(value.note),
    preciseStep: String(value.preciseStep),
    assertedServiceAt: value.assertedServiceAt ? String(value.assertedServiceAt) : null,
    assertedDeemedServiceAt: value.assertedDeemedServiceAt
      ? String(value.assertedDeemedServiceAt) : null,
    reviewPosition: String(value.reviewPosition), ruleSourceTitle: String(value.ruleSourceTitle),
    ruleSourceUrl: String(value.ruleSourceUrl),
    evidenceDocumentVersionIds: parseJson<string[]>(value.evidenceDocumentVersionIdsJson, []),
    evidenceCommunicationEntryIds: parseJson<string[]>(value.evidenceCommunicationEntryIdsJson, []),
    supersedesEventId: value.supersedesEventId ? String(value.supersedesEventId) : null,
    correctionReason: String(value.correctionReason),
    recordedBy: String(value.recordedBy), recordedAt: String(value.recordedAt),
  };
}

const serviceEventSelect = `SELECT id, event_type AS eventType, occurred_at AS occurredAt,
  note, precise_step AS preciseStep, asserted_service_at AS assertedServiceAt,
  asserted_deemed_service_at AS assertedDeemedServiceAt, review_position AS reviewPosition,
  rule_source_title AS ruleSourceTitle, rule_source_url AS ruleSourceUrl,
  evidence_document_version_ids_json AS evidenceDocumentVersionIdsJson,
  evidence_communication_entry_ids_json AS evidenceCommunicationEntryIdsJson,
  supersedes_event_id AS supersedesEventId, correction_reason AS correctionReason,
  recorded_by AS recordedBy, recorded_at AS recordedAt FROM court_service_events`;

function mapApplicationEvent(value: Row) {
  return {
    id: String(value.id), eventType: String(value.eventType),
    occurredAt: String(value.occurredAt), note: String(value.note),
    sourceDocumentVersionId: value.sourceDocumentVersionId
      ? String(value.sourceDocumentVersionId) : null,
    resultingOrderId: value.resultingOrderId ? String(value.resultingOrderId) : null,
    supersedesEventId: value.supersedesEventId ? String(value.supersedesEventId) : null,
    correctionReason: String(value.correctionReason),
    recordedBy: String(value.recordedBy), recordedAt: String(value.recordedAt),
  };
}

const applicationEventSelect = `SELECT id, event_type AS eventType,
  occurred_at AS occurredAt, note, source_document_version_id AS sourceDocumentVersionId,
  resulting_order_id AS resultingOrderId, supersedes_event_id AS supersedesEventId,
  correction_reason AS correctionReason, recorded_by AS recordedBy,
  recorded_at AS recordedAt FROM court_application_events`;

function mapApplication(value: Row, events: ReturnType<typeof mapApplicationEvent>[]) {
  const projection = projectApplication(events.map((event): ProjectionEvent => ({
    id: event.id, eventType: event.eventType, occurredAt: event.occurredAt,
    recordedAt: event.recordedAt, supersedesEventId: event.supersedesEventId,
  })));
  return {
    id: String(value.id), proceedingId: String(value.proceedingId),
    applicationReference: String(value.applicationReference),
    applicantPartyId: String(value.applicantPartyId),
    respondentPartyIds: parseJson<string[]>(value.respondentPartyIdsJson, []),
    requestedOrder: String(value.requestedOrder), groundsSummary: String(value.groundsSummary),
    noticePosition: String(value.noticePosition),
    hearingRequiredPosition: String(value.hearingRequiredPosition),
    applicationNoticeVersionId: String(value.applicationNoticeVersionId),
    evidenceDocumentVersionIds: parseJson<string[]>(value.evidenceDocumentVersionIdsJson, []),
    draftOrderVersionId: value.draftOrderVersionId ? String(value.draftOrderVersionId) : null,
    currentState: String(value.currentState), version: Number(value.version),
    events, projection, createdAt: String(value.createdAt), updatedAt: String(value.updatedAt),
  };
}

const applicationSelect = `SELECT id, proceeding_id AS proceedingId,
  application_reference AS applicationReference, applicant_party_id AS applicantPartyId,
  respondent_party_ids_json AS respondentPartyIdsJson, requested_order AS requestedOrder,
  grounds_summary AS groundsSummary, notice_position AS noticePosition,
  hearing_required_position AS hearingRequiredPosition,
  application_notice_version_id AS applicationNoticeVersionId,
  evidence_document_version_ids_json AS evidenceDocumentVersionIdsJson,
  draft_order_version_id AS draftOrderVersionId, current_state AS currentState,
  version, created_at AS createdAt, updated_at AS updatedAt FROM court_applications`;

function mapOrder(value: Row) {
  return {
    id: String(value.id), proceedingId: String(value.proceedingId),
    orderReference: String(value.orderReference), orderType: String(value.orderType),
    title: String(value.title), orderDate: String(value.orderDate),
    takesEffectAt: String(value.takesEffectAt), judgeName: String(value.judgeName),
    judicialTitle: String(value.judicialTitle),
    sealedDocumentVersionId: String(value.sealedDocumentVersionId),
    variesOrderId: value.variesOrderId ? String(value.variesOrderId) : null,
    supersedesOrderId: value.supersedesOrderId ? String(value.supersedesOrderId) : null,
    servicePosition: String(value.servicePosition),
    createdBy: String(value.createdBy), createdAt: String(value.createdAt),
  };
}

const orderSelect = `SELECT id, proceeding_id AS proceedingId,
  order_reference AS orderReference, order_type AS orderType, title,
  order_date AS orderDate, takes_effect_at AS takesEffectAt, judge_name AS judgeName,
  judicial_title AS judicialTitle, sealed_document_version_id AS sealedDocumentVersionId,
  varies_order_id AS variesOrderId, supersedes_order_id AS supersedesOrderId,
  service_position AS servicePosition, created_by AS createdBy, created_at AS createdAt
  FROM court_orders`;

function mapDirectionEvent(value: Row) {
  return {
    id: String(value.id), eventType: String(value.eventType),
    occurredAt: String(value.occurredAt), note: String(value.note),
    evidenceDocumentVersionIds: parseJson<string[]>(value.evidenceDocumentVersionIdsJson, []),
    evidenceFilingIds: parseJson<string[]>(value.evidenceFilingIdsJson, []),
    evidenceServiceRecordIds: parseJson<string[]>(value.evidenceServiceRecordIdsJson, []),
    sourceOrderId: value.sourceOrderId ? String(value.sourceOrderId) : null,
    revisedDueAt: value.revisedDueAt ? String(value.revisedDueAt) : null,
    supersedesEventId: value.supersedesEventId ? String(value.supersedesEventId) : null,
    correctionReason: String(value.correctionReason),
    recordedBy: String(value.recordedBy), recordedAt: String(value.recordedAt),
  };
}

const directionEventSelect = `SELECT id, event_type AS eventType,
  occurred_at AS occurredAt, note,
  evidence_document_version_ids_json AS evidenceDocumentVersionIdsJson,
  evidence_filing_ids_json AS evidenceFilingIdsJson,
  evidence_service_record_ids_json AS evidenceServiceRecordIdsJson,
  source_order_id AS sourceOrderId, revised_due_at AS revisedDueAt,
  supersedes_event_id AS supersedesEventId, correction_reason AS correctionReason,
  recorded_by AS recordedBy, recorded_at AS recordedAt FROM court_direction_events`;

function mapDirection(value: Row, events: ReturnType<typeof mapDirectionEvent>[], now: string) {
  const projection = projectDirection(events.map((event): ProjectionEvent => ({
    id: event.id, eventType: event.eventType, occurredAt: event.occurredAt,
    recordedAt: event.recordedAt, supersedesEventId: event.supersedesEventId,
  })), now, value.dueAt ? String(value.dueAt) : null);
  return {
    id: String(value.id), proceedingId: String(value.proceedingId),
    directionReference: String(value.directionReference),
    sourceOrderId: value.sourceOrderId ? String(value.sourceOrderId) : null,
    ruleSourceTitle: String(value.ruleSourceTitle), ruleSourceUrl: String(value.ruleSourceUrl),
    responsiblePartyId: String(value.responsiblePartyId), category: String(value.category),
    requirementText: String(value.requirementText),
    dueAt: value.dueAt ? String(value.dueAt) : null, timezone: String(value.timezone),
    sanctionExpresslyStated: Boolean(value.sanctionExpresslyStated),
    sanctionText: String(value.sanctionText),
    assignedUserId: value.assignedUserId ? String(value.assignedUserId) : null,
    currentState: String(value.currentState), version: Number(value.version),
    events, projection, createdAt: String(value.createdAt), updatedAt: String(value.updatedAt),
  };
}

const directionSelect = `SELECT id, proceeding_id AS proceedingId,
  direction_reference AS directionReference, source_order_id AS sourceOrderId,
  rule_source_title AS ruleSourceTitle, rule_source_url AS ruleSourceUrl,
  responsible_party_id AS responsiblePartyId, category, requirement_text AS requirementText,
  due_at AS dueAt, timezone, sanction_expressly_stated AS sanctionExpresslyStated,
  sanction_text AS sanctionText, assigned_user_id AS assignedUserId,
  current_state AS currentState, version, created_at AS createdAt,
  updated_at AS updatedAt FROM court_directions`;

function mapHearingEvent(value: Row) {
  return {
    id: String(value.id), eventType: String(value.eventType),
    occurredAt: String(value.occurredAt), note: String(value.note),
    sourceDocumentVersionId: value.sourceDocumentVersionId
      ? String(value.sourceDocumentVersionId) : null,
    resultingOrderId: value.resultingOrderId ? String(value.resultingOrderId) : null,
    revisedStartsAt: value.revisedStartsAt ? String(value.revisedStartsAt) : null,
    supersedesEventId: value.supersedesEventId ? String(value.supersedesEventId) : null,
    correctionReason: String(value.correctionReason),
    recordedBy: String(value.recordedBy), recordedAt: String(value.recordedAt),
  };
}

const hearingEventSelect = `SELECT id, event_type AS eventType,
  occurred_at AS occurredAt, note, source_document_version_id AS sourceDocumentVersionId,
  resulting_order_id AS resultingOrderId, revised_starts_at AS revisedStartsAt,
  supersedes_event_id AS supersedesEventId, correction_reason AS correctionReason,
  recorded_by AS recordedBy, recorded_at AS recordedAt FROM court_hearing_events`;

function mapHearing(value: Row, events: ReturnType<typeof mapHearingEvent>[]) {
  const projection = projectHearing(events.map((event): ProjectionEvent => ({
    id: event.id, eventType: event.eventType, occurredAt: event.occurredAt,
    recordedAt: event.recordedAt, supersedesEventId: event.supersedesEventId,
  })));
  const resultingOrderId = [...events].reverse()
    .find((event) => event.resultingOrderId)?.resultingOrderId ?? null;
  return {
    id: String(value.id), proceedingId: String(value.proceedingId),
    hearingReference: String(value.hearingReference), hearingType: String(value.hearingType),
    title: String(value.title), listingNoticeVersionId: String(value.listingNoticeVersionId),
    startsAt: String(value.startsAt), endsAt: value.endsAt ? String(value.endsAt) : null,
    timezone: String(value.timezone), courtName: String(value.courtName), venue: String(value.venue),
    attendanceMode: String(value.attendanceMode),
    remoteAccessDetails: String(value.remoteAccessDetails), privacyPosition: String(value.privacyPosition),
    judgeName: String(value.judgeName),
    advocateNames: parseJson<string[]>(value.advocateNamesJson, []),
    attendeeNames: parseJson<string[]>(value.attendeeNamesJson, []),
    bundleDocumentVersionId: value.bundleDocumentVersionId ? String(value.bundleDocumentVersionId) : null,
    currentState: String(value.currentState), version: Number(value.version),
    events, projection, resultingOrderId,
    createdAt: String(value.createdAt), updatedAt: String(value.updatedAt),
  };
}

const hearingSelect = `SELECT id, proceeding_id AS proceedingId,
  hearing_reference AS hearingReference, hearing_type AS hearingType, title,
  listing_notice_version_id AS listingNoticeVersionId, starts_at AS startsAt,
  ends_at AS endsAt, timezone, court_name AS courtName, venue,
  attendance_mode AS attendanceMode, remote_access_details AS remoteAccessDetails,
  privacy_position AS privacyPosition, judge_name AS judgeName,
  advocate_names_json AS advocateNamesJson, attendee_names_json AS attendeeNamesJson,
  bundle_document_version_id AS bundleDocumentVersionId, current_state AS currentState,
  version, created_at AS createdAt, updated_at AS updatedAt FROM court_hearings`;

export class ProceedingsStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date,
  ) {}

  private canReadMatter(user: SessionUser, matterId: string): boolean {
    if (!hasCapability(user, 'matter.read') || !hasCapability(user, 'proceedings.read')) return false;
    if (canReadAllFirmMatters(user)) {
      return Boolean(this.database.prepare('SELECT 1 FROM matters WHERE id = ? AND firm_id = ?')
        .get(matterId, user.firmId));
    }
    return Boolean(this.database.prepare(`SELECT 1 FROM matters m
      WHERE m.id = ? AND m.firm_id = ? AND (m.owner_user_id = ? OR EXISTS (
        SELECT 1 FROM matter_members mm WHERE mm.firm_id = m.firm_id
        AND mm.matter_id = m.id AND mm.user_id = ?
      ))`).get(matterId, user.firmId, user.id, user.id));
  }

  private canWriteMatter(user: SessionUser, matterId: string): boolean {
    if (!hasCapability(user, 'matter.write') || !hasCapability(user, 'proceedings.prepare')) return false;
    if (canWriteAllFirmMatters(user)) {
      return Boolean(this.database.prepare('SELECT 1 FROM matters WHERE id = ? AND firm_id = ?')
        .get(matterId, user.firmId));
    }
    return Boolean(this.database.prepare(`SELECT 1 FROM matters m
      WHERE m.id = ? AND m.firm_id = ? AND (m.owner_user_id = ? OR EXISTS (
        SELECT 1 FROM matter_members mm WHERE mm.firm_id = m.firm_id
        AND mm.matter_id = m.id AND mm.user_id = ? AND mm.access_level = 'write'
      ))`).get(matterId, user.firmId, user.id, user.id));
  }

  private requireProceeding(user: SessionUser, matterId: string, proceedingId: string) {
    if (!this.canWriteMatter(user, matterId)) {
      throw new ProceedingsStoreError('NOT_FOUND', 'The proceedings workspace was not found.');
    }
    const proceeding = this.getProceeding(user.firmId, matterId, proceedingId);
    if (!proceeding) {
      throw new ProceedingsStoreError('NOT_FOUND', 'The proceeding was not found.');
    }
    return proceeding;
  }

  private requireDocumentVersion(firmId: string, matterId: string, versionId: string | null): void {
    if (!versionId) return;
    if (!this.database.prepare(`SELECT 1 FROM document_versions dv
      JOIN documents d ON d.id = dv.document_id AND d.firm_id = dv.firm_id
      WHERE dv.id = ? AND dv.firm_id = ? AND d.matter_id = ?`)
      .get(versionId, firmId, matterId)) {
      throw new ProceedingsStoreError('INVALID_LINK', 'The source document version was not found.');
    }
  }

  private receipt<T>(
    user: SessionUser,
    matterId: string,
    scope: string,
    idempotencyKey: string,
    input: unknown,
  ): T | undefined {
    const found = this.database.prepare(`SELECT input_hash AS inputHash,
      response_json AS responseJson FROM proceedings_command_receipts
      WHERE firm_id = ? AND matter_id = ? AND command_scope = ? AND idempotency_key = ?`)
      .get(user.firmId, matterId, scope, idempotencyKey) as
      | { inputHash: string; responseJson: string } | undefined;
    if (!found) return undefined;
    if (found.inputHash !== digest(input)) {
      throw new ProceedingsStoreError('IDEMPOTENCY_KEY_REUSED', 'The idempotency key was already used with different input.');
    }
    return JSON.parse(found.responseJson) as T;
  }

  private saveReceipt(
    user: SessionUser,
    matterId: string,
    proceedingId: string,
    scope: string,
    routeEntityId: string,
    idempotencyKey: string,
    input: unknown,
    response: unknown,
    createdAt: string,
  ): void {
    this.database.prepare(`INSERT INTO proceedings_command_receipts (
      id, firm_id, matter_id, proceeding_id, command_scope, route_entity_id,
      idempotency_key, input_hash, response_json, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), user.firmId, matterId, proceedingId, scope, routeEntityId,
        idempotencyKey, digest(input), canonicalJson(response), user.id, createdAt);
  }

  private appendOperational(
    user: SessionUser,
    matterId: string,
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
        `proceedings:${details.action}:${details.idempotencyKey}`,
        canonicalJson({ entityType: details.entityType, entityId: details.entityId }),
        details.occurredAt);
    this.database.prepare(`INSERT INTO integration_outbox (
      id, firm_id, matter_id, topic, payload_json, status, attempts,
      available_at, created_at, deduplication_key
    ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`)
      .run(randomUUID(), user.firmId, matterId, details.action,
        canonicalJson({ matterId, entityType: details.entityType, entityId: details.entityId }),
        details.occurredAt, details.occurredAt,
        `proceedings:${user.firmId}:${matterId}:${details.action}:${details.idempotencyKey}`);
  }

  getProceeding(firmId: string, matterId: string, proceedingId: string) {
    const value = this.database.prepare(
      `${proceedingSelect} WHERE firm_id = ? AND matter_id = ? AND id = ?`,
    ).get(firmId, matterId, proceedingId) as Row | undefined;
    return value ? mapProceeding(value) : undefined;
  }

  getWorkspace(user: SessionUser, matterId: string) {
    if (!this.canReadMatter(user, matterId)) return undefined;
    const proceedingRow = this.database.prepare(
      `${proceedingSelect} WHERE firm_id = ? AND matter_id = ? AND active = 1
       ORDER BY updated_at DESC, id DESC LIMIT 1`,
    ).get(user.firmId, matterId) as Row | undefined;
    const proceeding = proceedingRow ? mapProceeding(proceedingRow) : null;
    const authorityRow = proceeding ? this.database.prepare(
      `${authoritySelect} WHERE firm_id = ? AND matter_id = ? AND proceeding_id = ?
       ORDER BY version DESC LIMIT 1`,
    ).get(user.firmId, matterId, proceeding.id) as Row | undefined : undefined;
    const eventRows = proceeding ? this.database.prepare(
      `${proceedingEventSelect} WHERE firm_id = ? AND matter_id = ? AND proceeding_id = ?
       ORDER BY occurred_at, recorded_at, id`,
    ).all(user.firmId, matterId, proceeding.id) as Row[] : [];
    const filingRows = proceeding ? this.database.prepare(
      `${filingSelect} WHERE firm_id = ? AND matter_id = ? AND proceeding_id = ?
       ORDER BY created_at DESC, id DESC`,
    ).all(user.firmId, matterId, proceeding.id) as Row[] : [];
    const filings = filingRows.map((filing) => {
      const documents = (this.database.prepare(`SELECT document_version_id AS id
        FROM court_filing_documents WHERE firm_id = ? AND matter_id = ? AND filing_id = ?
        ORDER BY position`).all(user.firmId, matterId, filing.id) as Array<{ id: string }>)
        .map(({ id }) => id);
      const events = (this.database.prepare(`${filingEventSelect}
        WHERE firm_id = ? AND matter_id = ? AND filing_id = ?
        ORDER BY occurred_at, recorded_at, id`).all(user.firmId, matterId, filing.id) as Row[])
        .map(mapFilingEvent);
      return mapFiling(filing, documents, events);
    });
    const serviceRows = proceeding ? this.database.prepare(
      `${serviceSelect} WHERE firm_id = ? AND matter_id = ? AND proceeding_id = ?
       ORDER BY created_at DESC, id DESC`,
    ).all(user.firmId, matterId, proceeding.id) as Row[] : [];
    const services = serviceRows.map((service) => {
      const events = (this.database.prepare(`${serviceEventSelect}
        WHERE firm_id = ? AND matter_id = ? AND service_record_id = ?
        ORDER BY occurred_at, recorded_at, id`).all(user.firmId, matterId, service.id) as Row[])
        .map(mapServiceEvent);
      return mapServiceRecord(service, events);
    });
    const applicationRows = proceeding ? this.database.prepare(
      `${applicationSelect} WHERE firm_id = ? AND matter_id = ? AND proceeding_id = ?
       ORDER BY created_at DESC, id DESC`,
    ).all(user.firmId, matterId, proceeding.id) as Row[] : [];
    const applications = applicationRows.map((application) => {
      const events = (this.database.prepare(`${applicationEventSelect}
        WHERE firm_id = ? AND matter_id = ? AND application_id = ?
        ORDER BY occurred_at, recorded_at, id`)
        .all(user.firmId, matterId, application.id) as Row[]).map(mapApplicationEvent);
      return mapApplication(application, events);
    });
    const orderRows = proceeding ? this.database.prepare(
      `${orderSelect} WHERE firm_id = ? AND matter_id = ? AND proceeding_id = ?
       ORDER BY order_date DESC, created_at DESC, id DESC`,
    ).all(user.firmId, matterId, proceeding.id) as Row[] : [];
    const directionRows = proceeding ? this.database.prepare(
      `${directionSelect} WHERE firm_id = ? AND matter_id = ? AND proceeding_id = ?
       ORDER BY due_at, created_at, id`,
    ).all(user.firmId, matterId, proceeding.id) as Row[] : [];
    const directions = directionRows.map((direction) => {
      const events = (this.database.prepare(`${directionEventSelect}
        WHERE firm_id = ? AND matter_id = ? AND direction_id = ?
        ORDER BY occurred_at, recorded_at, id`).all(user.firmId, matterId, direction.id) as Row[])
        .map(mapDirectionEvent);
      return mapDirection(direction, events, this.now().toISOString());
    });
    const hearingRows = proceeding ? this.database.prepare(
      `${hearingSelect} WHERE firm_id = ? AND matter_id = ? AND proceeding_id = ?
       ORDER BY starts_at, created_at, id`,
    ).all(user.firmId, matterId, proceeding.id) as Row[] : [];
    const hearings = hearingRows.map((hearing) => {
      const events = (this.database.prepare(`${hearingEventSelect}
        WHERE firm_id = ? AND matter_id = ? AND hearing_id = ?
        ORDER BY occurred_at, recorded_at, id`).all(user.firmId, matterId, hearing.id) as Row[])
        .map(mapHearingEvent);
      return mapHearing(hearing, events);
    });
    const sourceDocuments = (this.database.prepare(`SELECT dv.id, d.title,
      dv.version, dv.original_name AS originalName
      FROM document_versions dv JOIN documents d
      ON d.id = dv.document_id AND d.firm_id = dv.firm_id
      WHERE dv.firm_id = ? AND d.matter_id = ?
      ORDER BY d.title, dv.version DESC`).all(user.firmId, matterId) as Row[])
      .map((row) => ({ id: String(row.id), title: String(row.title),
        version: Number(row.version), originalName: String(row.originalName) }));
    const sourceParties = (this.database.prepare(`SELECT id, name, kind
      FROM parties WHERE firm_id = ? AND matter_id = ? ORDER BY name, id`)
      .all(user.firmId, matterId) as Row[]).map((row) => ({
      id: String(row.id), name: String(row.name), kind: String(row.kind),
    }));
    const sourceUsers = (this.database.prepare(`SELECT id, name, role FROM users
      WHERE firm_id = ? AND active = 1 ORDER BY name, id`).all(user.firmId) as Row[])
      .map((row) => ({ id: String(row.id), name: String(row.name), role: String(row.role) }));
    const sourceInstructions = (this.database.prepare(`SELECT id, instruction_type AS instructionType,
      instructing_person AS instructingPerson, received_at AS receivedAt
      FROM client_instructions WHERE firm_id = ? AND matter_id = ?
      AND (confidentiality = 'ordinary' OR ? = 1)
      ORDER BY received_at DESC, created_at DESC`).all(
        user.firmId, matterId, hasCapability(user, 'negotiation.read_protected') ? 1 : 0,
      ) as Row[])
      .map((row) => ({ id: String(row.id), instructionType: String(row.instructionType),
        instructingPerson: String(row.instructingPerson), receivedAt: String(row.receivedAt) }));
    return {
      proceeding,
      authority: authorityRow ? mapAuthority(authorityRow) : null,
      events: eventRows.map(mapProceedingEvent),
      filings,
      services,
      applications,
      orders: orderRows.map(mapOrder),
      directions,
      hearings,
      risks: [],
      sources: {
        documents: sourceDocuments, parties: sourceParties,
        users: sourceUsers, clientInstructions: sourceInstructions,
      },
    };
  }

  createProceeding(
    user: SessionUser,
    matterId: string,
    input: CreateProceedingInput,
    audit: AuditContext,
  ) {
    if (!this.canWriteMatter(user, matterId)) {
      throw new ProceedingsStoreError('NOT_FOUND', 'The proceedings workspace was not found.');
    }
    const inputHash = digest(input);
    const receipt = this.database.prepare(`SELECT input_hash AS inputHash,
      response_json AS responseJson FROM proceedings_command_receipts
      WHERE firm_id = ? AND matter_id = ? AND command_scope = 'create_proceeding'
      AND idempotency_key = ?`).get(user.firmId, matterId, input.idempotencyKey) as
      | { inputHash: string; responseJson: string } | undefined;
    if (receipt) {
      if (receipt.inputHash !== inputHash) {
        throw new ProceedingsStoreError('IDEMPOTENCY_KEY_REUSED', 'The idempotency key was already used with different input.');
      }
      return JSON.parse(receipt.responseJson) as ReturnType<typeof mapProceeding>;
    }

    return transaction(this.database, () => {
      const createdAt = this.now().toISOString();
      const id = randomUUID();
      const next = Number((this.database.prepare(`SELECT COALESCE(COUNT(*), 0) + 1 AS next
        FROM court_proceedings WHERE firm_id = ? AND matter_id = ?`)
        .get(user.firmId, matterId) as { next: number }).next);
      const reference = `CRT-${String(next).padStart(3, '0')}`;
      this.database.prepare(`INSERT INTO court_proceedings (
        id, firm_id, matter_id, proceeding_reference, procedure_type, jurisdiction,
        court_name, court_code, hearing_centre, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, user.firmId, matterId, reference, input.procedureType,
          input.jurisdiction, input.courtName, input.courtCode, input.hearingCentre,
          user.id, createdAt, createdAt);
      const created = this.getProceeding(user.firmId, matterId, id);
      if (!created) throw new ProceedingsStoreError('CONFLICT', 'The proceeding could not be read after creation.');

      appendTimeline(this.database, {
        firmId: user.firmId, matterId, type: 'proceedings.created',
        title: 'Court proceeding workspace created', actorUserId: user.id,
        occurredAt: createdAt, metadata: { proceedingId: id, proceedingReference: reference },
      });
      appendAudit(this.database, {
        firmId: user.firmId, matterId, userId: user.id, action: 'proceedings.created',
        entityType: 'court_proceeding', entityId: id, after: created,
        requestId: audit.requestId, ipAddress: audit.ipAddress, createdAt,
      });
      this.database.prepare(`INSERT INTO domain_events (
        id, firm_id, matter_id, type, occurred_on, actor_user_id,
        idempotency_key, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), user.firmId, matterId, 'proceedings.created',
          createdAt.slice(0, 10), user.id, `proceedings:${input.idempotencyKey}`,
          canonicalJson({ proceedingId: id }), createdAt);
      this.database.prepare(`INSERT INTO integration_outbox (
        id, firm_id, matter_id, topic, payload_json, status, attempts,
        available_at, created_at, deduplication_key
      ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`)
        .run(randomUUID(), user.firmId, matterId, 'proceedings.created',
          canonicalJson({ matterId, proceedingId: id }), createdAt, createdAt,
          `proceedings:${user.firmId}:${matterId}:create:${input.idempotencyKey}`);
      this.database.prepare(`INSERT INTO proceedings_command_receipts (
        id, firm_id, matter_id, proceeding_id, command_scope, route_entity_id,
        idempotency_key, input_hash, response_json, created_by, created_at
      ) VALUES (?, ?, ?, ?, 'create_proceeding', ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), user.firmId, matterId, id, matterId,
          input.idempotencyKey, inputHash, canonicalJson(created), user.id, createdAt);
      return created;
    });
  }

  createAuthorityVersion(
    user: SessionUser,
    matterId: string,
    proceedingId: string,
    input: CreateProceedingAuthorityVersionInput,
    audit: AuditContext,
  ) {
    const proceeding = this.requireProceeding(user, matterId, proceedingId);
    const scope = `create_authority:${proceedingId}`;
    const replay = this.receipt<ReturnType<typeof mapAuthority>>(
      user, matterId, scope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      if (!this.database.prepare(`SELECT 1 FROM client_instructions
        WHERE id = ? AND firm_id = ? AND matter_id = ?`)
        .get(input.clientInstructionId, user.firmId, matterId)) {
        throw new ProceedingsStoreError('INVALID_LINK', 'The client instruction was not found.');
      }
      for (const partyId of input.defendantPartyIds) {
        if (!this.database.prepare(`SELECT 1 FROM parties
          WHERE id = ? AND firm_id = ? AND matter_id = ?`)
          .get(partyId, user.firmId, matterId)) {
          throw new ProceedingsStoreError('INVALID_LINK', 'A defendant party was not found.');
        }
      }
      for (const userId of [input.preparedByUserId, input.approvedByUserId]) {
        if (!this.database.prepare('SELECT 1 FROM users WHERE id = ? AND firm_id = ?')
          .get(userId, user.firmId)) {
          throw new ProceedingsStoreError('INVALID_LINK', 'An authority user was not found.');
        }
      }
      this.requireDocumentVersion(user.firmId, matterId, input.claimFormDocumentVersionId);
      this.requireDocumentVersion(user.firmId, matterId, input.particularsDocumentVersionId);
      const createdAt = this.now().toISOString();
      const id = randomUUID();
      const version = Number((this.database.prepare(`SELECT COALESCE(MAX(version), 0) + 1 AS next
        FROM proceeding_authority_versions WHERE firm_id = ? AND matter_id = ? AND proceeding_id = ?`)
        .get(user.firmId, matterId, proceedingId) as { next: number }).next);
      this.database.prepare(`INSERT INTO proceeding_authority_versions (
        id, firm_id, matter_id, proceeding_id, version, client_instruction_id,
        procedure_type, scope, defendant_party_ids_json, claim_form_document_version_id,
        particulars_document_version_id, prepared_by_user_id, approved_by_user_id,
        limitation_position, risks, review_note, expires_at, review_on, explicit_approval,
        idempotency_key, command_payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
        .run(id, user.firmId, matterId, proceedingId, version, input.clientInstructionId,
          input.procedureType, input.scope, canonicalJson(input.defendantPartyIds),
          input.claimFormDocumentVersionId, input.particularsDocumentVersionId,
          input.preparedByUserId, input.approvedByUserId, input.limitationPosition,
          input.risks, input.reviewNote, input.expiresAt, input.reviewOn,
          input.idempotencyKey, canonicalJson(input), createdAt);
      const result = mapAuthority(this.database.prepare(
        `${authoritySelect} WHERE id = ? AND firm_id = ? AND matter_id = ?`,
      ).get(id, user.firmId, matterId) as Row);
      const update = this.database.prepare(`UPDATE court_proceedings
        SET current_authority_version_id = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND firm_id = ? AND matter_id = ? AND version = ?`)
        .run(id, createdAt, proceedingId, user.firmId, matterId, proceeding.version);
      if (Number(update.changes) !== 1) throw new ProceedingsStoreError('CONFLICT', 'The proceeding changed before authority was recorded.');
      this.saveReceipt(user, matterId, proceedingId, scope, proceedingId,
        input.idempotencyKey, input, result, createdAt);
      this.appendOperational(user, matterId, {
        action: 'proceedings.authority_recorded', entityType: 'proceeding_authority_version',
        entityId: id, title: 'Court issue authority recorded', idempotencyKey: input.idempotencyKey,
        after: result, occurredAt: createdAt,
      }, audit);
      return result;
    });
  }

  recordProceedingEvent(
    user: SessionUser,
    matterId: string,
    proceedingId: string,
    input: RecordProceedingEventInput,
    audit: AuditContext,
  ) {
    const proceeding = this.requireProceeding(user, matterId, proceedingId);
    const scope = `record_event:${proceedingId}`;
    const replay = this.receipt<ReturnType<typeof mapProceeding>>(
      user, matterId, scope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    if (proceeding.version !== input.expectedVersion) {
      throw new ProceedingsStoreError('CONFLICT', 'The proceeding changed before the event was recorded.');
    }
    return transaction(this.database, () => {
      this.requireDocumentVersion(user.firmId, matterId, input.sourceDocumentVersionId);
      if (input.supersedesEventId && !this.database.prepare(`SELECT 1 FROM court_proceeding_events
        WHERE id = ? AND proceeding_id = ? AND firm_id = ? AND matter_id = ?`)
        .get(input.supersedesEventId, proceedingId, user.firmId, matterId)) {
        throw new ProceedingsStoreError('INVALID_LINK', 'The corrected proceeding event was not found.');
      }
      const recordedAt = this.now().toISOString();
      const id = randomUUID();
      this.database.prepare(`INSERT INTO court_proceeding_events (
        id, firm_id, matter_id, proceeding_id, event_type, occurred_at, note,
        source_document_version_id, court_name, case_number, track, supersedes_event_id,
        correction_reason, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, user.firmId, matterId, proceedingId, input.eventType, input.occurredAt,
          input.note, input.sourceDocumentVersionId, input.courtName, input.caseNumber,
          input.track, input.supersedesEventId, input.correctionReason, user.id, recordedAt);
      const eventRows = this.database.prepare(`${proceedingEventSelect}
        WHERE firm_id = ? AND matter_id = ? AND proceeding_id = ?`)
        .all(user.firmId, matterId, proceedingId) as Row[];
      const projection = projectProceeding(eventRows.map((value): ProjectionEvent => ({
        id: String(value.id), eventType: String(value.eventType),
        occurredAt: String(value.occurredAt), recordedAt: String(value.recordedAt),
        supersedesEventId: value.supersedesEventId ? String(value.supersedesEventId) : null,
      })));
      const update = this.database.prepare(`UPDATE court_proceedings SET
        current_state = ?, court_name = CASE WHEN ? <> '' THEN ? ELSE court_name END,
        case_number = CASE WHEN ? <> '' THEN ? ELSE case_number END,
        track = COALESCE(?, track),
        sealed_claim_form_version_id = CASE WHEN ? = 'issued' THEN ? ELSE sealed_claim_form_version_id END,
        issued_at = CASE WHEN ? = 'issued' THEN ? ELSE issued_at END,
        disposal_position = CASE WHEN ? = 'disposal_position_reviewed' THEN 'reviewed' ELSE disposal_position END,
        version = version + 1, updated_at = ?
        WHERE id = ? AND firm_id = ? AND matter_id = ? AND version = ?`)
        .run(projection.state, input.courtName, input.courtName, input.caseNumber,
          input.caseNumber, input.track, input.eventType, input.sourceDocumentVersionId,
          input.eventType, input.occurredAt, input.eventType, recordedAt,
          proceedingId, user.firmId, matterId, input.expectedVersion);
      if (Number(update.changes) !== 1) throw new ProceedingsStoreError('CONFLICT', 'The proceeding changed before the event was recorded.');
      const result = this.getProceeding(user.firmId, matterId, proceedingId);
      if (!result) throw new ProceedingsStoreError('CONFLICT', 'The proceeding could not be read after the event.');
      this.saveReceipt(user, matterId, proceedingId, scope, proceedingId,
        input.idempotencyKey, input, result, recordedAt);
      this.appendOperational(user, matterId, {
        action: `proceedings.${input.eventType}`, entityType: 'court_proceeding_event',
        entityId: id, title: 'Court proceeding event recorded', idempotencyKey: input.idempotencyKey,
        after: { eventId: id, proceedingId, eventType: input.eventType }, occurredAt: recordedAt,
      }, audit);
      return result;
    });
  }

  private getFiling(firmId: string, matterId: string, filingId: string) {
    const value = this.database.prepare(`${filingSelect}
      WHERE id = ? AND firm_id = ? AND matter_id = ?`)
      .get(filingId, firmId, matterId) as Row | undefined;
    if (!value) throw new ProceedingsStoreError('NOT_FOUND', 'The court filing was not found.');
    const documents = (this.database.prepare(`SELECT document_version_id AS id
      FROM court_filing_documents WHERE firm_id = ? AND matter_id = ? AND filing_id = ?
      ORDER BY position`).all(firmId, matterId, filingId) as Array<{ id: string }>)
      .map(({ id }) => id);
    const events = (this.database.prepare(`${filingEventSelect}
      WHERE firm_id = ? AND matter_id = ? AND filing_id = ?
      ORDER BY occurred_at, recorded_at, id`).all(firmId, matterId, filingId) as Row[])
      .map(mapFilingEvent);
    return mapFiling(value, documents, events);
  }

  createFiling(
    user: SessionUser, matterId: string, proceedingId: string,
    input: CreateCourtFilingInput, audit: AuditContext,
  ) {
    this.requireProceeding(user, matterId, proceedingId);
    const scope = `create_filing:${proceedingId}`;
    const replay = this.receipt<ReturnType<typeof mapFiling>>(
      user, matterId, scope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      for (const versionId of input.documentVersionIds) {
        this.requireDocumentVersion(user.firmId, matterId, versionId);
      }
      const createdAt = this.now().toISOString();
      const id = randomUUID();
      const next = Number((this.database.prepare(`SELECT COALESCE(COUNT(*), 0) + 1 AS next
        FROM court_filings WHERE firm_id = ? AND matter_id = ? AND proceeding_id = ?`)
        .get(user.firmId, matterId, proceedingId) as { next: number }).next);
      const reference = `FIL-${String(next).padStart(3, '0')}`;
      this.database.prepare(`INSERT INTO court_filings (
        id, firm_id, matter_id, proceeding_id, filing_reference, purpose,
        submission_channel, fee_position, fee_minor, currency, created_by,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, user.firmId, matterId, proceedingId, reference, input.purpose,
          input.submissionChannel, input.feePosition, input.feeMinor, input.currency,
          user.id, createdAt, createdAt);
      const insertDocument = this.database.prepare(`INSERT INTO court_filing_documents (
        id, firm_id, matter_id, filing_id, document_version_id, position, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      input.documentVersionIds.forEach((versionId, position) => insertDocument.run(
        randomUUID(), user.firmId, matterId, id, versionId, position, createdAt,
      ));
      this.database.prepare(`INSERT INTO court_filing_events (
        id, firm_id, matter_id, filing_id, event_type, occurred_at, note,
        rejection_reason, correction_reason, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, 'prepared', ?, ?, '', '', ?, ?)`)
        .run(randomUUID(), user.firmId, matterId, id, createdAt,
          'The exact court filing package was prepared inside SwiftClaim.', user.id, createdAt);
      const result = this.getFiling(user.firmId, matterId, id);
      this.saveReceipt(user, matterId, proceedingId, scope, proceedingId,
        input.idempotencyKey, input, result, createdAt);
      this.appendOperational(user, matterId, {
        action: 'proceedings.filing_prepared', entityType: 'court_filing', entityId: id,
        title: 'Court filing prepared', idempotencyKey: input.idempotencyKey,
        after: result, occurredAt: createdAt,
      }, audit);
      return result;
    });
  }

  recordFilingEvent(
    user: SessionUser, matterId: string, proceedingId: string, filingId: string,
    input: RecordCourtFilingEventInput, audit: AuditContext,
  ) {
    this.requireProceeding(user, matterId, proceedingId);
    const filing = this.getFiling(user.firmId, matterId, filingId);
    if (filing.proceedingId !== proceedingId) throw new ProceedingsStoreError('NOT_FOUND', 'The court filing was not found.');
    const scope = `filing_event:${filingId}`;
    const replay = this.receipt<ReturnType<typeof mapFiling>>(
      user, matterId, scope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    if (filing.version !== input.expectedVersion) throw new ProceedingsStoreError('CONFLICT', 'The court filing changed before the event was recorded.');
    return transaction(this.database, () => {
      this.requireDocumentVersion(user.firmId, matterId, input.receiptDocumentVersionId);
      if (input.supersedesEventId && !this.database.prepare(`SELECT 1 FROM court_filing_events
        WHERE id = ? AND filing_id = ? AND firm_id = ? AND matter_id = ?`)
        .get(input.supersedesEventId, filingId, user.firmId, matterId)) {
        throw new ProceedingsStoreError('INVALID_LINK', 'The corrected filing event was not found.');
      }
      const recordedAt = this.now().toISOString();
      const eventId = randomUUID();
      this.database.prepare(`INSERT INTO court_filing_events (
        id, firm_id, matter_id, filing_id, event_type, occurred_at, note,
        receipt_document_version_id, external_reference, rejection_reason,
        supersedes_event_id, correction_reason, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(eventId, user.firmId, matterId, filingId, input.eventType, input.occurredAt,
          input.note, input.receiptDocumentVersionId, input.externalReference,
          input.rejectionReason, input.supersedesEventId, input.correctionReason,
          user.id, recordedAt);
      const eventRows = this.database.prepare(`${filingEventSelect}
        WHERE firm_id = ? AND matter_id = ? AND filing_id = ?`)
        .all(user.firmId, matterId, filingId) as Row[];
      const projection = projectFiling(eventRows.map((value): ProjectionEvent => ({
        id: String(value.id), eventType: String(value.eventType),
        occurredAt: String(value.occurredAt), recordedAt: String(value.recordedAt),
        supersedesEventId: value.supersedesEventId ? String(value.supersedesEventId) : null,
      })));
      const update = this.database.prepare(`UPDATE court_filings
        SET current_state = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND firm_id = ? AND matter_id = ? AND proceeding_id = ? AND version = ?`)
        .run(projection.state, recordedAt, filingId, user.firmId, matterId,
          proceedingId, input.expectedVersion);
      if (Number(update.changes) !== 1) throw new ProceedingsStoreError('CONFLICT', 'The court filing changed before the event was recorded.');
      const result = this.getFiling(user.firmId, matterId, filingId);
      this.saveReceipt(user, matterId, proceedingId, scope, filingId,
        input.idempotencyKey, input, result, recordedAt);
      this.appendOperational(user, matterId, {
        action: `proceedings.filing_${input.eventType}`, entityType: 'court_filing_event',
        entityId: eventId, title: 'Court filing event recorded',
        idempotencyKey: input.idempotencyKey,
        after: { filingId, eventType: input.eventType }, occurredAt: recordedAt,
      }, audit);
      return result;
    });
  }

  private getServiceRecord(firmId: string, matterId: string, serviceRecordId: string) {
    const value = this.database.prepare(`${serviceSelect}
      WHERE id = ? AND firm_id = ? AND matter_id = ?`)
      .get(serviceRecordId, firmId, matterId) as Row | undefined;
    if (!value) throw new ProceedingsStoreError('NOT_FOUND', 'The court service record was not found.');
    const events = (this.database.prepare(`${serviceEventSelect}
      WHERE firm_id = ? AND matter_id = ? AND service_record_id = ?
      ORDER BY occurred_at, recorded_at, id`).all(firmId, matterId, serviceRecordId) as Row[])
      .map(mapServiceEvent);
    return mapServiceRecord(value, events);
  }

  createServiceRecord(
    user: SessionUser, matterId: string, proceedingId: string,
    input: CreateCourtServiceRecordInput, audit: AuditContext,
  ) {
    this.requireProceeding(user, matterId, proceedingId);
    const scope = `create_service:${proceedingId}`;
    const replay = this.receipt<ReturnType<typeof mapServiceRecord>>(
      user, matterId, scope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      this.requireDocumentVersion(user.firmId, matterId, input.courtDocumentVersionId);
      if (!this.database.prepare(`SELECT 1 FROM parties
        WHERE id = ? AND firm_id = ? AND matter_id = ?`)
        .get(input.recipientPartyId, user.firmId, matterId)) {
        throw new ProceedingsStoreError('INVALID_LINK', 'The service recipient was not found.');
      }
      const createdAt = this.now().toISOString();
      const id = randomUUID();
      const next = Number((this.database.prepare(`SELECT COALESCE(COUNT(*), 0) + 1 AS next
        FROM court_service_records WHERE firm_id = ? AND matter_id = ? AND proceeding_id = ?`)
        .get(user.firmId, matterId, proceedingId) as { next: number }).next);
      const reference = `SRV-${String(next).padStart(3, '0')}`;
      this.database.prepare(`INSERT INTO court_service_records (
        id, firm_id, matter_id, proceeding_id, service_reference,
        court_document_version_id, recipient_party_id, method, service_address,
        jurisdiction_position, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, user.firmId, matterId, proceedingId, reference,
          input.courtDocumentVersionId, input.recipientPartyId, input.method,
          input.serviceAddress, input.jurisdictionPosition, user.id, createdAt, createdAt);
      this.database.prepare(`INSERT INTO court_service_events (
        id, firm_id, matter_id, service_record_id, event_type, occurred_at, note,
        precise_step, review_position, rule_source_title, rule_source_url,
        evidence_document_version_ids_json, evidence_communication_entry_ids_json,
        correction_reason, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, 'prepared', ?, ?, '', 'unreviewed', '', '', '[]', '[]', '', ?, ?)`)
        .run(randomUUID(), user.firmId, matterId, id, createdAt,
          'The per-recipient court service record was prepared inside SwiftClaim.',
          user.id, createdAt);
      const result = this.getServiceRecord(user.firmId, matterId, id);
      this.saveReceipt(user, matterId, proceedingId, scope, proceedingId,
        input.idempotencyKey, input, result, createdAt);
      this.appendOperational(user, matterId, {
        action: 'proceedings.service_prepared', entityType: 'court_service_record',
        entityId: id, title: 'Court service record prepared',
        idempotencyKey: input.idempotencyKey, after: result, occurredAt: createdAt,
      }, audit);
      return result;
    });
  }

  recordServiceEvent(
    user: SessionUser, matterId: string, proceedingId: string, serviceRecordId: string,
    input: RecordCourtServiceEventInput, audit: AuditContext,
  ) {
    this.requireProceeding(user, matterId, proceedingId);
    const service = this.getServiceRecord(user.firmId, matterId, serviceRecordId);
    if (service.proceedingId !== proceedingId) throw new ProceedingsStoreError('NOT_FOUND', 'The court service record was not found.');
    const scope = `service_event:${serviceRecordId}`;
    const replay = this.receipt<ReturnType<typeof mapServiceRecord>>(
      user, matterId, scope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    if (service.version !== input.expectedVersion) throw new ProceedingsStoreError('CONFLICT', 'The service record changed before the event was recorded.');
    return transaction(this.database, () => {
      for (const versionId of input.evidenceDocumentVersionIds) {
        this.requireDocumentVersion(user.firmId, matterId, versionId);
      }
      for (const entryId of input.evidenceCommunicationEntryIds) {
        if (!this.database.prepare(`SELECT 1 FROM communication_entries
          WHERE id = ? AND firm_id = ? AND matter_id = ?`)
          .get(entryId, user.firmId, matterId)) {
          throw new ProceedingsStoreError('INVALID_LINK', 'A service evidence communication was not found.');
        }
      }
      if (input.supersedesEventId && !this.database.prepare(`SELECT 1 FROM court_service_events
        WHERE id = ? AND service_record_id = ? AND firm_id = ? AND matter_id = ?`)
        .get(input.supersedesEventId, serviceRecordId, user.firmId, matterId)) {
        throw new ProceedingsStoreError('INVALID_LINK', 'The corrected service event was not found.');
      }
      const recordedAt = this.now().toISOString();
      const eventId = randomUUID();
      this.database.prepare(`INSERT INTO court_service_events (
        id, firm_id, matter_id, service_record_id, event_type, occurred_at, note,
        precise_step, asserted_service_at, asserted_deemed_service_at, review_position,
        rule_source_title, rule_source_url, evidence_document_version_ids_json,
        evidence_communication_entry_ids_json, supersedes_event_id, correction_reason,
        recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(eventId, user.firmId, matterId, serviceRecordId, input.eventType,
          input.occurredAt, input.note, input.preciseStep, input.assertedServiceAt,
          input.assertedDeemedServiceAt, input.reviewPosition, input.ruleSourceTitle,
          input.ruleSourceUrl, canonicalJson(input.evidenceDocumentVersionIds),
          canonicalJson(input.evidenceCommunicationEntryIds), input.supersedesEventId,
          input.correctionReason, user.id, recordedAt);
      const eventRows = this.database.prepare(`${serviceEventSelect}
        WHERE firm_id = ? AND matter_id = ? AND service_record_id = ?`)
        .all(user.firmId, matterId, serviceRecordId) as Row[];
      const projection = projectService(eventRows.map((value): ProjectionEvent => ({
        id: String(value.id), eventType: String(value.eventType),
        occurredAt: String(value.occurredAt), recordedAt: String(value.recordedAt),
        supersedesEventId: value.supersedesEventId ? String(value.supersedesEventId) : null,
      })));
      const update = this.database.prepare(`UPDATE court_service_records
        SET current_state = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND firm_id = ? AND matter_id = ? AND proceeding_id = ? AND version = ?`)
        .run(projection.state, recordedAt, serviceRecordId, user.firmId, matterId,
          proceedingId, input.expectedVersion);
      if (Number(update.changes) !== 1) throw new ProceedingsStoreError('CONFLICT', 'The service record changed before the event was recorded.');
      const result = this.getServiceRecord(user.firmId, matterId, serviceRecordId);
      this.saveReceipt(user, matterId, proceedingId, scope, serviceRecordId,
        input.idempotencyKey, input, result, recordedAt);
      this.appendOperational(user, matterId, {
        action: `proceedings.service_${input.eventType}`,
        entityType: 'court_service_event', entityId: eventId,
        title: 'Court service event recorded', idempotencyKey: input.idempotencyKey,
        after: { serviceRecordId, eventType: input.eventType }, occurredAt: recordedAt,
      }, audit);
      return result;
    });
  }

  private getApplication(firmId: string, matterId: string, applicationId: string) {
    const value = this.database.prepare(`${applicationSelect}
      WHERE id = ? AND firm_id = ? AND matter_id = ?`)
      .get(applicationId, firmId, matterId) as Row | undefined;
    if (!value) throw new ProceedingsStoreError('NOT_FOUND', 'The court application was not found.');
    const events = (this.database.prepare(`${applicationEventSelect}
      WHERE firm_id = ? AND matter_id = ? AND application_id = ?
      ORDER BY occurred_at, recorded_at, id`).all(firmId, matterId, applicationId) as Row[])
      .map(mapApplicationEvent);
    return mapApplication(value, events);
  }

  createApplication(
    user: SessionUser, matterId: string, proceedingId: string,
    input: CreateCourtApplicationInput, audit: AuditContext,
  ) {
    this.requireProceeding(user, matterId, proceedingId);
    const scope = `create_application:${proceedingId}`;
    const replay = this.receipt<ReturnType<typeof mapApplication>>(
      user, matterId, scope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      const partyIds = [input.applicantPartyId, ...input.respondentPartyIds];
      for (const partyId of partyIds) {
        if (!this.database.prepare(`SELECT 1 FROM parties
          WHERE id = ? AND firm_id = ? AND matter_id = ?`)
          .get(partyId, user.firmId, matterId)) {
          throw new ProceedingsStoreError('INVALID_LINK', 'An application party was not found.');
        }
      }
      this.requireDocumentVersion(user.firmId, matterId, input.applicationNoticeVersionId);
      this.requireDocumentVersion(user.firmId, matterId, input.draftOrderVersionId);
      for (const id of input.evidenceDocumentVersionIds) {
        this.requireDocumentVersion(user.firmId, matterId, id);
      }
      const createdAt = this.now().toISOString();
      const id = randomUUID();
      const next = Number((this.database.prepare(`SELECT COALESCE(COUNT(*), 0) + 1 AS next
        FROM court_applications WHERE firm_id = ? AND matter_id = ? AND proceeding_id = ?`)
        .get(user.firmId, matterId, proceedingId) as { next: number }).next);
      const reference = `APP-${String(next).padStart(3, '0')}`;
      this.database.prepare(`INSERT INTO court_applications (
        id, firm_id, matter_id, proceeding_id, application_reference,
        applicant_party_id, respondent_party_ids_json, requested_order,
        grounds_summary, notice_position, hearing_required_position,
        application_notice_version_id, evidence_document_version_ids_json,
        draft_order_version_id, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, user.firmId, matterId, proceedingId, reference, input.applicantPartyId,
        canonicalJson(input.respondentPartyIds), input.requestedOrder, input.groundsSummary,
        input.noticePosition, input.hearingRequiredPosition, input.applicationNoticeVersionId,
        canonicalJson(input.evidenceDocumentVersionIds), input.draftOrderVersionId,
        user.id, createdAt, createdAt,
      );
      this.database.prepare(`INSERT INTO court_application_events (
        id, firm_id, matter_id, application_id, event_type, occurred_at, note,
        source_document_version_id, correction_reason, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, 'prepared', ?, ?, ?, '', ?, ?)`).run(
        randomUUID(), user.firmId, matterId, id, createdAt,
        'The court application was prepared from the exact retained notice and evidence.',
        input.applicationNoticeVersionId, user.id, createdAt,
      );
      const result = this.getApplication(user.firmId, matterId, id);
      this.saveReceipt(user, matterId, proceedingId, scope, proceedingId,
        input.idempotencyKey, input, result, createdAt);
      this.appendOperational(user, matterId, {
        action: 'proceedings.application_prepared', entityType: 'court_application',
        entityId: id, title: 'Court application prepared', idempotencyKey: input.idempotencyKey,
        after: result, occurredAt: createdAt,
      }, audit);
      return result;
    });
  }

  recordApplicationEvent(
    user: SessionUser, matterId: string, proceedingId: string, applicationId: string,
    input: RecordCourtApplicationEventInput, audit: AuditContext,
  ) {
    this.requireProceeding(user, matterId, proceedingId);
    const application = this.getApplication(user.firmId, matterId, applicationId);
    if (application.proceedingId !== proceedingId) {
      throw new ProceedingsStoreError('NOT_FOUND', 'The court application was not found.');
    }
    const scope = `application_event:${applicationId}`;
    const replay = this.receipt<ReturnType<typeof mapApplication>>(
      user, matterId, scope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    if (application.version !== input.expectedVersion) {
      throw new ProceedingsStoreError('CONFLICT', 'The application changed before the event was recorded.');
    }
    return transaction(this.database, () => {
      this.requireDocumentVersion(user.firmId, matterId, input.sourceDocumentVersionId);
      this.requireOrder(user.firmId, matterId, proceedingId, input.resultingOrderId);
      if (input.supersedesEventId && !this.database.prepare(`SELECT 1 FROM court_application_events
        WHERE id = ? AND application_id = ? AND firm_id = ? AND matter_id = ?`)
        .get(input.supersedesEventId, applicationId, user.firmId, matterId)) {
        throw new ProceedingsStoreError('INVALID_LINK', 'The corrected application event was not found.');
      }
      const recordedAt = this.now().toISOString();
      const eventId = randomUUID();
      this.database.prepare(`INSERT INTO court_application_events (
        id, firm_id, matter_id, application_id, event_type, occurred_at, note,
        source_document_version_id, resulting_order_id, supersedes_event_id,
        correction_reason, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        eventId, user.firmId, matterId, applicationId, input.eventType, input.occurredAt,
        input.note, input.sourceDocumentVersionId, input.resultingOrderId,
        input.supersedesEventId, input.correctionReason, user.id, recordedAt,
      );
      const rows = this.database.prepare(`${applicationEventSelect}
        WHERE firm_id = ? AND matter_id = ? AND application_id = ?`)
        .all(user.firmId, matterId, applicationId) as Row[];
      const projection = projectApplication(rows.map((value): ProjectionEvent => ({
        id: String(value.id), eventType: String(value.eventType),
        occurredAt: String(value.occurredAt), recordedAt: String(value.recordedAt),
        supersedesEventId: value.supersedesEventId ? String(value.supersedesEventId) : null,
      })));
      const update = this.database.prepare(`UPDATE court_applications
        SET current_state = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND firm_id = ? AND matter_id = ? AND proceeding_id = ? AND version = ?`)
        .run(projection.state, recordedAt, applicationId, user.firmId, matterId,
          proceedingId, input.expectedVersion);
      if (Number(update.changes) !== 1) {
        throw new ProceedingsStoreError('CONFLICT', 'The application changed before the event was recorded.');
      }
      const result = this.getApplication(user.firmId, matterId, applicationId);
      this.saveReceipt(user, matterId, proceedingId, scope, applicationId,
        input.idempotencyKey, input, result, recordedAt);
      this.appendOperational(user, matterId, {
        action: `proceedings.application_${input.eventType}`,
        entityType: 'court_application_event', entityId: eventId,
        title: 'Court application event recorded', idempotencyKey: input.idempotencyKey,
        after: { applicationId, eventType: input.eventType }, occurredAt: recordedAt,
      }, audit);
      return result;
    });
  }

  private requireOrder(firmId: string, matterId: string, proceedingId: string, orderId: string | null): void {
    if (!orderId) return;
    if (!this.database.prepare(`SELECT 1 FROM court_orders
      WHERE id = ? AND firm_id = ? AND matter_id = ? AND proceeding_id = ?`)
      .get(orderId, firmId, matterId, proceedingId)) {
      throw new ProceedingsStoreError('INVALID_LINK', 'The sealed court order was not found.');
    }
  }

  createOrder(
    user: SessionUser, matterId: string, proceedingId: string,
    input: CreateCourtOrderInput, audit: AuditContext,
  ) {
    this.requireProceeding(user, matterId, proceedingId);
    const scope = `create_order:${proceedingId}`;
    const replay = this.receipt<ReturnType<typeof mapOrder>>(
      user, matterId, scope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      this.requireDocumentVersion(user.firmId, matterId, input.sealedDocumentVersionId);
      this.requireOrder(user.firmId, matterId, proceedingId, input.variesOrderId);
      this.requireOrder(user.firmId, matterId, proceedingId, input.supersedesOrderId);
      const createdAt = this.now().toISOString();
      const id = randomUUID();
      const next = Number((this.database.prepare(`SELECT COALESCE(COUNT(*), 0) + 1 AS next
        FROM court_orders WHERE firm_id = ? AND matter_id = ? AND proceeding_id = ?`)
        .get(user.firmId, matterId, proceedingId) as { next: number }).next);
      const reference = `ORD-${String(next).padStart(3, '0')}`;
      this.database.prepare(`INSERT INTO court_orders (
        id, firm_id, matter_id, proceeding_id, order_reference, order_type, title,
        order_date, takes_effect_at, judge_name, judicial_title,
        sealed_document_version_id, varies_order_id, supersedes_order_id,
        service_position, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, user.firmId, matterId, proceedingId, reference, input.orderType,
          input.title, input.orderDate, input.takesEffectAt, input.judgeName,
          input.judicialTitle, input.sealedDocumentVersionId, input.variesOrderId,
          input.supersedesOrderId, input.servicePosition, user.id, createdAt);
      const result = mapOrder(this.database.prepare(`${orderSelect}
        WHERE id = ? AND firm_id = ? AND matter_id = ?`)
        .get(id, user.firmId, matterId) as Row);
      this.saveReceipt(user, matterId, proceedingId, scope, proceedingId,
        input.idempotencyKey, input, result, createdAt);
      this.appendOperational(user, matterId, {
        action: 'proceedings.sealed_order_recorded', entityType: 'court_order',
        entityId: id, title: 'Sealed court order recorded',
        idempotencyKey: input.idempotencyKey, after: result, occurredAt: createdAt,
      }, audit);
      return result;
    });
  }

  private getDirection(firmId: string, matterId: string, directionId: string) {
    const value = this.database.prepare(`${directionSelect}
      WHERE id = ? AND firm_id = ? AND matter_id = ?`)
      .get(directionId, firmId, matterId) as Row | undefined;
    if (!value) throw new ProceedingsStoreError('NOT_FOUND', 'The court direction was not found.');
    const events = (this.database.prepare(`${directionEventSelect}
      WHERE firm_id = ? AND matter_id = ? AND direction_id = ?
      ORDER BY occurred_at, recorded_at, id`).all(firmId, matterId, directionId) as Row[])
      .map(mapDirectionEvent);
    return mapDirection(value, events, this.now().toISOString());
  }

  createDirection(
    user: SessionUser, matterId: string, proceedingId: string,
    input: CreateCourtDirectionInput, audit: AuditContext,
  ) {
    this.requireProceeding(user, matterId, proceedingId);
    const scope = `create_direction:${proceedingId}`;
    const replay = this.receipt<ReturnType<typeof mapDirection>>(
      user, matterId, scope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      this.requireOrder(user.firmId, matterId, proceedingId, input.sourceOrderId);
      if (!this.database.prepare(`SELECT 1 FROM parties
        WHERE id = ? AND firm_id = ? AND matter_id = ?`)
        .get(input.responsiblePartyId, user.firmId, matterId)) {
        throw new ProceedingsStoreError('INVALID_LINK', 'The direction responsible party was not found.');
      }
      if (input.assignedUserId && !this.database.prepare(
        'SELECT 1 FROM users WHERE id = ? AND firm_id = ?',
      ).get(input.assignedUserId, user.firmId)) {
        throw new ProceedingsStoreError('INVALID_LINK', 'The direction owner was not found.');
      }
      const createdAt = this.now().toISOString();
      const id = randomUUID();
      const next = Number((this.database.prepare(`SELECT COALESCE(COUNT(*), 0) + 1 AS next
        FROM court_directions WHERE firm_id = ? AND matter_id = ? AND proceeding_id = ?`)
        .get(user.firmId, matterId, proceedingId) as { next: number }).next);
      const reference = `DIR-${String(next).padStart(3, '0')}`;
      this.database.prepare(`INSERT INTO court_directions (
        id, firm_id, matter_id, proceeding_id, direction_reference, source_order_id,
        rule_source_title, rule_source_url, responsible_party_id, category,
        requirement_text, due_at, timezone, sanction_expressly_stated,
        sanction_text, assigned_user_id, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, user.firmId, matterId, proceedingId, reference, input.sourceOrderId,
          input.ruleSourceTitle, input.ruleSourceUrl, input.responsiblePartyId,
          input.category, input.requirementText, input.dueAt, input.timezone,
          input.sanctionExpresslyStated ? 1 : 0, input.sanctionText,
          input.assignedUserId, user.id, createdAt, createdAt);
      this.database.prepare(`INSERT INTO court_direction_events (
        id, firm_id, matter_id, direction_id, event_type, occurred_at, note,
        evidence_document_version_ids_json, evidence_filing_ids_json,
        evidence_service_record_ids_json, correction_reason, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, 'created', ?, ?, '[]', '[]', '[]', '', ?, ?)`)
        .run(randomUUID(), user.firmId, matterId, id, createdAt,
          'The atomic court direction was transcribed from its retained source.',
          user.id, createdAt);
      const result = this.getDirection(user.firmId, matterId, id);
      this.saveReceipt(user, matterId, proceedingId, scope, proceedingId,
        input.idempotencyKey, input, result, createdAt);
      this.appendOperational(user, matterId, {
        action: 'proceedings.direction_created', entityType: 'court_direction',
        entityId: id, title: 'Court direction recorded', idempotencyKey: input.idempotencyKey,
        after: result, occurredAt: createdAt,
      }, audit);
      return result;
    });
  }

  recordDirectionEvent(
    user: SessionUser, matterId: string, proceedingId: string, directionId: string,
    input: RecordCourtDirectionEventInput, audit: AuditContext,
  ) {
    this.requireProceeding(user, matterId, proceedingId);
    const direction = this.getDirection(user.firmId, matterId, directionId);
    if (direction.proceedingId !== proceedingId) throw new ProceedingsStoreError('NOT_FOUND', 'The court direction was not found.');
    const scope = `direction_event:${directionId}`;
    const replay = this.receipt<ReturnType<typeof mapDirection>>(
      user, matterId, scope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    if (direction.version !== input.expectedVersion) throw new ProceedingsStoreError('CONFLICT', 'The direction changed before the event was recorded.');
    return transaction(this.database, () => {
      for (const id of input.evidenceDocumentVersionIds) this.requireDocumentVersion(user.firmId, matterId, id);
      for (const id of input.evidenceFilingIds) {
        if (!this.database.prepare(`SELECT 1 FROM court_filings WHERE id = ? AND firm_id = ?
          AND matter_id = ? AND proceeding_id = ?`).get(id, user.firmId, matterId, proceedingId))
          throw new ProceedingsStoreError('INVALID_LINK', 'A direction evidence filing was not found.');
      }
      for (const id of input.evidenceServiceRecordIds) {
        if (!this.database.prepare(`SELECT 1 FROM court_service_records WHERE id = ? AND firm_id = ?
          AND matter_id = ? AND proceeding_id = ?`).get(id, user.firmId, matterId, proceedingId))
          throw new ProceedingsStoreError('INVALID_LINK', 'A direction evidence service record was not found.');
      }
      this.requireOrder(user.firmId, matterId, proceedingId, input.sourceOrderId);
      if (input.supersedesEventId && !this.database.prepare(`SELECT 1 FROM court_direction_events
        WHERE id = ? AND direction_id = ? AND firm_id = ? AND matter_id = ?`)
        .get(input.supersedesEventId, directionId, user.firmId, matterId))
        throw new ProceedingsStoreError('INVALID_LINK', 'The corrected direction event was not found.');
      const recordedAt = this.now().toISOString();
      const eventId = randomUUID();
      this.database.prepare(`INSERT INTO court_direction_events (
        id, firm_id, matter_id, direction_id, event_type, occurred_at, note,
        evidence_document_version_ids_json, evidence_filing_ids_json,
        evidence_service_record_ids_json, source_order_id, revised_due_at,
        supersedes_event_id, correction_reason, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(eventId, user.firmId, matterId, directionId, input.eventType,
          input.occurredAt, input.note, canonicalJson(input.evidenceDocumentVersionIds),
          canonicalJson(input.evidenceFilingIds), canonicalJson(input.evidenceServiceRecordIds),
          input.sourceOrderId, input.revisedDueAt, input.supersedesEventId,
          input.correctionReason, user.id, recordedAt);
      const eventRows = this.database.prepare(`${directionEventSelect}
        WHERE firm_id = ? AND matter_id = ? AND direction_id = ?`)
        .all(user.firmId, matterId, directionId) as Row[];
      const effectiveDue = input.revisedDueAt ?? direction.dueAt;
      const projection = projectDirection(eventRows.map((value): ProjectionEvent => ({
        id: String(value.id), eventType: String(value.eventType),
        occurredAt: String(value.occurredAt), recordedAt: String(value.recordedAt),
        supersedesEventId: value.supersedesEventId ? String(value.supersedesEventId) : null,
      })), this.now().toISOString(), effectiveDue);
      const update = this.database.prepare(`UPDATE court_directions
        SET current_state = ?, due_at = COALESCE(?, due_at), version = version + 1, updated_at = ?
        WHERE id = ? AND firm_id = ? AND matter_id = ? AND proceeding_id = ? AND version = ?`)
        .run(projection.state, input.revisedDueAt, recordedAt, directionId,
          user.firmId, matterId, proceedingId, input.expectedVersion);
      if (Number(update.changes) !== 1) throw new ProceedingsStoreError('CONFLICT', 'The direction changed before the event was recorded.');
      const result = this.getDirection(user.firmId, matterId, directionId);
      this.saveReceipt(user, matterId, proceedingId, scope, directionId,
        input.idempotencyKey, input, result, recordedAt);
      this.appendOperational(user, matterId, {
        action: `proceedings.direction_${input.eventType}`,
        entityType: 'court_direction_event', entityId: eventId,
        title: 'Court direction event recorded', idempotencyKey: input.idempotencyKey,
        after: { directionId, eventType: input.eventType }, occurredAt: recordedAt,
      }, audit);
      return result;
    });
  }

  private getHearing(firmId: string, matterId: string, hearingId: string) {
    const value = this.database.prepare(`${hearingSelect}
      WHERE id = ? AND firm_id = ? AND matter_id = ?`)
      .get(hearingId, firmId, matterId) as Row | undefined;
    if (!value) throw new ProceedingsStoreError('NOT_FOUND', 'The court hearing was not found.');
    const events = (this.database.prepare(`${hearingEventSelect}
      WHERE firm_id = ? AND matter_id = ? AND hearing_id = ?
      ORDER BY occurred_at, recorded_at, id`).all(firmId, matterId, hearingId) as Row[])
      .map(mapHearingEvent);
    return mapHearing(value, events);
  }

  createHearing(
    user: SessionUser, matterId: string, proceedingId: string,
    input: CreateCourtHearingInput, audit: AuditContext,
  ) {
    this.requireProceeding(user, matterId, proceedingId);
    const scope = `create_hearing:${proceedingId}`;
    const replay = this.receipt<ReturnType<typeof mapHearing>>(
      user, matterId, scope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    return transaction(this.database, () => {
      this.requireDocumentVersion(user.firmId, matterId, input.listingNoticeVersionId);
      this.requireDocumentVersion(user.firmId, matterId, input.bundleDocumentVersionId);
      const createdAt = this.now().toISOString();
      const id = randomUUID();
      const next = Number((this.database.prepare(`SELECT COALESCE(COUNT(*), 0) + 1 AS next
        FROM court_hearings WHERE firm_id = ? AND matter_id = ? AND proceeding_id = ?`)
        .get(user.firmId, matterId, proceedingId) as { next: number }).next);
      const reference = `HRG-${String(next).padStart(3, '0')}`;
      this.database.prepare(`INSERT INTO court_hearings (
        id, firm_id, matter_id, proceeding_id, hearing_reference, hearing_type,
        title, listing_notice_version_id, starts_at, ends_at, timezone, court_name,
        venue, attendance_mode, remote_access_details, privacy_position, judge_name,
        advocate_names_json, attendee_names_json, bundle_document_version_id,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, user.firmId, matterId, proceedingId, reference, input.hearingType,
          input.title, input.listingNoticeVersionId, input.startsAt, input.endsAt,
          input.timezone, input.courtName, input.venue, input.attendanceMode,
          input.remoteAccessDetails, input.privacyPosition, input.judgeName,
          canonicalJson(input.advocateNames), canonicalJson(input.attendeeNames),
          input.bundleDocumentVersionId, user.id, createdAt, createdAt);
      this.database.prepare(`INSERT INTO court_hearing_events (
        id, firm_id, matter_id, hearing_id, event_type, occurred_at, note,
        source_document_version_id, correction_reason, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, 'listed', ?, ?, ?, '', ?, ?)`)
        .run(randomUUID(), user.firmId, matterId, id, createdAt,
          'The hearing was listed by the retained court notice.',
          input.listingNoticeVersionId, user.id, createdAt);
      const result = this.getHearing(user.firmId, matterId, id);
      this.saveReceipt(user, matterId, proceedingId, scope, proceedingId,
        input.idempotencyKey, input, result, createdAt);
      this.appendOperational(user, matterId, {
        action: 'proceedings.hearing_listed', entityType: 'court_hearing',
        entityId: id, title: 'Court hearing listed', idempotencyKey: input.idempotencyKey,
        after: { hearingId: id, startsAt: input.startsAt }, occurredAt: createdAt,
      }, audit);
      return result;
    });
  }

  recordHearingEvent(
    user: SessionUser, matterId: string, proceedingId: string, hearingId: string,
    input: RecordCourtHearingEventInput, audit: AuditContext,
  ) {
    this.requireProceeding(user, matterId, proceedingId);
    const hearing = this.getHearing(user.firmId, matterId, hearingId);
    if (hearing.proceedingId !== proceedingId) throw new ProceedingsStoreError('NOT_FOUND', 'The court hearing was not found.');
    const scope = `hearing_event:${hearingId}`;
    const replay = this.receipt<ReturnType<typeof mapHearing>>(
      user, matterId, scope, input.idempotencyKey, input,
    );
    if (replay) return replay;
    if (hearing.version !== input.expectedVersion) throw new ProceedingsStoreError('CONFLICT', 'The hearing changed before the event was recorded.');
    return transaction(this.database, () => {
      this.requireDocumentVersion(user.firmId, matterId, input.sourceDocumentVersionId);
      this.requireOrder(user.firmId, matterId, proceedingId, input.resultingOrderId);
      if (input.supersedesEventId && !this.database.prepare(`SELECT 1 FROM court_hearing_events
        WHERE id = ? AND hearing_id = ? AND firm_id = ? AND matter_id = ?`)
        .get(input.supersedesEventId, hearingId, user.firmId, matterId))
        throw new ProceedingsStoreError('INVALID_LINK', 'The corrected hearing event was not found.');
      const recordedAt = this.now().toISOString();
      const eventId = randomUUID();
      this.database.prepare(`INSERT INTO court_hearing_events (
        id, firm_id, matter_id, hearing_id, event_type, occurred_at, note,
        source_document_version_id, resulting_order_id, revised_starts_at,
        supersedes_event_id, correction_reason, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(eventId, user.firmId, matterId, hearingId, input.eventType,
          input.occurredAt, input.note, input.sourceDocumentVersionId,
          input.resultingOrderId, input.revisedStartsAt, input.supersedesEventId,
          input.correctionReason, user.id, recordedAt);
      const eventRows = this.database.prepare(`${hearingEventSelect}
        WHERE firm_id = ? AND matter_id = ? AND hearing_id = ?`)
        .all(user.firmId, matterId, hearingId) as Row[];
      const projection = projectHearing(eventRows.map((value): ProjectionEvent => ({
        id: String(value.id), eventType: String(value.eventType),
        occurredAt: String(value.occurredAt), recordedAt: String(value.recordedAt),
        supersedesEventId: value.supersedesEventId ? String(value.supersedesEventId) : null,
      })));
      const update = this.database.prepare(`UPDATE court_hearings
        SET current_state = ?, starts_at = COALESCE(?, starts_at),
        version = version + 1, updated_at = ?
        WHERE id = ? AND firm_id = ? AND matter_id = ? AND proceeding_id = ? AND version = ?`)
        .run(projection.state, input.revisedStartsAt, recordedAt, hearingId,
          user.firmId, matterId, proceedingId, input.expectedVersion);
      if (Number(update.changes) !== 1) throw new ProceedingsStoreError('CONFLICT', 'The hearing changed before the event was recorded.');
      const result = this.getHearing(user.firmId, matterId, hearingId);
      this.saveReceipt(user, matterId, proceedingId, scope, hearingId,
        input.idempotencyKey, input, result, recordedAt);
      this.appendOperational(user, matterId, {
        action: `proceedings.hearing_${input.eventType}`,
        entityType: 'court_hearing_event', entityId: eventId,
        title: 'Court hearing event recorded', idempotencyKey: input.idempotencyKey,
        after: { hearingId, eventType: input.eventType }, occurredAt: recordedAt,
      }, audit);
      return result;
    });
  }
}
