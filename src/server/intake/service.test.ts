import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import { IntakeConflictService } from './conflicts.js';
import { IntakeService } from './service.js';
import { IntakeStateConflictError, IntakeStore } from './store.js';

const FIXED_NOW = new Date('2026-07-13T12:00:00.000Z');
const context = { requestId: 'request-intake-service', ipAddress: '127.0.0.1' };

function user(id: string, role: SessionUser['role']): SessionUser {
  return {
    id,
    firmId: SEED_IDS.northstarFirm,
    firmName: 'Northstar Legal',
    email: `${role}@northstar.test`,
    name: role,
    role,
  };
}

const ava = user(SEED_IDS.ava, 'solicitor');
const ben = user(SEED_IDS.ben, 'paralegal');
const partner = user(SEED_IDS.partner, 'partner');

function enquiryInput(assignedUserId = SEED_IDS.ava) {
  return {
    source: 'Website',
    referrerName: '',
    client: {
      givenName: 'Leah',
      familyName: 'Benton',
      dateOfBirth: '1988-04-09',
      email: 'leah.benton@example.test',
      phone: '07000 000 101',
      preferredChannel: 'email' as const,
    },
    property: {
      addressLine1: '42 Hazel Walk',
      addressLine2: '',
      city: 'Leeds',
      county: 'West Yorkshire',
      postcode: 'LS1 4AA',
      country: 'England' as const,
      propertyType: 'flat' as const,
    },
    landlordName: 'Civic North Homes',
    summary: 'Damp, mould and heating complaint requiring legal assessment.',
    defectSummary: 'Bedroom damp, black mould and intermittent heating.',
    desiredOutcome: 'Repairs and compensation.',
    firstComplainedOn: '2025-11-03',
    currentlyOccupied: true,
    urgency: 'priority' as const,
    immediateSafetyConcerns: '',
    communicationRequirements: '',
    assignedUserId,
  };
}

function assessment(expectedVersion: number, escalations: string[] = []) {
  return {
    expectedVersion,
    jurisdictionConfirmed: true,
    claimantRelationship: 'tenant' as const,
    noticeSummary: 'Repeated reports were made to the landlord from November 2025.',
    conditionsUnresolved: true,
    conditionStartDate: '2025-10-01',
    accessSummary: 'The client has offered access and no appointment is outstanding.',
    evidenceSummary: 'Photographs, complaint emails and repair references are available.',
    limitationReview: 'Limitation reviewed from the earliest actionable period and diarised.',
    legalIssues: ['section_11', 'fitness'] as const,
    escalations,
    meritsRating: 'reasonable' as const,
    proportionalityRating: 'reasonable' as const,
    decision: 'proceed' as const,
    decisionReason: 'The claim has reasonable merits and is proportionate to investigate.',
  };
}

