import { DatabaseSync } from 'node:sqlite';

import { migrations, runMigrations } from './migrations/index.js';
import { IntakeConflictService } from './intake/conflicts.js';
import { IntakeService } from './intake/service.js';
import { IntakeStore } from './intake/store.js';
import type { SessionUser } from './policy.js';
import { ProtocolService } from './protocol/service.js';
import { ProtocolStore } from './protocol/store.js';
import { QuantumService } from './quantum/service.js';
import { QuantumStore } from './quantum/store.js';
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
  leahContact: '41000000-0000-4000-8000-000000000001',
  leahLandlord: '42000000-0000-4000-8000-000000000001',
  leahProperty: '43000000-0000-4000-8000-000000000001',
  leahEnquiry: '44000000-0000-4000-8000-000000000001',
  southbankContact: '41000000-0000-4000-8000-000000000002',
  southbankLandlord: '42000000-0000-4000-8000-000000000002',
  southbankProperty: '43000000-0000-4000-8000-000000000002',
  southbankEnquiry: '44000000-0000-4000-8000-000000000002',
  mayaContact: '41000000-0000-4000-8000-000000000003',
  mayaLandlord: '42000000-0000-4000-8000-000000000003',
  mayaProperty: '43000000-0000-4000-8000-000000000003',
  mayaEnquiry: '44000000-0000-4000-8000-000000000003',
  mayaAssessment: '45000000-0000-4000-8000-000000000003',
  mayaOnboarding: '46000000-0000-4000-8000-000000000003',
  mayaHousehold: '47000000-0000-4000-8000-000000000003',
  mayaTenancy: '48000000-0000-4000-8000-000000000003',
  mayaHousingCase: '49000000-0000-4000-8000-000000000003',
  mayaConversion: '4a000000-0000-4000-8000-000000000003',
  bedroomDampDefect: '71000000-0000-4000-8000-000000000001',
  bathroomLeakDefect: '71000000-0000-4000-8000-000000000002',
  kitchenVentDefect: '71000000-0000-4000-8000-000000000003',
  heatingDefect: '71000000-0000-4000-8000-000000000004',
  communalIngressDefect: '71000000-0000-4000-8000-000000000005',
  emailNotice: '72000000-0000-4000-8000-000000000001',
  phoneNotice: '72000000-0000-4000-8000-000000000002',
  whatsappNotice: '72000000-0000-4000-8000-000000000003',
  completedAccess: '73000000-0000-4000-8000-000000000001',
  missedAccess: '73000000-0000-4000-8000-000000000002',
  scheduledAccess: '73000000-0000-4000-8000-000000000003',
  bedroomPhotoDocument: '74000000-0000-4000-8000-000000000001',
  complaintDocument: '74000000-0000-4000-8000-000000000002',
  repairDocument: '74000000-0000-4000-8000-000000000003',
  bathroomPhotoDocument: '74000000-0000-4000-8000-000000000004',
  bedroomPhotoVersion: '75000000-0000-4000-8000-000000000001',
  complaintVersion: '75000000-0000-4000-8000-000000000002',
  repairVersion: '75000000-0000-4000-8000-000000000003',
  bathroomPhotoVersion: '75000000-0000-4000-8000-000000000004',
  bedroomPhotoEvidence: '76000000-0000-4000-8000-000000000001',
  complaintEvidence: '76000000-0000-4000-8000-000000000002',
  repairEvidence: '76000000-0000-4000-8000-000000000003',
  bathroomPhotoEvidence: '76000000-0000-4000-8000-000000000004',
} as const;

interface SeedDatabaseOptions {
  includeIntakePilot?: boolean;
  includeEvidenceInvestigation?: boolean;
}


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

export function seedDatabase(
  database: DatabaseSync,
  options: SeedDatabaseOptions = {},
): void {
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
  if (options.includeIntakePilot !== false) seedClaimantIntakePilot(database);
  if (options.includeEvidenceInvestigation !== false) {
    seedEvidenceInvestigation(database);
  }
}

