import type {
  CreateCourtApplicationInput,
  CreateCourtDirectionInput,
  CreateCourtFilingInput,
  CreateCourtHearingInput,
  CreateCourtOrderInput,
  CreateCourtServiceRecordInput,
  CreateProceedingAuthorityVersionInput,
  CreateProceedingInput,
  RecordCourtDirectionEventInput,
  RecordCourtApplicationEventInput,
  RecordCourtFilingEventInput,
  RecordCourtHearingEventInput,
  RecordCourtServiceEventInput,
  RecordProceedingEventInput,
} from '../../shared/contracts.js';
import { hasCapability, type Capability, type SessionUser } from '../policy.js';
import type { AuditContext } from '../store.js';
import {
  ProceedingsStore,
  ProceedingsStoreError,
  type ProceedingsStoreErrorCode,
} from './store.js';

export type ProceedingsServiceErrorCode = ProceedingsStoreErrorCode
  | 'FORBIDDEN'
  | 'INDEPENDENT_REVIEW_REQUIRED'
  | 'AUTHORITY_REQUIRED'
  | 'AUTHORITY_VERSION_MISMATCH'
  | 'AUTHORITY_EXPIRED'
  | 'EVIDENCE_REQUIRED'
  | 'SEALED_ORDER_REQUIRED';

export class ProceedingsServiceError extends Error {
  constructor(readonly code: ProceedingsServiceErrorCode, message: string) {
    super(message);
    this.name = 'ProceedingsServiceError';
  }
}

export class ProceedingsService {
  constructor(
    private readonly store: ProceedingsStore,
    private readonly now: () => Date,
  ) {}

  private require(user: SessionUser, capability: Capability): void {
    if (!hasCapability(user, capability)) {
      throw new ProceedingsServiceError('FORBIDDEN', 'This proceedings action is unavailable.');
    }
  }

