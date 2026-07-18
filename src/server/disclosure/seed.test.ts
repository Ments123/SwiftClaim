import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createDatabase, seedCommunicationsEvaluation, seedDatabase, seedDisclosureEvaluation,
  seedNegotiationSettlementEvaluation, seedPleadingsEvaluation, seedProceedingsEvaluation,
  seedProtocolExpertsEvaluation, seedRepairsQuantumEvaluation, SEED_IDS,
} from '../database.js';
import { DisclosureStore } from './store.js';

describe('disclosure evaluation seed', () => {
  let database: DatabaseSync; let directory: string;
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'swiftclaim-disclosure-seed-')); mkdirSync(join(directory, 'storage'));
    database = createDatabase(':memory:'); seedDatabase(database);
    await seedProtocolExpertsEvaluation(database, join(directory, 'storage'));
    seedRepairsQuantumEvaluation(database); await seedCommunicationsEvaluation(database);
    seedNegotiationSettlementEvaluation(database); seedProceedingsEvaluation(database); seedPleadingsEvaluation(database);
  });
  afterEach(() => { database.close(); rmSync(directory, { recursive: true, force: true }); });

  it('seeds a mixed governed disclosure journey idempotently', () => {
    seedDisclosureEvaluation(database); seedDisclosureEvaluation(database);
    const proceeding = database.prepare(`SELECT id FROM court_proceedings WHERE firm_id = ? AND matter_id = ? ORDER BY created_at LIMIT 1`)
      .get(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter) as { id: string };
    const workspace = new DisclosureStore(database).getWorkspace(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter, proceeding.id);
    const review = workspace?.reviews[0];
    expect(review?.candidates.some((item) => item.projection.restricted)).toBe(true);
    expect(review?.candidates.some((item) => item.projection.canList)).toBe(true);
    expect(review?.candidates.some((item) => item.projection.state === 'human_review_required')).toBe(true);
    expect(review?.lists).toHaveLength(1);
    expect(review?.inspectionRequests[0]?.projection).toMatchObject({ provided: true, completed: false });
    expect(database.prepare('SELECT COUNT(*) AS count FROM disclosure_reviews').get()).toEqual({ count: 1 });
  });
});
