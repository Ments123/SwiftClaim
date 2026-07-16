import { defineMigration } from './types.js';

const negotiationSettlementSql = String.raw`
  ALTER TABLE workflow_stages ADD COLUMN allowed_next_stage_keys_json TEXT NOT NULL
    DEFAULT '[]' CHECK (
      json_valid(allowed_next_stage_keys_json)
      AND json_type(allowed_next_stage_keys_json) = 'array'
    );
  UPDATE workflow_stages SET allowed_next_stage_keys_json = CASE key
    WHEN 'enquiry' THEN '["assessment"]'
    WHEN 'assessment' THEN '["onboarding"]'
    WHEN 'onboarding' THEN '["evidence"]'
    WHEN 'evidence' THEN '["protocol"]'
    WHEN 'protocol' THEN '["expert"]'
    WHEN 'expert' THEN '["repairs_quantum"]'
    WHEN 'repairs_quantum' THEN '["negotiation"]'
    WHEN 'negotiation' THEN '["proceedings","settlement"]'
    WHEN 'proceedings' THEN '["settlement"]'
    WHEN 'settlement' THEN '["closure"]'
    ELSE '[]'
  END;

  CREATE TABLE negotiation_reviews (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    review_number INTEGER NOT NULL CHECK (review_number > 0),
    confidentiality TEXT NOT NULL CHECK (confidentiality IN (
      'ordinary', 'privileged', 'protected_negotiation'
    )),
    reviewed_on TEXT NOT NULL,
    author_user_id TEXT NOT NULL,
    reviewer_user_id TEXT,
    selected_offer_ids_json TEXT NOT NULL CHECK (
      json_valid(selected_offer_ids_json)
      AND json_type(selected_offer_ids_json) = 'array'
    ),
    loss_schedule_id TEXT,
    general_damages_review_id TEXT,
    work_schedule_id TEXT,
    confirmed_facts TEXT NOT NULL,
    options_explained TEXT NOT NULL,
    risk_analysis TEXT NOT NULL,
    costs_funding_explanation TEXT NOT NULL,
    human_recommendation TEXT NOT NULL DEFAULT '',
    advice_limitations TEXT NOT NULL,
    client_questions TEXT NOT NULL DEFAULT '',
    source_manifest_json TEXT NOT NULL CHECK (json_valid(source_manifest_json)),
    source_manifest_digest TEXT NOT NULL CHECK (length(source_manifest_digest) = 64),
    supersedes_review_id TEXT,
    correction_reason TEXT NOT NULL DEFAULT '',
    idempotency_key TEXT NOT NULL,
    command_payload_json TEXT NOT NULL CHECK (json_valid(command_payload_json)),
    created_at TEXT NOT NULL,
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (author_user_id, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (reviewer_user_id, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (loss_schedule_id, firm_id, matter_id)
      REFERENCES loss_schedules(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (general_damages_review_id, firm_id, matter_id)
      REFERENCES general_damages_reviews(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (work_schedule_id, firm_id, matter_id)
      REFERENCES work_schedules(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_review_id, firm_id, matter_id)
      REFERENCES negotiation_reviews(id, firm_id, matter_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, review_number),
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE settlement_authority_versions (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    source TEXT NOT NULL CHECK (source IN (
      'client_specific', 'retainer', 'firm_policy',
      'court_or_representative', 'other'
    )),
    scope TEXT NOT NULL,
    action_types_json TEXT NOT NULL CHECK (
      json_valid(action_types_json) AND json_type(action_types_json) = 'array'
    ),
    minimum_amount_minor INTEGER CHECK (
      minimum_amount_minor IS NULL OR minimum_amount_minor >= 0
    ),
    maximum_amount_minor INTEGER CHECK (
      maximum_amount_minor IS NULL OR maximum_amount_minor >= 0
    ),
    non_money_constraints TEXT NOT NULL DEFAULT '',
    costs_constraints TEXT NOT NULL DEFAULT '',
    repair_constraints TEXT NOT NULL DEFAULT '',
    expires_at TEXT,
    review_on TEXT,
    requires_client_instruction INTEGER NOT NULL CHECK (
      requires_client_instruction IN (0, 1)
    ),
    requires_partner_approval INTEGER NOT NULL CHECK (
      requires_partner_approval IN (0, 1)
    ),
    source_document_id TEXT,
    source_document_version_id TEXT,
    review_note TEXT NOT NULL,
    supersedes_authority_id TEXT,
    idempotency_key TEXT NOT NULL,
    command_payload_json TEXT NOT NULL CHECK (json_valid(command_payload_json)),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (
      minimum_amount_minor IS NULL OR maximum_amount_minor IS NULL
      OR maximum_amount_minor >= minimum_amount_minor
    ),
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (source_document_id, firm_id, matter_id)
      REFERENCES documents(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_document_version_id, firm_id, source_document_id)
      REFERENCES document_versions(id, firm_id, document_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_authority_id, firm_id, matter_id)
      REFERENCES settlement_authority_versions(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, version),
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE negotiation_actions (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    action_reference TEXT NOT NULL,
    record_version INTEGER NOT NULL DEFAULT 1 CHECK (record_version > 0),
    action_type TEXT NOT NULL CHECK (action_type IN (
      'make_offer', 'counteroffer', 'accept', 'reject', 'withdraw',
      'clarify', 'record_agreement'
    )),
    confidentiality TEXT NOT NULL CHECK (confidentiality IN (
      'ordinary', 'privileged', 'protected_negotiation'
    )),
    linked_offer_id TEXT,
    current_action_version_id TEXT,
    status TEXT NOT NULL CHECK (status IN (
      'draft', 'instruction_required', 'approval_required', 'authorised',
      'externally_recorded', 'cancelled', 'superseded'
    )),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (linked_offer_id, firm_id, matter_id)
      REFERENCES offers(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (current_action_version_id, firm_id, matter_id)
      REFERENCES negotiation_action_versions(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (updated_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, action_reference),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE negotiation_action_versions (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    action_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    recipients_json TEXT NOT NULL CHECK (
      json_valid(recipients_json) AND json_type(recipients_json) = 'array'
    ),
    scope TEXT NOT NULL CHECK (scope IN (
      'whole_claim', 'part_of_claim', 'issue', 'costs_only', 'works_only'
    )),
    scope_description TEXT NOT NULL,
    damages_minor INTEGER CHECK (damages_minor IS NULL OR damages_minor >= 0),
    costs_minor INTEGER CHECK (costs_minor IS NULL OR costs_minor >= 0),
    total_minor INTEGER CHECK (total_minor IS NULL OR total_minor >= 0),
    currency TEXT NOT NULL CHECK (currency = 'GBP'),
    works_terms TEXT NOT NULL DEFAULT '',
    non_money_terms TEXT NOT NULL DEFAULT '',
    interest_treatment TEXT NOT NULL DEFAULT '',
    confidentiality_terms TEXT NOT NULL DEFAULT '',
    payment_terms TEXT NOT NULL DEFAULT '',
    proposed_instrument_type TEXT NOT NULL CHECK (proposed_instrument_type IN (
      'part36_acceptance', 'consent_order', 'tomlin_order',
      'settlement_agreement', 'deed', 'oral_recorded', 'other'
    )),
    document_version_ids_json TEXT NOT NULL CHECK (
      json_valid(document_version_ids_json)
      AND json_type(document_version_ids_json) = 'array'
    ),
    terms_digest TEXT NOT NULL CHECK (length(terms_digest) = 64),
    change_reason TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (action_id, firm_id, matter_id)
      REFERENCES negotiation_actions(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (action_id, version),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE client_instructions (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    confidentiality TEXT NOT NULL CHECK (confidentiality IN (
      'ordinary', 'privileged', 'protected_negotiation'
    )),
    review_id TEXT,
    action_id TEXT,
    action_version_id TEXT,
    action_version INTEGER,
    settlement_id TEXT,
    settlement_terms_version_id TEXT,
    settlement_terms_version INTEGER,
    instruction_type TEXT NOT NULL CHECK (instruction_type IN (
      'accept', 'reject', 'counter', 'clarify', 'continue_negotiation',
      'issue_proceedings', 'agree_terms', 'other'
    )),
    instructing_person TEXT NOT NULL,
    relationship_to_client TEXT NOT NULL,
    authority_basis TEXT NOT NULL,
    decision_note TEXT NOT NULL,
    received_method TEXT NOT NULL CHECK (received_method IN (
      'in_person', 'telephone', 'video', 'email', 'letter', 'portal', 'other'
    )),
    received_at TEXT NOT NULL,
    taken_by TEXT NOT NULL,
    identity_status TEXT NOT NULL CHECK (identity_status IN (
      'confirmed', 'failed', 'not_required_reviewed'
    )),
    identity_note TEXT NOT NULL,
    understanding_confirmed INTEGER NOT NULL CHECK (understanding_confirmed = 1),
    accessibility_measures TEXT NOT NULL,
    source_communication_entry_id TEXT,
    source_document_id TEXT,
    source_document_version_id TEXT,
    supersedes_instruction_id TEXT,
    correction_reason TEXT NOT NULL DEFAULT '',
    idempotency_key TEXT NOT NULL,
    command_payload_json TEXT NOT NULL CHECK (json_valid(command_payload_json)),
    created_at TEXT NOT NULL,
    CHECK (
      (action_id IS NULL AND action_version_id IS NULL AND action_version IS NULL)
      OR (action_id IS NOT NULL AND action_version_id IS NOT NULL AND action_version IS NOT NULL)
    ),
    CHECK (
      (settlement_id IS NULL AND settlement_terms_version_id IS NULL
        AND settlement_terms_version IS NULL)
      OR (settlement_id IS NOT NULL AND settlement_terms_version_id IS NOT NULL
        AND settlement_terms_version IS NOT NULL)
    ),
    CHECK (action_id IS NULL OR settlement_id IS NULL),
    CHECK (
      source_communication_entry_id IS NOT NULL
      OR source_document_version_id IS NOT NULL
    ),
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (review_id, firm_id, matter_id)
      REFERENCES negotiation_reviews(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (action_id, firm_id, matter_id)
      REFERENCES negotiation_actions(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (action_version_id, firm_id, matter_id)
      REFERENCES negotiation_action_versions(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (settlement_id, firm_id, matter_id)
      REFERENCES settlements(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (settlement_terms_version_id, firm_id, matter_id)
      REFERENCES settlement_term_versions(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (taken_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_communication_entry_id, firm_id, matter_id)
      REFERENCES communication_entries(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_document_id, firm_id, matter_id)
      REFERENCES documents(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_document_version_id, firm_id, source_document_id)
      REFERENCES document_versions(id, firm_id, document_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_instruction_id, firm_id, matter_id)
      REFERENCES client_instructions(id, firm_id, matter_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE negotiation_approval_events (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    action_id TEXT NOT NULL,
    action_version_id TEXT NOT NULL,
    action_version INTEGER NOT NULL CHECK (action_version > 0),
    event_sequence INTEGER NOT NULL CHECK (event_sequence > 0),
    client_instruction_id TEXT NOT NULL,
    authority_version_id TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN (
      'submitted', 'approved', 'rejected', 'withdrawn', 'invalidated'
    )),
    note TEXT NOT NULL,
    actor_user_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    FOREIGN KEY (action_id, firm_id, matter_id)
      REFERENCES negotiation_actions(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (action_version_id, firm_id, matter_id)
      REFERENCES negotiation_action_versions(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (client_instruction_id, firm_id, matter_id)
      REFERENCES client_instructions(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (authority_version_id, firm_id, matter_id)
      REFERENCES settlement_authority_versions(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (actor_user_id, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (action_id, event_sequence),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE negotiation_external_acts (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    action_id TEXT NOT NULL,
    action_version_id TEXT NOT NULL,
    action_version INTEGER NOT NULL CHECK (action_version > 0),
    occurred_at TEXT NOT NULL,
    method TEXT NOT NULL CHECK (method IN (
      'email', 'whatsapp', 'letter', 'portal', 'telephone', 'in_person', 'other'
    )),
    recipient TEXT NOT NULL,
    source_communication_entry_id TEXT,
    source_document_id TEXT,
    source_document_version_id TEXT,
    factual_note TEXT NOT NULL,
    recorded_by TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    CHECK (
      source_communication_entry_id IS NOT NULL
      OR source_document_version_id IS NOT NULL
    ),
    FOREIGN KEY (action_id, firm_id, matter_id)
      REFERENCES negotiation_actions(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (action_version_id, firm_id, matter_id)
      REFERENCES negotiation_action_versions(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (source_communication_entry_id, firm_id, matter_id)
      REFERENCES communication_entries(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_document_id, firm_id, matter_id)
      REFERENCES documents(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_document_version_id, firm_id, source_document_id)
      REFERENCES document_versions(id, firm_id, document_id) ON DELETE RESTRICT,
    FOREIGN KEY (recorded_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (action_version_id),
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE settlements (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    settlement_reference TEXT NOT NULL,
    record_version INTEGER NOT NULL DEFAULT 1 CHECK (record_version > 0),
    settlement_type TEXT NOT NULL CHECK (settlement_type IN (
      'part36_acceptance', 'consent_order', 'tomlin_order',
      'settlement_agreement', 'deed', 'oral_recorded', 'other'
    )),
    scope TEXT NOT NULL CHECK (scope IN (
      'whole_claim', 'part_of_claim', 'issue', 'costs_only', 'works_only'
    )),
    confidentiality TEXT NOT NULL CHECK (confidentiality IN (
      'ordinary', 'privileged', 'protected_negotiation'
    )),
    title TEXT NOT NULL,
    originating_action_id TEXT,
    linked_offer_id TEXT,
    client_instruction_id TEXT NOT NULL,
    current_terms_version_id TEXT,
    status TEXT NOT NULL CHECK (status IN (
      'preparing', 'authority_required', 'terms_agreed', 'instrument_pending',
      'court_approval_pending', 'concluded', 'failed', 'superseded'
    )),
    court_approval_position TEXT NOT NULL DEFAULT 'unknown' CHECK (
      court_approval_position IN (
        'unknown', 'not_required_reviewed', 'required', 'obtained'
      )
    ),
    instrument_document_id TEXT,
    instrument_document_version_id TEXT,
    source_communication_entry_id TEXT,
    conclusion_note TEXT NOT NULL DEFAULT '',
    concluded_by TEXT,
    concluded_at TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (originating_action_id, firm_id, matter_id)
      REFERENCES negotiation_actions(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (linked_offer_id, firm_id, matter_id)
      REFERENCES offers(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (client_instruction_id, firm_id, matter_id)
      REFERENCES client_instructions(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (current_terms_version_id, firm_id, matter_id)
      REFERENCES settlement_term_versions(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (instrument_document_id, firm_id, matter_id)
      REFERENCES documents(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (instrument_document_version_id, firm_id, instrument_document_id)
      REFERENCES document_versions(id, firm_id, document_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_communication_entry_id, firm_id, matter_id)
      REFERENCES communication_entries(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (concluded_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (updated_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, settlement_reference),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE settlement_term_versions (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    settlement_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    damages_minor INTEGER CHECK (damages_minor IS NULL OR damages_minor >= 0),
    costs_minor INTEGER CHECK (costs_minor IS NULL OR costs_minor >= 0),
    total_minor INTEGER CHECK (total_minor IS NULL OR total_minor >= 0),
    currency TEXT NOT NULL CHECK (currency = 'GBP'),
    payment_method TEXT NOT NULL DEFAULT '',
    payment_due_at TEXT,
    repair_terms TEXT NOT NULL DEFAULT '',
    access_terms TEXT NOT NULL DEFAULT '',
    inspection_terms TEXT NOT NULL DEFAULT '',
    liability_admission_position TEXT NOT NULL DEFAULT '',
    interest_terms TEXT NOT NULL DEFAULT '',
    confidentiality_terms TEXT NOT NULL DEFAULT '',
    disposal_terms TEXT NOT NULL DEFAULT '',
    enforcement_terms TEXT NOT NULL DEFAULT '',
    other_terms TEXT NOT NULL DEFAULT '',
    source_document_version_ids_json TEXT NOT NULL CHECK (
      json_valid(source_document_version_ids_json)
      AND json_type(source_document_version_ids_json) = 'array'
    ),
    source_manifest_json TEXT NOT NULL CHECK (json_valid(source_manifest_json)),
    terms_digest TEXT NOT NULL CHECK (length(terms_digest) = 64),
    review_note TEXT NOT NULL,
    change_reason TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (settlement_id, firm_id, matter_id)
      REFERENCES settlements(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (settlement_id, version),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE settlement_obligations (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    settlement_id TEXT NOT NULL,
    settlement_terms_version_id TEXT NOT NULL,
    obligation_reference TEXT NOT NULL,
    obligation_type TEXT NOT NULL CHECK (obligation_type IN (
      'payment', 'costs', 'repair', 'access', 'inspection',
      'document', 'filing', 'confidentiality', 'other'
    )),
    responsible_party TEXT NOT NULL,
    beneficiary TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_minor INTEGER CHECK (amount_minor IS NULL OR amount_minor >= 0),
    due_at TEXT,
    timezone TEXT NOT NULL,
    evidence_requirement TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (settlement_id, firm_id, matter_id)
      REFERENCES settlements(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (settlement_terms_version_id, firm_id, matter_id)
      REFERENCES settlement_term_versions(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, settlement_id, obligation_reference),
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE settlement_obligation_events (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    obligation_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
      'due_confirmed', 'performance_asserted', 'part_satisfied', 'satisfied',
      'overdue_reviewed', 'disputed', 'waived', 'corrected'
    )),
    occurred_at TEXT NOT NULL,
    note TEXT NOT NULL,
    amount_satisfied_minor INTEGER CHECK (
      amount_satisfied_minor IS NULL OR amount_satisfied_minor >= 0
    ),
    evidence_document_version_ids_json TEXT NOT NULL CHECK (
      json_valid(evidence_document_version_ids_json)
      AND json_type(evidence_document_version_ids_json) = 'array'
    ),
    evidence_communication_entry_ids_json TEXT NOT NULL CHECK (
      json_valid(evidence_communication_entry_ids_json)
      AND json_type(evidence_communication_entry_ids_json) = 'array'
    ),
    supersedes_event_id TEXT,
    correction_reason TEXT NOT NULL DEFAULT '',
    waiver_authority_document_id TEXT,
    waiver_authority_document_version_id TEXT,
    recorded_by TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    FOREIGN KEY (obligation_id, firm_id, matter_id)
      REFERENCES settlement_obligations(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_event_id, firm_id, matter_id)
      REFERENCES settlement_obligation_events(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (waiver_authority_document_id, firm_id, matter_id)
      REFERENCES documents(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (
      waiver_authority_document_version_id, firm_id, waiver_authority_document_id
    ) REFERENCES document_versions(id, firm_id, document_id) ON DELETE RESTRICT,
    FOREIGN KEY (recorded_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE negotiation_command_receipts (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    command_type TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_digest TEXT NOT NULL CHECK (length(payload_digest) = 64),
    result_entity_type TEXT NOT NULL,
    result_entity_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, command_type, idempotency_key),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE INDEX idx_negotiation_reviews_scope
    ON negotiation_reviews(firm_id, matter_id, confidentiality, review_number DESC);
  CREATE INDEX idx_negotiation_instructions_action
    ON client_instructions(firm_id, matter_id, action_id, received_at DESC);
  CREATE INDEX idx_settlement_authority_current
    ON settlement_authority_versions(firm_id, matter_id, version DESC);
  CREATE INDEX idx_negotiation_actions_current
    ON negotiation_actions(firm_id, matter_id, confidentiality, status, updated_at DESC);
  CREATE INDEX idx_negotiation_approvals_action
    ON negotiation_approval_events(firm_id, matter_id, action_id, occurred_at, id);
  CREATE INDEX idx_settlements_current
    ON settlements(firm_id, matter_id, confidentiality, status, updated_at DESC);
  CREATE INDEX idx_settlement_obligations_due
    ON settlement_obligations(firm_id, matter_id, settlement_id, due_at);
  CREATE INDEX idx_settlement_obligation_events_history
    ON settlement_obligation_events(firm_id, matter_id, obligation_id, occurred_at, recorded_at);

  CREATE TRIGGER negotiation_reviews_no_update
  BEFORE UPDATE ON negotiation_reviews BEGIN
    SELECT RAISE(ABORT, 'negotiation reviews are immutable');
  END;
  CREATE TRIGGER negotiation_reviews_no_delete
  BEFORE DELETE ON negotiation_reviews BEGIN
    SELECT RAISE(ABORT, 'negotiation reviews are immutable');
  END;
  CREATE TRIGGER client_instructions_no_update
  BEFORE UPDATE ON client_instructions BEGIN
    SELECT RAISE(ABORT, 'client instructions are immutable');
  END;
  CREATE TRIGGER client_instructions_no_delete
  BEFORE DELETE ON client_instructions BEGIN
    SELECT RAISE(ABORT, 'client instructions are immutable');
  END;
  CREATE TRIGGER settlement_authority_versions_no_update
  BEFORE UPDATE ON settlement_authority_versions BEGIN
    SELECT RAISE(ABORT, 'settlement authority versions are immutable');
  END;
  CREATE TRIGGER settlement_authority_versions_no_delete
  BEFORE DELETE ON settlement_authority_versions BEGIN
    SELECT RAISE(ABORT, 'settlement authority versions are immutable');
  END;
  CREATE TRIGGER negotiation_actions_no_delete
  BEFORE DELETE ON negotiation_actions BEGIN
    SELECT RAISE(ABORT, 'negotiation actions cannot be deleted');
  END;
  CREATE TRIGGER negotiation_action_versions_no_update
  BEFORE UPDATE ON negotiation_action_versions BEGIN
    SELECT RAISE(ABORT, 'negotiation action versions are immutable');
  END;
  CREATE TRIGGER negotiation_action_versions_no_delete
  BEFORE DELETE ON negotiation_action_versions BEGIN
    SELECT RAISE(ABORT, 'negotiation action versions are immutable');
  END;
  CREATE TRIGGER negotiation_approval_events_no_update
  BEFORE UPDATE ON negotiation_approval_events BEGIN
    SELECT RAISE(ABORT, 'negotiation approval events are append-only');
  END;
  CREATE TRIGGER negotiation_approval_events_no_delete
  BEFORE DELETE ON negotiation_approval_events BEGIN
    SELECT RAISE(ABORT, 'negotiation approval events are append-only');
  END;
  CREATE TRIGGER negotiation_external_acts_no_update
  BEFORE UPDATE ON negotiation_external_acts BEGIN
    SELECT RAISE(ABORT, 'negotiation external acts are immutable');
  END;
  CREATE TRIGGER negotiation_external_acts_no_delete
  BEFORE DELETE ON negotiation_external_acts BEGIN
    SELECT RAISE(ABORT, 'negotiation external acts are immutable');
  END;
  CREATE TRIGGER settlements_no_delete
  BEFORE DELETE ON settlements BEGIN
    SELECT RAISE(ABORT, 'settlements cannot be deleted');
  END;
  CREATE TRIGGER settlement_term_versions_no_update
  BEFORE UPDATE ON settlement_term_versions BEGIN
    SELECT RAISE(ABORT, 'settlement term versions are immutable');
  END;
  CREATE TRIGGER settlement_term_versions_no_delete
  BEFORE DELETE ON settlement_term_versions BEGIN
    SELECT RAISE(ABORT, 'settlement term versions are immutable');
  END;
  CREATE TRIGGER settlement_obligations_no_update
  BEFORE UPDATE ON settlement_obligations BEGIN
    SELECT RAISE(ABORT, 'settlement obligations are immutable');
  END;
  CREATE TRIGGER settlement_obligations_no_delete
  BEFORE DELETE ON settlement_obligations BEGIN
    SELECT RAISE(ABORT, 'settlement obligations are immutable');
  END;
  CREATE TRIGGER settlement_obligation_events_no_update
  BEFORE UPDATE ON settlement_obligation_events BEGIN
    SELECT RAISE(ABORT, 'settlement obligation events are append-only');
  END;
  CREATE TRIGGER settlement_obligation_events_no_delete
  BEFORE DELETE ON settlement_obligation_events BEGIN
    SELECT RAISE(ABORT, 'settlement obligation events are append-only');
  END;
  CREATE TRIGGER negotiation_command_receipts_no_update
  BEFORE UPDATE ON negotiation_command_receipts BEGIN
    SELECT RAISE(ABORT, 'negotiation command receipts are immutable');
  END;
  CREATE TRIGGER negotiation_command_receipts_no_delete
  BEFORE DELETE ON negotiation_command_receipts BEGIN
    SELECT RAISE(ABORT, 'negotiation command receipts are immutable');
  END;
`;

export const negotiationSettlementMigration = defineMigration({
  version: 8,
  name: 'negotiation and settlement authority',
  sql: negotiationSettlementSql,
});
