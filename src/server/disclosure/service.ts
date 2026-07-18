import {
  addDisclosureCandidateSchema,
  approveDisclosureRedactionSchema,
  createDisclosureAiSuggestionSchema,
  createInspectionRequestSchema,
  generateDisclosureListSchema,
  openDisclosureReviewSchema,
  recordInspectionEventSchema,
  recordDisclosureDecisionSchema,
  recordDisclosurePrivilegeReviewSchema,
} from '../../shared/contracts.js';
import { hasCapability, type Capability, type SessionUser } from '../policy.js';
import type { AuditContext } from '../store.js';
import { DisclosureStore, DisclosureStoreError, type DisclosureStoreErrorCode } from './store.js';

export class DisclosureServiceError extends Error {
  constructor(readonly code: DisclosureStoreErrorCode | 'FORBIDDEN', message: string) {
    super(message);
    this.name = 'DisclosureServiceError';
  }
}

export class DisclosureService {
  constructor(private readonly store: DisclosureStore) {}

  private require(user: SessionUser, capability: Capability) {
    if (!hasCapability(user, capability)) throw new DisclosureServiceError('FORBIDDEN', 'You do not have permission to perform this disclosure action.');
  }

  private execute<T>(operation: () => T): T {
    try { return operation(); }
    catch (error) {
      if (error instanceof DisclosureServiceError) throw error;
      if (error instanceof DisclosureStoreError) throw new DisclosureServiceError(error.code, error.message);
      throw error;
    }
  }

  getWorkspace(user: SessionUser, matterId: string, proceedingId: string) {
    if (!hasCapability(user, 'proceedings.read') || !hasCapability(user, 'disclosure.read'))
      throw new DisclosureServiceError('NOT_FOUND', 'Disclosure record not found.');
    const workspace = this.execute(() => this.store.getWorkspace(user.firmId, matterId, proceedingId));
    if (!workspace) throw new DisclosureServiceError('NOT_FOUND', 'Disclosure record not found.');
    const visible = hasCapability(user, 'disclosure.review_privilege') ? workspace : {
      ...workspace,
      reviews: workspace.reviews.map((review) => ({
        ...review,
        candidates: review.candidates.map((candidate) => candidate.projection.restricted ? {
          id: candidate.id,
          reviewId: candidate.reviewId,
          version: candidate.version,
          restricted: true as const,
          state: candidate.projection.state,
          createdAt: candidate.createdAt,
          updatedAt: candidate.updatedAt,
        } : candidate),
      })),
    };
    return { ...visible, actingUserId: user.id, permissions: {
      canRead: true, canPrepare: hasCapability(user, 'disclosure.prepare'),
      canReview: hasCapability(user, 'disclosure.review'),
      canReviewPrivilege: hasCapability(user, 'disclosure.review_privilege'),
      canWaivePrivilege: hasCapability(user, 'disclosure.waive_privilege'),
      canApproveRedaction: hasCapability(user, 'disclosure.approve_redaction'),
      canGenerateList: hasCapability(user, 'disclosure.generate_list'),
      canRecordExternal: hasCapability(user, 'disclosure.record_external'),
    } };
  }

  openReview(user: SessionUser, matterId: string, proceedingId: string, raw: unknown, audit: AuditContext) {
    this.require(user, 'proceedings.read'); this.require(user, 'disclosure.prepare');
    return this.execute(() => this.store.openReview(user, matterId, proceedingId, openDisclosureReviewSchema.parse(raw), audit));
  }

  addCandidate(user: SessionUser, matterId: string, proceedingId: string, reviewId: string, raw: unknown, audit: AuditContext) {
    this.require(user, 'disclosure.prepare');
    return this.execute(() => this.store.addCandidate(user, matterId, proceedingId, reviewId, addDisclosureCandidateSchema.parse(raw), audit));
  }

  recordAiSuggestion(user: SessionUser, matterId: string, proceedingId: string, candidateId: string, raw: unknown, audit: AuditContext) {
    this.require(user, 'disclosure.prepare');
    return this.execute(() => this.store.recordAiSuggestion(user, matterId, proceedingId, candidateId,
      createDisclosureAiSuggestionSchema.parse(raw), audit));
  }

  recordDecision(user: SessionUser, matterId: string, proceedingId: string, candidateId: string,
    raw: unknown, audit: AuditContext) {
    this.require(user, 'disclosure.review');
    return this.execute(() => this.store.recordDecision(user, matterId, proceedingId, candidateId,
      recordDisclosureDecisionSchema.parse(raw), audit));
  }

  recordPrivilegeReview(user: SessionUser, matterId: string, proceedingId: string, candidateId: string,
    raw: unknown, audit: AuditContext) {
    const input = recordDisclosurePrivilegeReviewSchema.parse(raw);
    this.require(user, 'disclosure.review_privilege');
    if (input.outcome === 'waived') this.require(user, 'disclosure.waive_privilege');
    return this.execute(() => this.store.recordPrivilegeReview(user, matterId, proceedingId, candidateId, input, audit));
  }

  approveRedaction(user: SessionUser, matterId: string, proceedingId: string, candidateId: string,
    raw: unknown, audit: AuditContext) {
    this.require(user, 'disclosure.approve_redaction');
    return this.execute(() => this.store.approveRedaction(user, matterId, proceedingId, candidateId,
      approveDisclosureRedactionSchema.parse(raw), audit));
  }

  generateList(user: SessionUser, matterId: string, proceedingId: string, reviewId: string,
    raw: unknown, audit: AuditContext) {
    this.require(user, 'disclosure.generate_list');
    return this.execute(() => this.store.generateList(user, matterId, proceedingId, reviewId, generateDisclosureListSchema.parse(raw), audit));
  }

  createInspectionRequest(user: SessionUser, matterId: string, proceedingId: string, reviewId: string,
    raw: unknown, audit: AuditContext) {
    this.require(user, 'disclosure.record_external');
    return this.execute(() => this.store.createInspectionRequest(user, matterId, proceedingId, reviewId, createInspectionRequestSchema.parse(raw), audit));
  }

  recordInspectionEvent(user: SessionUser, matterId: string, proceedingId: string, requestId: string,
    raw: unknown, audit: AuditContext) {
    this.require(user, 'disclosure.record_external');
    return this.execute(() => this.store.recordInspectionEvent(user, matterId, proceedingId, requestId, recordInspectionEventSchema.parse(raw), audit));
  }
}
