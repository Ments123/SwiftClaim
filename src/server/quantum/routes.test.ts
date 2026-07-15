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

const workSchedule = {
  title: 'Synthetic expert schedule of works',
  sourceType: 'solicitor_review',
  sourceDocumentVersionId: SEED_IDS.repairVersion,
  basedOnScheduleId: null,
  items: [
    {
      lineageKey: 'bedroom-damp-treatment',
      area: 'Bedroom',
      description: 'Treat the damp source and reinstate affected finishes.',
      responsibilityPosition: 'agreed',
      priority: 'urgent',
      targetStartOn: '2026-07-18',
      targetCompletionOn: '2026-07-25',
      estimatedCostMinor: 125_000,
      contractor: 'Synthetic Repairs Ltd',
      sourceNote: 'Prepared from retained synthetic material.',
      defectIds: [SEED_IDS.bedroomDampDefect],
      evidenceItemIds: [SEED_IDS.repairEvidence],
    },
  ],
};

describe('repairs and quantum routes', () => {
  let app: FastifyInstance;
  let database: DatabaseSync;
  let testDirectory: string;

  beforeEach(async () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'swiftclaim-quantum-api-'));
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

  it('serves the ordinary workspace while preserving tenant and capability boundaries', async () => {
    const avaCookie = await login(app, 'ava@northstar.test');
    const workspace = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/repairs-quantum`,
      headers: { cookie: avaCookie },
    });
    expect(workspace.statusCode).toBe(200);
    expect(workspace.json()).toMatchObject({
      matterId: SEED_IDS.northstarMatter,
      permissions: { canWrite: true, canReadProtectedOffers: true },
      openOffers: [],
    });

    const financeCookie = await login(app, 'finance@northstar.test');
    const forbidden = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/repairs-quantum`,
      headers: { cookie: financeCookie },
    });
    expect(forbidden.statusCode).toBe(403);

    const lewisCookie = await login(app, 'lewis@southbank.test');
    const hidden = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/repairs-quantum`,
      headers: { cookie: lewisCookie },
    });
    expect(hidden.statusCode).toBe(404);
  });

  it('validates, creates and partner-approves a schedule of works', async () => {
    const avaCookie = await login(app, 'ava@northstar.test');
    const invalid = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/work-schedules`,
      headers: { cookie: avaCookie },
      payload: { ...workSchedule, items: [] },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toMatchObject({ error: { code: 'QUANTUM_INVALID' } });

    const created = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/work-schedules`,
      headers: { cookie: avaCookie, 'x-request-id': 'route-create-work' },
      payload: workSchedule,
    });
    expect(created.statusCode).toBe(201);
    const scheduleId = created.json().schedule.id as string;

    const benCookie = await login(app, 'ben@northstar.test');
    const denied = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/work-schedules/${scheduleId}/approve`,
      headers: { cookie: benCookie },
      payload: {
        expectedVersion: 1,
        idempotencyKey: 'route-work-approve-ben',
        approvalNote: 'Paralegal approval must be denied by capability.',
        acknowledgedWarningKeys: ['urgent_outstanding'],
      },
    });
    expect(denied.statusCode).toBe(403);

    const partnerCookie = await login(app, 'partner@northstar.test');
    const approved = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/work-schedules/${scheduleId}/approve`,
      headers: { cookie: partnerCookie },
      payload: {
        expectedVersion: 1,
        idempotencyKey: 'route-work-approve-partner',
        approvalNote: 'Partner reviewed the source and urgent warning.',
        acknowledgedWarningKeys: ['urgent_outstanding'],
      },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().schedule.status).toBe('approved');
  });

  it('fetches protected offers only through the explicit protected endpoint', async () => {
    const avaCookie = await login(app, 'ava@northstar.test');
    const created = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/offers`,
      headers: { cookie: avaCookie },
      payload: {
        idempotencyKey: 'route-protected-offer-001',
        direction: 'defendant',
        offerType: 'part_36',
        confidentiality: 'protected_costs',
        scope: 'whole_claim',
        scopeDescription: 'All damages in the synthetic claim.',
        damagesMinor: 450_000,
        costsMinor: null,
        totalMinor: null,
        currency: 'GBP',
        worksTerms: 'Complete the agreed works within 28 days.',
        nonMoneyTerms: '',
        interestTreatment: 'Inclusive of interest to the relevant date.',
        writtenOfferDocumentVersionId: SEED_IDS.complaintVersion,
        madeOn: '2026-07-15',
        part36: {
          relevantPeriodDays: 21,
          relevantPeriodBasis: 'Reviewable CPR Part 36 calendar-day projection.',
          includesCounterclaim: false,
          paymentPeriodDays: 14,
        },
      },
    });
    expect(created.statusCode).toBe(201);

    const ordinary = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/repairs-quantum`,
      headers: { cookie: avaCookie },
    });
    expect(ordinary.body).not.toContain('450000');
    expect(ordinary.json().protectedOfferCount).toBe(1);

    const protectedResponse = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/offers/protected`,
      headers: { cookie: avaCookie },
    });
    expect(protectedResponse.statusCode).toBe(200);
    expect(protectedResponse.json().offers).toEqual([
      expect.objectContaining({ damagesMinor: 450_000 }),
    ]);

    const benCookie = await login(app, 'ben@northstar.test');
    const denied = await app.inject({
      method: 'GET',
      url: `/api/matters/${SEED_IDS.northstarMatter}/offers/protected`,
      headers: { cookie: benCookie },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('recalculates a version-controlled draft loss item update on the server', async () => {
    const avaCookie = await login(app, 'ava@northstar.test');
    const createdSchedule = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/loss-schedules`,
      headers: { cookie: avaCookie },
      payload: {
        title: 'Synthetic editable schedule of loss',
        valuationOn: '2026-07-15',
        currency: 'GBP',
        basedOnScheduleId: null,
        notes: 'A draft schedule for route verification.',
      },
    });
    const scheduleId = createdSchedule.json().schedule.id as string;
    const createdItem = await app.inject({
      method: 'POST',
      url: `/api/matters/${SEED_IDS.northstarMatter}/loss-schedules/${scheduleId}/items`,
      headers: { cookie: avaCookie },
      payload: {
        expectedVersion: 1,
        lineageKey: 'heating-editable',
        category: 'additional_heating',
        description: 'Synthetic additional heating expense.',
        periodStartOn: null,
        periodEndOn: null,
        calculationType: 'fixed',
        quantity: null,
        unitLabel: '',
        rateMinor: null,
        fixedAmountMinor: 5_000,
        manualAmountMinor: null,
        manualBasis: '',
        position: 'claimed',
        evidenceStatus: 'partial',
        sourceNote: 'Initial synthetic client figure.',
        evidenceItemIds: [SEED_IDS.repairEvidence],
      },
    });
    expect(createdItem.statusCode).toBe(201);
    const itemId = createdItem.json().schedule.items[0].id as string;
    const updatePayload = {
      expectedVersion: 2,
      lineageKey: 'heating-editable',
      category: 'additional_heating',
      description: 'Synthetic additional heating expense after source review.',
      periodStartOn: '2026-01-01',
      periodEndOn: '2026-03-31',
      calculationType: 'quantity_rate',
      quantity: '12.5',
      unitLabel: 'weeks',
      rateMinor: 425,
      fixedAmountMinor: null,
      manualAmountMinor: null,
      manualBasis: '',
      position: 'claimed',
      evidenceStatus: 'partial',
      sourceNote: 'Updated against the retained synthetic attendance record.',
      evidenceItemIds: [SEED_IDS.repairEvidence],
    };
    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/matters/${SEED_IDS.northstarMatter}/loss-schedules/${scheduleId}/items/${itemId}`,
      headers: { cookie: avaCookie },
      payload: updatePayload,
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().schedule).toMatchObject({
      recordVersion: 3,
      items: [{ calculatedAmountMinor: 5_313, calculation: '12.5 weeks × £4.25 = £53.13' }],
    });

    const stale = await app.inject({
      method: 'PATCH',
      url: `/api/matters/${SEED_IDS.northstarMatter}/loss-schedules/${scheduleId}/items/${itemId}`,
      headers: { cookie: avaCookie },
      payload: updatePayload,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: 'CONFLICT' } });
  });
});
