import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';

const now = () => new Date('2026-07-16T09:00:00.000Z');

function sessionCookie(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? String(header[0]) : String(header);
  return value.split(';')[0] ?? '';
}

async function login(app: FastifyInstance, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: 'SwiftClaim!2026' },
  });
  expect(response.statusCode).toBe(200);
  return sessionCookie(response);
}

const recipient = {
  role: 'to',
  displayName: 'Harbour Homes Legal',
  endpointType: 'email',
  endpoint: 'legal@harbourhomes.test',
  partyId: null,
  userId: null,
};

const draftPayload = {
  channel: 'email',
  confidentiality: 'ordinary',
  participants: [recipient],
  subject: 'Repair access confirmation',
  body: 'We confirm that access is available on Friday morning.',
  bodyFormat: 'plain',
  attachmentVersionIds: [],
  conversationId: null,
};

describe('communication routes', () => {
  let app: FastifyInstance;
  let database: DatabaseSync;
  let directory: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'swiftclaim-communications-api-'));
    mkdirSync(join(directory, 'storage'));
    database = createDatabase(join(directory, 'test.sqlite'));
    seedDatabase(database);
    app = await buildApp({
      database,
      storagePath: join(directory, 'storage'),
      logger: false,
      isProduction: false,
      now,
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('serves communications while preserving capability and tenant boundaries', async () => {
    const avaCookie = await login(app, 'ava@northstar.test');
    const ordinary = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/communications`,
      headers: { cookie: avaCookie },
    });
    expect(ordinary.statusCode).toBe(200);
    expect(ordinary.json()).toMatchObject({
      matterId: SEED_IDS.northstarMatter,
      permissions: { canSend: true, canApprove: false },
    });

    const financeCookie = await login(app, 'finance@northstar.test');
    const forbidden = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/communications`,
      headers: { cookie: financeCookie },
    });
    expect(forbidden.statusCode).toBe(403);

    const lewisCookie = await login(app, 'lewis@southbank.test');
    const hidden = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/communications`,
      headers: { cookie: lewisCookie },
    });
    expect(hidden.statusCode).toBe(404);
  });

  it('creates and explicitly dispatches an evaluation draft as provider-accepted', async () => {
    const cookie = await login(app, 'ava@northstar.test');
    const created = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/communication-drafts`,
      headers: { cookie },
      payload: draftPayload,
    });
    expect(created.statusCode).toBe(201);
    const draft = created.json().draft;

    const unconfirmed = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/communication-drafts/${draft.id}/dispatch`,
      headers: { cookie },
      payload: {
        expectedVersion: 1,
        providerKey: 'evaluation',
        idempotencyKey: 'route-dispatch-unconfirmed',
        confirmed: false,
      },
    });
    expect(unconfirmed.statusCode).toBe(400);

    const dispatched = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/communication-drafts/${draft.id}/dispatch`,
      headers: { cookie },
      payload: {
        expectedVersion: 1,
        providerKey: 'evaluation',
        idempotencyKey: 'route-dispatch-confirmed',
        confirmed: true,
      },
    });
    expect(dispatched.statusCode).toBe(202);
    expect(dispatched.json()).toMatchObject({
      dispatch: { status: 'provider_accepted' },
      replayed: false,
    });
  });

  it('filters protected content before returning a paralegal workspace', async () => {
    const avaCookie = await login(app, 'ava@northstar.test');
    const recorded = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/communications/record`,
      headers: { cookie: avaCookie },
      payload: {
        idempotencyKey: 'route-protected-record-001',
        channel: 'email',
        direction: 'inbound',
        confidentiality: 'protected_negotiation',
        participants: [{ ...recipient, role: 'from' }],
        subject: 'Protected settlement position',
        body: 'This protected settlement position is restricted.',
        bodyFormat: 'plain',
        occurredAt: '2026-07-16T08:30:00.000Z',
        attachmentVersionIds: [],
        source: 'manual',
        providerKey: null,
        externalMessageId: null,
        externalThreadId: null,
        conversationId: null,
        supersedesEntryId: null,
        correctionReason: '',
      },
    });
    expect(recorded.statusCode).toBe(201);

    const benCookie = await login(app, 'ben@northstar.test');
    const workspace = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/communications`,
      headers: { cookie: benCookie },
    });
    expect(workspace.statusCode).toBe(200);
    expect(workspace.body).not.toContain('Protected settlement position');
    expect(workspace.json().counts.total).toBe(0);
  });
});
