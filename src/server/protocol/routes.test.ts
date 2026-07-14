import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';

const FIXED_NOW = new Date('2026-07-15T09:00:00.000Z');

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

const draft = {
  expectedVersion: 1,
  claimantAddress: '18 Alder Court, Salford, M5 4QJ',
  landlordRecipient: 'Meridian Housing Association',
  landlordAddress: '1 Meridian Square, Manchester, M1 1AA',
  effectNarrative: 'The child cannot safely use the affected bedroom because of mould.',
  personalInjuryStatus: 'minor_gp_evidence',
  personalInjurySummary: 'A GP attendance is recorded.',
  specialDamagesStatus: 'under_review',
  specialDamagesSummary: '',
  accessWindows: [{ date: '2026-07-20', from: '10:00', to: '13:00', notes: 'Call first.' }],
  expertProposalSummary: 'A single joint building surveyor is proposed.',
  disclosureRequests: ['Tenancy file', 'Inspection and works records'],
  additionalContent: '',
  state: 'ready_for_review',
};

describe('protocol and expert routes', () => {
  let app: FastifyInstance;
  let database: DatabaseSync;
  let testDirectory: string;

  beforeEach(async () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'swiftclaim-protocol-api-'));
    mkdirSync(join(testDirectory, 'storage'));
    database = createDatabase(join(testDirectory, 'test.sqlite'));
    seedDatabase(database);
    app = await buildApp({
      database,
      storagePath: join(testDirectory, 'storage'),
      logger: false,
      isProduction: false,
      now: () => FIXED_NOW,
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
    rmSync(testDirectory, { recursive: true, force: true });
  });

  it('serves a tenant-scoped workspace and hides inaccessible matters', async () => {
    const avaCookie = await login(app, 'ava@northstar.test');
    const workspace = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/protocol-experts`,
      headers: { cookie: avaCookie },
    });
    expect(workspace.statusCode).toBe(200);
    expect(workspace.json()).toMatchObject({ matterId: SEED_IDS.northstarMatter });

    const southbankCookie = await login(app, 'lewis@southbank.test');
    const hidden = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/protocol-experts`,
      headers: { cookie: southbankCookie },
    });
    expect(hidden.statusCode).toBe(404);
  });

  it('validates, saves, permission-checks, approves and downloads the exact version', async () => {
    const avaCookie = await login(app, 'ava@northstar.test');
    const invalid = await app.inject({
      method: 'PUT',
      url: `/api/matters/${SEED_IDS.northstarMatter}/protocol/letter`,
      headers: { cookie: avaCookie },
      payload: { ...draft, effectNarrative: 'short' },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toMatchObject({ error: { code: 'PROTOCOL_INVALID', fields: { effectNarrative: expect.any(Array) } } });

    const saved = await app.inject({
      method: 'PUT',
      url: `/api/matters/${SEED_IDS.northstarMatter}/protocol/letter`,
      headers: { cookie: avaCookie },
      payload: draft,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().letter.version).toBe(2);

    const benCookie = await login(app, 'ben@northstar.test');
    const denied = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/protocol/letter/approve`,
      headers: { cookie: benCookie },
      payload: { expectedVersion: 2, idempotencyKey: 'route-approve-letter' },
    });
    expect(denied.statusCode).toBe(403);

    const approved = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/protocol/letter/approve`,
      headers: { cookie: avaCookie },
      payload: { expectedVersion: 2, idempotencyKey: 'route-approve-letter' },
    });
    expect(approved.statusCode).toBe(201);
    const documentVersionId = approved.json().version.documentVersion.id as string;

    const download = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/protocol/generated/${documentVersionId}/download`,
      headers: { cookie: avaCookie },
    });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload.subarray(0, 2).toString()).toBe('PK');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(download.headers['content-disposition']).toContain('attachment');
  });
});
