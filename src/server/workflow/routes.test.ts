import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import { WorkflowStore } from './store.js';

const FIXED_NOW = new Date('2026-07-13T12:00:00.000Z');
const TEST_MATTER_ID = SEED_IDS.northstarRestrictedMatter;
const UNASSIGNED_MATTER_ID = '30000000-0000-4000-8000-000000000098';

function sessionCookie(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? String(header[0]) : String(header);
  return value.split(';')[0] ?? '';
}

async function login(
  app: FastifyInstance,
  email = 'ava@northstar.test',
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: 'SwiftClaim!2026' },
  });
  expect(response.statusCode).toBe(200);
  return sessionCookie(response);
}

describe('workflow routes', () => {
  let app: FastifyInstance;
  let database: DatabaseSync;
  let testDirectory: string;

  beforeEach(async () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'swiftclaim-workflow-api-'));
    mkdirSync(join(testDirectory, 'storage'));
    database = createDatabase(join(testDirectory, 'test.sqlite'));
    seedDatabase(database);
    database
      .prepare(
        `INSERT OR IGNORE INTO matter_members (
          firm_id, matter_id, user_id, access_level, added_at
        ) VALUES (?, ?, ?, 'write', ?)`,
      )
      .run(
        SEED_IDS.northstarFirm,
        TEST_MATTER_ID,
        SEED_IDS.ava,
        FIXED_NOW.toISOString(),
      );
    database
      .prepare(
        `INSERT INTO matters (
          id, firm_id, reference, title, client_name, matter_type, status,
          stage, risk_level, owner_user_id, opened_at, description, created_by,
          created_at, updated_at
        ) VALUES (?, ?, 'ROUTE-UNASSIGNED', 'Unassigned route matter', 'Test Client',
          'Housing conditions claim', 'open', 'Enquiry', 'low', ?, '2026-07-01',
          'Tenant-scope route fixture.', ?, ?, ?)`,
      )
      .run(
        UNASSIGNED_MATTER_ID,
        SEED_IDS.northstarFirm,
        SEED_IDS.partner,
        SEED_IDS.partner,
        FIXED_NOW.toISOString(),
        FIXED_NOW.toISOString(),
      );
    new WorkflowStore(database, () => FIXED_NOW).instantiateMatterWorkflow(
      SEED_IDS.northstarFirm,
      TEST_MATTER_ID,
      SEED_IDS.ava,
    );
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

  it('returns Matter 360 to an assigned solicitor', async () => {
    const cookie = await login(app);
    const response = await app.inject({
      method: 'GET',
      url: `/api/matters/${TEST_MATTER_ID}/summary`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      matter: { id: TEST_MATTER_ID },
      workflow: { currentStageKey: 'enquiry', version: 1 },
      permissions: { canTransition: true, canOverrideWorkflow: false },
    });
    expect(response.json().workflow.stages).toHaveLength(11);
  });

  it('transitions the workflow and increments its version', async () => {
    const cookie = await login(app);
    const response = await app.inject({
      method: 'POST',
      url: `/api/matters/${TEST_MATTER_ID}/workflow/transitions`,
      headers: { cookie },
      payload: {
        toStageKey: 'assessment',
        expectedVersion: 1,
        completedChecklistKeys: [
          'initial_contact_recorded',
          'conflict_check_completed',
        ],
        reason: 'Initial enquiry is complete and ready for assessment.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().workflow).toMatchObject({
      currentStageKey: 'assessment',
      version: 2,
    });
  });

  it('returns structured readiness blockers without changing state', async () => {
    const cookie = await login(app);
    const response = await app.inject({
      method: 'POST',
      url: `/api/matters/${TEST_MATTER_ID}/workflow/transitions`,
      headers: { cookie },
      payload: {
        toStageKey: 'assessment',
        expectedVersion: 1,
        completedChecklistKeys: [],
        reason: 'Move the matter into detailed legal assessment.',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: 'READINESS_BLOCKED' },
      details: {
        blockers: [
          { key: 'initial_contact_recorded' },
          { key: 'conflict_check_completed' },
        ],
      },
    });
    expect(
      database
        .prepare(
          'SELECT version, current_stage_key AS currentStageKey FROM matter_workflows WHERE matter_id = ?',
        )
        .get(TEST_MATTER_ID),
    ).toEqual({ version: 1, currentStageKey: 'enquiry' });
  });

  it('returns CONFLICT for a stale expected version', async () => {
    const cookie = await login(app);
    const firstPayload = {
      toStageKey: 'assessment',
      expectedVersion: 1,
      completedChecklistKeys: [
        'initial_contact_recorded',
        'conflict_check_completed',
      ],
      reason: 'Initial enquiry is complete and ready for assessment.',
    };
    const first = await app.inject({
      method: 'POST',
      url: `/api/matters/${TEST_MATTER_ID}/workflow/transitions`,
      headers: { cookie },
      payload: firstPayload,
    });
    expect(first.statusCode).toBe(200);

    const stale = await app.inject({
      method: 'POST',
      url: `/api/matters/${TEST_MATTER_ID}/workflow/transitions`,
      headers: { cookie },
      payload: { ...firstPayload, toStageKey: 'onboarding' },
    });

    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('CONFLICT');
  });

  it('confirms a legal trigger and returns the 20-working-day deadline', async () => {
    const cookie = await login(app);
    const response = await app.inject({
      method: 'POST',
      url: `/api/matters/${TEST_MATTER_ID}/workflow/triggers`,
      headers: { cookie },
      payload: {
        eventType: 'letter_of_claim.received',
        occurredOn: '2026-08-03',
        idempotencyKey: 'northstar-loc-received-2026-08-03',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().deadline).toMatchObject({
      dueDate: '2026-09-01',
      status: 'pending',
    });
    expect(response.json().deadline.explanation).toContain('20 working days');
  });

  it('returns the same 404 envelope for another firm and an unassigned matter', async () => {
    const cookie = await login(app);
    const bodies = [];
    for (const matterId of [
      SEED_IDS.southbankMatter,
      UNASSIGNED_MATTER_ID,
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/matters/${matterId}/summary`,
        headers: { cookie },
      });
      expect(response.statusCode).toBe(404);
      bodies.push(response.json());
    }

    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
      },
    });
  });

  it('does not let finance transition a visible matter', async () => {
    const cookie = await login(app, 'finance@northstar.test');
    const response = await app.inject({
      method: 'POST',
      url: `/api/matters/${TEST_MATTER_ID}/workflow/transitions`,
      headers: { cookie },
      payload: {
        toStageKey: 'assessment',
        expectedVersion: 1,
        completedChecklistKeys: [
          'initial_contact_recorded',
          'conflict_check_completed',
        ],
        reason: 'Attempt to move this matter into legal assessment.',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('uses the standard validation envelope for malformed commands', async () => {
    const cookie = await login(app);
    const response = await app.inject({
      method: 'POST',
      url: `/api/matters/${TEST_MATTER_ID}/workflow/transitions`,
      headers: { cookie },
      payload: {
        toStageKey: 'Assessment',
        expectedVersion: 0,
        completedChecklistKeys: [],
        reason: 'short',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        fields: {
          toStageKey: expect.any(Array),
          expectedVersion: expect.any(Array),
          reason: expect.any(Array),
        },
      },
    });
  });
});
