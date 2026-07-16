import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import { DatabaseNegotiationReadiness } from './readiness.js';
import { NegotiationStore } from './store.js';

const now = () => new Date('2026-08-20T12:00:00.000Z');
const ava: SessionUser = {
  id: SEED_IDS.ava,
  firmId: SEED_IDS.northstarFirm,
  firmName: 'Northstar Legal',
  email: 'ava@northstar.test',
  name: 'Ava Morgan',
  role: 'solicitor',
};

describe('DatabaseNegotiationReadiness', () => {
  let database: DatabaseSync;
  let readiness: DatabaseNegotiationReadiness;

  beforeEach(() => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    readiness = new DatabaseNegotiationReadiness(database, now);
  });

  afterEach(() => database.close());

  it('supports authority readiness only from a current reviewed authority version', () => {
    expect(readiness.getNegotiationReadiness(
      SEED_IDS.northstarFirm,
      SEED_IDS.northstarMatter,
      'negotiation',
    ).controls).toContainEqual(expect.objectContaining({
      key: 'settlement_authority_recorded',
      eligible: false,
    }));

    new NegotiationStore(database, now).createAuthorityVersion(
      ava,
      SEED_IDS.northstarMatter,
      {
        idempotencyKey: 'readiness-authority-001',
        source: 'client_specific',
        scope: 'Current authority for a synthetic negotiation action.',
        actionTypes: ['counteroffer'],
        minimumAmountMinor: null,
        maximumAmountMinor: null,
        nonMoneyConstraints: '',
        costsConstraints: '',
        repairConstraints: '',
        expiresAt: null,
        reviewOn: '2026-09-01',
        requiresClientInstruction: true,
        requiresPartnerApproval: true,
        sourceDocumentVersionId: null,
        reviewNote: 'A human reviewed this authority for workflow readiness.',
      },
      { requestId: 'readiness-test', ipAddress: '127.0.0.1' },
    );

    expect(readiness.getNegotiationReadiness(
      SEED_IDS.northstarFirm,
      SEED_IDS.northstarMatter,
      'negotiation',
    ).controls).toContainEqual(expect.objectContaining({
      key: 'settlement_authority_recorded',
      eligible: true,
    }));
  });
});
