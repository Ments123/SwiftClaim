import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createDatabase,
  seedCommunicationsEvaluation,
  seedDatabase,
  SEED_IDS,
} from '../database.js';
import type { SessionUser } from '../policy.js';
import { EvaluationCommunicationProvider } from './evaluation-provider.js';
import { CommunicationProviderRegistry } from './provider.js';
import { CommunicationService } from './service.js';
import { CommunicationStore } from './store.js';

describe('communications evaluation seed', () => {
  let database: DatabaseSync | undefined;

  afterEach(() => database?.close());

  it('creates one idempotent Maya journey without external transmission', async () => {
    database = createDatabase(':memory:');
    seedDatabase(database);

    await seedCommunicationsEvaluation(database);
    await seedCommunicationsEvaluation(database);

    const now = () => new Date('2026-08-20T09:00:00.000Z');
    const ava: SessionUser = {
      id: SEED_IDS.ava,
      firmId: SEED_IDS.northstarFirm,
      firmName: 'Northstar Legal',
      email: 'ava@northstar.test',
      name: 'Ava Morgan',
      role: 'solicitor',
    };
    const service = new CommunicationService(
      new CommunicationStore(database, now),
      new CommunicationProviderRegistry([
        new EvaluationCommunicationProvider(now, 'swiftclaim-evaluation-only'),
      ]),
    );
    const workspace = await service.getWorkspace(ava, SEED_IDS.northstarMatter);

    expect(workspace.entries.map(({ channel }) => channel)).toEqual(
      expect.arrayContaining(['email', 'whatsapp', 'telephone', 'letter', 'internal']),
    );
    expect(workspace.entries.find(({ channel }) => channel === 'whatsapp')?.transport).toMatchObject({
      state: 'provider_accepted',
      deliveredAt: null,
    });
    expect(workspace.entries.find(({ channel }) => channel === 'telephone')?.call).toMatchObject({
      identityCheckStatus: 'confirmed',
      recordingStatus: 'not_recorded',
    });
    expect(workspace.entries.find(({ channel }) => channel === 'letter')?.serviceAssertion).toMatchObject({
      assertedMethod: 'first_class_post',
      reviewStatus: 'unreviewed',
      recipient: 'Meridian Housing Association',
    });
    expect(workspace.drafts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        confidentiality: 'protected_negotiation',
        status: 'pending_approval',
        currentApproval: null,
      }),
    ]));
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM communication_dispatches').get(),
    ).toEqual({ count: 1 });
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM communication_service_assertions').get(),
    ).toEqual({ count: 1 });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM communication_provider_events WHERE safe_payload_json LIKE '%networkCall%false%'").get(),
    ).toEqual({ count: 1 });
  });
});