function seedEvidenceInvestigation(database: DatabaseSync): void {
  const firmId = SEED_IDS.northstarFirm;
  const matterId = SEED_IDS.northstarMatter;
  const actorId = SEED_IDS.ava;
  const createdAt = '2026-07-13T08:30:00.000Z';

  database.exec('BEGIN IMMEDIATE');
  try {
    const insertDefect = database.prepare(
      `INSERT OR IGNORE INTO defects (
        id, firm_id, matter_id, version, location, category, title,
        description, severity, status, first_observed_on, health_impact,
        hazard_tags_json, created_by, created_at, updated_by, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const defects = [
      [
        SEED_IDS.bedroomDampDefect,
        'Main bedroom',
        'damp_mould',
        'Damp and black mould around window',
        'Persistent damp staining and black mould are visible around the window reveal.',
        'serious',
        'open',
        '2025-10-12',
        'Client reports the bedroom is difficult to use and records respiratory concern.',
        JSON.stringify(['damp', 'mould', 'respiratory concern']),
      ],
      [
        SEED_IDS.bathroomLeakDefect,
        'Bathroom',
        'leak',
        'Leak beneath bath and damaged flooring',
        'Water escapes beneath the bath and has damaged the adjacent floor covering.',
        'moderate',
        'monitoring',
        '2026-01-18',
        '',
        JSON.stringify(['water ingress', 'slip concern']),
      ],
      [
        SEED_IDS.kitchenVentDefect,
        'Kitchen',
        'ventilation',
        'Extractor fan does not operate',
        'The kitchen extractor fan does not run and condensation remains after cooking.',
        'moderate',
        'open',
        '2025-12-02',
        '',
        JSON.stringify(['ventilation', 'condensation']),
      ],
      [
        SEED_IDS.heatingDefect,
        'Whole property',
        'heating',
        'Intermittent central heating',
        'The heating cuts out repeatedly and does not reliably warm the dwelling.',
        'serious',
        'open',
        '2025-11-20',
        'Client reports cold overnight periods affecting the household.',
        JSON.stringify(['cold', 'heating']),
      ],
      [
        SEED_IDS.communalIngressDefect,
        'Whole property',
        'structural',
        'Communal water ingress affects internal wall',
        'Water reported from the communal elevation tracks onto an internal wall after rain.',
        'serious',
        'disputed',
        '2026-02-11',
        '',
        JSON.stringify(['water ingress', 'communal origin']),
      ],
    ] as const;
    for (const defect of defects) {
      insertDefect.run(
        defect[0],
        firmId,
        matterId,
        ...defect.slice(1),
        actorId,
        createdAt,
        actorId,
        createdAt,
      );
    }

    const insertStatus = database.prepare(
      `INSERT OR IGNORE INTO defect_status_events (
        id, firm_id, matter_id, defect_id, from_status, to_status, reason,
        actor_user_id, occurred_at
      ) VALUES (?, ?, ?, ?, NULL, ?,
        'Synthetic evaluation defect imported into the structured schedule.', ?, ?)`,
    );
    defects.forEach((defect, index) => {
      insertStatus.run(
        `71100000-0000-4000-8000-00000000000${index + 1}`,
        firmId,
        matterId,
        defect[0],
        defect[6],
        actorId,
        createdAt,
      );
    });

    const insertNotice = database.prepare(
      `INSERT OR IGNORE INTO notices (
        id, firm_id, matter_id, occurred_at, channel, recipient_type,
        recipient_name, summary, proof_status, response_status,
        response_summary, supersedes_notice_id, idempotency_key,
        command_payload_json, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, 'landlord', 'Meridian Housing Association',
        ?, ?, ?, ?, NULL, ?, '{}', ?, ?)`,
    );
    insertNotice.run(
      SEED_IDS.emailNotice,
      firmId,
      matterId,
      '2025-11-03T09:15:00.000Z',
      'email',
      'Reported bedroom damp, mould and heating failure and requested inspection.',
      'linked',
      'acknowledged',
      'Landlord repairs inbox acknowledged receipt.',
      'seed-evidence-email-notice',
      actorId,
      createdAt,
    );
    insertNotice.run(
      SEED_IDS.phoneNotice,
      firmId,
      matterId,
      '2025-12-08T14:40:00.000Z',
      'phone',
      'Client recalls chasing the landlord about heating and kitchen ventilation.',
      'client_recollection',
      'repair_promised',
      'Client records that an operative visit was promised.',
      'seed-evidence-phone-notice',
      actorId,
      createdAt,
    );
    insertNotice.run(
      SEED_IDS.whatsappNotice,
      firmId,
      matterId,
      '2026-02-12T18:05:00.000Z',
      'whatsapp',
      'Reported communal water ingress after heavy rain.',
      'unknown',
      'none',
      '',
      'seed-evidence-whatsapp-notice',
      actorId,
      createdAt,
    );

    const insertAccess = database.prepare(
      `INSERT OR IGNORE INTO access_events (
        id, firm_id, matter_id, event_type, appointment_at, notes,
        supersedes_access_event_id, idempotency_key, command_payload_json,
        created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, '{}', ?, ?)`,
    );
    insertAccess.run(
      SEED_IDS.completedAccess,
      firmId,
      matterId,
      'completed',
      '2025-11-18T10:00:00.000Z',
      'Landlord operative attended and inspected the bedroom window and heating.',
      'seed-evidence-access-completed',
      actorId,
      createdAt,
    );
    insertAccess.run(
      SEED_IDS.missedAccess,
      firmId,
      matterId,
      'no_access',
      '2026-01-22T13:00:00.000Z',
      'Contractor did not attend the arranged bathroom appointment.',
      'seed-evidence-access-missed',
      actorId,
      createdAt,
    );
    insertAccess.run(
      SEED_IDS.scheduledAccess,
      firmId,
      matterId,
      'scheduled',
      '2026-07-20T09:30:00.000Z',
      'Follow-up access is scheduled for heating and water ingress inspection.',
      'seed-evidence-access-scheduled',
      actorId,
      createdAt,
    );

    const insertDocument = database.prepare(
      `INSERT OR IGNORE INTO documents (
        id, firm_id, matter_id, title, category, external_source, external_id,
        import_batch_id, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, 'synthetic-evaluation', ?,
        'seed-evidence-2026-07', ?, ?)`,
    );
    const documents = [
      [
        SEED_IDS.bedroomPhotoDocument,
        'Synthetic evaluation evidence - bedroom photographs',
        'Photographs',
        'SYN-EVID-001',
      ],
      [
        SEED_IDS.complaintDocument,
        'Synthetic evaluation evidence - complaint email',
        'Correspondence',
        'SYN-EVID-002',
      ],
      [
        SEED_IDS.repairDocument,
        'Synthetic evaluation evidence - heating attendance record',
        'Repair records',
        'SYN-EVID-003',
      ],
      [
        SEED_IDS.bathroomPhotoDocument,
        'Synthetic evaluation evidence - bathroom photograph',
        'Photographs',
        'SYN-EVID-004',
      ],
    ] as const;
    for (const document of documents) {
      insertDocument.run(
        document[0],
        firmId,
        matterId,
        document[1],
        document[2],
        document[3],
        actorId,
        createdAt,
      );
    }

    const insertVersion = database.prepare(
      `INSERT OR IGNORE INTO document_versions (
        id, firm_id, document_id, version, original_name, mime_type,
        size_bytes, sha256, storage_key, uploaded_by, created_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const versions = [
      [SEED_IDS.bedroomPhotoVersion, SEED_IDS.bedroomPhotoDocument, 'bedroom-mould-synthetic.jpg', 'image/jpeg', 245120, '1'.repeat(64), 'synthetic/evidence/bedroom-mould.jpg'],
      [SEED_IDS.complaintVersion, SEED_IDS.complaintDocument, 'complaint-email-synthetic.pdf', 'application/pdf', 98304, '2'.repeat(64), 'synthetic/evidence/complaint-email.pdf'],
      [SEED_IDS.repairVersion, SEED_IDS.repairDocument, 'heating-attendance-synthetic.pdf', 'application/pdf', 112640, '3'.repeat(64), 'synthetic/evidence/heating-attendance.pdf'],
      [SEED_IDS.bathroomPhotoVersion, SEED_IDS.bathroomPhotoDocument, 'bathroom-leak-synthetic.jpg', 'image/jpeg', 198144, '4'.repeat(64), 'synthetic/evidence/bathroom-leak.jpg'],
    ] as const;
    for (const version of versions) {
      insertVersion.run(
        version[0],
        firmId,
        version[1],
        version[2],
        version[3],
        version[4],
        version[5],
        version[6],
        actorId,
        createdAt,
      );
    }

    const insertEvidence = database.prepare(
      `INSERT OR IGNORE INTO evidence_items (
        id, firm_id, matter_id, kind, title, description, occurred_on,
        provenance_source, provenance_detail, document_version_id,
        idempotency_key, command_payload_json, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
    );
    const items = [
      [SEED_IDS.bedroomPhotoEvidence, 'photograph', 'Bedroom mould photograph', 'Synthetic evaluation evidence showing mould around the bedroom window.', '2026-07-10', 'client', 'Synthetic file supplied by the evaluation client.', SEED_IDS.bedroomPhotoVersion, 'seed-evidence-item-bedroom'],
      [SEED_IDS.complaintEvidence, 'correspondence', 'Initial complaint email', 'Synthetic evaluation evidence preserving the email complaint and acknowledgement.', '2025-11-03', 'client', 'Synthetic email export supplied by the evaluation client.', SEED_IDS.complaintVersion, 'seed-evidence-item-complaint'],
      [SEED_IDS.repairEvidence, 'repair_record', 'Heating attendance record', 'Synthetic evaluation evidence recording an operative attendance without completion proof.', '2025-11-18', 'landlord', 'Synthetic repair record disclosed for evaluation.', SEED_IDS.repairVersion, 'seed-evidence-item-repair'],
      [SEED_IDS.bathroomPhotoEvidence, 'photograph', 'Bathroom leak photograph', 'Synthetic evaluation evidence showing water beneath the bath edge.', '2026-01-19', 'client', 'Synthetic file supplied by the evaluation client.', SEED_IDS.bathroomPhotoVersion, 'seed-evidence-item-bathroom'],
    ] as const;
    for (const item of items) {
      insertEvidence.run(
        item[0],
        firmId,
        matterId,
        item[1],
        item[2],
        item[3],
        item[4],
        item[5],
        item[6],
        item[7],
        item[8],
        actorId,
        createdAt,
      );
    }

    const insertDefectLink = database.prepare(
      `INSERT OR IGNORE INTO defect_evidence_links (
        firm_id, matter_id, evidence_item_id, defect_id, linked_by, linked_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insertDefectLink.run(firmId, matterId, SEED_IDS.bedroomPhotoEvidence, SEED_IDS.bedroomDampDefect, actorId, createdAt);
    insertDefectLink.run(firmId, matterId, SEED_IDS.repairEvidence, SEED_IDS.heatingDefect, actorId, createdAt);
    insertDefectLink.run(firmId, matterId, SEED_IDS.bathroomPhotoEvidence, SEED_IDS.bathroomLeakDefect, actorId, createdAt);

    database
      .prepare(
        `INSERT OR IGNORE INTO notice_evidence_links (
          firm_id, matter_id, evidence_item_id, notice_id, linked_by, linked_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(firmId, matterId, SEED_IDS.complaintEvidence, SEED_IDS.emailNotice, actorId, createdAt);
    database
      .prepare(
        `INSERT OR IGNORE INTO access_evidence_links (
          firm_id, matter_id, evidence_item_id, access_event_id, linked_by,
          linked_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(firmId, matterId, SEED_IDS.repairEvidence, SEED_IDS.completedAccess, actorId, createdAt);

    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

interface SeedEnquiryFoundation {
  firmId: string;
  userId: string;
  contactId: string;
  landlordId: string;
  propertyId: string;
  enquiryId: string;
  statusEventId: string;
  reference: string;
  status: 'new' | 'converted';
  version: number;
  source: string;
  givenName: string;
  familyName: string;
  dateOfBirth: string;
  email: string;
  phone: string;
  preferredChannel: 'email' | 'phone' | 'sms' | 'post';
  safeContactInstructions: string;
  accessibilityNeeds: string;
  interpreterLanguage: string | null;
  landlordName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  county: string;
  postcode: string;
  propertyType: 'house' | 'flat' | 'maisonette' | 'bungalow' | 'other' | 'unknown';
  summary: string;
  defectSummary: string;
  desiredOutcome: string;
  firstComplainedOn: string;
  urgency: 'routine' | 'priority' | 'urgent' | 'critical';
  immediateSafetyConcerns: string;
  communicationRequirements: string;
  now: string;
}

function insertSeedEnquiryFoundation(
  database: DatabaseSync,
  seed: SeedEnquiryFoundation,
): void {
  const displayName = `${seed.givenName} ${seed.familyName}`;
  database
    .prepare(
      `INSERT OR IGNORE INTO contacts (
         id, firm_id, given_name, family_name, display_name, date_of_birth,
         email, phone, preferred_channel, safe_contact_instructions,
         accessibility_needs, interpreter_language, normalized_name,
         normalized_email, normalized_phone, external_source, external_id,
         import_batch_id, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         'evaluation-seed', ?, 'seed-intake-2026-07', ?, ?, ?)`,
    )
    .run(
      seed.contactId,
      seed.firmId,
      seed.givenName,
      seed.familyName,
      displayName,
      seed.dateOfBirth,
      seed.email,
      seed.phone,
      seed.preferredChannel,
      seed.safeContactInstructions,
      seed.accessibilityNeeds,
      seed.interpreterLanguage,
      displayName.toLowerCase(),
      seed.email.toLowerCase(),
      seed.phone.replace(/\D/g, ''),
      `CONTACT-${seed.contactId.slice(-4)}`,
      seed.userId,
      seed.now,
      seed.now,
    );
  database
    .prepare(
      `INSERT OR IGNORE INTO organisations (
         id, firm_id, name, kind, normalized_name, external_source,
         external_id, import_batch_id, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, 'landlord', ?, 'evaluation-seed', ?,
         'seed-intake-2026-07', ?, ?, ?)`,
    )
    .run(
      seed.landlordId,
      seed.firmId,
      seed.landlordName,
      seed.landlordName.toLowerCase(),
      `LANDLORD-${seed.landlordId.slice(-4)}`,
      seed.userId,
      seed.now,
      seed.now,
    );
  database
    .prepare(
      `INSERT OR IGNORE INTO properties (
         id, firm_id, address_line_1, address_line_2, city, county, postcode,
         country, property_type, normalized_address, external_source,
         external_id, import_batch_id, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'England', ?, ?, 'evaluation-seed', ?,
         'seed-intake-2026-07', ?, ?, ?)`,
    )
    .run(
      seed.propertyId,
      seed.firmId,
      seed.addressLine1,
      seed.addressLine2,
      seed.city,
      seed.county,
      seed.postcode,
      seed.propertyType,
      `${seed.addressLine1} ${seed.addressLine2} ${seed.city} ${seed.county} ${seed.postcode}`
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' '),
      `PROPERTY-${seed.propertyId.slice(-4)}`,
      seed.userId,
      seed.now,
      seed.now,
    );
  database
    .prepare(
      `INSERT OR IGNORE INTO enquiries (
         id, firm_id, reference, status, version, source, referrer_name,
         prospective_contact_id, property_id, landlord_organisation_id,
         assigned_user_id, summary, defect_summary, desired_outcome,
         first_complained_on, currently_occupied, urgency,
         immediate_safety_concerns, communication_requirements,
         external_source, external_id, import_batch_id, created_by, created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?,
         'evaluation-seed', ?, 'seed-intake-2026-07', ?, ?, ?)`,
    )
    .run(
      seed.enquiryId,
      seed.firmId,
      seed.reference,
      seed.status,
      seed.version,
      seed.source,
      seed.contactId,
      seed.propertyId,
      seed.landlordId,
      seed.userId,
      seed.summary,
      seed.defectSummary,
      seed.desiredOutcome,
      seed.firstComplainedOn,
      seed.urgency,
      seed.immediateSafetyConcerns,
      seed.communicationRequirements,
      `ENQUIRY-${seed.enquiryId.slice(-4)}`,
      seed.userId,
      seed.now,
      seed.now,
    );
  database
    .prepare(
      `INSERT OR IGNORE INTO enquiry_status_events (
         id, firm_id, enquiry_id, from_status, to_status, reason,
         actor_user_id, occurred_at
       ) VALUES (?, ?, ?, NULL, ?, 'Synthetic evaluation record seeded', ?, ?)`,
    )
    .run(
      seed.statusEventId,
      seed.firmId,
      seed.enquiryId,
      seed.status,
      seed.userId,
      seed.now,
    );
}

function seedClaimantIntakePilot(database: DatabaseSync): void {
  const now = '2026-07-13T12:00:00.000Z';
  database.exec('BEGIN IMMEDIATE');
  try {
    insertSeedEnquiryFoundation(database, {
      firmId: SEED_IDS.northstarFirm,
      userId: SEED_IDS.ava,
      contactId: SEED_IDS.leahContact,
      landlordId: SEED_IDS.leahLandlord,
      propertyId: SEED_IDS.leahProperty,
      enquiryId: SEED_IDS.leahEnquiry,
      statusEventId: '4c000000-0000-4000-8000-000000000001',
      reference: 'HDR-E-2026-0001',
      status: 'new',
      version: 1,
      source: 'Direct',
      givenName: 'Leah',
      familyName: 'Benton',
      dateOfBirth: '1988-04-09',
      email: 'leah.benton@example.test',
      phone: '07000 000 101',
      preferredChannel: 'email',
      safeContactInstructions: '',
      accessibilityNeeds: '',
      interpreterLanguage: null,
      landlordName: 'Civic North Homes',
      addressLine1: '42 Hazel Walk',
      addressLine2: '',
      city: 'Leeds',
      county: 'West Yorkshire',
      postcode: 'LS1 4AA',
      propertyType: 'flat',
      summary: 'Damp, mould and heating complaint requiring legal assessment.',
      defectSummary: 'Bedroom damp, black mould and intermittent heating.',
      desiredOutcome: 'Repairs and compensation.',
      firstComplainedOn: '2025-11-03',
      urgency: 'priority',
      immediateSafetyConcerns: '',
      communicationRequirements: 'Email first; telephone after 4pm.',
      now,
    });
    insertSeedEnquiryFoundation(database, {
      firmId: SEED_IDS.southbankFirm,
      userId: SEED_IDS.southbankUser,
      contactId: SEED_IDS.southbankContact,
      landlordId: SEED_IDS.southbankLandlord,
      propertyId: SEED_IDS.southbankProperty,
      enquiryId: SEED_IDS.southbankEnquiry,
      statusEventId: '4c000000-0000-4000-8000-000000000002',
      reference: 'HDR-E-2026-0001',
      status: 'new',
      version: 1,
      source: 'Website',
      givenName: 'Amara',
      familyName: 'Jones',
      dateOfBirth: '1992-09-17',
      email: 'amara.jones@example.test',
      phone: '07000 000 202',
      preferredChannel: 'phone',
      safeContactInstructions: '',
      accessibilityNeeds: '',
      interpreterLanguage: null,
      landlordName: 'Thames Homes',
      addressLine1: '7 South Bank',
      addressLine2: '',
      city: 'London',
      county: '',
      postcode: 'SE1 1AA',
      propertyType: 'flat',
      summary: 'Persistent damp and a leaking external wall require assessment.',
      defectSummary: 'Living-room damp and water ingress after rainfall.',
      desiredOutcome: 'Repairs and compensation.',
      firstComplainedOn: '2026-02-10',
      urgency: 'routine',
      immediateSafetyConcerns: '',
      communicationRequirements: 'Telephone contact preferred.',
      now,
    });
    insertSeedEnquiryFoundation(database, {
      firmId: SEED_IDS.northstarFirm,
      userId: SEED_IDS.ava,
      contactId: SEED_IDS.mayaContact,
      landlordId: SEED_IDS.mayaLandlord,
      propertyId: SEED_IDS.mayaProperty,
      enquiryId: SEED_IDS.mayaEnquiry,
      statusEventId: '4c000000-0000-4000-8000-000000000003',
      reference: 'HDR-E-2026-0002',
      status: 'converted',
      version: 5,
      source: 'Proclaim evaluation backfill',
      givenName: 'Maya',
      familyName: 'Clarke',
      dateOfBirth: '1985-02-14',
      email: 'maya.clarke@example.test',
      phone: '+44 7700 900123',
      preferredChannel: 'email',
      safeContactInstructions: 'Email is safe at any time; call after 10am.',
      accessibilityNeeds: 'Provide documents in large print when requested.',
      interpreterLanguage: null,
      landlordName: 'Meridian Housing Association',
      addressLine1: '18 Alder Court',
      addressLine2: '',
      city: 'Salford',
      county: 'Greater Manchester',
      postcode: 'M5 4QJ',
      propertyType: 'flat',
      summary: 'Housing conditions claim transferred into the evaluation matter.',
      defectSummary: 'Damp and mould, defective extraction, leaking window, damaged plaster and intermittent heating.',
      desiredOutcome: 'Repairs, damages and costs.',
      firstComplainedOn: '2025-09-08',
      urgency: 'urgent',
      immediateSafetyConcerns: 'Mould is affecting a child with asthma.',
      communicationRequirements: 'Large-print documents when requested.',
      now,
    });
    seedMayaIntakeProfile(database, now);
    database
      .prepare(
        `INSERT INTO reference_sequences (firm_id, resource_key, next_value)
         VALUES (?, 'enquiry:2026', 3)
         ON CONFLICT (firm_id, resource_key) DO UPDATE SET
           next_value = max(reference_sequences.next_value, excluded.next_value)`,
      )
      .run(SEED_IDS.northstarFirm);
    database
      .prepare(
        `INSERT INTO reference_sequences (firm_id, resource_key, next_value)
         VALUES (?, 'enquiry:2026', 2)
         ON CONFLICT (firm_id, resource_key) DO UPDATE SET
           next_value = max(reference_sequences.next_value, excluded.next_value)`,
      )
      .run(SEED_IDS.southbankFirm);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  completeLeahPilotIntake(database);
}

function seedMayaIntakeProfile(database: DatabaseSync, now: string): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO housing_assessments (
         id, firm_id, enquiry_id, matter_id, version, jurisdiction_confirmed,
         claimant_relationship, notice_summary, conditions_unresolved,
         condition_start_date, access_summary, evidence_summary,
         limitation_review, legal_issues_json, escalations_json, merits_rating,
         proportionality_rating, decision, decision_reason, reviewed_by,
         reviewed_at, updated_by, updated_at
       ) VALUES (?, ?, ?, ?, 1, 1, 'tenant', ?, 1, '2025-08-01', ?, ?, ?,
         '["section_11","fitness"]', '[]', 'strong', 'reasonable', 'proceed',
         ?, ?, ?, ?, ?)`,
    )
    .run(
      SEED_IDS.mayaAssessment,
      SEED_IDS.northstarFirm,
      SEED_IDS.mayaEnquiry,
      SEED_IDS.northstarMatter,
      'The landlord received repeated written reports from September 2025.',
      'Maya has offered access and attended the inspection appointments.',
      'Photographs, complaint emails and repair records are held on the matter.',
      'Limitation was reviewed and the earliest actionable period was diarised.',
      'The synthetic file has strong merits and is proportionate to progress.',
      SEED_IDS.ava,
      now,
      SEED_IDS.ava,
      now,
    );
  database
    .prepare(
      `INSERT OR IGNORE INTO onboarding_profiles (
         id, firm_id, enquiry_id, matter_id, version, identity_status,
         client_care_status, authority_status, privacy_status, funding_type,
         funding_status, signature_status, vulnerability_summary,
         accessibility_needs, interpreter_language, safe_contact_instructions,
         owner_user_id, supervisor_user_id, updated_by, updated_at
       ) VALUES (?, ?, ?, ?, 1, 'complete', 'complete', 'complete', 'complete',
         'cfa', 'complete', 'complete', ?, ?, NULL, ?, ?, ?, ?, ?)`,
    )
    .run(
      SEED_IDS.mayaOnboarding,
      SEED_IDS.northstarFirm,
      SEED_IDS.mayaEnquiry,
      SEED_IDS.northstarMatter,
      'A child in the household has asthma affected by mould.',
      'Provide documents in large print when requested.',
      'Email is safe at any time; call after 10am.',
      SEED_IDS.ava,
      SEED_IDS.partner,
      SEED_IDS.ava,
      now,
    );
  database
    .prepare(
      `INSERT OR IGNORE INTO tenancies (
         id, firm_id, enquiry_id, matter_id, property_id,
         landlord_organisation_id, tenancy_type, started_on, ended_on,
         rent_minor, currency, rent_frequency, occupancy_started_on,
         occupancy_ended_on, external_source, external_id, import_batch_id,
         updated_by, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'assured', '2019-04-01', NULL, 54000,
         'GBP', 'monthly', '2019-04-01', NULL, 'proclaim-demo', 'TEN-10492',
         'seed-intake-2026-07', ?, ?)`,
    )
    .run(
      SEED_IDS.mayaTenancy,
      SEED_IDS.northstarFirm,
      SEED_IDS.mayaEnquiry,
      SEED_IDS.northstarMatter,
      SEED_IDS.mayaProperty,
      SEED_IDS.mayaLandlord,
      SEED_IDS.ava,
      now,
    );
  database
    .prepare(
      `INSERT OR IGNORE INTO household_members (
         id, firm_id, enquiry_id, matter_id, display_name, relationship,
         currently_occupies, claim_participant, vulnerability_summary,
         accessibility_needs, external_source, external_id, import_batch_id,
         created_by, created_at
       ) VALUES (?, ?, ?, ?, 'Leo Clarke', 'Child', 1, 0, ?, '',
         'proclaim-demo', 'HOUSEHOLD-10492-1', 'seed-intake-2026-07', ?, ?)`,
    )
    .run(
      SEED_IDS.mayaHousehold,
      SEED_IDS.northstarFirm,
      SEED_IDS.mayaEnquiry,
      SEED_IDS.northstarMatter,
      'Asthma symptoms are aggravated by damp and mould.',
      SEED_IDS.ava,
      now,
    );
  const insertParticipant = database.prepare(
    `INSERT OR IGNORE INTO matter_participants (
       id, firm_id, matter_id, contact_id, organisation_id, role, is_primary,
       external_source, external_id, import_batch_id, created_by, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'proclaim-demo', ?,
       'seed-intake-2026-07', ?, ?)`,
  );
  insertParticipant.run(
    '4b000000-0000-4000-8000-000000000031',
    SEED_IDS.northstarFirm,
    SEED_IDS.northstarMatter,
    SEED_IDS.mayaContact,
    null,
    'claimant',
    1,
    'PC-10492',
    SEED_IDS.ava,
    now,
  );
  insertParticipant.run(
    '4b000000-0000-4000-8000-000000000032',
    SEED_IDS.northstarFirm,
    SEED_IDS.northstarMatter,
    null,
    SEED_IDS.mayaLandlord,
    'landlord',
    0,
    'OP-8821',
    SEED_IDS.ava,
    now,
  );
  database
    .prepare(
      `INSERT OR IGNORE INTO housing_cases (
         id, firm_id, matter_id, source_enquiry_id, claimant_contact_id,
         property_id, tenancy_id, landlord_organisation_id,
         currently_occupied, external_source, external_id, import_batch_id,
         created_by, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'proclaim-demo', 'NCL-2026-0017',
         'seed-intake-2026-07', ?, ?)`,
    )
    .run(
      SEED_IDS.mayaHousingCase,
      SEED_IDS.northstarFirm,
      SEED_IDS.northstarMatter,
      SEED_IDS.mayaEnquiry,
      SEED_IDS.mayaContact,
      SEED_IDS.mayaProperty,
      SEED_IDS.mayaTenancy,
      SEED_IDS.mayaLandlord,
      SEED_IDS.ava,
      now,
    );
  database
    .prepare(
      `INSERT OR IGNORE INTO intake_conversions (
         id, firm_id, enquiry_id, matter_id, idempotency_key, converted_by,
         converted_at
       ) VALUES (?, ?, ?, ?, 'seed-proclaim-backfill-ncl-2026-0017', ?, ?)`,
    )
    .run(
      SEED_IDS.mayaConversion,
      SEED_IDS.northstarFirm,
      SEED_IDS.mayaEnquiry,
      SEED_IDS.northstarMatter,
      SEED_IDS.ava,
      now,
    );
}

function completeLeahPilotIntake(database: DatabaseSync): void {
  const now = () => new Date('2026-07-13T12:00:00.000Z');
  const user: SessionUser = {
    id: SEED_IDS.ava,
    firmId: SEED_IDS.northstarFirm,
    firmName: 'Northstar Legal',
    email: 'ava@northstar.test',
    name: 'Ava Morgan',
    role: 'solicitor',
  };
  const context = {
    requestId: 'seed-leah-intake-pilot',
    ipAddress: '127.0.0.1',
  };
  const store = new IntakeStore(database, now);
  const conflicts = new IntakeConflictService(database, store, now);
  const service = new IntakeService(database, store, now);
  let workspace = service.getWorkspace(user, SEED_IDS.leahEnquiry);
  if (!workspace.conflict.latestCheck) {
    const check = conflicts.runCheck(user, SEED_IDS.leahEnquiry, context);
    if (check.matchCount !== 0) {
      throw new Error('The Leah evaluation seed unexpectedly matched a conflict');
    }
    conflicts.recordDecision(
      user,
      SEED_IDS.leahEnquiry,
      {
        checkId: check.id,
        decision: 'clear',
        reason: 'Synthetic conflict search reviewed with no conflict identified.',
      },
      context,
    );
    workspace = service.getWorkspace(user, SEED_IDS.leahEnquiry);
  } else if (!workspace.conflict.latestDecision) {
    if (workspace.conflict.latestCheck.matchCount !== 0) {
      throw new Error('The Leah evaluation seed unexpectedly matched a conflict');
    }
    conflicts.recordDecision(
      user,
      SEED_IDS.leahEnquiry,
      {
        checkId: workspace.conflict.latestCheck.id,
        decision: 'clear',
        reason: 'Synthetic conflict search reviewed with no conflict identified.',
      },
      context,
    );
    workspace = service.getWorkspace(user, SEED_IDS.leahEnquiry);
  }
  if (!workspace.assessment) {
    service.saveAssessment(
      user,
      SEED_IDS.leahEnquiry,
      {
        expectedVersion: workspace.enquiry.version,
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
      },
      context,
    );
    workspace = service.getWorkspace(user, SEED_IDS.leahEnquiry);
  }
  if (workspace.enquiry.status === 'assessment') {
    service.decideEnquiry(
      user,
      SEED_IDS.leahEnquiry,
      {
        expectedVersion: workspace.enquiry.version,
        outcome: 'accepted',
        reason: 'The approved Housing Conditions intake criteria are satisfied.',
      },
      context,
    );
    workspace = service.getWorkspace(user, SEED_IDS.leahEnquiry);
  }
  if (!workspace.onboarding) {
    service.saveOnboarding(
      user,
      SEED_IDS.leahEnquiry,
      {
        expectedVersion: workspace.enquiry.version,
        identityStatus: 'complete',
        clientCareStatus: 'complete',
        authorityStatus: 'complete',
        privacyStatus: 'complete',
        fundingType: 'cfa',
        fundingStatus: 'pending',
        signatureStatus: 'complete',
        vulnerabilitySummary: 'A child in the household has asthma affected by mould.',
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
      },
      context,
    );
  }
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
      ],
      reason: 'Defect, notice and photograph evidence reviewed for protocol preparation.',
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
}

export async function seedProtocolExpertsEvaluation(
  database: DatabaseSync,
  storagePath: string,
): Promise<void> {
  const now = () => new Date('2026-08-20T09:00:00.000Z');
  const user: SessionUser = {
    id: SEED_IDS.ava,
    firmId: SEED_IDS.northstarFirm,
    firmName: 'Northstar Legal',
    email: 'ava@northstar.test',
    name: 'Ava Morgan',
    role: 'solicitor',
  };
  const audit = {
    requestId: 'seed-protocol-experts-evaluation',
    ipAddress: '127.0.0.1',
  };
  const workflowStore = new WorkflowStore(database, now);
  const store = new ProtocolStore(database, now, workflowStore);
  const service = new ProtocolService(database, store, storagePath, now);
  let workspace = service.getWorkspace(user, SEED_IDS.northstarMatter);
  if (!workspace) throw new Error('The Maya evaluation matter is unavailable');

  if (workspace.letterVersions.length === 0) {
    if (workspace.letter.state !== 'ready_for_review') {
      service.saveLetter(user, SEED_IDS.northstarMatter, {
        expectedVersion: workspace.letter.version,
        claimantAddress: '18 Alder Court, Salford, M5 4QJ',
        landlordRecipient: 'Meridian Housing Association',
        landlordAddress: '1 Meridian Square, Manchester, M1 1AA',
        effectNarrative:
          'Maya records that the main bedroom cannot be used safely and that recurring cold, damp and mould affect the household, including a child with asthma.',
        personalInjuryStatus: 'minor_gp_evidence',
        personalInjurySummary:
          'A GP attendance concerning asthma symptoms is recorded for solicitor review; no medical causation conclusion is made.',
        specialDamagesStatus: 'under_review',
        specialDamagesSummary: 'Damaged belongings and additional heating costs remain under review.',
        accessWindows: [
          { date: '2026-07-20', from: '10:00', to: '13:00', notes: 'Synthetic evaluation appointment.' },
        ],
        expertProposalSummary: 'A single joint building surveyor is proposed.',
        disclosureRequests: [
          'Complete tenancy and complaint file',
          'Inspection, repair order and completion records',
          'Communal elevation and water-ingress records',
        ],
        additionalContent: 'All professional and contact details in this evaluation matter are fictional.',
        state: 'ready_for_review',
      }, audit);
      workspace = service.getWorkspace(user, SEED_IDS.northstarMatter)!;
    }
    await service.approveLetter(user, SEED_IDS.northstarMatter, {
      expectedVersion: workspace.letter.version,
      idempotencyKey: 'seed-protocol-letter-approval-v1',
    }, audit);
    workspace = service.getWorkspace(user, SEED_IDS.northstarMatter)!;
  }

  const letterVersionId = workspace.letterVersions[0]!.id;
  if (!workspace.serviceEvents.some(({ eventType }) => eventType === 'dispatched')) {
    service.recordServiceEvent(user, SEED_IDS.northstarMatter, {
      idempotencyKey: 'seed-protocol-letter-dispatched',
      letterVersionId,
      eventType: 'dispatched',
      method: 'email',
      occurredAt: '2026-07-14T09:30:00.000Z',
      legalTriggerOn: null,
      recipient: 'Meridian Housing Association',
      destination: 'fictional-protocol-inbox@example.test',
      sourceDetail: 'Synthetic evaluation dispatch recorded from the reviewed outgoing email.',
      supportingDocumentVersionId: null,
      supersedesEventId: null,
      correctionReason: '',
    }, audit);
  }
  workspace = service.getWorkspace(user, SEED_IDS.northstarMatter)!;
  if (!workspace.serviceEvents.some(({ eventType }) => eventType === 'actual_receipt')) {
    service.recordServiceEvent(user, SEED_IDS.northstarMatter, {
      idempotencyKey: 'seed-protocol-letter-received',
      letterVersionId,
      eventType: 'actual_receipt',
      method: 'email',
      occurredAt: '2026-07-14T10:10:00.000Z',
      legalTriggerOn: '2026-07-14',
      recipient: 'Meridian Housing Association',
      destination: 'fictional-protocol-inbox@example.test',
      sourceDetail: 'Synthetic landlord acknowledgement confirms receipt on 14 July 2026.',
      supportingDocumentVersionId: null,
      supersedesEventId: null,
      correctionReason: '',
    }, audit);
  }
  workspace = service.getWorkspace(user, SEED_IDS.northstarMatter)!;
  if (workspace.landlordResponses.length === 0) {
    service.recordLandlordResponse(user, SEED_IDS.northstarMatter, {
      idempotencyKey: 'seed-landlord-response-initial',
      responseType: 'initial',
      receivedOn: '2026-07-16',
      respondingParty: 'Meridian Housing Association',
      contactName: 'Synthetic Repairs Team',
      generalLiabilityPosition: 'partly_admitted',
      liabilityReasons: 'The extractor and heating issues are partly admitted; causation of the remaining conditions is reserved.',
      noticePosition: 'The November email and later chasers are acknowledged.',
      accessPosition: 'Access is requested for a joint inspection.',
      disclosureStatus: 'partial',
      disclosureSummary: 'Repair orders are supplied; complaint logs and communal ingress records remain missing.',
      expertProposalPosition: 'agreed',
      expertProposalSummary: 'A single joint building surveyor is agreed in principle.',
      worksSchedule: 'Inspect the extractor, heating, bathroom leak and bedroom window.',
      worksStartOn: '2026-07-22',
      worksCompleteOn: null,
      compensationOfferMinor: null,
      costsOfferMinor: null,
      currency: 'GBP',
      sourceDocumentVersionId: SEED_IDS.complaintVersion,
      supersedesResponseId: null,
      correctionReason: '',
      defectPositions: [
        { defectId: SEED_IDS.bedroomDampDefect, position: 'partly_admitted', reason: 'Condition acknowledged; cause reserved.' },
        { defectId: SEED_IDS.bathroomLeakDefect, position: 'admitted', reason: 'Repair attendance is proposed.' },
        { defectId: SEED_IDS.kitchenVentDefect, position: 'admitted', reason: 'Extractor failure is accepted.' },
        { defectId: SEED_IDS.heatingDefect, position: 'partly_admitted', reason: 'Intermittent failure is accepted subject to inspection.' },
      ],
    }, audit);
  }
  workspace = service.getWorkspace(user, SEED_IDS.northstarMatter)!;
  if (workspace.case.expertRoute === 'undecided') {
    service.selectExpertRoute(user, SEED_IDS.northstarMatter, {
      expectedVersion: workspace.case.version,
      route: 'proposed_single_joint',
      reason: 'A proportionate independent inspection and schedule of works is required.',
      urgentReason: '',
    }, audit);
  }
  workspace = service.getWorkspace(user, SEED_IDS.northstarMatter)!;
  let expert = workspace.experts[0];
  if (!expert) {
    expert = service.createExpertEngagement(user, SEED_IDS.northstarMatter, {
      route: 'proposed_single_joint',
      expertRole: 'building_surveyor',
      expertName: 'Elena Ward',
      organisation: 'Northfield Building Surveyors',
      email: 'elena.ward@example.test',
      phone: '',
      expertise: 'Residential housing conditions, repair specifications and cost schedules.',
      qualifications: 'Supplied as BSc MRICS; not independently verified by SwiftClaim.',
      registrationBody: 'RICS',
      registrationReference: 'SYNTHETIC-RICS-1042',
      verificationStatus: 'unverified',
      verificationMethod: '',
      verifiedOn: null,
      proposedBy: 'jointly',
      singleJoint: true,
      termsStatus: 'accepted',
      feeBasis: 'Synthetic fixed fee for inspection, report and schedule of works.',
      feeMinor: 90000,
      currency: 'GBP',
      payerSplit: { claimantPercent: 50, landlordPercent: 50 },
      availabilitySummary: 'Synthetic inspection availability confirmed for 20 July 2026.',
      targetReportOn: '2026-08-03',
    }, audit);
  }
  if (expert.conflictChecks.length === 0) {
    service.recordExpertConflictCheck(user, SEED_IDS.northstarMatter, expert.id, {
      idempotencyKey: 'seed-expert-conflict-clear',
      partiesChecked: ['Maya Clarke', 'Meridian Housing Association'],
      method: 'Synthetic written declaration and supplied conflict search.',
      searchDetail: 'The fictional expert records no conflict against the supplied parties.',
      outcome: 'clear',
      decision: 'clear_to_proceed',
      reason: 'The named solicitor reviewed the synthetic declaration and approved progression.',
    }, audit);
  }
  workspace = service.getWorkspace(user, SEED_IDS.northstarMatter)!;
  expert = workspace.experts[0]!;
  if (expert.instructionVersions.length === 0) {
    await service.approveExpertInstruction(user, SEED_IDS.northstarMatter, expert.id, {
      expectedVersion: expert.version,
      idempotencyKey: 'seed-expert-instruction-v1',
      issues: ['Identify and describe all adverse housing conditions at the property.'],
      questions: [
        'Set out required works, urgency, reasonable duration and estimated cost.',
        'State whether any condition presents an immediate health or safety concern.',
      ],
      accessDetail: 'Synthetic access appointment: 20 July 2026 from 10:00 to 13:00.',
      urgentWorksRequested: true,
      scheduleOfWorksRequested: true,
      costEstimateRequested: true,
      reportDueOn: '2026-08-03',
    }, audit);
  }
  workspace = service.getWorkspace(user, SEED_IDS.northstarMatter)!;
  expert = workspace.experts[0]!;
  const instructionVersionId = expert.instructionVersions[0]!.id;
  const milestones = [
    {
      idempotencyKey: 'seed-instruction-dispatched',
      eventType: 'instruction_dispatched' as const,
      occurredAt: '2026-07-17T09:00:00.000Z',
      legalTriggerOn: null,
      detail: 'The approved synthetic instruction was dispatched to the fictional expert.',
    },
    {
      idempotencyKey: 'seed-inspection-booked',
      eventType: 'inspection_booked' as const,
      occurredAt: '2026-07-17T10:00:00.000Z',
      legalTriggerOn: null,
      detail: 'Inspection booked for 20 July 2026 at 10:00.',
    },
    {
      idempotencyKey: 'seed-inspection-completed',
      eventType: 'inspection_completed' as const,
      occurredAt: '2026-07-20T12:00:00.000Z',
      legalTriggerOn: '2026-07-20',
      detail: 'The fictional expert completed the synthetic property inspection.',
    },
  ];
  for (const milestone of milestones) {
    if (expert.milestones.some(({ eventType }) => eventType === milestone.eventType)) continue;
    service.recordExpertMilestone(user, SEED_IDS.northstarMatter, expert.id, {
      ...milestone,
      instructionVersionId,
      supportingDocumentVersionId: null,
      supersedesEventId: null,
      correctionReason: '',
    }, audit);
    expert = service.getWorkspace(user, SEED_IDS.northstarMatter)!.experts[0]!;
  }
}

export function seedRepairsQuantumEvaluation(database: DatabaseSync): void {
  const now = () => new Date('2026-08-20T09:00:00.000Z');
  const user: SessionUser = {
    id: SEED_IDS.ava,
    firmId: SEED_IDS.northstarFirm,
    firmName: 'Northstar Legal',
    email: 'ava@northstar.test',
    name: 'Ava Morgan',
    role: 'solicitor',
  };
  const partner: SessionUser = {
    ...user,
    id: SEED_IDS.partner,
    email: 'partner@northstar.test',
    name: 'Marcus Reed',
    role: 'partner',
  };
  const audit = {
    requestId: 'seed-repairs-quantum-evaluation',
    ipAddress: '127.0.0.1',
  };
  const workflowStore = new WorkflowStore(database, now);
  const protocolStore = new ProtocolStore(database, now, workflowStore);
  const protocol = new ProtocolService(database, protocolStore, '', now);
  const quantumStore = new QuantumStore(database, now);
  const quantum = new QuantumService(quantumStore, now);
  const workflow = new WorkflowService(
    new MatterStore(database, now),
    workflowStore,
    now,
    undefined,
    protocol,
    quantum,
  );

  let protocolWorkspace = protocol.getWorkspace(user, SEED_IDS.northstarMatter);
  if (!protocolWorkspace) throw new Error('The Maya protocol workspace is unavailable');
  let expert = protocolWorkspace.experts[0];
  if (!expert) throw new Error('The Maya expert engagement is unavailable');
  let report = expert.reports[0];
  if (!report) {
    report = protocol.recordExpertReport(
      user,
      SEED_IDS.northstarMatter,
      expert.id,
      {
        idempotencyKey: 'seed-expert-report-repairs-quantum',
        reportType: 'single_joint_report',
        reportOn: '2026-07-29',
        receivedOn: '2026-07-30',
        coverageSummary:
          'The synthetic report covers the recorded conditions, specifies repair works and identifies the bedroom works as urgent.',
        urgentWorksIdentified: true,
        documentVersionId: SEED_IDS.repairVersion,
        supersedesReportId: null,
      },
      audit,
    );
  }
  protocolWorkspace = protocol.getWorkspace(user, SEED_IDS.northstarMatter)!;
  expert = protocolWorkspace.experts[0]!;
  if (!expert.milestones.some(({ eventType }) => eventType === 'report_reviewed')) {
    protocol.recordExpertMilestone(
      partner,
      SEED_IDS.northstarMatter,
      expert.id,
      {
        idempotencyKey: 'seed-expert-report-reviewed-repairs-quantum',
        instructionVersionId: expert.instructionVersions[0]!.id,
        eventType: 'report_reviewed',
        occurredAt: '2026-08-03T14:00:00.000Z',
        legalTriggerOn: null,
        detail:
          'Marcus Reed reviewed the synthetic report, its limitations and the proposed schedule of works.',
        supportingDocumentVersionId: SEED_IDS.repairVersion,
        supersedesEventId: null,
        correctionReason: '',
      },
      audit,
    );
  }

  let matterWorkflow = workflowStore.getMatterWorkflow(user.firmId, SEED_IDS.northstarMatter);
  if (!matterWorkflow) throw new Error('The Maya workflow is unavailable');
  if (matterWorkflow.currentStage.key === 'protocol') {
    workflow.transitionStage(
      user,
      SEED_IDS.northstarMatter,
      {
        toStageKey: 'expert',
        expectedVersion: matterWorkflow.version,
        completedChecklistKeys: ['letter_of_claim_sent'],
        reason: 'The governed protocol record is complete and expert evidence is underway.',
      },
      audit,
    );
    matterWorkflow = workflowStore.getMatterWorkflow(user.firmId, SEED_IDS.northstarMatter)!;
  }
  if (matterWorkflow.currentStage.key === 'expert') {
    workflow.transitionStage(
      user,
      SEED_IDS.northstarMatter,
      {
        toStageKey: 'repairs_quantum',
        expectedVersion: matterWorkflow.version,
        completedChecklistKeys: ['expert_instruction_confirmed'],
        reason: 'The expert report has been received and reviewed for repairs and quantum.',
      },
      audit,
    );
  }

  let quantumWorkspace = quantum.getWorkspace(user, SEED_IDS.northstarMatter);
  let workSchedule = quantumWorkspace.workSchedules[0];
  if (!workSchedule) {
    workSchedule = quantum.createWorkSchedule(
      user,
      SEED_IDS.northstarMatter,
      {
        title: 'Elena Ward synthetic schedule of works',
        sourceType: 'expert_report',
        sourceDocumentVersionId: SEED_IDS.repairVersion,
        basedOnScheduleId: null,
        items: [
          {
            lineageKey: 'bedroom-damp-treatment',
            area: 'Main bedroom',
            description: 'Remedy water ingress, treat damp and mould, and reinstate the affected finishes.',
            responsibilityPosition: 'disputed',
            priority: 'urgent',
            targetStartOn: '2026-08-05',
            targetCompletionOn: '2026-08-12',
            estimatedCostMinor: 125_000,
            contractor: 'Meridian Repairs (synthetic)',
            sourceNote: 'Transcribed from the fictional expert report and checked by Ava Morgan.',
            defectIds: [SEED_IDS.bedroomDampDefect],
            evidenceItemIds: [SEED_IDS.bedroomPhotoEvidence, SEED_IDS.repairEvidence],
          },
          {
            lineageKey: 'bathroom-leak-repair',
            area: 'Bathroom',
            description: 'Repair the bath-edge leak and reinstate water-damaged finishes.',
            responsibilityPosition: 'agreed',
            priority: 'high',
            targetStartOn: '2026-08-04',
            targetCompletionOn: '2026-08-08',
            estimatedCostMinor: 48_000,
            contractor: 'Meridian Repairs (synthetic)',
            sourceNote: 'Transcribed from the fictional expert report and checked by Ava Morgan.',
            defectIds: [SEED_IDS.bathroomLeakDefect],
            evidenceItemIds: [SEED_IDS.bathroomPhotoEvidence],
          },
        ],
      },
      audit,
    );
  }
  const bedroom = workSchedule.items.find(({ lineageKey }) => lineageKey === 'bedroom-damp-treatment')!;
  const bathroom = workSchedule.items.find(({ lineageKey }) => lineageKey === 'bathroom-leak-repair')!;
  const repairEvents = [
    {
      workItemId: bedroom.id,
      idempotencyKey: 'seed-bedroom-completion-asserted',
      eventType: 'completion_asserted' as const,
      occurredAt: '2026-08-12T16:00:00.000Z',
      actorType: 'contractor' as const,
      note: 'The synthetic contractor asserted that the bedroom works were complete.',
      evidenceItemIds: [SEED_IDS.repairEvidence],
      verifier: '',
    },
    {
      workItemId: bedroom.id,
      idempotencyKey: 'seed-bedroom-completion-disputed',
      eventType: 'client_disputes_completion' as const,
      occurredAt: '2026-08-13T09:30:00.000Z',
      actorType: 'client' as const,
      note: 'Maya reports that damp remains visible and disputes completion of the bedroom works.',
      evidenceItemIds: [SEED_IDS.bedroomPhotoEvidence],
      verifier: '',
    },
    {
      workItemId: bathroom.id,
      idempotencyKey: 'seed-bathroom-verified-complete',
      eventType: 'verified_complete' as const,
      occurredAt: '2026-08-09T11:00:00.000Z',
      actorType: 'expert' as const,
      note: 'The fictional expert independently verified completion of the bathroom repair.',
      evidenceItemIds: [SEED_IDS.bathroomPhotoEvidence],
      verifier: 'Elena Ward, fictional building surveyor',
    },
  ];
  for (const event of repairEvents) {
    quantum.recordRepairEvent(
      user,
      SEED_IDS.northstarMatter,
      event.workItemId,
      {
        idempotencyKey: event.idempotencyKey,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        actorType: event.actorType,
        note: event.note,
        appointmentFrom: null,
        appointmentTo: null,
        evidenceItemIds: event.evidenceItemIds,
        verifier: event.verifier,
        supersedesEventId: null,
        correctionReason: '',
      },
      audit,
    );
  }
  quantumWorkspace = quantum.getWorkspace(user, SEED_IDS.northstarMatter);
  workSchedule = quantumWorkspace.workSchedules[0]!;
  if (workSchedule.status === 'draft') {
    const warningKeys = [...new Set(
      workSchedule.items.flatMap(({ projection }) => projection.warnings.map(({ key }) => key)),
    )];
    quantum.approveWorkSchedule(
      partner,
      SEED_IDS.northstarMatter,
      workSchedule.id,
      {
        expectedVersion: workSchedule.recordVersion,
        idempotencyKey: 'seed-work-schedule-approved',
        approvalNote: 'Marcus Reed reviewed the current assertions, client dispute, verification and warnings.',
        acknowledgedWarningKeys: warningKeys,
      },
      audit,
    );
  }

  quantumWorkspace = quantum.getWorkspace(user, SEED_IDS.northstarMatter);
  let lossSchedule = quantumWorkspace.lossSchedules[0];
  if (!lossSchedule) {
    lossSchedule = quantum.createLossSchedule(
      user,
      SEED_IDS.northstarMatter,
      {
        title: 'Maya Clarke synthetic schedule of loss',
        valuationOn: '2026-08-20',
        currency: 'GBP',
        basedOnScheduleId: null,
        notes: 'Evaluation-only figures requiring retained evidence and solicitor review.',
      },
      audit,
    );
    lossSchedule = quantum.addLossItem(
      user,
      SEED_IDS.northstarMatter,
      lossSchedule.id,
      {
        expectedVersion: lossSchedule.recordVersion,
        lineageKey: 'additional-heating-q1',
        category: 'additional_heating',
        description: 'Additional electric heating during the damp period.',
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
        sourceNote: 'Checked against the synthetic heating attendance record.',
        evidenceItemIds: [SEED_IDS.repairEvidence],
      },
      audit,
    );
    lossSchedule = quantum.addLossItem(
      user,
      SEED_IDS.northstarMatter,
      lossSchedule.id,
      {
        expectedVersion: lossSchedule.recordVersion,
        lineageKey: 'damaged-bedroom-belongings',
        category: 'damaged_belongings',
        description: 'Replacement of synthetic bedroom furnishings damaged by mould.',
        periodStartOn: null,
        periodEndOn: null,
        calculationType: 'fixed',
        quantity: null,
        unitLabel: '',
        rateMinor: null,
        fixedAmountMinor: 9_000,
        manualAmountMinor: null,
        manualBasis: '',
        position: 'claimed',
        evidenceStatus: 'supported',
        sourceNote: 'Supported by the retained synthetic bedroom photograph and client schedule.',
        evidenceItemIds: [SEED_IDS.bedroomPhotoEvidence],
      },
      audit,
    );
  }
  if (lossSchedule.status === 'draft') {
    const gapIds = lossSchedule.items
      .filter(({ evidenceStatus }) => ['partial', 'missing'].includes(evidenceStatus))
      .map(({ id }) => id);
    quantum.approveLossSchedule(
      partner,
      SEED_IDS.northstarMatter,
      lossSchedule.id,
      {
        expectedVersion: lossSchedule.recordVersion,
        idempotencyKey: 'seed-loss-schedule-approved',
        approvalNote: 'Marcus Reed reviewed the calculations and explicitly acknowledged the partial evidence.',
        acknowledgedEvidenceGapItemIds: gapIds,
      },
      audit,
    );
  }

  quantumWorkspace = quantum.getWorkspace(user, SEED_IDS.northstarMatter);
  if (quantumWorkspace.generalDamagesReviews.length === 0) {
    quantum.createGeneralDamagesReview(
      partner,
      SEED_IDS.northstarMatter,
      {
        idempotencyKey: 'seed-general-damages-review',
        valuationOn: '2026-08-20',
        lowMinor: 200_000,
        highMinor: 350_000,
        preferredMinor: 275_000,
        basis: 'Human solicitor review of the synthetic expert and client evidence for pilot evaluation.',
        authorities: ['Current authorities and Judicial College materials must be rechecked before reliance.'],
        evidenceItemIds: [SEED_IDS.bedroomPhotoEvidence, SEED_IDS.repairEvidence],
        reviewNote: 'This is a human-entered evaluation range, not an AI-generated legal valuation.',
        supersedesReviewId: null,
        nonePresentlyAdvanced: false,
      },
      audit,
    );
  }

  quantumWorkspace = quantum.getWorkspace(user, SEED_IDS.northstarMatter);
  if (quantumWorkspace.openOffers.length === 0) {
    quantum.createOffer(
      user,
      SEED_IDS.northstarMatter,
      {
        idempotencyKey: 'seed-open-protocol-offer',
        direction: 'defendant',
        offerType: 'protocol_compensation',
        confidentiality: 'open',
        scope: 'whole_claim',
        scopeDescription: 'Synthetic open proposal covering works and compensation.',
        damagesMinor: 300_000,
        costsMinor: null,
        totalMinor: null,
        currency: 'GBP',
        worksTerms: 'Complete the approved synthetic works schedule within 28 days.',
        nonMoneyTerms: '',
        interestTreatment: '',
        writtenOfferDocumentVersionId: null,
        madeOn: '2026-08-07',
        part36: null,
      },
      audit,
    );
  }
  let protectedOffers = quantum.getProtectedOffers(user, SEED_IDS.northstarMatter);
  let protectedOffer = protectedOffers[0];
  if (!protectedOffer) {
    protectedOffer = quantum.createOffer(
      user,
      SEED_IDS.northstarMatter,
      {
        idempotencyKey: 'seed-protected-part36-offer',
        direction: 'defendant',
        offerType: 'part_36',
        confidentiality: 'protected_costs',
        scope: 'whole_claim',
        scopeDescription: 'Synthetic Part 36 terms for the whole damages claim.',
        damagesMinor: 450_000,
        costsMinor: null,
        totalMinor: null,
        currency: 'GBP',
        worksTerms: 'Complete the approved synthetic works schedule within 28 days.',
        nonMoneyTerms: '',
        interestTreatment: 'Inclusive of interest to the date of the fictional offer.',
        writtenOfferDocumentVersionId: SEED_IDS.complaintVersion,
        madeOn: '2026-08-10',
        part36: {
          relevantPeriodDays: 21,
          relevantPeriodBasis: 'Calendar-day projection for solicitor review; no legal conclusion is generated.',
          includesCounterclaim: false,
          paymentPeriodDays: 14,
        },
      },
      audit,
    );
  }
  if (protectedOffer.part36?.validationStatus === 'unreviewed') {
    quantum.reviewPart36(
      partner,
      SEED_IDS.northstarMatter,
      protectedOffer.id,
      {
        expectedVersion: protectedOffer.recordVersion,
        idempotencyKey: 'seed-part36-human-review',
        serviceOn: '2026-08-10',
        serviceConfirmed: true,
        validationStatus: 'reviewed',
        validationNote: 'Marcus Reed confirmed the recorded service date and reviewed the projected period.',
      },
      audit,
    );
  }
}
