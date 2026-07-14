import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
  ApproveExpertInstructionInput,
  ApproveLetterOfClaimInput,
  CreateExpertEngagementInput,
  RecordExpertConflictCheckInput,
  RecordExpertMilestoneInput,
  RecordExpertQuestionAnswerInput,
  RecordExpertQuestionInput,
  RecordExpertReportInput,
  RecordLandlordResponseInput,
  RecordProtocolServiceEventInput,
  SaveLetterOfClaimInput,
  SelectExpertRouteInput,
  UpdateExpertEngagementInput,
  VaryProtocolDeadlineInput,
} from '../../shared/contracts.js';
import {
  canReadAllFirmMatters,
  canWriteAllFirmMatters,
  hasCapability,
  type SessionUser,
} from '../policy.js';
import { appendAudit, appendTimeline, type AuditContext } from '../store.js';
import { WorkflowStore } from '../workflow/store.js';
import { assembleLetterOfClaim, compareSourceManifest } from './assembler.js';
import { assembleExpertInstruction, type ExpertInstructionAssembly } from './instruction.js';
import type {
  ExpertConflictCheckRecord,
  ExpertEngagementRecord,
  ExpertInstructionVersionRecord,
  ExpertMilestoneRecord,
  ExpertQuestionRecord,
  ExpertReportRecord,
  GeneratedDocumentVersion,
  LandlordResponseRecord,
  LetterAssemblySources,
  LetterOfClaimRecord,
  LetterOfClaimVersionRecord,
  ProtocolCaseRecord,
  ProtocolRisk,
  ProtocolServiceEventRecord,
  ProtocolWorkspace,
} from './types.js';

type SqlValue = string | number | null;
type Row = Record<string, SqlValue>;

export type ProtocolStoreErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'PROTOCOL_INVALID'
  | 'APPROVAL_BLOCKED'
  | 'TRIGGER_BLOCKED';

export class ProtocolStoreError extends Error {
  constructor(readonly code: ProtocolStoreErrorCode, message: string) {
    super(message);
    this.name = 'ProtocolStoreError';
  }
}

function row(value: unknown): Row | undefined {
  return value as Row | undefined;
}

function rows(value: unknown): Row[] {
  return value as Row[];
}

function canonicalJson(value: unknown): string {
  function canonical(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, canonical(child)]),
      );
    }
    return input;
  }
  return JSON.stringify(canonical(value));
}

