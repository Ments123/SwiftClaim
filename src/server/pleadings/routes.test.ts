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
    method: 'POST', url: '/api/auth/login', payload: { email, password: 'SwiftClaim!2026' },
  });
  expect(response.statusCode).toBe(200);
  return cookie(response);
}

describe('pleading routes', () => {
  let app: FastifyInstance;
  let database: DatabaseSync;
  let directory: string;
  let proceedingId: string;
  let trackPayload: Record<string, unknown>;
  let ava: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'swiftclaim-pleadings-api-'));
    mkdirSync(join(directory, 'storage'));
    database = createDatabase(join(directory, 'test.sqlite'));
    seedDatabase(database);
    app = await buildApp({
      database, storagePath: join(directory, 'storage'), logger: false,
      now: () => new Date('2026-09-01T10:00:00.000Z'),
    });
    ava = await login(app, 'ava@northstar.test');
    const proceeding = await app.inject({
      method: 'POST', url: `/api/matters/${SEED_IDS.northstarMatter}/proceedings`,
      headers: { cookie: ava }, payload: {
        idempotencyKey: 'pleading-route-proceeding', procedureType: 'part7',
        jurisdiction: 'england_wales', courtName: 'County Court', courtCode: null, hearingCentre: null,
      },
    });
    proceedingId = proceeding.json().proceeding.id as string;
    const parties = database.prepare(`SELECT id, kind FROM parties WHERE firm_id = ? AND matter_id = ?`)
      .all(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter) as Array<{ id: string; kind: string }>;
    const versions = (database.prepare(`SELECT dv.id FROM document_versions dv JOIN documents d
      ON d.id = dv.document_id AND d.firm_id = dv.firm_id WHERE dv.firm_id = ? AND d.matter_id = ?
      ORDER BY dv.created_at LIMIT 2`).all(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter) as Array<{ id: string }>);
    trackPayload = {
      idempotencyKey: 'pleading-route-track',
      claimantPartyId: parties.find(({ kind }) => kind === 'client')!.id,
      defendantPartyId: parties.find(({ kind }) => kind === 'opponent')!.id,
      claimFormDocumentVersionId: versions[0]!.id,
      particularsDocumentVersionId: versions[1]!.id,
      regime: 'part_7_domestic', serviceRecordId: null,
      note: 'The response route was selected from reviewed synthetic source records.',
    };
  });

  afterEach(async () => {
    await app.close(); database.close(); rmSync(directory, { recursive: true, force: true });
  });

  it('creates and returns the pleading workspace', async () => {
    const base = `/api/matters/${SEED_IDS.northstarMatter}/proceedings/${proceedingId}/pleadings`;
    const created = await app.inject({ method: 'POST', url: `${base}/tracks`, headers: { cookie: ava }, payload: trackPayload });
    expect(created.statusCode).toBe(201);
    const response = await app.inject({ method: 'GET', url: base, headers: { cookie: ava } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ proceedingId, tracks: [expect.objectContaining({ regime: 'part_7_domestic' })] });
  });

  it('rejects unknown command properties', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/proceedings/${proceedingId}/pleadings/tracks`,
      headers: { cookie: ava }, payload: { ...trackPayload, legalConclusion: 'valid service' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'PLEADINGS_INVALID' } });
  });

  it('does not expose the workspace to a readonly role', async () => {
    const readOnly = await login(app, 'finance@northstar.test');
    const response = await app.inject({
      method: 'GET', url: `/api/matters/${SEED_IDS.northstarMatter}/proceedings/${proceedingId}/pleadings`,
      headers: { cookie: readOnly },
    });
    expect(response.statusCode).toBe(404);
  });

  it('retains an exact statement version through a strict command', async () => {
    const base = `/api/matters/${SEED_IDS.northstarMatter}/proceedings/${proceedingId}/pleadings`;
    const trackResponse = await app.inject({
      method: 'POST', url: `${base}/tracks`, headers: { cookie: ava }, payload: trackPayload,
    });
    const trackId = trackResponse.json().track.id as string;
    const response = await app.inject({
      method: 'POST', url: `${base}/tracks/${trackId}/statements`, headers: { cookie: ava },
      payload: {
        idempotencyKey: 'route-defence-version', statementType: 'defence',
        partyId: trackPayload.defendantPartyId,
        documentVersionId: trackPayload.particularsDocumentVersionId,
        predecessorVersionId: null, preparedByUserId: SEED_IDS.ava,
        statementOfTruthStatus: 'signed', signatoryName: 'Synthetic Defendant',
        signatoryCapacity: 'Defendant', signedAt: '2026-09-20T10:00:00.000Z',
        responsePosition: 'defend_all', amendmentRoute: 'not_applicable', amendmentReason: '',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ statement: {
      statementType: 'defence', currentVersion: { documentVersionId: trackPayload.particularsDocumentVersionId },
    } });
  });
});
