import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';

function cookie(response: { headers: Record<string, unknown> }): string {
  const value = response.headers['set-cookie'];
  return String(Array.isArray(value) ? value[0] : value).split(';')[0] ?? '';
}

async function login(app: FastifyInstance, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: 'SwiftClaim!2026' },
  });
  expect(response.statusCode).toBe(200);
  return cookie(response);
}

describe('finance routes', () => {
  let app: FastifyInstance;
  let database: DatabaseSync;
  let directory: string;
  let ava: string;
  let finance: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'swiftclaim-finance-api-'));
    mkdirSync(join(directory, 'storage'));
    database = createDatabase(join(directory, 'test.sqlite'));
    seedDatabase(database);
    database.prepare(`INSERT INTO users (
      id, firm_id, email, name, password_hash, role, active, created_at
    ) SELECT ?, firm_id, ?, ?, password_hash, 'readonly', 1, created_at
      FROM users WHERE id = ?`).run(
      '20000000-0000-4000-8000-000000000099',
      'readonly@northstar.test',
      'Read Only',
      SEED_IDS.ava,
    );
    database.prepare(`INSERT INTO documents (
      id, firm_id, matter_id, title, category, external_source,
      external_id, import_batch_id, created_by, created_at
    ) VALUES (?, ?, ?, ?, 'invoice', NULL, NULL, NULL, ?, ?)`)
      .run(
        '74000000-0000-4000-8000-000000000099',
        SEED_IDS.southbankFirm,
        SEED_IDS.southbankMatter,
        'Other firm invoice',
        SEED_IDS.southbankUser,
        '2026-07-18T10:00:00.000Z',
      );
    database.prepare(`INSERT INTO document_versions (
      id, firm_id, document_id, version, original_name, mime_type,
      size_bytes, sha256, storage_key, uploaded_by, created_at
    ) VALUES (?, ?, ?, 1, 'other-firm-invoice.pdf', 'application/pdf',
      1, ?, ?, ?, ?)`)
      .run(
        '75000000-0000-4000-8000-000000000099',
        SEED_IDS.southbankFirm,
        '74000000-0000-4000-8000-000000000099',
        '9'.repeat(64),
        'test/other-firm-invoice.pdf',
        SEED_IDS.southbankUser,
        '2026-07-18T10:00:00.000Z',
      );
    app = await buildApp({
      database,
      storagePath: join(directory, 'storage'),
      logger: false,
      now: () => new Date('2026-07-19T12:00:00.000Z'),
    });
    ava = await login(app, 'ava@northstar.test');
    finance = await login(app, 'finance@northstar.test');
  });

  afterEach(async () => {
    await app.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('returns the tenant-safe matter finance workspace', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/finance`,
      headers: { cookie: finance },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      matterId: SEED_IDS.northstarMatter,
      permissions: {
        canRecordTime: false,
        canManageRates: true,
        canPostJournal: true,
      },
      snapshot: {
        clientBalance: { state: 'not_connected' },
        officeBalance: { state: 'not_connected' },
      },
    });
  });

  it('rejects autonomous AI posting properties before touching a suggestion', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/finance/suggestions/${crypto.randomUUID()}/decisions`,
      headers: { cookie: ava },
      payload: {
        expectedVersion: 1,
        idempotencyKey: 'finance-route-ai-decision',
        decision: 'accept',
        reason: 'I reviewed the provisional activity against the source.',
        status: 'approved',
        aiApproved: true,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'FINANCE_INVALID' } });
  });

  it('returns a generic 404 for another firm evidence version', async () => {
    const otherFirmVersion = database.prepare(`SELECT dv.id FROM document_versions dv
      JOIN documents d ON d.id = dv.document_id AND d.firm_id = dv.firm_id
      WHERE d.firm_id = ? LIMIT 1`)
      .get(SEED_IDS.southbankFirm) as { id: string };

    const response = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/finance/disbursements`,
      headers: { cookie: finance },
      payload: {
        idempotencyKey: 'finance-route-cross-firm-evidence',
        supplier: 'Independent Expert Ltd',
        invoiceReference: 'INV-EXT-001',
        category: 'expert',
        description: 'Expert inspection and written opinion for the pleaded defects.',
        netMinor: 100_000,
        vatMinor: 20_000,
        grossMinor: 120_000,
        currency: 'GBP',
        invoiceDate: '2026-07-18',
        dueOn: '2026-08-17',
        sourceDocumentVersionId: otherFirmVersion.id,
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Finance record not found.' },
    });
  });

  it('submits manual time idempotently and rejects a changed replay', async () => {
    const url = `/api/matters/${SEED_IDS.northstarMatter}/finance/time-entries`;
    const payload = {
      idempotencyKey: 'finance-route-manual-time',
      workDate: '2026-07-19',
      minutes: 37,
      narrative: 'Reviewed the retained repair evidence and updated the matter chronology.',
      activityCode: 'document_review',
      costsPhase: 'case_management',
      chargeable: true,
      sourceKind: 'manual',
      sourceId: null,
    };

    const created = await app.inject({ method: 'POST', url, headers: { cookie: ava }, payload });
    const replayed = await app.inject({ method: 'POST', url, headers: { cookie: ava }, payload });
    const changed = await app.inject({
      method: 'POST',
      url,
      headers: { cookie: ava },
      payload: { ...payload, minutes: 38 },
    });

    expect(created.statusCode).toBe(201);
    expect(replayed.statusCode).toBe(201);
    expect(replayed.json()).toEqual(created.json());
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  });

  it('lists firm rate cards only through firm-finance access', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/finance/rate-cards',
      headers: { cookie: finance },
      payload: {
        idempotencyKey: 'finance-route-rate-card',
        name: 'Northstar standard litigation rates',
        description: 'Effective-dated rates retained for governed finance evaluation.',
        currency: 'GBP',
      },
    });
    expect(created.statusCode).toBe(201);

    const listed = await app.inject({
      method: 'GET',
      url: '/api/finance/rate-cards',
      headers: { cookie: finance },
    });
    const hiddenFromFeeEarner = await app.inject({
      method: 'GET',
      url: `/api/finance/rate-cards/${created.json().rateCard.id}`,
      headers: { cookie: ava },
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      rateCards: [{ name: 'Northstar standard litigation rates', currency: 'GBP' }],
    });
    expect(hiddenFromFeeEarner.statusCode).toBe(404);
  });

  it('does not expose finance to a role without finance access', async () => {
    const readonly = await login(app, 'readonly@northstar.test');
    const response = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/finance`,
      headers: { cookie: readonly },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Finance record not found.' },
    });
  });
});
