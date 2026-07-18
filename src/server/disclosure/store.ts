import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
  AddDisclosureCandidateInput,
  ApproveDisclosureRedactionInput,
  CreateInspectionRequestInput,
  CreateDisclosureAiSuggestionInput,
  GenerateDisclosureListInput,
  OpenDisclosureReviewInput,
  RecordDisclosureDecisionInput,
  RecordDisclosurePrivilegeReviewInput,
  RecordInspectionEventInput,
} from '../../shared/contracts.js';
import type { SessionUser } from '../policy.js';
import { appendAudit, appendTimeline, type AuditContext } from '../store.js';
import { projectDisclosureCandidate, projectInspection } from './projections.js';

type Row = Record<string, string | number | null>;
export type DisclosureStoreErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'IDEMPOTENCY_KEY_REUSED' | 'INVALID_LINK';

export class DisclosureStoreError extends Error {
  constructor(readonly code: DisclosureStoreErrorCode, message: string) {
    super(message);
    this.name = 'DisclosureStoreError';
  }
}

function canonicalJson(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object') return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)]),
    );
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

export class DisclosureStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private receipt<T>(firmId: string, matterId: string, scope: string, key: string, input: unknown): T | undefined {
    const raw = this.database.prepare(`SELECT input_hash AS inputHash, response_json AS responseJson
      FROM disclosure_command_receipts WHERE firm_id = ? AND matter_id = ?
      AND command_scope = ? AND idempotency_key = ?`).get(firmId, matterId, scope, key) as Row | undefined;
    const row = raw ? { inputHash: String(raw.inputHash), responseJson: String(raw.responseJson) } : undefined;
    if (!row) return undefined;
    if (row.inputHash !== digest(input)) throw new DisclosureStoreError(
      'IDEMPOTENCY_KEY_REUSED', 'The idempotency key was already used with different input.',
    );
    return JSON.parse(row.responseJson) as T;
  }

  private saveReceipt(user: SessionUser, matterId: string, proceedingId: string, scope: string,
    routeEntityId: string, key: string, input: unknown, response: unknown, createdAt: string) {
    this.database.prepare(`INSERT INTO disclosure_command_receipts (
      id, firm_id, matter_id, proceeding_id, command_scope, route_entity_id,
      idempotency_key, input_hash, response_json, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      randomUUID(), user.firmId, matterId, proceedingId, scope, routeEntityId,
      key, digest(input), canonicalJson(response), user.id, createdAt,
    );
  }

  private appendOperational(user: SessionUser, matterId: string, details: {
    action: string; entityType: string; entityId: string; title: string;
    idempotencyKey: string; occurredAt: string; sensitive?: boolean;
  }, audit: AuditContext) {
    const metadata = { entityType: details.entityType, entityId: details.entityId, restricted: Boolean(details.sensitive) };
    appendTimeline(this.database, {
      firmId: user.firmId, matterId, type: details.action, title: details.title,
      actorUserId: user.id, occurredAt: details.occurredAt, metadata,
    });
    appendAudit(this.database, {
      firmId: user.firmId, matterId, userId: user.id, action: details.action,
      entityType: details.entityType, entityId: details.entityId, after: metadata,
      requestId: audit.requestId, ipAddress: audit.ipAddress, createdAt: details.occurredAt,
    });
    this.database.prepare(`INSERT INTO domain_events (
      id, firm_id, matter_id, type, occurred_on, actor_user_id,
      idempotency_key, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      randomUUID(), user.firmId, matterId, details.action, details.occurredAt.slice(0, 10), user.id,
      `disclosure:${details.action}:${details.idempotencyKey}`, canonicalJson(metadata), details.occurredAt,
    );
    this.database.prepare(`INSERT INTO integration_outbox (
      id, firm_id, matter_id, topic, payload_json, status, attempts,
      available_at, created_at, deduplication_key
    ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`).run(
      randomUUID(), user.firmId, matterId, details.action,
      canonicalJson({ matterId, ...metadata }), details.occurredAt, details.occurredAt,
      `disclosure:${user.firmId}:${matterId}:${details.action}:${details.idempotencyKey}`,
    );
  }

  private assertProceeding(firmId: string, matterId: string, proceedingId: string) {
    if (!this.database.prepare(`SELECT 1 FROM court_proceedings WHERE id = ? AND firm_id = ? AND matter_id = ?`)
      .get(proceedingId, firmId, matterId)) throw new DisclosureStoreError('NOT_FOUND', 'Disclosure record not found.');
  }

  private assertParty(firmId: string, matterId: string, partyId: string) {
    if (!this.database.prepare(`SELECT 1 FROM parties WHERE id = ? AND firm_id = ? AND matter_id = ?`)
      .get(partyId, firmId, matterId)) throw new DisclosureStoreError('INVALID_LINK', 'The disclosure party was not found.');
  }

  private assertDocumentVersion(firmId: string, matterId: string, versionId: string) {
    if (!this.database.prepare(`SELECT 1 FROM document_versions dv JOIN documents d
      ON d.id = dv.document_id AND d.firm_id = dv.firm_id
      WHERE dv.id = ? AND dv.firm_id = ? AND d.matter_id = ?`).get(versionId, firmId, matterId)) {
      throw new DisclosureStoreError('INVALID_LINK', 'The exact document version was not found.');
    }
  }

  getCandidate(firmId: string, matterId: string, candidateId: string) {
    const row = this.database.prepare(`SELECT id, review_id AS reviewId, document_version_id AS documentVersionId,
      evidence_item_id AS evidenceItemId, custodian, source_note AS sourceNote, version,
      created_at AS createdAt, updated_at AS updatedAt FROM disclosure_documents
      WHERE id = ? AND firm_id = ? AND matter_id = ?`).get(candidateId, firmId, matterId) as Row | undefined;
    if (!row) return undefined;
    const suggestions = (this.database.prepare(`SELECT id, relevance, privilege_warning AS privilegeWarning,
      rationale, model, policy_version AS policyVersion, source_hash AS sourceHash,
      cited_spans_json AS citedSpansJson, issue_tags_json AS issueTagsJson,
      created_by AS createdBy, created_at AS createdAt FROM disclosure_ai_suggestions
      WHERE candidate_id = ? AND firm_id = ? AND matter_id = ? ORDER BY created_at, id`)
      .all(candidateId, firmId, matterId) as Row[]).map((item) => ({
        id: String(item.id), relevance: String(item.relevance) as 'likely_relevant' | 'likely_not_relevant' | 'uncertain',
        privilegeWarning: String(item.privilegeWarning) as 'none' | 'possible' | 'likely',
        rationale: String(item.rationale), model: String(item.model), policyVersion: String(item.policyVersion),
        sourceHash: String(item.sourceHash), citedSpans: JSON.parse(String(item.citedSpansJson)) as string[],
        suggestedIssueTags: JSON.parse(String(item.issueTagsJson)) as string[], createdBy: String(item.createdBy),
        createdAt: String(item.createdAt), provisional: true as const,
      }));
    const decisions = (this.database.prepare(`SELECT id, decision, redaction_required AS redactionRequired,
      reason, reviewed_by AS reviewedBy, reviewed_at AS reviewedAt, created_at AS createdAt
      FROM disclosure_decisions WHERE candidate_id = ? AND firm_id = ? AND matter_id = ?
      ORDER BY reviewed_at, id`).all(candidateId, firmId, matterId) as Row[]).map((item) => ({
        id: String(item.id), decision: String(item.decision) as 'disclose' | 'withhold_privilege' | 'withhold_not_relevant' | 'withhold_other' | 'duplicate_only' | 'review_required',
        redactionRequired: Boolean(item.redactionRequired), reason: String(item.reason),
        reviewedBy: String(item.reviewedBy), reviewedAt: String(item.reviewedAt), createdAt: String(item.createdAt),
      }));
    const privilegeReviews = (this.database.prepare(`SELECT id, category, outcome, basis,
      authority_document_version_id AS authorityDocumentVersionId, confirm_exposure AS confirmExposure,
      reviewed_by AS reviewedBy, reviewed_at AS reviewedAt, created_at AS createdAt
      FROM disclosure_privilege_reviews WHERE candidate_id = ? AND firm_id = ? AND matter_id = ?
      ORDER BY reviewed_at, id`).all(candidateId, firmId, matterId) as Row[]).map((item) => ({
        id: String(item.id), category: String(item.category),
        outcome: String(item.outcome) as 'restricted' | 'not_privileged' | 'further_review' | 'waived',
        basis: String(item.basis), authorityDocumentVersionId: item.authorityDocumentVersionId ? String(item.authorityDocumentVersionId) : null,
        confirmExposure: Boolean(item.confirmExposure), reviewedBy: String(item.reviewedBy),
        reviewedAt: String(item.reviewedAt), createdAt: String(item.createdAt),
      }));
    const redactions = (this.database.prepare(`SELECT id, original_document_version_id AS originalDocumentVersionId,
      redacted_document_version_id AS redactedDocumentVersionId, categories_json AS categoriesJson,
      reason, status, visual_review_confirmed AS visualReviewConfirmed, reviewed_by AS reviewedBy,
      reviewed_at AS reviewedAt, created_at AS createdAt FROM disclosure_redactions
      WHERE candidate_id = ? AND firm_id = ? AND matter_id = ? ORDER BY reviewed_at, id`)
      .all(candidateId, firmId, matterId) as Row[]).map((item) => ({
        id: String(item.id), originalDocumentVersionId: String(item.originalDocumentVersionId),
        redactedDocumentVersionId: String(item.redactedDocumentVersionId),
        categories: JSON.parse(String(item.categoriesJson)) as string[], reason: String(item.reason),
        status: String(item.status) as 'awaiting_review' | 'approved' | 'rejected',
        visualReviewConfirmed: Boolean(item.visualReviewConfirmed), reviewedBy: String(item.reviewedBy),
        reviewedAt: String(item.reviewedAt), createdAt: String(item.createdAt),
      }));
    return {
      id: String(row.id), reviewId: String(row.reviewId), documentVersionId: String(row.documentVersionId),
      evidenceItemId: row.evidenceItemId ? String(row.evidenceItemId) : null,
      custodian: String(row.custodian), sourceNote: String(row.sourceNote), version: Number(row.version),
      createdAt: String(row.createdAt), updatedAt: String(row.updatedAt), suggestions,
      decisions, privilegeReviews, redactions,
      projection: projectDisclosureCandidate({
        documentVersionId: String(row.documentVersionId), suggestions,
        decisions, privilegeReviews, redactions,
      }),
    };
  }

  getReview(firmId: string, matterId: string, reviewId: string) {
    const row = this.database.prepare(`SELECT id, proceeding_id AS proceedingId,
      disclosing_party_id AS disclosingPartyId, direction_id AS directionId,
      scope_version AS scopeVersion, scope_note AS scopeNote, date_from AS dateFrom, date_to AS dateTo,
      custodians_json AS custodiansJson, issue_tags_json AS issueTagsJson, version,
      created_at AS createdAt, updated_at AS updatedAt FROM disclosure_reviews
      WHERE id = ? AND firm_id = ? AND matter_id = ?`).get(reviewId, firmId, matterId) as Row | undefined;
    if (!row) return undefined;
    const ids = this.database.prepare(`SELECT id FROM disclosure_documents WHERE review_id = ?
      AND firm_id = ? AND matter_id = ? ORDER BY created_at, id`).all(reviewId, firmId, matterId) as Array<{ id: string }>;
    return {
      id: String(row.id), proceedingId: String(row.proceedingId), disclosingPartyId: String(row.disclosingPartyId),
      directionId: row.directionId ? String(row.directionId) : null, scopeVersion: Number(row.scopeVersion),
      scopeNote: String(row.scopeNote), dateFrom: row.dateFrom ? String(row.dateFrom) : null,
      dateTo: row.dateTo ? String(row.dateTo) : null, custodians: JSON.parse(String(row.custodiansJson)) as string[],
      issueTags: JSON.parse(String(row.issueTagsJson)) as string[], version: Number(row.version),
      createdAt: String(row.createdAt), updatedAt: String(row.updatedAt),
      candidates: ids.map(({ id }) => this.getCandidate(firmId, matterId, id)!),
      lists: (this.database.prepare(`SELECT id FROM disclosure_lists WHERE review_id = ? AND firm_id = ? AND matter_id = ?
        ORDER BY snapshot_number, id`).all(reviewId, firmId, matterId) as Array<{ id: string }>).map(({ id }) => this.getList(firmId, matterId, id)!),
      inspectionRequests: (this.database.prepare(`SELECT ir.id FROM inspection_requests ir JOIN disclosure_lists dl
        ON dl.id = ir.disclosure_list_id AND dl.firm_id = ir.firm_id AND dl.matter_id = ir.matter_id
        WHERE dl.review_id = ? AND ir.firm_id = ? AND ir.matter_id = ? ORDER BY ir.created_at, ir.id`)
        .all(reviewId, firmId, matterId) as Array<{ id: string }>).map(({ id }) => this.getInspectionRequest(firmId, matterId, id)!),
    };
  }

  getList(firmId: string, matterId: string, listId: string) {
    const row = this.database.prepare(`SELECT dl.id, dl.review_id AS reviewId, dl.snapshot_number AS snapshotNumber,
      dl.title, dl.blockers_json AS blockersJson, dl.generated_by AS generatedBy, dl.generated_at AS generatedAt,
      dl.note, dr.disclosing_party_id AS disclosingPartyId FROM disclosure_lists dl JOIN disclosure_reviews dr
      ON dr.id = dl.review_id AND dr.firm_id = dl.firm_id AND dr.matter_id = dl.matter_id
      WHERE dl.id = ? AND dl.firm_id = ? AND dl.matter_id = ?`).get(listId, firmId, matterId) as Row | undefined;
    if (!row) return undefined;
    const entries = (this.database.prepare(`SELECT id, candidate_id AS candidateId, document_version_id AS documentVersionId,
      decision_id AS decisionId, description FROM disclosure_list_entries WHERE disclosure_list_id = ?
      AND firm_id = ? AND matter_id = ? ORDER BY id`).all(listId, firmId, matterId) as Row[]).map((item) => ({
        id: String(item.id), candidateId: String(item.candidateId), documentVersionId: String(item.documentVersionId),
        decisionId: String(item.decisionId), description: String(item.description),
      }));
    return { id: String(row.id), reviewId: String(row.reviewId), disclosingPartyId: String(row.disclosingPartyId),
      snapshotNumber: Number(row.snapshotNumber), title: String(row.title),
      blockers: JSON.parse(String(row.blockersJson)) as Array<{ candidateId: string; reason: string }>,
      generatedBy: String(row.generatedBy), generatedAt: String(row.generatedAt), note: String(row.note), entries };
  }

  getInspectionRequest(firmId: string, matterId: string, requestId: string) {
    const row = this.database.prepare(`SELECT id, disclosure_list_id AS disclosureListId,
      requesting_party_id AS requestingPartyId, version, received_at AS receivedAt, note,
      created_at AS createdAt, updated_at AS updatedAt FROM inspection_requests
      WHERE id = ? AND firm_id = ? AND matter_id = ?`).get(requestId, firmId, matterId) as Row | undefined;
    if (!row) return undefined;
    const itemIds = (this.database.prepare(`SELECT list_entry_id AS id FROM inspection_request_items
      WHERE inspection_request_id = ? AND firm_id = ? AND matter_id = ? ORDER BY id`)
      .all(requestId, firmId, matterId) as Array<{ id: string }>).map(({ id }) => id);
    const events = (this.database.prepare(`SELECT id, event_type AS eventType, provided_document_version_id AS providedDocumentVersionId,
      delivery_evidence_document_version_id AS deliveryEvidenceDocumentVersionId, occurred_at AS occurredAt,
      note, recorded_by AS recordedBy, recorded_at AS recordedAt FROM inspection_events
      WHERE inspection_request_id = ? AND firm_id = ? AND matter_id = ? ORDER BY occurred_at, recorded_at, id`)
      .all(requestId, firmId, matterId) as Row[]).map((event) => ({
        id: String(event.id), eventType: String(event.eventType) as 'received' | 'acknowledged' | 'refused' | 'agreed' | 'provided' | 'completed',
        providedDocumentVersionId: event.providedDocumentVersionId ? String(event.providedDocumentVersionId) : null,
        deliveryEvidenceDocumentVersionId: event.deliveryEvidenceDocumentVersionId ? String(event.deliveryEvidenceDocumentVersionId) : null,
        occurredAt: String(event.occurredAt), note: String(event.note), recordedBy: String(event.recordedBy), recordedAt: String(event.recordedAt),
      }));
    return { id: String(row.id), disclosureListId: String(row.disclosureListId), requestingPartyId: String(row.requestingPartyId),
      version: Number(row.version), receivedAt: String(row.receivedAt), note: String(row.note), itemIds,
      createdAt: String(row.createdAt), updatedAt: String(row.updatedAt), events,
      projection: projectInspection(events),
    };
  }

  getWorkspace(firmId: string, matterId: string, proceedingId: string) {
    if (!this.database.prepare(`SELECT 1 FROM court_proceedings WHERE id = ? AND firm_id = ? AND matter_id = ?`)
      .get(proceedingId, firmId, matterId)) return undefined;
    const reviews = (this.database.prepare(`SELECT id FROM disclosure_reviews WHERE proceeding_id = ?
      AND firm_id = ? AND matter_id = ? ORDER BY created_at, id`).all(proceedingId, firmId, matterId) as Array<{ id: string }>)
      .map(({ id }) => this.getReview(firmId, matterId, id)!);
    const documents = (this.database.prepare(`SELECT dv.id, d.title, dv.version, dv.original_name AS originalName
      FROM document_versions dv JOIN documents d ON d.id = dv.document_id AND d.firm_id = dv.firm_id
      WHERE dv.firm_id = ? AND d.matter_id = ? ORDER BY d.title, dv.version DESC`)
      .all(firmId, matterId) as Row[]).map((item) => ({
        id: String(item.id), title: String(item.title), version: Number(item.version), originalName: String(item.originalName),
      }));
    const parties = (this.database.prepare(`SELECT id, name, kind FROM parties WHERE firm_id = ? AND matter_id = ? ORDER BY name, id`)
      .all(firmId, matterId) as Row[]).map((item) => ({ id: String(item.id), name: String(item.name), kind: String(item.kind) }));
    return { proceedingId, reviews, sources: { documents, parties } };
  }

  openReview(user: SessionUser, matterId: string, proceedingId: string, input: OpenDisclosureReviewInput, audit: AuditContext) {
    const scope = `review:${proceedingId}`;
    const replay = this.receipt<ReturnType<DisclosureStore['getReview']>>(user.firmId, matterId, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      this.assertProceeding(user.firmId, matterId, proceedingId);
      this.assertParty(user.firmId, matterId, input.disclosingPartyId);
      if (input.directionId && !this.database.prepare(`SELECT 1 FROM court_directions WHERE id = ? AND firm_id = ? AND matter_id = ? AND proceeding_id = ?`)
        .get(input.directionId, user.firmId, matterId, proceedingId)) throw new DisclosureStoreError('INVALID_LINK', 'The disclosure direction was not found.');
      const id = randomUUID(); const createdAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO disclosure_reviews (
        id, firm_id, matter_id, proceeding_id, disclosing_party_id, direction_id,
        scope_note, date_from, date_to, custodians_json, issue_tags_json, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, user.firmId, matterId, proceedingId, input.disclosingPartyId, input.directionId,
        input.scopeNote, input.dateFrom, input.dateTo, canonicalJson(input.custodians), canonicalJson(input.issueTags),
        user.id, createdAt, createdAt,
      );
      this.database.prepare(`INSERT INTO disclosure_review_events (
        id, firm_id, matter_id, review_id, event_type, note, occurred_at, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, 'opened', ?, ?, ?, ?)`).run(
        randomUUID(), user.firmId, matterId, id, input.scopeNote, createdAt, user.id, createdAt,
      );
      const response = this.getReview(user.firmId, matterId, id)!;
      this.appendOperational(user, matterId, { action: 'disclosure.review_opened', entityType: 'disclosure_review',
        entityId: id, title: 'Disclosure review opened', idempotencyKey: input.idempotencyKey, occurredAt: createdAt }, audit);
      this.saveReceipt(user, matterId, proceedingId, scope, id, input.idempotencyKey, input, response, createdAt);
      return response;
    });
  }

  addCandidate(user: SessionUser, matterId: string, proceedingId: string, reviewId: string,
    input: AddDisclosureCandidateInput, audit: AuditContext) {
    const scope = `candidate:${reviewId}`;
    const replay = this.receipt<ReturnType<DisclosureStore['getCandidate']>>(user.firmId, matterId, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      const review = this.getReview(user.firmId, matterId, reviewId);
      if (!review || review.proceedingId !== proceedingId) throw new DisclosureStoreError('NOT_FOUND', 'Disclosure record not found.');
      if (review.version !== input.expectedVersion) throw new DisclosureStoreError('CONFLICT', 'The disclosure review changed before this command.');
      this.assertDocumentVersion(user.firmId, matterId, input.documentVersionId);
      if (input.evidenceItemId && !this.database.prepare(`SELECT 1 FROM evidence_items WHERE id = ? AND firm_id = ? AND matter_id = ?`)
        .get(input.evidenceItemId, user.firmId, matterId)) throw new DisclosureStoreError('INVALID_LINK', 'The evidence item was not found.');
      const id = randomUUID(); const createdAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO disclosure_documents (
        id, firm_id, matter_id, review_id, document_version_id, evidence_item_id,
        custodian, source_note, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, user.firmId, matterId, reviewId, input.documentVersionId, input.evidenceItemId,
        input.custodian, input.sourceNote, user.id, createdAt, createdAt,
      );
      this.database.prepare(`UPDATE disclosure_reviews SET version = version + 1, updated_at = ?
        WHERE id = ? AND firm_id = ? AND matter_id = ?`).run(createdAt, reviewId, user.firmId, matterId);
      const response = this.getCandidate(user.firmId, matterId, id)!;
      this.appendOperational(user, matterId, { action: 'disclosure.candidate_added', entityType: 'disclosure_candidate',
        entityId: id, title: 'Exact disclosure candidate retained', idempotencyKey: input.idempotencyKey,
        occurredAt: createdAt, sensitive: true }, audit);
      this.saveReceipt(user, matterId, proceedingId, scope, id, input.idempotencyKey, input, response, createdAt);
      return response;
    });
  }

  recordAiSuggestion(user: SessionUser, matterId: string, proceedingId: string, candidateId: string,
    input: CreateDisclosureAiSuggestionInput, audit: AuditContext) {
    const scope = `ai:${candidateId}`;
    const replay = this.receipt<Record<string, unknown>>(user.firmId, matterId, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      const candidate = this.getCandidate(user.firmId, matterId, candidateId);
      if (!candidate) throw new DisclosureStoreError('NOT_FOUND', 'Disclosure record not found.');
      const review = this.getReview(user.firmId, matterId, candidate.reviewId);
      if (!review || review.proceedingId !== proceedingId) throw new DisclosureStoreError('NOT_FOUND', 'Disclosure record not found.');
      const id = randomUUID(); const createdAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO disclosure_ai_suggestions (
        id, firm_id, matter_id, candidate_id, relevance, privilege_warning, rationale,
        model, policy_version, source_hash, cited_spans_json, issue_tags_json, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, user.firmId, matterId, candidateId, input.relevance, input.privilegeWarning, input.rationale,
        input.model, input.policyVersion, input.sourceHash, canonicalJson(input.citedSpans),
        canonicalJson(input.suggestedIssueTags), user.id, createdAt,
      );
      const response = this.getCandidate(user.firmId, matterId, candidateId)!.suggestions.at(-1)!;
      this.appendOperational(user, matterId, { action: 'disclosure.ai_suggestion_recorded', entityType: 'disclosure_candidate',
        entityId: candidateId, title: 'Provisional disclosure suggestion recorded', idempotencyKey: input.idempotencyKey,
        occurredAt: createdAt, sensitive: true }, audit);
      this.saveReceipt(user, matterId, proceedingId, scope, candidateId, input.idempotencyKey, input, response, createdAt);
      return response;
    });
  }

  recordDecision(user: SessionUser, matterId: string, proceedingId: string, candidateId: string,
    input: RecordDisclosureDecisionInput, audit: AuditContext) {
    const scope = `decision:${candidateId}`;
    const replay = this.receipt<ReturnType<DisclosureStore['getCandidate']>>(user.firmId, matterId, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      const candidate = this.getCandidate(user.firmId, matterId, candidateId);
      const review = candidate ? this.getReview(user.firmId, matterId, candidate.reviewId) : undefined;
      if (!candidate || !review || review.proceedingId !== proceedingId) throw new DisclosureStoreError('NOT_FOUND', 'Disclosure record not found.');
      if (candidate.version !== input.expectedVersion) throw new DisclosureStoreError('CONFLICT', 'The disclosure candidate changed before this command.');
      if (input.decision === 'disclose' && candidate.projection.restricted) {
        throw new DisclosureStoreError('CONFLICT', 'Resolve the privilege warning before recording disclosure.');
      }
      const previous = candidate.decisions.at(-1); const id = randomUUID(); const createdAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO disclosure_decisions (
        id, firm_id, matter_id, candidate_id, decision, reason, redaction_required,
        supersedes_decision_id, reviewed_by, reviewed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, user.firmId, matterId, candidateId, input.decision, input.reason, Number(input.redactionRequired),
        previous?.id ?? null, user.id, input.reviewedAt, createdAt,
      );
      this.database.prepare(`UPDATE disclosure_documents SET version = version + 1, updated_at = ?
        WHERE id = ? AND firm_id = ? AND matter_id = ?`).run(createdAt, candidateId, user.firmId, matterId);
      const response = this.getCandidate(user.firmId, matterId, candidateId)!;
      this.appendOperational(user, matterId, { action: 'disclosure.decision_recorded', entityType: 'disclosure_candidate',
        entityId: candidateId, title: 'Human disclosure decision recorded', idempotencyKey: input.idempotencyKey,
        occurredAt: createdAt, sensitive: true }, audit);
      this.saveReceipt(user, matterId, proceedingId, scope, candidateId, input.idempotencyKey, input, response, createdAt);
      return response;
    });
  }

  recordPrivilegeReview(user: SessionUser, matterId: string, proceedingId: string, candidateId: string,
    input: RecordDisclosurePrivilegeReviewInput, audit: AuditContext) {
    const scope = `privilege:${candidateId}`;
    const replay = this.receipt<ReturnType<DisclosureStore['getCandidate']>>(user.firmId, matterId, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      const candidate = this.getCandidate(user.firmId, matterId, candidateId);
      const review = candidate ? this.getReview(user.firmId, matterId, candidate.reviewId) : undefined;
      if (!candidate || !review || review.proceedingId !== proceedingId) throw new DisclosureStoreError('NOT_FOUND', 'Disclosure record not found.');
      if (candidate.version !== input.expectedVersion) throw new DisclosureStoreError('CONFLICT', 'The disclosure candidate changed before this command.');
      if (input.authorityDocumentVersionId) this.assertDocumentVersion(user.firmId, matterId, input.authorityDocumentVersionId);
      const id = randomUUID(); const createdAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO disclosure_privilege_reviews (
        id, firm_id, matter_id, candidate_id, category, outcome, basis,
        authority_document_version_id, confirm_exposure, reviewed_by, reviewed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, user.firmId, matterId, candidateId, input.category, input.outcome, input.basis,
        input.authorityDocumentVersionId, Number(input.confirmExposure), user.id, input.reviewedAt, createdAt,
      );
      this.database.prepare(`UPDATE disclosure_documents SET version = version + 1, updated_at = ?
        WHERE id = ? AND firm_id = ? AND matter_id = ?`).run(createdAt, candidateId, user.firmId, matterId);
      const response = this.getCandidate(user.firmId, matterId, candidateId)!;
      this.appendOperational(user, matterId, { action: 'disclosure.privilege_review_recorded', entityType: 'disclosure_candidate',
        entityId: candidateId, title: 'Restricted disclosure review recorded', idempotencyKey: input.idempotencyKey,
        occurredAt: createdAt, sensitive: true }, audit);
      this.saveReceipt(user, matterId, proceedingId, scope, candidateId, input.idempotencyKey, input, response, createdAt);
      return response;
    });
  }

  approveRedaction(user: SessionUser, matterId: string, proceedingId: string, candidateId: string,
    input: ApproveDisclosureRedactionInput, audit: AuditContext) {
    const scope = `redaction:${candidateId}`;
    const replay = this.receipt<ReturnType<DisclosureStore['getCandidate']>>(user.firmId, matterId, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      const candidate = this.getCandidate(user.firmId, matterId, candidateId);
      const review = candidate ? this.getReview(user.firmId, matterId, candidate.reviewId) : undefined;
      if (!candidate || !review || review.proceedingId !== proceedingId) throw new DisclosureStoreError('NOT_FOUND', 'Disclosure record not found.');
      if (candidate.version !== input.expectedVersion) throw new DisclosureStoreError('CONFLICT', 'The disclosure candidate changed before this command.');
      if (candidate.documentVersionId === input.redactedDocumentVersionId) throw new DisclosureStoreError('INVALID_LINK', 'The redacted version must differ from the original.');
      this.assertDocumentVersion(user.firmId, matterId, input.redactedDocumentVersionId);
      const id = randomUUID(); const createdAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO disclosure_redactions (
        id, firm_id, matter_id, candidate_id, original_document_version_id, redacted_document_version_id,
        categories_json, reason, status, visual_review_confirmed, reviewed_by, reviewed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', 1, ?, ?, ?)`).run(
        id, user.firmId, matterId, candidateId, candidate.documentVersionId, input.redactedDocumentVersionId,
        canonicalJson(input.categories), input.reason, user.id, input.reviewedAt, createdAt,
      );
      this.database.prepare(`UPDATE disclosure_documents SET version = version + 1, updated_at = ?
        WHERE id = ? AND firm_id = ? AND matter_id = ?`).run(createdAt, candidateId, user.firmId, matterId);
      const response = this.getCandidate(user.firmId, matterId, candidateId)!;
      this.appendOperational(user, matterId, { action: 'disclosure.redaction_approved', entityType: 'disclosure_candidate',
        entityId: candidateId, title: 'Exact disclosure redaction approved', idempotencyKey: input.idempotencyKey,
        occurredAt: createdAt, sensitive: true }, audit);
      this.saveReceipt(user, matterId, proceedingId, scope, candidateId, input.idempotencyKey, input, response, createdAt);
      return response;
    });
  }

  generateList(user: SessionUser, matterId: string, proceedingId: string, reviewId: string,
    input: GenerateDisclosureListInput, audit: AuditContext) {
    const scope = `list:${reviewId}`;
    const replay = this.receipt<ReturnType<DisclosureStore['getList']>>(user.firmId, matterId, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      const review = this.getReview(user.firmId, matterId, reviewId);
      if (!review || review.proceedingId !== proceedingId) throw new DisclosureStoreError('NOT_FOUND', 'Disclosure record not found.');
      if (review.version !== input.expectedVersion) throw new DisclosureStoreError('CONFLICT', 'The disclosure review changed before this command.');
      const blockers = review.candidates.filter((candidate) => !candidate.projection.canList).map((candidate) => ({
        candidateId: candidate.id,
        reason: candidate.projection.restricted ? 'privilege_restricted' : candidate.decisions.length ? 'decision_not_disclosable' : 'human_decision_required',
      }));
      const snapshotNumber = Number((this.database.prepare(`SELECT COALESCE(MAX(snapshot_number), 0) + 1 AS value
        FROM disclosure_lists WHERE review_id = ? AND firm_id = ? AND matter_id = ?`).get(reviewId, user.firmId, matterId) as { value: number }).value);
      const id = randomUUID(); const createdAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO disclosure_lists (
        id, firm_id, matter_id, review_id, snapshot_number, title, blockers_json,
        generated_by, generated_at, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, user.firmId, matterId, reviewId, snapshotNumber, input.title, canonicalJson(blockers),
        user.id, input.generatedAt, input.note,
      );
      for (const candidate of review.candidates.filter((item) => item.projection.canList)) {
        this.database.prepare(`INSERT INTO disclosure_list_entries (
          id, firm_id, matter_id, disclosure_list_id, candidate_id, document_version_id, decision_id, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          randomUUID(), user.firmId, matterId, id, candidate.id, candidate.projection.effectiveDocumentVersionId,
          candidate.decisions.at(-1)!.id, candidate.sourceNote,
        );
      }
      const response = this.getList(user.firmId, matterId, id)!;
      this.appendOperational(user, matterId, { action: 'disclosure.list_generated', entityType: 'disclosure_list',
        entityId: id, title: 'Immutable disclosure list snapshot generated', idempotencyKey: input.idempotencyKey,
        occurredAt: createdAt, sensitive: true }, audit);
      this.saveReceipt(user, matterId, proceedingId, scope, id, input.idempotencyKey, input, response, createdAt);
      return response;
    });
  }

  createInspectionRequest(user: SessionUser, matterId: string, proceedingId: string, reviewId: string,
    input: CreateInspectionRequestInput, audit: AuditContext) {
    const scope = `inspection:${reviewId}`;
    const replay = this.receipt<ReturnType<DisclosureStore['getInspectionRequest']>>(user.firmId, matterId, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      const review = this.getReview(user.firmId, matterId, reviewId);
      const list = this.getList(user.firmId, matterId, input.disclosureListId);
      if (!review || !list || review.proceedingId !== proceedingId || list.reviewId !== reviewId) throw new DisclosureStoreError('NOT_FOUND', 'Disclosure record not found.');
      this.assertParty(user.firmId, matterId, input.requestingPartyId);
      const allowed = new Set(list.entries.map(({ id }) => id));
      if (input.entryIds.some((id) => !allowed.has(id))) throw new DisclosureStoreError('INVALID_LINK', 'The disclosure list entry was not found.');
      const id = randomUUID(); const createdAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO inspection_requests (
        id, firm_id, matter_id, disclosure_list_id, requesting_party_id, received_at,
        note, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, user.firmId, matterId, input.disclosureListId, input.requestingPartyId, input.receivedAt,
        input.note, user.id, createdAt, createdAt,
      );
      for (const entryId of input.entryIds) this.database.prepare(`INSERT INTO inspection_request_items (
        id, firm_id, matter_id, inspection_request_id, list_entry_id
      ) VALUES (?, ?, ?, ?, ?)`).run(randomUUID(), user.firmId, matterId, id, entryId);
      this.database.prepare(`INSERT INTO inspection_events (
        id, firm_id, matter_id, inspection_request_id, event_type, occurred_at, note, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, 'received', ?, ?, ?, ?)`).run(
        randomUUID(), user.firmId, matterId, id, input.receivedAt, input.note, user.id, createdAt,
      );
      const response = this.getInspectionRequest(user.firmId, matterId, id)!;
      this.appendOperational(user, matterId, { action: 'disclosure.inspection_requested', entityType: 'inspection_request',
        entityId: id, title: 'Disclosure inspection request recorded', idempotencyKey: input.idempotencyKey,
        occurredAt: createdAt, sensitive: true }, audit);
      this.saveReceipt(user, matterId, proceedingId, scope, id, input.idempotencyKey, input, response, createdAt);
      return response;
    });
  }

  recordInspectionEvent(user: SessionUser, matterId: string, proceedingId: string, requestId: string,
    input: RecordInspectionEventInput, audit: AuditContext) {
    const scope = `inspection-event:${requestId}`;
    const replay = this.receipt<ReturnType<DisclosureStore['getInspectionRequest']>>(user.firmId, matterId, scope, input.idempotencyKey, input);
    if (replay) return replay;
    return transaction(this.database, () => {
      const request = this.getInspectionRequest(user.firmId, matterId, requestId);
      const list = request ? this.getList(user.firmId, matterId, request.disclosureListId) : undefined;
      const review = list ? this.getReview(user.firmId, matterId, list.reviewId) : undefined;
      if (!request || !list || !review || review.proceedingId !== proceedingId) throw new DisclosureStoreError('NOT_FOUND', 'Disclosure record not found.');
      if (request.version !== input.expectedVersion) throw new DisclosureStoreError('CONFLICT', 'The inspection request changed before this command.');
      if (input.eventType === 'completed' && !request.projection.provided) throw new DisclosureStoreError('CONFLICT', 'Inspection cannot be completed before provision.');
      if (input.providedDocumentVersionId) this.assertDocumentVersion(user.firmId, matterId, input.providedDocumentVersionId);
      if (input.deliveryEvidenceDocumentVersionId) this.assertDocumentVersion(user.firmId, matterId, input.deliveryEvidenceDocumentVersionId);
      const createdAt = this.now().toISOString();
      this.database.prepare(`INSERT INTO inspection_events (
        id, firm_id, matter_id, inspection_request_id, event_type, provided_document_version_id,
        delivery_evidence_document_version_id, occurred_at, note, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        randomUUID(), user.firmId, matterId, requestId, input.eventType, input.providedDocumentVersionId,
        input.deliveryEvidenceDocumentVersionId, input.occurredAt, input.note, user.id, createdAt,
      );
      this.database.prepare(`UPDATE inspection_requests SET version = version + 1, updated_at = ?
        WHERE id = ? AND firm_id = ? AND matter_id = ?`).run(createdAt, requestId, user.firmId, matterId);
      const response = this.getInspectionRequest(user.firmId, matterId, requestId)!;
      this.appendOperational(user, matterId, { action: `disclosure.inspection_${input.eventType}`, entityType: 'inspection_request',
        entityId: requestId, title: 'Disclosure inspection event recorded', idempotencyKey: input.idempotencyKey,
        occurredAt: createdAt, sensitive: true }, audit);
      this.saveReceipt(user, matterId, proceedingId, scope, requestId, input.idempotencyKey, input, response, createdAt);
      return response;
    });
  }
}
