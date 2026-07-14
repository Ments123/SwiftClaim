import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from './database.js';
import { IntakeService } from './intake/service.js';
import { IntakeStore } from './intake/store.js';
import { EvidenceStore } from './evidence/store.js';
import type { SessionUser } from './policy.js';
import { MatterStore } from './store.js';
import { calculateDeadline } from './workflow/calendar.js';
import {
  ENGLAND_WALES_2026_CALENDAR,
  HOUSING_DISREPAIR_WORKFLOW,
} from './workflow/definitions.js';
import { WorkflowService } from './workflow/service.js';
import { WorkflowStore } from './workflow/store.js';
import {
  createAccessEventSchema,
  createDefectSchema,
  createEvidenceItemSchema,
  createNoticeSchema,
  updateDefectSchema,
} from '../shared/contracts.js';

const FIXED_NOW = new Date('2026-07-15T09:00:00.000Z');

const ava: SessionUser = {
  id: SEED_IDS.ava,
  firmId: SEED_IDS.northstarFirm,
  firmName: 'Northstar Legal',
  email: 'ava@northstar.test',
  name: 'Ava Morgan',
  role: 'solicitor',
};

describe('canonical database', () => {
  let database: DatabaseSync | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  it('creates the tenant-owned tables and enforces foreign keys', () => {
    database = createDatabase(':memory:');
    const tableNames = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String(row.name));

    expect(tableNames).toEqual(
      expect.arrayContaining([
        'firms',
        'users',
        'sessions',
        'matters',
        'matter_members',
        'parties',
        'tasks',
        'documents',
        'document_versions',
        'timeline_events',
        'audit_events',
        'workflow_templates',
        'workflow_versions',
        'matter_workflows',
        'domain_events',
        'matter_deadlines',
        'deadline_status_events',
        'integration_outbox',
        'contacts',
        'organisations',
        'properties',
        'enquiries',
        'enquiry_status_events',
        'conflict_checks',
        'conflict_decisions',
        'housing_assessments',
        'onboarding_profiles',
        'household_members',
        'tenancies',
        'matter_participants',
        'housing_cases',
        'intake_conversions',
        'intake_audit_events',
        'reference_sequences',
        'defects',
        'defect_status_events',
        'notices',
        'access_events',
        'evidence_items',
        'defect_evidence_links',
        'notice_evidence_links',
        'access_evidence_links',
      ]),
    );
    expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({
      foreign_keys: 1,
    });
  });

  it('records the ordered schema as checksummed migrations', () => {
    database = createDatabase(':memory:');

    expect(
      database
        .prepare(
          `SELECT version, name, length(checksum) AS checksumLength
           FROM schema_migrations ORDER BY version`,
        )
        .all(),
    ).toEqual([
      {
        version: 1,
        name: 'secure matter spine',
        checksumLength: 64,
      },
      {
        version: 2,
        name: 'workflow foundation',
        checksumLength: 64,
      },
      {
        version: 3,
        name: 'intake and onboarding',
        checksumLength: 64,
      },
      {
        version: 4,
        name: 'defects notice and evidence',
        checksumLength: 64,
      },
    ]);
  });

  it('enforces evidence versions, tenant links and append-only records', () => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    const now = '2026-07-15T09:00:00.000Z';
    const defectId = 'd1000000-0000-4000-8000-000000000001';
    const noticeId = 'd2000000-0000-4000-8000-000000000001';

    expect(() =>
      database?.prepare(
        `INSERT INTO defects (
          id, firm_id, matter_id, version, location, category, title,
          description, severity, status, first_observed_on, health_impact,
          hazard_tags_json, created_by, created_at, updated_by, updated_at
        ) VALUES (?, ?, ?, 0, 'Bedroom', 'damp_mould', 'Bedroom mould',
          'Mould is visible around the bedroom window.', 'serious', 'open',
          NULL, '', '[]', ?, ?, ?, ?)`,
      ).run(
        defectId,
        SEED_IDS.northstarFirm,
        SEED_IDS.northstarMatter,
        SEED_IDS.ava,
        now,
        SEED_IDS.ava,
        now,
      ),
    ).toThrow(/CHECK constraint failed/);

    database
      .prepare(
        `INSERT INTO defects (
          id, firm_id, matter_id, version, location, category, title,
          description, severity, status, first_observed_on, health_impact,
          hazard_tags_json, created_by, created_at, updated_by, updated_at
        ) VALUES (?, ?, ?, 1, 'Bedroom', 'damp_mould', 'Bedroom mould',
          'Mould is visible around the bedroom window.', 'serious', 'open',
          NULL, '', '[]', ?, ?, ?, ?)`,
      )
      .run(
        defectId,
        SEED_IDS.northstarFirm,
        SEED_IDS.northstarMatter,
        SEED_IDS.ava,
        now,
        SEED_IDS.ava,
        now,
      );
    database
      .prepare(
        `INSERT INTO notices (
          id, firm_id, matter_id, occurred_at, channel, recipient_type,
          recipient_name, summary, proof_status, response_status,
          response_summary, supersedes_notice_id, idempotency_key,
          command_payload_json, created_by, created_at
        ) VALUES (?, ?, ?, ?, 'email', 'landlord', 'Meridian Housing',
          'Reported bedroom mould and asked for an inspection.', 'linked',
          'acknowledged', 'Landlord acknowledged receipt.', NULL,
          'notice-test-001', '{}', ?, ?)`,
      )
      .run(
        noticeId,
        SEED_IDS.northstarFirm,
        SEED_IDS.northstarMatter,
        now,
        SEED_IDS.ava,
        now,
      );

    expect(() =>
      database?.exec(`UPDATE notices SET summary = 'Rewritten'`),
    ).toThrow(/append-only/);
    expect(() => database?.exec('DELETE FROM notices')).toThrow(/append-only/);

    expect(() =>
      database?.prepare(
        `INSERT INTO notice_evidence_links (
          firm_id, matter_id, evidence_item_id, notice_id, linked_by, linked_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        SEED_IDS.northstarFirm,
        SEED_IDS.northstarRestrictedMatter,
        'd3000000-0000-4000-8000-000000000001',
        noticeId,
        SEED_IDS.ava,
        now,
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('rejects ambiguous evidence command payloads at the contract boundary', () => {
    expect(
      createDefectSchema.safeParse({
        location: 'B',
        category: 'damp_mould',
        title: 'No',
        description: 'Too short',
        severity: 'urgent',
        firstObservedOn: '15/07/2026',
      }).success,
    ).toBe(false);
    expect(
      updateDefectSchema.safeParse({
        location: 'Bedroom',
        category: 'damp_mould',
        title: 'Bedroom mould',
        description: 'Visible mould around the bedroom window.',
        severity: 'serious',
        firstObservedOn: null,
        expectedVersion: 0,
        status: 'open',
        statusReason: 'short',
      }).success,
    ).toBe(false);
    expect(createNoticeSchema.safeParse({ idempotencyKey: 'short' }).success).toBe(
      false,
    );
    expect(
      createAccessEventSchema.safeParse({
        idempotencyKey: 'access-test-001',
        eventType: 'invented',
      }).success,
    ).toBe(false);
    expect(
      createEvidenceItemSchema.safeParse({
        idempotencyKey: 'evidence-test-001',
        kind: 'photograph',
        title: 'Bedroom mould photograph',
        description: 'Synthetic evaluation evidence.',
        occurredOn: '2026-07-01',
        provenanceSource: 'client',
        provenanceDetail: 'Received from the client by email.',
        documentVersionId: 'd4000000-0000-4000-8000-000000000001',
        defectIds: [],
        noticeIds: [],
        accessEventIds: [],
      }).success,
    ).toBe(false);
    expect(
      createEvidenceItemSchema.safeParse({
        idempotencyKey: 'evidence-test-002',
        kind: 'photograph',
        title: 'Bedroom mould photograph',
        description: 'Synthetic evaluation evidence.',
        occurredOn: '2026-07-01',
        provenanceSource: 'client',
        provenanceDetail: 'Received from the client by email.',
        documentVersionId: 'd4000000-0000-4000-8000-000000000001',
        defectIds: [
          'd1000000-0000-4000-8000-000000000001',
          'd1000000-0000-4000-8000-000000000001',
        ],
        noticeIds: [],
        accessEventIds: [],
      }).success,
    ).toBe(false);
  });

  it('enforces intake tenant boundaries and immutable decision history', () => {
    database = createDatabase(':memory:');
    seedDatabase(database, { includeIntakePilot: false });
    const createdAt = '2026-07-13T12:00:00.000Z';

    database
      .prepare(
        `INSERT INTO contacts (
          id, firm_id, given_name, family_name, display_name, email, phone,
          preferred_channel, normalized_name, normalized_email,
          normalized_phone, created_by, created_at, updated_at
        ) VALUES (?, ?, 'Leah', 'Benton', 'Leah Benton', 'leah@example.test',
          '07000000001', 'email', 'leah benton', 'leah@example.test',
          '07000000001', ?, ?, ?)`,
      )
      .run(
        '81000000-0000-4000-8000-000000000001',
        SEED_IDS.northstarFirm,
        SEED_IDS.ava,
        createdAt,
        createdAt,
      );
    database
      .prepare(
        `INSERT INTO contacts (
          id, firm_id, given_name, family_name, display_name, email, phone,
          preferred_channel, normalized_name, normalized_email,
          normalized_phone, created_by, created_at, updated_at
        ) VALUES (?, ?, 'Other', 'Tenant', 'Other Tenant', '', '', 'email',
          'other tenant', NULL, NULL, ?, ?, ?)`,
      )
      .run(
        '81000000-0000-4000-8000-000000000002',
        SEED_IDS.southbankFirm,
        SEED_IDS.southbankUser,
        createdAt,
        createdAt,
      );
    database
      .prepare(
        `INSERT INTO organisations (
          id, firm_id, name, kind, normalized_name, created_by,
          created_at, updated_at
        ) VALUES (?, ?, 'Civic North Homes', 'landlord',
          'civic north homes', ?, ?, ?)`,
      )
      .run(
        '82000000-0000-4000-8000-000000000001',
        SEED_IDS.northstarFirm,
        SEED_IDS.ava,
        createdAt,
        createdAt,
      );
    database
      .prepare(
        `INSERT INTO properties (
          id, firm_id, address_line_1, city, postcode, country,
          property_type, normalized_address, created_by, created_at, updated_at
        ) VALUES (?, ?, '42 Hazel Walk', 'Leeds', 'LS1 4AA', 'England',
          'flat', '42 hazel walk leeds ls1 4aa', ?, ?, ?)`,
      )
      .run(
        '83000000-0000-4000-8000-000000000001',
        SEED_IDS.northstarFirm,
        SEED_IDS.ava,
        createdAt,
        createdAt,
      );

    const enquirySql = `INSERT INTO enquiries (
      id, firm_id, reference, status, source, prospective_contact_id,
      property_id, landlord_organisation_id, assigned_user_id, summary,
      defect_summary, currently_occupied, urgency, created_by, created_at,
      updated_at
    ) VALUES (?, ?, ?, 'assessment', 'Website', ?, ?, ?, ?, ?, ?, 1,
      'priority', ?, ?, ?)`;
    database
      .prepare(enquirySql)
      .run(
        '84000000-0000-4000-8000-000000000001',
        SEED_IDS.northstarFirm,
        'HDR-E-2026-0001',
        '81000000-0000-4000-8000-000000000001',
        '83000000-0000-4000-8000-000000000001',
        '82000000-0000-4000-8000-000000000001',
        SEED_IDS.ava,
        'Damp, mould and heating complaint requiring assessment.',
        'Bedroom damp and intermittent heating.',
        SEED_IDS.ava,
        createdAt,
        createdAt,
      );

    expect(() =>
      database?.prepare(enquirySql).run(
        '84000000-0000-4000-8000-000000000002',
        SEED_IDS.northstarFirm,
        'HDR-E-2026-0002',
        '81000000-0000-4000-8000-000000000002',
        '83000000-0000-4000-8000-000000000001',
        '82000000-0000-4000-8000-000000000001',
        SEED_IDS.ava,
        'Cross-tenant prospective contact must never attach.',
        'Fixture intended to fail its composite foreign key.',
        SEED_IDS.ava,
        createdAt,
        createdAt,
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);

    database
      .prepare(
        `INSERT INTO conflict_checks (
          id, firm_id, enquiry_id, query_json, results_json, match_count,
          run_by, run_at
        ) VALUES (?, ?, ?, '{}', '[]', 0, ?, ?)`,
      )
      .run(
        '85000000-0000-4000-8000-000000000001',
        SEED_IDS.northstarFirm,
        '84000000-0000-4000-8000-000000000001',
        SEED_IDS.ava,
        createdAt,
      );
    database
      .prepare(
        `INSERT INTO conflict_decisions (
          id, firm_id, enquiry_id, conflict_check_id, decision, reason,
          decided_by, decided_at
        ) VALUES (?, ?, ?, ?, 'clear', 'No conflict identified after review.',
          ?, ?)`,
      )
      .run(
        '86000000-0000-4000-8000-000000000001',
        SEED_IDS.northstarFirm,
        '84000000-0000-4000-8000-000000000001',
        '85000000-0000-4000-8000-000000000001',
        SEED_IDS.ava,
        createdAt,
      );

    expect(() =>
      database?.exec(
        "UPDATE conflict_decisions SET reason = 'Changed' WHERE id = '86000000-0000-4000-8000-000000000001'",
      ),
    ).toThrow(/append-only/);
    expect(() =>
      database?.exec(
        "DELETE FROM conflict_checks WHERE id = '85000000-0000-4000-8000-000000000001'",
      ),
    ).toThrow(/append-only/);
  });

  it('makes audit rows append-only at the database layer', () => {
    database = createDatabase(':memory:');
    seedDatabase(database);

    database
      .prepare(
        `INSERT INTO audit_events (
          id, firm_id, matter_id, user_id, action, entity_type, entity_id,
          before_json, after_json, request_id, ip_address, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      )
      .run(
        'a0000000-0000-4000-8000-000000000001',
        SEED_IDS.northstarFirm,
        SEED_IDS.northstarMatter,
        SEED_IDS.ava,
        'matter.viewed',
        'matter',
        SEED_IDS.northstarMatter,
        '{}',
        'request-test',
        '127.0.0.1',
        '2026-07-13T12:00:00.000Z',
      );

    expect(() =>
      database?.exec(
        "UPDATE audit_events SET action = 'audit.changed' WHERE id = 'a0000000-0000-4000-8000-000000000001'",
      ),
    ).toThrow(/append-only/);
    expect(() =>
      database?.exec(
        "DELETE FROM audit_events WHERE id = 'a0000000-0000-4000-8000-000000000001'",
      ),
    ).toThrow(/append-only/);
  });

  it('seeds two isolated firms idempotently', () => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    seedDatabase(database);

    expect(database.prepare('SELECT COUNT(*) AS count FROM firms').get()).toEqual({
      count: 2,
    });
    expect(database.prepare('SELECT COUNT(*) AS count FROM matters').get()).toEqual({
      count: 3,
    });
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM workflow_versions').get(),
    ).toEqual({ count: 1 });
    expect(
      database
        .prepare('SELECT COUNT(*) AS count FROM business_calendar_holidays')
        .get(),
    ).toEqual({ count: 8 });
    expect(
      database
        .prepare(
          `SELECT
            (SELECT COUNT(*) FROM matter_workflows WHERE matter_id = ?) AS workflows,
            (SELECT COUNT(*) FROM matter_stage_history WHERE matter_id = ?) AS stages,
            (SELECT COUNT(*) FROM domain_events WHERE matter_id = ?) AS events,
            (SELECT COUNT(*) FROM matter_deadlines WHERE matter_id = ?) AS deadlines`,
        )
        .get(
          SEED_IDS.northstarMatter,
          SEED_IDS.northstarMatter,
          SEED_IDS.northstarMatter,
          SEED_IDS.northstarMatter,
        ),
    ).toEqual({ workflows: 1, stages: 5, events: 5, deadlines: 1 });
  });

  it('seeds the claimant intake pilot and converted matter profile idempotently', () => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    seedDatabase(database);
    const store = new IntakeStore(database, () => FIXED_NOW);
    const service = new IntakeService(database, store, () => FIXED_NOW);
    const lewis: SessionUser = {
      id: SEED_IDS.southbankUser,
      firmId: SEED_IDS.southbankFirm,
      firmName: 'Southbank Law',
      email: 'lewis@southbank.test',
      name: 'Lewis Grant',
      role: 'partner',
    };

    expect(database.prepare('SELECT COUNT(*) AS count FROM enquiries').get()).toEqual({
      count: 3,
    });
    const leah = store.getEnquiry(ava, SEED_IDS.leahEnquiry);
    expect(leah).toMatchObject({
      reference: 'HDR-E-2026-0001',
      status: 'accepted',
      assignedTo: { id: SEED_IDS.ava },
      client: { displayName: 'Leah Benton' },
      property: { postcode: 'LS1 4AA' },
      landlord: { name: 'Civic North Homes' },
    });
    expect(service.getWorkspace(ava, SEED_IDS.leahEnquiry)).toMatchObject({
      conflict: { latestDecision: { decision: 'clear' } },
      assessment: { decision: 'proceed' },
      onboarding: { fundingType: 'cfa', fundingStatus: 'pending' },
      readiness: {
        conversion: {
          ready: false,
          blockers: [expect.objectContaining({ key: 'funding_status' })],
        },
      },
    });

    expect(store.getMatterIntakeProfile(ava, SEED_IDS.northstarMatter)).toMatchObject({
      matterId: SEED_IDS.northstarMatter,
      client: {
        displayName: 'Maya Clarke',
        safeContactInstructions: 'Email is safe at any time; call after 10am.',
      },
      property: { postcode: 'M5 4QJ' },
      landlord: { name: 'Meridian Housing Association' },
      tenancy: { tenancyType: 'assured', rentMinor: 54_000 },
      onboarding: { fundingStatus: 'complete' },
      householdMembers: [
        expect.objectContaining({ displayName: 'Leo Clarke', relationship: 'Child' }),
      ],
    });

    expect(store.getEnquiry(lewis, SEED_IDS.southbankEnquiry)).toMatchObject({
      client: { displayName: 'Amara Jones' },
      assignedTo: { id: SEED_IDS.southbankUser },
    });
    expect(store.getEnquiry(ava, SEED_IDS.southbankEnquiry)).toBeUndefined();
    expect(store.getEnquiry(lewis, SEED_IDS.leahEnquiry)).toBeUndefined();
  });

  it('seeds the synthetic evidence investigation idempotently and tenant-safely', () => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    seedDatabase(database);
    const store = new EvidenceStore(database);
    const workspace = store.getWorkspace(ava, SEED_IDS.northstarMatter);
    const lewis: SessionUser = {
      id: SEED_IDS.southbankUser,
      firmId: SEED_IDS.southbankFirm,
      firmName: 'Southbank Law',
      email: 'lewis@southbank.test',
      name: 'Lewis Grant',
      role: 'partner',
    };

    expect(workspace?.defects).toHaveLength(5);
    expect(
      new Set(workspace?.defects.map(({ location }) => location)).size,
    ).toBe(4);
    expect(workspace?.notices.map(({ channel }) => channel)).toEqual(
      expect.arrayContaining(['email', 'phone', 'whatsapp']),
    );
    expect(workspace?.accessEvents.length).toBeGreaterThan(0);
    expect(
      workspace?.evidenceItems.filter(({ kind }) => kind === 'photograph')
        .length,
    ).toBeGreaterThan(0);
    expect(workspace?.evidenceItems[0]?.description).toContain(
      'Synthetic evaluation evidence',
    );
    expect(workspace?.risks.map(({ type }) => type)).toContain(
      'defect_without_evidence',
    );
    expect(
      workspace?.availableDocumentVersions.every(
        ({ sha256 }) => sha256.length === 64,
      ),
    ).toBe(true);
    expect(store.getWorkspace(lewis, SEED_IDS.northstarMatter)).toBeUndefined();
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM defects').get(),
    ).toEqual({ count: 5 });
  });

  it('seeds a protocol-stage synthetic housing conditions matter', () => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    const service = new WorkflowService(
      new MatterStore(database, () => FIXED_NOW),
      new WorkflowStore(database, () => FIXED_NOW),
      () => FIXED_NOW,
    );
    const summary = service.getMatter360(ava, SEED_IDS.northstarMatter);
    const landlordResponseRule = HOUSING_DISREPAIR_WORKFLOW.deadlineRules.find(
      (rule) => rule.key === 'housing.protocol.landlord_response',
    );
    expect(landlordResponseRule).toBeDefined();
    const calculation = calculateDeadline({
      triggerDate: '2026-07-14',
      triggerEventId: 'seed-trigger',
      rule: landlordResponseRule!,
      calendar: ENGLAND_WALES_2026_CALENDAR,
    });

    expect(calculation.dueDate).toBe('2026-08-11');
    expect(summary.matter).toMatchObject({
      reference: 'NCL-2026-0017',
      matterType: 'Housing conditions claim',
      stage: 'Pre-Action Protocol',
      clientName: 'Maya Clarke',
      title: 'Clarke v Meridian Housing',
    });
    expect(summary.workflow.currentStageKey).toBe('protocol');
    expect(summary.deadlines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Landlord response to Letter of Claim',
          dueDate: calculation.dueDate,
        }),
      ]),
    );
    expect(summary.workflow.blockers).toEqual([]);
  });

  it('keeps the evaluation matter invisible across firm boundaries', () => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    const store = new MatterStore(database, () => FIXED_NOW);
    const lewis: SessionUser = {
      id: SEED_IDS.southbankUser,
      firmId: SEED_IDS.southbankFirm,
      firmName: 'Southbank Law',
      email: 'lewis@southbank.test',
      name: 'Lewis Grant',
      role: 'partner',
    };

    expect(store.getMatterAggregate(lewis, SEED_IDS.northstarMatter)).toBeUndefined();
    expect(store.getMatterAggregate(ava, SEED_IDS.southbankMatter)).toBeUndefined();
  });
});
