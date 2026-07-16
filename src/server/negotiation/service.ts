import type {
  AppendNegotiationActionVersionInput,
  CreateNegotiationActionInput,
  CreateNegotiationReviewInput,
  CreateSettlementInput,
  AppendSettlementTermsInput,
  ConcludeSettlementInput,
  CreateSettlementObligationInput,
  RecordSettlementObligationEventInput,
  CreateSettlementAuthorityVersionInput,
  DecideNegotiationActionInput,
  RecordClientInstructionInput,
  RecordNegotiationExternalActionInput,
  SubmitNegotiationActionInput,
} from '../../shared/contracts.js';
import { hasCapability, type Capability, type SessionUser } from '../policy.js';
import type { AuditContext } from '../store.js';
import { NegotiationStore, NegotiationStoreError } from './store.js';

export type NegotiationServiceErrorCode =
  | 'INVALID_STATE'
  | 'CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'INSTRUCTION_REQUIRED'
  | 'AUTHORITY_REQUIRED'
  | 'APPROVAL_REQUIRED'
  | 'SOURCE_REQUIRED'
  | 'FORBIDDEN'
  | 'COURT_APPROVAL_REVIEW_REQUIRED'
  | 'NOT_FOUND';

export class NegotiationServiceError extends Error {
  constructor(readonly code: NegotiationServiceErrorCode, message: string) {
    super(message);
    this.name = 'NegotiationServiceError';
  }
}

function rethrowStore(error: unknown): never {
  if (error instanceof NegotiationStoreError) {
    const code = error.code === 'INVALID_LINK' ? 'NOT_FOUND' : error.code;
    throw new NegotiationServiceError(code, error.message);
  }
  throw error;
}

function moneyWithinAuthority(
  amount: number | null,
  minimum: number | null,
  maximum: number | null,
): boolean {
  if (amount === null) return minimum === null && maximum === null;
  if (minimum !== null && amount < minimum) return false;
  if (maximum !== null && amount > maximum) return false;
  return true;
}

export class NegotiationService {
  constructor(private readonly store: NegotiationStore) {}

  private requireCapability(user: SessionUser, capability: Capability): void {
    if (!hasCapability(user, capability)) {
      throw new NegotiationServiceError(
        'FORBIDDEN', 'You do not have permission to perform this negotiation action.',
      );
    }
  }

  getWorkspace(user: SessionUser, matterId: string) {
    this.requireCapability(user, 'negotiation.read');
    const workspace = this.store.getWorkspace(user, matterId);
    if (!workspace) {
      throw new NegotiationServiceError('NOT_FOUND', 'The negotiation workspace was not found.');
    }
    return workspace;
  }

  getProtectedWorkspace(user: SessionUser, matterId: string) {
    this.requireCapability(user, 'negotiation.read_protected');
    try {
      return this.store.getProtectedWorkspace(user, matterId);
    } catch (error) {
      rethrowStore(error);
    }
  }

  createReview(
    user: SessionUser,
    matterId: string,
    input: CreateNegotiationReviewInput,
    audit: AuditContext,
  ) {
    this.requireCapability(user, 'negotiation.prepare');
    if (input.confidentiality !== 'ordinary') {
      this.requireCapability(user, 'negotiation.read_protected');
    }
    try {
      return this.store.createReview(user, matterId, input, audit);
    } catch (error) {
      rethrowStore(error);
    }
  }

  createAuthorityVersion(
    user: SessionUser,
    matterId: string,
    input: CreateSettlementAuthorityVersionInput,
    audit: AuditContext,
  ) {
    this.requireCapability(user, 'negotiation.record_instruction');
    try {
      return this.store.createAuthorityVersion(user, matterId, input, audit);
    } catch (error) {
      rethrowStore(error);
    }
  }

  recordInstruction(
    user: SessionUser,
    matterId: string,
    input: RecordClientInstructionInput,
    audit: AuditContext,
  ) {
    this.requireCapability(user, 'negotiation.record_instruction');
    try {
      return this.store.recordInstruction(user, matterId, input, audit);
    } catch (error) {
      rethrowStore(error);
    }
  }

  createAction(
    user: SessionUser,
    matterId: string,
    input: CreateNegotiationActionInput,
    audit: AuditContext,
  ) {
    this.requireCapability(user, 'negotiation.prepare');
    if (input.confidentiality !== 'ordinary') {
      this.requireCapability(user, 'negotiation.read_protected');
    }
    try {
      return this.store.createAction(user, matterId, input, audit);
    } catch (error) {
      rethrowStore(error);
    }
  }

