import { defineMigration } from './types.js';

const defectsNoticeEvidenceSql = String.raw`
  CREATE TABLE defects (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    location TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN (
      'damp_mould', 'leak', 'heating', 'electrical', 'structural', 'pest',
      'ventilation', 'sanitation', 'other'
    )),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN (
      'low', 'moderate', 'serious', 'critical'
    )),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
      'open', 'monitoring', 'repaired', 'disputed', 'superseded'
    )),
    first_observed_on TEXT,
    health_impact TEXT NOT NULL DEFAULT '',
    hazard_tags_json TEXT NOT NULL DEFAULT '[]'
      CHECK (json_valid(hazard_tags_json) AND json_type(hazard_tags_json) = 'array'),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (updated_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE defect_status_events (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    defect_id TEXT NOT NULL,
    from_status TEXT CHECK (from_status IS NULL OR from_status IN (
      'open', 'monitoring', 'repaired', 'disputed', 'superseded'
    )),
    to_status TEXT NOT NULL CHECK (to_status IN (
      'open', 'monitoring', 'repaired', 'disputed', 'superseded'
    )),
    reason TEXT NOT NULL,
    actor_user_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    FOREIGN KEY (defect_id, firm_id, matter_id)
      REFERENCES defects(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (actor_user_id, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE notices (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN (
      'email', 'phone', 'sms', 'whatsapp', 'letter', 'portal', 'in_person',
      'other'
    )),
    recipient_type TEXT NOT NULL CHECK (recipient_type IN (
      'landlord', 'managing_agent', 'contractor', 'local_authority', 'other'
    )),
    recipient_name TEXT NOT NULL,
    summary TEXT NOT NULL,
    proof_status TEXT NOT NULL CHECK (proof_status IN (
      'linked', 'client_recollection', 'unavailable', 'unknown'
    )),
    response_status TEXT NOT NULL CHECK (response_status IN (
      'none', 'acknowledged', 'inspection_arranged', 'repair_promised',
      'repair_attempted', 'repaired', 'disputed', 'other'
    )),
    response_summary TEXT NOT NULL DEFAULT '',
    supersedes_notice_id TEXT,
    idempotency_key TEXT NOT NULL,
    command_payload_json TEXT NOT NULL CHECK (json_valid(command_payload_json)),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (supersedes_notice_id, firm_id, matter_id)
      REFERENCES notices(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id, matter_id),
    UNIQUE (firm_id, matter_id, idempotency_key)
  ) STRICT;

  CREATE TABLE access_events (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
      'offered', 'scheduled', 'attempted', 'completed',
      'refused_by_landlord', 'refused_by_client', 'no_access', 'cancelled'
    )),
    appointment_at TEXT,
    notes TEXT NOT NULL,
    supersedes_access_event_id TEXT,
    idempotency_key TEXT NOT NULL,
    command_payload_json TEXT NOT NULL CHECK (json_valid(command_payload_json)),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (supersedes_access_event_id, firm_id, matter_id)
      REFERENCES access_events(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id, matter_id),
    UNIQUE (firm_id, matter_id, idempotency_key)
  ) STRICT;

  CREATE TABLE evidence_items (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN (
      'photograph', 'video', 'correspondence', 'repair_record',
      'tenancy_record', 'medical_link', 'client_statement', 'other'
    )),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    occurred_on TEXT,
    provenance_source TEXT NOT NULL CHECK (provenance_source IN (
      'client', 'solicitor', 'landlord', 'managing_agent', 'contractor',
      'expert', 'medical_provider', 'third_party', 'other'
    )),
    provenance_detail TEXT NOT NULL,
    document_version_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    command_payload_json TEXT NOT NULL CHECK (json_valid(command_payload_json)),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (document_version_id, firm_id)
      REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id, matter_id),
    UNIQUE (firm_id, matter_id, idempotency_key)
  ) STRICT;

  CREATE TABLE defect_evidence_links (
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    evidence_item_id TEXT NOT NULL,
    defect_id TEXT NOT NULL,
    linked_by TEXT NOT NULL,
    linked_at TEXT NOT NULL,
    PRIMARY KEY (firm_id, matter_id, evidence_item_id, defect_id),
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (evidence_item_id, firm_id, matter_id)
      REFERENCES evidence_items(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (defect_id, firm_id, matter_id)
      REFERENCES defects(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (linked_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT
  ) STRICT;

  CREATE TABLE notice_evidence_links (
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    evidence_item_id TEXT NOT NULL,
    notice_id TEXT NOT NULL,
    linked_by TEXT NOT NULL,
    linked_at TEXT NOT NULL,
    PRIMARY KEY (firm_id, matter_id, evidence_item_id, notice_id),
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (evidence_item_id, firm_id, matter_id)
      REFERENCES evidence_items(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (notice_id, firm_id, matter_id)
      REFERENCES notices(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (linked_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT
  ) STRICT;

  CREATE TABLE access_evidence_links (
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    evidence_item_id TEXT NOT NULL,
    access_event_id TEXT NOT NULL,
    linked_by TEXT NOT NULL,
    linked_at TEXT NOT NULL,
    PRIMARY KEY (firm_id, matter_id, evidence_item_id, access_event_id),
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (evidence_item_id, firm_id, matter_id)
      REFERENCES evidence_items(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (access_event_id, firm_id, matter_id)
      REFERENCES access_events(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (linked_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT
  ) STRICT;

  CREATE INDEX idx_defects_matter
    ON defects(firm_id, matter_id, status, location, updated_at DESC);
  CREATE INDEX idx_defect_status_history
    ON defect_status_events(firm_id, matter_id, defect_id, occurred_at DESC);
  CREATE INDEX idx_notices_matter
    ON notices(firm_id, matter_id, occurred_at DESC);
  CREATE INDEX idx_access_events_matter
    ON access_events(firm_id, matter_id, appointment_at DESC, created_at DESC);
  CREATE INDEX idx_evidence_items_matter
    ON evidence_items(firm_id, matter_id, occurred_on DESC, created_at DESC);

  CREATE TRIGGER defect_status_events_no_update
  BEFORE UPDATE ON defect_status_events BEGIN
    SELECT RAISE(ABORT, 'defect_status_events is append-only');
  END;
  CREATE TRIGGER defect_status_events_no_delete
  BEFORE DELETE ON defect_status_events BEGIN
    SELECT RAISE(ABORT, 'defect_status_events is append-only');
  END;
  CREATE TRIGGER notices_no_update
  BEFORE UPDATE ON notices BEGIN
    SELECT RAISE(ABORT, 'notices is append-only');
  END;
  CREATE TRIGGER notices_no_delete
  BEFORE DELETE ON notices BEGIN
    SELECT RAISE(ABORT, 'notices is append-only');
  END;
  CREATE TRIGGER access_events_no_update
  BEFORE UPDATE ON access_events BEGIN
    SELECT RAISE(ABORT, 'access_events is append-only');
  END;
  CREATE TRIGGER access_events_no_delete
  BEFORE DELETE ON access_events BEGIN
    SELECT RAISE(ABORT, 'access_events is append-only');
  END;
  CREATE TRIGGER evidence_items_no_update
  BEFORE UPDATE ON evidence_items BEGIN
    SELECT RAISE(ABORT, 'evidence_items is append-only');
  END;
  CREATE TRIGGER evidence_items_no_delete
  BEFORE DELETE ON evidence_items BEGIN
    SELECT RAISE(ABORT, 'evidence_items is append-only');
  END;
  CREATE TRIGGER defect_evidence_links_no_update
  BEFORE UPDATE ON defect_evidence_links BEGIN
    SELECT RAISE(ABORT, 'defect_evidence_links is append-only');
  END;
  CREATE TRIGGER defect_evidence_links_no_delete
  BEFORE DELETE ON defect_evidence_links BEGIN
    SELECT RAISE(ABORT, 'defect_evidence_links is append-only');
  END;
  CREATE TRIGGER notice_evidence_links_no_update
  BEFORE UPDATE ON notice_evidence_links BEGIN
    SELECT RAISE(ABORT, 'notice_evidence_links is append-only');
  END;
  CREATE TRIGGER notice_evidence_links_no_delete
  BEFORE DELETE ON notice_evidence_links BEGIN
    SELECT RAISE(ABORT, 'notice_evidence_links is append-only');
  END;
  CREATE TRIGGER access_evidence_links_no_update
  BEFORE UPDATE ON access_evidence_links BEGIN
    SELECT RAISE(ABORT, 'access_evidence_links is append-only');
  END;
  CREATE TRIGGER access_evidence_links_no_delete
  BEFORE DELETE ON access_evidence_links BEGIN
    SELECT RAISE(ABORT, 'access_evidence_links is append-only');
  END;
`;

export const defectsNoticeEvidenceMigration = defineMigration({
  version: 4,
  name: 'defects notice and evidence',
  sql: defectsNoticeEvidenceSql,
});
