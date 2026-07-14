import { rm } from 'node:fs/promises';
import { join } from 'node:path';
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
import { hasCapability, type SessionUser } from '../policy.js';
import { storeGeneratedFile } from '../storage.js';
import type { AuditContext } from '../store.js';
import type { ProtocolReadinessProvider } from '../workflow/service.js';
import {
  PROTOCOL_RENDERER_VERSION,
  renderExpertInstructionDocx,
  renderLetterOfClaimDocx,
} from './renderer.js';
import {
  ProtocolStore,
  ProtocolStoreError,
  type ProtocolStoreErrorCode,
} from './store.js';

export type ProtocolErrorCode =
  | ProtocolStoreErrorCode
  | 'FORBIDDEN';

export class ProtocolError extends Error {
  constructor(readonly code: ProtocolErrorCode, message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

export class ProtocolService implements ProtocolReadinessProvider {
  constructor(
    private readonly database: DatabaseSync,
    private readonly store: ProtocolStore,
    private readonly storagePath: string,
    private readonly now: () => Date,
  ) {
    void this.database;
    void this.now;
  }

  private mapError(error: unknown): never {
    if (error instanceof ProtocolError) throw error;
    if (error instanceof ProtocolStoreError) {
      throw new ProtocolError(error.code, error.message);
    }
    throw error;
  }

  private require(
    user: SessionUser,
    capability: 'protocol.prepare' | 'protocol.approve' | 'protocol.override_conflict',
    matterId: string,
  ): void {
    if (!hasCapability(user, capability)) {
      throw new ProtocolError('FORBIDDEN', 'You do not have permission to perform this protocol action.');
    }
    const workspace = this.store.getWorkspace(user, matterId);
    if (!workspace) throw new ProtocolError('NOT_FOUND', 'The requested resource was not found.');
    const permitted = capability === 'protocol.prepare'
      ? workspace.permissions.canPrepare
      : capability === 'protocol.approve'
        ? workspace.permissions.canApprove
        : workspace.permissions.canOverrideConflict;
    if (!permitted) {
      throw new ProtocolError('FORBIDDEN', 'You do not have permission to perform this protocol action.');
    }
  }

  getWorkspace(user: SessionUser, matterId: string) {
    try {
      return this.store.getWorkspace(user, matterId);
    } catch (error) {
      return this.mapError(error);
    }
  }

  getProtocolReadiness(
    firmId: string,
    matterId: string,
    stageKey: 'protocol' | 'expert',
  ) {
    return this.store.getProtocolReadiness(firmId, matterId, stageKey);
  }

  varyProtocolDeadline(
    user: SessionUser,
    matterId: string,
    input: VaryProtocolDeadlineInput,
    audit: AuditContext,
  ) {
    this.require(user, 'protocol.approve', matterId);
    try {
      return this.store.varyDeadline(user, matterId, input, audit);
    } catch (error) {
      return this.mapError(error);
    }
  }

  saveLetter(
    user: SessionUser,
    matterId: string,
    input: SaveLetterOfClaimInput,
    audit: AuditContext,
  ) {
    this.require(user, 'protocol.prepare', matterId);
    try {
      return this.store.saveLetter(user, matterId, input, audit);
    } catch (error) {
      return this.mapError(error);
    }
  }

  async approveLetter(
    user: SessionUser,
    matterId: string,
    input: ApproveLetterOfClaimInput,
    audit: AuditContext,
  ) {
    this.require(user, 'protocol.approve', matterId);
    const workspace = this.getWorkspace(user, matterId);
    if (!workspace) throw new ProtocolError('NOT_FOUND', 'The protocol workspace was not found.');

    let storageKey: string | undefined;
    try {
      const bytes = await renderLetterOfClaimDocx(workspace.letter.source.model);
      const generated = await storeGeneratedFile(this.storagePath, bytes);
      storageKey = generated.storageKey;
      const version = this.store.persistApproval(
        user,
        matterId,
        input,
        generated,
        PROTOCOL_RENDERER_VERSION,
        audit,
      );
      const persisted = this.store.getDocumentFileByVersion(
        user.firmId,
        matterId,
        version.documentVersion.id,
      );
      if (persisted?.storageKey !== storageKey) {
        await rm(join(this.storagePath, `${storageKey}.blob`), { force: true });
      }
      return { version };
    } catch (error) {
      if (storageKey) {
        await rm(join(this.storagePath, `${storageKey}.blob`), { force: true });
      }
      return this.mapError(error);
    }
  }

  recordServiceEvent(
    user: SessionUser,
    matterId: string,
    input: RecordProtocolServiceEventInput,
    audit: AuditContext,
  ) {
    const requiresApproval = input.eventType !== 'dispatched' || Boolean(input.supersedesEventId);
    this.require(user, requiresApproval ? 'protocol.approve' : 'protocol.prepare', matterId);
    try {
      return this.store.recordServiceEvent(user, matterId, input, audit);
    } catch (error) {
      return this.mapError(error);
    }
  }

  recordLandlordResponse(
    user: SessionUser,
    matterId: string,
    input: RecordLandlordResponseInput,
    audit: AuditContext,
  ) {
    this.require(
      user,
      input.responseType === 'no_response_recorded' || Boolean(input.supersedesResponseId)
        ? 'protocol.approve'
        : 'protocol.prepare',
      matterId,
    );
    try {
      return this.store.recordLandlordResponse(user, matterId, input, audit);
    } catch (error) {
      return this.mapError(error);
    }
  }

  selectExpertRoute(
    user: SessionUser,
    matterId: string,
    input: SelectExpertRouteInput,
    audit: AuditContext,
  ) {
    this.require(
      user,
      ['not_required', 'urgent_own_expert'].includes(input.route)
        ? 'protocol.approve'
        : 'protocol.prepare',
      matterId,
    );
    try {
      return this.store.selectExpertRoute(user, matterId, input, audit);
    } catch (error) {
      return this.mapError(error);
    }
  }

  createExpertEngagement(
    user: SessionUser,
    matterId: string,
    input: CreateExpertEngagementInput,
    audit: AuditContext,
  ) {
    this.require(user, 'protocol.prepare', matterId);
    try {
      return this.store.createExpertEngagement(user, matterId, input, audit);
    } catch (error) {
      return this.mapError(error);
    }
  }

  updateExpertEngagement(
    user: SessionUser,
    matterId: string,
    engagementId: string,
    input: UpdateExpertEngagementInput,
    audit: AuditContext,
  ) {
    this.require(user, 'protocol.prepare', matterId);
    try {
      return this.store.updateExpertEngagement(user, matterId, engagementId, input, audit);
    } catch (error) {
      return this.mapError(error);
    }
  }

  recordExpertConflictCheck(
    user: SessionUser,
    matterId: string,
    engagementId: string,
    input: RecordExpertConflictCheckInput,
    audit: AuditContext,
  ) {
    this.require(
      user,
      input.decision === 'proceed_with_override'
        ? 'protocol.override_conflict'
        : 'protocol.approve',
      matterId,
    );
    try {
      return this.store.recordExpertConflictCheck(user, matterId, engagementId, input, audit);
    } catch (error) {
      return this.mapError(error);
    }
  }

  async approveExpertInstruction(
    user: SessionUser,
    matterId: string,
    engagementId: string,
    input: ApproveExpertInstructionInput,
    audit: AuditContext,
  ) {
    this.require(user, 'protocol.approve', matterId);
    let storageKey: string | undefined;
    try {
      const assembly = this.store.assembleExpertInstruction(user, matterId, engagementId, input);
      const bytes = await renderExpertInstructionDocx(assembly.model);
      const generated = await storeGeneratedFile(this.storagePath, bytes);
      storageKey = generated.storageKey;
      const version = this.store.persistExpertInstruction(
        user,
        matterId,
        engagementId,
        input,
        assembly,
        generated,
        PROTOCOL_RENDERER_VERSION,
        audit,
      );
      const persisted = this.store.getDocumentFileByVersion(
        user.firmId,
        matterId,
        version.documentVersion.id,
      );
      if (persisted?.storageKey !== storageKey) {
        await rm(join(this.storagePath, `${storageKey}.blob`), { force: true });
      }
      return { version };
    } catch (error) {
      if (storageKey) await rm(join(this.storagePath, `${storageKey}.blob`), { force: true });
      return this.mapError(error);
    }
  }

  recordExpertMilestone(
    user: SessionUser,
    matterId: string,
    engagementId: string,
    input: RecordExpertMilestoneInput,
    audit: AuditContext,
  ) {
    const legalEvents = new Set([
      'inspection_completed', 'inspection_failed', 'inspection_cancelled',
      'report_reviewed', 'report_shared', 'urgent_issue_escalated',
      'engagement_completed', 'engagement_cancelled',
    ]);
    this.require(user, legalEvents.has(input.eventType) ? 'protocol.approve' : 'protocol.prepare', matterId);
    try {
      return this.store.recordExpertMilestone(user, matterId, engagementId, input, audit);
    } catch (error) {
      return this.mapError(error);
    }
  }

  recordExpertReport(
    user: SessionUser,
    matterId: string,
    engagementId: string,
    input: RecordExpertReportInput,
    audit: AuditContext,
  ) {
    this.require(user, 'protocol.prepare', matterId);
    try {
      return this.store.recordExpertReport(user, matterId, engagementId, input, audit);
    } catch (error) {
      return this.mapError(error);
    }
  }

  recordExpertQuestion(
    user: SessionUser,
    matterId: string,
    engagementId: string,
    input: RecordExpertQuestionInput,
    audit: AuditContext,
  ) {
    this.require(user, 'protocol.approve', matterId);
    try {
      return this.store.recordExpertQuestion(user, matterId, engagementId, input, audit);
    } catch (error) {
      return this.mapError(error);
    }
  }

  recordExpertQuestionAnswer(
    user: SessionUser,
    matterId: string,
    engagementId: string,
    questionId: string,
    input: RecordExpertQuestionAnswerInput,
    audit: AuditContext,
  ) {
    this.require(user, 'protocol.prepare', matterId);
    try {
      return this.store.recordExpertQuestionAnswer(
        user,
        matterId,
        engagementId,
        questionId,
        input,
        audit,
      );
    } catch (error) {
      return this.mapError(error);
    }
  }
}
