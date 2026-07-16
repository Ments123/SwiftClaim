import type {
  AppendCommunicationDraftVersionInput,
  CreateCommunicationDraftInput,
  DecideCommunicationDraftInput,
  DispatchCommunicationInput,
  RecordCommunicationCallInput,
  RecordCommunicationInput,
  RecordCommunicationProviderEventInput,
  SubmitCommunicationDraftInput,
} from '../../shared/contracts.js';
import { hasCapability, type Capability, type SessionUser } from '../policy.js';
import type { AuditContext } from '../store.js';
import {
  CommunicationProviderError,
  CommunicationProviderRegistry,
} from './provider.js';
import {
  CommunicationStore,
  CommunicationStoreError,
  type CommunicationStoreErrorCode,
} from './store.js';

export type CommunicationErrorCode =
  | CommunicationStoreErrorCode
  | 'FORBIDDEN'
  | 'APPROVAL_REQUIRED'
  | 'INVALID_STATE'
  | 'PROVIDER_CAPABILITY_UNAVAILABLE'
  | 'PROVIDER_NOT_FOUND';

export class CommunicationError extends Error {
  constructor(
    readonly code: CommunicationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CommunicationError';
  }
}

export class CommunicationService {
  constructor(
    private readonly store: CommunicationStore,
    private readonly providers: CommunicationProviderRegistry,
  ) {}

  private mapError(error: unknown): never {
    if (error instanceof CommunicationError) throw error;
    if (error instanceof CommunicationStoreError) {
      throw new CommunicationError(error.code, error.message);
    }
    if (error instanceof CommunicationProviderError) {
      throw new CommunicationError(error.code, error.message);
    }
    throw error;
  }

  private requireCapability(user: SessionUser, capability: Capability): void {
    if (!hasCapability(user, capability)) {
      throw new CommunicationError(
        'FORBIDDEN',
        'You do not have permission to perform this communication action.',
      );
    }
  }

  private requireVisibleMatter(user: SessionUser, matterId: string): void {
    const visible = this.store.getWorkspace(user, matterId, {
      readPrivileged: false,
      readProtected: false,
    });
    if (!visible) {
      throw new CommunicationError('NOT_FOUND', 'The requested resource was not found.');
    }
  }

