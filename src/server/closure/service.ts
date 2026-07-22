import { hasCapability, type Capability, type SessionUser } from '../policy.js';
import type { AuditContext } from '../store.js';
import { classifyClosureReadiness } from './readiness.js';
import { ClosureStore, ClosureStoreError } from './store.js';
import type { ClosureDecisionInput, LegalHoldInput, PrepareClosureInput, ReopenMatterInput } from './types.js';

export type ClosureServiceErrorCode =
  | 'NOT_FOUND' | 'FORBIDDEN' | 'NOT_READY' | 'CONFLICT' | 'INVALID_STATE'
  | 'IDEMPOTENCY_KEY_REUSED' | 'INDEPENDENCE_REQUIRED' | 'STALE_REVIEW' | 'INVALID_LINK';

export class ClosureServiceError extends Error {
  constructor(readonly code: ClosureServiceErrorCode, message: string) {
    super(message);
    this.name = 'ClosureServiceError';
  }
}

function rethrow(error: unknown): never {
  if (error instanceof ClosureStoreError) throw new ClosureServiceError(error.code, error.message);
  throw error;
}

export class ClosureService {
  constructor(private readonly store: ClosureStore) {}

  private require(user: SessionUser, capability: Capability) {
    if (!hasCapability(user, capability)) throw new ClosureServiceError('FORBIDDEN', 'The closure action is not permitted.');
  }

  getWorkspace(user: SessionUser, matterId: string) {
    this.require(user, 'closure.read');
    try {
      return { ...this.store.getWorkspace(user, matterId), permissions: {
        canPrepare: hasCapability(user, 'closure.prepare'), canApprove: hasCapability(user, 'closure.approve'),
        canReopen: hasCapability(user, 'closure.reopen'), canManageHold: hasCapability(user, 'closure.manage_hold'),
      } };
    } catch (error) { rethrow(error); }
  }

  prepare(user: SessionUser, matterId: string, input: PrepareClosureInput, audit: AuditContext) {
    this.require(user, 'closure.prepare');
    if (!input.explicitHumanAuthority) throw new ClosureServiceError('FORBIDDEN', 'Explicit human authority is required.');
    try {
      const snapshot = this.store.getSnapshot(user, matterId);
      const result = classifyClosureReadiness({ blockers: snapshot.blockers, transfers: input.transfers });
      if (!result.closable) throw new ClosureServiceError('NOT_READY', 'Critical or uncontrolled closure obligations remain.');
      return this.store.prepare(user, matterId, input, snapshot.hash, audit);
    } catch (error) {
      if (error instanceof ClosureServiceError) throw error;
      rethrow(error);
    }
  }

  approve(user: SessionUser, matterId: string, reviewId: string, input: ClosureDecisionInput, audit: AuditContext) {
    this.require(user, 'closure.approve');
    try { return this.store.approve(user, matterId, reviewId, input, audit); } catch (error) { rethrow(error); }
  }

  close(user: SessionUser, matterId: string, reviewId: string, input: ClosureDecisionInput, audit: AuditContext) {
    this.require(user, 'closure.approve');
    try { return this.store.close(user, matterId, reviewId, input, audit); } catch (error) { rethrow(error); }
  }

  reopen(user: SessionUser, matterId: string, input: ReopenMatterInput, audit: AuditContext) {
    this.require(user, 'closure.reopen');
    try { return this.store.reopen(user, matterId, input, audit); } catch (error) { rethrow(error); }
  }

  applyLegalHold(user: SessionUser, matterId: string, input: LegalHoldInput, audit: AuditContext) {
    this.require(user, 'closure.manage_hold');
    try { return this.store.applyLegalHold(user, matterId, input, audit); } catch (error) { rethrow(error); }
  }

  releaseLegalHold(user: SessionUser, matterId: string, holdId: string, input: LegalHoldInput, audit: AuditContext) {
    this.require(user, 'closure.manage_hold');
    try { return this.store.releaseLegalHold(user, matterId, holdId, input, audit); } catch (error) { rethrow(error); }
  }
}
