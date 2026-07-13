import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { runMigrations } from './migrations/index.js';
import type { Migration } from './migrations/types.js';

function memoryDatabase() {
  return new DatabaseSync(':memory:');
}

describe('runMigrations', () => {
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
