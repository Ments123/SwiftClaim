import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';

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

describe('negotiation and settlement routes', () => {
  let app: FastifyInstance;
  let database: DatabaseSync;
  let directory: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'swiftclaim-negotiation-api-'));
    mkdirSync(join(directory, 'storage'));
    database = createDatabase(join(directory, 'test.sqlite'));
    seedDatabase(database);
    app = await buildApp({
      database,
      storagePath: join(directory, 'storage'),
      logger: false,
      now: () => new Date('2026-08-20T12:00:00.000Z'),
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('enforces authentication, role, tenant and explicit protected access', async () => {
    const unauthenticated = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/negotiation-settlement`,
    });
    expect(unauthenticated.statusCode).toBe(401);

    const finance = await login(app, 'finance@northstar.test');
    const forbidden = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/negotiation-settlement`,
      headers: { cookie: finance },
    });
    expect(forbidden.statusCode).toBe(403);

    const lewis = await login(app, 'lewis@southbank.test');
    const hidden = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/negotiation-settlement`,
      headers: { cookie: lewis },
    });
    expect(hidden.statusCode).toBe(404);

    const ben = await login(app, 'ben@northstar.test');
    const protectedDenied = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/negotiation-settlement/protected`,
      headers: { cookie: ben },
    });
    expect(protectedDenied.statusCode).toBe(403);

    const ava = await login(app, 'ava@northstar.test');
    const protectedAllowed = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/negotiation-settlement/protected`,
      headers: { cookie: ava },
    });
    expect(protectedAllowed.statusCode).toBe(200);
    expect(protectedAllowed.json()).toMatchObject({ matterId: SEED_IDS.northstarMatter });
  });

  it('strictly validates and idempotently creates an ordinary review', async () => {
    const ava = await login(app, 'ava@northstar.test');
    const url = `/api/matters/${SEED_IDS.northstarMatter}/negotiation-reviews`;
    const invalid = await app.inject({
      method: 'POST',
      url,
      headers: { cookie: ava },
      payload: { idempotencyKey: 'invalid-review-001' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: 'NEGOTIATION_INVALID' } });

    const payload = {
      idempotencyKey: 'route-negotiation-review-001',
      confidentiality: 'ordinary',
      reviewedOn: '2026-08-20',
      reviewerUserId: null,
      selectedOfferIds: [],
      lossScheduleId: null,
      generalDamagesReviewId: null,
      workScheduleId: null,
      confirmedFacts: 'The reviewed position contains retained synthetic facts only.',
      optionsExplained: 'Continue negotiating, counteroffer, reject or consider proceedings.',
      riskAnalysis: 'A human solicitor must assess the legal and evidential risks.',
      costsFundingExplanation: 'Potential costs and funding consequences were explained.',
      humanRecommendation: 'Human-authored recommendation for evaluation only.',
      adviceLimitations: 'SwiftClaim does not determine legal validity or likely outcome.',
      clientQuestions: '',
      supersedesReviewId: null,
      correctionReason: '',
    };
    const created = await app.inject({
      method: 'POST',
      url,
      headers: { cookie: ava },
      payload,
    });
    const replay = await app.inject({
      method: 'POST',
      url,
      headers: { cookie: ava },
      payload,
    });
    expect(created.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json().review.id).toBe(created.json().review.id);

    const workspace = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/negotiation-settlement`,
      headers: { cookie: ava },
    });
    expect(workspace.json().reviews).toHaveLength(1);
    expect(workspace.body).not.toContain('protectedCount');
  });
});
