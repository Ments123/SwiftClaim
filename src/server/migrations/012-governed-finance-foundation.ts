import { defineMigration } from './types.js';

const sql = String.raw`
  CREATE TABLE finance_activity_suggestions (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, user_id TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK(source_kind IN ('task','communication_call','document_version','filing','hearing','timer')),
    source_id TEXT NOT NULL, observed_minutes INTEGER NOT NULL CHECK(observed_minutes > 0 AND observed_minutes <= 9007199254740991),
    observed_at TEXT NOT NULL,
    proposed_activity_code TEXT NOT NULL, proposed_costs_phase TEXT NOT NULL, proposed_narrative TEXT NOT NULL,
    confidence TEXT NOT NULL CHECK(confidence IN ('high','medium','low')), explanation TEXT NOT NULL,
    model TEXT NOT NULL, policy_version TEXT NOT NULL, input_hash TEXT NOT NULL CHECK(length(input_hash)=64),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), created_at TEXT NOT NULL,
    FOREIGN KEY (matter_id,firm_id) REFERENCES matters(id,firm_id),
    FOREIGN KEY (user_id,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,user_id,source_kind,source_id), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_activity_suggestion_decisions (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, suggestion_id TEXT NOT NULL,
    decision TEXT NOT NULL CHECK(decision IN ('accept','edit','split','reject')), reason TEXT NOT NULL,
    decided_by TEXT NOT NULL, decided_at TEXT NOT NULL,
    FOREIGN KEY (suggestion_id,firm_id,matter_id) REFERENCES finance_activity_suggestions(id,firm_id,matter_id),
    FOREIGN KEY (decided_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_timer_sessions (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, user_id TEXT NOT NULL,
    activity_code TEXT NOT NULL, costs_phase TEXT NOT NULL, narrative TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('running','stopped','cancelled')), started_at TEXT NOT NULL,
    stopped_at TEXT, version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (matter_id,firm_id) REFERENCES matters(id,firm_id), FOREIGN KEY (user_id,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE UNIQUE INDEX idx_finance_one_running_timer ON finance_timer_sessions(firm_id,user_id) WHERE status='running';
  CREATE TABLE finance_timer_events (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, timer_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK(sequence > 0),
    event_type TEXT NOT NULL CHECK(event_type IN ('started','stopped','cancelled')), occurred_at TEXT NOT NULL,
    recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (timer_id,firm_id,matter_id) REFERENCES finance_timer_sessions(id,firm_id,matter_id),
    FOREIGN KEY (recorded_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,matter_id,timer_id,sequence), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_rate_cards (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL,
    currency TEXT NOT NULL CHECK(currency='GBP'), version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (created_by,firm_id) REFERENCES users(id,firm_id), UNIQUE(firm_id,name), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE finance_rate_versions (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, rate_card_id TEXT NOT NULL, version_number INTEGER NOT NULL CHECK(version_number > 0),
    effective_from TEXT NOT NULL, effective_to TEXT, note TEXT NOT NULL, prepared_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (rate_card_id,firm_id) REFERENCES finance_rate_cards(id,firm_id),
    FOREIGN KEY (prepared_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,rate_card_id,version_number), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE finance_rate_version_events (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, rate_version_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK(sequence > 0),
    event_type TEXT NOT NULL CHECK(event_type IN ('prepared','activated','retired')),
    note TEXT NOT NULL, occurred_at TEXT NOT NULL, recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (rate_version_id,firm_id) REFERENCES finance_rate_versions(id,firm_id),
    FOREIGN KEY (recorded_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,rate_version_id,sequence), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE finance_rate_entries (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, rate_version_id TEXT NOT NULL, grade TEXT NOT NULL,
    user_id TEXT, activity_code TEXT NOT NULL DEFAULT '', matter_id TEXT,
    hourly_rate_minor INTEGER NOT NULL CHECK(hourly_rate_minor >= 0 AND hourly_rate_minor <= 9007199254740991), currency TEXT NOT NULL CHECK(currency='GBP'),
    FOREIGN KEY (rate_version_id,firm_id) REFERENCES finance_rate_versions(id,firm_id),
    FOREIGN KEY (user_id,firm_id) REFERENCES users(id,firm_id), FOREIGN KEY (matter_id,firm_id) REFERENCES matters(id,firm_id),
    UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE finance_time_entries (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, user_id TEXT NOT NULL,
    work_date TEXT NOT NULL, minutes INTEGER NOT NULL CHECK(minutes > 0 AND minutes <= 9007199254740991), narrative TEXT NOT NULL,
    activity_code TEXT NOT NULL, costs_phase TEXT NOT NULL, chargeable INTEGER NOT NULL CHECK(chargeable IN (0,1)),
    source_kind TEXT NOT NULL CHECK(source_kind IN ('manual','timer','task','communication_call','document_version','filing','hearing')),
    source_id TEXT, currency TEXT NOT NULL CHECK(currency='GBP'), created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (matter_id,firm_id) REFERENCES matters(id,firm_id), FOREIGN KEY (user_id,firm_id) REFERENCES users(id,firm_id),
    FOREIGN KEY (created_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_time_approvals (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, time_entry_id TEXT NOT NULL,
    rate_version_id TEXT NOT NULL, rate_entry_id TEXT NOT NULL, grade_snapshot TEXT NOT NULL,
    hourly_rate_minor INTEGER NOT NULL CHECK(hourly_rate_minor >= 0 AND hourly_rate_minor <= 9007199254740991),
    charge_minor INTEGER NOT NULL CHECK(charge_minor >= 0 AND charge_minor <= 9007199254740991),
    remainder_numerator INTEGER NOT NULL CHECK(remainder_numerator >= 0 AND remainder_numerator < 60),
    denominator INTEGER NOT NULL CHECK(denominator = 60), currency TEXT NOT NULL CHECK(currency='GBP'),
    approval_note TEXT NOT NULL, approved_by TEXT NOT NULL, approved_at TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (time_entry_id,firm_id,matter_id) REFERENCES finance_time_entries(id,firm_id,matter_id),
    FOREIGN KEY (rate_version_id,firm_id) REFERENCES finance_rate_versions(id,firm_id),
    FOREIGN KEY (rate_entry_id,firm_id) REFERENCES finance_rate_entries(id,firm_id),
    FOREIGN KEY (approved_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,matter_id,time_entry_id), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_time_entry_events (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, time_entry_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK(sequence > 0),
    event_type TEXT NOT NULL CHECK(event_type IN ('submitted','approved','rejected','reversed','replacement_linked')),
    reason TEXT NOT NULL, replacement_entry_id TEXT, occurred_at TEXT NOT NULL, recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (time_entry_id,firm_id,matter_id) REFERENCES finance_time_entries(id,firm_id,matter_id),
    FOREIGN KEY (replacement_entry_id,firm_id,matter_id) REFERENCES finance_time_entries(id,firm_id,matter_id),
    FOREIGN KEY (recorded_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,matter_id,time_entry_id,sequence), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_estimates (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (matter_id,firm_id) REFERENCES matters(id,firm_id), FOREIGN KEY (created_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,matter_id), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_estimate_versions (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, estimate_id TEXT NOT NULL,
    version_number INTEGER NOT NULL CHECK(version_number > 0), effective_on TEXT NOT NULL, scope TEXT NOT NULL,
    fees_minor INTEGER NOT NULL CHECK(fees_minor >= 0 AND fees_minor <= 9007199254740991),
    disbursements_minor INTEGER NOT NULL CHECK(disbursements_minor >= 0 AND disbursements_minor <= 9007199254740991),
    vat_minor INTEGER NOT NULL CHECK(vat_minor >= 0 AND vat_minor <= 9007199254740991),
    overall_limit_minor INTEGER NOT NULL CHECK(overall_limit_minor >= 0 AND overall_limit_minor <= 9007199254740991),
    currency TEXT NOT NULL CHECK(currency='GBP'), review_on TEXT, source_document_version_id TEXT,
    approval_note TEXT NOT NULL, approved_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (estimate_id,firm_id,matter_id) REFERENCES finance_estimates(id,firm_id,matter_id),
    FOREIGN KEY (source_document_version_id,firm_id) REFERENCES document_versions(id,firm_id),
    FOREIGN KEY (approved_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,matter_id,estimate_id,version_number), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_estimate_thresholds (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, estimate_version_id TEXT NOT NULL,
    threshold_percent INTEGER NOT NULL CHECK(threshold_percent > 0 AND threshold_percent <= 100),
    FOREIGN KEY (estimate_version_id,firm_id,matter_id) REFERENCES finance_estimate_versions(id,firm_id,matter_id),
    UNIQUE(firm_id,matter_id,estimate_version_id,threshold_percent), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_estimate_warnings (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, threshold_id TEXT NOT NULL,
    crossed_at TEXT NOT NULL, exposure_minor INTEGER NOT NULL CHECK(exposure_minor >= 0 AND exposure_minor <= 9007199254740991),
    currency TEXT NOT NULL CHECK(currency='GBP'),
    FOREIGN KEY (threshold_id,firm_id,matter_id) REFERENCES finance_estimate_thresholds(id,firm_id,matter_id),
    UNIQUE(firm_id,matter_id,threshold_id), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_warning_events (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, warning_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK(sequence > 0),
    event_type TEXT NOT NULL CHECK(event_type IN ('opened','reviewed','client_notified','closed_by_new_estimate')),
    note TEXT NOT NULL, evidence_document_version_id TEXT, occurred_at TEXT NOT NULL, recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (warning_id,firm_id,matter_id) REFERENCES finance_estimate_warnings(id,firm_id,matter_id),
    FOREIGN KEY (evidence_document_version_id,firm_id) REFERENCES document_versions(id,firm_id),
    FOREIGN KEY (recorded_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,matter_id,warning_id,sequence), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_disbursements (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, supplier TEXT NOT NULL,
    invoice_reference TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL,
    net_minor INTEGER NOT NULL CHECK(net_minor >= 0 AND net_minor <= 9007199254740991),
    vat_minor INTEGER NOT NULL CHECK(vat_minor >= 0 AND vat_minor <= 9007199254740991),
    gross_minor INTEGER NOT NULL CHECK(gross_minor >= 0 AND gross_minor <= 9007199254740991 AND gross_minor = net_minor + vat_minor),
    currency TEXT NOT NULL CHECK(currency='GBP'),
    invoice_date TEXT, due_on TEXT, source_document_version_id TEXT,
    created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (matter_id,firm_id) REFERENCES matters(id,firm_id),
    FOREIGN KEY (source_document_version_id,firm_id) REFERENCES document_versions(id,firm_id),
    FOREIGN KEY (created_by,firm_id) REFERENCES users(id,firm_id), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_disbursement_events (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, disbursement_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK(sequence > 0),
    event_type TEXT NOT NULL CHECK(event_type IN ('proposed','approved','incurred','paid_external','cancelled','corrected')),
    note TEXT NOT NULL, evidence_document_version_id TEXT, occurred_at TEXT NOT NULL, recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (disbursement_id,firm_id,matter_id) REFERENCES finance_disbursements(id,firm_id,matter_id),
    FOREIGN KEY (evidence_document_version_id,firm_id) REFERENCES document_versions(id,firm_id),
    FOREIGN KEY (recorded_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,matter_id,disbursement_id,sequence), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_accounts (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
    account_class TEXT NOT NULL CHECK(account_class IN ('client_asset','client_liability','office_asset','office_liability','wip_asset','income','expense','vat_control','disbursement_control','suspense','equity')),
    designation TEXT NOT NULL CHECK(designation IN ('client','office','neutral')), currency TEXT NOT NULL CHECK(currency='GBP'),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (created_by,firm_id) REFERENCES users(id,firm_id), UNIQUE(firm_id,code), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE finance_accounting_periods (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, starts_on TEXT NOT NULL, ends_on TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('open','closed')), closed_by TEXT, closed_at TEXT,
    created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (closed_by,firm_id) REFERENCES users(id,firm_id), FOREIGN KEY (created_by,firm_id) REFERENCES users(id,firm_id),
    CHECK(ends_on >= starts_on), UNIQUE(firm_id,starts_on,ends_on), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE finance_journals (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, period_id TEXT NOT NULL,
    accounting_date TEXT NOT NULL, source_kind TEXT NOT NULL CHECK(source_kind IN ('wip_control','disbursement_control','reversal','other')),
    source_id TEXT NOT NULL, description TEXT NOT NULL, currency TEXT NOT NULL CHECK(currency='GBP'),
    reverses_journal_id TEXT, prepared_by TEXT NOT NULL, prepared_at TEXT NOT NULL,
    FOREIGN KEY (matter_id,firm_id) REFERENCES matters(id,firm_id), FOREIGN KEY (period_id,firm_id) REFERENCES finance_accounting_periods(id,firm_id),
    FOREIGN KEY (reverses_journal_id,firm_id,matter_id) REFERENCES finance_journals(id,firm_id,matter_id),
    FOREIGN KEY (prepared_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,source_kind,source_id), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_journal_lines (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, journal_id TEXT NOT NULL,
    line_number INTEGER NOT NULL CHECK(line_number > 0), account_id TEXT NOT NULL,
    debit_minor INTEGER NOT NULL DEFAULT 0 CHECK(debit_minor >= 0 AND debit_minor <= 9007199254740991),
    credit_minor INTEGER NOT NULL DEFAULT 0 CHECK(credit_minor >= 0 AND credit_minor <= 9007199254740991),
    currency TEXT NOT NULL CHECK(currency='GBP'), memo TEXT NOT NULL,
    CHECK((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0)),
    FOREIGN KEY (journal_id,firm_id,matter_id) REFERENCES finance_journals(id,firm_id,matter_id),
    FOREIGN KEY (account_id,firm_id) REFERENCES finance_accounts(id,firm_id),
    UNIQUE(firm_id,matter_id,journal_id,line_number), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_journal_events (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, journal_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK(sequence > 0),
    event_type TEXT NOT NULL CHECK(event_type IN ('prepared','approved','posted','rejected','reversed')),
    note TEXT NOT NULL, occurred_at TEXT NOT NULL, recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (journal_id,firm_id,matter_id) REFERENCES finance_journals(id,firm_id,matter_id),
    FOREIGN KEY (recorded_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,matter_id,journal_id,sequence), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_firm_events (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, type TEXT NOT NULL, actor_user_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL,
    FOREIGN KEY (firm_id) REFERENCES firms(id), FOREIGN KEY (actor_user_id,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,idempotency_key), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE finance_integration_outbox (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT,
    scope_kind TEXT NOT NULL CHECK(scope_kind IN ('firm','matter')),
    topic TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
    status TEXT NOT NULL CHECK(status IN ('pending','published','failed')), attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
    available_at TEXT NOT NULL, created_at TEXT NOT NULL, deduplication_key TEXT NOT NULL,
    CHECK((scope_kind='firm' AND matter_id IS NULL) OR (scope_kind='matter' AND matter_id IS NOT NULL)),
    FOREIGN KEY (firm_id) REFERENCES firms(id), FOREIGN KEY (matter_id,firm_id) REFERENCES matters(id,firm_id),
    UNIQUE(firm_id,deduplication_key), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE finance_command_receipts (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT,
    scope_kind TEXT NOT NULL CHECK(scope_kind IN ('firm','matter')), command_scope TEXT NOT NULL,
    route_entity_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, input_hash TEXT NOT NULL CHECK(length(input_hash)=64),
    response_json TEXT NOT NULL CHECK(json_valid(response_json)), created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    CHECK((scope_kind='firm' AND matter_id IS NULL) OR (scope_kind='matter' AND matter_id IS NOT NULL)),
    FOREIGN KEY (firm_id) REFERENCES firms(id), FOREIGN KEY (matter_id,firm_id) REFERENCES matters(id,firm_id),
    FOREIGN KEY (created_by,firm_id) REFERENCES users(id,firm_id), UNIQUE(id,firm_id)
  ) STRICT;

  CREATE INDEX idx_finance_suggestions_user ON finance_activity_suggestions(firm_id,user_id,created_at DESC);
  CREATE INDEX idx_finance_time_matter ON finance_time_entries(firm_id,matter_id,work_date,user_id);
  CREATE INDEX idx_finance_disbursement_matter ON finance_disbursements(firm_id,matter_id,created_at DESC);
  CREATE INDEX idx_finance_journal_matter ON finance_journals(firm_id,matter_id,accounting_date);
  CREATE UNIQUE INDEX idx_finance_command_receipt_scope ON finance_command_receipts(
    firm_id,scope_kind,COALESCE(matter_id,''),command_scope,idempotency_key
  );

  CREATE TRIGGER finance_activity_suggestions_no_update BEFORE UPDATE ON finance_activity_suggestions BEGIN SELECT RAISE(ABORT,'finance activity suggestions are immutable'); END;
  CREATE TRIGGER finance_activity_suggestions_no_delete BEFORE DELETE ON finance_activity_suggestions BEGIN SELECT RAISE(ABORT,'finance activity suggestions are immutable'); END;
  CREATE TRIGGER finance_activity_suggestion_decisions_no_update BEFORE UPDATE ON finance_activity_suggestion_decisions BEGIN SELECT RAISE(ABORT,'finance suggestion decisions are append-only'); END;
  CREATE TRIGGER finance_activity_suggestion_decisions_no_delete BEFORE DELETE ON finance_activity_suggestion_decisions BEGIN SELECT RAISE(ABORT,'finance suggestion decisions are append-only'); END;
  CREATE TRIGGER finance_timer_events_no_update BEFORE UPDATE ON finance_timer_events BEGIN SELECT RAISE(ABORT,'finance timer events are append-only'); END;
  CREATE TRIGGER finance_timer_events_no_delete BEFORE DELETE ON finance_timer_events BEGIN SELECT RAISE(ABORT,'finance timer events are append-only'); END;
  CREATE TRIGGER finance_rate_versions_no_update BEFORE UPDATE ON finance_rate_versions BEGIN SELECT RAISE(ABORT,'finance rate versions are immutable'); END;
  CREATE TRIGGER finance_rate_versions_no_delete BEFORE DELETE ON finance_rate_versions BEGIN SELECT RAISE(ABORT,'finance rate versions are immutable'); END;
  CREATE TRIGGER finance_rate_version_events_no_update BEFORE UPDATE ON finance_rate_version_events BEGIN SELECT RAISE(ABORT,'finance rate version events are append-only'); END;
  CREATE TRIGGER finance_rate_version_events_no_delete BEFORE DELETE ON finance_rate_version_events BEGIN SELECT RAISE(ABORT,'finance rate version events are append-only'); END;
  CREATE TRIGGER finance_rate_entries_no_update BEFORE UPDATE ON finance_rate_entries BEGIN SELECT RAISE(ABORT,'finance rate entries are immutable'); END;
  CREATE TRIGGER finance_rate_entries_no_delete BEFORE DELETE ON finance_rate_entries BEGIN SELECT RAISE(ABORT,'finance rate entries are immutable'); END;
  CREATE TRIGGER finance_time_entries_no_update BEFORE UPDATE ON finance_time_entries BEGIN SELECT RAISE(ABORT,'finance time entries are immutable'); END;
  CREATE TRIGGER finance_time_entries_no_delete BEFORE DELETE ON finance_time_entries BEGIN SELECT RAISE(ABORT,'finance time entries are immutable'); END;
  CREATE TRIGGER finance_time_approvals_no_update BEFORE UPDATE ON finance_time_approvals BEGIN SELECT RAISE(ABORT,'finance time approvals are immutable'); END;
  CREATE TRIGGER finance_time_approvals_no_delete BEFORE DELETE ON finance_time_approvals BEGIN SELECT RAISE(ABORT,'finance time approvals are immutable'); END;
  CREATE TRIGGER finance_time_entry_events_no_update BEFORE UPDATE ON finance_time_entry_events BEGIN SELECT RAISE(ABORT,'finance time entry events are append-only'); END;
  CREATE TRIGGER finance_time_entry_events_no_delete BEFORE DELETE ON finance_time_entry_events BEGIN SELECT RAISE(ABORT,'finance time entry events are append-only'); END;
  CREATE TRIGGER finance_estimate_versions_no_update BEFORE UPDATE ON finance_estimate_versions BEGIN SELECT RAISE(ABORT,'finance estimate versions are immutable'); END;
  CREATE TRIGGER finance_estimate_versions_no_delete BEFORE DELETE ON finance_estimate_versions BEGIN SELECT RAISE(ABORT,'finance estimate versions are immutable'); END;
  CREATE TRIGGER finance_warning_events_no_update BEFORE UPDATE ON finance_warning_events BEGIN SELECT RAISE(ABORT,'finance warning events are append-only'); END;
  CREATE TRIGGER finance_warning_events_no_delete BEFORE DELETE ON finance_warning_events BEGIN SELECT RAISE(ABORT,'finance warning events are append-only'); END;
  CREATE TRIGGER finance_disbursements_no_update BEFORE UPDATE ON finance_disbursements BEGIN SELECT RAISE(ABORT,'finance disbursements are immutable'); END;
  CREATE TRIGGER finance_disbursements_no_delete BEFORE DELETE ON finance_disbursements BEGIN SELECT RAISE(ABORT,'finance disbursements are immutable'); END;
  CREATE TRIGGER finance_disbursement_events_no_update BEFORE UPDATE ON finance_disbursement_events BEGIN SELECT RAISE(ABORT,'finance disbursement events are append-only'); END;
  CREATE TRIGGER finance_disbursement_events_no_delete BEFORE DELETE ON finance_disbursement_events BEGIN SELECT RAISE(ABORT,'finance disbursement events are append-only'); END;
  CREATE TRIGGER finance_accounts_no_update BEFORE UPDATE ON finance_accounts BEGIN SELECT RAISE(ABORT,'finance accounts are immutable'); END;
  CREATE TRIGGER finance_accounts_no_delete BEFORE DELETE ON finance_accounts BEGIN SELECT RAISE(ABORT,'finance accounts are immutable'); END;
  CREATE TRIGGER finance_journals_no_update BEFORE UPDATE ON finance_journals BEGIN SELECT RAISE(ABORT,'finance journals are immutable'); END;
  CREATE TRIGGER finance_journals_no_delete BEFORE DELETE ON finance_journals BEGIN SELECT RAISE(ABORT,'finance journals are immutable'); END;
  CREATE TRIGGER finance_journal_lines_no_update BEFORE UPDATE ON finance_journal_lines BEGIN SELECT RAISE(ABORT,'finance journal lines are immutable'); END;
  CREATE TRIGGER finance_journal_lines_no_delete BEFORE DELETE ON finance_journal_lines BEGIN SELECT RAISE(ABORT,'finance journal lines are immutable'); END;
  CREATE TRIGGER finance_journal_events_no_update BEFORE UPDATE ON finance_journal_events BEGIN SELECT RAISE(ABORT,'finance journal events are append-only'); END;
  CREATE TRIGGER finance_journal_events_no_delete BEFORE DELETE ON finance_journal_events BEGIN SELECT RAISE(ABORT,'finance journal events are append-only'); END;
  CREATE TRIGGER finance_firm_events_no_update BEFORE UPDATE ON finance_firm_events BEGIN SELECT RAISE(ABORT,'finance firm events are append-only'); END;
  CREATE TRIGGER finance_firm_events_no_delete BEFORE DELETE ON finance_firm_events BEGIN SELECT RAISE(ABORT,'finance firm events are append-only'); END;
  CREATE TRIGGER finance_integration_outbox_no_delete BEFORE DELETE ON finance_integration_outbox BEGIN SELECT RAISE(ABORT,'finance outbox records cannot be deleted'); END;
  CREATE TRIGGER finance_command_receipts_no_update BEFORE UPDATE ON finance_command_receipts BEGIN SELECT RAISE(ABORT,'finance command receipts are immutable'); END;
  CREATE TRIGGER finance_command_receipts_no_delete BEFORE DELETE ON finance_command_receipts BEGIN SELECT RAISE(ABORT,'finance command receipts are immutable'); END;
`;

export const governedFinanceFoundationMigration = defineMigration({
  version: 12,
  name: 'governed finance foundation',
  sql,
});
