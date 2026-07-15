import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { migrations, runMigrations } from './migrations/index.js';
import type { Migration } from './migrations/types.js';

function memoryDatabase() {
  return new DatabaseSync(':memory:');
}

describe('runMigrations', () => {
  it('exposes the canonical migrations in version order', () => {
    expect(
      migrations.map(({ version, name }) => ({ version, name })),
    ).toEqual([
      { version: 1, name: 'secure matter spine' },
      { version: 2, name: 'workflow foundation' },
      { version: 3, name: 'intake and onboarding' },
      { version: 4, name: 'defects notice and evidence' },
      { version: 5, name: 'protocol and experts' },
      { version: 6, name: 'repairs quantum and offers' },
    ]);
    expect(migrations.every(({ checksum }) => checksum.length === 64)).toBe(
      true,
    );
  });

  it('creates repairs quantum and offer tables with immutable legal records', () => {
    const database = memoryDatabase();
    runMigrations(database, migrations, '2026-07-15T09:00:00.000Z');

    const tableNames = new Set(
      (database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>).map(({ name }) => name),
    );
    expect([...tableNames]).toEqual(
      expect.arrayContaining([
        'work_schedules',
        'work_items',
        'work_item_defects',
        'work_item_evidence_links',
        'repair_events',
        'loss_schedules',
        'loss_items',
        'loss_item_evidence_links',
        'general_damages_reviews',
        'offers',
        'part_36_terms',
        'offer_events',
        'quantum_command_receipts',
      ]),
    );

    const triggerNames = new Set(
      (database
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'trigger'
             AND (name LIKE 'work_%' OR name LIKE 'repair_%'
               OR name LIKE 'loss_%' OR name LIKE 'general_damages_%'
               OR name LIKE 'offer_%' OR name LIKE 'part_36_%')`,
        )
        .all() as Array<{ name: string }>).map(({ name }) => name),
    );
    expect([...triggerNames]).toEqual(
      expect.arrayContaining([
        'work_schedules_approved_no_update',
        'work_items_approved_no_update',
        'repair_events_no_update',
        'loss_schedules_approved_no_update',
        'loss_items_approved_no_update',
        'work_item_evidence_links_no_delete',
        'repair_event_evidence_links_no_delete',
        'loss_item_evidence_links_no_delete',
        'general_damages_reviews_no_update',
        'offer_events_no_update',
      ]),
    );
  });

  it('creates the governed protocol and expert tables with immutable guards', () => {
    const database = memoryDatabase();
    runMigrations(database, migrations, '2026-07-14T14:00:00.000Z');

    const tableNames = new Set(
      (database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>).map(({ name }) => name),
    );
    expect([...tableNames]).toEqual(expect.arrayContaining([
      'protocol_cases',
      'letters_of_claim',
      'letter_of_claim_versions',
      'protocol_service_events',
      'landlord_responses',
      'landlord_response_defects',
      'expert_engagements',
      'expert_conflict_checks',
      'expert_instruction_versions',
      'expert_milestone_events',
      'expert_report_records',
      'expert_questions',
      'expert_question_answers',
    ]));

    const triggerNames = (database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'trigger'
           AND (name LIKE 'protocol_%' OR name LIKE 'expert_%'
             OR name LIKE 'letter_%' OR name LIKE 'landlord_%')`,
      )
      .all() as Array<{ name: string }>).map(({ name }) => name);
    expect(triggerNames).toEqual(expect.arrayContaining([
      'letter_of_claim_versions_no_update',
      'protocol_service_events_no_delete',
      'landlord_responses_no_update',
      'expert_report_records_no_delete',
      'expert_question_answers_no_update',
    ]));
  });

  it('applies migrations once in version order and records checksums', () => {
    const database = memoryDatabase();
    const migrations: Migration[] = [
      {
        version: 1,
        name: 'one',
        checksum: 'one-hash',
        sql: 'CREATE TABLE one (id TEXT);',
      },
      {
        version: 2,
        name: 'two',
        checksum: 'two-hash',
        sql: 'CREATE TABLE two (id TEXT);',
      },
    ];

    runMigrations(database, migrations, '2026-07-13T12:00:00.000Z');
    runMigrations(database, migrations, '2026-07-13T13:00:00.000Z');

    expect(
      database
        .prepare(
          'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
        )
        .all(),
    ).toEqual([
      { version: 1, name: 'one', checksum: 'one-hash' },
      { version: 2, name: 'two', checksum: 'two-hash' },
    ]);
  });

  it('rolls back a failed migration without recording it', () => {
    const database = memoryDatabase();

    expect(() =>
      runMigrations(
        database,
        [
          {
            version: 1,
            name: 'broken',
            checksum: 'broken-hash',
            sql: 'CREATE TABLE ok (id TEXT); INVALID SQL;',
          },
        ],
        '2026-07-13T12:00:00.000Z',
      ),
    ).toThrow();

    const table = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ok'",
      )
      .get();
    expect(table).toBeUndefined();
  });

  it('rejects a checksum mismatch for an applied migration', () => {
    const database = memoryDatabase();
    runMigrations(
      database,
      [
        {
          version: 1,
          name: 'one',
          checksum: 'original',
          sql: 'CREATE TABLE one (id TEXT);',
        },
      ],
      '2026-07-13T12:00:00.000Z',
    );

    expect(() =>
      runMigrations(
        database,
        [
          {
            version: 1,
            name: 'one',
            checksum: 'changed',
            sql: 'CREATE TABLE one (id TEXT);',
          },
        ],
        '2026-07-13T13:00:00.000Z',
      ),
    ).toThrow('Migration 1 checksum mismatch');
  });

  it('upgrades metadata columns from the legacy Step 1 migration table', () => {
    const database = memoryDatabase();
    database.exec(`CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;`);
    database
      .prepare(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)',
      )
      .run('2026-07-13T11:00:00.000Z');

    runMigrations(
      database,
      [
        {
          version: 1,
          name: 'secure matter spine',
          checksum: 'baseline-hash',
          sql: 'CREATE TABLE firms (id TEXT PRIMARY KEY);',
        },
      ],
      '2026-07-13T12:00:00.000Z',
    );

    expect(
      database
        .prepare(
          'SELECT version, name, checksum FROM schema_migrations WHERE version = 1',
        )
        .get(),
    ).toEqual({
      version: 1,
      name: 'secure matter spine',
      checksum: 'baseline-hash',
    });
  });
});
