import type {
  ApproveLossScheduleInput,
  ApproveWorkScheduleInput,
  CreateGeneralDamagesReviewInput,
  CreateLossItemInput,
  CreateLossScheduleInput,
  CreateOfferInput,
  CreateRepairEventInput,
  CreateWorkScheduleInput,
  RecordOfferEventInput,
  ReviewPart36Input,
  UpdateLossItemInput,
} from '../../shared/contracts.js';
import { hasCapability, type Capability, type SessionUser } from '../policy.js';
import type { AuditContext } from '../store.js';
import {
  QuantumStore,
  QuantumStoreError,
  type QuantumStoreErrorCode,
} from './store.js';

export type QuantumErrorCode = QuantumStoreErrorCode | 'FORBIDDEN';

export class QuantumError extends Error {
  constructor(
    readonly code: QuantumErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'QuantumError';
  }
}

function addCalendarDays(dateOnly: string, days: number): string {
  const date = new Date(`${dateOnly}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export class QuantumService {
  constructor(
    private readonly store: QuantumStore,
    private readonly now: () => Date,
  ) {}

  private mapError(error: unknown): never {
    if (error instanceof QuantumError) throw error;
    if (error instanceof QuantumStoreError) {
      throw new QuantumError(error.code, error.message);
    }
    throw error;
  }

  private workspaceBeforeCapability(user: SessionUser, matterId: string) {
    const workspace = this.store.getWorkspace(user, matterId);
    if (!workspace) {
      throw new QuantumError('NOT_FOUND', 'The requested resource was not found.');
    }
    return workspace;
  }

  private require(
    user: SessionUser,
    matterId: string,
    capability: Capability,
  ) {
    const workspace = this.workspaceBeforeCapability(user, matterId);
    if (!hasCapability(user, capability)) {
      throw new QuantumError(
        'FORBIDDEN',
        'You do not have permission to perform this repairs and quantum action.',
      );
    }
    return workspace;
  }

  getWorkspace(user: SessionUser, matterId: string) {
    const workspace = this.require(user, matterId, 'quantum.read');
    return {
      ...workspace,
      permissions: {
        canWrite: hasCapability(user, 'quantum.write') && workspace.permissions.canWrite,
        canApprove: hasCapability(user, 'quantum.approve') && workspace.permissions.canWrite,
        canWriteOffers: hasCapability(user, 'offers.write') && workspace.permissions.canWrite,
        canReadProtectedOffers: hasCapability(user, 'offers.read_protected'),
        canRecordOfferOutcome:
          hasCapability(user, 'offers.record_outcome') && workspace.permissions.canWrite,
      },
      readiness: this.getQuantumReadiness(user.firmId, matterId),
    };
  }

  getProtectedOffers(user: SessionUser, matterId: string) {
    this.require(user, matterId, 'offers.read_protected');
    try {
      const offers = this.store.getProtectedOffers(user, matterId);
      if (!offers) {
        throw new QuantumError('NOT_FOUND', 'The requested resource was not found.');
      }
      return offers;
    } catch (error) {
      return this.mapError(error);
    }
  }

  createWorkSchedule(
    user: SessionUser,
    matterId: string,
    input: CreateWorkScheduleInput,
    audit: AuditContext,
  ) {
    this.require(user, matterId, 'quantum.write');
    try {
      return this.store.createWorkSchedule(user, matterId, input, audit);
    } catch (error) {
      return this.mapError(error);
    }
  }

  approveWorkSchedule(
    user: SessionUser,
    matterId: string,
    scheduleId: string,
    input: ApproveWorkScheduleInput,
    audit: AuditContext,
  ) {
    const workspace = this.require(user, matterId, 'quantum.approve');
    const schedule = workspace.workSchedules.find(({ id }) => id === scheduleId);
    if (!schedule) {
      throw new QuantumError('NOT_FOUND', 'The work schedule was not found.');
    }
    const required = new Set(
      schedule.items.flatMap(({ projection }) =>
        projection.warnings.map(({ key }) => key),
      ),
    );
    const acknowledged = new Set(input.acknowledgedWarningKeys);
    const missing = [...required].filter((key) => !acknowledged.has(key));
    if (missing.length > 0) {
      throw new QuantumError(
        'APPROVAL_BLOCKED',
        `Review and acknowledge the current repair warnings: ${missing.join(', ')}.`,
      );
    }
    try {
      return this.store.approveWorkSchedule(
        user,
        matterId,
        scheduleId,
        input,
        audit,
      );
    } catch (error) {
      return this.mapError(error);
    }
  }

  recordRepairEvent(
    user: SessionUser,
    matterId: string,
    workItemId: string,
    input: CreateRepairEventInput,
    audit: AuditContext,
  ) {
    this.require(user, matterId, 'quantum.write');
    if (
      input.eventType === 'verified_complete' &&
      (!input.verifier.trim() || input.evidenceItemIds.length === 0)
    ) {
      throw new QuantumError(
        'APPROVAL_BLOCKED',
        'Verified completion requires a verifier and retained completion evidence.',
      );
    }
    try {
      return this.store.appendRepairEvent(
        user,
        matterId,
        workItemId,
        input,
        audit,
      );
    } catch (error) {
      return this.mapError(error);
    }
  }

  createLossSchedule(
    user: SessionUser,
    matterId: string,
    input: CreateLossScheduleInput,
    audit: AuditContext,
  ) {
    this.require(user, matterId, 'quantum.write');
    try {
      return this.store.createLossSchedule(user, matterId, input, audit);
    } catch (error) {
      return this.mapError(error);
    }
  }

  addLossItem(
    user: SessionUser,
    matterId: string,
    scheduleId: string,
    input: CreateLossItemInput,
    audit: AuditContext,
  ) {
    this.require(user, matterId, 'quantum.write');
    try {
      return this.store.addLossItem(user, matterId, scheduleId, input, audit);
    } catch (error) {
      return this.mapError(error);
    }
  }

  updateLossItem(
    user: SessionUser,
    matterId: string,
    scheduleId: string,
    itemId: string,
    input: UpdateLossItemInput,
    audit: AuditContext,
  ) {
    this.require(user, matterId, 'quantum.write');
    try {
      return this.store.updateLossItem(
        user,
        matterId,
        scheduleId,
        itemId,
        input,
        audit,
      );
    } catch (error) {
      return this.mapError(error);
    }
  }

  approveLossSchedule(
    user: SessionUser,
    matterId: string,
    scheduleId: string,
    input: ApproveLossScheduleInput,
    audit: AuditContext,
  ) {
    const workspace = this.require(user, matterId, 'quantum.approve');
    const schedule = workspace.lossSchedules.find(({ id }) => id === scheduleId);
    if (!schedule) {
      throw new QuantumError('NOT_FOUND', 'The loss schedule was not found.');
    }
    if (schedule.items.length === 0) {
      throw new QuantumError(
        'APPROVAL_BLOCKED',
        'A loss schedule must contain at least one reviewed item.',
      );
    }
    const gapIds = schedule.items
      .filter(
        ({ evidenceStatus, position }) =>
          position !== 'withdrawn' &&
          (evidenceStatus === 'partial' || evidenceStatus === 'missing'),
      )
      .map(({ id }) => id);
    const acknowledged = new Set(input.acknowledgedEvidenceGapItemIds);
    const missing = gapIds.filter((id) => !acknowledged.has(id));
    if (missing.length > 0) {
      throw new QuantumError(
        'APPROVAL_BLOCKED',
        'Every current evidence gap must be acknowledged before approval.',
      );
    }
    try {
      return this.store.approveLossSchedule(
        user,
        matterId,
        scheduleId,
        input,
        audit,
      );
    } catch (error) {
      return this.mapError(error);
    }
  }

  createGeneralDamagesReview(
    user: SessionUser,
    matterId: string,
    input: CreateGeneralDamagesReviewInput,
    audit: AuditContext,
  ) {
    this.require(user, matterId, 'quantum.approve');
    try {
      return this.store.createGeneralDamagesReview(user, matterId, input, audit);
    } catch (error) {
      return this.mapError(error);
    }
  }

  createOffer(
    user: SessionUser,
    matterId: string,
    input: CreateOfferInput,
    audit: AuditContext,
  ) {
    this.require(user, matterId, 'offers.write');
    try {
      return this.store.createOffer(user, matterId, input, audit);
    } catch (error) {
      return this.mapError(error);
    }
  }

  recordOfferEvent(
    user: SessionUser,
    matterId: string,
    offerId: string,
    input: RecordOfferEventInput,
    audit: AuditContext,
  ) {
    this.require(
      user,
      matterId,
      ['accepted', 'withdrawn'].includes(input.eventType)
        ? 'offers.record_outcome'
        : 'offers.write',
    );
    try {
      return this.store.appendOfferEvent(user, matterId, offerId, input, audit);
    } catch (error) {
      return this.mapError(error);
    }
  }

  reviewPart36(
    user: SessionUser,
    matterId: string,
    offerId: string,
    input: ReviewPart36Input,
    audit: AuditContext,
  ) {
    this.require(user, matterId, 'offers.record_outcome');
    const protectedOffers = this.store.getProtectedOffers(user, matterId);
    const offer = protectedOffers?.find(({ id }) => id === offerId);
    if (!offer?.part36) {
      throw new QuantumError('NOT_FOUND', 'The Part 36 offer was not found.');
    }
    const projectedEndOn = addCalendarDays(
      input.serviceOn,
      offer.part36.relevantPeriodDays,
    );
    const explanation =
      `${offer.part36.relevantPeriodDays}-calendar-day projection from the ` +
      `user-confirmed service date. Solicitor must confirm CPR service, counting ` +
      `and the legal effect before relying on this date.`;
    try {
      return this.store.reviewPart36(
        user,
        matterId,
        offerId,
        input,
        projectedEndOn,
        explanation,
        audit,
      );
    } catch (error) {
      return this.mapError(error);
    }
  }

  getQuantumReadiness(firmId: string, matterId: string) {
    const systemUser: SessionUser = {
      id: '',
      firmId,
      firmName: '',
      email: '',
      name: '',
      role: 'admin',
    };
    // Read directly through a scoped synthetic system identity is not safe because
    // matter access policy depends on a real user. The store workspace is therefore
    // queried by a narrow internal projection added at integration time.
    void systemUser;
    const projection = this.store.getReadinessProjection(firmId, matterId);
    const currentWorks = projection.currentWorkSchedule;
    const workWarningKeys = new Set(
      currentWorks?.items.flatMap(({ projection: item }) =>
        item.warnings.map(({ key }) => key),
      ) ?? [],
    );
    const worksAcknowledged = new Set(
      currentWorks?.acknowledgedWarningKeys ?? [],
    );
    const missingWorkWarnings = [...workWarningKeys].filter(
      (key) => !worksAcknowledged.has(key),
    );

    const currentLoss = projection.currentLossSchedule;
    const gapIds =
      currentLoss?.items
        .filter(
          ({ evidenceStatus, position }) =>
            position !== 'withdrawn' &&
            (evidenceStatus === 'partial' || evidenceStatus === 'missing'),
        )
        .map(({ id }) => id) ?? [];
    const acknowledgedGapIds = new Set(
      currentLoss?.acknowledgedEvidenceGapItemIds ?? [],
    );
    const missingGapIds = gapIds.filter((id) => !acknowledgedGapIds.has(id));

    return {
      controls: [
        {
          key: 'works_status_reviewed' as const,
          eligible: Boolean(currentWorks) && missingWorkWarnings.length === 0,
          explanation: !currentWorks
            ? 'No approved current schedule of works exists.'
            : missingWorkWarnings.length > 0
              ? 'Current repair warnings require explicit review.'
              : 'The approved schedule records the current repair position and reviewed warnings.',
        },
        {
          key: 'damages_schedule_reviewed' as const,
          eligible:
            Boolean(currentLoss) &&
            currentLoss!.items.length > 0 &&
            missingGapIds.length === 0 &&
            Boolean(projection.currentGeneralDamagesReview),
          explanation: !currentLoss
            ? 'No approved current schedule of loss exists.'
            : missingGapIds.length > 0
              ? 'Current loss evidence gaps require explicit review.'
              : !projection.currentGeneralDamagesReview
                ? 'A current human general-damages review is required.'
                : 'The approved loss schedule is reproducible and valuation provenance is reviewed.',
        },
      ],
    };
  }
}
