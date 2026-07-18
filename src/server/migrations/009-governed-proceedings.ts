import { defineMigration } from './types.js';

const governedProceedingsSql = String.raw`
  CREATE TABLE court_proceedings (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    proceeding_reference TEXT NOT NULL,
    procedure_type TEXT NOT NULL CHECK (procedure_type IN ('part7', 'part8')),
    jurisdiction TEXT NOT NULL CHECK (jurisdiction = 'england_wales'),
    court_name TEXT NOT NULL,
    court_code TEXT,
    hearing_centre TEXT,
    case_number TEXT,
    track TEXT CHECK (track IS NULL OR track IN ('small_claims', 'fast', 'intermediate', 'multi')),
    current_state TEXT NOT NULL DEFAULT 'preparing',
    current_authority_version_id TEXT,
    sealed_claim_form_version_id TEXT,
    issued_at TEXT,
    disposal_position TEXT NOT NULL DEFAULT 'unreviewed' CHECK (disposal_position IN ('unreviewed', 'reviewed', 'disputed')),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (sealed_claim_form_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, proceeding_reference),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE proceeding_authority_versions (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    proceeding_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    client_instruction_id TEXT NOT NULL,
    procedure_type TEXT NOT NULL CHECK (procedure_type IN ('part7', 'part8')),
    scope TEXT NOT NULL,
    defendant_party_ids_json TEXT NOT NULL CHECK (json_valid(defendant_party_ids_json)),
    claim_form_document_version_id TEXT NOT NULL,
    particulars_document_version_id TEXT,
    prepared_by_user_id TEXT NOT NULL,
    approved_by_user_id TEXT NOT NULL,
    limitation_position TEXT NOT NULL,
    risks TEXT NOT NULL,
    review_note TEXT NOT NULL,
    expires_at TEXT,
    review_on TEXT,
    explicit_approval INTEGER NOT NULL CHECK (explicit_approval = 1),
    idempotency_key TEXT NOT NULL,
    command_payload_json TEXT NOT NULL CHECK (json_valid(command_payload_json)),
    created_at TEXT NOT NULL,
    FOREIGN KEY (proceeding_id, firm_id, matter_id) REFERENCES court_proceedings(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (client_instruction_id, firm_id, matter_id) REFERENCES client_instructions(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (claim_form_document_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (particulars_document_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (prepared_by_user_id, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (approved_by_user_id, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, proceeding_id, version),
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE court_proceeding_events (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    proceeding_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
      'authority_recorded','issue_request_prepared','issue_request_submitted','issued',
      'case_number_corrected','transferred','allocated','stayed','restored','discontinued',
      'dismissed','judgment_entered','closed_by_court','disposal_position_reviewed','correction'
    )),
    occurred_at TEXT NOT NULL,
    note TEXT NOT NULL,
    source_document_version_id TEXT,
    court_name TEXT NOT NULL DEFAULT '',
    case_number TEXT NOT NULL DEFAULT '',
    track TEXT,
    supersedes_event_id TEXT,
    correction_reason TEXT NOT NULL DEFAULT '',
    recorded_by TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    FOREIGN KEY (proceeding_id, firm_id, matter_id) REFERENCES court_proceedings(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (source_document_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (recorded_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_event_id, firm_id, matter_id) REFERENCES court_proceeding_events(id, firm_id, matter_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE court_documents (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    proceeding_id TEXT NOT NULL,
    document_version_id TEXT NOT NULL,
    document_type TEXT NOT NULL CHECK (document_type IN (
      'claim_form','particulars','response_pack','acknowledgment','defence','reply','counterclaim',
      'directions_questionnaire','application_notice','evidence','draft_order','sealed_order',
      'judgment','listing_notice','witness_statement','disclosure_document','expert_document',
      'bundle','costs_document','certificate_of_service','other'
    )),
    title TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (proceeding_id, firm_id, matter_id) REFERENCES court_proceedings(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (document_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, proceeding_id, document_version_id),
    UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE court_filings (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    proceeding_id TEXT NOT NULL,
    filing_reference TEXT NOT NULL,
    purpose TEXT NOT NULL,
    submission_channel TEXT NOT NULL,
    fee_position TEXT NOT NULL,
    fee_minor INTEGER,
    currency TEXT NOT NULL,
    current_state TEXT NOT NULL DEFAULT 'prepared',
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (proceeding_id, firm_id, matter_id) REFERENCES court_proceedings(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, proceeding_id, filing_reference),
    UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE court_filing_documents (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    filing_id TEXT NOT NULL,
    document_version_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    created_at TEXT NOT NULL,
    FOREIGN KEY (filing_id, firm_id, matter_id) REFERENCES court_filings(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (document_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, filing_id, document_version_id),
    UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE court_filing_events (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    filing_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('prepared','submitted','acknowledged','accepted','rejected','withdrawn','corrected')),
    occurred_at TEXT NOT NULL,
    note TEXT NOT NULL,
    receipt_document_version_id TEXT,
    external_reference TEXT,
    rejection_reason TEXT NOT NULL DEFAULT '',
    supersedes_event_id TEXT,
    correction_reason TEXT NOT NULL DEFAULT '',
    recorded_by TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    FOREIGN KEY (filing_id, firm_id, matter_id) REFERENCES court_filings(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (receipt_document_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (recorded_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_event_id, firm_id, matter_id) REFERENCES court_filing_events(id, firm_id, matter_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE court_service_records (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    proceeding_id TEXT NOT NULL,
    service_reference TEXT NOT NULL,
    court_document_version_id TEXT NOT NULL,
    recipient_party_id TEXT NOT NULL,
    method TEXT NOT NULL,
    service_address TEXT NOT NULL,
    jurisdiction_position TEXT NOT NULL,
    current_state TEXT NOT NULL DEFAULT 'prepared',
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (proceeding_id, firm_id, matter_id) REFERENCES court_proceedings(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (court_document_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (recipient_party_id, firm_id) REFERENCES parties(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, proceeding_id, service_reference),
    UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE court_service_events (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    service_record_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('prepared','step_completed','delivery_evidence_received','returned','disputed','human_reviewed','set_aside','corrected')),
    occurred_at TEXT NOT NULL,
    note TEXT NOT NULL,
    precise_step TEXT NOT NULL DEFAULT '',
    asserted_service_at TEXT,
    asserted_deemed_service_at TEXT,
    review_position TEXT NOT NULL,
    rule_source_title TEXT NOT NULL DEFAULT '',
    rule_source_url TEXT NOT NULL DEFAULT '',
    evidence_document_version_ids_json TEXT NOT NULL CHECK (json_valid(evidence_document_version_ids_json)),
    evidence_communication_entry_ids_json TEXT NOT NULL CHECK (json_valid(evidence_communication_entry_ids_json)),
    supersedes_event_id TEXT,
    correction_reason TEXT NOT NULL DEFAULT '',
    recorded_by TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    FOREIGN KEY (service_record_id, firm_id, matter_id) REFERENCES court_service_records(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (recorded_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_event_id, firm_id, matter_id) REFERENCES court_service_events(id, firm_id, matter_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE court_applications (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    proceeding_id TEXT NOT NULL,
    application_reference TEXT NOT NULL,
    applicant_party_id TEXT NOT NULL,
    respondent_party_ids_json TEXT NOT NULL CHECK (json_valid(respondent_party_ids_json)),
    requested_order TEXT NOT NULL,
    grounds_summary TEXT NOT NULL,
    notice_position TEXT NOT NULL,
    hearing_required_position TEXT NOT NULL,
    application_notice_version_id TEXT NOT NULL,
    evidence_document_version_ids_json TEXT NOT NULL CHECK (json_valid(evidence_document_version_ids_json)),
    draft_order_version_id TEXT,
    current_state TEXT NOT NULL DEFAULT 'prepared',
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (proceeding_id, firm_id, matter_id) REFERENCES court_proceedings(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (applicant_party_id, firm_id) REFERENCES parties(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (application_notice_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (draft_order_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, proceeding_id, application_reference),
    UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE court_application_events (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, application_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('prepared','filed','served','listed','granted','refused','withdrawn','disposed','corrected')),
    occurred_at TEXT NOT NULL, note TEXT NOT NULL, source_document_version_id TEXT, resulting_order_id TEXT,
    supersedes_event_id TEXT, correction_reason TEXT NOT NULL DEFAULT '', recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (application_id, firm_id, matter_id) REFERENCES court_applications(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (source_document_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (recorded_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_event_id, firm_id, matter_id) REFERENCES court_application_events(id, firm_id, matter_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE court_orders (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, proceeding_id TEXT NOT NULL,
    order_reference TEXT NOT NULL, order_type TEXT NOT NULL, title TEXT NOT NULL, order_date TEXT NOT NULL,
    takes_effect_at TEXT NOT NULL, judge_name TEXT NOT NULL DEFAULT '', judicial_title TEXT NOT NULL DEFAULT '',
    sealed_document_version_id TEXT NOT NULL, varies_order_id TEXT, supersedes_order_id TEXT,
    service_position TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (proceeding_id, firm_id, matter_id) REFERENCES court_proceedings(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (sealed_document_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (varies_order_id, firm_id, matter_id) REFERENCES court_orders(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_order_id, firm_id, matter_id) REFERENCES court_orders(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, proceeding_id, order_reference), UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE court_directions (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, proceeding_id TEXT NOT NULL,
    direction_reference TEXT NOT NULL, source_order_id TEXT, rule_source_title TEXT NOT NULL DEFAULT '',
    rule_source_url TEXT NOT NULL DEFAULT '', responsible_party_id TEXT NOT NULL, category TEXT NOT NULL,
    requirement_text TEXT NOT NULL, due_at TEXT, timezone TEXT NOT NULL, sanction_expressly_stated INTEGER NOT NULL CHECK (sanction_expressly_stated IN (0,1)),
    sanction_text TEXT NOT NULL DEFAULT '', assigned_user_id TEXT, current_state TEXT NOT NULL DEFAULT 'open',
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0), created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (proceeding_id, firm_id, matter_id) REFERENCES court_proceedings(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (source_order_id, firm_id, matter_id) REFERENCES court_orders(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (responsible_party_id, firm_id) REFERENCES parties(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (assigned_user_id, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, proceeding_id, direction_reference), UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE court_direction_events (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, direction_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('created','assigned','performance_asserted','evidence_linked','satisfied','disputed','extended','stayed','resumed','relief_applied','relief_granted','relief_refused','waived_by_order','superseded','corrected')),
    occurred_at TEXT NOT NULL, note TEXT NOT NULL, evidence_document_version_ids_json TEXT NOT NULL CHECK (json_valid(evidence_document_version_ids_json)),
    evidence_filing_ids_json TEXT NOT NULL CHECK (json_valid(evidence_filing_ids_json)), evidence_service_record_ids_json TEXT NOT NULL CHECK (json_valid(evidence_service_record_ids_json)),
    source_order_id TEXT, revised_due_at TEXT, supersedes_event_id TEXT, correction_reason TEXT NOT NULL DEFAULT '',
    recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (direction_id, firm_id, matter_id) REFERENCES court_directions(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (source_order_id, firm_id, matter_id) REFERENCES court_orders(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (recorded_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_event_id, firm_id, matter_id) REFERENCES court_direction_events(id, firm_id, matter_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE court_hearings (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, proceeding_id TEXT NOT NULL,
    hearing_reference TEXT NOT NULL, hearing_type TEXT NOT NULL, title TEXT NOT NULL, listing_notice_version_id TEXT NOT NULL,
    starts_at TEXT NOT NULL, ends_at TEXT, timezone TEXT NOT NULL, court_name TEXT NOT NULL, venue TEXT NOT NULL DEFAULT '',
    attendance_mode TEXT NOT NULL, remote_access_details TEXT NOT NULL DEFAULT '', privacy_position TEXT NOT NULL,
    judge_name TEXT NOT NULL DEFAULT '', advocate_names_json TEXT NOT NULL CHECK (json_valid(advocate_names_json)),
    attendee_names_json TEXT NOT NULL CHECK (json_valid(attendee_names_json)), bundle_document_version_id TEXT,
    current_state TEXT NOT NULL DEFAULT 'listed', version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (proceeding_id, firm_id, matter_id) REFERENCES court_proceedings(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (listing_notice_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (bundle_document_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, proceeding_id, hearing_reference), UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE court_hearing_events (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, hearing_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('listed','relisted','adjourned','vacated','started','completed','outcome_recorded','corrected')),
    occurred_at TEXT NOT NULL, note TEXT NOT NULL, source_document_version_id TEXT, resulting_order_id TEXT,
    revised_starts_at TEXT, supersedes_event_id TEXT, correction_reason TEXT NOT NULL DEFAULT '', recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (hearing_id, firm_id, matter_id) REFERENCES court_hearings(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (source_document_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (resulting_order_id, firm_id, matter_id) REFERENCES court_orders(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (recorded_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_event_id, firm_id, matter_id) REFERENCES court_hearing_events(id, firm_id, matter_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE proceedings_command_receipts (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, proceeding_id TEXT,
    command_scope TEXT NOT NULL, route_entity_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
    input_hash TEXT NOT NULL CHECK (length(input_hash) = 64), response_json TEXT NOT NULL CHECK (json_valid(response_json)),
    created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (proceeding_id, firm_id, matter_id) REFERENCES court_proceedings(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, command_scope, idempotency_key), UNIQUE (id, firm_id)
  ) STRICT;

  CREATE INDEX idx_court_proceedings_matter ON court_proceedings(firm_id, matter_id, active, updated_at DESC);
  CREATE INDEX idx_court_filings_proceeding ON court_filings(firm_id, matter_id, proceeding_id, updated_at DESC);
  CREATE INDEX idx_court_service_proceeding ON court_service_records(firm_id, matter_id, proceeding_id, updated_at DESC);
  CREATE INDEX idx_court_directions_due ON court_directions(firm_id, matter_id, proceeding_id, due_at);
  CREATE INDEX idx_court_hearings_start ON court_hearings(firm_id, matter_id, proceeding_id, starts_at);

  CREATE TRIGGER proceeding_authority_versions_no_update BEFORE UPDATE ON proceeding_authority_versions BEGIN SELECT RAISE(ABORT, 'proceeding authority versions are immutable'); END;
  CREATE TRIGGER proceeding_authority_versions_no_delete BEFORE DELETE ON proceeding_authority_versions BEGIN SELECT RAISE(ABORT, 'proceeding authority versions are immutable'); END;
  CREATE TRIGGER court_proceeding_events_no_update BEFORE UPDATE ON court_proceeding_events BEGIN SELECT RAISE(ABORT, 'court proceeding events are append-only'); END;
  CREATE TRIGGER court_proceeding_events_no_delete BEFORE DELETE ON court_proceeding_events BEGIN SELECT RAISE(ABORT, 'court proceeding events are append-only'); END;
  CREATE TRIGGER court_documents_no_update BEFORE UPDATE ON court_documents BEGIN SELECT RAISE(ABORT, 'court documents are immutable'); END;
  CREATE TRIGGER court_documents_no_delete BEFORE DELETE ON court_documents BEGIN SELECT RAISE(ABORT, 'court documents are immutable'); END;
  CREATE TRIGGER court_filing_documents_no_update BEFORE UPDATE ON court_filing_documents BEGIN SELECT RAISE(ABORT, 'court filing documents are immutable'); END;
  CREATE TRIGGER court_filing_documents_no_delete BEFORE DELETE ON court_filing_documents BEGIN SELECT RAISE(ABORT, 'court filing documents are immutable'); END;
  CREATE TRIGGER court_filing_events_no_update BEFORE UPDATE ON court_filing_events BEGIN SELECT RAISE(ABORT, 'court filing events are append-only'); END;
  CREATE TRIGGER court_filing_events_no_delete BEFORE DELETE ON court_filing_events BEGIN SELECT RAISE(ABORT, 'court filing events are append-only'); END;
  CREATE TRIGGER court_service_events_no_update BEFORE UPDATE ON court_service_events BEGIN SELECT RAISE(ABORT, 'court service events are append-only'); END;
  CREATE TRIGGER court_service_events_no_delete BEFORE DELETE ON court_service_events BEGIN SELECT RAISE(ABORT, 'court service events are append-only'); END;
  CREATE TRIGGER court_application_events_no_update BEFORE UPDATE ON court_application_events BEGIN SELECT RAISE(ABORT, 'court application events are append-only'); END;
  CREATE TRIGGER court_application_events_no_delete BEFORE DELETE ON court_application_events BEGIN SELECT RAISE(ABORT, 'court application events are append-only'); END;
  CREATE TRIGGER court_orders_no_update BEFORE UPDATE ON court_orders BEGIN SELECT RAISE(ABORT, 'court orders are immutable'); END;
  CREATE TRIGGER court_orders_no_delete BEFORE DELETE ON court_orders BEGIN SELECT RAISE(ABORT, 'court orders are immutable'); END;
  CREATE TRIGGER court_direction_events_no_update BEFORE UPDATE ON court_direction_events BEGIN SELECT RAISE(ABORT, 'court direction events are append-only'); END;
  CREATE TRIGGER court_direction_events_no_delete BEFORE DELETE ON court_direction_events BEGIN SELECT RAISE(ABORT, 'court direction events are append-only'); END;
  CREATE TRIGGER court_hearing_events_no_update BEFORE UPDATE ON court_hearing_events BEGIN SELECT RAISE(ABORT, 'court hearing events are append-only'); END;
  CREATE TRIGGER court_hearing_events_no_delete BEFORE DELETE ON court_hearing_events BEGIN SELECT RAISE(ABORT, 'court hearing events are append-only'); END;
  CREATE TRIGGER proceedings_command_receipts_no_update BEFORE UPDATE ON proceedings_command_receipts BEGIN SELECT RAISE(ABORT, 'proceedings command receipts are immutable'); END;
  CREATE TRIGGER proceedings_command_receipts_no_delete BEFORE DELETE ON proceedings_command_receipts BEGIN SELECT RAISE(ABORT, 'proceedings command receipts are immutable'); END;
`;

export const governedProceedingsMigration = defineMigration({
  version: 9,
  name: 'governed proceedings',
  sql: governedProceedingsSql,
});
