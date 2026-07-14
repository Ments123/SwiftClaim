import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import { IntakeStore } from './store.js';

const FIXED_NOW = new Date('2026-07-13T12:00:00.000Z');

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

function enquiryInput(assignedUserId: string = SEED_IDS.ava) {
  return {
    source: 'Website',
    referrerName: '',
    client: {
      givenName: 'Leah',
      familyName: 'Benton',
      dateOfBirth: '1988-04-09',
      email: 'leah.benton@example.test',
      phone: '07000 000 101',
      preferredChannel: 'email',
    },
    property: {
      addressLine1: '42 Hazel Walk',
      addressLine2: '',
      city: 'Leeds',
      county: 'West Yorkshire',
      postcode: 'LS1 4AA',
      country: 'England',
      propertyType: 'flat',
    },
    landlordName: 'Civic North Homes',
    summary: 'Damp, mould and heating complaint requiring legal assessment.',
    defectSummary: 'Bedroom damp, black mould and intermittent heating.',
    desiredOutcome: 'Repairs and compensation.',
    firstComplainedOn: '2025-11-03',
    currentlyOccupied: true,
    urgency: 'priority',
    immediateSafetyConcerns: '',
    communicationRequirements: '',
    assignedUserId,
  };
}

function assessment(expectedVersion: number) {
  return {
    expectedVersion,
    jurisdictionConfirmed: true,
    claimantRelationship: 'tenant',
    noticeSummary: 'Repeated reports were made to the landlord from November 2025.',
    conditionsUnresolved: true,
    conditionStartDate: '2025-10-01',
    accessSummary: 'The client has offered access and no appointment is outstanding.',
    evidenceSummary: 'Photographs, complaint emails and repair references are available.',
    limitationReview: 'Limitation reviewed from the earliest actionable period and diarised.',
    legalIssues: ['section_11', 'fitness'],
    escalations: [],
    meritsRating: 'reasonable',
    proportionalityRating: 'reasonable',
    decision: 'proceed',
    decisionReason: 'The claim has reasonable merits and is proportionate to investigate.',
  };
}

function onboarding(expectedVersion: number) {
  return {
    expectedVersion,
    identityStatus: 'complete',
    clientCareStatus: 'complete',
    authorityStatus: 'complete',
    privacyStatus: 'complete',
    fundingType: 'cfa',
    fundingStatus: 'complete',
    signatureStatus: 'complete',
    vulnerabilitySummary: 'Child in the household has asthma.',
    accessibilityNeeds: '',
    interpreterLanguage: null,
    safeContactInstructions: 'Email first; telephone after 4pm.',
    ownerUserId: SEED_IDS.ava,
    supervisorUserId: SEED_IDS.partner,
    tenancy: {
      tenancyType: 'assured',
      startedOn: '2021-06-01',
      endedOn: null,
      rentMinor: 62_500,
      currency: 'GBP',
      rentFrequency: 'monthly',
      occupancyStartedOn: '2021-06-01',
      occupancyEndedOn: null,
    },
    householdMembers: [
      {
        displayName: 'Noah Benton',
        relationship: 'Child',
        currentlyOccupies: true,
        claimParticipant: false,
        vulnerabilitySummary: 'Asthma aggravated by damp conditions.',
        accessibilityNeeds: '',
      },
    ],
  };
}

