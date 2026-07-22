import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';

describe('closure routes', () => {
  let directory: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: ReturnType<typeof createDatabase>;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'swiftclaim-closure-routes-'));
    database = createDatabase(':memory:');
    seedDatabase(database);
    app = await buildApp({ database, storagePath: directory, now: () => new Date('2026-07-22T10:00:00.000Z') });
  });
  afterEach(async () => { await app.close(); database.close(); rmSync(directory, { recursive: true, force: true }); });

  async function cookie(email: string) {
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'SwiftClaim!2026' } });
    return String(response.headers['set-cookie']).split(';')[0];
  }

  it('returns a tenant-scoped workspace with capability-derived actions', async () => {
    const solicitor = await cookie('ava@northstar.test');
    const response = await app.inject({ method: 'GET', url: `/api/matters/${SEED_IDS.northstarMatter}/closure`, headers: { cookie: solicitor } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ matterId: SEED_IDS.northstarMatter, permissions: { canPrepare: true, canApprove: false } });

    const outsider = await cookie('lewis@southbank.test');
    const hidden = await app.inject({ method: 'GET', url: `/api/matters/${SEED_IDS.northstarMatter}/closure`, headers: { cookie: outsider } });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json().error.code).toBe('NOT_FOUND');
  });

  it('rejects autonomous preparation and finance-role closure authority', async () => {
    const solicitor = await cookie('ava@northstar.test');
    const invalid = await app.inject({ method: 'POST', url: `/api/matters/${SEED_IDS.northstarMatter}/closure/reviews`, headers: { cookie: solicitor }, payload: { aiApproved: true } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('CLOSURE_INVALID');

    const finance = await cookie('finance@northstar.test');
    const forbidden = await app.inject({ method: 'POST', url: `/api/matters/${SEED_IDS.northstarMatter}/closure/reopen`, headers: { cookie: finance }, payload: {
      reason: 'New evidence requires the legal matter to be reopened and reviewed.', newOwnerUserId: SEED_IDS.ava,
      explicitHumanAuthority: true, idempotencyKey: 'closure-reopen-route-001',
    } });
    expect(forbidden.statusCode).toBe(403);
  });
});