  appendActionVersion(
    user: SessionUser,
    matterId: string,
    actionId: string,
    input: AppendNegotiationActionVersionInput,
    audit: AuditContext,
  ) {
    this.requireCapability(user, 'negotiation.prepare');
    try {
      const current = this.store.getAction(user, matterId, actionId);
      if (current.confidentiality !== 'ordinary') {
        this.requireCapability(user, 'negotiation.read_protected');
      }
      return this.store.appendActionVersion(user, matterId, actionId, input, audit);
    } catch (error) {
      rethrowStore(error);
    }
  }

  private exactAuthority(
    user: SessionUser,
    matterId: string,
    action: ReturnType<NegotiationStore['getAction']>,
    instructionId: string,
    authorityId: string,
  ) {
    const instruction = this.store.getInstructionRecord(user, matterId, instructionId);
    if (
      instruction.actionId !== action.id ||
      instruction.actionVersionId !== action.currentVersion.id ||
      instruction.actionVersion !== action.currentVersion.version
    ) {
      throw new NegotiationServiceError(
        'INSTRUCTION_REQUIRED',
        'An explicit client instruction for the exact current action version is required.',
      );
    }
    const authority = this.store.getAuthorityRecord(user, matterId, authorityId);
    const currentAuthority = this.store.getProtectedWorkspace(user, matterId).currentAuthority;
    if (!currentAuthority || currentAuthority.id !== authority.id) {
      throw new NegotiationServiceError(
        'AUTHORITY_REQUIRED',
        'The exact current settlement authority is required.',
      );
    }
    if (!authority.actionTypes.includes(action.actionType)) {
      throw new NegotiationServiceError(
        'AUTHORITY_REQUIRED',
        'The current authority does not cover this action type.',
      );
    }
    if (!moneyWithinAuthority(
      action.currentVersion.totalMinor,
      authority.minimumAmountMinor,
      authority.maximumAmountMinor,
    )) {
      throw new NegotiationServiceError(
        'AUTHORITY_REQUIRED',
        'The current action amount is outside the recorded authority.',
      );
    }
    return { instruction, authority };
  }

  submitAction(
    user: SessionUser,
    matterId: string,
    actionId: string,
    input: SubmitNegotiationActionInput,
    audit: AuditContext,
  ) {
    this.requireCapability(user, 'negotiation.prepare');
    try {
      const replay = this.store.getCommandReplay(
        user, matterId, 'submit_action', input.idempotencyKey,
        { actionId, input, decision: 'submitted' },
      );
      if (replay) {
        const action = this.store.getAction(user, matterId, actionId);
        if (action.confidentiality !== 'ordinary') {
          this.requireCapability(user, 'negotiation.read_protected');
        }
        return action;
      }
      const action = this.store.getAction(user, matterId, actionId);
      if (action.confidentiality !== 'ordinary') {
        this.requireCapability(user, 'negotiation.read_protected');
      }
      if (input.actionVersionId !== action.currentVersion.id) {
        throw new NegotiationServiceError(
          'AUTHORITY_REQUIRED', 'Approval must identify the exact current action version.',
        );
      }
      this.exactAuthority(user, matterId, action, input.clientInstructionId, input.authorityVersionId);
      return this.store.recordApprovalEvent(user, matterId, actionId, input, 'submitted', audit);
    } catch (error) {
      if (error instanceof NegotiationServiceError) throw error;
      rethrowStore(error);
    }
  }

  decideAction(
    user: SessionUser,
    matterId: string,
    actionId: string,
    input: DecideNegotiationActionInput,
    audit: AuditContext,
  ) {
    this.requireCapability(user, 'negotiation.approve');
    try {
      const replay = this.store.getCommandReplay(
        user, matterId, 'decide_action', input.idempotencyKey,
        { actionId, input, decision: input.decision },
      );
      if (replay) return this.store.getAction(user, matterId, actionId);
      const action = this.store.getAction(user, matterId, actionId);
      if (input.actionVersionId !== action.currentVersion.id) {
        throw new NegotiationServiceError(
          'AUTHORITY_REQUIRED', 'The decision must identify the exact current action version.',
        );
      }
      const { authority } = this.exactAuthority(
        user, matterId, action, input.clientInstructionId, input.authorityVersionId,
      );
      const latestDecision = action.approvals
        .filter(({ actionVersion }) => actionVersion === action.currentVersion.version)
        .at(-1);
      if (latestDecision?.decision !== 'submitted') {
        throw new NegotiationServiceError(
          'APPROVAL_REQUIRED', 'The exact current action must be submitted before a decision.',
        );
      }
      if (
        input.decision === 'approved' &&
        (authority.requiresPartnerApproval || latestDecision.actorUserId === user.id) &&
        user.role !== 'partner' && user.role !== 'admin'
      ) {
        throw new NegotiationServiceError(
          'FORBIDDEN', 'A separate partner or administrator approval is required.',
        );
      }
      return this.store.recordApprovalEvent(user, matterId, actionId, input, input.decision, audit);
    } catch (error) {
      if (error instanceof NegotiationServiceError) throw error;
      rethrowStore(error);
    }
  }

