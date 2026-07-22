import { defineMigration } from './types.js';

const sql = String.raw`
  CREATE TABLE matter_closure_reviews (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK(sequence > 0), snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash)=64),
    outcome TEXT NOT NULL, closure_reason TEXT NOT NULL, lessons TEXT NOT NULL,
    final_client_report_status TEXT NOT NULL CHECK(final_client_report_status IN ('not_ready','ready','sent')),
    final_client_report_document_version_id TEXT,
    documents_position TEXT NOT NULL CHECK(documents_position IN ('not_reviewed','returned','retained','mixed')),
    documents_note TEXT NOT NULL, retention_basis TEXT NOT NULL, retention_until TEXT NOT NULL,
    undertakings_confirmed_clear INTEGER NOT NULL CHECK(undertakings_confirmed_clear=1),
    complaints_confirmed_clear INTEGER NOT NULL CHECK(complaints_confirmed_clear=1),
    attestation_note TEXT NOT NULL,
    prepared_by TEXT NOT NULL, prepared_at TEXT NOT NULL,
    FOREIGN KEY (matter_id,firm_id) REFERENCES matters(id,firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (prepared_by,firm_id) REFERENCES users(id,firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (final_client_report_document_version_id,firm_id) REFERENCES document_versions(id,firm_id) ON DELETE RESTRICT,
    UNIQUE(firm_id,matter_id,sequence), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE matter_closure_blockers (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, review_id TEXT NOT NULL,
    blocker_key TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN ('client_money','office_balance','settlement_obligation','court_deadline','undertaking','complaint','legal_hold','task','document_return','retention')),
    label TEXT NOT NULL, severity TEXT NOT NULL CHECK(severity IN ('critical','residual')),
    transferable INTEGER NOT NULL CHECK(transferable IN (0,1)), source_id TEXT, source_fingerprint TEXT NOT NULL,
    FOREIGN KEY (review_id,firm_id,matter_id) REFERENCES matter_closure_reviews(id,firm_id,matter_id) ON DELETE RESTRICT,
    UNIQUE(firm_id,matter_id,review_id,blocker_key), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE matter_closure_events (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence > 0),
    event_type TEXT NOT NULL CHECK(event_type IN ('blocked','prepared','approved','rejected','closed','reopened')),
    review_id TEXT, reason TEXT NOT NULL, responsible_owner_user_id TEXT,
    explicit_human_authority INTEGER NOT NULL CHECK(explicit_human_authority=1),
    recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (matter_id,firm_id) REFERENCES matters(id,firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (review_id,firm_id,matter_id) REFERENCES matter_closure_reviews(id,firm_id,matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (recorded_by,firm_id) REFERENCES users(id,firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (responsible_owner_user_id,firm_id) REFERENCES users(id,firm_id) ON DELETE RESTRICT,
    UNIQUE(firm_id,matter_id,sequence), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE matter_active_periods (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, ordinal INTEGER NOT NULL CHECK(ordinal > 0),
    opened_at TEXT NOT NULL, closed_at TEXT NOT NULL CHECK(closed_at >= opened_at),
    closure_event_id TEXT NOT NULL, opened_by_event_id TEXT,
    FOREIGN KEY (closure_event_id,firm_id,matter_id) REFERENCES matter_closure_events(id,firm_id,matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (opened_by_event_id,firm_id,matter_id) REFERENCES matter_closure_events(id,firm_id,matter_id) ON DELETE RESTRICT,
    UNIQUE(firm_id,matter_id,ordinal), UNIQUE(firm_id,matter_id,closure_event_id), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE post_closure_obligations (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, review_id TEXT NOT NULL,
    blocker_key TEXT NOT NULL, title TEXT NOT NULL, reason TEXT NOT NULL, owner_user_id TEXT NOT NULL, due_on TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('open','completed','cancelled')), created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (review_id,firm_id,matter_id) REFERENCES matter_closure_reviews(id,firm_id,matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (owner_user_id,firm_id) REFERENCES users(id,firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by,firm_id) REFERENCES users(id,firm_id) ON DELETE RESTRICT,
    UNIQUE(firm_id,matter_id,review_id,blocker_key), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE retention_schedules (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, review_id TEXT NOT NULL,
    basis TEXT NOT NULL, retention_until TEXT NOT NULL, destruction_eligible_on TEXT NOT NULL,
    automatic_destruction INTEGER NOT NULL DEFAULT 0 CHECK(automatic_destruction=0), recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (review_id,firm_id,matter_id) REFERENCES matter_closure_reviews(id,firm_id,matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (recorded_by,firm_id) REFERENCES users(id,firm_id) ON DELETE RESTRICT,
    CHECK(destruction_eligible_on >= retention_until), UNIQUE(firm_id,matter_id,review_id), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE legal_holds (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, reason TEXT NOT NULL,
    created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (matter_id,firm_id) REFERENCES matters(id,firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by,firm_id) REFERENCES users(id,firm_id) ON DELETE RESTRICT,
    UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE legal_hold_events (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, legal_hold_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK(sequence > 0), event_type TEXT NOT NULL CHECK(event_type IN ('applied','released')),
    reason TEXT NOT NULL, explicit_human_authority INTEGER NOT NULL CHECK(explicit_human_authority=1),
    recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (legal_hold_id,firm_id,matter_id) REFERENCES legal_holds(id,firm_id,matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (recorded_by,firm_id) REFERENCES users(id,firm_id) ON DELETE RESTRICT,
    UNIQUE(firm_id,matter_id,legal_hold_id,sequence), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE closure_command_receipts (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, command_type TEXT NOT NULL,
    idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64), result_json TEXT NOT NULL CHECK(json_valid(result_json)),
    actor_user_id TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (matter_id,firm_id) REFERENCES matters(id,firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (actor_user_id,firm_id) REFERENCES users(id,firm_id) ON DELETE RESTRICT,
    UNIQUE(firm_id,matter_id,command_type,idempotency_key), UNIQUE(id,firm_id)
  ) STRICT;

  CREATE TRIGGER matter_closure_reviews_no_update BEFORE UPDATE ON matter_closure_reviews BEGIN SELECT RAISE(ABORT,'matter_closure_reviews is immutable'); END;
  CREATE TRIGGER matter_closure_reviews_no_delete BEFORE DELETE ON matter_closure_reviews BEGIN SELECT RAISE(ABORT,'matter_closure_reviews is immutable'); END;
  CREATE TRIGGER matter_closure_blockers_no_update BEFORE UPDATE ON matter_closure_blockers BEGIN SELECT RAISE(ABORT,'matter_closure_blockers is immutable'); END;
  CREATE TRIGGER matter_closure_blockers_no_delete BEFORE DELETE ON matter_closure_blockers BEGIN SELECT RAISE(ABORT,'matter_closure_blockers is immutable'); END;
  CREATE TRIGGER matter_closure_events_no_update BEFORE UPDATE ON matter_closure_events BEGIN SELECT RAISE(ABORT,'matter_closure_events is append-only'); END;
  CREATE TRIGGER matter_closure_events_no_delete BEFORE DELETE ON matter_closure_events BEGIN SELECT RAISE(ABORT,'matter_closure_events is append-only'); END;
  CREATE TRIGGER matter_active_periods_no_update BEFORE UPDATE ON matter_active_periods BEGIN SELECT RAISE(ABORT,'matter_active_periods is immutable'); END;
  CREATE TRIGGER matter_active_periods_no_delete BEFORE DELETE ON matter_active_periods BEGIN SELECT RAISE(ABORT,'matter_active_periods is immutable'); END;
  CREATE TRIGGER post_closure_obligations_no_update BEFORE UPDATE ON post_closure_obligations BEGIN SELECT RAISE(ABORT,'post_closure_obligations is immutable'); END;
  CREATE TRIGGER post_closure_obligations_no_delete BEFORE DELETE ON post_closure_obligations BEGIN SELECT RAISE(ABORT,'post_closure_obligations is immutable'); END;
  CREATE TRIGGER retention_schedules_no_update BEFORE UPDATE ON retention_schedules BEGIN SELECT RAISE(ABORT,'retention_schedules is immutable'); END;
  CREATE TRIGGER retention_schedules_no_delete BEFORE DELETE ON retention_schedules BEGIN SELECT RAISE(ABORT,'retention_schedules is immutable'); END;
  CREATE TRIGGER legal_holds_no_update BEFORE UPDATE ON legal_holds BEGIN SELECT RAISE(ABORT,'legal_holds is immutable'); END;
  CREATE TRIGGER legal_holds_no_delete BEFORE DELETE ON legal_holds BEGIN SELECT RAISE(ABORT,'legal_holds is immutable'); END;
  CREATE TRIGGER legal_hold_events_no_update BEFORE UPDATE ON legal_hold_events BEGIN SELECT RAISE(ABORT,'legal_hold_events is append-only'); END;
  CREATE TRIGGER legal_hold_events_no_delete BEFORE DELETE ON legal_hold_events BEGIN SELECT RAISE(ABORT,'legal_hold_events is append-only'); END;
  CREATE TRIGGER closure_command_receipts_no_update BEFORE UPDATE ON closure_command_receipts BEGIN SELECT RAISE(ABORT,'closure_command_receipts is immutable'); END;
  CREATE TRIGGER closure_command_receipts_no_delete BEFORE DELETE ON closure_command_receipts BEGIN SELECT RAISE(ABORT,'closure_command_receipts is immutable'); END;
`;

export const matterClosureReopeningMigration = defineMigration({
  version: 14,
  name: 'matter closure and reopening',
  sql,
});
