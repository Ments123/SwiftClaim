import { DatabaseSync } from 'node:sqlite';

import { hashPassword } from './security.js';

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

const schema = String.raw`
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS firms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'partner', 'solicitor', 'paralegal', 'finance', 'readonly')),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL,
    FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    FOREIGN KEY (user_id, firm_id) REFERENCES users(id, firm_id) ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE IF NOT EXISTS matters (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    reference TEXT NOT NULL,
    title TEXT NOT NULL,
    client_name TEXT NOT NULL,
    matter_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'on_hold', 'closed', 'archived')),
    stage TEXT NOT NULL,
    risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
    owner_user_id TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    external_source TEXT,
    external_id TEXT,
    import_batch_id TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT,
    FOREIGN KEY (owner_user_id, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, reference),
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS matter_members (
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    access_level TEXT NOT NULL CHECK (access_level IN ('read', 'write')),
    added_at TEXT NOT NULL,
    PRIMARY KEY (matter_id, user_id),
    FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, firm_id) REFERENCES users(id, firm_id) ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE IF NOT EXISTS parties (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('client', 'opponent', 'solicitor', 'barrister', 'expert', 'witness', 'court', 'insurer', 'other')),
    name TEXT NOT NULL,
    organisation TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    external_source TEXT,
    external_id TEXT,
    import_batch_id TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    due_at TEXT NOT NULL,
    priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
    assignee_user_id TEXT NOT NULL,
    completed_at TEXT,
    external_source TEXT,
    external_id TEXT,
    import_batch_id TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (assignee_user_id, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    external_source TEXT,
    external_id TEXT,
    import_batch_id TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS document_versions (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    storage_key TEXT NOT NULL UNIQUE,
    uploaded_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (document_id, firm_id) REFERENCES documents(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (uploaded_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (document_id, version),
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS timeline_events (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    actor_user_id TEXT,
    occurred_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (actor_user_id, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT,
    user_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    request_id TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT,
    FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (user_id, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash, expires_at);
  CREATE INDEX IF NOT EXISTS idx_matters_firm_updated ON matters(firm_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_matter_members_user ON matter_members(firm_id, user_id, matter_id);
  CREATE INDEX IF NOT EXISTS idx_parties_matter ON parties(firm_id, matter_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(firm_id, status, due_at);
  CREATE INDEX IF NOT EXISTS idx_documents_matter ON documents(firm_id, matter_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_timeline_matter ON timeline_events(firm_id, matter_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_matter ON audit_events(firm_id, matter_id, created_at DESC);

  CREATE TRIGGER IF NOT EXISTS audit_events_no_update
  BEFORE UPDATE ON audit_events
  BEGIN
    SELECT RAISE(ABORT, 'audit_events is append-only');
  END;

  CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
  BEFORE DELETE ON audit_events
  BEGIN
    SELECT RAISE(ABORT, 'audit_events is append-only');
  END;

  CREATE TRIGGER IF NOT EXISTS document_versions_no_update
  BEFORE UPDATE ON document_versions
  BEGIN
    SELECT RAISE(ABORT, 'document_versions is immutable');
  END;

  CREATE TRIGGER IF NOT EXISTS document_versions_no_delete
  BEFORE DELETE ON document_versions
  BEGIN
    SELECT RAISE(ABORT, 'document_versions is immutable');
  END;

  CREATE TRIGGER IF NOT EXISTS timeline_events_no_update
  BEFORE UPDATE ON timeline_events
  BEGIN
    SELECT RAISE(ABORT, 'timeline_events is append-only');
  END;

  CREATE TRIGGER IF NOT EXISTS timeline_events_no_delete
  BEFORE DELETE ON timeline_events
  BEGIN
    SELECT RAISE(ABORT, 'timeline_events is append-only');
  END;
`;

export function createDatabase(path: string): DatabaseSync {
  const database = new DatabaseSync(path);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  database.exec(schema);
  database
    .prepare(
      'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, ?)',
    )
    .run(new Date().toISOString());

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
        title: 'Clarke v Meridian Insurance',
        clientName: 'Elaine Clarke',
        matterType: 'Personal injury litigation',
        stage: 'Disclosure',
        riskLevel: 'high',
        ownerUserId: SEED_IDS.ava,
        openedAt: '2026-03-02',
        description:
          'High-value personal injury claim concerning disputed causation and future loss.',
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
      'Elaine Clarke',
      '',
      'elaine.clarke@example.test',
      '+44 7700 900123',
      '42 Fielding Road, Leeds',
      'PC-10492',
      SEED_IDS.ava,
      now,
    );
    insertParty.run(
      SEED_IDS.northstarOpponent,
      SEED_IDS.northstarFirm,
      SEED_IDS.northstarMatter,
      'opponent',
      'Meridian Insurance plc',
      'Meridian Insurance plc',
      'claims@meridian.example.test',
      '+44 20 7946 0911',
      '1 Meridian Square, London',
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
      'Serve disclosure list',
      'Confirm privileged material has been excluded before service.',
      '2026-07-14T16:00:00.000Z',
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
      'Approve orthopaedic expert letter',
      'Review the revised questions with counsel comments.',
      '2026-07-16T11:00:00.000Z',
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
      'Review defendant disclosure',
      'Flag gaps for the disclosure issues list.',
      '2026-07-11T15:00:00.000Z',
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
      'The matter was opened from Proclaim reference NCL-2026-0017.',
      SEED_IDS.ava,
      '2026-03-02T09:15:00.000Z',
      '{}',
    );
    insertTimeline.run(
      '60000000-0000-4000-8000-000000000002',
      SEED_IDS.northstarFirm,
      SEED_IDS.northstarMatter,
      'stage.changed',
      'Moved to disclosure',
      'Pleadings closed and the disclosure phase began.',
      SEED_IDS.ava,
      '2026-07-07T14:20:00.000Z',
      '{}',
    );
    insertTimeline.run(
      '60000000-0000-4000-8000-000000000003',
      SEED_IDS.northstarFirm,
      SEED_IDS.northstarMatter,
      'task.created',
      'Deadline added: Serve disclosure list',
      'Due 14 July 2026 at 17:00.',
      SEED_IDS.ava,
      now,
      '{}',
    );

    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