  recordExternalAction(
    user: SessionUser,
    matterId: string,
    actionId: string,
    input: RecordNegotiationExternalActionInput,
    audit: AuditContext,
  ) {
    this.requireCapability(user, 'negotiation.record_external_action');
    try {
      const replay = this.store.getCommandReplay(
        user, matterId, 'record_external_action', input.idempotencyKey, { actionId, input },
      );
      if (replay) return this.store.getAction(user, matterId, actionId);
      const action = this.store.getAction(user, matterId, actionId);
      if (action.projection.state === 'externally_recorded') {
        throw new NegotiationServiceError(
          'INVALID_STATE', 'The exact action version already has an external act recorded.',
        );
      }
      if (action.projection.state === 'cancelled' || action.projection.state === 'superseded') {
        throw new NegotiationServiceError('INVALID_STATE', 'The negotiation action is no longer active.');
      }
      if (!action.projection.instructionCurrent) {
        throw new NegotiationServiceError(
          'INSTRUCTION_REQUIRED', 'An exact current client instruction is required.',
        );
      }
      if (!action.projection.approvalCurrent) {
        throw new NegotiationServiceError(
          'APPROVAL_REQUIRED', 'An exact current approval is required.',
        );
      }
      if (input.actionVersionId !== action.currentVersion.id) {
        throw new NegotiationServiceError(
          'AUTHORITY_REQUIRED', 'The external fact must identify the exact authorised action version.',
        );
      }
      if (!input.sourceCommunicationEntryId && !input.sourceDocumentVersionId) {
        throw new NegotiationServiceError(
          'SOURCE_REQUIRED', 'A retained external source is required.',
        );
      }
      return this.store.recordExternalAction(user, matterId, actionId, input, audit);
    } catch (error) {
      if (error instanceof NegotiationServiceError) throw error;
      if (error instanceof NegotiationStoreError && error.code === 'INVALID_LINK') {
        throw new NegotiationServiceError('SOURCE_REQUIRED', error.message);
      }
      rethrowStore(error);
    }
  }

  createSettlement(
    user: SessionUser,
    matterId: string,
    input: CreateSettlementInput,
    audit: AuditContext,
  ) {
    this.requireCapability(user, 'settlement.manage');
    try {
      const instruction = this.store.getInstructionRecord(
        user, matterId, input.clientInstructionId,
      );
      if (instruction.instructionType !== 'agree_terms' || instruction.actionId) {
        throw new NegotiationServiceError(
          'INSTRUCTION_REQUIRED',
          'Create a settlement from a retained client instruction to agree or prepare terms.',
        );
      }
      return this.store.createSettlement(user, matterId, input, audit);
    } catch (error) {
      rethrowStore(error);
    }
  }

  appendSettlementTerms(
    user: SessionUser,
    matterId: string,
    settlementId: string,
    input: AppendSettlementTermsInput,
    audit: AuditContext,
  ) {
    this.requireCapability(user, 'settlement.manage');
    try {
      const replay = this.store.getCommandReplay(
        user, matterId, 'append_settlement_terms', input.idempotencyKey,
        { settlementId, input },
      );
      if (replay) return this.store.getSettlement(user, matterId, settlementId);
      return this.store.appendSettlementTerms(user, matterId, settlementId, input, audit);
    } catch (error) {
      rethrowStore(error);
    }
  }

