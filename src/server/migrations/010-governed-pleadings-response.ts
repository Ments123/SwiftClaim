import { defineMigration } from './types.js';

const governedPleadingsResponseSql = String.raw`
  CREATE TABLE claim_response_tracks (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, proceeding_id TEXT NOT NULL,
    claimant_party_id TEXT NOT NULL, defendant_party_id TEXT NOT NULL,
    claim_form_document_version_id TEXT NOT NULL, particulars_document_version_id TEXT,
    regime TEXT NOT NULL CHECK (regime IN ('part_7_domestic','part_7_service_out','part_8','court_directed','manual_review')),
    service_record_id TEXT, current_state TEXT NOT NULL DEFAULT 'open', version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (proceeding_id, firm_id, matter_id) REFERENCES court_proceedings(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (claimant_party_id, firm_id) REFERENCES parties(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (defendant_party_id, firm_id) REFERENCES parties(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (claim_form_document_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (particulars_document_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (service_record_id, firm_id, matter_id) REFERENCES court_service_records(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, proceeding_id, claimant_party_id, defendant_party_id),
    UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE claim_response_track_events (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, track_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('track_opened','service_basis_recorded','regime_confirmed','response_source_date_recorded','deadline_reviewed','extension_recorded','stay_recorded','stay_lifted','track_closed','correction')),
    occurred_at TEXT NOT NULL, note TEXT NOT NULL, source_document_version_id TEXT, supersedes_event_id TEXT,
    correction_reason TEXT NOT NULL DEFAULT '', recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (track_id, firm_id, matter_id) REFERENCES claim_response_tracks(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (source_document_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_event_id, firm_id, matter_id) REFERENCES claim_response_track_events(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (recorded_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE statements_of_case (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, proceeding_id TEXT NOT NULL, track_id TEXT,
    statement_type TEXT NOT NULL CHECK (statement_type IN ('claim_form','particulars','acknowledgment_of_service','defence','reply','counterclaim','defence_to_counterclaim','part_8_acknowledgment','amended_statement','other')),
    party_id TEXT NOT NULL, current_version_id TEXT, version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (proceeding_id, firm_id, matter_id) REFERENCES court_proceedings(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (track_id, firm_id, matter_id) REFERENCES claim_response_tracks(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (party_id, firm_id) REFERENCES parties(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE statement_of_case_versions (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, statement_id TEXT NOT NULL,
    version_number INTEGER NOT NULL CHECK (version_number > 0), document_version_id TEXT NOT NULL,
    predecessor_version_id TEXT, prepared_by_user_id TEXT NOT NULL,
    statement_of_truth_status TEXT NOT NULL CHECK (statement_of_truth_status IN ('not_applicable','required_unconfirmed','present_unsigned','signed','defective_or_disputed','not_reviewed')),
    signatory_name TEXT NOT NULL DEFAULT '', signatory_capacity TEXT NOT NULL DEFAULT '', signed_at TEXT,
    response_position TEXT NOT NULL CHECK (response_position IN ('defend_all','defend_part','admit_all','admit_part','jurisdiction_challenged','counterclaim_included','not_recorded')),
    amendment_route TEXT NOT NULL CHECK (amendment_route IN ('before_service','written_consent','court_permission','court_direction','not_applicable')),
    amendment_reason TEXT NOT NULL DEFAULT '', consent_document_version_id TEXT, application_id TEXT, sealed_order_id TEXT,
    idempotency_key TEXT NOT NULL, command_payload_json TEXT NOT NULL CHECK (json_valid(command_payload_json)), created_at TEXT NOT NULL,
    FOREIGN KEY (statement_id, firm_id, matter_id) REFERENCES statements_of_case(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (document_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (predecessor_version_id, firm_id, matter_id) REFERENCES statement_of_case_versions(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (prepared_by_user_id, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (consent_document_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id, firm_id, matter_id) REFERENCES court_applications(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (sealed_order_id, firm_id, matter_id) REFERENCES court_orders(id, firm_id, matter_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, statement_id, version_number), UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE statement_of_case_events (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, statement_id TEXT NOT NULL, statement_version_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('prepared','approved_for_filing','filed','provider_acknowledged','court_accepted','served','rejected','withdrawn','corrected','superseded','permission_granted','permission_refused')),
    occurred_at TEXT NOT NULL, note TEXT NOT NULL, filing_id TEXT, service_record_id TEXT, source_document_version_id TEXT,
    supersedes_event_id TEXT, correction_reason TEXT NOT NULL DEFAULT '', recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (statement_id, firm_id, matter_id) REFERENCES statements_of_case(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (statement_version_id, firm_id, matter_id) REFERENCES statement_of_case_versions(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (filing_id, firm_id, matter_id) REFERENCES court_filings(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (service_record_id, firm_id, matter_id) REFERENCES court_service_records(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_document_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_event_id, firm_id, matter_id) REFERENCES statement_of_case_events(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (recorded_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE statement_amendment_authorities (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL,
    statement_id TEXT NOT NULL, statement_version_id TEXT NOT NULL,
    route TEXT NOT NULL CHECK (route IN ('before_service','written_consent','court_permission','court_direction')),
    consent_document_version_id TEXT, application_id TEXT, sealed_order_id TEXT,
    reviewed_by TEXT NOT NULL, reviewed_at TEXT NOT NULL, note TEXT NOT NULL,
    idempotency_key TEXT NOT NULL, command_payload_json TEXT NOT NULL CHECK (json_valid(command_payload_json)),
    created_at TEXT NOT NULL,
    FOREIGN KEY (statement_id, firm_id, matter_id) REFERENCES statements_of_case(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (statement_version_id, firm_id, matter_id) REFERENCES statement_of_case_versions(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (consent_document_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (application_id, firm_id, matter_id) REFERENCES court_applications(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (sealed_order_id, firm_id, matter_id) REFERENCES court_orders(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (reviewed_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE pleading_deadline_projections (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, track_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('acknowledgment','defence','reply','counterclaim_response','amended_statement_filing','amended_statement_service')),
    outcome TEXT NOT NULL CHECK (outcome IN ('projected','source_date','manual_court_period_required','blocked_missing_facts','superseded')),
    trigger_date TEXT, projected_date TEXT, source_document_version_id TEXT, rule_key TEXT NOT NULL DEFAULT '',
    rule_version TEXT NOT NULL DEFAULT '', source_title TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL DEFAULT '',
    calculation_inputs_json TEXT NOT NULL CHECK (json_valid(calculation_inputs_json)), reviewed_by TEXT,
    reviewed_at TEXT, supersedes_projection_id TEXT, created_at TEXT NOT NULL,
    FOREIGN KEY (track_id, firm_id, matter_id) REFERENCES claim_response_tracks(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (source_document_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (reviewed_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_projection_id, firm_id, matter_id) REFERENCES pleading_deadline_projections(id, firm_id, matter_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE default_judgment_reviews (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, track_id TEXT NOT NULL,
    statement_version_id TEXT, deadline_projection_id TEXT, claim_type TEXT NOT NULL, requested_method TEXT NOT NULL,
    outcome TEXT NOT NULL DEFAULT 'review_incomplete' CHECK (outcome IN ('review_incomplete','blockers_recorded','human_review_completed')),
    blockers_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(blockers_json)), note TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0), reviewed_by TEXT, reviewed_at TEXT,
    created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (track_id, firm_id, matter_id) REFERENCES claim_response_tracks(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (statement_version_id, firm_id, matter_id) REFERENCES statement_of_case_versions(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (deadline_projection_id, firm_id, matter_id) REFERENCES pleading_deadline_projections(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (reviewed_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE default_judgment_review_items (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, review_id TEXT NOT NULL,
    item_key TEXT NOT NULL, label TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('unreviewed','confirmed','blocker','not_applicable')),
    source_document_version_id TEXT, note TEXT NOT NULL DEFAULT '', recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (review_id, firm_id, matter_id) REFERENCES default_judgment_reviews(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (source_document_version_id, firm_id) REFERENCES document_versions(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (recorded_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, review_id, item_key), UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE default_judgment_review_events (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL,
    review_id TEXT NOT NULL, outcome TEXT NOT NULL CHECK (outcome IN ('review_incomplete','blockers_recorded','human_review_completed')),
    blockers_json TEXT NOT NULL CHECK (json_valid(blockers_json)), note TEXT NOT NULL,
    reviewed_by TEXT NOT NULL, reviewed_at TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (review_id, firm_id, matter_id) REFERENCES default_judgment_reviews(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (reviewed_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE pleadings_command_receipts (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, proceeding_id TEXT NOT NULL,
    command_scope TEXT NOT NULL, route_entity_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
    input_hash TEXT NOT NULL CHECK (length(input_hash) = 64), response_json TEXT NOT NULL CHECK (json_valid(response_json)),
    created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (proceeding_id, firm_id, matter_id) REFERENCES court_proceedings(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, command_scope, idempotency_key), UNIQUE (id, firm_id)
  ) STRICT;

  CREATE INDEX idx_response_tracks_proceeding ON claim_response_tracks(firm_id, matter_id, proceeding_id, updated_at DESC);
  CREATE INDEX idx_statement_versions_statement ON statement_of_case_versions(firm_id, matter_id, statement_id, version_number DESC);
  CREATE INDEX idx_pleading_deadlines_track ON pleading_deadline_projections(firm_id, matter_id, track_id, projected_date);

  CREATE TRIGGER claim_response_track_events_no_update BEFORE UPDATE ON claim_response_track_events BEGIN SELECT RAISE(ABORT, 'claim response track events are append-only'); END;
  CREATE TRIGGER claim_response_track_events_no_delete BEFORE DELETE ON claim_response_track_events BEGIN SELECT RAISE(ABORT, 'claim response track events are append-only'); END;
  CREATE TRIGGER statement_of_case_versions_no_update BEFORE UPDATE ON statement_of_case_versions BEGIN SELECT RAISE(ABORT, 'statement of case versions are immutable'); END;
  CREATE TRIGGER statement_of_case_versions_no_delete BEFORE DELETE ON statement_of_case_versions BEGIN SELECT RAISE(ABORT, 'statement of case versions are immutable'); END;
  CREATE TRIGGER statement_of_case_events_no_update BEFORE UPDATE ON statement_of_case_events BEGIN SELECT RAISE(ABORT, 'statement of case events are append-only'); END;
  CREATE TRIGGER statement_of_case_events_no_delete BEFORE DELETE ON statement_of_case_events BEGIN SELECT RAISE(ABORT, 'statement of case events are append-only'); END;
  CREATE TRIGGER statement_amendment_authorities_no_update BEFORE UPDATE ON statement_amendment_authorities BEGIN SELECT RAISE(ABORT, 'statement amendment authorities are immutable'); END;
  CREATE TRIGGER statement_amendment_authorities_no_delete BEFORE DELETE ON statement_amendment_authorities BEGIN SELECT RAISE(ABORT, 'statement amendment authorities are immutable'); END;
  CREATE TRIGGER pleading_deadline_projections_no_update BEFORE UPDATE ON pleading_deadline_projections BEGIN SELECT RAISE(ABORT, 'pleading deadline projections are immutable'); END;
  CREATE TRIGGER pleading_deadline_projections_no_delete BEFORE DELETE ON pleading_deadline_projections BEGIN SELECT RAISE(ABORT, 'pleading deadline projections are immutable'); END;
  CREATE TRIGGER default_judgment_review_items_no_update BEFORE UPDATE ON default_judgment_review_items BEGIN SELECT RAISE(ABORT, 'default judgment review items are immutable'); END;
  CREATE TRIGGER default_judgment_review_items_no_delete BEFORE DELETE ON default_judgment_review_items BEGIN SELECT RAISE(ABORT, 'default judgment review items are immutable'); END;
  CREATE TRIGGER default_judgment_review_events_no_update BEFORE UPDATE ON default_judgment_review_events BEGIN SELECT RAISE(ABORT, 'default judgment review events are append-only'); END;
  CREATE TRIGGER default_judgment_review_events_no_delete BEFORE DELETE ON default_judgment_review_events BEGIN SELECT RAISE(ABORT, 'default judgment review events are append-only'); END;
  CREATE TRIGGER pleadings_command_receipts_no_update BEFORE UPDATE ON pleadings_command_receipts BEGIN SELECT RAISE(ABORT, 'pleadings command receipts are immutable'); END;
  CREATE TRIGGER pleadings_command_receipts_no_delete BEFORE DELETE ON pleadings_command_receipts BEGIN SELECT RAISE(ABORT, 'pleadings command receipts are immutable'); END;
`;

export const governedPleadingsResponseMigration = defineMigration({
  version: 10,
  name: 'governed pleadings and response control',
  sql: governedPleadingsResponseSql,
});
