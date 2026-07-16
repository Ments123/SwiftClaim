import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { appendAudit, appendTimeline, type AuditContext } from '../store.js';
import { calculateDeadline } from './calendar.js';
import { HOUSING_DISREPAIR_WORKFLOW } from './definitions.js';
import type {
  BusinessCalendar,
  DeadlineCalculation,
  DeadlineRule,
} from './types.js';

type SqlValue = string | number | null;
type Row = Record<string, SqlValue>;

export interface MatterWorkflowRecord {
  id: string;
  firmId: string;
  matterId: string;
  workflowKey: string;
  workflowName: string;
  workflowVersion: number;
  currentStage: {
    key: string;
    name: string;
    position: number;
    description: string;
    requiredChecklistKeys: string[];
  };
  version: number;
  startedAt: string;
  updatedAt: string;
}

export interface MatterDeadlineRecord {
  id: string;
  title: string;
  triggerDate: string;
  dueDate: string;
  status: 'pending' | 'satisfied' | 'superseded' | 'cancelled';
  explanation: string;
  calculation: DeadlineCalculation;
  source: {
    title: string;
    url: string;
  };
  ruleKey: string;
  createdAt: string;
}

export interface WorkflowStageRecord {
  key: string;
  name: string;
  position: number;
  description: string;
  requiredChecklistKeys: string[];
  allowedNextStageKeys: string[];
}

export interface WorkflowBlocker {
  key: string;
  label: string;
  severity: 'warning' | 'critical';
}

export interface BootstrapIntakeWorkflowInput {
  firmId: string;
  matterId: string;
  actorUserId: string;
  occurredAt: string;
}

export class WorkflowStateConflictError extends Error {
  constructor() {
    super('The workflow was changed by another request');
    this.name = 'WorkflowStateConflictError';
  }
}

export interface RecordTriggerInput {
  firmId: string;
  matterId: string;
  actorUserId: string;
  triggerEventType: string;
  triggerDate: string;
  idempotencyKey: string;
  auditContext: AuditContext;
}

export interface TriggerDeadlineResult {
  event: { id: string; type: string; occurredOn: string };
  deadline: MatterDeadlineRecord;
  task: { id: string; title: string; dueAt: string };
}

interface DeadlineRow extends Row {
  id: string;
  title: string;
  triggerDate: string;
  dueDate: string;
  status: string;
  explanation: string;
  calculationJson: string;
  sourceTitle: string;
  sourceUrl: string;
  ruleKey: string;
  createdAt: string;
}

function row(value: unknown): Row | undefined {
  return value as Row | undefined;
}

function rows(value: unknown): Row[] {
  return value as Row[];
}

function mapWorkflow(value: Row): MatterWorkflowRecord {
  return {
    id: String(value.id),
    firmId: String(value.firmId),
    matterId: String(value.matterId),
    workflowKey: String(value.workflowKey),
    workflowName: String(value.workflowName),
    workflowVersion: Number(value.workflowVersion),
    currentStage: {
      key: String(value.stageKey),
      name: String(value.stageName),
      position: Number(value.stagePosition),
      description: String(value.stageDescription),
      requiredChecklistKeys: JSON.parse(
        String(value.requiredChecklistJson),
      ) as string[],
    },
    version: Number(value.instanceVersion),
    startedAt: String(value.startedAt),
    updatedAt: String(value.updatedAt),
  };
}

function mapDeadline(value: Row): MatterDeadlineRecord {
  const deadline = value as DeadlineRow;
  return {
    id: String(deadline.id),
    title: String(deadline.title),
    triggerDate: String(deadline.triggerDate),
    dueDate: String(deadline.dueDate),
    status: String(deadline.status) as MatterDeadlineRecord['status'],
    explanation: String(deadline.explanation),
    calculation: JSON.parse(
      String(deadline.calculationJson),
    ) as DeadlineCalculation,
    source: {
      title: String(deadline.sourceTitle),
      url: String(deadline.sourceUrl),
    },
    ruleKey: String(deadline.ruleKey),
    createdAt: String(deadline.createdAt),
  };
}

