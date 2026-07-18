import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createDatabase, seedCommunicationsEvaluation, seedDatabase,
  seedNegotiationSettlementEvaluation, seedPleadingsEvaluation,
  seedProceedingsEvaluation, seedProtocolExpertsEvaluation,
  seedRepairsQuantumEvaluation, SEED_IDS,
} from '../database.js';
import { PleadingsStore } from './store.js';

describe('pleading evaluation seed', () => {
  let database: DatabaseSync;
  let directory: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'swiftclaim-pleadings-seed-'));
    mkdirSync(join(directory, 'storage'));
    database = createDatabase(':memory:');
    seedDatabase(database);
    await seedProtocolExpertsEvaluation(database, join(directory, 'storage'));
    seedRepairsQuantumEvaluation(database);
    await seedCommunicationsEvaluation(database);
    seedNegotiationSettlementEvaluation(database);
    seedProceedingsEvaluation(database);
  });
  afterEach(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('seeds a qualified response journey idempotently without eligibility copy', () => {
    seedPleadingsEvaluation(database);
    seedPleadingsEvaluation(database);
    const proceeding = database.prepare(`SELECT id FROM court_proceedings
      WHERE firm_id = ? AND matter_id = ? LIMIT 1`)
      .get(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter) as { id: string };
    const workspace = new PleadingsStore(database).getWorkspace(
      SEED_IDS.northstarFirm, SEED_IDS.northstarMatter, proceeding.id,
    );
    expect(workspace?.tracks[0]).toMatchObject({
      regime: 'part_7_domestic',
      statements: [expect.objectContaining({
        statementType: 'defence',
        amendmentAuthorities: [expect.objectContaining({ route: 'written_consent' })],
      })],
      deadlines: [expect.objectContaining({ kind: 'defence', outcome: 'projected' })],
      defaultReviews: [expect.objectContaining({ outcome: 'blockers_recorded', events: expect.any(Array) })],
    });
    expect(JSON.stringify(workspace)).not.toMatch(/eligible|entitled|safe to enter/i);
    expect(database.prepare('SELECT COUNT(*) AS count FROM claim_response_tracks').get())
      .toEqual({ count: 1 });
  });
});
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
