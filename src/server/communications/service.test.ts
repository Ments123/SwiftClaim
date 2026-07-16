import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CreateCommunicationDraftInput } from '../../shared/contracts.js';
import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import { EvaluationCommunicationProvider } from './evaluation-provider.js';
import { CommunicationProviderRegistry } from './provider.js';
import { CommunicationError, CommunicationService } from './service.js';
import { CommunicationStore } from './store.js';

const now = () => new Date('2026-07-16T09:00:00.000Z');
const audit = { requestId: 'communication-service-test', ipAddress: '127.0.0.1' };

function user(
  id: string,
  role: SessionUser['role'],
  firmId: string = SEED_IDS.northstarFirm,
): SessionUser {
  return {
    id,
    role,
    firmId,
    firmName: firmId === SEED_IDS.northstarFirm ? 'Northstar Legal' : 'Southbank Law',
    email: `${role}@example.test`,
    name: role,
  };
}

const partner = user(SEED_IDS.partner, 'partner');
const ava = user(SEED_IDS.ava, 'solicitor');
const ben = user(SEED_IDS.ben, 'paralegal');
const finance = user(SEED_IDS.finance, 'finance');
const lewis = user(SEED_IDS.southbankUser, 'partner', SEED_IDS.southbankFirm);

const ordinaryDraft: CreateCommunicationDraftInput = {
  channel: 'email',
  confidentiality: 'ordinary',
  participants: [{
    role: 'to', displayName: 'Harbour Homes Legal', endpointType: 'email',
    endpoint: 'legal@harbourhomes.test', partyId: null, userId: null,
  }],
  subject: 'Repair access confirmation',
  body: 'We confirm that access is available on Friday morning.',
  bodyFormat: 'plain',
  attachmentVersionIds: [],
  conversationId: null,
};

describe('CommunicationService', () => {
  let database: DatabaseSync;
  let service: CommunicationService;

  beforeEach(() => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    service = new CommunicationService(
      new CommunicationStore(database, now),
      new CommunicationProviderRegistry([
        new EvaluationCommunicationProvider(now, 'evaluation-secret'),
      ]),
    );
  });

  afterEach(() => database.close());

  it('preserves tenant concealment before applying communication capability denial', async () => {
    await expect(service.getWorkspace(lewis, SEED_IDS.northstarMatter)).rejects.toEqual(
      new CommunicationError('NOT_FOUND', 'The requested resource was not found.'),
    );
    await expect(service.getWorkspace(finance, SEED_IDS.northstarMatter)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.getWorkspace(ava, SEED_IDS.northstarMatter)).resolves.toMatchObject({
      matterId: SEED_IDS.northstarMatter,
      permissions: { canSend: true, canApprove: false, canReadProtected: true },
    });
  });

  it('allows paralegal preparation but denies external dispatch', async () => {
    const draft = service.createDraft(ben, SEED_IDS.northstarMatter, ordinaryDraft, audit);
    await expect(
      service.dispatch(
        ben,
        SEED_IDS.northstarMatter,
        draft.id,
        {
          expectedVersion: 1,
          providerKey: 'evaluation',
          idempotencyKey: 'paralegal-dispatch-001',
          confirmed: true,
        },
        audit,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('requires approval of the exact current sensitive draft version', async () => {
    const draft = service.createDraft(
      ava,
      SEED_IDS.northstarMatter,
      { ...ordinaryDraft, confidentiality: 'protected_negotiation' },
      audit,
    );
    const submitted = service.submitDraft(
      ava,
      SEED_IDS.northstarMatter,
      draft.id,
      {
        expectedVersion: 1,
        idempotencyKey: 'sensitive-submit-v1',
        note: 'Please review the exact recipients and protected content.',
      },
      audit,
    );
    const approved = service.decideDraft(
      partner,
      SEED_IDS.northstarMatter,
      draft.id,
      {
        expectedVersion: submitted.recordVersion,
        draftVersionId: submitted.currentVersion.id,
        idempotencyKey: 'sensitive-approve-v1',
        decision: 'approved',
        note: 'Partner reviewed the exact recipients and protected content.',
      },
      audit,
    );
    const revised = service.appendDraftVersion(
      ava,
      SEED_IDS.northstarMatter,
      draft.id,
      {
        expectedVersion: approved.recordVersion,
        ...ordinaryDraft,
        confidentiality: 'protected_negotiation',
        body: 'The changed protected content requires fresh approval.',
      },
      audit,
    );

    await expect(
      service.dispatch(
        ava,
        SEED_IDS.northstarMatter,
        draft.id,
        {
          expectedVersion: revised.recordVersion,
          providerKey: 'evaluation',
          idempotencyKey: 'sensitive-dispatch-v2',
          confirmed: true,
        },
        audit,
      ),
    ).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  });

  it('records provider acceptance without claiming delivery', async () => {
    const draft = service.createDraft(ava, SEED_IDS.northstarMatter, ordinaryDraft, audit);
    const result = await service.dispatch(
      ava,
      SEED_IDS.northstarMatter,
      draft.id,
      {
        expectedVersion: 1,
        providerKey: 'evaluation',
        idempotencyKey: 'solicitor-dispatch-001',
        confirmed: true,
      },
      audit,
    );

    expect(result.dispatch.status).toBe('provider_accepted');
    expect(result.dispatch.externalMessageId).toMatch(/^eval-/);
    const workspace = await service.getWorkspace(ava, SEED_IDS.northstarMatter);
    expect(workspace.drafts[0]?.dispatch?.transport).toMatchObject({
      state: 'provider_accepted',
      deliveredAt: null,
      readAt: null,
    });
    expect(workspace.entries).toEqual([
      expect.objectContaining({
        direction: 'outbound',
        subject: 'Repair access confirmation',
        transport: expect.objectContaining({
          state: 'provider_accepted',
          deliveredAt: null,
        }),
      }),
    ]);
  });
});
