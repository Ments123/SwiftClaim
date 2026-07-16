import { defineMigration } from './types.js';

const communicationsSql = String.raw`
  CREATE TABLE communication_conversations (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN (
      'email', 'whatsapp', 'telephone', 'letter', 'portal', 'sms',
      'in_person', 'internal'
    )),
    subject TEXT NOT NULL DEFAULT '',
    confidentiality TEXT NOT NULL CHECK (confidentiality IN (
      'ordinary', 'internal', 'privileged', 'protected_negotiation'
    )),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    provider_key TEXT,
    external_thread_id TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id),
    UNIQUE (firm_id, provider_key, external_thread_id)
  ) STRICT;

  CREATE TABLE communication_participants (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    party_id TEXT,
    user_id TEXT,
    role TEXT NOT NULL CHECK (role IN (
      'from', 'to', 'cc', 'bcc', 'caller', 'callee', 'attendee',
      'author', 'recipient'
    )),
    display_name TEXT NOT NULL,
    endpoint_type TEXT NOT NULL CHECK (endpoint_type IN (
      'email', 'phone', 'whatsapp', 'postal_address', 'portal',
      'user', 'unknown'
    )),
    endpoint TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id, firm_id, matter_id)
      REFERENCES communication_conversations(id, firm_id, matter_id)
      ON DELETE CASCADE,
    FOREIGN KEY (party_id, firm_id)
      REFERENCES parties(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (user_id, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE communication_entries (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN (
      'email', 'whatsapp', 'telephone', 'letter', 'portal', 'sms',
      'in_person', 'internal'
    )),
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'internal')),
    confidentiality TEXT NOT NULL CHECK (confidentiality IN (
      'ordinary', 'internal', 'privileged', 'protected_negotiation'
    )),
    participants_json TEXT NOT NULL CHECK (
      json_valid(participants_json) AND json_type(participants_json) = 'array'
    ),
    subject TEXT NOT NULL DEFAULT '',
    body_text TEXT NOT NULL,
    body_format TEXT NOT NULL CHECK (body_format IN ('plain', 'html', 'structured_note')),
    occurred_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    recorded_by TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('manual', 'provider', 'import', 'system')),
    provider_key TEXT,
    external_message_id TEXT,
    external_thread_id TEXT,
    supersedes_entry_id TEXT,
    correction_reason TEXT NOT NULL DEFAULT '',
    idempotency_key TEXT NOT NULL,
    command_payload_json TEXT NOT NULL CHECK (json_valid(command_payload_json)),
    CHECK (supersedes_entry_id IS NULL OR length(correction_reason) >= 10),
    FOREIGN KEY (conversation_id, firm_id, matter_id)
      REFERENCES communication_conversations(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (recorded_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_entry_id, firm_id, matter_id)
      REFERENCES communication_entries(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (firm_id, provider_key, external_message_id),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE communication_drafts (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN (
      'email', 'whatsapp', 'telephone', 'letter', 'portal', 'sms',
      'in_person', 'internal'
    )),
    confidentiality TEXT NOT NULL CHECK (confidentiality IN (
      'ordinary', 'internal', 'privileged', 'protected_negotiation'
    )),
    status TEXT NOT NULL CHECK (status IN (
      'draft', 'pending_approval', 'approved', 'rejected',
      'dispatched', 'cancelled'
    )),
    record_version INTEGER NOT NULL DEFAULT 1 CHECK (record_version > 0),
    current_draft_version_id TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id, firm_id, matter_id)
      REFERENCES communication_conversations(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (updated_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE communication_draft_versions (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    draft_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    participants_json TEXT NOT NULL CHECK (
      json_valid(participants_json) AND json_type(participants_json) = 'array'
    ),
    subject TEXT NOT NULL DEFAULT '',
    body_text TEXT NOT NULL,
    body_format TEXT NOT NULL CHECK (body_format IN ('plain', 'html', 'structured_note')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (draft_id, firm_id, matter_id)
      REFERENCES communication_drafts(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (draft_id, version),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE communication_attachments (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    entry_id TEXT,
    draft_version_id TEXT,
    document_id TEXT NOT NULL,
    document_version_id TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN (
      'attachment', 'recording', 'transcript', 'call_note',
      'delivery_evidence', 'service_evidence', 'other'
    )),
    file_name TEXT NOT NULL,
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK ((entry_id IS NOT NULL) <> (draft_version_id IS NOT NULL)),
    FOREIGN KEY (entry_id, firm_id, matter_id)
      REFERENCES communication_entries(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (draft_version_id, firm_id, matter_id)
      REFERENCES communication_draft_versions(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (document_id, firm_id, matter_id)
      REFERENCES documents(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (document_version_id, firm_id, document_id)
      REFERENCES document_versions(id, firm_id, document_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (entry_id, document_version_id, purpose),
    UNIQUE (draft_version_id, document_version_id, purpose),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE communication_approval_events (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    draft_id TEXT NOT NULL,
    draft_version_id TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN (
      'submitted', 'approved', 'rejected', 'approval_revoked'
    )),
    note TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    actor_user_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    FOREIGN KEY (draft_id, firm_id, matter_id)
      REFERENCES communication_drafts(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (draft_version_id, firm_id, matter_id)
      REFERENCES communication_draft_versions(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (actor_user_id, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE communication_dispatches (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    draft_id TEXT NOT NULL,
    draft_version_id TEXT NOT NULL,
    provider_key TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
      'queued', 'attempting', 'provider_accepted', 'delivered',
      'failed', 'read', 'cancelled'
    )),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    external_message_id TEXT,
    last_error_code TEXT,
    last_error_detail TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_event_at TEXT NOT NULL,
    FOREIGN KEY (entry_id, firm_id, matter_id)
      REFERENCES communication_entries(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (draft_id, firm_id, matter_id)
      REFERENCES communication_drafts(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (draft_version_id, firm_id, matter_id)
      REFERENCES communication_draft_versions(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, provider_key, idempotency_key),
    UNIQUE (entry_id),
    UNIQUE (draft_version_id),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE communication_provider_events (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    dispatch_id TEXT NOT NULL,
    provider_key TEXT NOT NULL,
    provider_event_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
      'queued', 'attempting', 'provider_accepted', 'delivered',
      'failed', 'read', 'cancelled'
    )),
    authenticated INTEGER NOT NULL CHECK (authenticated IN (0, 1)),
    authentication_method TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    safe_payload_json TEXT NOT NULL CHECK (json_valid(safe_payload_json)),
    FOREIGN KEY (dispatch_id, firm_id, matter_id)
      REFERENCES communication_dispatches(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    UNIQUE (firm_id, provider_key, provider_event_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE communication_call_sessions (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    provider_key TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
    purpose TEXT NOT NULL,
    outcome TEXT NOT NULL,
    identity_check_status TEXT NOT NULL CHECK (identity_check_status IN (
      'not_recorded', 'confirmed', 'failed'
    )),
    identity_check_note TEXT NOT NULL DEFAULT '',
    recording_status TEXT NOT NULL CHECK (recording_status IN (
      'not_recorded', 'notice_given', 'consent_recorded',
      'recorded', 'unavailable'
    )),
    notice_consent_basis TEXT NOT NULL DEFAULT '',
    notice_consent_actor_user_id TEXT,
    external_call_id TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (ended_at >= started_at),
    CHECK (
      recording_status NOT IN ('notice_given', 'consent_recorded', 'recorded')
      OR length(notice_consent_basis) >= 10
    ),
    FOREIGN KEY (entry_id, firm_id, matter_id)
      REFERENCES communication_entries(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (notice_consent_actor_user_id, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (entry_id),
    UNIQUE (firm_id, provider_key, external_call_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE communication_service_assertions (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    asserted_method TEXT NOT NULL,
    service_at TEXT NOT NULL,
    recipient TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    source_document_id TEXT,
    source_document_version_id TEXT,
    factual_note TEXT NOT NULL DEFAULT '',
    review_status TEXT NOT NULL CHECK (review_status IN (
      'unreviewed', 'reviewed', 'disputed'
    )),
    asserted_by TEXT NOT NULL,
    asserted_at TEXT NOT NULL,
    reviewed_by TEXT,
    reviewed_at TEXT,
    FOREIGN KEY (entry_id, firm_id, matter_id)
      REFERENCES communication_entries(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (source_document_id, firm_id, matter_id)
      REFERENCES documents(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_document_version_id, firm_id, source_document_id)
      REFERENCES document_versions(id, firm_id, document_id) ON DELETE RESTRICT,
    FOREIGN KEY (asserted_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (reviewed_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE communication_command_receipts (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    command_type TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
    entity_id TEXT NOT NULL,
    response_json TEXT NOT NULL CHECK (json_valid(response_json)),
    created_at TEXT NOT NULL,
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    UNIQUE (firm_id, matter_id, command_type, idempotency_key),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE INDEX idx_communication_conversations_matter
    ON communication_conversations(firm_id, matter_id, created_at DESC);
  CREATE INDEX idx_communication_entries_matter
    ON communication_entries(firm_id, matter_id, occurred_at DESC);
  CREATE INDEX idx_communication_entries_conversation
    ON communication_entries(firm_id, matter_id, conversation_id, occurred_at);
  CREATE INDEX idx_communication_drafts_matter
    ON communication_drafts(firm_id, matter_id, updated_at DESC);
  CREATE INDEX idx_communication_dispatches_matter
    ON communication_dispatches(firm_id, matter_id, last_event_at DESC);
  CREATE INDEX idx_communication_provider_events_dispatch
    ON communication_provider_events(firm_id, matter_id, dispatch_id, occurred_at);

  CREATE TRIGGER communication_conversations_no_delete
  BEFORE DELETE ON communication_conversations BEGIN
    SELECT RAISE(ABORT, 'communication conversations cannot be deleted');
  END;
  CREATE TRIGGER communication_participants_no_update
  BEFORE UPDATE ON communication_participants BEGIN
    SELECT RAISE(ABORT, 'communication participants are immutable');
  END;
  CREATE TRIGGER communication_participants_no_delete
  BEFORE DELETE ON communication_participants BEGIN
    SELECT RAISE(ABORT, 'communication participants are immutable');
  END;
  CREATE TRIGGER communication_entries_no_update
  BEFORE UPDATE ON communication_entries BEGIN
    SELECT RAISE(ABORT, 'communication entries are append-only');
  END;
  CREATE TRIGGER communication_entries_no_delete
  BEFORE DELETE ON communication_entries BEGIN
    SELECT RAISE(ABORT, 'communication entries are append-only');
  END;
  CREATE TRIGGER communication_draft_versions_no_update
  BEFORE UPDATE ON communication_draft_versions BEGIN
    SELECT RAISE(ABORT, 'communication draft versions are immutable');
  END;
  CREATE TRIGGER communication_draft_versions_no_delete
  BEFORE DELETE ON communication_draft_versions BEGIN
    SELECT RAISE(ABORT, 'communication draft versions are immutable');
  END;
  CREATE TRIGGER communication_attachments_no_update
  BEFORE UPDATE ON communication_attachments BEGIN
    SELECT RAISE(ABORT, 'communication attachments are immutable');
  END;
  CREATE TRIGGER communication_attachments_no_delete
  BEFORE DELETE ON communication_attachments BEGIN
    SELECT RAISE(ABORT, 'communication attachments are immutable');
  END;
  CREATE TRIGGER communication_approval_events_no_update
  BEFORE UPDATE ON communication_approval_events BEGIN
    SELECT RAISE(ABORT, 'communication approval events are append-only');
  END;
  CREATE TRIGGER communication_approval_events_no_delete
  BEFORE DELETE ON communication_approval_events BEGIN
    SELECT RAISE(ABORT, 'communication approval events are append-only');
  END;
  CREATE TRIGGER communication_provider_events_no_update
  BEFORE UPDATE ON communication_provider_events BEGIN
    SELECT RAISE(ABORT, 'communication provider events are append-only');
  END;
  CREATE TRIGGER communication_provider_events_no_delete
  BEFORE DELETE ON communication_provider_events BEGIN
    SELECT RAISE(ABORT, 'communication provider events are append-only');
  END;
  CREATE TRIGGER communication_call_sessions_no_update
  BEFORE UPDATE ON communication_call_sessions BEGIN
    SELECT RAISE(ABORT, 'communication call sessions are immutable');
  END;
  CREATE TRIGGER communication_call_sessions_no_delete
  BEFORE DELETE ON communication_call_sessions BEGIN
    SELECT RAISE(ABORT, 'communication call sessions are immutable');
  END;
  CREATE TRIGGER communication_service_assertions_no_update
  BEFORE UPDATE ON communication_service_assertions BEGIN
    SELECT RAISE(ABORT, 'communication service assertions are immutable');
  END;
  CREATE TRIGGER communication_service_assertions_no_delete
  BEFORE DELETE ON communication_service_assertions BEGIN
    SELECT RAISE(ABORT, 'communication service assertions are immutable');
  END;
  CREATE TRIGGER communication_command_receipts_no_update
  BEFORE UPDATE ON communication_command_receipts BEGIN
    SELECT RAISE(ABORT, 'communication command receipts are immutable');
  END;
  CREATE TRIGGER communication_command_receipts_no_delete
  BEFORE DELETE ON communication_command_receipts BEGIN
    SELECT RAISE(ABORT, 'communication command receipts are immutable');
  END;
`;

export const communicationsMigration = defineMigration({
  version: 7,
  name: 'governed communications',
  sql: communicationsSql,
});
