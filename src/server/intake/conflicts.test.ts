import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import { IntakeConflictService } from './conflicts.js';
import { IntakeStore } from './store.js';

const FIXED_NOW = new Date('2026-07-13T12:00:00.000Z');
const context = { requestId: 'request-conflict-test', ipAddress: '127.0.0.1' };

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

function enquiryInput(familyName = 'Benton', email = 'leah.benton@example.test') {
  return {
    source: 'Website',
    referrerName: '',
    client: {
      givenName: 'Leah',
      familyName,
      dateOfBirth: '1988-04-09',
      email,
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
    assignedUserId: SEED_IDS.ava,
  };
}

describe('IntakeConflictService', () => {
  let database: DatabaseSync;
  let store: IntakeStore;
  let service: IntakeConflictService;

  beforeEach(() => {
    database = createDatabase(':memory:');
    seedDatabase(database, { includeIntakePilot: false });
    store = new IntakeStore(database, () => FIXED_NOW);
    service = new IntakeConflictService(database, store, () => FIXED_NOW);
  });

  afterEach(() => database.close());

  it('stores same-firm matches without exposing inaccessible matter identity', () => {
    const enquiry = store.createEnquiry(ava, enquiryInput(), context);
    database
      .prepare(
        `INSERT INTO parties (
          id, firm_id, matter_id, kind, name, organisation, email, phone,
          address, created_by, created_at
        ) VALUES (?, ?, ?, 'opponent', 'Leah Benton', '',
          'leah.benton@example.test', '', '', ?, ?)`,
      )
      .run(
        '87000000-0000-4000-8000-000000000001',
        SEED_IDS.northstarFirm,
        SEED_IDS.northstarRestrictedMatter,
        SEED_IDS.partner,
        FIXED_NOW.toISOString(),
      );
    database
      .prepare(
        `INSERT INTO parties (
          id, firm_id, matter_id, kind, name, organisation, email, phone,
          address, created_by, created_at
        ) VALUES (?, ?, ?, 'opponent', 'Leah Benton', '',
          'leah.benton@example.test', '', '', ?, ?)`,
      )
      .run(
        '87000000-0000-4000-8000-000000000002',
        SEED_IDS.southbankFirm,
        SEED_IDS.southbankMatter,
        SEED_IDS.southbankUser,
        FIXED_NOW.toISOString(),
      );

    const check = service.runCheck(ava, enquiry.id, context);

    expect(check.matchCount).toBe(1);
    expect(check.matches).toEqual([
      {
        source: 'matter',
        display: 'Existing firm matter — conflict review required',
        matchedOn: ['name', 'email'],
      },
    ]);
    expect(JSON.stringify(check)).not.toContain(SEED_IDS.northstarRestrictedMatter);
    expect(JSON.stringify(check)).not.toContain(SEED_IDS.southbankMatter);
    expect(database.prepare('SELECT COUNT(*) AS count FROM conflict_checks').get()).toEqual({ count: 1 });
  });

  it('requires a human clear decision even when no matches are returned', () => {
    const enquiry = store.createEnquiry(
      ava,
      enquiryInput('NoMatch', 'unique.nomatch@example.test'),
      context,
    );
    const check = service.runCheck(ava, enquiry.id, context);

    expect(check.matchCount).toBe(0);
    const decision = service.recordDecision(
      ava,
      enquiry.id,
      {
        checkId: check.id,
        decision: 'clear',
        reason: 'Search completed and no conflict was identified.',
      },
      context,
    );
    expect(decision).toMatchObject({ decision: 'clear', decidedBy: { id: SEED_IDS.ava } });
  });

  it('requires partner authority to clear a potential match', () => {
    const enquiry = store.createEnquiry(ava, enquiryInput(), context);
    database
      .prepare(
        `INSERT INTO parties (
          id, firm_id, matter_id, kind, name, organisation, email, phone,
          address, created_by, created_at
        ) VALUES (?, ?, ?, 'opponent', 'Leah Benton', '',
          'leah.benton@example.test', '', '', ?, ?)`,
      )
      .run(
        '87000000-0000-4000-8000-000000000003',
        SEED_IDS.northstarFirm,
        SEED_IDS.northstarRestrictedMatter,
        SEED_IDS.partner,
        FIXED_NOW.toISOString(),
      );
    const check = service.runCheck(ava, enquiry.id, context);

    expect(() =>
      service.recordDecision(
        ava,
        enquiry.id,
        {
          checkId: check.id,
          decision: 'clear',
          reason: 'Attempt to clear despite a returned potential match.',
        },
        context,
      ),
    ).toThrow(expect.objectContaining({ code: 'CONFLICT_REVIEW_REQUIRED' }));
    expect(() =>
      service.recordDecision(
        ava,
        enquiry.id,
        {
          checkId: check.id,
          decision: 'cleared_with_override',
          reason: 'The matching party was reviewed and is a different person.',
        },
        context,
      ),
    ).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));

    const decision = service.recordDecision(
      partner,
      enquiry.id,
      {
        checkId: check.id,
        decision: 'cleared_with_override',
        reason: 'The matching party was reviewed and is a different person.',
      },
      context,
    );
    expect(decision.decision).toBe('cleared_with_override');
  });

  it('does not let a paralegal make the legal conflict decision', () => {
    const enquiry = store.createEnquiry(ava, enquiryInput(), context);
    database
      .prepare('UPDATE enquiries SET assigned_user_id = ? WHERE id = ?')
      .run(SEED_IDS.ben, enquiry.id);
    const check = service.runCheck(ben, enquiry.id, context);

    expect(() =>
      service.recordDecision(
        ben,
        enquiry.id,
        {
          checkId: check.id,
          decision: 'clear',
          reason: 'Search completed and no conflict was identified.',
        },
        context,
      ),
    ).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('rejects a decision against a superseded search', () => {
    const enquiry = store.createEnquiry(
      ava,
      enquiryInput('FreshCheck', 'fresh.check@example.test'),
      context,
    );
    const first = service.runCheck(ava, enquiry.id, context);
    service.runCheck(ava, enquiry.id, {
      ...context,
      requestId: 'request-second-conflict-check',
    });

    expect(() =>
      service.recordDecision(
        ava,
        enquiry.id,
        {
          checkId: first.id,
          decision: 'clear',
          reason: 'This result has been superseded by a newer search.',
        },
        context,
      ),
    ).toThrow(expect.objectContaining({ code: 'STALE_CHECK' }));
  });
});
