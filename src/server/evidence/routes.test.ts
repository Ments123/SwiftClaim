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

const defectPayload = {
  location: 'Main bedroom',
  category: 'damp_mould',
  title: 'Damp and mould around window',
  description: 'Black mould and damp staining surround the bedroom window.',
  severity: 'serious',
  firstObservedOn: '2025-11-03',
  healthImpact: 'Client reports that the room is difficult to use.',
  hazardTags: ['damp'],
};

const noticePayload = {
  idempotencyKey: 'notice-route-001',
  occurredAt: '2026-01-10T10:30:00.000Z',
  channel: 'email',
  recipientType: 'landlord',
  recipientName: 'Meridian Housing Association',
  summary: 'Reported bedroom damp and requested an urgent inspection.',
  proofStatus: 'linked',
  responseStatus: 'acknowledged',
  responseSummary: 'The repairs team acknowledged the complaint.',
  supersedesNoticeId: null,
};

describe('evidence investigation routes', () => {
  let app: FastifyInstance;
  let database: DatabaseSync;
  let testDirectory: string;

  beforeEach(async () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'swiftclaim-evidence-api-'));
    mkdirSync(join(testDirectory, 'storage'));
    database = createDatabase(join(testDirectory, 'test.sqlite'));
    seedDatabase(database, { includeEvidenceInvestigation: false });
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

  it('requires a session and returns the readable tenant workspace', async () => {
    const signedOut = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/evidence-investigation`,
    });
    expect(signedOut.statusCode).toBe(401);

    const cookie = await login(app, 'ava@northstar.test');
    const response = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/evidence-investigation`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      matterId: SEED_IDS.northstarMatter,
      permissions: { canWrite: true },
      readiness: { controls: expect.any(Array) },
    });
  });

  it('creates and version-updates defects through the governed boundary', async () => {
    const cookie = await login(app, 'ava@northstar.test');
    const created = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/defects`,
      headers: { cookie, 'x-request-id': 'route-defect-create' },
      payload: defectPayload,
    });
    expect(created.statusCode).toBe(201);
    const defect = created.json().defect as { id: string; version: number };

    const updatePayload = {
      ...defectPayload,
      expectedVersion: defect.version,
      status: 'monitoring',
      statusReason: 'Inspection is booked and the condition remains unresolved.',
    };
    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/matters/${SEED_IDS.northstarMatter}/defects/${defect.id}`,
      headers: { cookie },
      payload: updatePayload,
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().defect).toMatchObject({
      id: defect.id,
      version: 2,
      status: 'monitoring',
    });

    const stale = await app.inject({
      method: 'PATCH',
      url: `/api/matters/${SEED_IDS.northstarMatter}/defects/${defect.id}`,
      headers: { cookie },
      payload: updatePayload,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('CONFLICT');
  });

  it('returns field validation without implementation details', async () => {
    const cookie = await login(app, 'ava@northstar.test');
    const response = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/defects`,
      headers: { cookie },
      payload: { ...defectPayload, severity: 'urgent' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: 'EVIDENCE_INVALID',
        fields: { severity: expect.any(Array) },
      },
    });
    expect(response.body).not.toContain('sqlite');
    expect(response.body).not.toContain('stack');
  });

  it('denies read-only writes and hides inaccessible or cross-firm matters', async () => {
    const financeCookie = await login(app, 'finance@northstar.test');
    const denied = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/defects`,
      headers: { cookie: financeCookie },
      payload: defectPayload,
    });
    expect(denied.statusCode).toBe(403);

    const avaCookie = await login(app, 'ava@northstar.test');
    const sameFirmHidden = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarRestrictedMatter}/evidence-investigation`,
      headers: { cookie: avaCookie },
    });
    const southbankCookie = await login(app, 'lewis@southbank.test');
    const crossFirmHidden = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/evidence-investigation`,
      headers: { cookie: southbankCookie },
    });
    expect(sameFirmHidden.statusCode).toBe(404);
    expect(crossFirmHidden.statusCode).toBe(404);
    expect(sameFirmHidden.json()).toEqual(crossFirmHidden.json());
  });

  it('replays exact append-only commands and rejects changed payloads', async () => {
    const cookie = await login(app, 'ava@northstar.test');
    const first = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/notices`,
      headers: { cookie },
      payload: noticePayload,
    });
    const replay = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/notices`,
      headers: { cookie },
      payload: noticePayload,
    });
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json().notice.id).toBe(first.json().notice.id);

    const changed = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/notices`,
      headers: { cookie },
      payload: { ...noticePayload, summary: 'A changed replay is not accepted.' },
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});
