import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
  CreateNegotiationReviewInput,
  CreateSettlementAuthorityVersionInput,
  CreateNegotiationActionInput,
  AppendNegotiationActionVersionInput,
  SubmitNegotiationActionInput,
  DecideNegotiationActionInput,
  RecordNegotiationExternalActionInput,
  CreateSettlementInput,
  AppendSettlementTermsInput,
  ConcludeSettlementInput,
  CreateSettlementObligationInput,
  RecordSettlementObligationEventInput,
  RecordClientInstructionInput,
} from '../../shared/contracts.js';
import {
  canReadAllFirmMatters,
  canWriteAllFirmMatters,
  hasCapability,
  type SessionUser,
} from '../policy.js';
import { appendAudit, appendTimeline, type AuditContext } from '../store.js';
import { projectAction, projectObligation, projectSettlement } from './projections.js';

type SqlValue = string | number | null;
type Row = Record<string, SqlValue>;

export type NegotiationStoreErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'INVALID_LINK';

export class NegotiationStoreError extends Error {
  constructor(readonly code: NegotiationStoreErrorCode, message: string) {
    super(message);
    this.name = 'NegotiationStoreError';
  }
}

function row(value: unknown): Row | undefined {
  return value as Row | undefined;
}

function rows(value: unknown): Row[] {
  return value as Row[];
}

