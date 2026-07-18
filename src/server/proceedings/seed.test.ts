import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createDatabase, seedCommunicationsEvaluation, seedDatabase,
  seedNegotiationSettlementEvaluation, seedProceedingsEvaluation,
  seedProtocolExpertsEvaluation, seedRepairsQuantumEvaluation, SEED_IDS,
} from '../database.js';
import type { SessionUser } from '../policy.js';
import { ProceedingsStore } from './store.js';

describe('proceedings evaluation seed', () => {
  let database: DatabaseSync;
  let directory: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'swiftclaim-proceedings-seed-'));
    mkdirSync(join(directory, 'storage'));
    database = createDatabase(':memory:');
    seedDatabase(database);
    await seedProtocolExpertsEvaluation(database, join(directory, 'storage'));
    seedRepairsQuantumEvaluation(database);
    await seedCommunicationsEvaluation(database);
    seedNegotiationSettlementEvaluation(database);
  });

  afterEach(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('seeds the governed court journey exactly once', () => {
    seedProceedingsEvaluation(database);
    seedProceedingsEvaluation(database);
    expect((database.prepare('SELECT COUNT(*) AS count FROM court_proceedings')
      .get() as { count: number }).count).toBe(1);
    expect((database.prepare(`SELECT COUNT(*) AS count FROM court_proceeding_events
      WHERE event_type = 'issued'`).get() as { count: number }).count).toBe(1);
  });

  it('keeps asserted expert performance separate from satisfaction', () => {
    seedProceedingsEvaluation(database);
    const ava: SessionUser = {
      id: SEED_IDS.ava, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal',
      email: 'ava@northstar.test', name: 'Ava Morgan', role: 'solicitor',
    };
    const workspace = new ProceedingsStore(
      database, () => new Date('2026-10-21T10:00:00.000Z'),
    ).getWorkspace(ava, SEED_IDS.northstarMatter);
    const direction = workspace?.directions.find(({ category }) => category === 'expert_evidence');
    expect(direction?.projection).toMatchObject({ state: 'performance_asserted', overdue: true });
  });
});
