import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from './database.js';
import type { SessionUser } from './policy.js';
import { MatterStore } from './store.js';
import { calculateDeadline } from './workflow/calendar.js';
import {
  ENGLAND_WALES_2026_CALENDAR,
  HOUSING_DISREPAIR_WORKFLOW,
} from './workflow/definitions.js';
import { WorkflowService } from './workflow/service.js';
import { WorkflowStore } from './workflow/store.js';

const FIXED_NOW = new Date('2026-07-15T09:00:00.000Z');

const ava: SessionUser = {
  id: SEED_IDS.ava,
  firmId: SEED_IDS.northstarFirm,
  firmName: 'Northstar Legal',
  email: 'ava@northstar.test',
  name: 'Ava Morgan',
  role: 'solicitor',
};

describe('canonical database', () => {
  let database: DatabaseSync | undefined;

  afterEach(() => database?.close());

  it('creates the tenant-owned tables and enforces foreign keys', () => {
    database = createDatabase(':memory:');
    const tableNames = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String(row.name));

    expect(tableNames).toEqual(
      expect.arrayContaining([
        'firms',
        'users',
        'sessions',
        'matters',
        'matter_members',
        'parties',
        'tasks',
        'documents',
        'document_versions',
        'timeline_events',
        'audit_events',
        'workflow_templates',
        'workflow_versions',
        'matter_workflows',
        'domain_events',
        'matter_deadlines',
        'deadline_status_events',
        'integration_outbox',
      ]),
    );
    expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({
      foreign_keys: 1,
    });
  });

  it('records the ordered schema as checksummed migrations', () => {
    database = createDatabase(':memory:');

    expect(
      database
        .prepare(
          `SELECT version, name, length(checksum) AS checksumLength
           FROM schema_migrations ORDER BY version`,
        )
        .all(),
    ).toEqual([
      {
        version: 1,
        name: 'secure matter spine',
        checksumLength: 64,
      },
      {
        version: 2,
        name: 'workflow foundation',
        checksumLength: 64,
      },
    ]);
  });

  it('makes audit rows append-only at the database layer', () => {
    database = createDatabase(':memory:');
    seedDatabase(database);

    database
      .prepare(
        `INSERT INTO audit_events (
          id, firm_id, matter_id, user_id, action, entity_type, entity_id,
          before_json, after_json, request_id, ip_address, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      )
      .run(
        'a0000000-0000-4000-8000-000000000001',
        SEED_IDS.northstarFirm,
        SEED_IDS.northstarMatter,
        SEED_IDS.ava,
        'matter.viewed',
        'matter',
        SEED_IDS.northstarMatter,
        '{}',
        'request-test',
        '127.0.0.1',
        '2026-07-13T12:00:00.000Z',
      );

    expect(() =>
      database?.exec(
        "UPDATE audit_events SET action = 'audit.changed' WHERE id = 'a0000000-0000-4000-8000-000000000001'",
      ),
    ).toThrow(/append-only/);
    expect(() =>
      database?.exec(
        "DELETE FROM audit_events WHERE id = 'a0000000-0000-4000-8000-000000000001'",
      ),
    ).toThrow(/append-only/);
  });

  it('seeds two isolated firms idempotently', () => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    seedDatabase(database);

    expect(database.prepare('SELECT COUNT(*) AS count FROM firms').get()).toEqual({
      count: 2,
    });
    expect(database.prepare('SELECT COUNT(*) AS count FROM matters').get()).toEqual({
      count: 3,
    });
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM workflow_versions').get(),
    ).toEqual({ count: 1 });
    expect(
      database
        .prepare('SELECT COUNT(*) AS count FROM business_calendar_holidays')
        .get(),
    ).toEqual({ count: 8 });
    expect(
      database
        .prepare(
          `SELECT
            (SELECT COUNT(*) FROM matter_workflows WHERE matter_id = ?) AS workflows,
            (SELECT COUNT(*) FROM matter_stage_history WHERE matter_id = ?) AS stages,
            (SELECT COUNT(*) FROM domain_events WHERE matter_id = ?) AS events,
            (SELECT COUNT(*) FROM matter_deadlines WHERE matter_id = ?) AS deadlines`,
        )
        .get(
          SEED_IDS.northstarMatter,
          SEED_IDS.northstarMatter,
          SEED_IDS.northstarMatter,
          SEED_IDS.northstarMatter,
        ),
    ).toEqual({ workflows: 1, stages: 5, events: 5, deadlines: 1 });
  });

  it('seeds a protocol-stage synthetic housing conditions matter', () => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    const service = new WorkflowService(
      new MatterStore(database, () => FIXED_NOW),
      new WorkflowStore(database, () => FIXED_NOW),
      () => FIXED_NOW,
    );
    const summary = service.getMatter360(ava, SEED_IDS.northstarMatter);
    const landlordResponseRule = HOUSING_DISREPAIR_WORKFLOW.deadlineRules.find(
      (rule) => rule.key === 'housing.protocol.landlord_response',
    );
    expect(landlordResponseRule).toBeDefined();
    const calculation = calculateDeadline({
      triggerDate: '2026-07-14',
      triggerEventId: 'seed-trigger',
      rule: landlordResponseRule!,
      calendar: ENGLAND_WALES_2026_CALENDAR,
    });

    expect(calculation.dueDate).toBe('2026-08-11');
    expect(summary.matter).toMatchObject({
      reference: 'NCL-2026-0017',
      matterType: 'Housing conditions claim',
      stage: 'Pre-Action Protocol',
      clientName: 'Maya Clarke',
      title: 'Clarke v Meridian Housing',
    });
    expect(summary.workflow.currentStageKey).toBe('protocol');
    expect(summary.deadlines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Landlord response to Letter of Claim',
          dueDate: calculation.dueDate,
        }),
      ]),
    );
    expect(summary.workflow.blockers).toEqual([]);
  });

  it('keeps the evaluation matter invisible across firm boundaries', () => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    const store = new MatterStore(database, () => FIXED_NOW);
    const lewis: SessionUser = {
      id: SEED_IDS.southbankUser,
      firmId: SEED_IDS.southbankFirm,
      firmName: 'Southbank Law',
      email: 'lewis@southbank.test',
      name: 'Lewis Grant',
      role: 'partner',
    };

    expect(store.getMatterAggregate(lewis, SEED_IDS.northstarMatter)).toBeUndefined();
    expect(store.getMatterAggregate(ava, SEED_IDS.southbankMatter)).toBeUndefined();
  });
});
