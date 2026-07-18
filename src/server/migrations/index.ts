import type { DatabaseSync } from 'node:sqlite';

import { secureMatterSpineMigration } from './001-secure-matter-spine.js';
import { workflowFoundationMigration } from './002-workflow-foundation.js';
import { intakeOnboardingMigration } from './003-intake-onboarding.js';
import { defectsNoticeEvidenceMigration } from './004-defects-notice-evidence.js';
import { protocolExpertsMigration } from './005-protocol-experts.js';
import { repairsQuantumMigration } from './006-repairs-quantum.js';
import { communicationsMigration } from './007-communications.js';
import { negotiationSettlementMigration } from './008-negotiation-settlement.js';
import { governedProceedingsMigration } from './009-governed-proceedings.js';
import { governedPleadingsResponseMigration } from './010-governed-pleadings-response.js';
import { governedDisclosureEvidenceMigration } from './011-governed-disclosure-evidence.js';
import type { Migration } from './types.js';

export const migrations: Migration[] = [
  secureMatterSpineMigration,
  workflowFoundationMigration,
  intakeOnboardingMigration,
  defectsNoticeEvidenceMigration,
  protocolExpertsMigration,
  repairsQuantumMigration,
  communicationsMigration,
  negotiationSettlementMigration,
  governedProceedingsMigration,
  governedPleadingsResponseMigration,
  governedDisclosureEvidenceMigration,
];

export function runMigrations(
  database: DatabaseSync,
  orderedMigrations: Migration[],
  appliedAt = new Date().toISOString(),
): void {
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT,
    checksum TEXT,
    applied_at TEXT NOT NULL
  ) STRICT;`);

  const columns = new Set(
    (
      database
        .prepare('PRAGMA table_info(schema_migrations)')
        .all() as Array<{ name: string }>
    ).map((column) => column.name),
  );
  if (!columns.has('name')) {
    database.exec('ALTER TABLE schema_migrations ADD COLUMN name TEXT;');
  }
  if (!columns.has('checksum')) {
    database.exec('ALTER TABLE schema_migrations ADD COLUMN checksum TEXT;');
  }

  const sorted = [...orderedMigrations].sort(
    (left, right) => left.version - right.version,
  );
  const versions = new Set<number>();

  for (const migration of sorted) {
    if (versions.has(migration.version)) {
      throw new Error(`Duplicate migration ${migration.version}`);
    }
    versions.add(migration.version);

    const applied = database
      .prepare(
        'SELECT name, checksum FROM schema_migrations WHERE version = ?',
      )
      .get(migration.version) as
      | { name: string | null; checksum: string | null }
      | undefined;

    if (applied) {
      if (applied.checksum && applied.checksum !== migration.checksum) {
        throw new Error(`Migration ${migration.version} checksum mismatch`);
      }
      if (!applied.checksum) {
        database
          .prepare(
            'UPDATE schema_migrations SET name = ?, checksum = ? WHERE version = ?',
          )
          .run(migration.name, migration.checksum, migration.version);
      }
      continue;
    }

    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(migration.sql);
      database
        .prepare(
          `INSERT INTO schema_migrations (
            version, name, checksum, applied_at
          ) VALUES (?, ?, ?, ?)`,
        )
        .run(
          migration.version,
          migration.name,
          migration.checksum,
          appliedAt,
        );
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}