  async getWorkspace(user: SessionUser, matterId: string) {
    this.requireVisibleMatter(user, matterId);
    this.requireCapability(user, 'communications.read');
    try {
      const workspace = this.store.getWorkspace(user, matterId, {
        readPrivileged: hasCapability(user, 'communications.read_privileged'),
        readProtected: hasCapability(user, 'communications.read_protected'),
      });
      if (!workspace) {
        throw new CommunicationError('NOT_FOUND', 'The requested resource was not found.');
      }
      return {
        ...workspace,
        permissions: {
          canWrite: hasCapability(user, 'communications.write') && workspace.permissions.canWrite,
          canApprove: hasCapability(user, 'communications.approve'),
          canSend: hasCapability(user, 'communications.send'),
          canReadPrivileged: hasCapability(user, 'communications.read_privileged'),
          canReadProtected: hasCapability(user, 'communications.read_protected'),
          canManageProvider: hasCapability(user, 'communications.manage_provider'),
        },
        providerCapabilities: await this.providers.capabilities(),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  async getProviderCapabilities(user: SessionUser) {
    this.requireCapability(user, 'communications.read');
    return this.providers.capabilities();
  }

  recordEntry(
    user: SessionUser,
    matterId: string,
    input: RecordCommunicationInput,
    audit: AuditContext,
  ) {
    this.requireVisibleMatter(user, matterId);
    this.requireCapability(user, 'communications.write');
    try {
      return this.store.recordEntry(user, matterId, input, audit);
    } catch (error) {
      this.mapError(error);
    }
  }

  createDraft(
    user: SessionUser,
    matterId: string,
    input: CreateCommunicationDraftInput,
    audit: AuditContext,
  ) {
    this.requireVisibleMatter(user, matterId);
    this.requireCapability(user, 'communications.write');
    try {
      return this.store.createDraft(user, matterId, input, audit);
    } catch (error) {
      this.mapError(error);
    }
  }

  appendDraftVersion(
    user: SessionUser,
    matterId: string,
    draftId: string,
    input: AppendCommunicationDraftVersionInput,
    audit: AuditContext,
  ) {
    this.requireVisibleMatter(user, matterId);
    this.requireCapability(user, 'communications.write');
    try {
      const draft = this.store.getDraft(user, matterId, draftId);
      if (draft.channel !== input.channel || draft.confidentiality !== input.confidentiality) {
        throw new CommunicationError(
          'INVALID_STATE',
          'A draft revision cannot change its channel or confidentiality.',
        );
      }
      if (draft.status === 'dispatched' || draft.status === 'cancelled') {
        throw new CommunicationError('INVALID_STATE', 'A dispatched or cancelled draft cannot be revised.');
      }
      return this.store.appendDraftVersion(user, matterId, draftId, input, audit);
    } catch (error) {
      this.mapError(error);
    }
  }

  submitDraft(
    user: SessionUser,
    matterId: string,
    draftId: string,
    input: SubmitCommunicationDraftInput,
    audit: AuditContext,
  ) {
    this.requireVisibleMatter(user, matterId);
    this.requireCapability(user, 'communications.write');
    try {
      const draft = this.store.getDraft(user, matterId, draftId);
      if (draft.recordVersion !== input.expectedVersion || draft.status !== 'draft') {
        throw new CommunicationError('CONFLICT', 'The communication draft changed before submission.');
      }
      return this.store.recordApprovalEvent(
        user,
        matterId,
        draftId,
        {
          draftVersionId: draft.currentVersion.id,
          decision: 'submitted',
          note: input.note,
          idempotencyKey: input.idempotencyKey,
        },
        audit,
      );
    } catch (error) {
      this.mapError(error);
    }
  }

  decideDraft(
    user: SessionUser,
    matterId: string,
    draftId: string,
    input: DecideCommunicationDraftInput,
    audit: AuditContext,
  ) {
    this.requireVisibleMatter(user, matterId);
    this.requireCapability(user, 'communications.approve');
    try {
      const draft = this.store.getDraft(user, matterId, draftId);
      if (draft.recordVersion !== input.expectedVersion) {
        throw new CommunicationError('CONFLICT', 'The communication draft changed before review.');
      }
      if (draft.currentVersion.id !== input.draftVersionId) {
        throw new CommunicationError('CONFLICT', 'Only the exact current draft version can be reviewed.');
      }
      if (input.decision === 'approved' && draft.status !== 'pending_approval') {
        throw new CommunicationError('INVALID_STATE', 'The draft must be submitted before approval.');
      }
      return this.store.recordApprovalEvent(user, matterId, draftId, input, audit);
    } catch (error) {
      this.mapError(error);
    }
  }

  async dispatch(
    user: SessionUser,
    matterId: string,
    draftId: string,
    input: DispatchCommunicationInput,
    audit: AuditContext,
  ) {
    this.requireVisibleMatter(user, matterId);
    this.requireCapability(user, 'communications.send');
    try {
      const draft = this.store.getDraft(user, matterId, draftId);
      if (draft.recordVersion !== input.expectedVersion) {
        throw new CommunicationError('CONFLICT', 'The communication draft changed before dispatch.');
      }
      if (draft.channel === 'internal') {
        throw new CommunicationError('INVALID_STATE', 'Internal communications cannot be dispatched.');
      }
      if (draft.status === 'dispatched' || draft.status === 'cancelled') {
        throw new CommunicationError('INVALID_STATE', 'This draft cannot be dispatched.');
      }
      if (
        ['privileged', 'protected_negotiation'].includes(draft.confidentiality) &&
        !draft.currentApproval
      ) {
        throw new CommunicationError(
          'APPROVAL_REQUIRED',
          'The exact current sensitive draft version requires approval.',
        );
      }
      const provider = this.providers.require(input.providerKey);
      const dispatch = this.store.createDispatch(user, matterId, draftId, input, audit);
      const command = this.store.getProviderDispatchCommand(user, matterId, dispatch.id);
      const result = await provider.dispatch(command);
      return this.store.recordProviderEvent(
        user,
        matterId,
        dispatch.id,
        input.providerKey,
        {
          providerEventId: result.providerEventId,
          eventType: result.type,
          occurredAt: result.occurredAt,
          authenticated: true,
          authenticationMethod: 'provider_dispatch_result',
          externalMessageId: result.externalMessageId,
          safePayload: result.safePayload,
        },
        audit,
      );
    } catch (error) {
      this.mapError(error);
    }
  }

  async recordProviderEvent(
    user: SessionUser,
    matterId: string,
    dispatchId: string,
    providerKey: string,
    input: RecordCommunicationProviderEventInput,
    audit: AuditContext,
  ) {
    this.requireVisibleMatter(user, matterId);
    this.requireCapability(user, 'communications.manage_provider');
    try {
      const verified = await this.providers.require(providerKey).verifyEvent(input);
      return this.store.recordProviderEvent(
        user,
        matterId,
        dispatchId,
        providerKey,
        verified,
        audit,
      );
    } catch (error) {
      this.mapError(error);
    }
  }

  recordCall(
    user: SessionUser,
    matterId: string,
    input: RecordCommunicationCallInput,
    audit: AuditContext,
  ) {
    this.requireVisibleMatter(user, matterId);
    this.requireCapability(user, 'communications.write');
    try {
      return this.store.recordCall(user, matterId, input, audit);
    } catch (error) {
      this.mapError(error);
    }
  }
}