  concludeSettlement(
    user: SessionUser,
    matterId: string,
    settlementId: string,
    input: ConcludeSettlementInput,
    audit: AuditContext,
  ) {
    this.requireCapability(user, 'settlement.conclude');
    try {
      const replay = this.store.getCommandReplay(
        user, matterId, 'conclude_settlement', input.idempotencyKey,
        { settlementId, input },
      );
      if (replay) return this.store.getSettlement(user, matterId, settlementId);
      const settlement = this.store.getSettlement(user, matterId, settlementId);
      if (settlement.recordVersion !== input.expectedVersion) {
        throw new NegotiationServiceError('CONFLICT', 'The settlement changed. Refresh and retry.');
      }
      if (!settlement.currentTerms || settlement.currentTerms.id !== input.termsVersionId) {
        throw new NegotiationServiceError(
          'AUTHORITY_REQUIRED', 'The exact current settlement terms must be confirmed.',
        );
      }
      const instruction = this.store.getInstructionRecord(
        user, matterId, input.clientInstructionId,
      );
      if (
        instruction.settlementId !== settlementId ||
        instruction.settlementTermsVersionId !== input.termsVersionId ||
        instruction.settlementTermsVersion !== settlement.currentTerms.version
      ) {
        throw new NegotiationServiceError(
          'INSTRUCTION_REQUIRED',
          'An explicit client instruction for the exact current settlement terms is required.',
        );
      }
      if (
        input.courtApprovalPosition === 'unknown' ||
        input.courtApprovalPosition === 'required'
      ) {
        throw new NegotiationServiceError(
          'COURT_APPROVAL_REVIEW_REQUIRED',
          'The court approval position must be reviewed and required approval obtained.',
        );
      }
      if (!input.instrumentDocumentVersionId && !input.sourceCommunicationEntryId) {
        throw new NegotiationServiceError(
          'SOURCE_REQUIRED', 'A retained settlement instrument or communication is required.',
        );
      }
      if (!settlement.originatingActionId && user.role !== 'partner' && user.role !== 'admin') {
        throw new NegotiationServiceError(
          'APPROVAL_REQUIRED', 'A partner or administrator must confirm settlement conclusion.',
        );
      }
      if (settlement.originatingActionId) {
        const action = this.store.getAction(user, matterId, settlement.originatingActionId);
        if (!action.projection.approvalCurrent) {
          throw new NegotiationServiceError(
            'APPROVAL_REQUIRED', 'The originating exact action requires current firm approval.',
          );
        }
      }
      return this.store.concludeSettlement(user, matterId, settlementId, input, audit);
    } catch (error) {
      if (error instanceof NegotiationServiceError) throw error;
      rethrowStore(error);
    }
  }

  createObligation(
    user: SessionUser,
    matterId: string,
    settlementId: string,
    input: CreateSettlementObligationInput,
    audit: AuditContext,
  ) {
    this.requireCapability(user, 'settlement.manage');
    try {
      const settlement = this.store.getSettlement(user, matterId, settlementId);
      if (settlement.projection.state !== 'concluded') {
        throw new NegotiationServiceError(
          'INVALID_STATE', 'Settlement obligations require a concluded settlement record.',
        );
      }
      if (settlement.currentTerms?.id !== input.settlementTermsVersionId) {
        throw new NegotiationServiceError(
          'CONFLICT', 'The obligation must identify the exact concluded terms version.',
        );
      }
      return this.store.createObligation(user, matterId, settlementId, input, audit);
    } catch (error) {
      if (error instanceof NegotiationServiceError) throw error;
      rethrowStore(error);
    }
  }

  recordObligationEvent(
    user: SessionUser,
    matterId: string,
    obligationId: string,
    input: RecordSettlementObligationEventInput,
    audit: AuditContext,
  ) {
    this.requireCapability(user, input.eventType === 'waived'
      ? 'settlement.waive_obligation'
      : 'settlement.manage');
    try {
      if (
        input.eventType === 'satisfied' &&
        input.evidenceDocumentVersionIds.length === 0 &&
        input.evidenceCommunicationEntryIds.length === 0
      ) {
        throw new NegotiationServiceError(
          'SOURCE_REQUIRED', 'Satisfaction requires retained evidence.',
        );
      }
      if (input.eventType === 'waived') {
        if (user.role !== 'partner' && user.role !== 'admin') {
          throw new NegotiationServiceError(
            'FORBIDDEN', 'Only a partner or administrator may record an obligation waiver.',
          );
        }
        if (!input.waiverAuthorityDocumentVersionId) {
          throw new NegotiationServiceError(
            'SOURCE_REQUIRED', 'A waiver requires retained authority evidence.',
          );
        }
      }
      return this.store.recordObligationEvent(user, matterId, obligationId, input, audit);
    } catch (error) {
      if (error instanceof NegotiationServiceError) throw error;
      rethrowStore(error);
    }
  }
}
