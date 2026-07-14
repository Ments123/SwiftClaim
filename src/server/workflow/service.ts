import type {
  ConfirmWorkflowTriggerInput,
  TransitionWorkflowInput,
} from '../../shared/contracts.js';
import type { EvidenceReadinessProvider } from '../evidence/service.js';
import { hasCapability, type SessionUser } from '../policy.js';
import { type AuditContext, MatterStore } from '../store.js';
import {
  WorkflowStateConflictError,
  WorkflowStore,
  type WorkflowBlocker,
} from './store.js';

export type WorkflowErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'READINESS_BLOCKED'
  | 'CONFLICT'
  | 'RULE_NOT_FOUND';

export class WorkflowError extends Error {
  constructor(
    public readonly code: WorkflowErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}

function checklistLabel(key: string): string {
  const sentence = key.replaceAll('_', ' ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`;
}

function checklistSeverity(key: string): WorkflowBlocker['severity'] {
  return key.includes('conflict') || key.includes('authority')
    ? 'critical'
    : 'warning';
}

function daysBetween(from: string, to: string): number {
  const fromTime = Date.parse(`${from}T00:00:00.000Z`);
  const toTime = Date.parse(`${to}T00:00:00.000Z`);
  return Math.floor((toTime - fromTime) / 86_400_000);
}

export class WorkflowService {
  constructor(
    private readonly matterStore: MatterStore,
    private readonly workflowStore: WorkflowStore,
    private readonly now: () => Date,
    private readonly evidenceReadiness?: EvidenceReadinessProvider,
  ) {}

  getMatter360(user: SessionUser, matterId: string) {
    const aggregate = this.matterStore.getMatterAggregate(user, matterId);
    if (!aggregate) {
      throw new WorkflowError(
        'NOT_FOUND',
        'The requested resource was not found.',
      );
    }

    const workflow = this.workflowStore.getMatterWorkflow(user.firmId, matterId);
    if (!workflow) {
      throw new WorkflowError(
        'RULE_NOT_FOUND',
        'This matter has no configured workflow.',
      );
    }
    const stageDefinitions = this.workflowStore.listWorkflowStages(
      user.firmId,
      matterId,
    );
    const currentStage = stageDefinitions.find(
      (stage) => stage.key === workflow.currentStage.key,
    );
    if (!currentStage) {
      throw new WorkflowError(
        'RULE_NOT_FOUND',
        'The current workflow stage is not configured.',
      );
    }
    const completedChecklist = new Set(
      this.workflowStore.listCompletedChecklistKeys(user.firmId, matterId),
    );
    const blockers = currentStage.requiredChecklistKeys
      .filter((key) => !completedChecklist.has(key))
      .map((key): WorkflowBlocker => ({
        key,
        label: checklistLabel(key),
        severity: checklistSeverity(key),
      }));
    const deadlines = this.workflowStore.listMatterDeadlines(
      user.firmId,
      matterId,
    );
    const today = this.now().toISOString().slice(0, 10);
    const alerts: Array<{
      key: string;
      severity: 'warning' | 'critical';
      title: string;
      detail: string;
    }> = [];
    if (blockers.length > 0) {
      alerts.push({
        key: 'workflow.readiness',
        severity: 'warning',
        title: `${blockers.length} stage readiness check${blockers.length === 1 ? '' : 's'} outstanding`,
        detail: 'Complete the required controls before moving this matter forward.',
      });
    }
    for (const deadline of deadlines.filter(
      (candidate) => candidate.status === 'pending',
    )) {
      const daysRemaining = daysBetween(today, deadline.dueDate);
      if (daysRemaining < 0) {
        alerts.push({
          key: `deadline.overdue:${deadline.id}`,
          severity: 'critical',
          title: `Overdue: ${deadline.title}`,
          detail: `${Math.abs(daysRemaining)} day${Math.abs(daysRemaining) === 1 ? '' : 's'} overdue. ${deadline.explanation}`,
        });
      } else if (daysRemaining <= 7) {
        alerts.push({
          key: `deadline.due:${deadline.id}`,
          severity: daysRemaining <= 2 ? 'critical' : 'warning',
          title: `${deadline.title} due soon`,
          detail: `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining. ${deadline.explanation}`,
        });
      }
    }

    const canWrite = aggregate.permissions.canWrite;
    return {
      matter: aggregate.matter,
      workflow: {
        id: workflow.id,
        version: workflow.version,
        definitionVersion: workflow.workflowVersion,
        name: workflow.workflowName,
        currentStageKey: workflow.currentStage.key,
        currentStagePosition: workflow.currentStage.position,
        stages: stageDefinitions.map((stage) => ({
          ...stage,
          state:
            stage.position < workflow.currentStage.position
              ? ('completed' as const)
              : stage.position === workflow.currentStage.position
                ? ('current' as const)
                : ('upcoming' as const),
        })),
        completedChecklistKeys: [...completedChecklist],
        blockers,
      },
      deadlines: deadlines.map((deadline) => ({
        id: deadline.id,
        title: deadline.title,
        triggerDate: deadline.triggerDate,
        dueDate: deadline.dueDate,
        status: deadline.status,
        explanation: deadline.explanation,
        sourceTitle: deadline.source.title,
        sourceUrl: deadline.source.url,
        ruleKey: deadline.ruleKey,
      })),
      nextActions: aggregate.tasks
        .filter(
          (task) => task.status !== 'completed' && task.status !== 'cancelled',
        )
        .slice(0, 8),
      alerts,
      permissions: {
        canWrite,
        canTransition:
          canWrite && hasCapability(user, 'workflow.transition'),
        canOverrideWorkflow:
          canWrite && hasCapability(user, 'workflow.override'),
      },
    };
  }

  transitionStage(
    user: SessionUser,
    matterId: string,
    input: TransitionWorkflowInput,
    auditContext: AuditContext,
  ) {
    const aggregate = this.matterStore.getMatterAggregate(user, matterId);
    if (!aggregate) {
      throw new WorkflowError(
        'NOT_FOUND',
        'The requested resource was not found.',
      );
    }
    if (
      !aggregate.permissions.canWrite ||
      !hasCapability(user, 'workflow.transition')
    ) {
      throw new WorkflowError(
        'FORBIDDEN',
        'You do not have permission to transition this workflow.',
      );
    }
    const reason = input.reason.trim();
    if (!reason) {
      throw new WorkflowError(
        'READINESS_BLOCKED',
        'A transition reason is required.',
      );
    }

    const workflow = this.workflowStore.getMatterWorkflow(user.firmId, matterId);
    if (!workflow) {
      throw new WorkflowError(
        'RULE_NOT_FOUND',
        'This matter has no configured workflow.',
      );
    }
    if (workflow.version !== input.expectedVersion) {
      throw new WorkflowError(
        'CONFLICT',
        'The workflow was changed by another request.',
        { expectedVersion: input.expectedVersion, actualVersion: workflow.version },
      );
    }

    const stages = this.workflowStore.listWorkflowStages(user.firmId, matterId);
    const targetStage = stages.find((stage) => stage.key === input.toStageKey);
    if (!targetStage) {
      throw new WorkflowError(
        'RULE_NOT_FOUND',
        'The requested workflow stage is not configured.',
        { toStageKey: input.toStageKey },
      );
    }
    if (targetStage.key === workflow.currentStage.key) {
      throw new WorkflowError(
        'CONFLICT',
        'The matter is already at the requested stage.',
      );
    }

    const currentStage = stages.find(
      (stage) => stage.key === workflow.currentStage.key,
    );
    if (!currentStage) {
      throw new WorkflowError(
        'RULE_NOT_FOUND',
        'The current workflow stage is not configured.',
      );
    }
    const allowedChecklistKeys = new Set(
      stages.flatMap((stage) => stage.requiredChecklistKeys),
    );
    const suppliedChecklistKeys = [...new Set(input.completedChecklistKeys)];
    const unknownChecklistKey = suppliedChecklistKeys.find(
      (key) => !allowedChecklistKeys.has(key),
    );
    if (unknownChecklistKey) {
      throw new WorkflowError(
        'CONFLICT',
        'The transition contains an unknown checklist item.',
        { checklistKey: unknownChecklistKey },
      );
    }
    const supportedSuppliedChecklistKeys = new Set(suppliedChecklistKeys);
    const objectiveBlockers: WorkflowBlocker[] = [];
    if (currentStage.key === 'evidence' && this.evidenceReadiness) {
      const readiness = this.evidenceReadiness.getEvidenceReadiness(
        user.firmId,
        matterId,
      );
      const controls = new Map(
        readiness.controls.map((control) => [control.key, control]),
      );
      for (const key of suppliedChecklistKeys.filter((candidate) =>
        currentStage.requiredChecklistKeys.includes(candidate),
      )) {
        const control = controls.get(
          key as 'defect_schedule_recorded' | 'notice_evidence_recorded' | 'photographs_recorded',
        );
        if (!control?.eligible) {
          supportedSuppliedChecklistKeys.delete(key);
          objectiveBlockers.push({
            key,
            label:
              control?.explanation ??
              `${checklistLabel(key)} is not supported by the evidence record.`,
            severity: 'warning',
          });
        }
      }
    }
    const completed = new Set([
      ...this.workflowStore.listCompletedChecklistKeys(user.firmId, matterId),
      ...supportedSuppliedChecklistKeys,
    ]);
    const checklistBlockers = currentStage.requiredChecklistKeys
      .filter((key) => !completed.has(key))
      .map((key): WorkflowBlocker => ({
        key,
        label: checklistLabel(key),
        severity: checklistSeverity(key),
      }));
    const blockers = [
      ...new Map(
        [...checklistBlockers, ...objectiveBlockers].map((blocker) => [
          blocker.key,
          objectiveBlockers.find(({ key }) => key === blocker.key) ?? blocker,
        ]),
      ).values(),
    ];

    const overrideReason = input.overrideReason?.trim();
    if (overrideReason && !hasCapability(user, 'workflow.override')) {
      throw new WorkflowError(
        'FORBIDDEN',
        'You do not have permission to override workflow readiness checks.',
      );
    }
    if (blockers.length > 0) {
      if (!overrideReason) {
        throw new WorkflowError(
          'READINESS_BLOCKED',
          'Complete the required checks before transitioning this matter.',
          { blockers },
        );
      }
      if (overrideReason.length < 10) {
        throw new WorkflowError(
          'READINESS_BLOCKED',
          'The workflow override reason must be at least 10 characters.',
          { blockers },
        );
      }
    }

    try {
      this.workflowStore.transitionMatterWorkflow({
        firmId: user.firmId,
        matterId,
        actorUserId: user.id,
        toStageKey: input.toStageKey,
        expectedVersion: input.expectedVersion,
        completedChecklistKeys: [...supportedSuppliedChecklistKeys],
        reason,
        blockers,
        overrideReason,
        auditContext,
      });
    } catch (error) {
      if (error instanceof WorkflowStateConflictError) {
        throw new WorkflowError(
          'CONFLICT',
          'The workflow was changed by another request.',
          { expectedVersion: input.expectedVersion },
        );
      }
      throw error;
    }

    return this.getMatter360(user, matterId);
  }

  confirmTrigger(
    user: SessionUser,
    matterId: string,
    input: ConfirmWorkflowTriggerInput,
    auditContext: AuditContext,
  ) {
    const aggregate = this.matterStore.getMatterAggregate(user, matterId);
    if (!aggregate) {
      throw new WorkflowError(
        'NOT_FOUND',
        'The requested resource was not found.',
      );
    }
    if (
      !aggregate.permissions.canWrite ||
      !hasCapability(user, 'deadline.confirm')
    ) {
      throw new WorkflowError(
        'FORBIDDEN',
        'You do not have permission to confirm workflow triggers.',
      );
    }

    try {
      return this.workflowStore.recordTriggerAndDeadline({
        firmId: user.firmId,
        matterId,
        actorUserId: user.id,
        triggerEventType: input.eventType,
        triggerDate: input.occurredOn,
        idempotencyKey: input.idempotencyKey,
        auditContext,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith('No active deadline rule')
      ) {
        throw new WorkflowError('RULE_NOT_FOUND', error.message, {
          eventType: input.eventType,
          occurredOn: input.occurredOn,
        });
      }
      throw error;
    }
  }
}
