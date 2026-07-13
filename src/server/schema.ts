export const secureMatterSpineSql = String.raw`
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
