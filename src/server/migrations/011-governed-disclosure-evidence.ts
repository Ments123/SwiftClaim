import { defineMigration } from './types.js';

const sql = String.raw`
  CREATE TABLE disclosure_reviews (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, proceeding_id TEXT NOT NULL,
    disclosing_party_id TEXT NOT NULL, direction_id TEXT, scope_version INTEGER NOT NULL DEFAULT 1,
    scope_note TEXT NOT NULL, date_from TEXT, date_to TEXT, custodians_json TEXT NOT NULL CHECK(json_valid(custodians_json)),
    issue_tags_json TEXT NOT NULL CHECK(json_valid(issue_tags_json)), version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (proceeding_id, firm_id, matter_id) REFERENCES court_proceedings(id, firm_id, matter_id),
    FOREIGN KEY (disclosing_party_id, firm_id) REFERENCES parties(id, firm_id),
    FOREIGN KEY (direction_id, firm_id, matter_id) REFERENCES court_directions(id, firm_id, matter_id),
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id),
    UNIQUE(firm_id, matter_id, proceeding_id, disclosing_party_id, scope_version),
    UNIQUE(id, firm_id), UNIQUE(id, firm_id, matter_id)
  ) STRICT;
  CREATE TABLE disclosure_review_events (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, review_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK(event_type IN ('opened','scope_recorded','human_review_completed','superseded')),
    note TEXT NOT NULL, occurred_at TEXT NOT NULL, recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (review_id, firm_id, matter_id) REFERENCES disclosure_reviews(id, firm_id, matter_id),
    FOREIGN KEY (recorded_by, firm_id) REFERENCES users(id, firm_id),
    UNIQUE(id, firm_id), UNIQUE(id, firm_id, matter_id)
  ) STRICT;
  CREATE TABLE disclosure_documents (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, review_id TEXT NOT NULL,
    document_version_id TEXT NOT NULL, evidence_item_id TEXT, custodian TEXT NOT NULL DEFAULT '', source_note TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (review_id, firm_id, matter_id) REFERENCES disclosure_reviews(id, firm_id, matter_id),
    FOREIGN KEY (document_version_id, firm_id) REFERENCES document_versions(id, firm_id),
    FOREIGN KEY (evidence_item_id, firm_id, matter_id) REFERENCES evidence_items(id, firm_id, matter_id),
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id),
    UNIQUE(firm_id, matter_id, review_id, document_version_id), UNIQUE(id, firm_id), UNIQUE(id, firm_id, matter_id)
  ) STRICT;
  CREATE TABLE disclosure_ai_suggestions (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
    relevance TEXT NOT NULL CHECK(relevance IN ('likely_relevant','likely_not_relevant','uncertain')),
    privilege_warning TEXT NOT NULL CHECK(privilege_warning IN ('none','possible','likely')),
    rationale TEXT NOT NULL, model TEXT NOT NULL, policy_version TEXT NOT NULL, source_hash TEXT NOT NULL CHECK(length(source_hash)=64),
    cited_spans_json TEXT NOT NULL CHECK(json_valid(cited_spans_json)), issue_tags_json TEXT NOT NULL CHECK(json_valid(issue_tags_json)),
    created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (candidate_id, firm_id, matter_id) REFERENCES disclosure_documents(id, firm_id, matter_id),
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id), UNIQUE(id, firm_id), UNIQUE(id, firm_id, matter_id)
  ) STRICT;
  CREATE TABLE disclosure_decisions (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
    decision TEXT NOT NULL CHECK(decision IN ('disclose','withhold_privilege','withhold_not_relevant','withhold_other','duplicate_only','review_required')),
    reason TEXT NOT NULL, redaction_required INTEGER NOT NULL CHECK(redaction_required IN (0,1)), supersedes_decision_id TEXT,
    reviewed_by TEXT NOT NULL, reviewed_at TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (candidate_id, firm_id, matter_id) REFERENCES disclosure_documents(id, firm_id, matter_id),
    FOREIGN KEY (supersedes_decision_id, firm_id, matter_id) REFERENCES disclosure_decisions(id, firm_id, matter_id),
    FOREIGN KEY (reviewed_by, firm_id) REFERENCES users(id, firm_id), UNIQUE(id, firm_id), UNIQUE(id, firm_id, matter_id)
  ) STRICT;
  CREATE TABLE disclosure_privilege_reviews (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('legal_advice','litigation','joint','without_prejudice_or_protected','other','none','uncertain')),
    outcome TEXT NOT NULL CHECK(outcome IN ('restricted','not_privileged','further_review','waived')),
    basis TEXT NOT NULL, authority_document_version_id TEXT, confirm_exposure INTEGER NOT NULL CHECK(confirm_exposure IN (0,1)),
    reviewed_by TEXT NOT NULL, reviewed_at TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (candidate_id, firm_id, matter_id) REFERENCES disclosure_documents(id, firm_id, matter_id),
    FOREIGN KEY (authority_document_version_id, firm_id) REFERENCES document_versions(id, firm_id),
    FOREIGN KEY (reviewed_by, firm_id) REFERENCES users(id, firm_id), UNIQUE(id, firm_id), UNIQUE(id, firm_id, matter_id)
  ) STRICT;
  CREATE TABLE disclosure_redactions (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
    original_document_version_id TEXT NOT NULL, redacted_document_version_id TEXT NOT NULL,
    categories_json TEXT NOT NULL CHECK(json_valid(categories_json)), reason TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('awaiting_review','approved','rejected')), visual_review_confirmed INTEGER NOT NULL CHECK(visual_review_confirmed IN (0,1)),
    reviewed_by TEXT NOT NULL, reviewed_at TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (candidate_id, firm_id, matter_id) REFERENCES disclosure_documents(id, firm_id, matter_id),
    FOREIGN KEY (original_document_version_id, firm_id) REFERENCES document_versions(id, firm_id),
    FOREIGN KEY (redacted_document_version_id, firm_id) REFERENCES document_versions(id, firm_id),
    FOREIGN KEY (reviewed_by, firm_id) REFERENCES users(id, firm_id), UNIQUE(id, firm_id), UNIQUE(id, firm_id, matter_id)
  ) STRICT;
  CREATE TABLE disclosure_lists (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, review_id TEXT NOT NULL,
    snapshot_number INTEGER NOT NULL CHECK(snapshot_number > 0), title TEXT NOT NULL, blockers_json TEXT NOT NULL CHECK(json_valid(blockers_json)),
    generated_by TEXT NOT NULL, generated_at TEXT NOT NULL, note TEXT NOT NULL,
    FOREIGN KEY (review_id, firm_id, matter_id) REFERENCES disclosure_reviews(id, firm_id, matter_id),
    FOREIGN KEY (generated_by, firm_id) REFERENCES users(id, firm_id), UNIQUE(firm_id, matter_id, review_id, snapshot_number),
    UNIQUE(id, firm_id), UNIQUE(id, firm_id, matter_id)
  ) STRICT;
  CREATE TABLE disclosure_list_entries (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, disclosure_list_id TEXT NOT NULL,
    candidate_id TEXT NOT NULL, document_version_id TEXT NOT NULL, decision_id TEXT NOT NULL, description TEXT NOT NULL,
    FOREIGN KEY (disclosure_list_id, firm_id, matter_id) REFERENCES disclosure_lists(id, firm_id, matter_id),
    FOREIGN KEY (candidate_id, firm_id, matter_id) REFERENCES disclosure_documents(id, firm_id, matter_id),
    FOREIGN KEY (document_version_id, firm_id) REFERENCES document_versions(id, firm_id),
    FOREIGN KEY (decision_id, firm_id, matter_id) REFERENCES disclosure_decisions(id, firm_id, matter_id),
    UNIQUE(firm_id, matter_id, disclosure_list_id, candidate_id), UNIQUE(id, firm_id), UNIQUE(id, firm_id, matter_id)
  ) STRICT;
  CREATE TABLE inspection_requests (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, disclosure_list_id TEXT NOT NULL,
    requesting_party_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), received_at TEXT NOT NULL,
    note TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (disclosure_list_id, firm_id, matter_id) REFERENCES disclosure_lists(id, firm_id, matter_id),
    FOREIGN KEY (requesting_party_id, firm_id) REFERENCES parties(id, firm_id),
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id), UNIQUE(id, firm_id), UNIQUE(id, firm_id, matter_id)
  ) STRICT;
  CREATE TABLE inspection_request_items (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, inspection_request_id TEXT NOT NULL, list_entry_id TEXT NOT NULL,
    FOREIGN KEY (inspection_request_id, firm_id, matter_id) REFERENCES inspection_requests(id, firm_id, matter_id),
    FOREIGN KEY (list_entry_id, firm_id, matter_id) REFERENCES disclosure_list_entries(id, firm_id, matter_id),
    UNIQUE(firm_id, matter_id, inspection_request_id, list_entry_id), UNIQUE(id, firm_id), UNIQUE(id, firm_id, matter_id)
  ) STRICT;
  CREATE TABLE inspection_events (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, inspection_request_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK(event_type IN ('received','acknowledged','refused','agreed','provided','completed')),
    provided_document_version_id TEXT, delivery_evidence_document_version_id TEXT, occurred_at TEXT NOT NULL, note TEXT NOT NULL,
    recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (inspection_request_id, firm_id, matter_id) REFERENCES inspection_requests(id, firm_id, matter_id),
    FOREIGN KEY (provided_document_version_id, firm_id) REFERENCES document_versions(id, firm_id),
    FOREIGN KEY (delivery_evidence_document_version_id, firm_id) REFERENCES document_versions(id, firm_id),
    FOREIGN KEY (recorded_by, firm_id) REFERENCES users(id, firm_id), UNIQUE(id, firm_id), UNIQUE(id, firm_id, matter_id)
  ) STRICT;
  CREATE TABLE disclosure_command_receipts (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, proceeding_id TEXT NOT NULL,
    command_scope TEXT NOT NULL, route_entity_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
    input_hash TEXT NOT NULL CHECK(length(input_hash)=64), response_json TEXT NOT NULL CHECK(json_valid(response_json)),
    created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (proceeding_id, firm_id, matter_id) REFERENCES court_proceedings(id, firm_id, matter_id),
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id),
    UNIQUE(firm_id, matter_id, command_scope, idempotency_key), UNIQUE(id, firm_id)
  ) STRICT;

  CREATE INDEX idx_disclosure_reviews_proceeding ON disclosure_reviews(firm_id,matter_id,proceeding_id,updated_at DESC);
  CREATE INDEX idx_disclosure_documents_review ON disclosure_documents(firm_id,matter_id,review_id,created_at);
  CREATE INDEX idx_inspection_requests_list ON inspection_requests(firm_id,matter_id,disclosure_list_id,created_at);

  CREATE TRIGGER disclosure_review_events_no_update BEFORE UPDATE ON disclosure_review_events BEGIN SELECT RAISE(ABORT,'disclosure review events are append-only'); END;
  CREATE TRIGGER disclosure_review_events_no_delete BEFORE DELETE ON disclosure_review_events BEGIN SELECT RAISE(ABORT,'disclosure review events are append-only'); END;
  CREATE TRIGGER disclosure_ai_suggestions_no_update BEFORE UPDATE ON disclosure_ai_suggestions BEGIN SELECT RAISE(ABORT,'disclosure AI suggestions are immutable'); END;
  CREATE TRIGGER disclosure_ai_suggestions_no_delete BEFORE DELETE ON disclosure_ai_suggestions BEGIN SELECT RAISE(ABORT,'disclosure AI suggestions are immutable'); END;
  CREATE TRIGGER disclosure_decisions_no_update BEFORE UPDATE ON disclosure_decisions BEGIN SELECT RAISE(ABORT,'disclosure decisions are append-only'); END;
  CREATE TRIGGER disclosure_decisions_no_delete BEFORE DELETE ON disclosure_decisions BEGIN SELECT RAISE(ABORT,'disclosure decisions are append-only'); END;
  CREATE TRIGGER disclosure_privilege_reviews_no_update BEFORE UPDATE ON disclosure_privilege_reviews BEGIN SELECT RAISE(ABORT,'disclosure privilege reviews are append-only'); END;
  CREATE TRIGGER disclosure_privilege_reviews_no_delete BEFORE DELETE ON disclosure_privilege_reviews BEGIN SELECT RAISE(ABORT,'disclosure privilege reviews are append-only'); END;
  CREATE TRIGGER disclosure_redactions_no_update BEFORE UPDATE ON disclosure_redactions BEGIN SELECT RAISE(ABORT,'disclosure redactions are immutable'); END;
  CREATE TRIGGER disclosure_redactions_no_delete BEFORE DELETE ON disclosure_redactions BEGIN SELECT RAISE(ABORT,'disclosure redactions are immutable'); END;
  CREATE TRIGGER disclosure_lists_no_update BEFORE UPDATE ON disclosure_lists BEGIN SELECT RAISE(ABORT,'disclosure lists are immutable'); END;
  CREATE TRIGGER disclosure_lists_no_delete BEFORE DELETE ON disclosure_lists BEGIN SELECT RAISE(ABORT,'disclosure lists are immutable'); END;
  CREATE TRIGGER disclosure_list_entries_no_update BEFORE UPDATE ON disclosure_list_entries BEGIN SELECT RAISE(ABORT,'disclosure list entries are immutable'); END;
  CREATE TRIGGER disclosure_list_entries_no_delete BEFORE DELETE ON disclosure_list_entries BEGIN SELECT RAISE(ABORT,'disclosure list entries are immutable'); END;
  CREATE TRIGGER inspection_events_no_update BEFORE UPDATE ON inspection_events BEGIN SELECT RAISE(ABORT,'inspection events are append-only'); END;
  CREATE TRIGGER inspection_events_no_delete BEFORE DELETE ON inspection_events BEGIN SELECT RAISE(ABORT,'inspection events are append-only'); END;
  CREATE TRIGGER disclosure_command_receipts_no_update BEFORE UPDATE ON disclosure_command_receipts BEGIN SELECT RAISE(ABORT,'disclosure command receipts are immutable'); END;
  CREATE TRIGGER disclosure_command_receipts_no_delete BEFORE DELETE ON disclosure_command_receipts BEGIN SELECT RAISE(ABORT,'disclosure command receipts are immutable'); END;
`;

export const governedDisclosureEvidenceMigration = defineMigration({
  version: 11,
  name: 'governed disclosure and evidence',
  sql,
});