function parseJson<T>(value: SqlValue, fallback: T): T {
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

function mapGeneratedDocument(record: Row): GeneratedDocumentVersion {
  return {
    documentId: String(record.documentId),
    id: String(record.documentVersionId),
    version: Number(record.documentVersion),
    originalName: String(record.originalName),
    mimeType: String(record.mimeType),
    sizeBytes: Number(record.sizeBytes),
    sha256: String(record.sha256),
    createdAt: String(record.documentCreatedAt),
  };
}

export class ProtocolStore {
  private readonly workflowStore: WorkflowStore;

  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date,
    workflowStore?: WorkflowStore,
  ) {
    this.workflowStore = workflowStore ?? new WorkflowStore(database, now);
  }

  private canReadMatter(user: SessionUser, matterId: string): boolean {
    if (!hasCapability(user, 'matter.read')) return false;
    if (canReadAllFirmMatters(user)) {
      return Boolean(
        this.database.prepare('SELECT 1 FROM matters WHERE id = ? AND firm_id = ?')
          .get(matterId, user.firmId),
      );
    }
    return Boolean(
      this.database.prepare(
        `SELECT 1 FROM matters m WHERE m.id = ? AND m.firm_id = ? AND (
          m.owner_user_id = ? OR EXISTS (
            SELECT 1 FROM matter_members mm
            WHERE mm.firm_id = m.firm_id AND mm.matter_id = m.id
              AND mm.user_id = ?
          )
        )`,
      ).get(matterId, user.firmId, user.id, user.id),
    );
  }

  private canWriteMatter(user: SessionUser, matterId: string): boolean {
    if (!hasCapability(user, 'matter.write')) return false;
    if (canWriteAllFirmMatters(user)) {
      return Boolean(
        this.database.prepare('SELECT 1 FROM matters WHERE id = ? AND firm_id = ?')
          .get(matterId, user.firmId),
      );
    }
    return Boolean(
      this.database.prepare(
        `SELECT 1 FROM matters m WHERE m.id = ? AND m.firm_id = ? AND (
          m.owner_user_id = ? OR EXISTS (
            SELECT 1 FROM matter_members mm
            WHERE mm.firm_id = m.firm_id AND mm.matter_id = m.id
              AND mm.user_id = ? AND mm.access_level = 'write'
          )
        )`,
      ).get(matterId, user.firmId, user.id, user.id),
    );
  }

  private ensureCase(user: SessionUser, matterId: string): void {
    if (this.database.prepare(
      'SELECT 1 FROM protocol_cases WHERE firm_id = ? AND matter_id = ?',
    ).get(user.firmId, matterId)) return;
    if (!this.canWriteMatter(user, matterId) || !hasCapability(user, 'protocol.prepare')) {
      throw new ProtocolStoreError('NOT_FOUND', 'The protocol workspace was not found.');
    }
    const occurredAt = this.now().toISOString();
    transaction(this.database, () => {
      const caseId = randomUUID();
      const letterId = randomUUID();
      this.database.prepare(
        `INSERT INTO protocol_cases (
          id, firm_id, matter_id, created_by, created_at, updated_by, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(caseId, user.firmId, matterId, user.id, occurredAt, user.id, occurredAt);
      this.database.prepare(
        `INSERT INTO letters_of_claim (
          id, firm_id, matter_id, protocol_case_id, author_user_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(letterId, user.firmId, matterId, caseId, user.id, occurredAt, occurredAt);
    });
  }

  private getCase(firmId: string, matterId: string): ProtocolCaseRecord {
    const record = row(this.database.prepare(
      `SELECT id, version, protocol_status AS protocolStatus,
        expert_route AS expertRoute, expert_route_reason AS expertRouteReason,
        urgent_reason AS urgentReason, created_at AS createdAt,
        updated_at AS updatedAt
      FROM protocol_cases WHERE firm_id = ? AND matter_id = ?`,
    ).get(firmId, matterId));
    if (!record) throw new ProtocolStoreError('NOT_FOUND', 'The protocol case was not found.');
    return {
      id: String(record.id),
      version: Number(record.version),
      protocolStatus: String(record.protocolStatus) as ProtocolCaseRecord['protocolStatus'],
      expertRoute: String(record.expertRoute) as ProtocolCaseRecord['expertRoute'],
      expertRouteReason: String(record.expertRouteReason),
      urgentReason: String(record.urgentReason),
      createdAt: String(record.createdAt),
      updatedAt: String(record.updatedAt),
    };
  }

  private letterRow(firmId: string, matterId: string): Row {
    const record = row(this.database.prepare(
      `SELECT id, version, claimant_address AS claimantAddress,
        landlord_recipient AS landlordRecipient, landlord_address AS landlordAddress,
        effect_narrative AS effectNarrative,
        personal_injury_status AS personalInjuryStatus,
        personal_injury_summary AS personalInjurySummary,
        special_damages_status AS specialDamagesStatus,
        special_damages_summary AS specialDamagesSummary,
        access_windows_json AS accessWindowsJson,
        expert_proposal_summary AS expertProposalSummary,
        disclosure_requests_json AS disclosureRequestsJson,
        additional_content AS additionalContent, state,
        author_user_id AS authorUserId, reviewer_user_id AS reviewerUserId,
        created_at AS createdAt, updated_at AS updatedAt
      FROM letters_of_claim WHERE firm_id = ? AND matter_id = ?`,
    ).get(firmId, matterId));
    if (!record) throw new ProtocolStoreError('NOT_FOUND', 'The Letter of Claim was not found.');
    return record;
  }

  private draftFromRow(record: Row): Omit<SaveLetterOfClaimInput, 'expectedVersion'> {
    return {
      claimantAddress: String(record.claimantAddress),
      landlordRecipient: String(record.landlordRecipient),
      landlordAddress: String(record.landlordAddress),
      effectNarrative: String(record.effectNarrative),
      personalInjuryStatus: String(record.personalInjuryStatus) as SaveLetterOfClaimInput['personalInjuryStatus'],
      personalInjurySummary: String(record.personalInjurySummary),
      specialDamagesStatus: String(record.specialDamagesStatus) as SaveLetterOfClaimInput['specialDamagesStatus'],
      specialDamagesSummary: String(record.specialDamagesSummary),
      accessWindows: parseJson(record.accessWindowsJson, []),
      expertProposalSummary: String(record.expertProposalSummary),
      disclosureRequests: parseJson(record.disclosureRequestsJson, []),
      additionalContent: String(record.additionalContent),
      state: String(record.state) === 'ready_for_review' ? 'ready_for_review' : 'draft',
    };
  }

  private assemblySources(firmId: string, matterId: string, draft: Omit<SaveLetterOfClaimInput, 'expectedVersion'>): LetterAssemblySources {
    const source = row(this.database.prepare(
      `SELECT m.id AS matterId, m.reference,
        c.id AS claimantId, c.display_name AS claimantName, c.phone AS claimantPhone,
        p.id AS propertyId, p.address_line_1 AS addressLine1,
        p.address_line_2 AS addressLine2, p.city, p.county, p.postcode,
        o.id AS landlordId, o.name AS landlordName, o.address AS landlordAddress,
        t.id AS tenancyId, t.tenancy_type AS tenancyType, t.started_on AS startedOn
      FROM matters m
      LEFT JOIN housing_cases hc ON hc.firm_id = m.firm_id AND hc.matter_id = m.id
      LEFT JOIN contacts c ON c.id = hc.claimant_contact_id AND c.firm_id = hc.firm_id
      LEFT JOIN properties p ON p.id = hc.property_id AND p.firm_id = hc.firm_id
      LEFT JOIN organisations o ON o.id = hc.landlord_organisation_id AND o.firm_id = hc.firm_id
      LEFT JOIN tenancies t ON t.id = hc.tenancy_id AND t.firm_id = hc.firm_id
      WHERE m.firm_id = ? AND m.id = ?`,
    ).get(firmId, matterId));
    if (!source) throw new ProtocolStoreError('NOT_FOUND', 'The matter was not found.');

    const defects = rows(this.database.prepare(
      `SELECT d.id, d.version, d.location, d.title, d.description, d.status,
        d.severity, d.first_observed_on AS firstObservedOn,
        COALESCE((SELECT json_group_array(dse.occurred_at || ' · ' || dse.reason)
          FROM defect_status_events dse WHERE dse.firm_id = d.firm_id
            AND dse.matter_id = d.matter_id AND dse.defect_id = d.id), '[]') AS historyJson
      FROM defects d WHERE d.firm_id = ? AND d.matter_id = ?
        AND d.status <> 'superseded'`,
    ).all(firmId, matterId)).map((item) => ({
      id: String(item.id), version: Number(item.version), location: String(item.location),
      title: String(item.title), description: String(item.description), status: String(item.status),
      severity: String(item.severity), firstObservedOn: item.firstObservedOn ? String(item.firstObservedOn) : null,
      history: parseJson<string[]>(item.historyJson, []),
    }));
    const notices = rows(this.database.prepare(
      `SELECT id, occurred_at AS occurredAt, channel, recipient_name AS recipientName,
        summary, proof_status AS proofStatus FROM notices
      WHERE firm_id = ? AND matter_id = ?`,
    ).all(firmId, matterId)).map((item) => ({
      id: String(item.id), occurredAt: String(item.occurredAt), channel: String(item.channel),
      recipientName: String(item.recipientName), summary: String(item.summary), proofStatus: String(item.proofStatus),
    }));
    const accessEvents = rows(this.database.prepare(
      `SELECT id, event_type AS eventType, appointment_at AS appointmentAt, notes
      FROM access_events WHERE firm_id = ? AND matter_id = ?`,
    ).all(firmId, matterId)).map((item) => ({
      id: String(item.id), eventType: String(item.eventType),
      appointmentAt: item.appointmentAt ? String(item.appointmentAt) : null, notes: String(item.notes),
    }));
    const evidenceItemIds = rows(this.database.prepare(
      'SELECT id FROM evidence_items WHERE firm_id = ? AND matter_id = ? ORDER BY id',
    ).all(firmId, matterId)).map((item) => String(item.id));

    return {
      assembledAt: this.now().toISOString(),
      matter: { id: String(source.matterId), version: 1, reference: String(source.reference) },
      claimant: source.claimantId ? {
        id: String(source.claimantId), name: String(source.claimantName),
        address: draft.claimantAddress, phone: String(source.claimantPhone ?? ''),
      } : null,
      property: source.propertyId ? {
        id: String(source.propertyId), addressLine1: String(source.addressLine1),
        addressLine2: String(source.addressLine2), city: String(source.city),
        county: String(source.county), postcode: String(source.postcode),
      } : null,
      landlord: source.landlordId ? {
        id: String(source.landlordId), name: String(source.landlordName), address: String(source.landlordAddress),
      } : null,
      tenancy: source.tenancyId ? {
        id: String(source.tenancyId), tenancyType: String(source.tenancyType),
        startedOn: source.startedOn ? String(source.startedOn) : null,
      } : null,
      defects,
      notices,
      accessEvents,
      evidenceItemIds,
      draft,
    };
  }

  private getLetter(firmId: string, matterId: string): LetterOfClaimRecord {
    const record = this.letterRow(firmId, matterId);
    const draft = this.draftFromRow(record);
    return {
      id: String(record.id),
      version: Number(record.version),
      state: String(record.state) as LetterOfClaimRecord['state'],
      draft,
      source: assembleLetterOfClaim(this.assemblySources(firmId, matterId, draft)),
      authorUserId: String(record.authorUserId),
      reviewerUserId: record.reviewerUserId ? String(record.reviewerUserId) : null,
      createdAt: String(record.createdAt),
      updatedAt: String(record.updatedAt),
    };
  }

  private listLetterVersions(firmId: string, matterId: string): LetterOfClaimVersionRecord[] {
    return rows(this.database.prepare(
      `SELECT lv.id, lv.version, lv.content_json AS contentJson,
        lv.source_manifest_json AS sourceManifestJson, lv.template_key AS templateKey,
        lv.renderer_version AS rendererVersion, lv.content_sha256 AS contentSha256,
        lv.approved_by AS approvedBy, lv.approved_at AS approvedAt,
        d.id AS documentId, dv.id AS documentVersionId, dv.version AS documentVersion,
        dv.original_name AS originalName, dv.mime_type AS mimeType,
        dv.size_bytes AS sizeBytes, dv.sha256, dv.created_at AS documentCreatedAt
      FROM letter_of_claim_versions lv
      JOIN documents d ON d.id = lv.document_id AND d.firm_id = lv.firm_id
      JOIN document_versions dv ON dv.id = lv.document_version_id
        AND dv.document_id = d.id AND dv.firm_id = d.firm_id
      WHERE lv.firm_id = ? AND lv.matter_id = ? ORDER BY lv.version`,
    ).all(firmId, matterId)).map((record) => ({
      id: String(record.id), version: Number(record.version),
      model: parseJson(record.contentJson, {} as LetterOfClaimVersionRecord['model']),
      sourceManifest: parseJson(record.sourceManifestJson, {} as LetterOfClaimVersionRecord['sourceManifest']),
      templateKey: String(record.templateKey), rendererVersion: String(record.rendererVersion),
      contentSha256: String(record.contentSha256), documentVersion: mapGeneratedDocument(record),
      approvedBy: String(record.approvedBy), approvedAt: String(record.approvedAt),
      sourceFreshness: { fresh: true, added: [], changed: [], removed: [] },
    }));
  }

  private listServiceEvents(firmId: string, matterId: string): ProtocolServiceEventRecord[] {
    return rows(this.database.prepare(
      `SELECT id, letter_version_id AS letterVersionId, event_type AS eventType,
        method, occurred_at AS occurredAt, legal_trigger_on AS legalTriggerOn,
        recipient, destination, source_detail AS sourceDetail,
        supporting_document_version_id AS supportingDocumentVersionId,
        supersedes_event_id AS supersedesEventId, correction_reason AS correctionReason,
        created_by AS createdBy, created_at AS createdAt
      FROM protocol_service_events WHERE firm_id = ? AND matter_id = ?
      ORDER BY occurred_at, created_at, id`,
    ).all(firmId, matterId)).map((record) => ({
      id: String(record.id), letterVersionId: String(record.letterVersionId),
      eventType: String(record.eventType) as ProtocolServiceEventRecord['eventType'],
      method: String(record.method) as ProtocolServiceEventRecord['method'],
      occurredAt: String(record.occurredAt), legalTriggerOn: record.legalTriggerOn ? String(record.legalTriggerOn) : null,
      recipient: String(record.recipient), destination: String(record.destination), sourceDetail: String(record.sourceDetail),
      supportingDocumentVersionId: record.supportingDocumentVersionId ? String(record.supportingDocumentVersionId) : null,
      supersedesEventId: record.supersedesEventId ? String(record.supersedesEventId) : null,
      correctionReason: String(record.correctionReason), createdBy: String(record.createdBy), createdAt: String(record.createdAt),
    }));
  }

  private listResponses(firmId: string, matterId: string): LandlordResponseRecord[] {
    const responseRows = rows(this.database.prepare(
      `SELECT id, response_type AS responseType, received_on AS receivedOn,
        responding_party AS respondingParty, contact_name AS contactName,
        general_liability_position AS generalLiabilityPosition,
        liability_reasons AS liabilityReasons, notice_position AS noticePosition,
        access_position AS accessPosition, disclosure_status AS disclosureStatus,
        disclosure_summary AS disclosureSummary,
        expert_proposal_position AS expertProposalPosition,
        expert_proposal_summary AS expertProposalSummary,
        works_schedule AS worksSchedule, works_start_on AS worksStartOn,
        works_complete_on AS worksCompleteOn,
        compensation_offer_minor AS compensationOfferMinor,
        costs_offer_minor AS costsOfferMinor, currency,
        source_document_version_id AS sourceDocumentVersionId,
        supersedes_response_id AS supersedesResponseId,
        created_by AS createdBy, created_at AS createdAt
      FROM landlord_responses WHERE firm_id = ? AND matter_id = ? ORDER BY created_at, id`,
    ).all(firmId, matterId));
    const positions = rows(this.database.prepare(
      `SELECT response_id AS responseId, defect_id AS defectId, position, reason
       FROM landlord_response_defects WHERE firm_id = ? AND matter_id = ?`,
    ).all(firmId, matterId));
    return responseRows.map((record) => ({
      id: String(record.id), responseType: String(record.responseType) as LandlordResponseRecord['responseType'],
      receivedOn: record.receivedOn ? String(record.receivedOn) : null,
      respondingParty: String(record.respondingParty), contactName: String(record.contactName),
      generalLiabilityPosition: String(record.generalLiabilityPosition) as LandlordResponseRecord['generalLiabilityPosition'],
      liabilityReasons: String(record.liabilityReasons), noticePosition: String(record.noticePosition),
      accessPosition: String(record.accessPosition), disclosureStatus: String(record.disclosureStatus) as LandlordResponseRecord['disclosureStatus'],
      disclosureSummary: String(record.disclosureSummary),
      expertProposalPosition: String(record.expertProposalPosition) as LandlordResponseRecord['expertProposalPosition'],
      expertProposalSummary: String(record.expertProposalSummary), worksSchedule: String(record.worksSchedule),
      worksStartOn: record.worksStartOn ? String(record.worksStartOn) : null,
      worksCompleteOn: record.worksCompleteOn ? String(record.worksCompleteOn) : null,
      compensationOfferMinor: record.compensationOfferMinor === null ? null : Number(record.compensationOfferMinor),
      costsOfferMinor: record.costsOfferMinor === null ? null : Number(record.costsOfferMinor),
      currency: String(record.currency),
      sourceDocumentVersionId: record.sourceDocumentVersionId ? String(record.sourceDocumentVersionId) : null,
      supersedesResponseId: record.supersedesResponseId ? String(record.supersedesResponseId) : null,
      defectPositions: positions.filter((item) => String(item.responseId) === String(record.id)).map((item) => ({
        defectId: String(item.defectId),
        position: String(item.position) as LandlordResponseRecord['defectPositions'][number]['position'],
        reason: String(item.reason),
      })),
      createdBy: String(record.createdBy), createdAt: String(record.createdAt),
    }));
  }

  private listExperts(firmId: string, matterId: string): ExpertEngagementRecord[] {
    const engagements = rows(this.database.prepare(
      `SELECT id, version, route, expert_role AS expertRole, expert_name AS expertName,
        organisation, email, phone, expertise, qualifications,
        registration_body AS registrationBody,
        registration_reference AS registrationReference,
        verification_status AS verificationStatus,
        verification_method AS verificationMethod, verified_on AS verifiedOn,
        proposed_by AS proposedBy, single_joint AS singleJoint,
        terms_status AS termsStatus, fee_basis AS feeBasis, fee_minor AS feeMinor,
        currency, payer_split_json AS payerSplitJson,
        availability_summary AS availabilitySummary,
        target_report_on AS targetReportOn, state,
        created_at AS createdAt, updated_at AS updatedAt
      FROM expert_engagements WHERE firm_id = ? AND matter_id = ?
      ORDER BY created_at, id`,
    ).all(firmId, matterId));
    const conflictRows = rows(this.database.prepare(
      `SELECT id, engagement_id AS engagementId,
        parties_checked_json AS partiesCheckedJson, method,
        search_detail AS searchDetail, outcome, decision, reason,
        checked_by AS checkedBy, checked_at AS checkedAt
      FROM expert_conflict_checks WHERE firm_id = ? AND matter_id = ?
      ORDER BY checked_at, id`,
    ).all(firmId, matterId));
    const instructionRows = rows(this.database.prepare(
      `SELECT iv.id, iv.engagement_id AS engagementId, iv.version,
        iv.content_json AS contentJson, iv.source_manifest_json AS sourceManifestJson,
        iv.approved_by AS approvedBy, iv.approved_at AS approvedAt,
        d.id AS documentId, dv.id AS documentVersionId,
        dv.version AS documentVersion, dv.original_name AS originalName,
        dv.mime_type AS mimeType, dv.size_bytes AS sizeBytes,
        dv.sha256, dv.created_at AS documentCreatedAt
      FROM expert_instruction_versions iv
      JOIN documents d ON d.id = iv.document_id AND d.firm_id = iv.firm_id
      JOIN document_versions dv ON dv.id = iv.document_version_id
        AND dv.document_id = d.id AND dv.firm_id = d.firm_id
      WHERE iv.firm_id = ? AND iv.matter_id = ? ORDER BY iv.version`,
    ).all(firmId, matterId));
    const milestoneRows = rows(this.database.prepare(
      `SELECT id, engagement_id AS engagementId,
        instruction_version_id AS instructionVersionId, event_type AS eventType,
        occurred_at AS occurredAt, legal_trigger_on AS legalTriggerOn, detail,
        supporting_document_version_id AS supportingDocumentVersionId,
        supersedes_event_id AS supersedesEventId,
        created_by AS createdBy, created_at AS createdAt
      FROM expert_milestone_events WHERE firm_id = ? AND matter_id = ?
      ORDER BY occurred_at, created_at, id`,
    ).all(firmId, matterId));
    const reportRows = rows(this.database.prepare(
      `SELECT er.id, er.engagement_id AS engagementId, er.report_type AS reportType,
        er.report_on AS reportOn, er.received_on AS receivedOn,
        er.coverage_summary AS coverageSummary,
        er.urgent_works_identified AS urgentWorksIdentified,
        er.supersedes_report_id AS supersedesReportId,
        er.created_by AS createdBy, er.created_at AS createdAt,
        d.id AS documentId, dv.id AS documentVersionId,
        dv.version AS documentVersion, dv.original_name AS originalName,
        dv.mime_type AS mimeType, dv.size_bytes AS sizeBytes,
        dv.sha256, dv.created_at AS documentCreatedAt
      FROM expert_report_records er
      JOIN documents d ON d.id = er.document_id AND d.firm_id = er.firm_id
      JOIN document_versions dv ON dv.id = er.document_version_id
        AND dv.document_id = d.id AND dv.firm_id = d.firm_id
      WHERE er.firm_id = ? AND er.matter_id = ? ORDER BY er.received_on, er.id`,
    ).all(firmId, matterId));
    const questionRows = rows(this.database.prepare(
      `SELECT id, engagement_id AS engagementId, report_id AS reportId,
        question, clarification_purpose AS clarificationPurpose,
        dispatched_on AS dispatchedOn, response_due_on AS responseDueOn,
        legal_basis AS legalBasis, created_by AS createdBy, created_at AS createdAt
      FROM expert_questions WHERE firm_id = ? AND matter_id = ? ORDER BY created_at, id`,
    ).all(firmId, matterId));
    const answerRows = rows(this.database.prepare(
      `SELECT ea.id, ea.engagement_id AS engagementId,
        ea.question_id AS questionId, ea.received_on AS receivedOn, ea.summary,
        ea.created_by AS createdBy, ea.created_at AS createdAt,
        d.id AS documentId, dv.id AS documentVersionId,
        dv.version AS documentVersion, dv.original_name AS originalName,
        dv.mime_type AS mimeType, dv.size_bytes AS sizeBytes,
        dv.sha256, dv.created_at AS documentCreatedAt
      FROM expert_question_answers ea
      JOIN documents d ON d.id = ea.document_id AND d.firm_id = ea.firm_id
      JOIN document_versions dv ON dv.id = ea.document_version_id
        AND dv.document_id = d.id AND dv.firm_id = d.firm_id
      WHERE ea.firm_id = ? AND ea.matter_id = ? ORDER BY ea.received_on, ea.id`,
    ).all(firmId, matterId));

    return engagements.map((record) => {
      const conflictChecks: ExpertConflictCheckRecord[] = conflictRows
        .filter((item) => String(item.engagementId) === String(record.id))
        .map((item) => ({
          id: String(item.id),
          partiesChecked: parseJson(item.partiesCheckedJson, []),
          method: String(item.method), searchDetail: String(item.searchDetail),
          outcome: String(item.outcome) as ExpertConflictCheckRecord['outcome'],
          decision: String(item.decision) as ExpertConflictCheckRecord['decision'],
          reason: String(item.reason), checkedBy: String(item.checkedBy), checkedAt: String(item.checkedAt),
        }));
      const instructionVersions: ExpertInstructionVersionRecord[] = instructionRows
        .filter((item) => String(item.engagementId) === String(record.id))
        .map((item) => ({
          id: String(item.id), version: Number(item.version),
          model: parseJson(item.contentJson, {}), sourceManifest: parseJson(item.sourceManifestJson, {}),
          documentVersion: mapGeneratedDocument(item), approvedBy: String(item.approvedBy), approvedAt: String(item.approvedAt),
        }));
      const milestones: ExpertMilestoneRecord[] = milestoneRows
        .filter((item) => String(item.engagementId) === String(record.id))
        .map((item) => ({
          id: String(item.id),
          eventType: String(item.eventType) as ExpertMilestoneRecord['eventType'],
          occurredAt: String(item.occurredAt),
          legalTriggerOn: item.legalTriggerOn ? String(item.legalTriggerOn) : null,
          detail: String(item.detail),
          instructionVersionId: item.instructionVersionId ? String(item.instructionVersionId) : null,
          supportingDocumentVersionId: item.supportingDocumentVersionId ? String(item.supportingDocumentVersionId) : null,
          supersedesEventId: item.supersedesEventId ? String(item.supersedesEventId) : null,
          createdBy: String(item.createdBy), createdAt: String(item.createdAt),
        }));
      const reports: ExpertReportRecord[] = reportRows
        .filter((item) => String(item.engagementId) === String(record.id))
        .map((item) => ({
          id: String(item.id), reportType: String(item.reportType) as ExpertReportRecord['reportType'],
          reportOn: String(item.reportOn), receivedOn: String(item.receivedOn),
          coverageSummary: String(item.coverageSummary), urgentWorksIdentified: Number(item.urgentWorksIdentified) === 1,
          documentVersion: mapGeneratedDocument(item),
          supersedesReportId: item.supersedesReportId ? String(item.supersedesReportId) : null,
          reviewed: milestones.some(({ eventType }) => eventType === 'report_reviewed'),
          createdBy: String(item.createdBy), createdAt: String(item.createdAt),
        }));
      const questions: ExpertQuestionRecord[] = questionRows
        .filter((item) => String(item.engagementId) === String(record.id))
        .map((item) => ({
          id: String(item.id), reportId: String(item.reportId), question: String(item.question),
          clarificationPurpose: String(item.clarificationPurpose),
          dispatchedOn: item.dispatchedOn ? String(item.dispatchedOn) : null,
          responseDueOn: item.responseDueOn ? String(item.responseDueOn) : null,
          legalBasis: String(item.legalBasis) as ExpertQuestionRecord['legalBasis'],
          reportServedOn: null,
          answers: answerRows.filter((answer) => String(answer.questionId) === String(item.id)).map((answer) => ({
            id: String(answer.id), receivedOn: String(answer.receivedOn), summary: String(answer.summary),
            documentVersion: mapGeneratedDocument(answer), createdBy: String(answer.createdBy), createdAt: String(answer.createdAt),
          })),
          createdBy: String(item.createdBy), createdAt: String(item.createdAt),
        }));
      return {
        id: String(record.id), version: Number(record.version),
        route: String(record.route) as ExpertEngagementRecord['route'],
        expertRole: String(record.expertRole) as ExpertEngagementRecord['expertRole'],
        expertName: String(record.expertName), organisation: String(record.organisation),
        email: String(record.email), phone: String(record.phone), expertise: String(record.expertise),
        qualifications: String(record.qualifications), registrationBody: String(record.registrationBody),
        registrationReference: String(record.registrationReference),
        verificationStatus: String(record.verificationStatus) as ExpertEngagementRecord['verificationStatus'],
        verificationMethod: String(record.verificationMethod), verifiedOn: record.verifiedOn ? String(record.verifiedOn) : null,
        proposedBy: String(record.proposedBy) as ExpertEngagementRecord['proposedBy'],
        singleJoint: Number(record.singleJoint) === 1,
        termsStatus: String(record.termsStatus) as ExpertEngagementRecord['termsStatus'],
        feeBasis: String(record.feeBasis), feeMinor: record.feeMinor === null ? null : Number(record.feeMinor),
        currency: String(record.currency), payerSplit: parseJson(record.payerSplitJson, { claimantPercent: 0, landlordPercent: 0 }),
        availabilitySummary: String(record.availabilitySummary), targetReportOn: record.targetReportOn ? String(record.targetReportOn) : null,
        state: String(record.state) as ExpertEngagementRecord['state'],
        conflictChecks, instructionVersions, milestones, reports, questions,
        createdAt: String(record.createdAt), updatedAt: String(record.updatedAt),
      };
    });
  }

  getWorkspace(user: SessionUser, matterId: string): ProtocolWorkspace | undefined {
    if (!this.canReadMatter(user, matterId)) return undefined;
    this.ensureCase(user, matterId);
    const caseRecord = this.getCase(user.firmId, matterId);
    const letter = this.getLetter(user.firmId, matterId);
    const letterVersions = this.listLetterVersions(user.firmId, matterId).map((version) => ({
      ...version,
      sourceFreshness: compareSourceManifest(version.sourceManifest, letter.source.manifest),
    }));
    const serviceEvents = this.listServiceEvents(user.firmId, matterId);
    const landlordResponses = this.listResponses(user.firmId, matterId);
    const experts = this.listExperts(user.firmId, matterId);
    const deadlines = this.workflowStore.listMatterDeadlines(user.firmId, matterId).map((deadline) => ({
      id: deadline.id, title: deadline.title, triggerDate: deadline.triggerDate,
      dueDate: deadline.dueDate, status: deadline.status, explanation: deadline.explanation,
      sourceTitle: deadline.source.title, sourceUrl: deadline.source.url, ruleKey: deadline.ruleKey,
    }));
    const risks: ProtocolRisk[] = [];
    if (letterVersions.some(({ sourceFreshness }) => !sourceFreshness.fresh)) {
      risks.push({
        key: 'letter-sources-changed', type: 'letter_sources_changed', level: 'high',
        title: 'Approved letter sources changed',
        detail: 'One or more governed source facts differ from the approved Letter of Claim snapshot.',
        entityId: letterVersions.at(-1)?.id ?? null,
      });
    }
    if (letterVersions.length > 0 && !serviceEvents.some(({ eventType }) => eventType === 'dispatched')) {
      risks.push({
        key: 'letter-not-dispatched', type: 'letter_not_dispatched', level: 'high',
        title: 'Approved letter not dispatched', detail: 'Record dispatch against the exact approved version.',
        entityId: letterVersions.at(-1)?.id ?? null,
      });
    }
    if (serviceEvents.some(({ eventType }) => eventType === 'dispatched') &&
      !serviceEvents.some(({ eventType }) => ['actual_receipt', 'deemed_receipt'].includes(eventType))) {
      risks.push({
        key: 'receipt-not-confirmed', type: 'receipt_not_confirmed', level: 'critical',
        title: 'Receipt date not confirmed', detail: 'The legal response trigger cannot be inferred from dispatch.',
        entityId: letterVersions.at(-1)?.id ?? null,
      });
    }
    const latestResponse = landlordResponses.at(-1);
    if (latestResponse && (
      latestResponse.disclosureStatus !== 'complete' ||
      latestResponse.defectPositions.length < letter.source.model.defects.length
    )) {
      risks.push({
        key: `landlord-response-incomplete:${latestResponse.id}`,
        type: 'landlord_response_incomplete', level: 'high',
        title: 'Landlord response is incomplete',
        detail: 'Disclosure or one or more defect positions remain incomplete or unaddressed.',
        entityId: latestResponse.id,
      });
    }
    if (caseRecord.expertRoute === 'undecided') {
      risks.push({
        key: 'expert-route-undecided', type: 'expert_route_undecided', level: 'medium',
        title: 'Expert route undecided', detail: 'Record the reasoned expert evidence route.', entityId: caseRecord.id,
      });
    }
    const reportDeadline = deadlines.find(({ ruleKey, status }) =>
      ruleKey === 'housing.expert.report' && status === 'pending');
    if (reportDeadline && reportDeadline.dueDate < this.now().toISOString().slice(0, 10) &&
      !experts.some(({ reports }) => reports.length > 0)) {
      risks.push({
        key: `report-missing:${reportDeadline.id}`, type: 'report_missing', level: 'critical',
        title: 'Expert report overdue or missing',
        detail: `The expert report deadline passed on ${reportDeadline.dueDate} and no exact report version is recorded.`,
        entityId: experts[0]?.id ?? null,
      });
    }
    const protocolReadiness = this.getProtocolReadiness(user.firmId, matterId, 'protocol');
    const expertReadiness = this.getProtocolReadiness(user.firmId, matterId, 'expert');
    return {
      matterId,
      case: caseRecord,
      letter,
      letterVersions,
      serviceEvents,
      landlordResponses,
      experts,
      deadlines,
      readiness: {
        controls: [...protocolReadiness.controls, ...expertReadiness.controls],
        progressionBlockers: [
          ...protocolReadiness.progressionBlockers,
          ...expertReadiness.progressionBlockers,
        ],
      },
      risks,
      permissions: {
        canPrepare: hasCapability(user, 'protocol.prepare') && this.canWriteMatter(user, matterId),
        canApprove: hasCapability(user, 'protocol.approve') && this.canWriteMatter(user, matterId),
        canOverrideConflict: hasCapability(user, 'protocol.override_conflict') && this.canWriteMatter(user, matterId),
        canReviewReport: hasCapability(user, 'protocol.review_report') && this.canWriteMatter(user, matterId),
      },
    };
  }

  getProtocolReadiness(
    firmId: string,
    matterId: string,
    stageKey: 'protocol' | 'expert',
  ) {
    const caseRecord = row(this.database.prepare(
      `SELECT id, expert_route AS expertRoute,
        expert_route_reason AS expertRouteReason,
        urgent_reason AS urgentReason
       FROM protocol_cases WHERE firm_id = ? AND matter_id = ?`,
    ).get(firmId, matterId));
    if (!caseRecord) {
      return {
        controls: [{
          key: stageKey === 'protocol' ? 'letter_of_claim_sent' as const : 'expert_instruction_confirmed' as const,
          eligible: false,
          explanation: 'The protocol workspace has not been created.',
        }],
        progressionBlockers: [{
          key: 'protocol_workspace_missing', label: 'The protocol workspace has not been created.', severity: 'critical' as const,
        }],
      };
    }
    if (stageKey === 'protocol') {
      const approved = Boolean(this.database.prepare(
        'SELECT 1 FROM letter_of_claim_versions WHERE firm_id = ? AND matter_id = ? LIMIT 1',
      ).get(firmId, matterId));
      const dispatched = Boolean(this.database.prepare(
        `SELECT 1 FROM protocol_service_events WHERE firm_id = ? AND matter_id = ?
          AND event_type = 'dispatched' LIMIT 1`,
      ).get(firmId, matterId));
      const receipt = Boolean(this.database.prepare(
        `SELECT 1 FROM protocol_service_events WHERE firm_id = ? AND matter_id = ?
          AND event_type IN ('actual_receipt', 'deemed_receipt') LIMIT 1`,
      ).get(firmId, matterId));
      const deadline = this.workflowStore.listMatterDeadlines(firmId, matterId)
        .some(({ ruleKey, status }) => ruleKey === 'housing.protocol.landlord_response' && status === 'pending');
      const response = Boolean(this.database.prepare(
        'SELECT 1 FROM landlord_responses WHERE firm_id = ? AND matter_id = ? LIMIT 1',
      ).get(firmId, matterId));
      const urgentRoute = String(caseRecord.expertRoute) === 'urgent_own_expert' &&
        String(caseRecord.urgentReason).trim().length >= 10;
      const requirements = [
        ['letter_not_approved', approved, 'Approve an immutable Letter of Claim version.'],
        ['letter_not_dispatched', dispatched, 'Record dispatch of the approved Letter of Claim.'],
        ['receipt_not_confirmed', receipt, 'Confirm the actual or deemed receipt date.'],
        ['response_deadline_missing', deadline, 'Create the landlord response deadline from confirmed receipt.'],
        ['landlord_response_missing', response || urgentRoute, 'Record the landlord response, overdue no-response fact, or an authorised urgent expert route.'],
      ] as const;
      const blockers = requirements.filter(([, met]) => !met).map(([key, , label]) => ({
        key, label, severity: key === 'receipt_not_confirmed' ? 'critical' as const : 'warning' as const,
      }));
      return {
        controls: [{
          key: 'letter_of_claim_sent' as const,
          eligible: blockers.length === 0,
          explanation: blockers.length === 0
            ? 'The approved Letter of Claim, receipt, deadline and response position are recorded.'
            : blockers[0]!.label,
        }],
        progressionBlockers: blockers,
      };
    }

    if (String(caseRecord.expertRoute) === 'not_required') {
      const eligible = String(caseRecord.expertRouteReason).trim().length >= 10;
      return {
        controls: [{
          key: 'expert_instruction_confirmed' as const, eligible,
          explanation: eligible
            ? 'An authorised reason records that expert evidence is not required.'
            : 'Record an authorised reason before selecting no expert.',
        }],
        progressionBlockers: eligible ? [] : [{
          key: 'expert_route_reason_missing', label: 'Record an authorised reason before selecting no expert.', severity: 'critical' as const,
        }],
      };
    }
    const experts = this.listExperts(firmId, matterId);
    const expert = experts.find(({ state }) => state !== 'cancelled');
    const conflict = expert?.conflictChecks.at(-1);
    const conflictAcceptable = conflict?.decision === 'clear_to_proceed' || conflict?.decision === 'proceed_with_override';
    const instruction = Boolean(expert?.instructionVersions.length);
    const dispatched = Boolean(expert?.milestones.some(({ eventType }) => eventType === 'instruction_dispatched'));
    const reviewedReport = Boolean(
      expert?.reports.length && expert.milestones.some(({ eventType }) => eventType === 'report_reviewed'),
    );
    const requirements = [
      ['expert_route_undecided', String(caseRecord.expertRoute) !== 'undecided', 'Select the expert route.'],
      ['expert_missing', Boolean(expert), 'Create an expert engagement.'],
      ['expert_conflict_unresolved', Boolean(conflictAcceptable), 'Record an acceptable human conflict decision.'],
      ['expert_terms_missing', expert?.termsStatus === 'accepted', 'Accept the expert terms and fee arrangements.'],
      ['expert_instruction_missing', instruction, 'Approve an immutable expert instruction.'],
      ['expert_instruction_not_dispatched', dispatched, 'Record dispatch of the approved instruction.'],
    ] as const;
    const instructionBlockers = requirements.filter(([, met]) => !met).map(([key, , label]) => ({
      key, label, severity: key === 'expert_conflict_unresolved' ? 'critical' as const : 'warning' as const,
    }));
    const progressionBlockers: Array<{
      key: string;
      label: string;
      severity: 'warning' | 'critical';
    }> = [...instructionBlockers];
    if (!reviewedReport) progressionBlockers.push({
      key: 'expert_report_not_reviewed',
      label: 'Receive and review the expert report or agreed schedule before leaving expert evidence.',
      severity: 'warning',
    });
    return {
      controls: [{
        key: 'expert_instruction_confirmed' as const,
        eligible: instructionBlockers.length === 0,
        explanation: instructionBlockers.length === 0
          ? 'The governed expert instruction has been dispatched.'
          : instructionBlockers[0]!.label,
      }],
      progressionBlockers,
    };
  }

  varyDeadline(
    user: SessionUser,
    matterId: string,
    input: VaryProtocolDeadlineInput,
    audit: AuditContext,
  ) {
    try {
      return this.workflowStore.varyDeadline({
        firmId: user.firmId, matterId, actorUserId: user.id,
        deadlineId: input.deadlineId, agreedOn: input.agreedOn,
        dueOn: input.dueOn, reason: input.reason,
        idempotencyKey: input.idempotencyKey, auditContext: audit,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Idempotency key')) {
        throw new ProtocolStoreError('IDEMPOTENCY_KEY_REUSED', error.message);
      }
      if (error instanceof Error && error.message.includes('not found')) {
        throw new ProtocolStoreError('NOT_FOUND', 'The deadline was not found.');
      }
      if (error instanceof Error) {
        throw new ProtocolStoreError('PROTOCOL_INVALID', error.message);
      }
      throw error;
    }
  }

  saveLetter(user: SessionUser, matterId: string, input: SaveLetterOfClaimInput, audit: AuditContext): LetterOfClaimRecord {
    if (!this.canWriteMatter(user, matterId) || !hasCapability(user, 'protocol.prepare')) {
      throw new ProtocolStoreError('NOT_FOUND', 'The protocol workspace was not found.');
    }
    this.ensureCase(user, matterId);
    const occurredAt = this.now().toISOString();
    transaction(this.database, () => {
      const result = this.database.prepare(
        `UPDATE letters_of_claim SET version = version + 1, claimant_address = ?,
          landlord_recipient = ?, landlord_address = ?, effect_narrative = ?,
          personal_injury_status = ?, personal_injury_summary = ?,
          special_damages_status = ?, special_damages_summary = ?,
          access_windows_json = ?, expert_proposal_summary = ?,
          disclosure_requests_json = ?, additional_content = ?, state = ?,
          author_user_id = ?, reviewer_user_id = NULL, updated_at = ?
        WHERE firm_id = ? AND matter_id = ? AND version = ?`,
      ).run(
        input.claimantAddress, input.landlordRecipient, input.landlordAddress,
        input.effectNarrative, input.personalInjuryStatus, input.personalInjurySummary,
        input.specialDamagesStatus, input.specialDamagesSummary,
        JSON.stringify(input.accessWindows), input.expertProposalSummary,
        JSON.stringify(input.disclosureRequests), input.additionalContent, input.state,
        user.id, occurredAt, user.firmId, matterId, input.expectedVersion,
      );
      if (result.changes !== 1) throw new ProtocolStoreError('CONFLICT', 'The Letter of Claim changed before it was saved.');
      const letter = this.letterRow(user.firmId, matterId);
      appendTimeline(this.database, {
        firmId: user.firmId, matterId, type: 'protocol.letter.saved',
        title: 'Letter of Claim draft saved', actorUserId: user.id, occurredAt,
        metadata: { version: Number(letter.version), state: input.state },
      });
      appendAudit(this.database, {
        firmId: user.firmId, matterId, userId: user.id, action: 'protocol.letter.saved',
        entityType: 'letter_of_claim', entityId: String(letter.id), after: input,
        createdAt: occurredAt, requestId: audit.requestId, ipAddress: audit.ipAddress,
      });
    });
    return this.getLetter(user.firmId, matterId);
  }

  persistApproval(
    user: SessionUser,
    matterId: string,
    input: ApproveLetterOfClaimInput,
    generated: { storageKey: string; sizeBytes: number; sha256: string },
    rendererVersion: string,
    audit: AuditContext,
  ): LetterOfClaimVersionRecord {
    const payloadJson = canonicalJson(input);
    const existing = row(this.database.prepare(
      `SELECT command_payload_json AS payload FROM letter_of_claim_versions
       WHERE firm_id = ? AND matter_id = ? AND idempotency_key = ?`,
    ).get(user.firmId, matterId, input.idempotencyKey));
    if (existing) {
      if (String(existing.payload) !== payloadJson) {
        throw new ProtocolStoreError('IDEMPOTENCY_KEY_REUSED', 'The idempotency key has already been used with different data.');
      }
      return this.listLetterVersions(user.firmId, matterId).find((version) => {
        const id = row(this.database.prepare(
          `SELECT id FROM letter_of_claim_versions WHERE firm_id = ? AND matter_id = ? AND idempotency_key = ?`,
        ).get(user.firmId, matterId, input.idempotencyKey));
        return version.id === String(id?.id);
      })!;
    }
    const letter = this.getLetter(user.firmId, matterId);
    if (letter.version !== input.expectedVersion) throw new ProtocolStoreError('CONFLICT', 'The Letter of Claim changed before approval.');
    if (letter.state !== 'ready_for_review') throw new ProtocolStoreError('APPROVAL_BLOCKED', 'The Letter of Claim is not ready for review.');
    if (letter.source.blockers.length > 0) throw new ProtocolStoreError('APPROVAL_BLOCKED', 'The Letter of Claim has unresolved blockers.');

    const occurredAt = this.now().toISOString();
    const caseRecord = this.getCase(user.firmId, matterId);
    const version = this.listLetterVersions(user.firmId, matterId).length + 1;
    const documentId = randomUUID();
    const documentVersionId = randomUUID();
    const letterVersionId = randomUUID();
    transaction(this.database, () => {
      this.database.prepare(
        `INSERT INTO documents (id, firm_id, matter_id, title, category, created_by, created_at)
         VALUES (?, ?, ?, ?, 'Protocol', ?, ?)`,
      ).run(documentId, user.firmId, matterId, `Letter of Claim v${version}`, user.id, occurredAt);
      this.database.prepare(
        `INSERT INTO document_versions (
          id, firm_id, document_id, version, original_name, mime_type,
          size_bytes, sha256, storage_key, uploaded_by, created_at
        ) VALUES (?, ?, ?, 1, ?, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ?, ?, ?, ?, ?)`,
      ).run(documentVersionId, user.firmId, documentId, `letter-of-claim-v${version}.docx`,
        generated.sizeBytes, generated.sha256, generated.storageKey, user.id, occurredAt);
      this.database.prepare(
        `INSERT INTO letter_of_claim_versions (
          id, firm_id, matter_id, protocol_case_id, letter_id, version,
          content_json, source_manifest_json, template_key, renderer_version,
          content_sha256, document_id, document_version_id, idempotency_key,
          command_payload_json, approved_by, approved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'housing-conditions-letter-of-claim', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(letterVersionId, user.firmId, matterId, caseRecord.id, letter.id, version,
        canonicalJson(letter.source.model), canonicalJson(letter.source.manifest), rendererVersion,
        createHash('sha256').update(canonicalJson(letter.source.model)).digest('hex'),
        documentId, documentVersionId, input.idempotencyKey, payloadJson, user.id, occurredAt);
      this.database.prepare(
        `UPDATE letters_of_claim SET state = 'approved', reviewer_user_id = ?, updated_at = ?
         WHERE id = ? AND firm_id = ? AND matter_id = ?`,
      ).run(user.id, occurredAt, letter.id, user.firmId, matterId);
      this.database.prepare(
        `UPDATE protocol_cases SET version = version + 1, protocol_status = 'approved',
          updated_by = ?, updated_at = ? WHERE id = ? AND firm_id = ? AND matter_id = ?`,
      ).run(user.id, occurredAt, caseRecord.id, user.firmId, matterId);
      appendTimeline(this.database, {
        firmId: user.firmId, matterId, type: 'protocol.letter.approved',
        title: `Letter of Claim v${version} approved`, actorUserId: user.id, occurredAt,
        metadata: { letterVersionId, documentVersionId, sha256: generated.sha256 },
      });
      appendAudit(this.database, {
        firmId: user.firmId, matterId, userId: user.id, action: 'protocol.letter.approved',
        entityType: 'letter_of_claim_version', entityId: letterVersionId,
        after: { version, documentVersionId, sha256: generated.sha256 },
        createdAt: occurredAt, requestId: audit.requestId, ipAddress: audit.ipAddress,
      });
    });
    return this.listLetterVersions(user.firmId, matterId).find(({ id }) => id === letterVersionId)!;
  }

  recordServiceEvent(user: SessionUser, matterId: string, input: RecordProtocolServiceEventInput, audit: AuditContext): ProtocolServiceEventRecord {
    const payloadJson = canonicalJson(input);
    const existing = row(this.database.prepare(
      `SELECT id, command_payload_json AS payload FROM protocol_service_events
       WHERE firm_id = ? AND matter_id = ? AND idempotency_key = ?`,
    ).get(user.firmId, matterId, input.idempotencyKey));
    if (existing) {
      if (String(existing.payload) !== payloadJson) throw new ProtocolStoreError('IDEMPOTENCY_KEY_REUSED', 'The idempotency key has already been used with different data.');
      return this.listServiceEvents(user.firmId, matterId).find(({ id }) => id === String(existing.id))!;
    }
    const caseRecord = this.getCase(user.firmId, matterId);
    const letterVersion = row(this.database.prepare(
      'SELECT id FROM letter_of_claim_versions WHERE id = ? AND firm_id = ? AND matter_id = ?',
    ).get(input.letterVersionId, user.firmId, matterId));
    if (!letterVersion) throw new ProtocolStoreError('PROTOCOL_INVALID', 'The approved Letter of Claim version was not found.');
    if (['actual_receipt', 'deemed_receipt'].includes(input.eventType)) {
      const dispatch = this.database.prepare(
        `SELECT 1 FROM protocol_service_events WHERE firm_id = ? AND matter_id = ?
          AND letter_version_id = ? AND event_type = 'dispatched'`,
      ).get(user.firmId, matterId, input.letterVersionId);
      if (!dispatch) throw new ProtocolStoreError('TRIGGER_BLOCKED', 'Receipt cannot be confirmed before dispatch.');
    }
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    transaction(this.database, () => {
      let supportingDocumentId: string | null = null;
      if (input.supportingDocumentVersionId) {
        const document = row(this.database.prepare(
          `SELECT d.id FROM documents d JOIN document_versions dv
            ON dv.document_id = d.id AND dv.firm_id = d.firm_id
           WHERE d.firm_id = ? AND d.matter_id = ? AND dv.id = ?`,
        ).get(user.firmId, matterId, input.supportingDocumentVersionId));
        if (!document) throw new ProtocolStoreError('PROTOCOL_INVALID', 'The supporting document version was not found.');
        supportingDocumentId = String(document.id);
      }
      this.database.prepare(
        `INSERT INTO protocol_service_events (
          id, firm_id, matter_id, letter_version_id, event_type, method,
          occurred_at, legal_trigger_on, recipient, destination, source_detail,
          supporting_document_id, supporting_document_version_id,
          supersedes_event_id, correction_reason, idempotency_key,
          command_payload_json, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, user.firmId, matterId, input.letterVersionId, input.eventType, input.method,
        input.occurredAt, input.legalTriggerOn, input.recipient, input.destination,
        input.sourceDetail, supportingDocumentId, input.supportingDocumentVersionId,
        input.supersedesEventId, input.correctionReason, input.idempotencyKey,
        payloadJson, user.id, createdAt);
      const status = input.eventType === 'dispatched' ? 'issued'
        : ['actual_receipt', 'deemed_receipt'].includes(input.eventType) ? 'awaiting_response'
          : caseRecord.protocolStatus;
      this.database.prepare(
        `UPDATE protocol_cases SET version = version + 1, protocol_status = ?,
          updated_by = ?, updated_at = ? WHERE id = ? AND firm_id = ? AND matter_id = ?`,
      ).run(status, user.id, createdAt, caseRecord.id, user.firmId, matterId);
      appendTimeline(this.database, {
        firmId: user.firmId, matterId, type: `protocol.service.${input.eventType}`,
        title: input.eventType === 'dispatched' ? 'Letter of Claim dispatched' : 'Letter of Claim service updated',
        detail: input.sourceDetail, actorUserId: user.id, occurredAt: input.occurredAt,
        metadata: { eventId: id, legalTriggerOn: input.legalTriggerOn },
      });
      appendAudit(this.database, {
        firmId: user.firmId, matterId, userId: user.id, action: `protocol.service.${input.eventType}`,
        entityType: 'protocol_service_event', entityId: id, after: input,
        createdAt, requestId: audit.requestId, ipAddress: audit.ipAddress,
      });
      if (['actual_receipt', 'deemed_receipt'].includes(input.eventType)) {
        this.workflowStore.recordTriggerAndDeadlineInTransaction({
          firmId: user.firmId, matterId, actorUserId: user.id,
          triggerEventType: 'letter_of_claim.received',
          triggerDate: input.legalTriggerOn!,
          idempotencyKey: `protocol-receipt:${input.idempotencyKey}`,
          auditContext: audit,
        });
      }
    });
    return this.listServiceEvents(user.firmId, matterId).find((event) => event.id === id)!;
  }

  recordLandlordResponse(user: SessionUser, matterId: string, input: RecordLandlordResponseInput, audit: AuditContext): LandlordResponseRecord {
    const payloadJson = canonicalJson(input);
    const existing = row(this.database.prepare(
      `SELECT id, command_payload_json AS payload FROM landlord_responses
       WHERE firm_id = ? AND matter_id = ? AND idempotency_key = ?`,
    ).get(user.firmId, matterId, input.idempotencyKey));
    if (existing) {
      if (String(existing.payload) !== payloadJson) throw new ProtocolStoreError('IDEMPOTENCY_KEY_REUSED', 'The idempotency key has already been used with different data.');
      return this.listResponses(user.firmId, matterId).find(({ id }) => id === String(existing.id))!;
    }
    if (input.responseType === 'no_response_recorded') {
      const overdueDeadline = this.database.prepare(
        `SELECT md.id FROM matter_deadlines md
         JOIN deadline_rules dr ON dr.id = md.deadline_rule_id
         WHERE md.firm_id = ? AND md.matter_id = ?
           AND dr.key = 'housing.protocol.landlord_response'
           AND md.due_date < ?
           AND COALESCE((
             SELECT dse.status FROM deadline_status_events dse
             WHERE dse.firm_id = md.firm_id AND dse.deadline_id = md.id
             ORDER BY dse.occurred_at DESC, dse.rowid DESC LIMIT 1
           ), md.initial_status) = 'pending'
         ORDER BY md.due_date DESC LIMIT 1`,
      ).get(user.firmId, matterId, this.now().toISOString().slice(0, 10));
      if (!overdueDeadline) {
        throw new ProtocolStoreError(
          'TRIGGER_BLOCKED',
          'No response can be recorded only after the current landlord response deadline is overdue.',
        );
      }
    }
    const caseRecord = this.getCase(user.firmId, matterId);
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    transaction(this.database, () => {
      let sourceDocumentId: string | null = null;
      if (input.sourceDocumentVersionId) {
        const document = row(this.database.prepare(
          `SELECT d.id FROM documents d JOIN document_versions dv
            ON dv.document_id = d.id AND dv.firm_id = d.firm_id
           WHERE d.firm_id = ? AND d.matter_id = ? AND dv.id = ?`,
        ).get(user.firmId, matterId, input.sourceDocumentVersionId));
        if (!document) throw new ProtocolStoreError('PROTOCOL_INVALID', 'The response document version was not found.');
        sourceDocumentId = String(document.id);
      }
      this.database.prepare(
        `INSERT INTO landlord_responses (
          id, firm_id, matter_id, protocol_case_id, response_type, received_on,
          responding_party, contact_name, general_liability_position,
          liability_reasons, notice_position, access_position, disclosure_status,
          disclosure_summary, expert_proposal_position, expert_proposal_summary,
          works_schedule, works_start_on, works_complete_on,
          compensation_offer_minor, costs_offer_minor, currency,
          source_document_id, source_document_version_id, supersedes_response_id,
          correction_reason, idempotency_key, command_payload_json, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, user.firmId, matterId, caseRecord.id, input.responseType, input.receivedOn,
        input.respondingParty, input.contactName, input.generalLiabilityPosition,
        input.liabilityReasons, input.noticePosition, input.accessPosition,
        input.disclosureStatus, input.disclosureSummary, input.expertProposalPosition,
        input.expertProposalSummary, input.worksSchedule, input.worksStartOn,
        input.worksCompleteOn, input.compensationOfferMinor, input.costsOfferMinor,
        input.currency, sourceDocumentId, input.sourceDocumentVersionId,
        input.supersedesResponseId, input.correctionReason, input.idempotencyKey,
        payloadJson, user.id, createdAt);
      const insertPosition = this.database.prepare(
        `INSERT INTO landlord_response_defects (
          id, firm_id, matter_id, response_id, defect_id, position, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const position of input.defectPositions) {
        insertPosition.run(randomUUID(), user.firmId, matterId, id, position.defectId,
          position.position, position.reason, createdAt);
      }
      this.database.prepare(
        `UPDATE protocol_cases SET version = version + 1, protocol_status = 'response_received',
          updated_by = ?, updated_at = ? WHERE id = ? AND firm_id = ? AND matter_id = ?`,
      ).run(user.id, createdAt, caseRecord.id, user.firmId, matterId);
      appendTimeline(this.database, {
        firmId: user.firmId, matterId, type: 'protocol.landlord_response.recorded',
        title: input.responseType === 'no_response_recorded' ? 'No landlord response recorded' : 'Landlord response recorded',
        actorUserId: user.id, occurredAt: input.receivedOn ? `${input.receivedOn}T12:00:00.000Z` : createdAt,
        metadata: { responseId: id, responseType: input.responseType },
      });
      appendAudit(this.database, {
        firmId: user.firmId, matterId, userId: user.id,
        action: 'protocol.landlord_response.recorded', entityType: 'landlord_response',
        entityId: id, after: input, createdAt, requestId: audit.requestId, ipAddress: audit.ipAddress,
      });
      if (input.responseType !== 'no_response_recorded') {
        this.workflowStore.recordTriggerAndDeadlineInTransaction({
          firmId: user.firmId, matterId, actorUserId: user.id,
          triggerEventType: 'landlord_response.received',
          triggerDate: input.receivedOn!,
          idempotencyKey: `protocol-response:${input.idempotencyKey}`,
          auditContext: audit,
        });
      }
    });
    return this.listResponses(user.firmId, matterId).find((response) => response.id === id)!;
  }

  selectExpertRoute(
    user: SessionUser,
    matterId: string,
    input: SelectExpertRouteInput,
    audit: AuditContext,
  ): ProtocolCaseRecord {
    const occurredAt = this.now().toISOString();
    const current = this.getCase(user.firmId, matterId);
    transaction(this.database, () => {
      const result = this.database.prepare(
        `UPDATE protocol_cases SET version = version + 1, expert_route = ?,
          expert_route_reason = ?, urgent_reason = ?, updated_by = ?, updated_at = ?
         WHERE id = ? AND firm_id = ? AND matter_id = ? AND version = ?`,
      ).run(input.route, input.reason, input.urgentReason, user.id, occurredAt,
        current.id, user.firmId, matterId, input.expectedVersion);
      if (result.changes !== 1) throw new ProtocolStoreError('CONFLICT', 'The protocol case changed before the expert route was saved.');
      appendTimeline(this.database, {
        firmId: user.firmId, matterId, type: 'protocol.expert_route.selected',
        title: `Expert route selected: ${input.route.replaceAll('_', ' ')}`,
        detail: input.reason, actorUserId: user.id, occurredAt,
      });
      appendAudit(this.database, {
        firmId: user.firmId, matterId, userId: user.id, action: 'protocol.expert_route.selected',
        entityType: 'protocol_case', entityId: current.id, before: current,
        after: input, createdAt: occurredAt, requestId: audit.requestId, ipAddress: audit.ipAddress,
      });
    });
    return this.getCase(user.firmId, matterId);
  }

  createExpertEngagement(
    user: SessionUser,
    matterId: string,
    input: CreateExpertEngagementInput,
    audit: AuditContext,
  ): ExpertEngagementRecord {
    const caseRecord = this.getCase(user.firmId, matterId);
    if (caseRecord.expertRoute !== input.route) {
      throw new ProtocolStoreError('PROTOCOL_INVALID', 'The engagement route must match the selected protocol route.');
    }
    if (input.verificationStatus === 'user_verified' && (!input.verificationMethod || !input.verifiedOn)) {
      throw new ProtocolStoreError('PROTOCOL_INVALID', 'User verification requires a method and date.');
    }
    const id = randomUUID();
    const occurredAt = this.now().toISOString();
    const state = input.termsStatus === 'accepted' ? 'checks_pending' : 'terms_pending';
    transaction(this.database, () => {
      this.database.prepare(
        `INSERT INTO expert_engagements (
          id, firm_id, matter_id, protocol_case_id, route, expert_role,
          expert_name, organisation, email, phone, expertise, qualifications,
          registration_body, registration_reference, verification_status,
          verification_method, verified_on, proposed_by, single_joint,
          terms_status, fee_basis, fee_minor, currency, payer_split_json,
          availability_summary, target_report_on, state,
          created_by, created_at, updated_by, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, user.firmId, matterId, caseRecord.id, input.route, input.expertRole,
        input.expertName, input.organisation, input.email, input.phone, input.expertise,
        input.qualifications, input.registrationBody, input.registrationReference,
        input.verificationStatus, input.verificationMethod, input.verifiedOn,
        input.proposedBy, input.singleJoint ? 1 : 0, input.termsStatus,
        input.feeBasis, input.feeMinor, input.currency, canonicalJson(input.payerSplit),
        input.availabilitySummary, input.targetReportOn, state,
        user.id, occurredAt, user.id, occurredAt);
      appendTimeline(this.database, {
        firmId: user.firmId, matterId, type: 'protocol.expert.created',
        title: `Expert candidate added: ${input.expertName}`,
        detail: input.expertise, actorUserId: user.id, occurredAt,
      });
      appendAudit(this.database, {
        firmId: user.firmId, matterId, userId: user.id, action: 'protocol.expert.created',
        entityType: 'expert_engagement', entityId: id, after: input,
        createdAt: occurredAt, requestId: audit.requestId, ipAddress: audit.ipAddress,
      });
    });
    return this.listExperts(user.firmId, matterId).find((expert) => expert.id === id)!;
  }

  updateExpertEngagement(
    user: SessionUser,
    matterId: string,
    engagementId: string,
    input: UpdateExpertEngagementInput,
    audit: AuditContext,
  ): ExpertEngagementRecord {
    const current = this.listExperts(user.firmId, matterId).find(({ id }) => id === engagementId);
    if (!current) throw new ProtocolStoreError('NOT_FOUND', 'The expert engagement was not found.');
    const changes = input as { expectedVersion: number } & Partial<CreateExpertEngagementInput>;
    const next = { ...current, ...changes };
    if (next.verificationStatus === 'user_verified' && (!next.verificationMethod || !next.verifiedOn)) {
      throw new ProtocolStoreError('PROTOCOL_INVALID', 'User verification requires a method and date.');
    }
    const occurredAt = this.now().toISOString();
    transaction(this.database, () => {
      const result = this.database.prepare(
        `UPDATE expert_engagements SET version = version + 1, route = ?,
          expert_role = ?, expert_name = ?, organisation = ?, email = ?, phone = ?,
          expertise = ?, qualifications = ?, registration_body = ?,
          registration_reference = ?, verification_status = ?, verification_method = ?,
          verified_on = ?, proposed_by = ?, single_joint = ?, terms_status = ?,
          fee_basis = ?, fee_minor = ?, currency = ?, payer_split_json = ?,
          availability_summary = ?, target_report_on = ?, updated_by = ?, updated_at = ?
         WHERE id = ? AND firm_id = ? AND matter_id = ? AND version = ?`,
      ).run(next.route, next.expertRole, next.expertName, next.organisation,
        next.email, next.phone, next.expertise, next.qualifications,
        next.registrationBody, next.registrationReference, next.verificationStatus,
        next.verificationMethod, next.verifiedOn, next.proposedBy,
        next.singleJoint ? 1 : 0, next.termsStatus, next.feeBasis, next.feeMinor,
        next.currency, canonicalJson(next.payerSplit), next.availabilitySummary,
        next.targetReportOn, user.id, occurredAt, engagementId, user.firmId,
        matterId, changes.expectedVersion);
      if (result.changes !== 1) throw new ProtocolStoreError('CONFLICT', 'The expert engagement changed before it was saved.');
      appendTimeline(this.database, {
        firmId: user.firmId, matterId, type: 'protocol.expert.updated',
        title: `Expert engagement updated: ${next.expertName}`,
        actorUserId: user.id, occurredAt,
      });
      appendAudit(this.database, {
        firmId: user.firmId, matterId, userId: user.id, action: 'protocol.expert.updated',
        entityType: 'expert_engagement', entityId: engagementId,
        before: current, after: input, createdAt: occurredAt,
        requestId: audit.requestId, ipAddress: audit.ipAddress,
      });
    });
    return this.listExperts(user.firmId, matterId).find(({ id }) => id === engagementId)!;
  }

  recordExpertConflictCheck(
    user: SessionUser,
    matterId: string,
    engagementId: string,
    input: RecordExpertConflictCheckInput,
    audit: AuditContext,
  ): ExpertConflictCheckRecord {
    const payloadJson = canonicalJson(input);
    const existing = row(this.database.prepare(
      `SELECT id, command_payload_json AS payload FROM expert_conflict_checks
       WHERE firm_id = ? AND matter_id = ? AND idempotency_key = ?`,
    ).get(user.firmId, matterId, input.idempotencyKey));
    if (existing) {
      if (String(existing.payload) !== payloadJson) throw new ProtocolStoreError('IDEMPOTENCY_KEY_REUSED', 'The idempotency key has already been used with different data.');
      return this.listExperts(user.firmId, matterId).flatMap(({ conflictChecks }) => conflictChecks)
        .find(({ id }) => id === String(existing.id))!;
    }
    const engagement = this.listExperts(user.firmId, matterId).find(({ id }) => id === engagementId);
    if (!engagement) throw new ProtocolStoreError('NOT_FOUND', 'The expert engagement was not found.');
    const id = randomUUID();
    const occurredAt = this.now().toISOString();
    transaction(this.database, () => {
      this.database.prepare(
        `INSERT INTO expert_conflict_checks (
          id, firm_id, matter_id, engagement_id, parties_checked_json,
          method, search_detail, outcome, decision, reason, idempotency_key,
          command_payload_json, checked_by, checked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, user.firmId, matterId, engagementId, canonicalJson(input.partiesChecked),
        input.method, input.searchDetail, input.outcome, input.decision, input.reason,
        input.idempotencyKey, payloadJson, user.id, occurredAt);
      const nextState = input.decision === 'do_not_proceed'
        ? 'cancelled'
        : engagement.termsStatus === 'accepted' ? 'approved' : 'terms_pending';
      this.database.prepare(
        `UPDATE expert_engagements SET state = ?, updated_by = ?, updated_at = ?
         WHERE id = ? AND firm_id = ? AND matter_id = ?`,
      ).run(nextState, user.id, occurredAt, engagementId, user.firmId, matterId);
      appendTimeline(this.database, {
        firmId: user.firmId, matterId, type: 'protocol.expert.conflict_checked',
        title: `Expert conflict result: ${input.outcome}`,
        detail: input.reason, actorUserId: user.id, occurredAt,
      });
      appendAudit(this.database, {
        firmId: user.firmId, matterId, userId: user.id, action: 'protocol.expert.conflict_checked',
        entityType: 'expert_conflict_check', entityId: id, after: input,
        createdAt: occurredAt, requestId: audit.requestId, ipAddress: audit.ipAddress,
      });
    });
    return this.listExperts(user.firmId, matterId).flatMap(({ conflictChecks }) => conflictChecks)
      .find((check) => check.id === id)!;
  }

  assembleExpertInstruction(
    user: SessionUser,
    matterId: string,
    engagementId: string,
    input: ApproveExpertInstructionInput,
  ): ExpertInstructionAssembly {
    const engagement = this.listExperts(user.firmId, matterId).find(({ id }) => id === engagementId);
    if (!engagement) throw new ProtocolStoreError('NOT_FOUND', 'The expert engagement was not found.');
    if (engagement.version !== input.expectedVersion) throw new ProtocolStoreError('CONFLICT', 'The expert engagement changed before approval.');
    const source = row(this.database.prepare(
      `SELECT m.reference, c.display_name AS claimantName, o.name AS landlordName,
        p.address_line_1 AS addressLine1, p.address_line_2 AS addressLine2,
        p.city, p.county, p.postcode
      FROM matters m JOIN housing_cases hc ON hc.firm_id = m.firm_id AND hc.matter_id = m.id
      JOIN contacts c ON c.id = hc.claimant_contact_id AND c.firm_id = hc.firm_id
      JOIN organisations o ON o.id = hc.landlord_organisation_id AND o.firm_id = hc.firm_id
      JOIN properties p ON p.id = hc.property_id AND p.firm_id = hc.firm_id
      WHERE m.firm_id = ? AND m.id = ?`,
    ).get(user.firmId, matterId));
    if (!source) throw new ProtocolStoreError('PROTOCOL_INVALID', 'The housing case sources are incomplete.');
    const latestConflict = engagement.conflictChecks.at(-1) ?? null;
    const materials = rows(this.database.prepare(
      `SELECT dv.id AS documentVersionId, d.title, dv.version, dv.sha256
       FROM evidence_items ei
       JOIN document_versions dv ON dv.id = ei.document_version_id AND dv.firm_id = ei.firm_id
       JOIN documents d ON d.id = dv.document_id AND d.firm_id = dv.firm_id
       WHERE ei.firm_id = ? AND ei.matter_id = ?`,
    ).all(user.firmId, matterId)).map((item) => ({
      documentVersionId: String(item.documentVersionId), title: String(item.title),
      version: Number(item.version), sha256: String(item.sha256),
    }));
    return assembleExpertInstruction({
      matterReference: String(source.reference), claimantName: String(source.claimantName),
      landlordName: String(source.landlordName),
      propertyAddress: [source.addressLine1, source.addressLine2, source.city, source.county, source.postcode]
        .filter(Boolean).map(String).join(', '),
      engagement: {
        id: engagement.id, version: engagement.version, route: engagement.route,
        expertName: engagement.expertName, organisation: engagement.organisation,
        expertRole: engagement.expertRole, termsStatus: engagement.termsStatus,
        feeMinor: engagement.feeMinor, currency: engagement.currency,
        payerSplit: engagement.payerSplit, availabilitySummary: engagement.availabilitySummary,
        conflictOutcome: latestConflict?.outcome ?? null,
        conflictDecision: latestConflict?.decision ?? null,
      },
      instruction: {
        issues: input.issues, questions: input.questions, accessDetail: input.accessDetail,
        urgentWorksRequested: input.urgentWorksRequested,
        scheduleOfWorksRequested: input.scheduleOfWorksRequested,
        costEstimateRequested: input.costEstimateRequested, reportDueOn: input.reportDueOn,
      },
      materialSources: materials,
      assembledAt: this.now().toISOString(),
    });
  }

  persistExpertInstruction(
    user: SessionUser,
    matterId: string,
    engagementId: string,
    input: ApproveExpertInstructionInput,
    assembly: ExpertInstructionAssembly,
    generated: { storageKey: string; sizeBytes: number; sha256: string },
    rendererVersion: string,
    audit: AuditContext,
  ): ExpertInstructionVersionRecord {
    const payloadJson = canonicalJson(input);
    const existing = row(this.database.prepare(
      `SELECT id, command_payload_json AS payload FROM expert_instruction_versions
       WHERE firm_id = ? AND matter_id = ? AND idempotency_key = ?`,
    ).get(user.firmId, matterId, input.idempotencyKey));
    if (existing) {
      if (String(existing.payload) !== payloadJson) throw new ProtocolStoreError('IDEMPOTENCY_KEY_REUSED', 'The idempotency key has already been used with different data.');
      return this.listExperts(user.firmId, matterId).flatMap(({ instructionVersions }) => instructionVersions)
        .find(({ id }) => id === String(existing.id))!;
    }
    const engagement = this.listExperts(user.firmId, matterId).find(({ id }) => id === engagementId);
    if (!engagement) throw new ProtocolStoreError('NOT_FOUND', 'The expert engagement was not found.');
    if (engagement.version !== input.expectedVersion) throw new ProtocolStoreError('CONFLICT', 'The expert engagement changed before approval.');
    if (assembly.blockers.length > 0) throw new ProtocolStoreError('APPROVAL_BLOCKED', 'The expert instruction has unresolved blockers.');
    const id = randomUUID();
    const documentId = randomUUID();
    const documentVersionId = randomUUID();
    const version = engagement.instructionVersions.length + 1;
    const occurredAt = this.now().toISOString();
    transaction(this.database, () => {
      this.database.prepare(
        `INSERT INTO documents (id, firm_id, matter_id, title, category, created_by, created_at)
         VALUES (?, ?, ?, ?, 'Expert evidence', ?, ?)`,
      ).run(documentId, user.firmId, matterId, `Expert instruction: ${engagement.expertName}`, user.id, occurredAt);
      this.database.prepare(
        `INSERT INTO document_versions (
          id, firm_id, document_id, version, original_name, mime_type,
          size_bytes, sha256, storage_key, uploaded_by, created_at
        ) VALUES (?, ?, ?, 1, ?, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ?, ?, ?, ?, ?)`,
      ).run(documentVersionId, user.firmId, documentId, `expert-instruction-v${version}.docx`,
        generated.sizeBytes, generated.sha256, generated.storageKey, user.id, occurredAt);
      this.database.prepare(
        `INSERT INTO expert_instruction_versions (
          id, firm_id, matter_id, engagement_id, version, content_json,
          source_manifest_json, template_key, renderer_version, content_sha256,
          document_id, document_version_id, idempotency_key, command_payload_json,
          approved_by, approved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'housing-expert-instruction', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, user.firmId, matterId, engagementId, version,
        canonicalJson(assembly.model), canonicalJson(assembly.manifest), rendererVersion,
        createHash('sha256').update(canonicalJson(assembly.model)).digest('hex'),
        documentId, documentVersionId, input.idempotencyKey, payloadJson, user.id, occurredAt);
      this.database.prepare(
        `UPDATE expert_engagements SET version = version + 1, state = 'instructed',
          updated_by = ?, updated_at = ? WHERE id = ? AND firm_id = ? AND matter_id = ?`,
      ).run(user.id, occurredAt, engagementId, user.firmId, matterId);
      this.database.prepare(
        `UPDATE protocol_cases SET version = version + 1, protocol_status = 'expert_work',
          updated_by = ?, updated_at = ? WHERE firm_id = ? AND matter_id = ?`,
      ).run(user.id, occurredAt, user.firmId, matterId);
      appendTimeline(this.database, {
        firmId: user.firmId, matterId, type: 'protocol.expert.instruction.approved',
        title: `Expert instruction v${version} approved`,
        detail: engagement.expertName, actorUserId: user.id, occurredAt,
        metadata: { engagementId, instructionVersionId: id, documentVersionId },
      });
      appendAudit(this.database, {
        firmId: user.firmId, matterId, userId: user.id,
        action: 'protocol.expert.instruction.approved', entityType: 'expert_instruction_version',
        entityId: id, after: { version, documentVersionId, sha256: generated.sha256 },
        createdAt: occurredAt, requestId: audit.requestId, ipAddress: audit.ipAddress,
      });
    });
    return this.listExperts(user.firmId, matterId).flatMap(({ instructionVersions }) => instructionVersions)
      .find((instruction) => instruction.id === id)!;
  }

  recordExpertMilestone(
    user: SessionUser,
    matterId: string,
    engagementId: string,
    input: RecordExpertMilestoneInput,
    audit: AuditContext,
  ): ExpertMilestoneRecord {
    const payloadJson = canonicalJson(input);
    const existing = row(this.database.prepare(
      `SELECT id, command_payload_json AS payload FROM expert_milestone_events
       WHERE firm_id = ? AND matter_id = ? AND idempotency_key = ?`,
    ).get(user.firmId, matterId, input.idempotencyKey));
    if (existing) {
      if (String(existing.payload) !== payloadJson) throw new ProtocolStoreError('IDEMPOTENCY_KEY_REUSED', 'The idempotency key has already been used with different data.');
      return this.listExperts(user.firmId, matterId).flatMap(({ milestones }) => milestones)
        .find(({ id }) => id === String(existing.id))!;
    }
    const engagement = this.listExperts(user.firmId, matterId).find(({ id }) => id === engagementId);
    if (!engagement) throw new ProtocolStoreError('NOT_FOUND', 'The expert engagement was not found.');
    if (input.instructionVersionId && !engagement.instructionVersions.some(({ id }) => id === input.instructionVersionId)) {
      throw new ProtocolStoreError('PROTOCOL_INVALID', 'The instruction version does not belong to this engagement.');
    }
    if (['inspection_completed', 'inspection_failed', 'inspection_cancelled'].includes(input.eventType)) {
      const latestInspection = [...engagement.milestones].reverse().find(({ eventType }) => eventType.startsWith('inspection_'));
      if (!latestInspection || !['inspection_booked', 'inspection_rescheduled'].includes(latestInspection.eventType)) {
        throw new ProtocolStoreError('TRIGGER_BLOCKED', 'A booked inspection is required before recording this outcome.');
      }
    }
    let supportingDocumentId: string | null = null;
    if (input.supportingDocumentVersionId) {
      const document = row(this.database.prepare(
        `SELECT d.id FROM documents d JOIN document_versions dv
          ON dv.document_id = d.id AND dv.firm_id = d.firm_id
         WHERE d.firm_id = ? AND d.matter_id = ? AND dv.id = ?`,
      ).get(user.firmId, matterId, input.supportingDocumentVersionId));
      if (!document) throw new ProtocolStoreError('PROTOCOL_INVALID', 'The supporting document version was not found.');
      supportingDocumentId = String(document.id);
    }
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    transaction(this.database, () => {
      this.database.prepare(
        `INSERT INTO expert_milestone_events (
          id, firm_id, matter_id, engagement_id, instruction_version_id,
          event_type, occurred_at, legal_trigger_on, detail,
          supporting_document_id, supporting_document_version_id,
          supersedes_event_id, correction_reason, idempotency_key,
          command_payload_json, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, user.firmId, matterId, engagementId, input.instructionVersionId,
        input.eventType, input.occurredAt, input.legalTriggerOn, input.detail,
        supportingDocumentId, input.supportingDocumentVersionId,
        input.supersedesEventId, input.correctionReason, input.idempotencyKey,
        payloadJson, user.id, createdAt);
      const state = input.eventType === 'inspection_booked' || input.eventType === 'inspection_rescheduled'
        ? 'inspection_booked'
        : input.eventType === 'inspection_completed' ? 'report_due'
          : input.eventType === 'report_reviewed' ? 'reviewed'
            : input.eventType === 'engagement_cancelled' ? 'cancelled' : engagement.state;
      this.database.prepare(
        `UPDATE expert_engagements SET state = ?, updated_by = ?, updated_at = ?
         WHERE id = ? AND firm_id = ? AND matter_id = ?`,
      ).run(state, user.id, createdAt, engagementId, user.firmId, matterId);
      appendTimeline(this.database, {
        firmId: user.firmId, matterId, type: `protocol.expert.${input.eventType}`,
        title: input.eventType.replaceAll('_', ' '), detail: input.detail,
        actorUserId: user.id, occurredAt: input.occurredAt,
        metadata: { engagementId, milestoneId: id, legalTriggerOn: input.legalTriggerOn },
      });
      appendAudit(this.database, {
        firmId: user.firmId, matterId, userId: user.id,
        action: `protocol.expert.${input.eventType}`, entityType: 'expert_milestone_event',
        entityId: id, after: input, createdAt, requestId: audit.requestId, ipAddress: audit.ipAddress,
      });
      if (input.eventType === 'inspection_completed') {
        this.workflowStore.recordTriggerAndDeadlineInTransaction({
          firmId: user.firmId, matterId, actorUserId: user.id,
          triggerEventType: 'expert.inspection.completed',
          triggerDate: input.legalTriggerOn ?? input.occurredAt.slice(0, 10),
          idempotencyKey: `expert-inspection:${input.idempotencyKey}`,
          auditContext: audit,
        });
      }
    });
    return this.listExperts(user.firmId, matterId).flatMap(({ milestones }) => milestones)
      .find((milestone) => milestone.id === id)!;
  }

  recordExpertReport(
    user: SessionUser,
    matterId: string,
    engagementId: string,
    input: RecordExpertReportInput,
    audit: AuditContext,
  ): ExpertReportRecord {
    const payloadJson = canonicalJson(input);
    const existing = row(this.database.prepare(
      `SELECT id, command_payload_json AS payload FROM expert_report_records
       WHERE firm_id = ? AND matter_id = ? AND idempotency_key = ?`,
    ).get(user.firmId, matterId, input.idempotencyKey));
    if (existing) {
      if (String(existing.payload) !== payloadJson) throw new ProtocolStoreError('IDEMPOTENCY_KEY_REUSED', 'The idempotency key has already been used with different data.');
      return this.listExperts(user.firmId, matterId).flatMap(({ reports }) => reports)
        .find(({ id }) => id === String(existing.id))!;
    }
    const engagement = this.listExperts(user.firmId, matterId).find(({ id }) => id === engagementId);
    if (!engagement) throw new ProtocolStoreError('NOT_FOUND', 'The expert engagement was not found.');
    const document = row(this.database.prepare(
      `SELECT d.id FROM documents d JOIN document_versions dv
        ON dv.document_id = d.id AND dv.firm_id = d.firm_id
       WHERE d.firm_id = ? AND d.matter_id = ? AND dv.id = ?`,
    ).get(user.firmId, matterId, input.documentVersionId));
    if (!document) throw new ProtocolStoreError('PROTOCOL_INVALID', 'The report document version was not found.');
    if (input.supersedesReportId && !engagement.reports.some(({ id }) => id === input.supersedesReportId)) {
      throw new ProtocolStoreError('PROTOCOL_INVALID', 'The superseded report does not belong to this engagement.');
    }
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    transaction(this.database, () => {
      this.database.prepare(
        `INSERT INTO expert_report_records (
          id, firm_id, matter_id, engagement_id, report_type, report_on,
          received_on, coverage_summary, urgent_works_identified,
          document_id, document_version_id, supersedes_report_id,
          idempotency_key, command_payload_json, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, user.firmId, matterId, engagementId, input.reportType,
        input.reportOn, input.receivedOn, input.coverageSummary,
        input.urgentWorksIdentified ? 1 : 0, String(document.id), input.documentVersionId,
        input.supersedesReportId, input.idempotencyKey, payloadJson, user.id, createdAt);
      this.database.prepare(
        `UPDATE expert_engagements SET state = 'report_received', updated_by = ?, updated_at = ?
         WHERE id = ? AND firm_id = ? AND matter_id = ?`,
      ).run(user.id, createdAt, engagementId, user.firmId, matterId);
      appendTimeline(this.database, {
        firmId: user.firmId, matterId, type: 'protocol.expert.report_received',
        title: 'Expert report received', detail: input.coverageSummary,
        actorUserId: user.id, occurredAt: `${input.receivedOn}T12:00:00.000Z`,
        metadata: { engagementId, reportId: id, urgentWorksIdentified: input.urgentWorksIdentified },
      });
      appendAudit(this.database, {
        firmId: user.firmId, matterId, userId: user.id,
        action: 'protocol.expert.report_received', entityType: 'expert_report',
        entityId: id, after: input, createdAt, requestId: audit.requestId, ipAddress: audit.ipAddress,
      });
      this.workflowStore.recordTriggerAndDeadlineInTransaction({
        firmId: user.firmId, matterId, actorUserId: user.id,
        triggerEventType: 'expert.report.received',
        triggerDate: input.receivedOn,
        idempotencyKey: `expert-report:${input.idempotencyKey}`,
        auditContext: audit,
      });
    });
    return this.listExperts(user.firmId, matterId).flatMap(({ reports }) => reports)
      .find((report) => report.id === id)!;
  }

  recordExpertQuestion(
    user: SessionUser,
    matterId: string,
    engagementId: string,
    input: RecordExpertQuestionInput,
    audit: AuditContext,
  ): ExpertQuestionRecord {
    const payloadJson = canonicalJson(input);
    const existing = row(this.database.prepare(
      `SELECT id, command_payload_json AS payload FROM expert_questions
       WHERE firm_id = ? AND matter_id = ? AND idempotency_key = ?`,
    ).get(user.firmId, matterId, input.idempotencyKey));
    if (existing) {
      if (String(existing.payload) !== payloadJson) throw new ProtocolStoreError('IDEMPOTENCY_KEY_REUSED', 'The idempotency key has already been used with different data.');
      return this.listExperts(user.firmId, matterId).flatMap(({ questions }) => questions)
        .find(({ id }) => id === String(existing.id))!;
    }
    const engagement = this.listExperts(user.firmId, matterId).find(({ id }) => id === engagementId);
    if (!engagement?.reports.some(({ id }) => id === input.reportId)) {
      throw new ProtocolStoreError('PROTOCOL_INVALID', 'The report does not belong to this expert engagement.');
    }
    if (input.legalBasis === 'cpr35_6' && !input.reportServedOn) {
      throw new ProtocolStoreError('TRIGGER_BLOCKED', 'Confirm the report service date before applying CPR 35.6.');
    }
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    transaction(this.database, () => {
      this.database.prepare(
        `INSERT INTO expert_questions (
          id, firm_id, matter_id, engagement_id, report_id, question,
          clarification_purpose, dispatched_on, response_due_on, legal_basis,
          idempotency_key, command_payload_json, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, user.firmId, matterId, engagementId, input.reportId, input.question,
        input.clarificationPurpose, input.dispatchedOn, input.responseDueOn,
        input.legalBasis, input.idempotencyKey, payloadJson, user.id, createdAt);
      appendTimeline(this.database, {
        firmId: user.firmId, matterId, type: 'protocol.expert.question.recorded',
        title: 'Expert clarification question recorded', detail: input.question,
        actorUserId: user.id, occurredAt: input.dispatchedOn ? `${input.dispatchedOn}T12:00:00.000Z` : createdAt,
        metadata: { engagementId, reportId: input.reportId, questionId: id },
      });
      appendAudit(this.database, {
        firmId: user.firmId, matterId, userId: user.id,
        action: 'protocol.expert.question.recorded', entityType: 'expert_question',
        entityId: id, after: input, createdAt, requestId: audit.requestId, ipAddress: audit.ipAddress,
      });
      if (input.legalBasis === 'cpr35_6') {
        this.workflowStore.recordTriggerAndDeadlineInTransaction({
          firmId: user.firmId, matterId, actorUserId: user.id,
          triggerEventType: 'expert.report.served_cpr35',
          triggerDate: input.reportServedOn!,
          idempotencyKey: `expert-cpr35:${input.idempotencyKey}`,
          auditContext: audit,
        });
      }
    });
    return this.listExperts(user.firmId, matterId).flatMap(({ questions }) => questions)
      .find((question) => question.id === id)!;
  }

  recordExpertQuestionAnswer(
    user: SessionUser,
    matterId: string,
    engagementId: string,
    questionId: string,
    input: RecordExpertQuestionAnswerInput,
    audit: AuditContext,
  ): ExpertQuestionRecord['answers'][number] {
    const payloadJson = canonicalJson(input);
    const existing = row(this.database.prepare(
      `SELECT id, command_payload_json AS payload FROM expert_question_answers
       WHERE firm_id = ? AND matter_id = ? AND idempotency_key = ?`,
    ).get(user.firmId, matterId, input.idempotencyKey));
    if (existing) {
      if (String(existing.payload) !== payloadJson) throw new ProtocolStoreError('IDEMPOTENCY_KEY_REUSED', 'The idempotency key has already been used with different data.');
      return this.listExperts(user.firmId, matterId).flatMap(({ questions }) => questions)
        .flatMap(({ answers }) => answers).find(({ id }) => id === String(existing.id))!;
    }
    const engagement = this.listExperts(user.firmId, matterId).find(({ id }) => id === engagementId);
    if (!engagement?.questions.some(({ id }) => id === questionId)) {
      throw new ProtocolStoreError('PROTOCOL_INVALID', 'The question does not belong to this expert engagement.');
    }
    const document = row(this.database.prepare(
      `SELECT d.id FROM documents d JOIN document_versions dv
        ON dv.document_id = d.id AND dv.firm_id = d.firm_id
       WHERE d.firm_id = ? AND d.matter_id = ? AND dv.id = ?`,
    ).get(user.firmId, matterId, input.documentVersionId));
    if (!document) throw new ProtocolStoreError('PROTOCOL_INVALID', 'The answer document version was not found.');
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    transaction(this.database, () => {
      this.database.prepare(
        `INSERT INTO expert_question_answers (
          id, firm_id, matter_id, engagement_id, question_id, received_on,
          summary, document_id, document_version_id, idempotency_key,
          command_payload_json, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, user.firmId, matterId, engagementId, questionId, input.receivedOn,
        input.summary, String(document.id), input.documentVersionId,
        input.idempotencyKey, payloadJson, user.id, createdAt);
      appendTimeline(this.database, {
        firmId: user.firmId, matterId, type: 'protocol.expert.answer.received',
        title: 'Expert clarification answer received', detail: input.summary,
        actorUserId: user.id, occurredAt: `${input.receivedOn}T12:00:00.000Z`,
        metadata: { engagementId, questionId, answerId: id },
      });
      appendAudit(this.database, {
        firmId: user.firmId, matterId, userId: user.id,
        action: 'protocol.expert.answer.received', entityType: 'expert_question_answer',
        entityId: id, after: input, createdAt, requestId: audit.requestId, ipAddress: audit.ipAddress,
      });
    });
    return this.listExperts(user.firmId, matterId).flatMap(({ questions }) => questions)
      .flatMap(({ answers }) => answers).find((answer) => answer.id === id)!;
  }

  getDocumentFileByVersion(firmId: string, matterId: string, versionId: string) {
    const record = row(this.database.prepare(
      `SELECT dv.storage_key AS storageKey, dv.original_name AS originalName,
        dv.mime_type AS mimeType, dv.size_bytes AS sizeBytes, dv.sha256, dv.version
      FROM documents d JOIN document_versions dv
        ON dv.document_id = d.id AND dv.firm_id = d.firm_id
      WHERE d.firm_id = ? AND d.matter_id = ? AND dv.id = ?`,
    ).get(firmId, matterId, versionId));
    return record ? {
      storageKey: String(record.storageKey), originalName: String(record.originalName),
      mimeType: String(record.mimeType), sizeBytes: Number(record.sizeBytes),
      sha256: String(record.sha256), version: Number(record.version),
    } : undefined;
  }
}