  private execute<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof ProceedingsServiceError) throw error;
      if (error instanceof ProceedingsStoreError) {
        throw new ProceedingsServiceError(error.code, error.message);
      }
      throw error;
    }
  }

  getWorkspace(user: SessionUser, matterId: string) {
    this.require(user, 'proceedings.read');
    const workspace = this.store.getWorkspace(user, matterId);
    if (!workspace) {
      throw new ProceedingsServiceError('NOT_FOUND', 'The proceedings workspace was not found.');
    }
    return {
      ...workspace,
      permissions: {
        canRead: hasCapability(user, 'proceedings.read'),
        canPrepare: hasCapability(user, 'proceedings.prepare'),
        canApproveIssue: hasCapability(user, 'proceedings.approve_issue'),
        canRecordExternal: hasCapability(user, 'proceedings.record_external'),
        canManageDirections: hasCapability(user, 'proceedings.manage_directions'),
        canManageHearings: hasCapability(user, 'proceedings.manage_hearings'),
        canRecordOrder: hasCapability(user, 'proceedings.record_order'),
      },
    };
  }

  createProceeding(
    user: SessionUser,
    matterId: string,
    input: CreateProceedingInput,
    audit: AuditContext,
  ) {
    this.require(user, 'proceedings.prepare');
    return this.execute(() => this.store.createProceeding(user, matterId, input, audit));
  }

  createAuthorityVersion(
    user: SessionUser,
    matterId: string,
    proceedingId: string,
    input: CreateProceedingAuthorityVersionInput,
    audit: AuditContext,
  ) {
    this.require(user, 'proceedings.approve_issue');
    if (input.approvedByUserId !== user.id) {
      throw new ProceedingsServiceError(
        'FORBIDDEN',
        'The acting approver must match the retained authority approval record.',
      );
    }
    if (input.preparedByUserId === input.approvedByUserId) {
      throw new ProceedingsServiceError(
        'INDEPENDENT_REVIEW_REQUIRED',
        'Court issue authority requires independent review of the exact documents.',
      );
    }
    return this.execute(() => this.store.createAuthorityVersion(
      user, matterId, proceedingId, input, audit,
    ));
  }

  recordProceedingEvent(
    user: SessionUser,
    matterId: string,
    proceedingId: string,
    input: RecordProceedingEventInput,
    audit: AuditContext,
  ) {
    const externalEvents = new Set([
      'issue_request_submitted', 'issued', 'case_number_corrected', 'transferred',
      'allocated', 'stayed', 'restored', 'discontinued', 'dismissed',
      'judgment_entered', 'closed_by_court', 'disposal_position_reviewed',
    ]);
    this.require(user, externalEvents.has(input.eventType)
      ? 'proceedings.record_external'
      : 'proceedings.prepare');

    if (input.eventType === 'issued') {
      const workspace = this.getWorkspace(user, matterId);
      if (workspace.proceeding?.id !== proceedingId || !workspace.authority) {
        throw new ProceedingsServiceError(
          'AUTHORITY_REQUIRED',
          'Current approved authority for the exact claim documents is required before issue.',
        );
      }
      const authority = workspace.authority;
      const now = this.now();
      if (
        (authority.expiresAt && new Date(authority.expiresAt) < now) ||
        (authority.reviewOn && authority.reviewOn < now.toISOString().slice(0, 10))
      ) {
        throw new ProceedingsServiceError(
          'AUTHORITY_EXPIRED',
          'The current issue authority is outside its review period.',
        );
      }
      if (
        authority.procedureType !== workspace.proceeding.procedureType ||
        input.sourceDocumentVersionId !== authority.claimFormDocumentVersionId
      ) {
        throw new ProceedingsServiceError(
          'AUTHORITY_VERSION_MISMATCH',
          'Issue authority does not cover this exact sealed claim form version.',
        );
      }
    }
    return this.execute(() => this.store.recordProceedingEvent(
      user, matterId, proceedingId, input, audit,
    ));
  }

  createFiling(
    user: SessionUser, matterId: string, proceedingId: string,
    input: CreateCourtFilingInput, audit: AuditContext,
  ) {
    this.require(user, 'proceedings.prepare');
    return this.execute(() => this.store.createFiling(
      user, matterId, proceedingId, input, audit,
    ));
  }

  recordFilingEvent(
    user: SessionUser, matterId: string, proceedingId: string, filingId: string,
    input: RecordCourtFilingEventInput, audit: AuditContext,
  ) {
    this.require(user, input.eventType === 'prepared'
      ? 'proceedings.prepare' : 'proceedings.record_external');
    return this.execute(() => this.store.recordFilingEvent(
      user, matterId, proceedingId, filingId, input, audit,
    ));
  }

  createServiceRecord(
    user: SessionUser, matterId: string, proceedingId: string,
    input: CreateCourtServiceRecordInput, audit: AuditContext,
  ) {
    this.require(user, 'proceedings.prepare');
    return this.execute(() => this.store.createServiceRecord(
      user, matterId, proceedingId, input, audit,
    ));
  }

  recordServiceEvent(
    user: SessionUser, matterId: string, proceedingId: string, serviceRecordId: string,
    input: RecordCourtServiceEventInput, audit: AuditContext,
  ) {
    this.require(user, input.eventType === 'prepared'
      ? 'proceedings.prepare' : 'proceedings.record_external');
    return this.execute(() => this.store.recordServiceEvent(
      user, matterId, proceedingId, serviceRecordId, input, audit,
    ));
  }

  createApplication(
    user: SessionUser, matterId: string, proceedingId: string,
    input: CreateCourtApplicationInput, audit: AuditContext,
  ) {
    this.require(user, 'proceedings.prepare');
    return this.execute(() => this.store.createApplication(
      user, matterId, proceedingId, input, audit,
    ));
  }

  recordApplicationEvent(
    user: SessionUser, matterId: string, proceedingId: string, applicationId: string,
    input: RecordCourtApplicationEventInput, audit: AuditContext,
  ) {
    this.require(user, input.eventType === 'prepared'
      ? 'proceedings.prepare' : 'proceedings.record_external');
    if (input.eventType === 'granted' && !input.resultingOrderId) {
      throw new ProceedingsServiceError(
        'SEALED_ORDER_REQUIRED',
        'A granted court application requires the exact retained sealed order.',
      );
    }
    return this.execute(() => this.store.recordApplicationEvent(
      user, matterId, proceedingId, applicationId, input, audit,
    ));
  }

  createOrder(
    user: SessionUser, matterId: string, proceedingId: string,
    input: CreateCourtOrderInput, audit: AuditContext,
  ) {
    this.require(user, 'proceedings.record_order');
    if (!input.explicitSealedConfirmation || !input.sealedDocumentVersionId) {
      throw new ProceedingsServiceError(
        'SEALED_ORDER_REQUIRED',
        'A court order requires explicit confirmation of the exact retained sealed document.',
      );
    }
    return this.execute(() => this.store.createOrder(
      user, matterId, proceedingId, input, audit,
    ));
  }

  createDirection(
    user: SessionUser, matterId: string, proceedingId: string,
    input: CreateCourtDirectionInput, audit: AuditContext,
  ) {
    this.require(user, 'proceedings.manage_directions');
    return this.execute(() => this.store.createDirection(
      user, matterId, proceedingId, input, audit,
    ));
  }

  recordDirectionEvent(
    user: SessionUser, matterId: string, proceedingId: string, directionId: string,
    input: RecordCourtDirectionEventInput, audit: AuditContext,
  ) {
    const courtOutcomeEvents = new Set([
      'extended', 'stayed', 'relief_granted', 'relief_refused', 'waived_by_order',
    ]);
    this.require(user, courtOutcomeEvents.has(input.eventType)
      ? 'proceedings.record_relief' : 'proceedings.manage_directions');

    const evidenceCount = input.evidenceDocumentVersionIds.length
      + input.evidenceFilingIds.length + input.evidenceServiceRecordIds.length;
    if (input.eventType === 'satisfied' && evidenceCount === 0) {
      throw new ProceedingsServiceError(
        'EVIDENCE_REQUIRED',
        'A satisfied direction requires retained performance evidence.',
      );
    }
    if (courtOutcomeEvents.has(input.eventType) && !input.sourceOrderId) {
      throw new ProceedingsServiceError(
        'SEALED_ORDER_REQUIRED',
        'This court outcome requires the exact retained sealed order.',
      );
    }
    return this.execute(() => this.store.recordDirectionEvent(
      user, matterId, proceedingId, directionId, input, audit,
    ));
  }

  createHearing(
    user: SessionUser, matterId: string, proceedingId: string,
    input: CreateCourtHearingInput, audit: AuditContext,
  ) {
    this.require(user, 'proceedings.manage_hearings');
    return this.execute(() => this.store.createHearing(
      user, matterId, proceedingId, input, audit,
    ));
  }

  recordHearingEvent(
    user: SessionUser, matterId: string, proceedingId: string, hearingId: string,
    input: RecordCourtHearingEventInput, audit: AuditContext,
  ) {
    this.require(user, 'proceedings.manage_hearings');
    return this.execute(() => this.store.recordHearingEvent(
      user, matterId, proceedingId, hearingId, input, audit,
    ));
  }
}
