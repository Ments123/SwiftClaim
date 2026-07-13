import { DatabaseSync } from 'node:sqlite';

import { migrations, runMigrations } from './migrations/index.js';
import type { SessionUser } from './policy.js';
import { hashPassword } from './security.js';
import { MatterStore } from './store.js';
import { seedWorkflowDefinitions } from './workflow/definitions.js';
import { WorkflowService } from './workflow/service.js';
import { WorkflowStore } from './workflow/store.js';

export const SEED_IDS = {
  northstarFirm: '10000000-0000-4000-8000-000000000001',
  southbankFirm: '10000000-0000-4000-8000-000000000002',
  partner: '20000000-0000-4000-8000-000000000001',
  ava: '20000000-0000-4000-8000-000000000002',
  ben: '20000000-0000-4000-8000-000000000003',
  finance: '20000000-0000-4000-8000-000000000004',
  southbankUser: '20000000-0000-4000-8000-000000000005',
  northstarMatter: '30000000-0000-4000-8000-000000000001',
  northstarRestrictedMatter: '30000000-0000-4000-8000-000000000002',
  southbankMatter: '30000000-0000-4000-8000-000000000003',
  northstarClient: '40000000-0000-4000-8000-000000000001',
  northstarOpponent: '40000000-0000-4000-8000-000000000002',
  disclosureTask: '50000000-0000-4000-8000-000000000001',
  witnessTask: '50000000-0000-4000-8000-000000000002',
  reviewTask: '50000000-0000-4000-8000-000000000003',
} as const;


export function createDatabase(path: string): DatabaseSync {
  const database = new DatabaseSync(path);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  runMigrations(database, migrations);

  return database;
}