export class WorkflowStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date,
  ) {}

  private requireMatterAndActor(
    firmId: string,
    matterId: string,
    actorUserId: string,
  ): void {
    const validMatterAndActor = row(
      this.database
        .prepare(
          `SELECT m.id
           FROM matters m
           JOIN users u ON u.id = ? AND u.firm_id = m.firm_id AND u.active = 1
           WHERE m.id = ? AND m.firm_id = ?`,
        )
        .get(actorUserId, matterId, firmId),
    );
    if (!validMatterAndActor) {
      throw new Error('Matter or actor not found in firm');
    }
  }

  private activeHousingWorkflowVersion(effectiveOn: string): Row {
    const version = row(
      this.database
        .prepare(
          `SELECT wv.id, wv.version
           FROM workflow_versions wv
           JOIN workflow_templates wt ON wt.id = wv.template_id
           WHERE wt.key = ?
             AND wv.status = 'active'
             AND wv.effective_from <= ?
             AND (wv.effective_to IS NULL OR wv.effective_to >= ?)
           ORDER BY wv.version DESC
           LIMIT 1`,
        )
        .get(HOUSING_DISREPAIR_WORKFLOW.key, effectiveOn, effectiveOn),
    );
    if (!version) {
      throw new Error('No active housing conditions workflow is configured');
    }
    return version;
  }

  instantiateMatterWorkflow(
    firmId: string,
    matterId: string,
    actorUserId: string,
  ): MatterWorkflowRecord {
    const occurredAt = this.now().toISOString();
    const effectiveOn = occurredAt.slice(0, 10);

    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.requireMatterAndActor(firmId, matterId, actorUserId);
      const version = this.activeHousingWorkflowVersion(effectiveOn);

      const firstStage = row(
        this.database
          .prepare(
            `SELECT key
             FROM workflow_stages
             WHERE workflow_version_id = ?
             ORDER BY position
             LIMIT 1`,
          )
          .get(String(version.id)),
      );
      if (!firstStage) {
        throw new Error('Workflow has no stages');
      }

      const workflowId = randomUUID();
      const inserted = this.database
        .prepare(
          `INSERT OR IGNORE INTO matter_workflows (
            id, firm_id, matter_id, workflow_version_id, current_stage_key,
            version, started_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          workflowId,
          firmId,
          matterId,
          String(version.id),
          String(firstStage.key),
          occurredAt,
          occurredAt,
        );

      if (inserted.changes === 1) {
        this.database
          .prepare(
            `INSERT INTO matter_stage_history (
              id, firm_id, matter_id, matter_workflow_id, from_stage_key,
              to_stage_key, reason, actor_user_id, occurred_at
            ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            firmId,
            matterId,
            workflowId,
            String(firstStage.key),
            'Workflow started',
            actorUserId,
            occurredAt,
          );
      }

      const result = this.getMatterWorkflow(firmId, matterId);
      if (!result) {
        throw new Error('Workflow could not be instantiated');
      }
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  bootstrapFromIntakeInTransaction(
    input: BootstrapIntakeWorkflowInput,
  ): MatterWorkflowRecord {
    this.requireMatterAndActor(
      input.firmId,
      input.matterId,
      input.actorUserId,
    );
    const version = this.activeHousingWorkflowVersion(
      input.occurredAt.slice(0, 10),
    );
    const stages = rows(
      this.database
        .prepare(
          `SELECT key, position, required_checklist_json AS requiredChecklistJson
           FROM workflow_stages
           WHERE workflow_version_id = ? AND position <= 3
           ORDER BY position`,
        )
        .all(String(version.id)),
    );
    const expectedStages = ['enquiry', 'assessment', 'onboarding', 'evidence'];
    if (
      stages.length !== expectedStages.length ||
      stages.some((stage, index) => String(stage.key) !== expectedStages[index])
    ) {
      throw new Error(
        'The active housing conditions workflow cannot bootstrap intake at Evidence',
      );
    }

    const workflowId = randomUUID();
    this.database
      .prepare(
        `INSERT INTO matter_workflows (
           id, firm_id, matter_id, workflow_version_id, current_stage_key,
           version, started_at, updated_at
         ) VALUES (?, ?, ?, ?, 'evidence', 4, ?, ?)`,
      )
      .run(
        workflowId,
        input.firmId,
        input.matterId,
        String(version.id),
        input.occurredAt,
        input.occurredAt,
      );

    const insertHistory = this.database.prepare(
      `INSERT INTO matter_stage_history (
         id, firm_id, matter_id, matter_workflow_id, from_stage_key,
         to_stage_key, reason, actor_user_id, occurred_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const transitions = [
      {
        from: null,
        to: 'enquiry',
        reason: 'Enquiry captured in SwiftClaim intake.',
      },
      {
        from: 'enquiry',
        to: 'assessment',
        reason: 'Conflict and initial enquiry controls completed.',
      },
      {
        from: 'assessment',
        to: 'onboarding',
        reason: 'Reviewed legal assessment approved the enquiry to proceed.',
      },
      {
        from: 'onboarding',
        to: 'evidence',
        reason: 'Client onboarding completed and the matter was opened.',
      },
    ] as const;
    for (const transition of transitions) {
      insertHistory.run(
        randomUUID(),
        input.firmId,
        input.matterId,
        workflowId,
        transition.from,
        transition.to,
        transition.reason,
        input.actorUserId,
        input.occurredAt,
      );
    }

    const insertChecklist = this.database.prepare(
      `INSERT INTO matter_workflow_checklist (
         id, firm_id, matter_id, matter_workflow_id, checklist_key,
         completed_by, completed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const stage of stages.slice(0, 3)) {
      const checklistKeys = JSON.parse(
        String(stage.requiredChecklistJson),
      ) as string[];
      for (const checklistKey of checklistKeys) {
        insertChecklist.run(
          randomUUID(),
          input.firmId,
          input.matterId,
          workflowId,
          checklistKey,
          input.actorUserId,
          input.occurredAt,
        );
      }
    }

    const result = this.getMatterWorkflow(input.firmId, input.matterId);
    if (!result) throw new Error('Intake workflow could not be bootstrapped');
    return result;
  }

  getMatterWorkflow(
    firmId: string,
    matterId: string,
  ): MatterWorkflowRecord | undefined {
    const result = row(
      this.database
        .prepare(
          `SELECT
            mw.id,
            mw.firm_id AS firmId,
            mw.matter_id AS matterId,
            wt.key AS workflowKey,
            wt.name AS workflowName,
            wv.version AS workflowVersion,
            ws.key AS stageKey,
            ws.name AS stageName,
            ws.position AS stagePosition,
            ws.description AS stageDescription,
            ws.required_checklist_json AS requiredChecklistJson,
            mw.version AS instanceVersion,
            mw.started_at AS startedAt,
            mw.updated_at AS updatedAt
           FROM matter_workflows mw
           JOIN workflow_versions wv ON wv.id = mw.workflow_version_id
           JOIN workflow_templates wt ON wt.id = wv.template_id
           JOIN workflow_stages ws
             ON ws.workflow_version_id = mw.workflow_version_id
            AND ws.key = mw.current_stage_key
           WHERE mw.firm_id = ? AND mw.matter_id = ?`,
        )
        .get(firmId, matterId),
    );
    return result ? mapWorkflow(result) : undefined;
  }

  recordTriggerAndDeadline(input: RecordTriggerInput): TriggerDeadlineResult {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = this.recordTriggerAndDeadlineInTransaction(input);
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  recordTriggerAndDeadlineInTransaction(
    input: RecordTriggerInput,
  ): TriggerDeadlineResult {
      const createdAt = this.now().toISOString();
      const workflow = this.getMatterWorkflow(input.firmId, input.matterId);
      if (!workflow) {
        throw new Error('Matter workflow not found');
      }

      const existingEvent = row(
        this.database
          .prepare(
            `SELECT id, type, occurred_on AS occurredOn,
                    actor_user_id AS actorUserId
             FROM domain_events
             WHERE firm_id = ? AND matter_id = ? AND idempotency_key = ?`,
          )
          .get(input.firmId, input.matterId, input.idempotencyKey),
      );
      if (
        existingEvent &&
        (String(existingEvent.type) !== input.triggerEventType ||
          String(existingEvent.occurredOn) !== input.triggerDate ||
          String(existingEvent.actorUserId) !== input.actorUserId)
      ) {
        throw new Error(
          'Idempotency key has already been used for different trigger data',
        );
      }

      const ruleRows = rows(
        this.database
          .prepare(
            `SELECT dr.*
             FROM deadline_rules dr
             JOIN matter_workflows mw
               ON mw.workflow_version_id = dr.workflow_version_id
             WHERE mw.firm_id = ?
               AND mw.matter_id = ?
               AND dr.trigger_event_type = ?
               AND dr.effective_from <= ?
               AND (dr.effective_to IS NULL OR dr.effective_to >= ?)
             ORDER BY dr.version DESC`,
          )
          .all(
            input.firmId,
            input.matterId,
            input.triggerEventType,
            input.triggerDate,
            input.triggerDate,
          ),
      );
      if (ruleRows.length === 0) {
        throw new Error(
          `No active deadline rule for ${input.triggerEventType}`,
        );
      }
      const highestRuleVersion = Number(ruleRows[0]?.version);
      const currentRules = ruleRows.filter(
        (candidate) => Number(candidate.version) === highestRuleVersion,
      );
      if (currentRules.length !== 1) {
        throw new Error(
          `Trigger ${input.triggerEventType} resolves to multiple deadline rules`,
        );
      }
      const ruleRow = currentRules[0];
      const rule = JSON.parse(String(ruleRow.definition_json)) as DeadlineRule;

      const calendarRow = row(
        this.database
          .prepare(
            `SELECT id, name, timezone, weekend_days_json AS weekendDaysJson
             FROM business_calendars
             WHERE (firm_id = ? OR firm_id IS NULL)
               AND effective_from <= ?
               AND (effective_to IS NULL OR effective_to >= ?)
             ORDER BY CASE WHEN firm_id = ? THEN 0 ELSE 1 END, effective_from DESC
             LIMIT 1`,
          )
          .get(
            input.firmId,
            input.triggerDate,
            input.triggerDate,
            input.firmId,
          ),
      );
      if (!calendarRow) {
        throw new Error(`No business calendar covers ${input.triggerDate}`);
      }
      const holidays = rows(
        this.database
          .prepare(
            `SELECT date
             FROM business_calendar_holidays
             WHERE calendar_id = ?
             ORDER BY date`,
          )
          .all(String(calendarRow.id)),
      ).map((holiday) => String(holiday.date));
      const calendar: BusinessCalendar = {
        id: String(calendarRow.id),
        name: String(calendarRow.name),
        timezone: String(calendarRow.timezone),
        weekendDays: JSON.parse(String(calendarRow.weekendDaysJson)) as number[],
        holidays,
      };

      const eventId = existingEvent ? String(existingEvent.id) : randomUUID();
      if (!existingEvent) {
        this.database
          .prepare(
            `INSERT INTO domain_events (
              id, firm_id, matter_id, type, occurred_on, actor_user_id,
              idempotency_key, payload_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            eventId,
            input.firmId,
            input.matterId,
            input.triggerEventType,
            input.triggerDate,
            input.actorUserId,
            input.idempotencyKey,
            JSON.stringify({ triggerDate: input.triggerDate }),
            createdAt,
          );
      }

      const calculation = calculateDeadline({
        triggerDate: input.triggerDate,
        triggerEventId: eventId,
        rule,
        calendar,
      });
      const existingDeadline = this.findDeadlineByEventAndRule(
        input.firmId,
        eventId,
        String(ruleRow.id),
      );
      if (existingDeadline) {
        const existingTask = this.findGeneratedTask(
          input.firmId,
          existingDeadline.id,
        );
        if (!existingTask) {
          throw new Error('Persisted workflow deadline has no reminder task');
        }
        return {
          event: {
            id: eventId,
            type: input.triggerEventType,
            occurredOn: input.triggerDate,
          },
          deadline: existingDeadline,
          task: existingTask,
        };
      }

      const deadlineId = randomUUID();
      this.database
        .prepare(
          `INSERT INTO matter_deadlines (
            id, firm_id, matter_id, domain_event_id, deadline_rule_id,
            calendar_id, title, trigger_date, due_date, initial_status,
            explanation, calculation_json, created_by, created_at,
            supersedes_deadline_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, NULL)`,
        )
        .run(
          deadlineId,
          input.firmId,
          input.matterId,
          eventId,
          String(ruleRow.id),
          calendar.id,
          rule.name,
          input.triggerDate,
          calculation.dueDate,
          calculation.explanation,
          JSON.stringify(calculation),
          input.actorUserId,
          createdAt,
        );
      this.database
        .prepare(
          `INSERT INTO deadline_status_events (
            id, firm_id, matter_id, deadline_id, status, reason,
            actor_user_id, occurred_at
          ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          input.firmId,
          input.matterId,
          deadlineId,
          'Created from confirmed workflow trigger',
          input.actorUserId,
          createdAt,
        );

      const matter = row(
        this.database
          .prepare(
            `SELECT owner_user_id AS ownerUserId
             FROM matters
             WHERE firm_id = ? AND id = ?`,
          )
          .get(input.firmId, input.matterId),
      );
      if (!matter) {
        throw new Error('Matter not found in firm');
      }
      const taskId = randomUUID();
      const dueAt = `${calculation.dueDate}T12:00:00.000Z`;
      const taskTitle = `Deadline: ${rule.name}`;
      this.database
        .prepare(
          `INSERT INTO tasks (
            id, firm_id, matter_id, title, notes, due_at, priority, status,
            assignee_user_id, completed_at, external_source, external_id,
            import_batch_id, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'high', 'open', ?, NULL, 'workflow', ?,
                    NULL, ?, ?, ?)`,
        )
        .run(
          taskId,
          input.firmId,
          input.matterId,
          taskTitle,
          `${calculation.explanation}\nSource: ${rule.sourceTitle}`,
          dueAt,
          String(matter.ownerUserId),
          deadlineId,
          input.actorUserId,
          createdAt,
          createdAt,
        );
      this.database
        .prepare(
          `INSERT INTO workflow_generated_tasks (
            firm_id, matter_id, deadline_id, task_id, source_key
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          input.firmId,
          input.matterId,
          deadlineId,
          taskId,
          `deadline:${deadlineId}`,
        );

      appendTimeline(this.database, {
        firmId: input.firmId,
        matterId: input.matterId,
        type: 'deadline.created',
        title: `Deadline calculated: ${rule.name}`,
        detail: calculation.explanation,
        actorUserId: input.actorUserId,
        occurredAt: createdAt,
        metadata: {
          deadlineId,
          ruleKey: rule.key,
          sourceTitle: rule.sourceTitle,
          sourceUrl: rule.sourceUrl,
        },
      });
      appendAudit(this.database, {
        firmId: input.firmId,
        matterId: input.matterId,
        userId: input.actorUserId,
        action: 'deadline.created',
        entityType: 'matter_deadline',
        entityId: deadlineId,
        after: {
          triggerEventType: input.triggerEventType,
          triggerDate: input.triggerDate,
          dueDate: calculation.dueDate,
          ruleKey: rule.key,
          explanation: calculation.explanation,
        },
        createdAt,
        requestId: input.auditContext.requestId,
        ipAddress: input.auditContext.ipAddress,
      });
      this.database
        .prepare(
          `INSERT INTO integration_outbox (
            id, firm_id, matter_id, topic, payload_json, status, attempts,
            available_at, created_at, deduplication_key
          ) VALUES (?, ?, ?, 'deadline.created', ?, 'pending', 0, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          input.firmId,
          input.matterId,
          JSON.stringify({
            deadlineId,
            matterId: input.matterId,
            dueDate: calculation.dueDate,
            ruleKey: rule.key,
          }),
          createdAt,
          createdAt,
          `deadline.created:${deadlineId}`,
        );

      const deadline = this.findDeadlineByEventAndRule(
        input.firmId,
        eventId,
        String(ruleRow.id),
      );
      if (!deadline) {
        throw new Error('Deadline could not be persisted');
      }

      return {
        event: {
          id: eventId,
          type: input.triggerEventType,
          occurredOn: input.triggerDate,
        },
        deadline,
        task: { id: taskId, title: taskTitle, dueAt },
      };
  }

  varyDeadline(input: {
    firmId: string;
    matterId: string;
    actorUserId: string;
    deadlineId: string;
    agreedOn: string;
    dueOn: string;
    reason: string;
    idempotencyKey: string;
    auditContext: AuditContext;
  }): TriggerDeadlineResult {
    const createdAt = this.now().toISOString();
    const payload = JSON.stringify({
      deadlineId: input.deadlineId,
      agreedOn: input.agreedOn,
      dueOn: input.dueOn,
      reason: input.reason,
    });
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.requireMatterAndActor(input.firmId, input.matterId, input.actorUserId);
      const existingEvent = row(this.database.prepare(
        `SELECT id, payload_json AS payload FROM domain_events
         WHERE firm_id = ? AND matter_id = ? AND idempotency_key = ?`,
      ).get(input.firmId, input.matterId, input.idempotencyKey));
      if (existingEvent) {
        if (String(existingEvent.payload) !== payload) {
          throw new Error('Idempotency key has already been used for different variation data');
        }
        const replayRow = row(this.database.prepare(
          `${this.deadlineSelect()} WHERE md.firm_id = ? AND md.matter_id = ?
            AND md.domain_event_id = ? AND md.supersedes_deadline_id = ?`,
        ).get(input.firmId, input.matterId, String(existingEvent.id), input.deadlineId));
        if (!replayRow) throw new Error('Persisted deadline variation was not found');
        const deadline = mapDeadline(replayRow);
        const task = this.findGeneratedTask(input.firmId, deadline.id);
        if (!task) throw new Error('Persisted deadline variation has no reminder task');
        this.database.exec('COMMIT');
        return {
          event: { id: String(existingEvent.id), type: 'deadline.varied', occurredOn: input.agreedOn },
          deadline,
          task,
        };
      }

      const original = row(this.database.prepare(
        `SELECT md.id, md.title, md.due_date AS dueDate,
          md.deadline_rule_id AS deadlineRuleId, md.calendar_id AS calendarId,
          md.calculation_json AS originalCalculationJson,
          COALESCE((
            SELECT dse.status FROM deadline_status_events dse
            WHERE dse.firm_id = md.firm_id AND dse.deadline_id = md.id
            ORDER BY dse.occurred_at DESC, dse.rowid DESC LIMIT 1
          ), md.initial_status) AS status
         FROM matter_deadlines md
         WHERE md.id = ? AND md.firm_id = ? AND md.matter_id = ?`,
      ).get(input.deadlineId, input.firmId, input.matterId));
      if (!original) throw new Error('Deadline not found in matter');
      if (String(original.status) !== 'pending') throw new Error('Only a pending deadline can be varied');
      if (input.dueOn <= input.agreedOn) throw new Error('The varied due date must be after the agreement date');

      const eventId = randomUUID();
      const deadlineId = randomUUID();
      this.database.prepare(
        `INSERT INTO domain_events (
          id, firm_id, matter_id, type, occurred_on, actor_user_id,
          idempotency_key, payload_json, created_at
        ) VALUES (?, ?, ?, 'deadline.varied', ?, ?, ?, ?, ?)`,
      ).run(eventId, input.firmId, input.matterId, input.agreedOn,
        input.actorUserId, input.idempotencyKey, payload, createdAt);
      this.database.prepare(
        `INSERT INTO deadline_status_events (
          id, firm_id, matter_id, deadline_id, status, reason, actor_user_id, occurred_at
        ) VALUES (?, ?, ?, ?, 'superseded', ?, ?, ?)`,
      ).run(randomUUID(), input.firmId, input.matterId, input.deadlineId,
        input.reason, input.actorUserId, createdAt);
      const priorCalculation = JSON.parse(String(original.originalCalculationJson)) as DeadlineCalculation;
      const explanation = `Deadline varied by agreement on ${input.agreedOn} to ${input.dueOn}. ${input.reason}`;
      const calculation: DeadlineCalculation = {
        ...priorCalculation,
        triggerEventId: eventId,
        triggerDate: input.agreedOn,
        dueDate: input.dueOn,
        explanation,
      };
      this.database.prepare(
        `INSERT INTO matter_deadlines (
          id, firm_id, matter_id, domain_event_id, deadline_rule_id,
          calendar_id, title, trigger_date, due_date, initial_status,
          explanation, calculation_json, created_by, created_at,
          supersedes_deadline_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      ).run(deadlineId, input.firmId, input.matterId, eventId,
        String(original.deadlineRuleId), String(original.calendarId),
        String(original.title), input.agreedOn, input.dueOn, explanation,
        JSON.stringify(calculation), input.actorUserId, createdAt, input.deadlineId);
      this.database.prepare(
        `INSERT INTO deadline_status_events (
          id, firm_id, matter_id, deadline_id, status, reason, actor_user_id, occurred_at
        ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
      ).run(randomUUID(), input.firmId, input.matterId, deadlineId,
        `Agreed variation of ${input.deadlineId}`, input.actorUserId, createdAt);

      const oldTask = this.findGeneratedTask(input.firmId, input.deadlineId);
      if (!oldTask) throw new Error('The original deadline has no reminder task');
      this.database.prepare(
        `UPDATE tasks SET status = 'cancelled', updated_at = ?
         WHERE id = ? AND firm_id = ? AND matter_id = ?
           AND status NOT IN ('completed', 'cancelled')`,
      ).run(createdAt, oldTask.id, input.firmId, input.matterId);
      const matter = row(this.database.prepare(
        'SELECT owner_user_id AS ownerUserId FROM matters WHERE firm_id = ? AND id = ?',
      ).get(input.firmId, input.matterId));
      if (!matter) throw new Error('Matter not found in firm');
      const taskId = randomUUID();
      const taskTitle = `Deadline: ${String(original.title)} (varied)`;
      const dueAt = `${input.dueOn}T12:00:00.000Z`;
      this.database.prepare(
        `INSERT INTO tasks (
          id, firm_id, matter_id, title, notes, due_at, priority, status,
          assignee_user_id, completed_at, external_source, external_id,
          import_batch_id, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'high', 'open', ?, NULL,
          'workflow', ?, NULL, ?, ?, ?)`,
      ).run(taskId, input.firmId, input.matterId, taskTitle, explanation, dueAt,
        String(matter.ownerUserId), deadlineId, input.actorUserId, createdAt, createdAt);
      this.database.prepare(
        `INSERT INTO workflow_generated_tasks (
          firm_id, matter_id, deadline_id, task_id, source_key
        ) VALUES (?, ?, ?, ?, ?)`,
      ).run(input.firmId, input.matterId, deadlineId, taskId, `deadline:${deadlineId}`);
      appendTimeline(this.database, {
        firmId: input.firmId, matterId: input.matterId, type: 'deadline.varied',
        title: `Deadline varied: ${String(original.title)}`, detail: explanation,
        actorUserId: input.actorUserId, occurredAt: createdAt,
        metadata: { originalDeadlineId: input.deadlineId, deadlineId, agreedOn: input.agreedOn, dueOn: input.dueOn },
      });
      appendAudit(this.database, {
        firmId: input.firmId, matterId: input.matterId, userId: input.actorUserId,
        action: 'deadline.varied', entityType: 'matter_deadline', entityId: deadlineId,
        before: { deadlineId: input.deadlineId, dueOn: original.dueDate },
        after: { agreedOn: input.agreedOn, dueOn: input.dueOn, reason: input.reason },
        createdAt, requestId: input.auditContext.requestId, ipAddress: input.auditContext.ipAddress,
      });
      this.database.prepare(
        `INSERT INTO integration_outbox (
          id, firm_id, matter_id, topic, payload_json, status, attempts,
          available_at, created_at, deduplication_key
        ) VALUES (?, ?, ?, 'deadline.varied', ?, 'pending', 0, ?, ?, ?)`,
      ).run(randomUUID(), input.firmId, input.matterId,
        JSON.stringify({ deadlineId, originalDeadlineId: input.deadlineId, dueDate: input.dueOn }),
        createdAt, createdAt, `deadline.varied:${deadlineId}`);
      const deadlineRow = row(this.database.prepare(
        `${this.deadlineSelect()} WHERE md.id = ? AND md.firm_id = ?`,
      ).get(deadlineId, input.firmId));
      if (!deadlineRow) throw new Error('Varied deadline could not be persisted');
      this.database.exec('COMMIT');
      return {
        event: { id: eventId, type: 'deadline.varied', occurredOn: input.agreedOn },
        deadline: mapDeadline(deadlineRow),
        task: { id: taskId, title: taskTitle, dueAt },
      };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  listMatterDeadlines(
    firmId: string,
    matterId: string,
  ): MatterDeadlineRecord[] {
    return rows(
      this.database
        .prepare(
          `${this.deadlineSelect()}
           WHERE md.firm_id = ? AND md.matter_id = ?
           ORDER BY md.due_date, md.created_at`,
        )
        .all(firmId, matterId),
    ).map(mapDeadline);
  }

  listWorkflowStages(
    firmId: string,
    matterId: string,
  ): WorkflowStageRecord[] {
    return rows(
      this.database
        .prepare(
          `SELECT ws.key, ws.name, ws.position, ws.description,
                  ws.required_checklist_json AS requiredChecklistJson,
                  ws.allowed_next_stage_keys_json AS allowedNextStageKeysJson
           FROM matter_workflows mw
           JOIN workflow_stages ws
             ON ws.workflow_version_id = mw.workflow_version_id
           WHERE mw.firm_id = ? AND mw.matter_id = ?
           ORDER BY ws.position`,
        )
        .all(firmId, matterId),
    ).map((stage) => ({
      key: String(stage.key),
      name: String(stage.name),
      position: Number(stage.position),
      description: String(stage.description),
      requiredChecklistKeys: JSON.parse(
        String(stage.requiredChecklistJson),
      ) as string[],
      allowedNextStageKeys: JSON.parse(
        String(stage.allowedNextStageKeysJson),
      ) as string[],
    }));
  }

  listCompletedChecklistKeys(firmId: string, matterId: string): string[] {
    return rows(
      this.database
        .prepare(
          `SELECT checklist_key AS checklistKey
           FROM matter_workflow_checklist
           WHERE firm_id = ? AND matter_id = ?
           ORDER BY completed_at, checklist_key`,
        )
        .all(firmId, matterId),
    ).map((item) => String(item.checklistKey));
  }

  transitionMatterWorkflow(input: {
    firmId: string;
    matterId: string;
    actorUserId: string;
    toStageKey: string;
    expectedVersion: number;
    completedChecklistKeys: readonly string[];
    reason: string;
    blockers: readonly WorkflowBlocker[];
    overrideReason?: string;
    auditContext: AuditContext;
  }): MatterWorkflowRecord {
    const occurredAt = this.now().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const current = row(
        this.database
          .prepare(
            `SELECT mw.id, mw.current_stage_key AS currentStageKey,
                    mw.version, mw.workflow_version_id AS workflowVersionId,
                    target.name AS targetStageName
             FROM matter_workflows mw
             JOIN workflow_stages target
               ON target.workflow_version_id = mw.workflow_version_id
              AND target.key = ?
             JOIN users actor
               ON actor.id = ? AND actor.firm_id = mw.firm_id AND actor.active = 1
             WHERE mw.firm_id = ? AND mw.matter_id = ?`,
          )
          .get(
            input.toStageKey,
            input.actorUserId,
            input.firmId,
            input.matterId,
          ),
      );
      if (!current) {
        throw new Error('Workflow, target stage or actor not found in firm');
      }
      if (Number(current.version) !== input.expectedVersion) {
        throw new WorkflowStateConflictError();
      }
      if (String(current.currentStageKey) === input.toStageKey) {
        throw new Error('Workflow is already at the requested stage');
      }

      const allChecklistKeys = new Set(
        rows(
          this.database
            .prepare(
              `SELECT required_checklist_json AS requiredChecklistJson
               FROM workflow_stages
               WHERE workflow_version_id = ?`,
            )
            .all(String(current.workflowVersionId)),
        ).flatMap(
          (stage) =>
            JSON.parse(String(stage.requiredChecklistJson)) as string[],
        ),
      );
      const checklistKeys = [...new Set(input.completedChecklistKeys)];
      const invalidKey = checklistKeys.find((key) => !allChecklistKeys.has(key));
      if (invalidKey) {
        throw new Error(`Unknown workflow checklist key: ${invalidKey}`);
      }

      const insertChecklist = this.database.prepare(
        `INSERT OR IGNORE INTO matter_workflow_checklist (
          id, firm_id, matter_id, matter_workflow_id, checklist_key,
          completed_by, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const checklistKey of checklistKeys) {
        insertChecklist.run(
          randomUUID(),
          input.firmId,
          input.matterId,
          String(current.id),
          checklistKey,
          input.actorUserId,
          occurredAt,
        );
      }

      const updated = this.database
        .prepare(
          `UPDATE matter_workflows
           SET current_stage_key = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND firm_id = ? AND matter_id = ? AND version = ?`,
        )
        .run(
          input.toStageKey,
          occurredAt,
          String(current.id),
          input.firmId,
          input.matterId,
          input.expectedVersion,
        );
      if (updated.changes !== 1) {
        throw new WorkflowStateConflictError();
      }

      this.database
        .prepare(
          `UPDATE matters
           SET stage = ?, updated_at = ?
           WHERE id = ? AND firm_id = ?`,
        )
        .run(
          String(current.targetStageName),
          occurredAt,
          input.matterId,
          input.firmId,
        );

      const historyId = randomUUID();
      this.database
        .prepare(
          `INSERT INTO matter_stage_history (
            id, firm_id, matter_id, matter_workflow_id, from_stage_key,
            to_stage_key, reason, actor_user_id, occurred_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          historyId,
          input.firmId,
          input.matterId,
          String(current.id),
          String(current.currentStageKey),
          input.toStageKey,
          input.reason,
          input.actorUserId,
          occurredAt,
        );

      const transitionPayload = {
        fromStageKey: String(current.currentStageKey),
        toStageKey: input.toStageKey,
        reason: input.reason,
        blockers: input.blockers,
        overrideReason: input.overrideReason ?? null,
        completedChecklistKeys: checklistKeys,
        previousVersion: input.expectedVersion,
        version: input.expectedVersion + 1,
      };
      const domainEventId = randomUUID();
      this.database
        .prepare(
          `INSERT INTO domain_events (
            id, firm_id, matter_id, type, occurred_on, actor_user_id,
            idempotency_key, payload_json, created_at
          ) VALUES (?, ?, ?, 'workflow.stage_changed', ?, ?, ?, ?, ?)`,
        )
        .run(
          domainEventId,
          input.firmId,
          input.matterId,
          occurredAt.slice(0, 10),
          input.actorUserId,
          `workflow-transition:${historyId}`,
          JSON.stringify(transitionPayload),
          occurredAt,
        );

      appendTimeline(this.database, {
        firmId: input.firmId,
        matterId: input.matterId,
        type: 'stage.changed',
        title: `Moved to ${String(current.targetStageName)}`,
        detail: input.reason,
        actorUserId: input.actorUserId,
        occurredAt,
        metadata: transitionPayload,
      });
      appendAudit(this.database, {
        firmId: input.firmId,
        matterId: input.matterId,
        userId: input.actorUserId,
        action: 'workflow.stage_changed',
        entityType: 'matter_workflow',
        entityId: String(current.id),
        before: {
          currentStageKey: String(current.currentStageKey),
          version: input.expectedVersion,
        },
        after: transitionPayload,
        createdAt: occurredAt,
        requestId: input.auditContext.requestId,
        ipAddress: input.auditContext.ipAddress,
      });
      this.database
        .prepare(
          `INSERT INTO integration_outbox (
            id, firm_id, matter_id, topic, payload_json, status, attempts,
            available_at, created_at, deduplication_key
          ) VALUES (?, ?, ?, 'workflow.stage_changed', ?, 'pending', 0, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          input.firmId,
          input.matterId,
          JSON.stringify({
            domainEventId,
            matterId: input.matterId,
            ...transitionPayload,
          }),
          occurredAt,
          occurredAt,
          `workflow.stage_changed:${historyId}`,
        );

      const result = this.getMatterWorkflow(input.firmId, input.matterId);
      if (!result) {
        throw new Error('Transitioned workflow could not be read');
      }
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private findDeadlineByEventAndRule(
    firmId: string,
    eventId: string,
    ruleId: string,
  ): MatterDeadlineRecord | undefined {
    const result = row(
      this.database
        .prepare(
          `${this.deadlineSelect()}
           WHERE md.firm_id = ?
             AND md.domain_event_id = ?
             AND md.deadline_rule_id = ?`,
        )
        .get(firmId, eventId, ruleId),
    );
    return result ? mapDeadline(result) : undefined;
  }

  private findGeneratedTask(
    firmId: string,
    deadlineId: string,
  ): { id: string; title: string; dueAt: string } | undefined {
    const result = row(
      this.database
        .prepare(
          `SELECT t.id, t.title, t.due_at AS dueAt
           FROM workflow_generated_tasks wgt
           JOIN tasks t ON t.id = wgt.task_id AND t.firm_id = wgt.firm_id
           WHERE wgt.firm_id = ? AND wgt.deadline_id = ?`,
        )
        .get(firmId, deadlineId),
    );
    return result
      ? {
          id: String(result.id),
          title: String(result.title),
          dueAt: String(result.dueAt),
        }
      : undefined;
  }

  private deadlineSelect(): string {
    return `SELECT
      md.id,
      md.title,
      md.trigger_date AS triggerDate,
      md.due_date AS dueDate,
      COALESCE(
        (SELECT dse.status
         FROM deadline_status_events dse
         WHERE dse.firm_id = md.firm_id AND dse.deadline_id = md.id
         ORDER BY dse.occurred_at DESC, dse.rowid DESC
         LIMIT 1),
        md.initial_status
      ) AS status,
      md.explanation,
      md.calculation_json AS calculationJson,
      dr.source_title AS sourceTitle,
      dr.source_url AS sourceUrl,
      dr.key AS ruleKey,
      md.created_at AS createdAt
    FROM matter_deadlines md
    JOIN deadline_rules dr ON dr.id = md.deadline_rule_id`;
  }
}
