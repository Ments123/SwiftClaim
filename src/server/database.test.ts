import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from './database.js';

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
      ]),
    );
    expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({
      foreign_keys: 1,
    });
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
  });
});
