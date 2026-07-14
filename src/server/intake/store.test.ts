import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import {
  IntakeStateConflictError,
  IntakeStore,
} from './store.js';

const FIXED_NOW = new Date('2026-07-13T12:00:00.000Z');
const context = { requestId: 'request-intake-test', ipAddress: '127.0.0.1' };

function user(
  id: string,
  role: SessionUser['role'],
  firmId: string = SEED_IDS.northstarFirm,
): SessionUser {
  return {
    id,
    firmId,
    firmName: firmId === SEED_IDS.northstarFirm ? 'Northstar Legal' : 'Southbank Law',
    email: `${role}@example.test`,
    name: role,
    role,
  };
}

const ava = user(SEED_IDS.ava, 'solicitor');
const ben = user(SEED_IDS.ben, 'paralegal');
const partner = user(SEED_IDS.partner, 'partner');
const finance = user(SEED_IDS.finance, 'finance');
const lewis = user(
  SEED_IDS.southbankUser,
  'partner',
  SEED_IDS.southbankFirm,
);

function enquiryInput(assignedUserId: string = SEED_IDS.ava) {
  return {
    source: 'Website',
    referrerName: '',
    client: {
      givenName: 'Leah',
      familyName: 'Benton',
      dateOfBirth: '1988-04-09',
      email: ' Leah.Benton@example.test ',
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
    communicationRequirements: 'Email first; telephone after 4pm.',
    assignedUserId,
  };
}

describe('IntakeStore', () => {
  let database: DatabaseSync;
  let store: IntakeStore;

  beforeEach(() => {
    database = createDatabase(':memory:');
    seedDatabase(database, { includeIntakePilot: false });
    store = new IntakeStore(database, () => FIXED_NOW);
  });

  afterEach(() => database.close());

  it('creates a normalized, audited enquiry with a server reference', () => {
    const enquiry = store.createEnquiry(ava, enquiryInput(), context);

    expect(enquiry).toMatchObject({
      reference: 'HDR-E-2026-0001',
      status: 'new',
      version: 1,
      client: {
        displayName: 'Leah Benton',
        email: 'leah.benton@example.test',
        phone: '07000 000 101',
      },
      property: {
        addressLine1: '42 Hazel Walk',
        postcode: 'LS1 4AA',
      },
      landlord: { name: 'Civic North Homes' },
      assignedTo: { id: SEED_IDS.ava },
    });
    expect(
      database
        .prepare(
          `SELECT action, entity_type AS entityType
           FROM intake_audit_events WHERE enquiry_id = ?`,
        )
        .get(enquiry.id),
    ).toEqual({ action: 'enquiry.created', entityType: 'enquiry' });
    expect(
      database
        .prepare(
          `SELECT from_status AS fromStatus, to_status AS toStatus
           FROM enquiry_status_events WHERE enquiry_id = ?`,
        )
        .get(enquiry.id),
    ).toEqual({ fromStatus: null, toStatus: 'new' });
  });

  it('reuses exact tenant-local contact, property and landlord records', () => {
    const first = store.createEnquiry(ava, enquiryInput(), context);
    const second = store.createEnquiry(
      ava,
      { ...enquiryInput(), summary: 'A second enquiry about the same household.' },
      { ...context, requestId: 'request-intake-second' },
    );

    expect(second.client.id).toBe(first.client.id);
    expect(second.property.id).toBe(first.property.id);
    expect(second.landlord?.id).toBe(first.landlord?.id);
    expect(second.reference).toBe('HDR-E-2026-0002');
    expect(database.prepare('SELECT COUNT(*) AS count FROM contacts').get()).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM properties').get()).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM organisations').get()).toEqual({ count: 1 });
  });

  it('limits solicitors and paralegals to assigned enquiries while partners see the firm', () => {
    const assignedToAva = store.createEnquiry(ava, enquiryInput(), context);
    const assignedToBen = store.createEnquiry(
      ava,
      enquiryInput(SEED_IDS.ben),
      { ...context, requestId: 'request-intake-ben' },
    );

    expect(store.listEnquiries(ava).map((item) => item.id)).toEqual([assignedToAva.id]);
    expect(store.listEnquiries(ben).map((item) => item.id)).toEqual([assignedToBen.id]);
    expect(store.listEnquiries(partner)).toHaveLength(2);
    expect(store.getEnquiry(ava, assignedToBen.id)).toBeUndefined();
    expect(store.getEnquiry(lewis, assignedToAva.id)).toBeUndefined();
  });

  it('rejects stale updates without changing the current enquiry', () => {
    const created = store.createEnquiry(ava, enquiryInput(), context);
    const updated = store.updateEnquiry(
      ava,
      created.id,
      {
        expectedVersion: 1,
        summary: 'Updated instructions after speaking with the prospective client.',
        defectSummary: created.defectSummary,
        desiredOutcome: created.desiredOutcome,
        urgency: 'urgent',
        immediateSafetyConcerns: 'Heating remains unavailable overnight.',
        communicationRequirements: created.communicationRequirements,
        assignedUserId: SEED_IDS.ava,
      },
      context,
    );
    expect(updated.version).toBe(2);

    expect(() =>
      store.updateEnquiry(
        ava,
        created.id,
        {
          expectedVersion: 1,
          summary: 'This stale write must not be applied.',
          defectSummary: created.defectSummary,
          desiredOutcome: created.desiredOutcome,
          urgency: 'routine',
          immediateSafetyConcerns: '',
          communicationRequirements: '',
          assignedUserId: SEED_IDS.ava,
        },
        { ...context, requestId: 'request-stale' },
      ),
    ).toThrow(IntakeStateConflictError);
    expect(store.getEnquiry(ava, created.id)?.summary).toBe(
      'Updated instructions after speaking with the prospective client.',
    );
  });

  it('denies prospective-client access to finance users', () => {
    expect(() => store.listEnquiries(finance)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
    expect(() => store.createEnquiry(finance, enquiryInput(), context)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });
});