describe('intake routes', () => {
  let app: FastifyInstance;
  let database: DatabaseSync;
  let testDirectory: string;

  beforeEach(async () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'swiftclaim-intake-api-'));
    mkdirSync(join(testDirectory, 'storage'));
    database = createDatabase(join(testDirectory, 'test.sqlite'));
    seedDatabase(database, { includeIntakePilot: false });
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

  async function createEnquiry(cookie: string, input = enquiryInput()) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/enquiries',
      headers: { cookie },
      payload: input,
    });
    expect(response.statusCode).toBe(201);
    return response.json().enquiry as { id: string; version: number };
  }

  async function completeIntake(cookie: string) {
    let enquiry = await createEnquiry(cookie);
    const check = await app.inject({
      method: 'POST',
      url: `/api/enquiries/${enquiry.id}/conflict-checks`,
      headers: { cookie },
      payload: {},
    });
    expect(check.statusCode).toBe(201);
    const decision = await app.inject({
      method: 'POST',
      url: `/api/enquiries/${enquiry.id}/conflict-decisions`,
      headers: { cookie },
      payload: {
        checkId: check.json().check.id,
        decision: 'clear',
        reason: 'Search completed and no conflict was identified.',
      },
    });
    expect(decision.statusCode).toBe(201);
    const assessed = await app.inject({
      method: 'PUT',
      url: `/api/enquiries/${enquiry.id}/assessment`,
      headers: { cookie },
      payload: assessment(enquiry.version),
    });
    expect(assessed.statusCode).toBe(200);
    enquiry = assessed.json().enquiry;
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/enquiries/${enquiry.id}/decisions`,
      headers: { cookie },
      payload: {
        expectedVersion: enquiry.version,
        outcome: 'accepted',
        reason: 'The approved Housing Conditions intake criteria are satisfied.',
      },
    });
    expect(accepted.statusCode).toBe(200);
    enquiry = accepted.json().enquiry;
    const onboarded = await app.inject({
      method: 'PUT',
      url: `/api/enquiries/${enquiry.id}/onboarding`,
      headers: { cookie },
      payload: onboarding(enquiry.version),
    });
    expect(onboarded.statusCode).toBe(200);
    return onboarded.json().enquiry as { id: string; version: number };
  }

  it('runs the complete intake journey and exposes the converted matter profile', async () => {
    const cookie = await login(app);
    let enquiry = await createEnquiry(cookie);
    const listed = await app.inject({
      method: 'GET',
      url: '/api/enquiries',
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().enquiries).toEqual([
      expect.objectContaining({ id: enquiry.id, reference: 'HDR-E-2026-0001' }),
    ]);
    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/enquiries/${enquiry.id}`,
      headers: { cookie },
      payload: {
        expectedVersion: enquiry.version,
        summary: 'Damp, mould, heating and a leaking window require legal assessment.',
        defectSummary: 'Bedroom damp, black mould, leaking window and intermittent heating.',
        desiredOutcome: 'Repairs and compensation.',
        urgency: 'priority',
        immediateSafetyConcerns: '',
        communicationRequirements: '',
        assignedUserId: SEED_IDS.ava,
      },
    });
    expect(updated.statusCode).toBe(200);
    enquiry = updated.json().enquiry;

    const check = await app.inject({
      method: 'POST',
      url: `/api/enquiries/${enquiry.id}/conflict-checks`,
      headers: { cookie },
      payload: {},
    });
    const conflictDecision = await app.inject({
      method: 'POST',
      url: `/api/enquiries/${enquiry.id}/conflict-decisions`,
      headers: { cookie },
      payload: {
        checkId: check.json().check.id,
        decision: 'clear',
        reason: 'Search completed and no conflict was identified.',
      },
    });
    expect(conflictDecision.statusCode).toBe(201);
    const assessed = await app.inject({
      method: 'PUT',
      url: `/api/enquiries/${enquiry.id}/assessment`,
      headers: { cookie },
      payload: assessment(enquiry.version),
    });
    enquiry = assessed.json().enquiry;
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/enquiries/${enquiry.id}/decisions`,
      headers: { cookie },
      payload: {
        expectedVersion: enquiry.version,
        outcome: 'accepted',
        reason: 'The approved Housing Conditions intake criteria are satisfied.',
      },
    });
    enquiry = accepted.json().enquiry;
    const onboarded = await app.inject({
      method: 'PUT',
      url: `/api/enquiries/${enquiry.id}/onboarding`,
      headers: { cookie },
      payload: onboarding(enquiry.version),
    });
    enquiry = onboarded.json().enquiry;
    expect(onboarded.json().readiness.conversion).toEqual({
      ready: true,
      blockers: [],
    });

    const command = {
      expectedVersion: enquiry.version,
      idempotencyKey: 'route-convert-leah-001',
    };
    const converted = await app.inject({
      method: 'POST',
      url: `/api/enquiries/${enquiry.id}/convert`,
      headers: { cookie },
      payload: command,
    });
    expect(converted.statusCode).toBe(201);
    expect(converted.json()).toMatchObject({
      replayed: false,
      enquiry: { status: 'converted' },
      workflow: { currentStage: { key: 'evidence' } },
    });
    const replay = await app.inject({
      method: 'POST',
      url: `/api/enquiries/${enquiry.id}/convert`,
      headers: { cookie },
      payload: command,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      replayed: true,
      matter: { id: converted.json().matter.id },
    });

    const workspace = await app.inject({
      method: 'GET',
      url: `/api/enquiries/${enquiry.id}`,
      headers: { cookie },
    });
    expect(workspace.statusCode).toBe(200);
    expect(workspace.json()).toMatchObject({
      enquiry: { id: enquiry.id, status: 'converted' },
      conflict: { latestDecision: { decision: 'clear' } },
      assessment: { decision: 'proceed' },
      onboarding: { identityStatus: 'complete' },
      conversion: { matter: { id: converted.json().matter.id } },
    });

    const profile = await app.inject({
      method: 'GET',
      url: `/api/matters/${converted.json().matter.id}/intake-profile`,
      headers: { cookie },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().profile).toMatchObject({
      enquiryId: enquiry.id,
      client: { displayName: 'Leah Benton' },
      property: { postcode: 'LS1 4AA' },
      landlord: { name: 'Civic North Homes' },
      tenancy: { tenancyType: 'assured', rentMinor: 62_500 },
      householdMembers: [{ displayName: 'Noah Benton' }],
    });
  });

  it('returns the same 404 envelope for cross-firm and unassigned enquiries', async () => {
    const cookie = await login(app);
    const unassigned = await createEnquiry(cookie, enquiryInput(SEED_IDS.ben));
    const southbankUser: SessionUser = {
      id: SEED_IDS.southbankUser,
      firmId: SEED_IDS.southbankFirm,
      firmName: 'Southbank Law',
      email: 'lewis@southbank.test',
      name: 'Lewis Grant',
      role: 'partner',
    };
    const southbankInput = enquiryInput(SEED_IDS.southbankUser);
    southbankInput.client.givenName = 'Amara';
    southbankInput.client.familyName = 'Jones';
    southbankInput.client.email = 'amara.jones@example.test';
    southbankInput.property.addressLine1 = '7 South Bank';
    southbankInput.property.postcode = 'SE1 1AA';
    southbankInput.landlordName = 'Thames Homes';
    const crossFirm = new IntakeStore(database, () => FIXED_NOW).createEnquiry(
      southbankUser,
      southbankInput as never,
      { requestId: 'cross-firm-fixture', ipAddress: '127.0.0.1' },
    );

    const bodies = [];
    for (const id of [unassigned.id, crossFirm.id]) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/enquiries/${id}`,
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

  it('denies finance access to prospective-client intake', async () => {
    const cookie = await login(app, 'finance@northstar.test');
    const response = await app.inject({
      method: 'GET',
      url: '/api/enquiries',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('returns CONFLICT for stale enquiry updates', async () => {
    const cookie = await login(app);
    const enquiry = await createEnquiry(cookie);
    const payload = {
      expectedVersion: enquiry.version,
      summary: 'A sufficiently detailed first enquiry update for the legal team.',
      defectSummary: 'Damp, mould and defective heating remain unresolved.',
      desiredOutcome: 'Repairs and compensation.',
      urgency: 'priority',
      immediateSafetyConcerns: '',
      communicationRequirements: '',
      assignedUserId: SEED_IDS.ava,
    };
    const first = await app.inject({
      method: 'PATCH',
      url: `/api/enquiries/${enquiry.id}`,
      headers: { cookie },
      payload,
    });
    expect(first.statusCode).toBe(200);
    const stale = await app.inject({
      method: 'PATCH',
      url: `/api/enquiries/${enquiry.id}`,
      headers: { cookie },
      payload,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: 'CONFLICT' } });
  });

  it('returns explicit blockers when conversion is not ready', async () => {
    const cookie = await login(app);
    const enquiry = await createEnquiry(cookie);
    const response = await app.inject({
      method: 'POST',
      url: `/api/enquiries/${enquiry.id}/convert`,
      headers: { cookie },
      payload: {
        expectedVersion: enquiry.version,
        idempotencyKey: 'route-not-ready-001',
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: 'READINESS_BLOCKED' },
      details: { blockers: expect.any(Array) },
    });
  });

  it('uses the standard validation envelope for malformed intake commands', async () => {
    const cookie = await login(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/enquiries',
      headers: { cookie },
      payload: { source: 'x', client: {} },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        fields: {
          source: expect.any(Array),
          'client.givenName': expect.any(Array),
          property: expect.any(Array),
        },
      },
    });
  });

  it('rejects accepting an enquiry before the legal assessment is ready', async () => {
    const cookie = await login(app);
    const enquiry = await createEnquiry(cookie);
    const response = await app.inject({
      method: 'POST',
      url: `/api/enquiries/${enquiry.id}/decisions`,
      headers: { cookie },
      payload: {
        expectedVersion: enquiry.version,
        outcome: 'accepted',
        reason: 'Attempt to accept before required legal controls are complete.',
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: 'READINESS_BLOCKED' },
      details: { blockers: expect.any(Array) },
    });
  });

  it('supports the concise happy-path helper used by route consumers', async () => {
    const cookie = await login(app);
    const enquiry = await completeIntake(cookie);
    expect(enquiry.version).toBe(4);
  });
});
