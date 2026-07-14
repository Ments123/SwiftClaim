import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import { ProtocolService } from './service.js';
import { ProtocolStore } from './store.js';

const solicitor: SessionUser = {
  id: SEED_IDS.ava,
  firmId: SEED_IDS.northstarFirm,
  firmName: 'Northstar Legal',
  email: 'ava@northstar.test',
  name: 'Ava Morgan',
  role: 'solicitor',
};

describe('ProtocolService legal trigger safeguards', () => {
  const databases: ReturnType<typeof createDatabase>[] = [];

  beforeEach(() => undefined);
  afterEach(() => databases.splice(0).forEach((database) => database.close()));

  it('blocks a no-response legal fact until the live response deadline is overdue', () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    seedDatabase(database);
    const now = () => new Date('2026-07-15T09:00:00.000Z');
    const service = new ProtocolService(
      database,
      new ProtocolStore(database, now),
      join(tmpdir(), `swiftclaim-protocol-${crypto.randomUUID()}`),
      now,
    );
    service.getWorkspace(solicitor, SEED_IDS.northstarMatter);

    expect(() => service.recordLandlordResponse(
      solicitor,
      SEED_IDS.northstarMatter,
      {
        idempotencyKey: 'no-response-too-early',
        responseType: 'no_response_recorded',
        receivedOn: null,
        respondingParty: 'Meridian Housing Association',
        contactName: '',
        generalLiabilityPosition: 'no_response',
        liabilityReasons: '',
        noticePosition: '',
        accessPosition: '',
        disclosureStatus: 'none',
        disclosureSummary: '',
        expertProposalPosition: 'not_addressed',
        expertProposalSummary: '',
        worksSchedule: '',
        worksStartOn: null,
        worksCompleteOn: null,
        compensationOfferMinor: null,
        costsOfferMinor: null,
        currency: 'GBP',
        sourceDocumentVersionId: null,
        supersedesResponseId: null,
        correctionReason: '',
        defectPositions: [],
      },
      { requestId: 'request-no-response', ipAddress: '127.0.0.1' },
    )).toThrowError(expect.objectContaining({ code: 'TRIGGER_BLOCKED' }));
  });
});
