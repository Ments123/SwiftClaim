import { describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import { DatabaseProceedingsReadiness } from './readiness.js';

describe('DatabaseProceedingsReadiness', () => {
  it('does not accept a checklist assertion without exact current issue authority', () => {
    const database = createDatabase(':memory:');
    seedDatabase(database);
    try {
      const readiness = new DatabaseProceedingsReadiness(
        database, () => new Date('2026-09-01T10:00:00.000Z'),
      ).getProceedingsReadiness(
        SEED_IDS.northstarFirm, SEED_IDS.northstarMatter, 'negotiation',
      );
      expect(readiness.controls).toContainEqual(expect.objectContaining({
        key: 'court_authority_recorded', eligible: false,
      }));
    } finally {
      database.close();
    }
  });

  it('keeps unverified court issue visible as a critical progression risk', () => {
    const database = createDatabase(':memory:');
    seedDatabase(database);
    try {
      const readiness = new DatabaseProceedingsReadiness(
        database, () => new Date('2026-09-01T10:00:00.000Z'),
      ).getProceedingsReadiness(
        SEED_IDS.northstarFirm, SEED_IDS.northstarMatter, 'proceedings',
      );
      expect(readiness.progressionBlockers).toContainEqual(expect.objectContaining({
        key: 'court_issue_not_verified', severity: 'critical',
      }));
    } finally {
      database.close();
    }
  });
});
