import { defineMigration } from './types.js';

const sql = String.raw`
  CREATE UNIQUE INDEX idx_parties_id_firm_matter ON parties(id,firm_id,matter_id);

  CREATE TABLE finance_vat_profiles (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, name TEXT NOT NULL,
    registration_number_masked TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (firm_id) REFERENCES firms(id), FOREIGN KEY (created_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,name), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE finance_vat_rates (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, vat_profile_id TEXT NOT NULL,
    treatment TEXT NOT NULL CHECK(treatment IN ('standard','zero','exempt','outside_scope')),
    rate_numerator INTEGER NOT NULL CHECK(rate_numerator >= 0 AND rate_numerator <= 9007199254740991),
    rate_denominator INTEGER NOT NULL CHECK(rate_denominator > 0 AND rate_denominator <= 9007199254740991),
    effective_from TEXT NOT NULL, effective_to TEXT, note TEXT NOT NULL, approved_by TEXT NOT NULL, approved_at TEXT NOT NULL,
    FOREIGN KEY (vat_profile_id,firm_id) REFERENCES finance_vat_profiles(id,firm_id),
    FOREIGN KEY (approved_by,firm_id) REFERENCES users(id,firm_id),
    CHECK(effective_to IS NULL OR effective_to >= effective_from),
    UNIQUE(firm_id,vat_profile_id,treatment,effective_from), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE finance_bill_series (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, prefix TEXT NOT NULL, year_pattern TEXT NOT NULL,
    next_number INTEGER NOT NULL CHECK(next_number > 0 AND next_number <= 9007199254740991),
    padding INTEGER NOT NULL CHECK(padding BETWEEN 1 AND 12), active INTEGER NOT NULL CHECK(active IN (0,1)),
    created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (firm_id) REFERENCES firms(id), FOREIGN KEY (created_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,prefix,year_pattern), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE finance_bills (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, client_party_id TEXT NOT NULL,
    series_id TEXT, bill_number INTEGER, bill_reference TEXT, currency TEXT NOT NULL CHECK(currency='GBP'),
    due_on TEXT NOT NULL, prepared_by TEXT NOT NULL, prepared_at TEXT NOT NULL,
    FOREIGN KEY (matter_id,firm_id) REFERENCES matters(id,firm_id),
    FOREIGN KEY (client_party_id,firm_id,matter_id) REFERENCES parties(id,firm_id,matter_id),
    FOREIGN KEY (series_id,firm_id) REFERENCES finance_bill_series(id,firm_id),
    FOREIGN KEY (prepared_by,firm_id) REFERENCES users(id,firm_id),
    CHECK((bill_number IS NULL AND bill_reference IS NULL) OR (bill_number > 0 AND series_id IS NOT NULL AND length(bill_reference) > 0)),
    UNIQUE(firm_id,series_id,bill_number), UNIQUE(firm_id,bill_reference), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_bill_versions (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, bill_id TEXT NOT NULL,
    version_number INTEGER NOT NULL CHECK(version_number > 0), due_on TEXT NOT NULL,
    net_minor INTEGER NOT NULL CHECK(net_minor >= 0 AND net_minor <= 9007199254740991),
    vat_minor INTEGER NOT NULL CHECK(vat_minor >= 0 AND vat_minor <= 9007199254740991),
    gross_minor INTEGER NOT NULL CHECK(gross_minor >= 0 AND gross_minor <= 9007199254740991 AND gross_minor = net_minor + vat_minor),
    currency TEXT NOT NULL CHECK(currency='GBP'), note TEXT NOT NULL, prepared_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (bill_id,firm_id,matter_id) REFERENCES finance_bills(id,firm_id,matter_id),
    FOREIGN KEY (prepared_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,matter_id,bill_id,version_number), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_bill_lines (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, bill_id TEXT NOT NULL, bill_version_id TEXT NOT NULL,
    line_number INTEGER NOT NULL CHECK(line_number > 0), source_kind TEXT NOT NULL CHECK(source_kind IN ('time','disbursement','adjustment')),
    source_id TEXT NOT NULL, narrative TEXT NOT NULL,
    net_minor INTEGER NOT NULL CHECK(net_minor >= 0 AND net_minor <= 9007199254740991),
    vat_treatment TEXT NOT NULL CHECK(vat_treatment IN ('standard','zero','exempt','outside_scope')),
    vat_rate_id TEXT, rate_numerator INTEGER NOT NULL CHECK(rate_numerator >= 0 AND rate_numerator <= 9007199254740991),
    rate_denominator INTEGER NOT NULL CHECK(rate_denominator > 0 AND rate_denominator <= 9007199254740991),
    vat_minor INTEGER NOT NULL CHECK(vat_minor >= 0 AND vat_minor <= 9007199254740991),
    gross_minor INTEGER NOT NULL CHECK(gross_minor >= 0 AND gross_minor <= 9007199254740991 AND gross_minor = net_minor + vat_minor),
    rounding_snapshot_json TEXT NOT NULL CHECK(json_valid(rounding_snapshot_json)), currency TEXT NOT NULL CHECK(currency='GBP'),
    FOREIGN KEY (bill_id,firm_id,matter_id) REFERENCES finance_bills(id,firm_id,matter_id),
    FOREIGN KEY (bill_version_id,firm_id,matter_id) REFERENCES finance_bill_versions(id,firm_id,matter_id),
    FOREIGN KEY (vat_rate_id,firm_id) REFERENCES finance_vat_rates(id,firm_id),
    UNIQUE(firm_id,matter_id,bill_version_id,line_number), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_bill_events (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, bill_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK(sequence > 0),
    event_type TEXT NOT NULL CHECK(event_type IN ('prepared','submitted','approved','rejected','issued','delivered','cancelled')),
    bill_version_id TEXT, note TEXT NOT NULL, evidence_document_version_id TEXT,
    occurred_at TEXT NOT NULL, recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (bill_id,firm_id,matter_id) REFERENCES finance_bills(id,firm_id,matter_id),
    FOREIGN KEY (bill_version_id,firm_id,matter_id) REFERENCES finance_bill_versions(id,firm_id,matter_id),
    FOREIGN KEY (evidence_document_version_id,firm_id) REFERENCES document_versions(id,firm_id),
    FOREIGN KEY (recorded_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,matter_id,bill_id,sequence), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_bill_source_allocations (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, bill_id TEXT NOT NULL,
    bill_line_id TEXT NOT NULL, source_kind TEXT NOT NULL CHECK(source_kind IN ('time','disbursement')),
    source_id TEXT NOT NULL, allocated_net_minor INTEGER NOT NULL CHECK(allocated_net_minor > 0 AND allocated_net_minor <= 9007199254740991),
    currency TEXT NOT NULL CHECK(currency='GBP'), allocated_at TEXT NOT NULL,
    FOREIGN KEY (bill_id,firm_id,matter_id) REFERENCES finance_bills(id,firm_id,matter_id),
    FOREIGN KEY (bill_line_id,firm_id,matter_id) REFERENCES finance_bill_lines(id,firm_id,matter_id),
    UNIQUE(firm_id,matter_id,source_kind,source_id,bill_line_id), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_bill_documents (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, bill_id TEXT NOT NULL,
    bill_version_id TEXT NOT NULL, document_version_id TEXT NOT NULL, tax_point TEXT NOT NULL,
    sha256 TEXT NOT NULL CHECK(length(sha256)=64), created_at TEXT NOT NULL,
    FOREIGN KEY (bill_id,firm_id,matter_id) REFERENCES finance_bills(id,firm_id,matter_id),
    FOREIGN KEY (bill_version_id,firm_id,matter_id) REFERENCES finance_bill_versions(id,firm_id,matter_id),
    FOREIGN KEY (document_version_id,firm_id) REFERENCES document_versions(id,firm_id),
    UNIQUE(firm_id,matter_id,bill_id,bill_version_id), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_credit_notes (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, bill_id TEXT NOT NULL,
    credit_reference TEXT, reason TEXT NOT NULL, currency TEXT NOT NULL CHECK(currency='GBP'), prepared_by TEXT NOT NULL, prepared_at TEXT NOT NULL,
    FOREIGN KEY (bill_id,firm_id,matter_id) REFERENCES finance_bills(id,firm_id,matter_id),
    FOREIGN KEY (prepared_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,credit_reference), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_credit_note_lines (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, credit_note_id TEXT NOT NULL,
    bill_line_id TEXT NOT NULL, line_number INTEGER NOT NULL CHECK(line_number > 0),
    net_minor INTEGER NOT NULL CHECK(net_minor > 0 AND net_minor <= 9007199254740991),
    vat_minor INTEGER NOT NULL CHECK(vat_minor >= 0 AND vat_minor <= 9007199254740991),
    gross_minor INTEGER NOT NULL CHECK(gross_minor > 0 AND gross_minor <= 9007199254740991 AND gross_minor = net_minor + vat_minor),
    currency TEXT NOT NULL CHECK(currency='GBP'),
    FOREIGN KEY (credit_note_id,firm_id,matter_id) REFERENCES finance_credit_notes(id,firm_id,matter_id),
    FOREIGN KEY (bill_line_id,firm_id,matter_id) REFERENCES finance_bill_lines(id,firm_id,matter_id),
    UNIQUE(firm_id,matter_id,credit_note_id,line_number), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_credit_note_events (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, credit_note_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK(sequence > 0), event_type TEXT NOT NULL CHECK(event_type IN ('prepared','approved','issued','cancelled')),
    note TEXT NOT NULL, occurred_at TEXT NOT NULL, recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (credit_note_id,firm_id,matter_id) REFERENCES finance_credit_notes(id,firm_id,matter_id),
    FOREIGN KEY (recorded_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,matter_id,credit_note_id,sequence), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_credit_note_documents (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, credit_note_id TEXT NOT NULL,
    document_version_id TEXT NOT NULL, sha256 TEXT NOT NULL CHECK(length(sha256)=64), created_at TEXT NOT NULL,
    FOREIGN KEY (credit_note_id,firm_id,matter_id) REFERENCES finance_credit_notes(id,firm_id,matter_id),
    FOREIGN KEY (document_version_id,firm_id) REFERENCES document_versions(id,firm_id),
    UNIQUE(firm_id,matter_id,credit_note_id), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;

  CREATE TABLE finance_bank_accounts (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, name TEXT NOT NULL,
    designation TEXT NOT NULL CHECK(designation IN ('client','office')),
    provider TEXT NOT NULL, account_identifier_masked TEXT NOT NULL, currency TEXT NOT NULL CHECK(currency='GBP'),
    active INTEGER NOT NULL CHECK(active IN (0,1)), created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (firm_id) REFERENCES firms(id), FOREIGN KEY (created_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,designation,account_identifier_masked), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE finance_bank_statement_batches (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, bank_account_id TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('manual','csv','provider')), statement_from TEXT NOT NULL, statement_to TEXT NOT NULL,
    opening_balance_minor INTEGER NOT NULL CHECK(opening_balance_minor BETWEEN -9007199254740991 AND 9007199254740991),
    closing_balance_minor INTEGER NOT NULL CHECK(closing_balance_minor BETWEEN -9007199254740991 AND 9007199254740991),
    currency TEXT NOT NULL CHECK(currency='GBP'), evidence_document_version_id TEXT NOT NULL,
    raw_checksum TEXT NOT NULL CHECK(length(raw_checksum)=64), imported_by TEXT NOT NULL, imported_at TEXT NOT NULL,
    FOREIGN KEY (bank_account_id,firm_id) REFERENCES finance_bank_accounts(id,firm_id),
    FOREIGN KEY (evidence_document_version_id,firm_id) REFERENCES document_versions(id,firm_id),
    FOREIGN KEY (imported_by,firm_id) REFERENCES users(id,firm_id),
    CHECK(statement_to >= statement_from), UNIQUE(firm_id,bank_account_id,raw_checksum), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE finance_bank_statement_lines (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, bank_account_id TEXT NOT NULL, batch_id TEXT NOT NULL,
    line_number INTEGER NOT NULL CHECK(line_number > 0), provider_line_id TEXT,
    transaction_date TEXT NOT NULL, value_date TEXT, amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN -9007199254740991 AND 9007199254740991 AND amount_minor <> 0),
    currency TEXT NOT NULL CHECK(currency='GBP'), reference TEXT NOT NULL, payer_payee TEXT NOT NULL,
    raw_line_hash TEXT NOT NULL CHECK(length(raw_line_hash)=64),
    FOREIGN KEY (bank_account_id,firm_id) REFERENCES finance_bank_accounts(id,firm_id),
    FOREIGN KEY (batch_id,firm_id) REFERENCES finance_bank_statement_batches(id,firm_id),
    UNIQUE(firm_id,batch_id,line_number), UNIQUE(firm_id,bank_account_id,provider_line_id), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE finance_receipts (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, bank_account_id TEXT NOT NULL, statement_line_id TEXT,
    amount_minor INTEGER NOT NULL CHECK(amount_minor > 0 AND amount_minor <= 9007199254740991), currency TEXT NOT NULL CHECK(currency='GBP'),
    received_on TEXT NOT NULL, payer TEXT NOT NULL, reference TEXT NOT NULL, evidence_document_version_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64), recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (bank_account_id,firm_id) REFERENCES finance_bank_accounts(id,firm_id),
    FOREIGN KEY (statement_line_id,firm_id) REFERENCES finance_bank_statement_lines(id,firm_id),
    FOREIGN KEY (evidence_document_version_id,firm_id) REFERENCES document_versions(id,firm_id),
    FOREIGN KEY (recorded_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,fingerprint), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE finance_receipt_events (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, receipt_id TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence > 0),
    event_type TEXT NOT NULL CHECK(event_type IN ('recorded','classified','allocated','reversed','duplicate_reviewed')),
    note TEXT NOT NULL, occurred_at TEXT NOT NULL, recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (receipt_id,firm_id) REFERENCES finance_receipts(id,firm_id), FOREIGN KEY (recorded_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,receipt_id,sequence), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE finance_receipt_allocations (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, receipt_id TEXT NOT NULL,
    designation TEXT NOT NULL CHECK(designation IN ('client','office','suspense')),
    matter_id TEXT, client_party_id TEXT, bill_id TEXT, journal_id TEXT,
    amount_minor INTEGER NOT NULL CHECK(amount_minor > 0 AND amount_minor <= 9007199254740991), currency TEXT NOT NULL CHECK(currency='GBP'),
    cleared INTEGER NOT NULL CHECK(cleared IN (0,1)), restricted INTEGER NOT NULL CHECK(restricted IN (0,1)),
    reverses_allocation_id TEXT, allocated_by TEXT NOT NULL, allocated_at TEXT NOT NULL,
    FOREIGN KEY (receipt_id,firm_id) REFERENCES finance_receipts(id,firm_id),
    FOREIGN KEY (matter_id,firm_id) REFERENCES matters(id,firm_id),
    FOREIGN KEY (client_party_id,firm_id,matter_id) REFERENCES parties(id,firm_id,matter_id),
    FOREIGN KEY (bill_id,firm_id,matter_id) REFERENCES finance_bills(id,firm_id,matter_id),
    FOREIGN KEY (journal_id,firm_id,matter_id) REFERENCES finance_journals(id,firm_id,matter_id),
    FOREIGN KEY (reverses_allocation_id,firm_id) REFERENCES finance_receipt_allocations(id,firm_id),
    FOREIGN KEY (allocated_by,firm_id) REFERENCES users(id,firm_id),
    CHECK((designation='suspense' AND matter_id IS NULL AND client_party_id IS NULL AND bill_id IS NULL AND journal_id IS NULL)
      OR (designation IN ('client','office') AND matter_id IS NOT NULL AND client_party_id IS NOT NULL AND journal_id IS NOT NULL)),
    CHECK(restricted=0 OR designation='client'),
    UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE finance_payment_requisitions (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, client_party_id TEXT NOT NULL, bank_account_id TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK(amount_minor > 0 AND amount_minor <= 9007199254740991), currency TEXT NOT NULL CHECK(currency='GBP'),
    purpose TEXT NOT NULL, beneficiary_name TEXT NOT NULL, beneficiary_fingerprint TEXT NOT NULL CHECK(length(beneficiary_fingerprint)=64),
    beneficiary_evidence_document_version_id TEXT NOT NULL, requested_payment_method TEXT NOT NULL,
    prepared_by TEXT NOT NULL, prepared_at TEXT NOT NULL,
    FOREIGN KEY (matter_id,firm_id) REFERENCES matters(id,firm_id),
    FOREIGN KEY (client_party_id,firm_id,matter_id) REFERENCES parties(id,firm_id,matter_id),
    FOREIGN KEY (bank_account_id,firm_id) REFERENCES finance_bank_accounts(id,firm_id),
    FOREIGN KEY (beneficiary_evidence_document_version_id,firm_id) REFERENCES document_versions(id,firm_id),
    FOREIGN KEY (prepared_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_payment_events (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, payment_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK(sequence > 0),
    event_type TEXT NOT NULL CHECK(event_type IN ('prepared','beneficiary_verified','approved','rejected','recorded_external','reversed')),
    evidence_document_version_id TEXT, journal_id TEXT, note TEXT NOT NULL,
    occurred_at TEXT NOT NULL, recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (payment_id,firm_id,matter_id) REFERENCES finance_payment_requisitions(id,firm_id,matter_id),
    FOREIGN KEY (evidence_document_version_id,firm_id) REFERENCES document_versions(id,firm_id),
    FOREIGN KEY (journal_id,firm_id,matter_id) REFERENCES finance_journals(id,firm_id,matter_id),
    FOREIGN KEY (recorded_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,matter_id,payment_id,sequence), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_client_office_transfers (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, client_party_id TEXT NOT NULL,
    bill_id TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor > 0 AND amount_minor <= 9007199254740991),
    currency TEXT NOT NULL CHECK(currency='GBP'), prepared_by TEXT NOT NULL, prepared_at TEXT NOT NULL,
    FOREIGN KEY (matter_id,firm_id) REFERENCES matters(id,firm_id),
    FOREIGN KEY (client_party_id,firm_id,matter_id) REFERENCES parties(id,firm_id,matter_id),
    FOREIGN KEY (bill_id,firm_id,matter_id) REFERENCES finance_bills(id,firm_id,matter_id),
    FOREIGN KEY (prepared_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;
  CREATE TABLE finance_transfer_events (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, transfer_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK(sequence > 0), event_type TEXT NOT NULL CHECK(event_type IN ('prepared','approved','rejected','posted','reversed')),
    client_journal_id TEXT, office_journal_id TEXT, note TEXT NOT NULL,
    occurred_at TEXT NOT NULL, recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (transfer_id,firm_id,matter_id) REFERENCES finance_client_office_transfers(id,firm_id,matter_id),
    FOREIGN KEY (client_journal_id,firm_id,matter_id) REFERENCES finance_journals(id,firm_id,matter_id),
    FOREIGN KEY (office_journal_id,firm_id,matter_id) REFERENCES finance_journals(id,firm_id,matter_id),
    FOREIGN KEY (recorded_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,matter_id,transfer_id,sequence), UNIQUE(id,firm_id), UNIQUE(id,firm_id,matter_id)
  ) STRICT;

  CREATE TABLE finance_reconciliations (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, bank_account_id TEXT NOT NULL, statement_batch_id TEXT NOT NULL,
    statement_closing_on TEXT NOT NULL,
    statement_closing_balance_minor INTEGER NOT NULL CHECK(statement_closing_balance_minor BETWEEN -9007199254740991 AND 9007199254740991),
    ledger_cleared_balance_minor INTEGER NOT NULL CHECK(ledger_cleared_balance_minor BETWEEN -9007199254740991 AND 9007199254740991),
    outstanding_lodgements_minor INTEGER NOT NULL CHECK(outstanding_lodgements_minor >= 0 AND outstanding_lodgements_minor <= 9007199254740991),
    unpresented_payments_minor INTEGER NOT NULL CHECK(unpresented_payments_minor >= 0 AND unpresented_payments_minor <= 9007199254740991),
    documented_adjustments_minor INTEGER NOT NULL CHECK(documented_adjustments_minor BETWEEN -9007199254740991 AND 9007199254740991),
    difference_minor INTEGER NOT NULL CHECK(difference_minor BETWEEN -9007199254740991 AND 9007199254740991),
    currency TEXT NOT NULL CHECK(currency='GBP'), prepared_by TEXT NOT NULL, prepared_at TEXT NOT NULL,
    FOREIGN KEY (bank_account_id,firm_id) REFERENCES finance_bank_accounts(id,firm_id),
    FOREIGN KEY (statement_batch_id,firm_id) REFERENCES finance_bank_statement_batches(id,firm_id),
    FOREIGN KEY (prepared_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,bank_account_id,statement_batch_id), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE finance_reconciliation_items (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, reconciliation_id TEXT NOT NULL,
    item_kind TEXT NOT NULL CHECK(item_kind IN ('statement_match','outstanding_lodgement','unpresented_payment','adjustment')),
    statement_line_id TEXT, journal_id TEXT, amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN -9007199254740991 AND 9007199254740991 AND amount_minor <> 0),
    evidence_document_version_id TEXT, explanation TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (reconciliation_id,firm_id) REFERENCES finance_reconciliations(id,firm_id),
    FOREIGN KEY (statement_line_id,firm_id) REFERENCES finance_bank_statement_lines(id,firm_id),
    FOREIGN KEY (journal_id,firm_id) REFERENCES finance_journals(id,firm_id),
    FOREIGN KEY (evidence_document_version_id,firm_id) REFERENCES document_versions(id,firm_id),
    FOREIGN KEY (created_by,firm_id) REFERENCES users(id,firm_id), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE finance_reconciliation_events (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, reconciliation_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK(sequence > 0), event_type TEXT NOT NULL CHECK(event_type IN ('prepared','item_matched','item_rejected','completed','reopened')),
    note TEXT NOT NULL, occurred_at TEXT NOT NULL, recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY (reconciliation_id,firm_id) REFERENCES finance_reconciliations(id,firm_id),
    FOREIGN KEY (recorded_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,reconciliation_id,sequence), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE finance_reconciliation_signoffs (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, reconciliation_id TEXT NOT NULL,
    signed_off_by TEXT NOT NULL, signed_off_at TEXT NOT NULL, note TEXT NOT NULL,
    next_review_due_on TEXT NOT NULL, calculation_snapshot_json TEXT NOT NULL CHECK(json_valid(calculation_snapshot_json)),
    FOREIGN KEY (reconciliation_id,firm_id) REFERENCES finance_reconciliations(id,firm_id),
    FOREIGN KEY (signed_off_by,firm_id) REFERENCES users(id,firm_id),
    UNIQUE(firm_id,reconciliation_id), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE finance_exceptions (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT,
    exception_kind TEXT NOT NULL CHECK(exception_kind IN ('duplicate_receipt','negative_balance_attempt','changed_beneficiary','unallocated_receipt','overdue_reconciliation','residual_balance','bill_number_gap')),
    severity TEXT NOT NULL CHECK(severity IN ('warning','blocker')), source_kind TEXT NOT NULL, source_id TEXT NOT NULL,
    safe_summary TEXT NOT NULL, amount_minor INTEGER CHECK(amount_minor BETWEEN -9007199254740991 AND 9007199254740991),
    currency TEXT CHECK(currency IS NULL OR currency='GBP'), raised_at TEXT NOT NULL,
    FOREIGN KEY (matter_id,firm_id) REFERENCES matters(id,firm_id),
    UNIQUE(firm_id,exception_kind,source_kind,source_id), UNIQUE(id,firm_id)
  ) STRICT;
  CREATE TABLE finance_export_manifests (
    id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, export_kind TEXT NOT NULL,
    filters_json TEXT NOT NULL CHECK(json_valid(filters_json)), columns_json TEXT NOT NULL CHECK(json_valid(columns_json)),
    row_count INTEGER NOT NULL CHECK(row_count >= 0), sha256 TEXT NOT NULL CHECK(length(sha256)=64),
    generated_by TEXT NOT NULL, generated_at TEXT NOT NULL,
    FOREIGN KEY (generated_by,firm_id) REFERENCES users(id,firm_id), UNIQUE(id,firm_id)
  ) STRICT;

  CREATE INDEX idx_finance_bills_register ON finance_bills(firm_id,bill_reference);
  CREATE INDEX idx_finance_bill_events_stream ON finance_bill_events(firm_id,matter_id,bill_id,sequence);
  CREATE INDEX idx_finance_statement_lines_account ON finance_bank_statement_lines(firm_id,bank_account_id,transaction_date);
  CREATE INDEX idx_finance_receipts_account ON finance_receipts(firm_id,bank_account_id,received_on);
  CREATE INDEX idx_finance_payments_matter ON finance_payment_requisitions(firm_id,matter_id,prepared_at);
  CREATE INDEX idx_finance_exceptions_queue ON finance_exceptions(firm_id,severity,raised_at);

  CREATE TRIGGER finance_vat_rates_no_update BEFORE UPDATE ON finance_vat_rates BEGIN SELECT RAISE(ABORT,'finance VAT rates are immutable'); END;
  CREATE TRIGGER finance_vat_rates_no_delete BEFORE DELETE ON finance_vat_rates BEGIN SELECT RAISE(ABORT,'finance VAT rates are immutable'); END;
  CREATE TRIGGER finance_bills_issue_once BEFORE UPDATE ON finance_bills
    WHEN OLD.bill_number IS NOT NULL OR NEW.bill_number IS NULL OR NEW.series_id IS NULL OR NEW.bill_reference IS NULL
      OR OLD.id <> NEW.id OR OLD.firm_id <> NEW.firm_id OR OLD.matter_id <> NEW.matter_id OR OLD.client_party_id <> NEW.client_party_id
      OR OLD.currency <> NEW.currency OR OLD.due_on <> NEW.due_on OR OLD.prepared_by <> NEW.prepared_by OR OLD.prepared_at <> NEW.prepared_at
    BEGIN SELECT RAISE(ABORT,'finance bills only permit one atomic issue-number assignment'); END;
  CREATE TRIGGER finance_bills_no_delete BEFORE DELETE ON finance_bills BEGIN SELECT RAISE(ABORT,'finance bills cannot be deleted'); END;
  CREATE TRIGGER finance_bill_versions_no_update BEFORE UPDATE ON finance_bill_versions BEGIN SELECT RAISE(ABORT,'finance bill versions are immutable'); END;
  CREATE TRIGGER finance_bill_versions_no_delete BEFORE DELETE ON finance_bill_versions BEGIN SELECT RAISE(ABORT,'finance bill versions are immutable'); END;
  CREATE TRIGGER finance_bill_lines_no_update BEFORE UPDATE ON finance_bill_lines BEGIN SELECT RAISE(ABORT,'finance bill lines are immutable'); END;
  CREATE TRIGGER finance_bill_lines_no_delete BEFORE DELETE ON finance_bill_lines BEGIN SELECT RAISE(ABORT,'finance bill lines are immutable'); END;
  CREATE TRIGGER finance_bill_events_no_update BEFORE UPDATE ON finance_bill_events BEGIN SELECT RAISE(ABORT,'finance bill events are append-only'); END;
  CREATE TRIGGER finance_bill_events_no_delete BEFORE DELETE ON finance_bill_events BEGIN SELECT RAISE(ABORT,'finance bill events are append-only'); END;
  CREATE TRIGGER finance_bill_source_allocations_no_update BEFORE UPDATE ON finance_bill_source_allocations BEGIN SELECT RAISE(ABORT,'finance bill source allocations are immutable'); END;
  CREATE TRIGGER finance_bill_source_allocations_no_delete BEFORE DELETE ON finance_bill_source_allocations BEGIN SELECT RAISE(ABORT,'finance bill source allocations are immutable'); END;
  CREATE TRIGGER finance_bill_documents_no_update BEFORE UPDATE ON finance_bill_documents BEGIN SELECT RAISE(ABORT,'finance bill documents are immutable'); END;
  CREATE TRIGGER finance_bill_documents_no_delete BEFORE DELETE ON finance_bill_documents BEGIN SELECT RAISE(ABORT,'finance bill documents are immutable'); END;
  CREATE TRIGGER finance_credit_note_lines_no_update BEFORE UPDATE ON finance_credit_note_lines BEGIN SELECT RAISE(ABORT,'finance credit note lines are immutable'); END;
  CREATE TRIGGER finance_credit_note_lines_no_delete BEFORE DELETE ON finance_credit_note_lines BEGIN SELECT RAISE(ABORT,'finance credit note lines are immutable'); END;
  CREATE TRIGGER finance_credit_note_events_no_update BEFORE UPDATE ON finance_credit_note_events BEGIN SELECT RAISE(ABORT,'finance credit note events are append-only'); END;
  CREATE TRIGGER finance_credit_note_events_no_delete BEFORE DELETE ON finance_credit_note_events BEGIN SELECT RAISE(ABORT,'finance credit note events are append-only'); END;
  CREATE TRIGGER finance_credit_notes_issue_once BEFORE UPDATE ON finance_credit_notes
    WHEN OLD.credit_reference IS NOT NULL OR NEW.credit_reference IS NULL
      OR OLD.id <> NEW.id OR OLD.firm_id <> NEW.firm_id OR OLD.matter_id <> NEW.matter_id OR OLD.bill_id <> NEW.bill_id
      OR OLD.reason <> NEW.reason OR OLD.currency <> NEW.currency OR OLD.prepared_by <> NEW.prepared_by OR OLD.prepared_at <> NEW.prepared_at
    BEGIN SELECT RAISE(ABORT,'finance credit notes only permit one atomic reference assignment'); END;
  CREATE TRIGGER finance_credit_notes_no_delete BEFORE DELETE ON finance_credit_notes BEGIN SELECT RAISE(ABORT,'finance credit notes cannot be deleted'); END;
  CREATE TRIGGER finance_credit_note_documents_no_update BEFORE UPDATE ON finance_credit_note_documents BEGIN SELECT RAISE(ABORT,'finance credit note documents are immutable'); END;
  CREATE TRIGGER finance_credit_note_documents_no_delete BEFORE DELETE ON finance_credit_note_documents BEGIN SELECT RAISE(ABORT,'finance credit note documents are immutable'); END;
  CREATE TRIGGER finance_statement_batches_no_update BEFORE UPDATE ON finance_bank_statement_batches BEGIN SELECT RAISE(ABORT,'finance statement batches are immutable'); END;
  CREATE TRIGGER finance_statement_batches_no_delete BEFORE DELETE ON finance_bank_statement_batches BEGIN SELECT RAISE(ABORT,'finance statement batches are immutable'); END;
  CREATE TRIGGER finance_statement_lines_no_update BEFORE UPDATE ON finance_bank_statement_lines BEGIN SELECT RAISE(ABORT,'finance statement lines are immutable'); END;
  CREATE TRIGGER finance_statement_lines_no_delete BEFORE DELETE ON finance_bank_statement_lines BEGIN SELECT RAISE(ABORT,'finance statement lines are immutable'); END;
  CREATE TRIGGER finance_receipts_no_update BEFORE UPDATE ON finance_receipts BEGIN SELECT RAISE(ABORT,'finance receipts are immutable'); END;
  CREATE TRIGGER finance_receipts_no_delete BEFORE DELETE ON finance_receipts BEGIN SELECT RAISE(ABORT,'finance receipts are immutable'); END;
  CREATE TRIGGER finance_receipt_events_no_update BEFORE UPDATE ON finance_receipt_events BEGIN SELECT RAISE(ABORT,'finance receipt events are append-only'); END;
  CREATE TRIGGER finance_receipt_events_no_delete BEFORE DELETE ON finance_receipt_events BEGIN SELECT RAISE(ABORT,'finance receipt events are append-only'); END;
  CREATE TRIGGER finance_receipt_allocations_no_update BEFORE UPDATE ON finance_receipt_allocations BEGIN SELECT RAISE(ABORT,'finance receipt allocations are immutable'); END;
  CREATE TRIGGER finance_receipt_allocations_no_delete BEFORE DELETE ON finance_receipt_allocations BEGIN SELECT RAISE(ABORT,'finance receipt allocations are immutable'); END;
  CREATE TRIGGER finance_payment_requisitions_no_update BEFORE UPDATE ON finance_payment_requisitions BEGIN SELECT RAISE(ABORT,'finance payment requisitions are immutable'); END;
  CREATE TRIGGER finance_payment_requisitions_no_delete BEFORE DELETE ON finance_payment_requisitions BEGIN SELECT RAISE(ABORT,'finance payment requisitions are immutable'); END;
  CREATE TRIGGER finance_payment_events_no_update BEFORE UPDATE ON finance_payment_events BEGIN SELECT RAISE(ABORT,'finance payment events are append-only'); END;
  CREATE TRIGGER finance_payment_events_no_delete BEFORE DELETE ON finance_payment_events BEGIN SELECT RAISE(ABORT,'finance payment events are append-only'); END;
  CREATE TRIGGER finance_transfers_no_update BEFORE UPDATE ON finance_client_office_transfers BEGIN SELECT RAISE(ABORT,'finance transfers are immutable'); END;
  CREATE TRIGGER finance_transfers_no_delete BEFORE DELETE ON finance_client_office_transfers BEGIN SELECT RAISE(ABORT,'finance transfers are immutable'); END;
  CREATE TRIGGER finance_transfer_events_no_update BEFORE UPDATE ON finance_transfer_events BEGIN SELECT RAISE(ABORT,'finance transfer events are append-only'); END;
  CREATE TRIGGER finance_transfer_events_no_delete BEFORE DELETE ON finance_transfer_events BEGIN SELECT RAISE(ABORT,'finance transfer events are append-only'); END;
  CREATE TRIGGER finance_reconciliations_no_update BEFORE UPDATE ON finance_reconciliations BEGIN SELECT RAISE(ABORT,'finance reconciliations are immutable'); END;
  CREATE TRIGGER finance_reconciliations_no_delete BEFORE DELETE ON finance_reconciliations BEGIN SELECT RAISE(ABORT,'finance reconciliations are immutable'); END;
  CREATE TRIGGER finance_reconciliation_items_no_update BEFORE UPDATE ON finance_reconciliation_items BEGIN SELECT RAISE(ABORT,'finance reconciliation items are immutable'); END;
  CREATE TRIGGER finance_reconciliation_items_no_delete BEFORE DELETE ON finance_reconciliation_items BEGIN SELECT RAISE(ABORT,'finance reconciliation items are immutable'); END;
  CREATE TRIGGER finance_reconciliation_events_no_update BEFORE UPDATE ON finance_reconciliation_events BEGIN SELECT RAISE(ABORT,'finance reconciliation events are append-only'); END;
  CREATE TRIGGER finance_reconciliation_events_no_delete BEFORE DELETE ON finance_reconciliation_events BEGIN SELECT RAISE(ABORT,'finance reconciliation events are append-only'); END;
  CREATE TRIGGER finance_reconciliation_signoffs_no_update BEFORE UPDATE ON finance_reconciliation_signoffs BEGIN SELECT RAISE(ABORT,'finance reconciliation signoffs are immutable'); END;
  CREATE TRIGGER finance_reconciliation_signoffs_no_delete BEFORE DELETE ON finance_reconciliation_signoffs BEGIN SELECT RAISE(ABORT,'finance reconciliation signoffs are immutable'); END;
  CREATE TRIGGER finance_exceptions_no_update BEFORE UPDATE ON finance_exceptions BEGIN SELECT RAISE(ABORT,'finance exceptions are immutable'); END;
  CREATE TRIGGER finance_exceptions_no_delete BEFORE DELETE ON finance_exceptions BEGIN SELECT RAISE(ABORT,'finance exceptions are immutable'); END;
  CREATE TRIGGER finance_export_manifests_no_update BEFORE UPDATE ON finance_export_manifests BEGIN SELECT RAISE(ABORT,'finance export manifests are immutable'); END;
  CREATE TRIGGER finance_export_manifests_no_delete BEFORE DELETE ON finance_export_manifests BEGIN SELECT RAISE(ABORT,'finance export manifests are immutable'); END;
`;

export const governedBillingCashroomMigration = defineMigration({
  version: 13,
  name: 'governed billing and cashroom',
  sql,
});
