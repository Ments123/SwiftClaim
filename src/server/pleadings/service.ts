import type {
  CreateResponseTrackInput,
  CreateStatementVersionInput,
  RecordStatementEventInput,
  RecordAmendmentAuthorityInput,
  CreateDefaultReviewInput,
  CompleteDefaultReviewInput,
  ReviewPleadingDeadlineInput,
} from '../../shared/contracts.js';
import { hasCapability, type Capability, type SessionUser } from '../policy.js';
import type { AuditContext } from '../store.js';
import {
  PleadingsStore,
  PleadingsStoreError,
  type PleadingsStoreErrorCode,
} from './store.js';

export type PleadingsServiceErrorCode = PleadingsStoreErrorCode
  | 'FORBIDDEN'
  | 'INDEPENDENT_REVIEW_REQUIRED';

export class PleadingsServiceError extends Error {
  constructor(readonly code: PleadingsServiceErrorCode, message: string) {
    super(message);
    this.name = 'PleadingsServiceError';
  }
}

export class PleadingsService {
  constructor(private readonly store: PleadingsStore) {}

  private require(user: SessionUser, capability: Capability): void {
    if (!hasCapability(user, capability)) {
      throw new PleadingsServiceError('FORBIDDEN', 'This pleading action is unavailable.');
    }
  }

  private execute<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof PleadingsServiceError) throw error;
      if (error instanceof PleadingsStoreError) {
        throw new PleadingsServiceError(error.code, error.message);
      }
      throw error;
    }
  }

  getWorkspace(user: SessionUser, matterId: string, proceedingId: string) {
    if (!hasCapability(user, 'proceedings.read') || !hasCapability(user, 'pleadings.read')) {
      throw new PleadingsServiceError('NOT_FOUND', 'The pleading workspace was not found.');
    }
    const workspace = this.store.getWorkspace(user.firmId, matterId, proceedingId);
    if (!workspace) {
      throw new PleadingsServiceError('NOT_FOUND', 'The pleading workspace was not found.');
    }
    return {
      ...workspace,
      actingUserId: user.id,
      permissions: {
        canRead: true,
        canPrepare: hasCapability(user, 'pleadings.prepare'),
        canRecordExternal: hasCapability(user, 'pleadings.record_external'),
        canApproveClaimantStatement: hasCapability(user, 'pleadings.approve_claimant_statement'),
        canReviewDefault: hasCapability(user, 'pleadings.review_default'),
        canRecordAmendmentAuthority: hasCapability(user, 'pleadings.record_amendment_authority'),
      },
    };
  }

  openTrack(
    user: SessionUser,
    matterId: string,
    proceedingId: string,
    input: CreateResponseTrackInput,
    audit: AuditContext,
  ) {
    this.require(user, 'proceedings.read');
    this.require(user, 'pleadings.prepare');
    return this.execute(() => this.store.openTrack(user, matterId, proceedingId, input, audit));
  }

  createStatementVersion(
    user: SessionUser, matterId: string, proceedingId: string, trackId: string,
    input: CreateStatementVersionInput, audit: AuditContext,
  ) {
    this.require(user, 'proceedings.read');
    this.require(user, 'pleadings.prepare');
    return this.execute(() => this.store.createStatementVersion(
      user, matterId, proceedingId, trackId, input, audit,
    ));
  }

  recordStatementEvent(
    user: SessionUser, matterId: string, proceedingId: string, statementId: string,
    input: RecordStatementEventInput, audit: AuditContext,
  ) {
    const external = new Set([
      'filed', 'provider_acknowledged', 'court_accepted', 'served', 'rejected',
      'withdrawn', 'permission_granted', 'permission_refused',
    ]);
    if (input.eventType === 'approved_for_filing') {
      this.require(user, 'pleadings.approve_claimant_statement');
      const statement = this.store.getStatement(user.firmId, matterId, statementId);
      if (!statement) throw new PleadingsServiceError('NOT_FOUND', 'The statement was not found.');
      if (statement.currentVersion?.preparedByUserId === user.id) {
        throw new PleadingsServiceError(
          'INDEPENDENT_REVIEW_REQUIRED',
          'The exact claimant statement requires an independent approver.',
        );
      }
    } else {
      this.require(user, external.has(input.eventType)
        ? 'pleadings.record_external' : 'pleadings.prepare');
    }
    return this.execute(() => this.store.recordStatementEvent(
      user, matterId, proceedingId, statementId, input, audit,
    ));
  }

  assertCanCompleteDefaultReview(user: SessionUser): void {
    this.require(user, 'pleadings.review_default');
  }

  assertCanApproveClaimantStatement(user: SessionUser): void {
    this.require(user, 'pleadings.approve_claimant_statement');
  }

  assertCanRecordAmendmentAuthority(user: SessionUser): void {
    this.require(user, 'pleadings.record_amendment_authority');
  }

  recordAmendmentAuthority(
    user: SessionUser, matterId: string, proceedingId: string, statementVersionId: string,
    input: RecordAmendmentAuthorityInput, audit: AuditContext,
  ) {
    this.require(user, 'pleadings.record_amendment_authority');
    return this.execute(() => this.store.recordAmendmentAuthority(
      user, matterId, proceedingId, statementVersionId, input, audit,
    ));
  }

  createDefaultReview(
    user: SessionUser, matterId: string, proceedingId: string, trackId: string,
    input: CreateDefaultReviewInput, audit: AuditContext,
  ) {
    this.require(user, 'pleadings.review_default');
    return this.execute(() => this.store.createDefaultReview(
      user, matterId, proceedingId, trackId, input, audit,
    ));
  }

  completeDefaultReview(
    user: SessionUser, matterId: string, proceedingId: string, reviewId: string,
    input: CompleteDefaultReviewInput, audit: AuditContext,
  ) {
    this.require(user, 'pleadings.review_default');
    return this.execute(() => this.store.completeDefaultReview(
      user, matterId, proceedingId, reviewId, input, audit,
    ));
  }

  reviewDeadline(
    user: SessionUser, matterId: string, proceedingId: string, trackId: string,
    input: ReviewPleadingDeadlineInput, audit: AuditContext,
  ) {
    this.require(user, 'pleadings.record_external');
    return this.execute(() => this.store.reviewDeadline(
      user, matterId, proceedingId, trackId, input, audit,
    ));
  }
}
