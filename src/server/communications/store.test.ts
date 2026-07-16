import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  CreateCommunicationDraftInput,
  RecordCommunicationInput,
} from '../../shared/contracts.js';
import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import { CommunicationStore, CommunicationStoreError } from './store.js';

const FIXED_NOW = new Date('2026-07-16T09:00:00.000Z');
const audit = { requestId: 'communications-store-test', ipAddress: '127.0.0.1' };

function sessionUser(
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

const ava = sessionUser(SEED_IDS.ava, 'solicitor');
const lewis = sessionUser(SEED_IDS.southbankUser, 'partner', SEED_IDS.southbankFirm);

const ordinaryEmail: RecordCommunicationInput = {
  idempotencyKey: 'ordinary-email-001',
  channel: 'email',
  direction: 'inbound',
  confidentiality: 'ordinary',
  participants: [{
    role: 'from', displayName: 'Harbour Homes Legal', endpointType: 'email',
    endpoint: 'legal@harbourhomes.test', partyId: null, userId: null,
  }],
  subject: 'Repair appointment',
  body: 'The contractor proposes attendance on Friday morning.',
  bodyFormat: 'plain',
  occurredAt: '2026-07-16T08:30:00.000Z',
  attachmentVersionIds: [SEED_IDS.complaintVersion],
  source: 'manual',
  providerKey: null,
  externalMessageId: null,
  externalThreadId: null,
  conversationId: null,
  supersedesEntryId: null,
  correctionReason: '',
};

const protectedEmail: RecordCommunicationInput = {
  ...ordinaryEmail,
  idempotencyKey: 'protected-email-001',
  confidentiality: 'protected_negotiation',
  subject: 'Protected settlement position',
  body: 'Protected settlement position must not enter ordinary payloads.',
  attachmentVersionIds: [],
};

const draftInput: CreateCommunicationDraftInput = {
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

describe('CommunicationStore', () => {
  let database: DatabaseSync;
  let store: CommunicationStore;

  beforeEach(() => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    store = new CommunicationStore(database, () => FIXED_NOW);
  });

  afterEach(() => database.close());

  it('records an immutable entry with exact document-version provenance', () => {
    const entry = store.recordEntry(ava, SEED_IDS.northstarMatter, ordinaryEmail, audit);

    expect(entry).toMatchObject({
      channel: 'email',
      transport: { state: 'recorded' },
      attachments: [{ documentVersionId: SEED_IDS.complaintVersion }],
    });
    expect(entry.attachments[0]?.sha256).toHaveLength(64);
    expect(() =>
      database.prepare('UPDATE communication_entries SET subject = ? WHERE id = ?').run('Changed', entry.id),
    ).toThrow('communication entries are append-only');
  });

  it('filters protected records before workspace counts and payload assembly', () => {
    store.recordEntry(ava, SEED_IDS.northstarMatter, ordinaryEmail, audit);
    store.recordEntry(ava, SEED_IDS.northstarMatter, protectedEmail, audit);

    const ordinary = store.getWorkspace(ava, SEED_IDS.northstarMatter, {
      readPrivileged: false,
      readProtected: false,
    });
    expect(ordinary?.entries).toHaveLength(1);
    expect(ordinary?.counts.total).toBe(1);
    expect(JSON.stringify(ordinary)).not.toContain('Protected settlement position');

    const protectedWorkspace = store.getWorkspace(ava, SEED_IDS.northstarMatter, {
      readPrivileged: true,
      readProtected: true,
    });
    expect(protectedWorkspace?.entries).toHaveLength(2);
    expect(store.getWorkspace(lewis, SEED_IDS.northstarMatter, { readPrivileged: true, readProtected: true })).toBeUndefined();
  });

  it('rejects a document version from another matter', () => {
    const invalid = { ...ordinaryEmail, idempotencyKey: 'cross-matter-link-001' };
    expect(() => store.recordEntry(lewis, SEED_IDS.southbankMatter, invalid, audit)).toThrow(
      new CommunicationStoreError('INVALID_LINK', 'The document version was not found.'),
    );
  });

  it('invalidates an exact-version approval when content changes', () => {
    const draft = store.createDraft(ava, SEED_IDS.northstarMatter, draftInput, audit);
    store.recordApprovalEvent(
      ava,
      SEED_IDS.northstarMatter,
      draft.id,
      {
        draftVersionId: draft.currentVersion.id,
        decision: 'approved',
        note: 'Reviewed the exact recipients and retained content.',
        idempotencyKey: 'approval-draft-v1',
      },
      audit,
    );
    const revised = store.appendDraftVersion(
      ava,
      SEED_IDS.northstarMatter,
      draft.id,
      { expectedVersion: 2, ...draftInput, body: 'Revised content requires a fresh approval.' },
      audit,
    );

    expect(revised.status).toBe('draft');
    expect(revised.currentApproval).toBeNull();
    expect(revised.currentVersion.version).toBe(2);
  });

  it('deduplicates provider events without a second operational event', () => {
    const draft = store.createDraft(ava, SEED_IDS.northstarMatter, draftInput, audit);
    const dispatch = store.createDispatch(
      ava,
      SEED_IDS.northstarMatter,
      draft.id,
      {
        expectedVersion: 1,
        providerKey: 'evaluation',
        idempotencyKey: 'dispatch-store-001',
        confirmed: true,
      },
      audit,
    );
    const providerEvent = {
      providerEventId: 'evaluation-event-001',
      eventType: 'provider_accepted' as const,
      occurredAt: '2026-07-16T09:00:00.000Z',
      authenticated: true,
      authenticationMethod: 'evaluation_sha256',
      safePayload: { networkCall: false },
    };

    expect(store.recordProviderEvent(ava, SEED_IDS.northstarMatter, dispatch.id, 'evaluation', providerEvent, audit).replayed).toBe(false);
    expect(store.recordProviderEvent(ava, SEED_IDS.northstarMatter, dispatch.id, 'evaluation', providerEvent, audit).replayed).toBe(true);
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM communication_provider_events').get(),
    ).toEqual({ count: 1 });
  });
});
