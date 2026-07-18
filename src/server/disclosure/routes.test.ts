import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';

const cookie = (response: { headers: Record<string, unknown> }) =>
  String(Array.isArray(response.headers['set-cookie']) ? response.headers['set-cookie'][0] : response.headers['set-cookie']).split(';')[0] ?? '';

async function login(app: FastifyInstance, email: string) {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'SwiftClaim!2026' } });
  expect(response.statusCode).toBe(200); return cookie(response);
}

describe('disclosure routes', () => {
  let app: FastifyInstance; let database: DatabaseSync; let directory: string;
  let proceedingId: string; let partyId: string; let versionId: string; let ava: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'swiftclaim-disclosure-api-')); mkdirSync(join(directory, 'storage'));
    database = createDatabase(join(directory, 'test.sqlite')); seedDatabase(database);
    app = await buildApp({ database, storagePath: join(directory, 'storage'), logger: false,
      now: () => new Date('2026-10-10T10:00:00.000Z') });
    ava = await login(app, 'ava@northstar.test');
    const proceeding = await app.inject({ method: 'POST', url: `/api/matters/${SEED_IDS.northstarMatter}/proceedings`,
      headers: { cookie: ava }, payload: { idempotencyKey: 'disclosure-route-proceeding', procedureType: 'part7',
        jurisdiction: 'england_wales', courtName: 'County Court', courtCode: null, hearingCentre: null } });
    proceedingId = proceeding.json().proceeding.id as string;
    partyId = String((database.prepare(`SELECT id FROM parties WHERE firm_id = ? AND matter_id = ? AND kind = 'client'`)
      .get(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter) as { id: string }).id);
    versionId = String((database.prepare(`SELECT dv.id FROM document_versions dv JOIN documents d
      ON d.id = dv.document_id AND d.firm_id = dv.firm_id WHERE dv.firm_id = ? AND d.matter_id = ? LIMIT 1`)
      .get(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter) as { id: string }).id);
  });

  afterEach(async () => { await app.close(); database.close(); rmSync(directory, { recursive: true, force: true }); });

  const reviewPayload = () => ({ idempotencyKey: 'disclosure-route-review', disclosingPartyId: partyId,
    directionId: null, scopeNote: 'Review exact retained repair evidence against the pleaded housing issues.',
    dateFrom: null, dateTo: null, custodians: ['Maya Clarke'], issueTags: ['repairs'] });

  it('creates a review and exact candidate through strict commands', async () => {
    const base = `/api/matters/${SEED_IDS.northstarMatter}/proceedings/${proceedingId}/disclosure`;
    const opened = await app.inject({ method: 'POST', url: `${base}/reviews`, headers: { cookie: ava }, payload: reviewPayload() });
    expect(opened.statusCode).toBe(201); const reviewId = opened.json().review.id as string;
    const candidate = await app.inject({ method: 'POST', url: `${base}/reviews/${reviewId}/candidates`,
      headers: { cookie: ava }, payload: { expectedVersion: 1, idempotencyKey: 'disclosure-route-candidate',
        documentVersionId: versionId, evidenceItemId: null, custodian: 'Maya Clarke',
        sourceNote: 'Exact retained source selected for human disclosure review.' } });
    expect(candidate.statusCode).toBe(201);
    const workspace = await app.inject({ method: 'GET', url: base, headers: { cookie: ava } });
    expect(workspace.statusCode).toBe(200);
    expect(workspace.json()).toMatchObject({ proceedingId, reviews: [{ candidates: [{ documentVersionId: versionId }] }] });
  });

  it('rejects unknown AI decision properties', async () => {
    const base = `/api/matters/${SEED_IDS.northstarMatter}/proceedings/${proceedingId}/disclosure`;
    const opened = await app.inject({ method: 'POST', url: `${base}/reviews`, headers: { cookie: ava }, payload: reviewPayload() });
    const response = await app.inject({ method: 'POST', url: `${base}/reviews/${opened.json().review.id}/candidates`,
      headers: { cookie: ava }, payload: { expectedVersion: 1, idempotencyKey: 'bad-candidate',
        documentVersionId: versionId, evidenceItemId: null, custodian: '', sourceNote: 'Exact source for review.', finalDecision: 'disclose' } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'DISCLOSURE_INVALID' } });
  });

  it('does not expose disclosure to finance', async () => {
    const finance = await login(app, 'finance@northstar.test');
    const response = await app.inject({ method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/proceedings/${proceedingId}/disclosure`, headers: { cookie: finance } });
    expect(response.statusCode).toBe(404);
  });

  it('returns generic not found for an inaccessible candidate', async () => {
    const response = await app.inject({ method: 'POST',
      url: `/api/matters/${SEED_IDS.southbankMatter}/proceedings/${proceedingId}/disclosure/candidates/93000000-0000-4000-8000-000000000099/decisions`,
      headers: { cookie: ava }, payload: { expectedVersion: 1, idempotencyKey: 'cross-matter-decision',
        decision: 'review_required', reason: 'This inaccessible resource must return a generic response.',
        redactionRequired: false, reviewedAt: '2026-10-10T11:00:00.000Z' } });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND', message: 'Disclosure record not found.' } });
  });
});