function insertSeedMatter(
  database: DatabaseSync,
  matter: {
    id: string;
    firmId: string;
    reference: string;
    title: string;
    clientName: string;
    matterType: string;
    stage: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    ownerUserId: string;
    openedAt: string;
    description: string;
  },
  now: string,
): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO matters (
        id, firm_id, reference, title, client_name, matter_type, status, stage,
        risk_level, owner_user_id, opened_at, description, external_source,
        external_id, import_batch_id, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, 'proclaim-demo', ?,
        'seed-2026-07', ?, ?, ?)`,
    )
    .run(
      matter.id,
      matter.firmId,
      matter.reference,
      matter.title,
      matter.clientName,
      matter.matterType,
      matter.stage,
      matter.riskLevel,
      matter.ownerUserId,
      matter.openedAt,
      matter.description,
      matter.reference,
      matter.ownerUserId,
      now,
      now,
    );
}

export function seedDatabase(database: DatabaseSync): void {
  const now = '2026-07-13T08:30:00.000Z';
  const passwordHash = hashPassword('SwiftClaim!2026');

  database.exec('BEGIN IMMEDIATE');
  try {
    const insertFirm = database.prepare(
      'INSERT OR IGNORE INTO firms (id, name, slug, created_at) VALUES (?, ?, ?, ?)',
    );
    insertFirm.run(SEED_IDS.northstarFirm, 'Northstar Legal', 'northstar', now);
    insertFirm.run(SEED_IDS.southbankFirm, 'Southbank Law', 'southbank', now);

    const insertUser = database.prepare(
      `INSERT OR IGNORE INTO users (
        id, firm_id, email, name, password_hash, role, active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    );
    insertUser.run(
      SEED_IDS.partner,
      SEED_IDS.northstarFirm,
      'partner@northstar.test',
      'Marcus Reed',
      passwordHash,
      'partner',
      now,
    );
    insertUser.run(
      SEED_IDS.ava,
      SEED_IDS.northstarFirm,
      'ava@northstar.test',
      'Ava Morgan',
      passwordHash,
      'solicitor',
      now,
    );
    insertUser.run(
      SEED_IDS.ben,
      SEED_IDS.northstarFirm,
      'ben@northstar.test',
      'Ben Foster',
      passwordHash,
      'paralegal',
      now,
    );
    insertUser.run(
      SEED_IDS.finance,
      SEED_IDS.northstarFirm,
      'finance@northstar.test',
      'Priya Shah',
      passwordHash,
      'finance',
      now,
    );
    insertUser.run(
      SEED_IDS.southbankUser,
      SEED_IDS.southbankFirm,
      'lewis@southbank.test',
      'Lewis Grant',
      passwordHash,
      'partner',
      now,
    );

    insertSeedMatter(
      database,
      {
        id: SEED_IDS.northstarMatter,
        firmId: SEED_IDS.northstarFirm,
        reference: 'NCL-2026-0017',
        title: 'Clarke v Meridian Housing',
        clientName: 'Maya Clarke',
        matterType: 'Housing conditions claim',
        stage: 'Enquiry',
        riskLevel: 'high',
        ownerUserId: SEED_IDS.ava,
        openedAt: '2026-03-02',
        description:
          'Synthetic claimant housing conditions file for 18 Alder Court, Salford, M5 4QJ. Reported conditions include damp and mould, a defective bathroom extractor, a leaking bedroom window, damaged plaster and intermittent heating.',
      },
      now,
    );
    insertSeedMatter(
      database,
      {
        id: SEED_IDS.northstarRestrictedMatter,
        firmId: SEED_IDS.northstarFirm,
        reference: 'NCL-2026-0023',
        title: 'Patel Construction v Harrow Developments',
        clientName: 'Patel Construction Ltd',
        matterType: 'Commercial dispute',
        stage: 'Witness evidence',
        riskLevel: 'medium',
        ownerUserId: SEED_IDS.partner,
        openedAt: '2026-05-18',
        description: 'Payment and delay dispute under a commercial building contract.',
      },
      now,
    );
    insertSeedMatter(
      database,
      {
        id: SEED_IDS.southbankMatter,
        firmId: SEED_IDS.southbankFirm,
        reference: 'SBL-2026-0008',
        title: 'Ellis v Northbridge Retail',
        clientName: 'Jordan Ellis',
        matterType: 'Employment litigation',
        stage: 'Pleadings',
        riskLevel: 'medium',
        ownerUserId: SEED_IDS.southbankUser,
        openedAt: '2026-06-01',
        description: 'Employment dispute belonging to the isolated Southbank tenant.',
      },
      now,
    );

    const insertMember = database.prepare(
      `INSERT OR IGNORE INTO matter_members (
        firm_id, matter_id, user_id, access_level, added_at
      ) VALUES (?, ?, ?, ?, ?)`,
    );
    insertMember.run(
      SEED_IDS.northstarFirm,
      SEED_IDS.northstarMatter,
      SEED_IDS.ava,
      'write',
      now,
    );
    insertMember.run(
      SEED_IDS.northstarFirm,
      SEED_IDS.northstarMatter,
      SEED_IDS.ben,
      'write',
      now,
    );
    insertMember.run(
      SEED_IDS.northstarFirm,
      SEED_IDS.northstarRestrictedMatter,
      SEED_IDS.partner,
      'write',
      now,
    );
    insertMember.run(
      SEED_IDS.southbankFirm,
      SEED_IDS.southbankMatter,
      SEED_IDS.southbankUser,
      'write',
      now,
    );

    const insertParty = database.prepare(
      `INSERT OR IGNORE INTO parties (
        id, firm_id, matter_id, kind, name, organisation, email, phone, address,
        external_source, external_id, import_batch_id, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proclaim-demo', ?, 'seed-2026-07', ?, ?)`,
    );
    insertParty.run(
      SEED_IDS.northstarClient,
      SEED_IDS.northstarFirm,
      SEED_IDS.northstarMatter,
      'client',
      'Maya Clarke',
      '',
      'maya.clarke@example.test',
      '+44 7700 900123',
      '18 Alder Court, Salford, M5 4QJ',
      'PC-10492',
      SEED_IDS.ava,
      now,
    );
    insertParty.run(
      SEED_IDS.northstarOpponent,
      SEED_IDS.northstarFirm,
      SEED_IDS.northstarMatter,
      'opponent',
      'Meridian Housing Association',
      'Meridian Housing Association',
      'repairs@meridian-housing.example.test',
      '+44 20 7946 0911',
      '1 Meridian Square, Manchester',
      'OP-8821',
      SEED_IDS.ava,
      now,
    );

    const insertTask = database.prepare(
      `INSERT OR IGNORE INTO tasks (
        id, firm_id, matter_id, title, notes, due_at, priority, status,
        assignee_user_id, completed_at, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    );
    insertTask.run(
      SEED_IDS.disclosureTask,
      SEED_IDS.northstarFirm,
      SEED_IDS.northstarMatter,
      'Obtain missing heating repair records',
      'Chase the landlord for the heating attendance and completion records.',
      '2026-07-11T16:00:00.000Z',
      'urgent',
      'in_progress',
      SEED_IDS.ava,
      SEED_IDS.ava,
      now,
      now,
    );
    insertTask.run(
      SEED_IDS.witnessTask,
      SEED_IDS.northstarFirm,
      SEED_IDS.northstarMatter,
      'Approve Letter of Claim evidence schedule',
      'Check the defects, notice chronology and disclosed repair records.',
      '2026-07-14T11:00:00.000Z',
      'high',
      'open',
      SEED_IDS.ava,
      SEED_IDS.ava,
      now,
      now,
    );
    insertTask.run(
      SEED_IDS.reviewTask,
      SEED_IDS.northstarFirm,
      SEED_IDS.northstarMatter,
      'Review landlord repair disclosure',
      'Flag missing complaint logs, inspections and work completion evidence.',
      '2026-07-16T15:00:00.000Z',
      'high',
      'open',
      SEED_IDS.ben,
      SEED_IDS.ava,
      now,
      now,
    );

    const insertTimeline = database.prepare(
      `INSERT OR IGNORE INTO timeline_events (
        id, firm_id, matter_id, type, title, detail, actor_user_id, occurred_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertTimeline.run(
      '60000000-0000-4000-8000-000000000001',
      SEED_IDS.northstarFirm,
      SEED_IDS.northstarMatter,
      'matter.created',
      'Matter opened',
      'The synthetic housing conditions matter was opened from Proclaim reference NCL-2026-0017.',
      SEED_IDS.ava,
      '2026-03-02T09:15:00.000Z',
      '{}',
    );
    insertTimeline.run(
      '60000000-0000-4000-8000-000000000002',
      SEED_IDS.northstarFirm,
      SEED_IDS.northstarMatter,
      'evidence.recorded',
      'Repair complaints collated',
      'Synthetic complaint records, photographs and repair visits were added to the chronology.',
      SEED_IDS.ava,
      '2026-07-07T14:20:00.000Z',
      '{}',
    );
    insertTimeline.run(
      '60000000-0000-4000-8000-000000000003',
      SEED_IDS.northstarFirm,
      SEED_IDS.northstarMatter,
      'task.created',
      'Deadline added: Approve Letter of Claim evidence schedule',
      'Due 14 July 2026 at 12:00.',
      SEED_IDS.ava,
      now,
      '{}',
    );

    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  seedWorkflowDefinitions(database, now);
  seedHousingWorkflowMatter(database);
}

function seedHousingWorkflowMatter(database: DatabaseSync): void {
  const workflowNow = () => new Date('2026-07-15T09:00:00.000Z');
  const user: SessionUser = {
    id: SEED_IDS.ava,
    firmId: SEED_IDS.northstarFirm,
    firmName: 'Northstar Legal',
    email: 'ava@northstar.test',
    name: 'Ava Morgan',
    role: 'solicitor',
  };
  const workflowStore = new WorkflowStore(database, workflowNow);
  const service = new WorkflowService(
    new MatterStore(database, workflowNow),
    workflowStore,
    workflowNow,
  );
  workflowStore.instantiateMatterWorkflow(
    user.firmId,
    SEED_IDS.northstarMatter,
    user.id,
  );

  const transitions = [
    {
      fromStageKey: 'enquiry',
      toStageKey: 'assessment',
      completedChecklistKeys: [
        'initial_contact_recorded',
        'conflict_check_completed',
      ],
      reason: 'Initial enquiry and conflict controls completed for assessment.',
    },
    {
      fromStageKey: 'assessment',
      toStageKey: 'onboarding',
      completedChecklistKeys: [
        'tenancy_confirmed',
        'landlord_duty_screened',
        'limitation_reviewed',
        'merits_decision_recorded',
      ],
      reason: 'Merits, duty, limitation and proportionality review completed.',
    },
    {
      fromStageKey: 'onboarding',
      toStageKey: 'evidence',
      completedChecklistKeys: [
        'client_care_signed',
        'authority_signed',
        'id_checks_completed',
        'funding_recorded',
      ],
      reason: 'Synthetic client-care, authority, identity and funding controls completed.',
    },
    {
      fromStageKey: 'evidence',
      toStageKey: 'protocol',
      completedChecklistKeys: [
        'defect_schedule_recorded',
        'notice_evidence_recorded',
        'photographs_recorded',
        'letter_of_claim_sent',
      ],
      reason: 'Defect and notice evidence reviewed and the Letter of Claim sent.',
    },
  ] as const;

  for (const transition of transitions) {
    const workflow = workflowStore.getMatterWorkflow(
      user.firmId,
      SEED_IDS.northstarMatter,
    );
    if (!workflow) throw new Error('Seed workflow was not created');
    const target = workflowStore
      .listWorkflowStages(user.firmId, SEED_IDS.northstarMatter)
      .find((stage) => stage.key === transition.toStageKey);
    if (!target) throw new Error(`Seed stage ${transition.toStageKey} is missing`);
    if (workflow.currentStage.position >= target.position) continue;
    if (workflow.currentStage.key !== transition.fromStageKey) {
      throw new Error(
        `Seed workflow expected ${transition.fromStageKey} but found ${workflow.currentStage.key}`,
      );
    }
    service.transitionStage(
      user,
      SEED_IDS.northstarMatter,
      {
        toStageKey: transition.toStageKey,
        expectedVersion: workflow.version,
        completedChecklistKeys: [...transition.completedChecklistKeys],
        reason: transition.reason,
      },
      {
        requestId: `seed-workflow-${transition.toStageKey}`,
        ipAddress: '127.0.0.1',
      },
    );
  }

  service.confirmTrigger(
    user,
    SEED_IDS.northstarMatter,
    {
      eventType: 'letter_of_claim.received',
      occurredOn: '2026-07-14',
      idempotencyKey: 'seed-letter-of-claim-received-2026-07-14',
    },
    {
      requestId: 'seed-workflow-letter-of-claim-received',
      ipAddress: '127.0.0.1',
    },
  );
}
