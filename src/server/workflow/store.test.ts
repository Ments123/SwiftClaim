import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import { seedWorkflowDefinitions } from './definitions.js';
import { WorkflowStore } from './store.js';

const FIXED_NOW = new Date('2026-07-13T12:00:00.000Z');
const TEST_MATTER_ID = SEED_IDS.northstarRestrictedMatter;
const TEST_ACTOR_ID = SEED_IDS.partner;

describe('WorkflowStore', () => {
  let database: DatabaseSync;
  let store: WorkflowStore;

  beforeEach(() => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    seedWorkflowDefinitions(database, FIXED_NOW.toISOString());
    store = new WorkflowStore(database, () => FIXED_NOW);
  });

  afterEach(() => {
    database.close();
  });

  it('instantiates the first workflow stage once for a matter', () => {
    const first = store.instantiateMatterWorkflow(
      SEED_IDS.northstarFirm,
      TEST_MATTER_ID,
      TEST_ACTOR_ID,
    );
    const second = store.instantiateMatterWorkflow(
      SEED_IDS.northstarFirm,
      TEST_MATTER_ID,
      TEST_ACTOR_ID,
    );

    expect(second.id).toBe(first.id);
    expect(first.currentStage.key).toBe('enquiry');
    expect(first.workflowVersion).toBe(1);
    expect(
      database
        .prepare(
          'SELECT COUNT(*) AS count FROM matter_workflows WHERE matter_id = ?',
        )
        .get(TEST_MATTER_ID),
    ).toEqual({ count: 1 });
    expect(
      database
        .prepare(
          'SELECT COUNT(*) AS count FROM matter_stage_history WHERE matter_id = ?',
        )
        .get(TEST_MATTER_ID),
    ).toEqual({ count: 1 });
  });

  it('cannot read another firm workflow through a tenant-scoped lookup', () => {
    store.instantiateMatterWorkflow(
      SEED_IDS.southbankFirm,
      SEED_IDS.southbankMatter,
      SEED_IDS.southbankUser,
    );

    expect(
      store.getMatterWorkflow(
        SEED_IDS.northstarFirm,
        SEED_IDS.southbankMatter,
      ),
    ).toBeUndefined();
  });

  it('records one immutable deadline and one reminder per trigger and rule', () => {
    store.instantiateMatterWorkflow(
      SEED_IDS.northstarFirm,
      TEST_MATTER_ID,
      TEST_ACTOR_ID,
    );

    const input = {
      firmId: SEED_IDS.northstarFirm,
      matterId: TEST_MATTER_ID,
      actorUserId: TEST_ACTOR_ID,
      triggerEventType: 'letter_of_claim.received',
      triggerDate: '2026-08-03',
      idempotencyKey: 'loc-received-1',
      auditContext: {
        requestId: 'request-workflow-1',
        ipAddress: '127.0.0.1',
      },
    };

    const first = store.recordTriggerAndDeadline(input);
    const replay = store.recordTriggerAndDeadline(input);

    expect(replay.deadline.id).toBe(first.deadline.id);
    expect(first.deadline.dueDate).toBe('2026-09-01');
    expect(first.deadline.status).toBe('pending');
    expect(first.deadline.calculation.excludedDates).toContain('2026-08-31');
    expect(first.deadline.source.url).toBe(
      'https://www.justice.gov.uk/courts/procedure-rules/civil/protocol/prot_hou',
    );
    expect(first.task.dueAt).toBe('2026-09-01T12:00:00.000Z');

    for (const table of [
      'domain_events',
      'matter_deadlines',
      'deadline_status_events',
      'workflow_generated_tasks',
      'integration_outbox',
    ]) {
      expect(
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM ${table} WHERE firm_id = ? AND matter_id = ?`,
          )
          .get(SEED_IDS.northstarFirm, TEST_MATTER_ID),
      ).toEqual({ count: 1 });
    }

    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM tasks
           WHERE firm_id = ? AND matter_id = ? AND external_source = 'workflow'`,
        )
        .get(SEED_IDS.northstarFirm, TEST_MATTER_ID),
    ).toEqual({ count: 1 });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM timeline_events
           WHERE firm_id = ? AND matter_id = ? AND type = 'deadline.created'`,
        )
        .get(SEED_IDS.northstarFirm, TEST_MATTER_ID),
    ).toEqual({ count: 1 });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM audit_events
           WHERE firm_id = ? AND matter_id = ? AND action = 'deadline.created'`,
        )
        .get(SEED_IDS.northstarFirm, TEST_MATTER_ID),
    ).toEqual({ count: 1 });
  });

  it('rejects a conflicting replay of an idempotency key', () => {
    store.instantiateMatterWorkflow(
      SEED_IDS.northstarFirm,
      TEST_MATTER_ID,
      TEST_ACTOR_ID,
    );
    const base = {
      firmId: SEED_IDS.northstarFirm,
      matterId: TEST_MATTER_ID,
      actorUserId: TEST_ACTOR_ID,
      triggerEventType: 'letter_of_claim.received',
      triggerDate: '2026-08-03',
      idempotencyKey: 'loc-received-1',
      auditContext: {
        requestId: 'request-workflow-1',
        ipAddress: '127.0.0.1',
      },
    };
    store.recordTriggerAndDeadline(base);

    expect(() =>
      store.recordTriggerAndDeadline({
        ...base,
        triggerDate: '2026-08-04',
      }),
    ).toThrow('Idempotency key has already been used for different trigger data');
  });

  it('does not expose deadlines across firms', () => {
    store.instantiateMatterWorkflow(
      SEED_IDS.northstarFirm,
      TEST_MATTER_ID,
      TEST_ACTOR_ID,
    );
    store.recordTriggerAndDeadline({
      firmId: SEED_IDS.northstarFirm,
      matterId: TEST_MATTER_ID,
      actorUserId: TEST_ACTOR_ID,
      triggerEventType: 'letter_of_claim.received',
      triggerDate: '2026-08-03',
      idempotencyKey: 'loc-received-1',
      auditContext: {
        requestId: 'request-workflow-1',
        ipAddress: '127.0.0.1',
      },
    });

    expect(
      store.listMatterDeadlines(
        SEED_IDS.southbankFirm,
        TEST_MATTER_ID,
      ),
    ).toEqual([]);
  });

  it('enforces immutable workflow evidence at the database boundary', () => {
    store.instantiateMatterWorkflow(
      SEED_IDS.northstarFirm,
      TEST_MATTER_ID,
      TEST_ACTOR_ID,
    );
    const result = store.recordTriggerAndDeadline({
      firmId: SEED_IDS.northstarFirm,
      matterId: TEST_MATTER_ID,
      actorUserId: TEST_ACTOR_ID,
      triggerEventType: 'letter_of_claim.received',
      triggerDate: '2026-08-03',
      idempotencyKey: 'loc-received-1',
      auditContext: {
        requestId: 'request-workflow-1',
        ipAddress: '127.0.0.1',
      },
    });

    expect(() =>
      database
        .prepare('UPDATE matter_deadlines SET title = ? WHERE id = ?')
        .run('Changed', result.deadline.id),
    ).toThrow('matter_deadlines is immutable');
    expect(() =>
      database
        .prepare('DELETE FROM domain_events WHERE id = ?')
        .run(result.event.id),
    ).toThrow('domain_events is append-only');
  });
});