function parseJson<T>(value: SqlValue, fallback: T): T {
  try {
    return JSON.parse(String(value ?? '')) as T;
  } catch {
    return fallback;
  }
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

function mapReview(value: Row) {
  return {
    id: String(value.id),
    reviewNumber: Number(value.reviewNumber),
    confidentiality: String(value.confidentiality),
    reviewedOn: String(value.reviewedOn),
    authorUserId: String(value.authorUserId),
    reviewerUserId: value.reviewerUserId ? String(value.reviewerUserId) : null,
    selectedOfferIds: parseJson<string[]>(value.selectedOfferIdsJson, []),
    lossScheduleId: value.lossScheduleId ? String(value.lossScheduleId) : null,
    generalDamagesReviewId: value.generalDamagesReviewId
      ? String(value.generalDamagesReviewId)
      : null,
    workScheduleId: value.workScheduleId ? String(value.workScheduleId) : null,
    confirmedFacts: String(value.confirmedFacts),
    optionsExplained: String(value.optionsExplained),
    riskAnalysis: String(value.riskAnalysis),
    costsFundingExplanation: String(value.costsFundingExplanation),
    humanRecommendation: String(value.humanRecommendation),
    adviceLimitations: String(value.adviceLimitations),
    clientQuestions: String(value.clientQuestions),
    sourceManifest: parseJson<Record<string, unknown>>(value.sourceManifestJson, {}),
    sourceManifestDigest: String(value.sourceManifestDigest),
    supersedesReviewId: value.supersedesReviewId ? String(value.supersedesReviewId) : null,
    correctionReason: String(value.correctionReason),
    createdAt: String(value.createdAt),
  };
}

function mapInstruction(value: Row) {
  return {
    id: String(value.id),
    confidentiality: String(value.confidentiality),
    reviewId: value.reviewId ? String(value.reviewId) : null,
    actionId: value.actionId ? String(value.actionId) : null,
    actionVersionId: value.actionVersionId ? String(value.actionVersionId) : null,
    actionVersion: value.actionVersion === null ? null : Number(value.actionVersion),
    settlementId: value.settlementId ? String(value.settlementId) : null,
    settlementTermsVersionId: value.settlementTermsVersionId
      ? String(value.settlementTermsVersionId)
      : null,
    settlementTermsVersion: value.settlementTermsVersion === null
      ? null
      : Number(value.settlementTermsVersion),
    instructionType: String(value.instructionType),
    instructingPerson: String(value.instructingPerson),
    relationshipToClient: String(value.relationshipToClient),
    authorityBasis: String(value.authorityBasis),
    decisionNote: String(value.decisionNote),
    receivedMethod: String(value.receivedMethod),
    receivedAt: String(value.receivedAt),
    takenBy: String(value.takenBy),
    identityStatus: String(value.identityStatus),
    identityNote: String(value.identityNote),
    understandingConfirmed: Boolean(value.understandingConfirmed),
    accessibilityMeasures: String(value.accessibilityMeasures),
    sourceCommunicationEntryId: value.sourceCommunicationEntryId
      ? String(value.sourceCommunicationEntryId)
      : null,
    sourceDocumentVersionId: value.sourceDocumentVersionId
      ? String(value.sourceDocumentVersionId)
      : null,
    supersedesInstructionId: value.supersedesInstructionId
      ? String(value.supersedesInstructionId)
      : null,
    correctionReason: String(value.correctionReason),
    createdAt: String(value.createdAt),
  };
}

function mapAuthority(value: Row) {
  return {
    id: String(value.id),
    version: Number(value.version),
    source: String(value.source),
    scope: String(value.scope),
    actionTypes: parseJson<string[]>(value.actionTypesJson, []),
    minimumAmountMinor: value.minimumAmountMinor === null
      ? null
      : Number(value.minimumAmountMinor),
    maximumAmountMinor: value.maximumAmountMinor === null
      ? null
      : Number(value.maximumAmountMinor),
    nonMoneyConstraints: String(value.nonMoneyConstraints),
    costsConstraints: String(value.costsConstraints),
    repairConstraints: String(value.repairConstraints),
    expiresAt: value.expiresAt ? String(value.expiresAt) : null,
    reviewOn: value.reviewOn ? String(value.reviewOn) : null,
    requiresClientInstruction: Boolean(value.requiresClientInstruction),
    requiresPartnerApproval: Boolean(value.requiresPartnerApproval),
    sourceDocumentVersionId: value.sourceDocumentVersionId
      ? String(value.sourceDocumentVersionId)
      : null,
    reviewNote: String(value.reviewNote),
    supersedesAuthorityId: value.supersedesAuthorityId
      ? String(value.supersedesAuthorityId)
      : null,
    createdBy: String(value.createdBy),
    createdAt: String(value.createdAt),
  };
}

function mapActionVersion(value: Row) {
  return {
    id: String(value.id),
    version: Number(value.version),
    recipients: parseJson<Array<Record<string, string>>>(value.recipientsJson, []),
    scope: String(value.scope),
    scopeDescription: String(value.scopeDescription),
    damagesMinor: value.damagesMinor === null ? null : Number(value.damagesMinor),
    costsMinor: value.costsMinor === null ? null : Number(value.costsMinor),
    totalMinor: value.totalMinor === null ? null : Number(value.totalMinor),
    currency: String(value.currency),
    worksTerms: String(value.worksTerms),
    nonMoneyTerms: String(value.nonMoneyTerms),
    interestTreatment: String(value.interestTreatment),
    confidentialityTerms: String(value.confidentialityTerms),
    paymentTerms: String(value.paymentTerms),
    proposedInstrumentType: String(value.proposedInstrumentType),
    documentVersionIds: parseJson<string[]>(value.documentVersionIdsJson, []),
    termsDigest: String(value.termsDigest),
    changeReason: String(value.changeReason),
    createdBy: String(value.createdBy),
    createdAt: String(value.createdAt),
  };
}

const reviewSelect = `SELECT id, review_number AS reviewNumber, confidentiality,
  reviewed_on AS reviewedOn, author_user_id AS authorUserId,
  reviewer_user_id AS reviewerUserId, selected_offer_ids_json AS selectedOfferIdsJson,
  loss_schedule_id AS lossScheduleId,
  general_damages_review_id AS generalDamagesReviewId,
  work_schedule_id AS workScheduleId, confirmed_facts AS confirmedFacts,
  options_explained AS optionsExplained, risk_analysis AS riskAnalysis,
  costs_funding_explanation AS costsFundingExplanation,
  human_recommendation AS humanRecommendation, advice_limitations AS adviceLimitations,
  client_questions AS clientQuestions, source_manifest_json AS sourceManifestJson,
  source_manifest_digest AS sourceManifestDigest,
  supersedes_review_id AS supersedesReviewId, correction_reason AS correctionReason,
  created_at AS createdAt FROM negotiation_reviews`;

const instructionSelect = `SELECT id, confidentiality, review_id AS reviewId,
  action_id AS actionId, action_version_id AS actionVersionId,
  action_version AS actionVersion, settlement_id AS settlementId,
  settlement_terms_version_id AS settlementTermsVersionId,
  settlement_terms_version AS settlementTermsVersion,
  instruction_type AS instructionType,
  instructing_person AS instructingPerson, relationship_to_client AS relationshipToClient,
  authority_basis AS authorityBasis, decision_note AS decisionNote,
  received_method AS receivedMethod, received_at AS receivedAt, taken_by AS takenBy,
  identity_status AS identityStatus, identity_note AS identityNote,
  understanding_confirmed AS understandingConfirmed,
  accessibility_measures AS accessibilityMeasures,
  source_communication_entry_id AS sourceCommunicationEntryId,
  source_document_version_id AS sourceDocumentVersionId,
  supersedes_instruction_id AS supersedesInstructionId,
  correction_reason AS correctionReason, created_at AS createdAt FROM client_instructions`;

const authoritySelect = `SELECT id, version, source, scope,
  action_types_json AS actionTypesJson, minimum_amount_minor AS minimumAmountMinor,
  maximum_amount_minor AS maximumAmountMinor,
  non_money_constraints AS nonMoneyConstraints, costs_constraints AS costsConstraints,
  repair_constraints AS repairConstraints, expires_at AS expiresAt, review_on AS reviewOn,
  requires_client_instruction AS requiresClientInstruction,
  requires_partner_approval AS requiresPartnerApproval,
  source_document_version_id AS sourceDocumentVersionId, review_note AS reviewNote,
  supersedes_authority_id AS supersedesAuthorityId, created_by AS createdBy,
  created_at AS createdAt FROM settlement_authority_versions`;

export class NegotiationStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date,
  ) {}

  private canReadMatter(user: SessionUser, matterId: string): boolean {
    if (!hasCapability(user, 'matter.read')) return false;
    if (canReadAllFirmMatters(user)) {
      return Boolean(this.database.prepare(
        'SELECT 1 FROM matters WHERE id = ? AND firm_id = ?',
      ).get(matterId, user.firmId));
    }
    return Boolean(this.database.prepare(
      `SELECT 1 FROM matters m WHERE m.id = ? AND m.firm_id = ? AND (
        m.owner_user_id = ? OR EXISTS (
          SELECT 1 FROM matter_members mm WHERE mm.firm_id = m.firm_id
          AND mm.matter_id = m.id AND mm.user_id = ?
        ))`,
    ).get(matterId, user.firmId, user.id, user.id));
  }

  private canWriteMatter(user: SessionUser, matterId: string): boolean {
    if (!hasCapability(user, 'matter.write')) return false;
    if (canWriteAllFirmMatters(user)) {
      return Boolean(this.database.prepare(
        'SELECT 1 FROM matters WHERE id = ? AND firm_id = ?',
      ).get(matterId, user.firmId));
    }
    return Boolean(this.database.prepare(
      `SELECT 1 FROM matters m WHERE m.id = ? AND m.firm_id = ? AND (
        m.owner_user_id = ? OR EXISTS (
          SELECT 1 FROM matter_members mm WHERE mm.firm_id = m.firm_id
          AND mm.matter_id = m.id AND mm.user_id = ? AND mm.access_level = 'write'
        ))`,
    ).get(matterId, user.firmId, user.id, user.id));
  }

  private requireWrite(user: SessionUser, matterId: string): void {
    if (!this.canWriteMatter(user, matterId)) {
      throw new NegotiationStoreError('NOT_FOUND', 'The negotiation workspace was not found.');
    }
  }

  private requireScoped(
    table: string,
    firmId: string,
    matterId: string,
    id: string | null,
  ): void {
    if (!id) return;
    if (!this.database.prepare(
      `SELECT 1 FROM ${table} WHERE id = ? AND firm_id = ? AND matter_id = ?`,
    ).get(id, firmId, matterId)) {
      throw new NegotiationStoreError('INVALID_LINK', 'A linked matter record was not found.');
    }
  }

  private resolveDocumentVersion(firmId: string, matterId: string, versionId: string | null) {
    if (!versionId) return null;
    const found = row(this.database.prepare(
      `SELECT d.id AS documentId, dv.id AS versionId FROM document_versions dv
       JOIN documents d ON d.id = dv.document_id AND d.firm_id = dv.firm_id
       WHERE dv.id = ? AND dv.firm_id = ? AND d.matter_id = ?`,
    ).get(versionId, firmId, matterId));
    if (!found) {
      throw new NegotiationStoreError('INVALID_LINK', 'The source document was not found.');
    }
    return { documentId: String(found.documentId), versionId: String(found.versionId) };
  }

  private receipt(
    user: SessionUser,
    matterId: string,
    commandType: string,
    idempotencyKey: string,
    payloadDigest: string,
  ): Row | undefined {
    const found = row(this.database.prepare(
      `SELECT payload_digest AS payloadDigest, result_entity_id AS resultEntityId
       FROM negotiation_command_receipts
       WHERE firm_id = ? AND matter_id = ? AND command_type = ? AND idempotency_key = ?`,
    ).get(user.firmId, matterId, commandType, idempotencyKey));
    if (found && found.payloadDigest !== payloadDigest) {
      throw new NegotiationStoreError(
        'IDEMPOTENCY_KEY_REUSED',
        'The idempotency key was already used with a different command.',
      );
    }
    return found;
  }

  private saveReceipt(
    user: SessionUser,
    matterId: string,
    commandType: string,
    idempotencyKey: string,
    payloadDigest: string,
    resultEntityType: string,
    resultEntityId: string,
    createdAt: string,
  ): void {
    this.database.prepare(
      `INSERT INTO negotiation_command_receipts (
        id, firm_id, matter_id, command_type, idempotency_key, payload_digest,
        result_entity_type, result_entity_id, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(), user.firmId, matterId, commandType, idempotencyKey,
      payloadDigest, resultEntityType, resultEntityId, user.id, createdAt,
    );
  }

  getCommandReplay(
    user: SessionUser,
    matterId: string,
    commandType: string,
    idempotencyKey: string,
    payload: unknown,
  ): string | null {
    if (!this.canReadMatter(user, matterId)) {
      throw new NegotiationStoreError('NOT_FOUND', 'The negotiation workspace was not found.');
    }
    const found = this.receipt(
      user,
      matterId,
      commandType,
      idempotencyKey,
      digest(payload),
    );
    return found ? String(found.resultEntityId) : null;
  }

  private appendOperational(
    user: SessionUser,
    matterId: string,
    details: {
      action: string;
      entityType: string;
      entityId: string;
      title: string;
      idempotencyKey: string;
      confidentiality: string;
      after: unknown;
      occurredAt: string;
    },
    audit: AuditContext,
  ): void {
    const protectedContent = details.confidentiality !== 'ordinary';
    const safeAfter = protectedContent
      ? { entityId: details.entityId, confidentiality: details.confidentiality }
      : details.after;
    appendTimeline(this.database, {
      firmId: user.firmId,
      matterId,
      type: details.action,
      title: protectedContent ? 'Protected negotiation record updated' : details.title,
      actorUserId: user.id,
      occurredAt: details.occurredAt,
      metadata: protectedContent
        ? { entityType: 'protected_negotiation_record', entityId: details.entityId }
        : { entityType: details.entityType, entityId: details.entityId },
    });
    appendAudit(this.database, {
      firmId: user.firmId,
      matterId,
      userId: user.id,
      action: details.action,
      entityType: details.entityType,
      entityId: details.entityId,
      after: safeAfter,
      createdAt: details.occurredAt,
      requestId: audit.requestId,
      ipAddress: audit.ipAddress,
    });
    this.database.prepare(
      `INSERT INTO domain_events (
        id, firm_id, matter_id, type, occurred_on, actor_user_id,
        idempotency_key, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(), user.firmId, matterId, details.action,
      details.occurredAt.slice(0, 10), user.id,
      `negotiation:${details.idempotencyKey}`, canonicalJson(safeAfter), details.occurredAt,
    );
    this.database.prepare(
      `INSERT INTO integration_outbox (
        id, firm_id, matter_id, topic, payload_json, status, attempts,
        available_at, created_at, deduplication_key
      ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
    ).run(
      randomUUID(), user.firmId, matterId, details.action,
      canonicalJson({ matterId, entityType: protectedContent
        ? 'protected_negotiation_record'
        : details.entityType, entityId: details.entityId }),
      details.occurredAt, details.occurredAt,
      `negotiation:${user.firmId}:${matterId}:${details.action}:${details.idempotencyKey}`,
    );
  }

  private getReview(firmId: string, matterId: string, id: string) {
    const found = row(this.database.prepare(
      `${reviewSelect} WHERE firm_id = ? AND matter_id = ? AND id = ?`,
    ).get(firmId, matterId, id));
    if (!found) throw new NegotiationStoreError('NOT_FOUND', 'The negotiation review was not found.');
    return mapReview(found);
  }

  createReview(
    user: SessionUser,
    matterId: string,
    input: CreateNegotiationReviewInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    const payloadDigest = digest(input);
    const prior = this.receipt(user, matterId, 'create_review', input.idempotencyKey, payloadDigest);
    if (prior) return this.getReview(user.firmId, matterId, String(prior.resultEntityId));

    return transaction(this.database, () => {
      for (const offerId of new Set(input.selectedOfferIds)) {
        this.requireScoped('offers', user.firmId, matterId, offerId);
      }
      this.requireScoped('loss_schedules', user.firmId, matterId, input.lossScheduleId);
      this.requireScoped(
        'general_damages_reviews', user.firmId, matterId, input.generalDamagesReviewId,
      );
      this.requireScoped('work_schedules', user.firmId, matterId, input.workScheduleId);
      this.requireScoped(
        'negotiation_reviews', user.firmId, matterId, input.supersedesReviewId,
      );
      if (input.reviewerUserId && !this.database.prepare(
        'SELECT 1 FROM users WHERE id = ? AND firm_id = ?',
      ).get(input.reviewerUserId, user.firmId)) {
        throw new NegotiationStoreError('INVALID_LINK', 'The reviewer was not found.');
      }

      const sources = {
        offers: input.selectedOfferIds.map((id) => {
          const source = row(this.database.prepare(
            `SELECT id, record_version AS recordVersion, confidentiality FROM offers
             WHERE id = ? AND firm_id = ? AND matter_id = ?`,
          ).get(id, user.firmId, matterId));
          return source && {
            id: String(source.id),
            recordVersion: Number(source.recordVersion),
            confidentiality: String(source.confidentiality),
          };
        }),
        lossScheduleId: input.lossScheduleId,
        generalDamagesReviewId: input.generalDamagesReviewId,
        workScheduleId: input.workScheduleId,
      };
      const createdAt = this.now().toISOString();
      const id = randomUUID();
      const reviewNumber = Number((this.database.prepare(
        `SELECT COALESCE(MAX(review_number), 0) + 1 AS next
         FROM negotiation_reviews WHERE firm_id = ? AND matter_id = ?`,
      ).get(user.firmId, matterId) as { next: number }).next);
      const sourceManifestJson = canonicalJson(sources);
      this.database.prepare(
        `INSERT INTO negotiation_reviews (
          id, firm_id, matter_id, review_number, confidentiality, reviewed_on,
          author_user_id, reviewer_user_id, selected_offer_ids_json, loss_schedule_id,
          general_damages_review_id, work_schedule_id, confirmed_facts, options_explained,
          risk_analysis, costs_funding_explanation, human_recommendation, advice_limitations,
          client_questions, source_manifest_json, source_manifest_digest,
          supersedes_review_id, correction_reason, idempotency_key,
          command_payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, user.firmId, matterId, reviewNumber, input.confidentiality, input.reviewedOn,
        user.id, input.reviewerUserId, canonicalJson(input.selectedOfferIds), input.lossScheduleId,
        input.generalDamagesReviewId, input.workScheduleId, input.confirmedFacts,
        input.optionsExplained, input.riskAnalysis, input.costsFundingExplanation,
        input.humanRecommendation, input.adviceLimitations, input.clientQuestions,
        sourceManifestJson, digest(sources), input.supersedesReviewId, input.correctionReason,
        input.idempotencyKey, canonicalJson(input), createdAt,
      );
      this.saveReceipt(
        user, matterId, 'create_review', input.idempotencyKey, payloadDigest,
        'negotiation_review', id, createdAt,
      );
      const created = this.getReview(user.firmId, matterId, id);
      this.appendOperational(user, matterId, {
        action: 'negotiation.review_recorded', entityType: 'negotiation_review',
        entityId: id, title: 'Negotiation review recorded', idempotencyKey: input.idempotencyKey,
        confidentiality: input.confidentiality, after: created, occurredAt: createdAt,
      }, audit);
      return created;
    });
  }

  private getInstruction(firmId: string, matterId: string, id: string) {
    const found = row(this.database.prepare(
      `${instructionSelect} WHERE firm_id = ? AND matter_id = ? AND id = ?`,
    ).get(firmId, matterId, id));
    if (!found) throw new NegotiationStoreError('NOT_FOUND', 'The client instruction was not found.');
    return mapInstruction(found);
  }

  recordInstruction(
    user: SessionUser,
    matterId: string,
    input: RecordClientInstructionInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    const payloadDigest = digest(input);
    const prior = this.receipt(
      user, matterId, 'record_instruction', input.idempotencyKey, payloadDigest,
    );
    if (prior) return this.getInstruction(user.firmId, matterId, String(prior.resultEntityId));

    return transaction(this.database, () => {
      this.requireScoped('negotiation_reviews', user.firmId, matterId, input.reviewId);
      this.requireScoped(
        'client_instructions', user.firmId, matterId, input.supersedesInstructionId,
      );
      const document = this.resolveDocumentVersion(
        user.firmId, matterId, input.sourceDocumentVersionId,
      );
      if (input.sourceCommunicationEntryId) {
        this.requireScoped(
          'communication_entries', user.firmId, matterId, input.sourceCommunicationEntryId,
        );
      }
      let actionVersion: number | null = null;
      if (input.actionId && input.actionVersionId) {
        const action = row(this.database.prepare(
          `SELECT version FROM negotiation_action_versions
           WHERE id = ? AND action_id = ? AND firm_id = ? AND matter_id = ?`,
        ).get(input.actionVersionId, input.actionId, user.firmId, matterId));
        if (!action) {
          throw new NegotiationStoreError('INVALID_LINK', 'The negotiation action version was not found.');
        }
        actionVersion = Number(action.version);
      }
      let settlementTermsVersion: number | null = null;
      if (input.settlementId && input.settlementTermsVersionId) {
        const terms = row(this.database.prepare(
          `SELECT version FROM settlement_term_versions
           WHERE id = ? AND settlement_id = ? AND firm_id = ? AND matter_id = ?`,
        ).get(
          input.settlementTermsVersionId, input.settlementId, user.firmId, matterId,
        ));
        if (!terms) {
          throw new NegotiationStoreError(
            'INVALID_LINK', 'The settlement terms version was not found.',
          );
        }
        settlementTermsVersion = Number(terms.version);
      }
      const createdAt = this.now().toISOString();
      const id = randomUUID();
      this.database.prepare(
        `INSERT INTO client_instructions (
          id, firm_id, matter_id, confidentiality, review_id, action_id, action_version_id,
          action_version, settlement_id, settlement_terms_version_id,
          settlement_terms_version, instruction_type, instructing_person, relationship_to_client,
          authority_basis, decision_note, received_method, received_at, taken_by,
          identity_status, identity_note, understanding_confirmed, accessibility_measures,
          source_communication_entry_id, source_document_id, source_document_version_id,
          supersedes_instruction_id, correction_reason, idempotency_key,
          command_payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, user.firmId, matterId, input.confidentiality, input.reviewId, input.actionId,
        input.actionVersionId, actionVersion, input.settlementId ?? null,
        input.settlementTermsVersionId ?? null, settlementTermsVersion,
        input.instructionType, input.instructingPerson,
        input.relationshipToClient, input.authorityBasis, input.decisionNote,
        input.receivedMethod, input.receivedAt, user.id, input.identityStatus,
        input.identityNote, 1, input.accessibilityMeasures, input.sourceCommunicationEntryId,
        document?.documentId ?? null, document?.versionId ?? null,
        input.supersedesInstructionId, input.correctionReason, input.idempotencyKey,
        canonicalJson(input), createdAt,
      );
      this.saveReceipt(
        user, matterId, 'record_instruction', input.idempotencyKey, payloadDigest,
        'client_instruction', id, createdAt,
      );
      const created = this.getInstruction(user.firmId, matterId, id);
      this.appendOperational(user, matterId, {
        action: 'negotiation.instruction_recorded', entityType: 'client_instruction',
        entityId: id, title: 'Client instruction recorded', idempotencyKey: input.idempotencyKey,
        confidentiality: input.confidentiality, after: created, occurredAt: createdAt,
      }, audit);
      return created;
    });
  }

  private getAuthority(firmId: string, matterId: string, id: string) {
    const found = row(this.database.prepare(
      `${authoritySelect} WHERE firm_id = ? AND matter_id = ? AND id = ?`,
    ).get(firmId, matterId, id));
    if (!found) throw new NegotiationStoreError('NOT_FOUND', 'The settlement authority was not found.');
    return mapAuthority(found);
  }

  createAuthorityVersion(
    user: SessionUser,
    matterId: string,
    input: CreateSettlementAuthorityVersionInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    const payloadDigest = digest(input);
    const prior = this.receipt(
      user, matterId, 'create_authority_version', input.idempotencyKey, payloadDigest,
    );
    if (prior) return this.getAuthority(user.firmId, matterId, String(prior.resultEntityId));

    return transaction(this.database, () => {
      const document = this.resolveDocumentVersion(
        user.firmId, matterId, input.sourceDocumentVersionId,
      );
      const previous = row(this.database.prepare(
        `SELECT id, version FROM settlement_authority_versions
         WHERE firm_id = ? AND matter_id = ? ORDER BY version DESC LIMIT 1`,
      ).get(user.firmId, matterId));
      const version = previous ? Number(previous.version) + 1 : 1;
      const createdAt = this.now().toISOString();
      const id = randomUUID();
      this.database.prepare(
        `INSERT INTO settlement_authority_versions (
          id, firm_id, matter_id, version, source, scope, action_types_json,
          minimum_amount_minor, maximum_amount_minor, non_money_constraints,
          costs_constraints, repair_constraints, expires_at, review_on,
          requires_client_instruction, requires_partner_approval, source_document_id,
          source_document_version_id, review_note, supersedes_authority_id,
          idempotency_key, command_payload_json, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, user.firmId, matterId, version, input.source, input.scope,
        canonicalJson(input.actionTypes), input.minimumAmountMinor, input.maximumAmountMinor,
        input.nonMoneyConstraints, input.costsConstraints, input.repairConstraints,
        input.expiresAt, input.reviewOn, input.requiresClientInstruction ? 1 : 0,
        input.requiresPartnerApproval ? 1 : 0, document?.documentId ?? null,
        document?.versionId ?? null, input.reviewNote, previous?.id ?? null,
        input.idempotencyKey, canonicalJson(input), user.id, createdAt,
      );
      this.saveReceipt(
        user, matterId, 'create_authority_version', input.idempotencyKey, payloadDigest,
        'settlement_authority', id, createdAt,
      );
      const created = this.getAuthority(user.firmId, matterId, id);
      this.appendOperational(user, matterId, {
        action: 'negotiation.authority_recorded', entityType: 'settlement_authority',
        entityId: id, title: 'Settlement authority recorded', idempotencyKey: input.idempotencyKey,
        confidentiality: 'privileged', after: created, occurredAt: createdAt,
      }, audit);
      return created;
    });
  }

  private actionVersion(firmId: string, matterId: string, id: string) {
    const found = row(this.database.prepare(
      `SELECT id, version, recipients_json AS recipientsJson, scope,
        scope_description AS scopeDescription, damages_minor AS damagesMinor,
        costs_minor AS costsMinor, total_minor AS totalMinor, currency,
        works_terms AS worksTerms, non_money_terms AS nonMoneyTerms,
        interest_treatment AS interestTreatment,
        confidentiality_terms AS confidentialityTerms, payment_terms AS paymentTerms,
        proposed_instrument_type AS proposedInstrumentType,
        document_version_ids_json AS documentVersionIdsJson, terms_digest AS termsDigest,
        change_reason AS changeReason, created_by AS createdBy, created_at AS createdAt
       FROM negotiation_action_versions
       WHERE id = ? AND firm_id = ? AND matter_id = ?`,
    ).get(id, firmId, matterId));
    if (!found) {
      throw new NegotiationStoreError('NOT_FOUND', 'The negotiation action was not found.');
    }
    return mapActionVersion(found);
  }

  getAction(user: SessionUser, matterId: string, actionId: string) {
    if (!this.canReadMatter(user, matterId)) {
      throw new NegotiationStoreError('NOT_FOUND', 'The negotiation action was not found.');
    }
    const found = row(this.database.prepare(
      `SELECT id, action_reference AS actionReference, record_version AS recordVersion,
        action_type AS actionType, confidentiality, linked_offer_id AS linkedOfferId,
        current_action_version_id AS currentActionVersionId, status,
        created_by AS createdBy, created_at AS createdAt,
        updated_by AS updatedBy, updated_at AS updatedAt
       FROM negotiation_actions WHERE id = ? AND firm_id = ? AND matter_id = ?`,
    ).get(actionId, user.firmId, matterId));
    if (!found) {
      throw new NegotiationStoreError('NOT_FOUND', 'The negotiation action was not found.');
    }
    const versions = rows(this.database.prepare(
      `SELECT id, version, recipients_json AS recipientsJson, scope,
        scope_description AS scopeDescription, damages_minor AS damagesMinor,
        costs_minor AS costsMinor, total_minor AS totalMinor, currency,
        works_terms AS worksTerms, non_money_terms AS nonMoneyTerms,
        interest_treatment AS interestTreatment,
        confidentiality_terms AS confidentialityTerms, payment_terms AS paymentTerms,
        proposed_instrument_type AS proposedInstrumentType,
        document_version_ids_json AS documentVersionIdsJson, terms_digest AS termsDigest,
        change_reason AS changeReason, created_by AS createdBy, created_at AS createdAt
       FROM negotiation_action_versions WHERE action_id = ? AND firm_id = ? AND matter_id = ?
       ORDER BY version`,
    ).all(actionId, user.firmId, matterId)).map(mapActionVersion);
    const instructions = rows(this.database.prepare(
      `SELECT id, action_version AS actionVersion, received_at AS occurredAt,
        supersedes_instruction_id AS supersedesInstructionId
       FROM client_instructions
       WHERE action_id = ? AND firm_id = ? AND matter_id = ?
       ORDER BY received_at, created_at, id`,
    ).all(actionId, user.firmId, matterId)).map((value) => ({
      id: String(value.id),
      actionVersion: Number(value.actionVersion),
      occurredAt: String(value.occurredAt),
      supersedesInstructionId: value.supersedesInstructionId
        ? String(value.supersedesInstructionId)
        : null,
    }));
    const approvals = rows(this.database.prepare(
      `SELECT id, action_version AS actionVersion, event_sequence AS eventSequence,
        decision, occurred_at AS occurredAt,
        actor_user_id AS actorUserId, client_instruction_id AS clientInstructionId,
        authority_version_id AS authorityVersionId
       FROM negotiation_approval_events
       WHERE action_id = ? AND firm_id = ? AND matter_id = ?
       ORDER BY event_sequence`,
    ).all(actionId, user.firmId, matterId)).map((value) => ({
      id: String(value.id),
      actionVersion: Number(value.actionVersion),
      eventSequence: Number(value.eventSequence),
      decision: String(value.decision) as 'submitted' | 'approved' | 'rejected' | 'withdrawn' | 'invalidated',
      occurredAt: String(value.occurredAt),
      actorUserId: String(value.actorUserId),
      clientInstructionId: String(value.clientInstructionId),
      authorityVersionId: String(value.authorityVersionId),
    }));
    const externalActs = rows(this.database.prepare(
      `SELECT id, action_version AS actionVersion, occurred_at AS occurredAt,
        method, recipient, source_communication_entry_id AS sourceCommunicationEntryId,
        source_document_version_id AS sourceDocumentVersionId, factual_note AS factualNote
       FROM negotiation_external_acts
       WHERE action_id = ? AND firm_id = ? AND matter_id = ? ORDER BY occurred_at, id`,
    ).all(actionId, user.firmId, matterId)).map((value) => ({
      id: String(value.id),
      actionVersion: Number(value.actionVersion),
      occurredAt: String(value.occurredAt),
      method: String(value.method),
      recipient: String(value.recipient),
      sourceCommunicationEntryId: value.sourceCommunicationEntryId
        ? String(value.sourceCommunicationEntryId)
        : null,
      sourceDocumentVersionId: value.sourceDocumentVersionId
        ? String(value.sourceDocumentVersionId)
        : null,
      factualNote: String(value.factualNote),
    }));
    const currentVersion = versions.find(({ id }) => id === String(found.currentActionVersionId));
    if (!currentVersion) {
      throw new NegotiationStoreError('CONFLICT', 'The negotiation action has no current version.');
    }
    const projection = projectAction({
      currentVersion: currentVersion.version,
      cancelled: found.status === 'cancelled',
      superseded: found.status === 'superseded',
      instructions,
      approvals,
      externalActs,
    });
    return {
      id: String(found.id),
      actionReference: String(found.actionReference),
      recordVersion: Number(found.recordVersion),
      actionType: String(found.actionType),
      confidentiality: String(found.confidentiality),
      linkedOfferId: found.linkedOfferId ? String(found.linkedOfferId) : null,
      status: String(found.status),
      currentVersion,
      versions,
      instructions,
      approvals,
      externalActs,
      projection,
      createdBy: String(found.createdBy),
      createdAt: String(found.createdAt),
      updatedBy: String(found.updatedBy),
      updatedAt: String(found.updatedAt),
    };
  }

  private requireExpectedAction(
    user: SessionUser,
    matterId: string,
    actionId: string,
    expectedVersion: number,
  ) {
    this.requireWrite(user, matterId);
    const action = this.getAction(user, matterId, actionId);
    if (action.recordVersion !== expectedVersion) {
      throw new NegotiationStoreError('CONFLICT', 'The negotiation action changed. Refresh and retry.');
    }
    if (action.projection.state === 'cancelled' || action.projection.state === 'superseded') {
      throw new NegotiationStoreError('CONFLICT', 'The negotiation action is no longer active.');
    }
    return action;
  }

  private validateActionSources(firmId: string, matterId: string, versionIds: string[]): void {
    for (const versionId of new Set(versionIds)) {
      this.resolveDocumentVersion(firmId, matterId, versionId);
    }
  }

  private insertActionVersion(
    user: SessionUser,
    matterId: string,
    actionId: string,
    version: number,
    input: CreateNegotiationActionInput | AppendNegotiationActionVersionInput,
    changeReason: string,
    createdAt: string,
  ) {
    this.validateActionSources(user.firmId, matterId, input.documentVersionIds);
    const versionId = randomUUID();
    const terms = {
      recipients: input.recipients,
      scope: input.scope,
      scopeDescription: input.scopeDescription,
      damagesMinor: input.damagesMinor,
      costsMinor: input.costsMinor,
      totalMinor: input.totalMinor,
      currency: input.currency,
      worksTerms: input.worksTerms,
      nonMoneyTerms: input.nonMoneyTerms,
      interestTreatment: input.interestTreatment,
      confidentialityTerms: input.confidentialityTerms,
      paymentTerms: input.paymentTerms,
      proposedInstrumentType: input.proposedInstrumentType,
      documentVersionIds: input.documentVersionIds,
    };
    this.database.prepare(
      `INSERT INTO negotiation_action_versions (
        id, firm_id, matter_id, action_id, version, recipients_json, scope,
        scope_description, damages_minor, costs_minor, total_minor, currency,
        works_terms, non_money_terms, interest_treatment, confidentiality_terms,
        payment_terms, proposed_instrument_type, document_version_ids_json,
        terms_digest, change_reason, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      versionId, user.firmId, matterId, actionId, version, canonicalJson(input.recipients),
      input.scope, input.scopeDescription, input.damagesMinor, input.costsMinor,
      input.totalMinor, input.currency, input.worksTerms, input.nonMoneyTerms,
      input.interestTreatment, input.confidentialityTerms, input.paymentTerms,
      input.proposedInstrumentType, canonicalJson(input.documentVersionIds), digest(terms),
      changeReason, user.id, createdAt,
    );
    return versionId;
  }

  createAction(
    user: SessionUser,
    matterId: string,
    input: CreateNegotiationActionInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    const payloadDigest = digest(input);
    const prior = this.receipt(user, matterId, 'create_action', input.idempotencyKey, payloadDigest);
    if (prior) return this.getAction(user, matterId, String(prior.resultEntityId));
    return transaction(this.database, () => {
      this.requireScoped('offers', user.firmId, matterId, input.linkedOfferId);
      const id = randomUUID();
      const createdAt = this.now().toISOString();
      const actionNumber = Number((this.database.prepare(
        `SELECT COUNT(*) + 1 AS next FROM negotiation_actions
         WHERE firm_id = ? AND matter_id = ?`,
      ).get(user.firmId, matterId) as { next: number }).next);
      this.database.prepare(
        `INSERT INTO negotiation_actions (
          id, firm_id, matter_id, action_reference, record_version, action_type,
          confidentiality, linked_offer_id, current_action_version_id, status,
          created_by, created_at, updated_by, updated_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, NULL, 'instruction_required', ?, ?, ?, ?)`,
      ).run(
        id, user.firmId, matterId, `NA-${String(actionNumber).padStart(3, '0')}`,
        input.actionType, input.confidentiality, input.linkedOfferId,
        user.id, createdAt, user.id, createdAt,
      );
      const versionId = this.insertActionVersion(user, matterId, id, 1, input, '', createdAt);
      this.database.prepare(
        'UPDATE negotiation_actions SET current_action_version_id = ? WHERE id = ?',
      ).run(versionId, id);
      this.saveReceipt(
        user, matterId, 'create_action', input.idempotencyKey, payloadDigest,
        'negotiation_action', id, createdAt,
      );
      const created = this.getAction(user, matterId, id);
      this.appendOperational(user, matterId, {
        action: 'negotiation.action_created', entityType: 'negotiation_action', entityId: id,
        title: 'Negotiation action created', idempotencyKey: input.idempotencyKey,
        confidentiality: input.confidentiality, after: created, occurredAt: createdAt,
      }, audit);
      return created;
    });
  }

  appendActionVersion(
    user: SessionUser,
    matterId: string,
    actionId: string,
    input: AppendNegotiationActionVersionInput,
    audit: AuditContext,
  ) {
    const action = this.requireExpectedAction(user, matterId, actionId, input.expectedVersion);
    if (input.actionType !== action.actionType || input.confidentiality !== action.confidentiality) {
      throw new NegotiationStoreError('CONFLICT', 'Create a new action to change its type or confidentiality.');
    }
    return transaction(this.database, () => {
      this.requireScoped('offers', user.firmId, matterId, input.linkedOfferId);
      const createdAt = this.now().toISOString();
      const nextVersion = action.currentVersion.version + 1;
      const versionId = this.insertActionVersion(
        user, matterId, actionId, nextVersion, input, input.changeReason, createdAt,
      );
      const latestApproval = action.approvals.at(-1);
      if (latestApproval) {
        this.database.prepare(
          `INSERT INTO negotiation_approval_events (
            id, firm_id, matter_id, action_id, action_version_id, action_version,
            event_sequence,
            client_instruction_id, authority_version_id, decision, note,
            actor_user_id, occurred_at, idempotency_key
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'invalidated', ?, ?, ?, ?)`,
        ).run(
          randomUUID(), user.firmId, matterId, actionId, action.currentVersion.id,
          action.currentVersion.version, latestApproval.eventSequence + 1,
          latestApproval.clientInstructionId,
          latestApproval.authorityVersionId, 'A later immutable terms version invalidated this decision.',
          user.id, createdAt, `invalidate:${actionId}:${nextVersion}`,
        );
      }
      this.database.prepare(
        `UPDATE negotiation_actions SET linked_offer_id = ?, current_action_version_id = ?,
          record_version = record_version + 1, status = 'instruction_required',
          updated_by = ?, updated_at = ? WHERE id = ?`,
      ).run(input.linkedOfferId, versionId, user.id, createdAt, actionId);
      const updated = this.getAction(user, matterId, actionId);
      this.appendOperational(user, matterId, {
        action: 'negotiation.action_versioned', entityType: 'negotiation_action',
        entityId: actionId, title: 'Negotiation action terms updated',
        idempotencyKey: `version:${actionId}:${nextVersion}`,
        confidentiality: action.confidentiality, after: updated, occurredAt: createdAt,
      }, audit);
      return updated;
    });
  }

  recordApprovalEvent(
    user: SessionUser,
    matterId: string,
    actionId: string,
    input: SubmitNegotiationActionInput | DecideNegotiationActionInput,
    decision: 'submitted' | 'approved' | 'rejected',
    audit: AuditContext,
  ) {
    const action = this.requireExpectedAction(user, matterId, actionId, input.expectedVersion);
    const payloadDigest = digest({ actionId, input, decision });
    const commandType = decision === 'submitted' ? 'submit_action' : 'decide_action';
    const prior = this.receipt(user, matterId, commandType, input.idempotencyKey, payloadDigest);
    if (prior) return this.getAction(user, matterId, actionId);
    return transaction(this.database, () => {
      const occurredAt = this.now().toISOString();
      const eventId = randomUUID();
      this.database.prepare(
        `INSERT INTO negotiation_approval_events (
          id, firm_id, matter_id, action_id, action_version_id, action_version,
          event_sequence,
          client_instruction_id, authority_version_id, decision, note,
          actor_user_id, occurred_at, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        eventId, user.firmId, matterId, actionId, input.actionVersionId,
        action.currentVersion.version, (action.approvals.at(-1)?.eventSequence ?? 0) + 1,
        input.clientInstructionId, input.authorityVersionId,
        decision, input.note, user.id, occurredAt, input.idempotencyKey,
      );
      this.database.prepare(
        `UPDATE negotiation_actions SET record_version = record_version + 1, status = ?,
          updated_by = ?, updated_at = ? WHERE id = ?`,
      ).run(
        decision === 'approved' ? 'authorised' : 'approval_required',
        user.id, occurredAt, actionId,
      );
      this.saveReceipt(
        user, matterId, commandType, input.idempotencyKey, payloadDigest,
        'negotiation_approval_event', eventId, occurredAt,
      );
      const updated = this.getAction(user, matterId, actionId);
      this.appendOperational(user, matterId, {
        action: `negotiation.action_${decision}`, entityType: 'negotiation_action',
        entityId: actionId, title: `Negotiation action ${decision}`,
        idempotencyKey: input.idempotencyKey, confidentiality: action.confidentiality,
        after: { actionId, eventId, decision }, occurredAt,
      }, audit);
      return updated;
    });
  }

  recordExternalAction(
    user: SessionUser,
    matterId: string,
    actionId: string,
    input: RecordNegotiationExternalActionInput,
    audit: AuditContext,
  ) {
    const action = this.requireExpectedAction(user, matterId, actionId, input.expectedVersion);
    const payloadDigest = digest({ actionId, input });
    const prior = this.receipt(
      user, matterId, 'record_external_action', input.idempotencyKey, payloadDigest,
    );
    if (prior) return this.getAction(user, matterId, actionId);
    return transaction(this.database, () => {
      const document = this.resolveDocumentVersion(
        user.firmId, matterId, input.sourceDocumentVersionId,
      );
      if (input.sourceCommunicationEntryId) {
        const communication = row(this.database.prepare(
          `SELECT direction, channel FROM communication_entries
           WHERE id = ? AND firm_id = ? AND matter_id = ?`,
        ).get(input.sourceCommunicationEntryId, user.firmId, matterId));
        if (!communication || communication.direction !== 'outbound' || communication.channel === 'internal') {
          throw new NegotiationStoreError(
            'INVALID_LINK', 'The retained source does not record an external outbound communication.',
          );
        }
      }
      const id = randomUUID();
      const recordedAt = this.now().toISOString();
      this.database.prepare(
        `INSERT INTO negotiation_external_acts (
          id, firm_id, matter_id, action_id, action_version_id, action_version,
          occurred_at, method, recipient, source_communication_entry_id,
          source_document_id, source_document_version_id, factual_note,
          recorded_by, recorded_at, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, user.firmId, matterId, actionId, input.actionVersionId,
        action.currentVersion.version, input.occurredAt, input.method, input.recipient,
        input.sourceCommunicationEntryId, document?.documentId ?? null,
        document?.versionId ?? null, input.factualNote, user.id, recordedAt,
        input.idempotencyKey,
      );
      this.database.prepare(
        `UPDATE negotiation_actions SET record_version = record_version + 1,
          status = 'externally_recorded', updated_by = ?, updated_at = ? WHERE id = ?`,
      ).run(user.id, recordedAt, actionId);
      this.saveReceipt(
        user, matterId, 'record_external_action', input.idempotencyKey, payloadDigest,
        'negotiation_external_act', id, recordedAt,
      );
      const updated = this.getAction(user, matterId, actionId);
      this.appendOperational(user, matterId, {
        action: 'negotiation.external_action_recorded', entityType: 'negotiation_external_act',
        entityId: id, title: 'External negotiation action recorded',
        idempotencyKey: input.idempotencyKey, confidentiality: action.confidentiality,
        after: { actionId, actionVersionId: input.actionVersionId, externalActId: id },
        occurredAt: recordedAt,
      }, audit);
      return updated;
    });
  }

  getSettlement(user: SessionUser, matterId: string, settlementId: string) {
    if (!this.canReadMatter(user, matterId)) {
      throw new NegotiationStoreError('NOT_FOUND', 'The settlement was not found.');
    }
    const found = row(this.database.prepare(
      `SELECT id, settlement_reference AS settlementReference,
        record_version AS recordVersion, settlement_type AS settlementType,
        scope, confidentiality, title, originating_action_id AS originatingActionId,
        linked_offer_id AS linkedOfferId, client_instruction_id AS clientInstructionId,
        current_terms_version_id AS currentTermsVersionId, status,
        court_approval_position AS courtApprovalPosition,
        instrument_document_version_id AS instrumentDocumentVersionId,
        source_communication_entry_id AS sourceCommunicationEntryId,
        conclusion_note AS conclusionNote, concluded_by AS concludedBy,
        concluded_at AS concludedAt, created_by AS createdBy, created_at AS createdAt,
        updated_by AS updatedBy, updated_at AS updatedAt
       FROM settlements WHERE id = ? AND firm_id = ? AND matter_id = ?`,
    ).get(settlementId, user.firmId, matterId));
    if (!found) throw new NegotiationStoreError('NOT_FOUND', 'The settlement was not found.');
    const terms = rows(this.database.prepare(
      `SELECT id, version, damages_minor AS damagesMinor, costs_minor AS costsMinor,
        total_minor AS totalMinor, currency, payment_method AS paymentMethod,
        payment_due_at AS paymentDueAt, repair_terms AS repairTerms,
        access_terms AS accessTerms, inspection_terms AS inspectionTerms,
        liability_admission_position AS liabilityAdmissionPosition,
        interest_terms AS interestTerms, confidentiality_terms AS confidentialityTerms,
        disposal_terms AS disposalTerms, enforcement_terms AS enforcementTerms,
        other_terms AS otherTerms,
        source_document_version_ids_json AS sourceDocumentVersionIdsJson,
        source_manifest_json AS sourceManifestJson, terms_digest AS termsDigest,
        review_note AS reviewNote, change_reason AS changeReason,
        created_by AS createdBy, created_at AS createdAt
       FROM settlement_term_versions
       WHERE settlement_id = ? AND firm_id = ? AND matter_id = ? ORDER BY version`,
    ).all(settlementId, user.firmId, matterId)).map((value) => ({
      id: String(value.id),
      version: Number(value.version),
      damagesMinor: value.damagesMinor === null ? null : Number(value.damagesMinor),
      costsMinor: value.costsMinor === null ? null : Number(value.costsMinor),
      totalMinor: value.totalMinor === null ? null : Number(value.totalMinor),
      currency: String(value.currency),
      paymentMethod: String(value.paymentMethod),
      paymentDueAt: value.paymentDueAt ? String(value.paymentDueAt) : null,
      repairTerms: String(value.repairTerms),
      accessTerms: String(value.accessTerms),
      inspectionTerms: String(value.inspectionTerms),
      liabilityAdmissionPosition: String(value.liabilityAdmissionPosition),
      interestTerms: String(value.interestTerms),
      confidentialityTerms: String(value.confidentialityTerms),
      disposalTerms: String(value.disposalTerms),
      enforcementTerms: String(value.enforcementTerms),
      otherTerms: String(value.otherTerms),
      sourceDocumentVersionIds: parseJson<string[]>(value.sourceDocumentVersionIdsJson, []),
      sourceManifest: parseJson<Record<string, unknown>>(value.sourceManifestJson, {}),
      termsDigest: String(value.termsDigest),
      reviewNote: String(value.reviewNote),
      changeReason: String(value.changeReason),
      createdBy: String(value.createdBy),
      createdAt: String(value.createdAt),
    }));
    const currentTerms = terms.find(({ id }) => id === String(found.currentTermsVersionId)) ?? null;
    const instruction = currentTerms
      ? row(this.database.prepare(
        `SELECT settlement_terms_version AS version FROM client_instructions
         WHERE id = ? AND firm_id = ? AND matter_id = ? AND settlement_id = ?`,
      ).get(found.clientInstructionId, user.firmId, matterId, settlementId))
      : undefined;
    const projection = projectSettlement({
      currentTermsVersion: currentTerms?.version ?? 0,
      instructionTermsVersion: instruction ? Number(instruction.version) : null,
      approvalTermsVersion: found.concludedBy && currentTerms ? currentTerms.version : null,
      instrumentRecorded: Boolean(
        found.instrumentDocumentVersionId || found.sourceCommunicationEntryId,
      ),
      courtApprovalPosition: String(found.courtApprovalPosition) as
        'unknown' | 'not_required_reviewed' | 'required' | 'obtained',
      concludedAt: found.concludedAt ? String(found.concludedAt) : null,
    });
    return {
      id: String(found.id),
      settlementReference: String(found.settlementReference),
      recordVersion: Number(found.recordVersion),
      settlementType: String(found.settlementType),
      scope: String(found.scope),
      confidentiality: String(found.confidentiality),
      title: String(found.title),
      originatingActionId: found.originatingActionId ? String(found.originatingActionId) : null,
      linkedOfferId: found.linkedOfferId ? String(found.linkedOfferId) : null,
      clientInstructionId: String(found.clientInstructionId),
      status: String(found.status),
      courtApprovalPosition: String(found.courtApprovalPosition),
      instrumentDocumentVersionId: found.instrumentDocumentVersionId
        ? String(found.instrumentDocumentVersionId)
        : null,
      sourceCommunicationEntryId: found.sourceCommunicationEntryId
        ? String(found.sourceCommunicationEntryId)
        : null,
      conclusionNote: String(found.conclusionNote),
      concludedBy: found.concludedBy ? String(found.concludedBy) : null,
      concludedAt: found.concludedAt ? String(found.concludedAt) : null,
      currentTerms,
      terms,
      projection,
      createdBy: String(found.createdBy),
      createdAt: String(found.createdAt),
      updatedBy: String(found.updatedBy),
      updatedAt: String(found.updatedAt),
    };
  }

  createSettlement(
    user: SessionUser,
    matterId: string,
    input: CreateSettlementInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    const payloadDigest = digest(input);
    const prior = this.receipt(user, matterId, 'create_settlement', input.idempotencyKey, payloadDigest);
    if (prior) return this.getSettlement(user, matterId, String(prior.resultEntityId));
    return transaction(this.database, () => {
      this.requireScoped('negotiation_actions', user.firmId, matterId, input.originatingActionId);
      this.requireScoped('offers', user.firmId, matterId, input.linkedOfferId);
      this.requireScoped('client_instructions', user.firmId, matterId, input.clientInstructionId);
      const createdAt = this.now().toISOString();
      const id = randomUUID();
      const sequence = Number((this.database.prepare(
        `SELECT COUNT(*) + 1 AS next FROM settlements WHERE firm_id = ? AND matter_id = ?`,
      ).get(user.firmId, matterId) as { next: number }).next);
      this.database.prepare(
        `INSERT INTO settlements (
          id, firm_id, matter_id, settlement_reference, record_version,
          settlement_type, scope, confidentiality, title, originating_action_id,
          linked_offer_id, client_instruction_id, current_terms_version_id, status,
          created_by, created_at, updated_by, updated_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, NULL, 'preparing', ?, ?, ?, ?)`,
      ).run(
        id, user.firmId, matterId, `ST-${String(sequence).padStart(3, '0')}`,
        input.settlementType, input.scope, input.confidentiality, input.title,
        input.originatingActionId, input.linkedOfferId, input.clientInstructionId,
        user.id, createdAt, user.id, createdAt,
      );
      this.saveReceipt(
        user, matterId, 'create_settlement', input.idempotencyKey, payloadDigest,
        'settlement', id, createdAt,
      );
      const created = this.getSettlement(user, matterId, id);
      this.appendOperational(user, matterId, {
        action: 'settlement.created', entityType: 'settlement', entityId: id,
        title: 'Settlement record created', idempotencyKey: input.idempotencyKey,
        confidentiality: input.confidentiality, after: created, occurredAt: createdAt,
      }, audit);
      return created;
    });
  }

  appendSettlementTerms(
    user: SessionUser,
    matterId: string,
    settlementId: string,
    input: AppendSettlementTermsInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    const existing = this.getSettlement(user, matterId, settlementId);
    if (existing.recordVersion !== input.expectedVersion) {
      throw new NegotiationStoreError('CONFLICT', 'The settlement changed. Refresh and retry.');
    }
    if (existing.projection.state === 'concluded') {
      throw new NegotiationStoreError('CONFLICT', 'Concluded settlement terms cannot be changed.');
    }
    const payloadDigest = digest({ settlementId, input });
    const prior = this.receipt(
      user, matterId, 'append_settlement_terms', input.idempotencyKey, payloadDigest,
    );
    if (prior) return this.getSettlement(user, matterId, settlementId);
    return transaction(this.database, () => {
      const sources = input.sourceDocumentVersionIds.map((versionId) =>
        this.resolveDocumentVersion(user.firmId, matterId, versionId),
      );
      const version = (existing.currentTerms?.version ?? 0) + 1;
      const id = randomUUID();
      const createdAt = this.now().toISOString();
      const terms = {
        damagesMinor: input.damagesMinor,
        costsMinor: input.costsMinor,
        totalMinor: input.totalMinor,
        currency: input.currency,
        paymentMethod: input.paymentMethod,
        paymentDueAt: input.paymentDueAt,
        repairTerms: input.repairTerms,
        accessTerms: input.accessTerms,
        inspectionTerms: input.inspectionTerms,
        liabilityAdmissionPosition: input.liabilityAdmissionPosition,
        interestTerms: input.interestTerms,
        confidentialityTerms: input.confidentialityTerms,
        disposalTerms: input.disposalTerms,
        enforcementTerms: input.enforcementTerms,
        otherTerms: input.otherTerms,
      };
      this.database.prepare(
        `INSERT INTO settlement_term_versions (
          id, firm_id, matter_id, settlement_id, version, damages_minor, costs_minor,
          total_minor, currency, payment_method, payment_due_at, repair_terms,
          access_terms, inspection_terms, liability_admission_position, interest_terms,
          confidentiality_terms, disposal_terms, enforcement_terms, other_terms,
          source_document_version_ids_json, source_manifest_json, terms_digest,
          review_note, change_reason, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, user.firmId, matterId, settlementId, version, input.damagesMinor,
        input.costsMinor, input.totalMinor, input.currency, input.paymentMethod,
        input.paymentDueAt, input.repairTerms, input.accessTerms, input.inspectionTerms,
        input.liabilityAdmissionPosition, input.interestTerms, input.confidentialityTerms,
        input.disposalTerms, input.enforcementTerms, input.otherTerms,
        canonicalJson(input.sourceDocumentVersionIds), canonicalJson({ documents: sources }),
        digest(terms), input.reviewNote, input.changeReason, user.id, createdAt,
      );
      this.database.prepare(
        `UPDATE settlements SET current_terms_version_id = ?,
          record_version = record_version + 1, status = 'authority_required',
          court_approval_position = 'unknown', instrument_document_id = NULL,
          instrument_document_version_id = NULL, source_communication_entry_id = NULL,
          conclusion_note = '', concluded_by = NULL, concluded_at = NULL,
          updated_by = ?, updated_at = ? WHERE id = ?`,
      ).run(id, user.id, createdAt, settlementId);
      this.saveReceipt(
        user, matterId, 'append_settlement_terms', input.idempotencyKey, payloadDigest,
        'settlement_terms_version', id, createdAt,
      );
      const updated = this.getSettlement(user, matterId, settlementId);
      this.appendOperational(user, matterId, {
        action: 'settlement.terms_versioned', entityType: 'settlement', entityId: settlementId,
        title: 'Settlement terms updated', idempotencyKey: input.idempotencyKey,
        confidentiality: existing.confidentiality, after: updated, occurredAt: createdAt,
      }, audit);
      return updated;
    });
  }

  concludeSettlement(
    user: SessionUser,
    matterId: string,
    settlementId: string,
    input: ConcludeSettlementInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    const existing = this.getSettlement(user, matterId, settlementId);
    if (existing.recordVersion !== input.expectedVersion) {
      throw new NegotiationStoreError('CONFLICT', 'The settlement changed. Refresh and retry.');
    }
    const payloadDigest = digest({ settlementId, input });
    const prior = this.receipt(user, matterId, 'conclude_settlement', input.idempotencyKey, payloadDigest);
    if (prior) return this.getSettlement(user, matterId, settlementId);
    return transaction(this.database, () => {
      const instrument = this.resolveDocumentVersion(
        user.firmId, matterId, input.instrumentDocumentVersionId,
      );
      if (input.sourceCommunicationEntryId) {
        const source = row(this.database.prepare(
          `SELECT channel FROM communication_entries
           WHERE id = ? AND firm_id = ? AND matter_id = ?`,
        ).get(input.sourceCommunicationEntryId, user.firmId, matterId));
        if (!source || source.channel === 'internal') {
          throw new NegotiationStoreError('INVALID_LINK', 'The settlement source was not found.');
        }
      }
      const concludedAt = this.now().toISOString();
      this.database.prepare(
        `UPDATE settlements SET client_instruction_id = ?,
          record_version = record_version + 1, status = 'concluded',
          court_approval_position = ?, instrument_document_id = ?,
          instrument_document_version_id = ?, source_communication_entry_id = ?,
          conclusion_note = ?, concluded_by = ?, concluded_at = ?,
          updated_by = ?, updated_at = ? WHERE id = ?`,
      ).run(
        input.clientInstructionId, input.courtApprovalPosition,
        instrument?.documentId ?? null, instrument?.versionId ?? null,
        input.sourceCommunicationEntryId, input.conclusionNote, user.id, concludedAt,
        user.id, concludedAt, settlementId,
      );
      this.saveReceipt(
        user, matterId, 'conclude_settlement', input.idempotencyKey, payloadDigest,
        'settlement', settlementId, concludedAt,
      );
      const updated = this.getSettlement(user, matterId, settlementId);
      this.appendOperational(user, matterId, {
        action: 'settlement.concluded', entityType: 'settlement', entityId: settlementId,
        title: 'Settlement conclusion recorded', idempotencyKey: input.idempotencyKey,
        confidentiality: existing.confidentiality,
        after: { settlementId, termsVersionId: input.termsVersionId },
        occurredAt: concludedAt,
      }, audit);
      return updated;
    });
  }

  getObligation(user: SessionUser, matterId: string, obligationId: string) {
    if (!this.canReadMatter(user, matterId)) {
      throw new NegotiationStoreError('NOT_FOUND', 'The settlement obligation was not found.');
    }
    const found = row(this.database.prepare(
      `SELECT id, settlement_id AS settlementId,
        settlement_terms_version_id AS settlementTermsVersionId,
        obligation_reference AS obligationReference, obligation_type AS obligationType,
        responsible_party AS responsibleParty, beneficiary, description,
        amount_minor AS amountMinor, due_at AS dueAt, timezone,
        evidence_requirement AS evidenceRequirement, created_by AS createdBy,
        created_at AS createdAt FROM settlement_obligations
       WHERE id = ? AND firm_id = ? AND matter_id = ?`,
    ).get(obligationId, user.firmId, matterId));
    if (!found) {
      throw new NegotiationStoreError('NOT_FOUND', 'The settlement obligation was not found.');
    }
    const events = rows(this.database.prepare(
      `SELECT id, event_type AS eventType, occurred_at AS occurredAt, note,
        amount_satisfied_minor AS amountSatisfiedMinor,
        evidence_document_version_ids_json AS evidenceDocumentVersionIdsJson,
        evidence_communication_entry_ids_json AS evidenceCommunicationEntryIdsJson,
        supersedes_event_id AS supersedesEventId, correction_reason AS correctionReason,
        waiver_authority_document_version_id AS waiverAuthorityDocumentVersionId,
        recorded_by AS recordedBy, recorded_at AS recordedAt
       FROM settlement_obligation_events
       WHERE obligation_id = ? AND firm_id = ? AND matter_id = ?
       ORDER BY occurred_at, recorded_at, id`,
    ).all(obligationId, user.firmId, matterId)).map((value) => ({
      id: String(value.id),
      eventType: String(value.eventType) as
        'due_confirmed' | 'performance_asserted' | 'part_satisfied' | 'satisfied' |
        'overdue_reviewed' | 'disputed' | 'waived' | 'corrected',
      occurredAt: String(value.occurredAt),
      note: String(value.note),
      amountSatisfiedMinor: value.amountSatisfiedMinor === null
        ? null
        : Number(value.amountSatisfiedMinor),
      evidenceDocumentVersionIds: parseJson<string[]>(value.evidenceDocumentVersionIdsJson, []),
      evidenceCommunicationEntryIds: parseJson<string[]>(
        value.evidenceCommunicationEntryIdsJson, [],
      ),
      supersedesEventId: value.supersedesEventId ? String(value.supersedesEventId) : null,
      correctionReason: String(value.correctionReason),
      waiverAuthorityDocumentVersionId: value.waiverAuthorityDocumentVersionId
        ? String(value.waiverAuthorityDocumentVersionId)
        : null,
      recordedBy: String(value.recordedBy),
      recordedAt: String(value.recordedAt),
    }));
    const dueAt = found.dueAt ? String(found.dueAt) : null;
    return {
      id: String(found.id),
      settlementId: String(found.settlementId),
      settlementTermsVersionId: String(found.settlementTermsVersionId),
      obligationReference: String(found.obligationReference),
      obligationType: String(found.obligationType),
      responsibleParty: String(found.responsibleParty),
      beneficiary: String(found.beneficiary),
      description: String(found.description),
      amountMinor: found.amountMinor === null ? null : Number(found.amountMinor),
      dueAt,
      timezone: String(found.timezone),
      evidenceRequirement: String(found.evidenceRequirement),
      events,
      projection: projectObligation(events, this.now().toISOString(), dueAt),
      createdBy: String(found.createdBy),
      createdAt: String(found.createdAt),
    };
  }

  createObligation(
    user: SessionUser,
    matterId: string,
    settlementId: string,
    input: CreateSettlementObligationInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    const settlement = this.getSettlement(user, matterId, settlementId);
    const payloadDigest = digest({ settlementId, input });
    const prior = this.receipt(user, matterId, 'create_obligation', input.idempotencyKey, payloadDigest);
    if (prior) return this.getObligation(user, matterId, String(prior.resultEntityId));
    return transaction(this.database, () => {
      this.requireScoped(
        'settlement_term_versions', user.firmId, matterId, input.settlementTermsVersionId,
      );
      const sequence = Number((this.database.prepare(
        `SELECT COUNT(*) + 1 AS next FROM settlement_obligations
         WHERE firm_id = ? AND matter_id = ? AND settlement_id = ?`,
      ).get(user.firmId, matterId, settlementId) as { next: number }).next);
      const id = randomUUID();
      const createdAt = this.now().toISOString();
      this.database.prepare(
        `INSERT INTO settlement_obligations (
          id, firm_id, matter_id, settlement_id, settlement_terms_version_id,
          obligation_reference, obligation_type, responsible_party, beneficiary,
          description, amount_minor, due_at, timezone, evidence_requirement,
          idempotency_key, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, user.firmId, matterId, settlementId, input.settlementTermsVersionId,
        `OB-${String(sequence).padStart(3, '0')}`, input.obligationType,
        input.responsibleParty, input.beneficiary, input.description, input.amountMinor,
        input.dueAt, input.timezone, input.evidenceRequirement, input.idempotencyKey,
        user.id, createdAt,
      );
      this.saveReceipt(
        user, matterId, 'create_obligation', input.idempotencyKey, payloadDigest,
        'settlement_obligation', id, createdAt,
      );
      const created = this.getObligation(user, matterId, id);
      this.appendOperational(user, matterId, {
        action: 'settlement.obligation_created', entityType: 'settlement_obligation',
        entityId: id, title: 'Settlement obligation created',
        idempotencyKey: input.idempotencyKey, confidentiality: settlement.confidentiality,
        after: created, occurredAt: createdAt,
      }, audit);
      return created;
    });
  }

  recordObligationEvent(
    user: SessionUser,
    matterId: string,
    obligationId: string,
    input: RecordSettlementObligationEventInput,
    audit: AuditContext,
  ) {
    this.requireWrite(user, matterId);
    const obligation = this.getObligation(user, matterId, obligationId);
    const settlement = this.getSettlement(user, matterId, obligation.settlementId);
    const payloadDigest = digest({ obligationId, input });
    const prior = this.receipt(
      user, matterId, 'record_obligation_event', input.idempotencyKey, payloadDigest,
    );
    if (prior) return this.getObligation(user, matterId, obligationId);
    return transaction(this.database, () => {
      for (const versionId of input.evidenceDocumentVersionIds) {
        this.resolveDocumentVersion(user.firmId, matterId, versionId);
      }
      for (const entryId of input.evidenceCommunicationEntryIds) {
        this.requireScoped('communication_entries', user.firmId, matterId, entryId);
      }
      this.requireScoped(
        'settlement_obligation_events', user.firmId, matterId, input.supersedesEventId,
      );
      const waiver = this.resolveDocumentVersion(
        user.firmId, matterId, input.waiverAuthorityDocumentVersionId,
      );
      const id = randomUUID();
      const recordedAt = this.now().toISOString();
      this.database.prepare(
        `INSERT INTO settlement_obligation_events (
          id, firm_id, matter_id, obligation_id, event_type, occurred_at, note,
          amount_satisfied_minor, evidence_document_version_ids_json,
          evidence_communication_entry_ids_json, supersedes_event_id, correction_reason,
          waiver_authority_document_id, waiver_authority_document_version_id,
          recorded_by, recorded_at, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, user.firmId, matterId, obligationId, input.eventType, input.occurredAt,
        input.note, input.amountSatisfiedMinor, canonicalJson(input.evidenceDocumentVersionIds),
        canonicalJson(input.evidenceCommunicationEntryIds), input.supersedesEventId,
        input.correctionReason, waiver?.documentId ?? null, waiver?.versionId ?? null,
        user.id, recordedAt, input.idempotencyKey,
      );
      this.saveReceipt(
        user, matterId, 'record_obligation_event', input.idempotencyKey, payloadDigest,
        'settlement_obligation_event', id, recordedAt,
      );
      const updated = this.getObligation(user, matterId, obligationId);
      this.appendOperational(user, matterId, {
        action: `settlement.obligation_${input.eventType}`,
        entityType: 'settlement_obligation', entityId: obligationId,
        title: 'Settlement obligation event recorded', idempotencyKey: input.idempotencyKey,
        confidentiality: settlement.confidentiality,
        after: { obligationId, eventId: id, eventType: input.eventType }, occurredAt: recordedAt,
      }, audit);
      return updated;
    });
  }

  getInstructionRecord(user: SessionUser, matterId: string, id: string) {
    if (!this.canReadMatter(user, matterId)) {
      throw new NegotiationStoreError('NOT_FOUND', 'The client instruction was not found.');
    }
    return this.getInstruction(user.firmId, matterId, id);
  }

  getAuthorityRecord(user: SessionUser, matterId: string, id: string) {
    if (!this.canReadMatter(user, matterId)) {
      throw new NegotiationStoreError('NOT_FOUND', 'The settlement authority was not found.');
    }
    return this.getAuthority(user.firmId, matterId, id);
  }

  getWorkspace(user: SessionUser, matterId: string) {
    if (!this.canReadMatter(user, matterId)) return undefined;
    const reviews = rows(this.database.prepare(
      `${reviewSelect} WHERE firm_id = ? AND matter_id = ? AND confidentiality = 'ordinary'
       ORDER BY review_number`,
    ).all(user.firmId, matterId)).map(mapReview);
    const instructions = rows(this.database.prepare(
      `${instructionSelect} WHERE firm_id = ? AND matter_id = ? AND confidentiality = 'ordinary'
       ORDER BY received_at, created_at, id`,
    ).all(user.firmId, matterId)).map(mapInstruction);
    const actions = rows(this.database.prepare(
      `SELECT id FROM negotiation_actions
       WHERE firm_id = ? AND matter_id = ? AND confidentiality = 'ordinary'
       ORDER BY created_at, id`,
    ).all(user.firmId, matterId)).map(({ id }) =>
      this.getAction(user, matterId, String(id)),
    );
    const settlements = rows(this.database.prepare(
      `SELECT id FROM settlements
       WHERE firm_id = ? AND matter_id = ? AND confidentiality = 'ordinary'
       ORDER BY created_at, id`,
    ).all(user.firmId, matterId)).map(({ id }) =>
      this.getSettlement(user, matterId, String(id)),
    );
    return { matterId, reviews, instructions, actions, settlements, currentAuthority: null };
  }

  getProtectedWorkspace(user: SessionUser, matterId: string) {
    if (!hasCapability(user, 'negotiation.read_protected') || !this.canReadMatter(user, matterId)) {
      throw new NegotiationStoreError('NOT_FOUND', 'The negotiation workspace was not found.');
    }
    const reviews = rows(this.database.prepare(
      `${reviewSelect} WHERE firm_id = ? AND matter_id = ? AND confidentiality <> 'ordinary'
       ORDER BY review_number`,
    ).all(user.firmId, matterId)).map(mapReview);
    const instructions = rows(this.database.prepare(
      `${instructionSelect} WHERE firm_id = ? AND matter_id = ? AND confidentiality <> 'ordinary'
       ORDER BY received_at, created_at, id`,
    ).all(user.firmId, matterId)).map(mapInstruction);
    const current = row(this.database.prepare(
      `${authoritySelect} WHERE firm_id = ? AND matter_id = ? ORDER BY version DESC LIMIT 1`,
    ).get(user.firmId, matterId));
    const actions = rows(this.database.prepare(
      `SELECT id FROM negotiation_actions
       WHERE firm_id = ? AND matter_id = ? AND confidentiality <> 'ordinary'
       ORDER BY created_at, id`,
    ).all(user.firmId, matterId)).map(({ id }) =>
      this.getAction(user, matterId, String(id)),
    );
    const settlements = rows(this.database.prepare(
      `SELECT id FROM settlements
       WHERE firm_id = ? AND matter_id = ? AND confidentiality <> 'ordinary'
       ORDER BY created_at, id`,
    ).all(user.firmId, matterId)).map(({ id }) =>
      this.getSettlement(user, matterId, String(id)),
    );
    return {
      matterId,
      reviews,
      instructions,
      actions,
      settlements,
      currentAuthority: current ? mapAuthority(current) : null,
    };
  }
}