function onboarding(expectedVersion: number, fundingStatus: 'pending' | 'complete') {
  return {
    expectedVersion,
    identityStatus: 'complete' as const,
    clientCareStatus: 'complete' as const,
    authorityStatus: 'complete' as const,
    privacyStatus: 'complete' as const,
    fundingType: 'cfa' as const,
    fundingStatus,
    signatureStatus: 'complete' as const,
    vulnerabilitySummary: 'Child in the household has asthma.',
    accessibilityNeeds: '',
    interpreterLanguage: null,
    safeContactInstructions: 'Email first; telephone after 4pm.',
    ownerUserId: SEED_IDS.ava,
    supervisorUserId: SEED_IDS.partner,
    tenancy: {
      tenancyType: 'assured' as const,
      startedOn: '2021-06-01',
      endedOn: null,
      rentMinor: 62_500,
      currency: 'GBP' as const,
      rentFrequency: 'monthly' as const,
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

describe('IntakeService', () => {
  let database: DatabaseSync;
  let store: IntakeStore;
  let conflicts: IntakeConflictService;
  let service: IntakeService;

  beforeEach(() => {
    database = createDatabase(':memory:');
    seedDatabase(database, { includeIntakePilot: false });
    store = new IntakeStore(database, () => FIXED_NOW);
    conflicts = new IntakeConflictService(database, store, () => FIXED_NOW);
    service = new IntakeService(database, store, () => FIXED_NOW);
  });

  afterEach(() => database.close());

  function createAndClearConflict() {
    const enquiry = store.createEnquiry(ava, enquiryInput(), context);
    const check = conflicts.runCheck(ava, enquiry.id, context);
    conflicts.recordDecision(
      ava,
      enquiry.id,
      {
        checkId: check.id,
        decision: 'clear',
        reason: 'Search completed and no conflict was identified.',
      },
      context,
    );
    return enquiry;
  }

  function createReadyEnquiry() {
    const enquiry = createAndClearConflict();
    const assessed = service.saveAssessment(
      ava,
      enquiry.id,
      assessment(enquiry.version),
      context,
    );
    const accepted = service.decideEnquiry(
      ava,
      enquiry.id,
      {
        expectedVersion: assessed.enquiry.version,
        outcome: 'accepted',
        reason: 'The approved Housing Conditions intake criteria are satisfied.',
      },
      context,
    );
    return service.saveOnboarding(
      ava,
      enquiry.id,
      onboarding(accepted.enquiry.version, 'complete'),
      context,
    );
  }

  it('projects explicit assessment and conversion blockers', () => {
    const enquiry = store.createEnquiry(ava, enquiryInput(), context);

    expect(service.getReadiness(ava, enquiry.id)).toMatchObject({
      assessment: {
        ready: false,
        blockers: expect.arrayContaining([
          expect.objectContaining({ key: 'conflict_decision', severity: 'critical' }),
          expect.objectContaining({ key: 'legal_assessment' }),
        ]),
      },
      conversion: {
        ready: false,
        blockers: expect.arrayContaining([
          expect.objectContaining({ key: 'enquiry_accepted' }),
          expect.objectContaining({ key: 'identity_status' }),
        ]),
      },
    });
  });

  it('saves a reviewed assessment and accepts only after readiness passes', () => {
    const enquiry = createAndClearConflict();
    const saved = service.saveAssessment(
      ava,
      enquiry.id,
      assessment(enquiry.version),
      context,
    );

    expect(saved.enquiry).toMatchObject({ status: 'assessment', version: 2 });
    expect(saved.assessment).toMatchObject({ decision: 'proceed', reviewedBy: { id: SEED_IDS.ava } });
    expect(saved.readiness.assessment).toMatchObject({ ready: true, blockers: [] });

    const accepted = service.decideEnquiry(
      ava,
      enquiry.id,
      {
        expectedVersion: 2,
        outcome: 'accepted',
        reason: 'The approved Housing Conditions intake criteria are satisfied.',
      },
      context,
    );
    expect(accepted.enquiry).toMatchObject({ status: 'accepted', version: 3 });
    expect(
      database
        .prepare(
          `SELECT from_status AS fromStatus, to_status AS toStatus
           FROM enquiry_status_events WHERE enquiry_id = ? ORDER BY occurred_at, rowid`,
        )
        .all(enquiry.id),
    ).toEqual([
      { fromStatus: null, toStatus: 'new' },
      { fromStatus: 'new', toStatus: 'assessment' },
      { fromStatus: 'assessment', toStatus: 'accepted' },
    ]);
  });

  it('requires partner review when an urgent escalation is present', () => {
    const enquiry = createAndClearConflict();
    const solicitorReview = service.saveAssessment(
      ava,
      enquiry.id,
      assessment(enquiry.version, ['critical_hazard']),
      context,
    );
    expect(solicitorReview.readiness.assessment.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'supervisor_review', severity: 'critical' }),
      ]),
    );

    const partnerReview = service.saveAssessment(
      partner,
      enquiry.id,
      assessment(solicitorReview.enquiry.version, ['critical_hazard']),
      context,
    );
    expect(partnerReview.assessment.reviewedBy?.id).toBe(SEED_IDS.partner);
    expect(partnerReview.readiness.assessment.ready).toBe(true);
  });

  it('preserves onboarding blockers until every control is complete', () => {
    const enquiry = createAndClearConflict();
    const assessed = service.saveAssessment(
      ava,
      enquiry.id,
      assessment(enquiry.version),
      context,
    );
    const accepted = service.decideEnquiry(
      ava,
      enquiry.id,
      {
        expectedVersion: assessed.enquiry.version,
        outcome: 'accepted',
        reason: 'The approved Housing Conditions intake criteria are satisfied.',
      },
      context,
    );
    const pending = service.saveOnboarding(
      ava,
      enquiry.id,
      onboarding(accepted.enquiry.version, 'pending'),
      context,
    );
    expect(pending.readiness.conversion).toMatchObject({
      ready: false,
      blockers: expect.arrayContaining([
        expect.objectContaining({ key: 'funding_status' }),
      ]),
    });

    const complete = service.saveOnboarding(
      ava,
      enquiry.id,
      onboarding(pending.enquiry.version, 'complete'),
      context,
    );
    expect(complete.enquiry.version).toBe(5);
    expect(complete.onboarding.householdMembers).toHaveLength(1);
    expect(complete.readiness.conversion).toEqual({ ready: true, blockers: [] });
  });

  it('rejects stale assessment writes and paralegal acceptance decisions', () => {
    const enquiry = createAndClearConflict();
    service.saveAssessment(ava, enquiry.id, assessment(enquiry.version), context);
    expect(() =>
      service.saveAssessment(
        ava,
        enquiry.id,
        assessment(enquiry.version),
        { ...context, requestId: 'request-stale-assessment' },
      ),
    ).toThrow(IntakeStateConflictError);

    database
      .prepare('UPDATE enquiries SET assigned_user_id = ? WHERE id = ?')
      .run(SEED_IDS.ben, enquiry.id);
    expect(() =>
      service.decideEnquiry(
        ben,
        enquiry.id,
        {
          expectedVersion: 2,
          outcome: 'accepted',
          reason: 'A paralegal must not make the legal acceptance decision.',
        },
        context,
      ),
    ).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('records terminal outcomes without requiring a positive merits assessment', () => {
    const enquiry = store.createEnquiry(ava, enquiryInput(), context);
    const declined = service.decideEnquiry(
      ava,
      enquiry.id,
      {
        expectedVersion: 1,
        outcome: 'declined',
        reason: 'The enquiry is outside the approved case acceptance criteria.',
      },
      context,
    );
    expect(declined.enquiry.status).toBe('declined');
    expect(() =>
      service.saveAssessment(
        ava,
        enquiry.id,
        assessment(declined.enquiry.version),
        context,
      ),
    ).toThrow(expect.objectContaining({ code: 'TERMINAL' }));
  });

  it('atomically converts a ready enquiry into a governed Evidence-stage matter', () => {
    const ready = createReadyEnquiry();
    const converted = service.convertEnquiry(
      ava,
      ready.enquiry.id,
      {
        expectedVersion: ready.enquiry.version,
        idempotencyKey: 'convert-leah-benton-001',
      },
      context,
    );

    expect(converted).toMatchObject({
      replayed: false,
      enquiry: { status: 'converted', version: 5 },
      matter: {
        reference: 'HDR-2026-0001',
        title: 'Benton v Civic North Homes',
      },
      workflow: { currentStage: { key: 'evidence' }, version: 4 },
    });
    const matterId = converted.matter.id;
    expect(
      database
        .prepare(
          `SELECT stage, matter_type AS matterType, owner_user_id AS ownerUserId,
                  external_source AS externalSource, external_id AS externalId
           FROM matters WHERE id = ?`,
        )
        .get(matterId),
    ).toEqual({
      stage: 'Evidence and notice',
      matterType: 'Housing conditions claim',
      ownerUserId: SEED_IDS.ava,
      externalSource: 'swiftclaim-intake',
      externalId: ready.enquiry.id,
    });
    expect(
      database
        .prepare(
          `SELECT user_id AS userId, access_level AS accessLevel
           FROM matter_members WHERE firm_id = ? AND matter_id = ?
           ORDER BY user_id`,
        )
        .all(SEED_IDS.northstarFirm, matterId),
    ).toEqual([
      { userId: SEED_IDS.partner, accessLevel: 'write' },
      { userId: SEED_IDS.ava, accessLevel: 'write' },
    ]);
    expect(
      database
        .prepare(
          `SELECT role, is_primary AS isPrimary
           FROM matter_participants WHERE firm_id = ? AND matter_id = ?
           ORDER BY role`,
        )
        .all(SEED_IDS.northstarFirm, matterId),
    ).toEqual([
      { role: 'claimant', isPrimary: 1 },
      { role: 'household_member', isPrimary: 0 },
      { role: 'landlord', isPrimary: 0 },
    ]);
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM housing_cases
           WHERE firm_id = ? AND matter_id = ? AND source_enquiry_id = ?`,
        )
        .get(SEED_IDS.northstarFirm, matterId, ready.enquiry.id),
    ).toEqual({ count: 1 });
    expect(
      database
        .prepare(
          `SELECT
             (SELECT matter_id FROM housing_assessments WHERE enquiry_id = ?) AS assessmentMatterId,
             (SELECT matter_id FROM onboarding_profiles WHERE enquiry_id = ?) AS onboardingMatterId,
             (SELECT matter_id FROM tenancies WHERE enquiry_id = ?) AS tenancyMatterId`,
        )
        .get(ready.enquiry.id, ready.enquiry.id, ready.enquiry.id),
    ).toEqual({
      assessmentMatterId: matterId,
      onboardingMatterId: matterId,
      tenancyMatterId: matterId,
    });
    expect(
      database
        .prepare(
          `SELECT from_stage_key AS fromStage, to_stage_key AS toStage
           FROM matter_stage_history
           WHERE firm_id = ? AND matter_id = ? ORDER BY rowid`,
        )
        .all(SEED_IDS.northstarFirm, matterId),
    ).toEqual([
      { fromStage: null, toStage: 'enquiry' },
      { fromStage: 'enquiry', toStage: 'assessment' },
      { fromStage: 'assessment', toStage: 'onboarding' },
      { fromStage: 'onboarding', toStage: 'evidence' },
    ]);
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM matter_workflow_checklist
           WHERE firm_id = ? AND matter_id = ?`,
        )
        .get(SEED_IDS.northstarFirm, matterId),
    ).toEqual({ count: 10 });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM integration_outbox
           WHERE firm_id = ? AND matter_id = ? AND topic = 'intake.converted'`,
        )
        .get(SEED_IDS.northstarFirm, matterId),
    ).toEqual({ count: 1 });
  });

  it('replays conversion idempotently without creating a second matter', () => {
    const ready = createReadyEnquiry();
    const command = {
      expectedVersion: ready.enquiry.version,
      idempotencyKey: 'convert-idempotent-001',
    };
    const first = service.convertEnquiry(ava, ready.enquiry.id, command, context);
    const replay = service.convertEnquiry(
      ava,
      ready.enquiry.id,
      command,
      { ...context, requestId: 'request-conversion-replay' },
    );

    expect(replay).toMatchObject({ replayed: true });
    expect(replay.matter.id).toBe(first.matter.id);
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM matters
           WHERE firm_id = ? AND external_source = 'swiftclaim-intake'
             AND external_id = ?`,
        )
        .get(SEED_IDS.northstarFirm, ready.enquiry.id),
    ).toEqual({ count: 1 });
  });

  it('rejects conversion when readiness, capability, or version is invalid', () => {
    const unreadyInput = enquiryInput();
    unreadyInput.client.givenName = 'Imani';
    unreadyInput.client.familyName = 'Cole';
    unreadyInput.client.email = 'imani.cole@example.test';
    unreadyInput.client.phone = '07000 000 909';
    unreadyInput.property.addressLine1 = '9 Willow Street';
    unreadyInput.property.postcode = 'M1 2AB';
    unreadyInput.landlordName = 'West Borough Housing';
    const notReady = store.createEnquiry(ava, unreadyInput, context);
    expect(() =>
      service.convertEnquiry(
        ava,
        notReady.id,
        { expectedVersion: 1, idempotencyKey: 'convert-not-ready-001' },
        context,
      ),
    ).toThrow(expect.objectContaining({ code: 'READINESS_BLOCKED' }));

    const ready = createReadyEnquiry();
    expect(() =>
      service.convertEnquiry(
        ava,
        ready.enquiry.id,
        { expectedVersion: 1, idempotencyKey: 'convert-stale-001' },
        context,
      ),
    ).toThrow(IntakeStateConflictError);
    database
      .prepare('UPDATE enquiries SET assigned_user_id = ? WHERE id = ?')
      .run(SEED_IDS.ben, ready.enquiry.id);
    expect(() =>
      service.convertEnquiry(
        ben,
        ready.enquiry.id,
        {
          expectedVersion: ready.enquiry.version,
          idempotencyKey: 'convert-paralegal-001',
        },
        context,
      ),
    ).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('rolls back every conversion write when workflow bootstrap fails', () => {
    const ready = createReadyEnquiry();
    database.prepare("UPDATE workflow_versions SET status = 'retired'").run();

    expect(() =>
      service.convertEnquiry(
        ava,
        ready.enquiry.id,
        {
          expectedVersion: ready.enquiry.version,
          idempotencyKey: 'convert-rollback-001',
        },
        context,
      ),
    ).toThrow(/No active housing conditions workflow/);
    expect(store.getEnquiry(ava, ready.enquiry.id)).toMatchObject({
      status: 'accepted',
      version: ready.enquiry.version,
    });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM matters
           WHERE firm_id = ? AND external_source = 'swiftclaim-intake'
             AND external_id = ?`,
        )
        .get(SEED_IDS.northstarFirm, ready.enquiry.id),
    ).toEqual({ count: 0 });
    expect(
      database
        .prepare(
          'SELECT COUNT(*) AS count FROM intake_conversions WHERE enquiry_id = ?',
        )
        .get(ready.enquiry.id),
    ).toEqual({ count: 0 });
  });
});
