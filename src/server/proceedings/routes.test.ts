import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';

function cookie(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  return String(Array.isArray(header) ? header[0] : header).split(';')[0] ?? '';
}

async function login(app: FastifyInstance, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST', url: '/api/auth/login',
    payload: { email, password: 'SwiftClaim!2026' },
  });
  expect(response.statusCode).toBe(200);
  return cookie(response);
}

describe('proceedings routes', () => {
  let app: FastifyInstance;
  let database: DatabaseSync;
  let directory: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'swiftclaim-proceedings-api-'));
    mkdirSync(join(directory, 'storage'));
    database = createDatabase(join(directory, 'test.sqlite'));
    seedDatabase(database);
    app = await buildApp({
      database, storagePath: join(directory, 'storage'), logger: false,
      now: () => new Date('2026-09-01T10:00:00.000Z'),
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('enforces authentication and strict command validation', async () => {
    const url = `/api/matters/${SEED_IDS.northstarMatter}/proceedings`;
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    const ava = await login(app, 'ava@northstar.test');
    const invalid = await app.inject({
      method: 'POST', url, headers: { cookie: ava },
      payload: { idempotencyKey: 'route-invalid-proceeding' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: 'PROCEEDINGS_INVALID' } });
  });

  it('returns the original proceeding for an identical command retry', async () => {
    const ava = await login(app, 'ava@northstar.test');
    const request = {
      method: 'POST' as const,
      url: `/api/matters/${SEED_IDS.northstarMatter}/proceedings`,
      headers: { cookie: ava },
      payload: {
        idempotencyKey: 'route-create-proceeding-001', procedureType: 'part7',
        jurisdiction: 'england_wales', courtName: 'County Court at Central London',
        courtCode: null, hearingCentre: 'Central London',
      },
    };
    const created = await app.inject(request);
    const replay = await app.inject(request);
    expect(created.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(created.json());
    expect((database.prepare('SELECT COUNT(*) AS count FROM court_proceedings')
      .get() as { count: number }).count).toBe(1);
  });

  it('hides a proceeding UUID from another tenant', async () => {
    const ava = await login(app, 'ava@northstar.test');
    const created = await app.inject({
      method: 'POST', url: `/api/matters/${SEED_IDS.northstarMatter}/proceedings`,
      headers: { cookie: ava }, payload: {
        idempotencyKey: 'route-tenant-proceeding', procedureType: 'part7',
        jurisdiction: 'england_wales', courtName: 'County Court at Central London',
        courtCode: null, hearingCentre: 'Central London',
      },
    });
    const proceedingId = created.json().proceeding.id as string;
    const lewis = await login(app, 'lewis@southbank.test');
    const hidden = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.southbankMatter}/proceedings/${proceedingId}/events`,
      headers: { cookie: lewis }, payload: {
        expectedVersion: 1, idempotencyKey: 'route-cross-tenant-event',
        eventType: 'issue_request_prepared', occurredAt: '2026-09-01T10:00:00.000Z',
        note: 'This inaccessible proceeding must remain hidden from another tenant.',
        sourceDocumentVersionId: null, courtName: '', caseNumber: '', track: null,
        supersedesEventId: null, correctionReason: '', explicitHumanConfirmation: true,
      },
    });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
