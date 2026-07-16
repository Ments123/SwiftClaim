import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createDatabase,
  seedCommunicationsEvaluation,
  seedDatabase,
  seedNegotiationSettlementEvaluation,
  seedProtocolExpertsEvaluation,
  seedRepairsQuantumEvaluation,
  SEED_IDS,
} from '../database.js';
import type { SessionUser } from '../policy.js';
import { NegotiationStore } from './store.js';

const ava: SessionUser = {
  id: SEED_IDS.ava,
  firmId: SEED_IDS.northstarFirm,
  firmName: 'Northstar Legal',
  email: 'ava@northstar.test',
  name: 'Ava Morgan',
  role: 'solicitor',
};

describe('negotiation settlement evaluation seed', () => {
  let database: DatabaseSync;
  let directory: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'swiftclaim-negotiation-seed-'));
    mkdirSync(join(directory, 'storage'));
    database = createDatabase(':memory:');
    seedDatabase(database);
    await seedProtocolExpertsEvaluation(database, join(directory, 'storage'));
    seedRepairsQuantumEvaluation(database);
    await seedCommunicationsEvaluation(database);
  });

  afterEach(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('is replay-safe and demonstrates exact authority and an unsatisfied assertion', () => {
    seedNegotiationSettlementEvaluation(database);
    seedNegotiationSettlementEvaluation(database);

    const store = new NegotiationStore(
      database,
      () => new Date('2026-08-20T12:00:00.000Z'),
    );
    const protectedWorkspace = store.getProtectedWorkspace(ava, SEED_IDS.northstarMatter);
    expect(protectedWorkspace.currentAuthority).toMatchObject({
      version: 1,
      requiresPartnerApproval: true,
    });
    expect(protectedWorkspace.actions).toHaveLength(1);
    expect(protectedWorkspace.actions[0]?.projection).toMatchObject({
      state: 'authorised',
      instructionCurrent: true,
      approvalCurrent: true,
    });
    expect(protectedWorkspace.actions[0]?.externalActs).toHaveLength(0);
    expect(protectedWorkspace.settlements).toHaveLength(1);
    expect(protectedWorkspace.settlements[0]?.projection.state).toBe('concluded');

    const obligationId = String((database.prepare(
      `SELECT id FROM settlement_obligations WHERE firm_id = ? AND matter_id = ?`,
    ).get(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter) as { id: string }).id);
    expect(store.getObligation(ava, SEED_IDS.northstarMatter, obligationId).projection.state)
      .toBe('performance_asserted');
    expect(database.prepare('SELECT COUNT(*) AS count FROM negotiation_actions').get())
      .toEqual({ count: 1 });
  });
});
