import { defineMigration } from './types.js';

const protocolExpertsSql = String.raw`
  CREATE UNIQUE INDEX idx_documents_tenant_matter_identity
    ON documents(id, firm_id, matter_id);
  CREATE UNIQUE INDEX idx_document_versions_tenant_document_identity
    ON document_versions(id, firm_id, document_id);

  CREATE TABLE protocol_cases (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    protocol_status TEXT NOT NULL DEFAULT 'preparing' CHECK (protocol_status IN (
      'preparing', 'approved', 'issued', 'awaiting_response',
      'response_received', 'expert_work', 'taking_stock', 'complete'
    )),
    expert_route TEXT NOT NULL DEFAULT 'undecided' CHECK (expert_route IN (
      'undecided', 'proposed_single_joint',
      'single_joint_joint_instructions',
      'single_joint_separate_instructions', 'separate_experts',
      'joint_inspection', 'urgent_own_expert', 'not_required'
    )),
    expert_route_reason TEXT NOT NULL DEFAULT '',
    urgent_reason TEXT NOT NULL DEFAULT '',
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
    UNIQUE (matter_id),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE letters_of_claim (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    protocol_case_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    claimant_address TEXT NOT NULL DEFAULT '',
    landlord_recipient TEXT NOT NULL DEFAULT '',
    landlord_address TEXT NOT NULL DEFAULT '',
    effect_narrative TEXT NOT NULL DEFAULT '',
    personal_injury_status TEXT NOT NULL DEFAULT 'under_review' CHECK (
      personal_injury_status IN (
        'none', 'minor_gp_evidence', 'other_protocol_required', 'under_review'
      )
    ),
    personal_injury_summary TEXT NOT NULL DEFAULT '',
    special_damages_status TEXT NOT NULL DEFAULT 'under_review' CHECK (
      special_damages_status IN ('none', 'claimed', 'under_review')
    ),
    special_damages_summary TEXT NOT NULL DEFAULT '',
    access_windows_json TEXT NOT NULL DEFAULT '[]'
      CHECK (json_valid(access_windows_json)
        AND json_type(access_windows_json) = 'array'),
    expert_proposal_summary TEXT NOT NULL DEFAULT '',
    disclosure_requests_json TEXT NOT NULL DEFAULT '[]'
      CHECK (json_valid(disclosure_requests_json)
        AND json_type(disclosure_requests_json) = 'array'),
    additional_content TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'draft' CHECK (
      state IN ('draft', 'ready_for_review', 'approved', 'superseded')
    ),
    author_user_id TEXT NOT NULL,
    reviewer_user_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (protocol_case_id, firm_id, matter_id)
      REFERENCES protocol_cases(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (author_user_id, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (reviewer_user_id, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (protocol_case_id),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE letter_of_claim_versions (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    protocol_case_id TEXT NOT NULL,
    letter_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    content_json TEXT NOT NULL CHECK (json_valid(content_json)),
    source_manifest_json TEXT NOT NULL CHECK (json_valid(source_manifest_json)),
    template_key TEXT NOT NULL,
    renderer_version TEXT NOT NULL,
    content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
    document_id TEXT NOT NULL,
    document_version_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    command_payload_json TEXT NOT NULL CHECK (json_valid(command_payload_json)),
    approved_by TEXT NOT NULL,
    approved_at TEXT NOT NULL,
    FOREIGN KEY (protocol_case_id, firm_id, matter_id)
      REFERENCES protocol_cases(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (letter_id, firm_id, matter_id)
      REFERENCES letters_of_claim(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (document_id, firm_id, matter_id)
      REFERENCES documents(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (document_version_id, firm_id, document_id)
      REFERENCES document_versions(id, firm_id, document_id) ON DELETE RESTRICT,
    FOREIGN KEY (approved_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (letter_id, version),
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE protocol_service_events (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    letter_version_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
      'dispatched', 'actual_receipt', 'deemed_receipt', 'receipt_disputed',
      'delivery_failed', 'corrected'
    )),
    method TEXT NOT NULL CHECK (method IN (
      'email', 'post', 'hand', 'portal', 'courier', 'other'
    )),
    occurred_at TEXT NOT NULL,
    legal_trigger_on TEXT CHECK (
      legal_trigger_on IS NULL OR
      legal_trigger_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    ),
    recipient TEXT NOT NULL,
    destination TEXT NOT NULL,
    source_detail TEXT NOT NULL,
    supporting_document_id TEXT,
    supporting_document_version_id TEXT,
    supersedes_event_id TEXT,
    correction_reason TEXT NOT NULL DEFAULT '',
    idempotency_key TEXT NOT NULL,
    command_payload_json TEXT NOT NULL CHECK (json_valid(command_payload_json)),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (
      event_type NOT IN ('actual_receipt', 'deemed_receipt')
      OR legal_trigger_on IS NOT NULL
    ),
    CHECK (
      supersedes_event_id IS NULL OR length(correction_reason) >= 10
    ),
    FOREIGN KEY (letter_version_id, firm_id, matter_id)
      REFERENCES letter_of_claim_versions(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (supporting_document_id, firm_id, matter_id)
      REFERENCES documents(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (
      supporting_document_version_id, firm_id, supporting_document_id
    ) REFERENCES document_versions(id, firm_id, document_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_event_id, firm_id, matter_id)
      REFERENCES protocol_service_events(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE landlord_responses (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    protocol_case_id TEXT NOT NULL,
    response_type TEXT NOT NULL CHECK (response_type IN (
      'initial', 'expert_proposal', 'substantive', 'supplemental',
      'no_response_recorded'
    )),
    received_on TEXT CHECK (
      received_on IS NULL OR
      received_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    ),
    responding_party TEXT NOT NULL,
    contact_name TEXT NOT NULL DEFAULT '',
    general_liability_position TEXT NOT NULL CHECK (
      general_liability_position IN (
        'admitted', 'partly_admitted', 'denied', 'reserved',
        'not_addressed', 'no_response'
      )
    ),
    liability_reasons TEXT NOT NULL DEFAULT '',
    notice_position TEXT NOT NULL DEFAULT '',
    access_position TEXT NOT NULL DEFAULT '',
    disclosure_status TEXT NOT NULL CHECK (disclosure_status IN (
      'complete', 'partial', 'withheld', 'none', 'not_applicable'
    )),
    disclosure_summary TEXT NOT NULL DEFAULT '',
    expert_proposal_position TEXT NOT NULL CHECK (
      expert_proposal_position IN (
        'agreed', 'agreed_separate_instructions', 'joint_inspection',
        'objected', 'not_addressed', 'not_applicable'
      )
    ),
    expert_proposal_summary TEXT NOT NULL DEFAULT '',
    works_schedule TEXT NOT NULL DEFAULT '',
    works_start_on TEXT,
    works_complete_on TEXT,
    compensation_offer_minor INTEGER CHECK (
      compensation_offer_minor IS NULL OR compensation_offer_minor >= 0
    ),
    costs_offer_minor INTEGER CHECK (
      costs_offer_minor IS NULL OR costs_offer_minor >= 0
    ),
    currency TEXT NOT NULL DEFAULT 'GBP'
      CHECK (length(currency) = 3 AND currency = upper(currency)),
    source_document_id TEXT,
    source_document_version_id TEXT,
    supersedes_response_id TEXT,
    correction_reason TEXT NOT NULL DEFAULT '',
    idempotency_key TEXT NOT NULL,
    command_payload_json TEXT NOT NULL CHECK (json_valid(command_payload_json)),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (
      supersedes_response_id IS NULL OR length(correction_reason) >= 10
    ),
    FOREIGN KEY (protocol_case_id, firm_id, matter_id)
      REFERENCES protocol_cases(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_document_id, firm_id, matter_id)
      REFERENCES documents(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_document_version_id, firm_id, source_document_id)
      REFERENCES document_versions(id, firm_id, document_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_response_id, firm_id, matter_id)
      REFERENCES landlord_responses(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE landlord_response_defects (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    response_id TEXT NOT NULL,
    defect_id TEXT NOT NULL,
    position TEXT NOT NULL CHECK (position IN (
      'admitted', 'partly_admitted', 'denied', 'not_addressed', 'unclear'
    )),
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (response_id, firm_id, matter_id)
      REFERENCES landlord_responses(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (defect_id, firm_id, matter_id)
      REFERENCES defects(id, firm_id, matter_id) ON DELETE RESTRICT,
    UNIQUE (response_id, defect_id),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE expert_engagements (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    protocol_case_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    route TEXT NOT NULL CHECK (route IN (
      'proposed_single_joint', 'single_joint_joint_instructions',
      'single_joint_separate_instructions', 'separate_experts',
      'joint_inspection', 'urgent_own_expert'
    )),
    expert_role TEXT NOT NULL CHECK (expert_role IN (
      'building_surveyor', 'environmental_health',
      'other_housing_conditions'
    )),
    expert_name TEXT NOT NULL,
    organisation TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    expertise TEXT NOT NULL,
    qualifications TEXT NOT NULL DEFAULT '',
    registration_body TEXT NOT NULL DEFAULT '',
    registration_reference TEXT NOT NULL DEFAULT '',
    verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (
      verification_status IN ('unverified', 'user_verified')
    ),
    verification_method TEXT NOT NULL DEFAULT '',
    verified_on TEXT,
    proposed_by TEXT NOT NULL CHECK (
      proposed_by IN ('claimant', 'landlord', 'jointly', 'court', 'other')
    ),
    single_joint INTEGER NOT NULL CHECK (single_joint IN (0, 1)),
    terms_status TEXT NOT NULL DEFAULT 'not_requested' CHECK (
      terms_status IN ('not_requested', 'requested', 'received', 'accepted', 'rejected')
    ),
    fee_basis TEXT NOT NULL DEFAULT '',
    fee_minor INTEGER CHECK (fee_minor IS NULL OR fee_minor >= 0),
    currency TEXT NOT NULL DEFAULT 'GBP'
      CHECK (length(currency) = 3 AND currency = upper(currency)),
    payer_split_json TEXT NOT NULL DEFAULT '{}'
      CHECK (json_valid(payer_split_json)
        AND json_type(payer_split_json) = 'object'),
    availability_summary TEXT NOT NULL DEFAULT '',
    target_report_on TEXT,
    state TEXT NOT NULL DEFAULT 'candidate' CHECK (state IN (
      'candidate', 'checks_pending', 'terms_pending', 'approved',
      'instructed', 'inspection_booked', 'report_due',
      'report_received', 'reviewed', 'cancelled'
    )),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (protocol_case_id, firm_id, matter_id)
      REFERENCES protocol_cases(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (updated_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE expert_conflict_checks (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    engagement_id TEXT NOT NULL,
    parties_checked_json TEXT NOT NULL
      CHECK (json_valid(parties_checked_json)
        AND json_type(parties_checked_json) = 'array'),
    method TEXT NOT NULL,
    search_detail TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (
      outcome IN ('clear', 'potential', 'blocked', 'unable_to_complete')
    ),
    decision TEXT NOT NULL CHECK (
      decision IN ('clear_to_proceed', 'proceed_with_override', 'do_not_proceed')
    ),
    reason TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    command_payload_json TEXT NOT NULL CHECK (json_valid(command_payload_json)),
    checked_by TEXT NOT NULL,
    checked_at TEXT NOT NULL,
    FOREIGN KEY (engagement_id, firm_id, matter_id)
      REFERENCES expert_engagements(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (checked_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE expert_instruction_versions (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    engagement_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    content_json TEXT NOT NULL CHECK (json_valid(content_json)),
    source_manifest_json TEXT NOT NULL CHECK (json_valid(source_manifest_json)),
    template_key TEXT NOT NULL,
    renderer_version TEXT NOT NULL,
    content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
    document_id TEXT NOT NULL,
    document_version_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    command_payload_json TEXT NOT NULL CHECK (json_valid(command_payload_json)),
    approved_by TEXT NOT NULL,
    approved_at TEXT NOT NULL,
    FOREIGN KEY (engagement_id, firm_id, matter_id)
      REFERENCES expert_engagements(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (document_id, firm_id, matter_id)
      REFERENCES documents(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (document_version_id, firm_id, document_id)
      REFERENCES document_versions(id, firm_id, document_id) ON DELETE RESTRICT,
    FOREIGN KEY (approved_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (engagement_id, version),
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE expert_milestone_events (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    engagement_id TEXT NOT NULL,
    instruction_version_id TEXT,
    event_type TEXT NOT NULL CHECK (event_type IN (
      'expert_proposed', 'expert_agreed', 'expert_objected', 'expert_withdrawn',
      'terms_offered', 'terms_accepted', 'terms_rejected',
      'instruction_dispatched', 'instruction_acknowledged',
      'inspection_proposed', 'inspection_booked', 'inspection_rescheduled',
      'inspection_completed', 'inspection_failed', 'inspection_cancelled',
      'access_provided', 'access_refused', 'access_unavailable',
      'report_received', 'report_reviewed', 'report_superseded', 'report_shared',
      'joint_schedule_received', 'urgent_issue_escalated',
      'engagement_completed', 'engagement_cancelled'
    )),
    occurred_at TEXT NOT NULL,
    legal_trigger_on TEXT,
    detail TEXT NOT NULL,
    supporting_document_id TEXT,
    supporting_document_version_id TEXT,
    supersedes_event_id TEXT,
    correction_reason TEXT NOT NULL DEFAULT '',
    idempotency_key TEXT NOT NULL,
    command_payload_json TEXT NOT NULL CHECK (json_valid(command_payload_json)),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (
      supersedes_event_id IS NULL OR length(correction_reason) >= 10
    ),
    FOREIGN KEY (engagement_id, firm_id, matter_id)
      REFERENCES expert_engagements(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (instruction_version_id, firm_id, matter_id)
      REFERENCES expert_instruction_versions(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (supporting_document_id, firm_id, matter_id)
      REFERENCES documents(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (
      supporting_document_version_id, firm_id, supporting_document_id
    ) REFERENCES document_versions(id, firm_id, document_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_event_id, firm_id, matter_id)
      REFERENCES expert_milestone_events(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE expert_report_records (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    engagement_id TEXT NOT NULL,
    report_type TEXT NOT NULL CHECK (report_type IN (
      'single_joint_report', 'party_report', 'agreed_schedule',
      'supplemental_report', 'other'
    )),
    report_on TEXT NOT NULL,
    received_on TEXT NOT NULL,
    coverage_summary TEXT NOT NULL,
    urgent_works_identified INTEGER NOT NULL CHECK (
      urgent_works_identified IN (0, 1)
    ),
    document_id TEXT NOT NULL,
    document_version_id TEXT NOT NULL,
    supersedes_report_id TEXT,
    idempotency_key TEXT NOT NULL,
    command_payload_json TEXT NOT NULL CHECK (json_valid(command_payload_json)),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (engagement_id, firm_id, matter_id)
      REFERENCES expert_engagements(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (document_id, firm_id, matter_id)
      REFERENCES documents(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (document_version_id, firm_id, document_id)
      REFERENCES document_versions(id, firm_id, document_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_report_id, firm_id, matter_id)
      REFERENCES expert_report_records(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE expert_questions (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    engagement_id TEXT NOT NULL,
    report_id TEXT NOT NULL,
    question TEXT NOT NULL,
    clarification_purpose TEXT NOT NULL,
    dispatched_on TEXT,
    response_due_on TEXT,
    legal_basis TEXT NOT NULL CHECK (legal_basis IN (
      'none', 'agreed', 'solicitor_set', 'cpr35_6'
    )),
    idempotency_key TEXT NOT NULL,
    command_payload_json TEXT NOT NULL CHECK (json_valid(command_payload_json)),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (engagement_id, firm_id, matter_id)
      REFERENCES expert_engagements(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (report_id, firm_id, matter_id)
      REFERENCES expert_report_records(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE expert_question_answers (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    engagement_id TEXT NOT NULL,
    question_id TEXT NOT NULL,
    received_on TEXT NOT NULL,
    summary TEXT NOT NULL,
    document_id TEXT NOT NULL,
    document_version_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    command_payload_json TEXT NOT NULL CHECK (json_valid(command_payload_json)),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (engagement_id, firm_id, matter_id)
      REFERENCES expert_engagements(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (question_id, firm_id, matter_id)
      REFERENCES expert_questions(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (document_id, firm_id, matter_id)
      REFERENCES documents(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (document_version_id, firm_id, document_id)
      REFERENCES document_versions(id, firm_id, document_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE INDEX idx_protocol_cases_matter
    ON protocol_cases(firm_id, matter_id, protocol_status);
  CREATE INDEX idx_letter_versions_matter
    ON letter_of_claim_versions(firm_id, matter_id, approved_at DESC);
  CREATE INDEX idx_protocol_service_history
    ON protocol_service_events(firm_id, matter_id, occurred_at DESC);
  CREATE INDEX idx_landlord_responses_history
    ON landlord_responses(firm_id, matter_id, created_at DESC);
  CREATE INDEX idx_expert_engagements_state
    ON expert_engagements(firm_id, matter_id, state);
  CREATE INDEX idx_expert_milestones_history
    ON expert_milestone_events(firm_id, matter_id, occurred_at DESC);
  CREATE INDEX idx_expert_reports_history
    ON expert_report_records(firm_id, matter_id, received_on DESC);
  CREATE INDEX idx_expert_questions_due
    ON expert_questions(firm_id, matter_id, response_due_on);

  CREATE TRIGGER letter_of_claim_versions_no_update
  BEFORE UPDATE ON letter_of_claim_versions BEGIN
    SELECT RAISE(ABORT, 'letter_of_claim_versions is immutable');
  END;
  CREATE TRIGGER letter_of_claim_versions_no_delete
  BEFORE DELETE ON letter_of_claim_versions BEGIN
    SELECT RAISE(ABORT, 'letter_of_claim_versions is immutable');
  END;
  CREATE TRIGGER protocol_service_events_no_update
  BEFORE UPDATE ON protocol_service_events BEGIN
    SELECT RAISE(ABORT, 'protocol_service_events is append-only');
  END;
  CREATE TRIGGER protocol_service_events_no_delete
  BEFORE DELETE ON protocol_service_events BEGIN
    SELECT RAISE(ABORT, 'protocol_service_events is append-only');
  END;
  CREATE TRIGGER landlord_responses_no_update
  BEFORE UPDATE ON landlord_responses BEGIN
    SELECT RAISE(ABORT, 'landlord_responses is append-only');
  END;
  CREATE TRIGGER landlord_responses_no_delete
  BEFORE DELETE ON landlord_responses BEGIN
    SELECT RAISE(ABORT, 'landlord_responses is append-only');
  END;
  CREATE TRIGGER landlord_response_defects_no_update
  BEFORE UPDATE ON landlord_response_defects BEGIN
    SELECT RAISE(ABORT, 'landlord_response_defects is append-only');
  END;
  CREATE TRIGGER landlord_response_defects_no_delete
  BEFORE DELETE ON landlord_response_defects BEGIN
    SELECT RAISE(ABORT, 'landlord_response_defects is append-only');
  END;
  CREATE TRIGGER expert_conflict_checks_no_update
  BEFORE UPDATE ON expert_conflict_checks BEGIN
    SELECT RAISE(ABORT, 'expert_conflict_checks is append-only');
  END;
  CREATE TRIGGER expert_conflict_checks_no_delete
  BEFORE DELETE ON expert_conflict_checks BEGIN
    SELECT RAISE(ABORT, 'expert_conflict_checks is append-only');
  END;
  CREATE TRIGGER expert_instruction_versions_no_update
  BEFORE UPDATE ON expert_instruction_versions BEGIN
    SELECT RAISE(ABORT, 'expert_instruction_versions is immutable');
  END;
  CREATE TRIGGER expert_instruction_versions_no_delete
  BEFORE DELETE ON expert_instruction_versions BEGIN
    SELECT RAISE(ABORT, 'expert_instruction_versions is immutable');
  END;
  CREATE TRIGGER expert_milestone_events_no_update
  BEFORE UPDATE ON expert_milestone_events BEGIN
    SELECT RAISE(ABORT, 'expert_milestone_events is append-only');
  END;
  CREATE TRIGGER expert_milestone_events_no_delete
  BEFORE DELETE ON expert_milestone_events BEGIN
    SELECT RAISE(ABORT, 'expert_milestone_events is append-only');
  END;
  CREATE TRIGGER expert_report_records_no_update
  BEFORE UPDATE ON expert_report_records BEGIN
    SELECT RAISE(ABORT, 'expert_report_records is immutable');
  END;
  CREATE TRIGGER expert_report_records_no_delete
  BEFORE DELETE ON expert_report_records BEGIN
    SELECT RAISE(ABORT, 'expert_report_records is immutable');
  END;
  CREATE TRIGGER expert_questions_no_update
  BEFORE UPDATE ON expert_questions BEGIN
    SELECT RAISE(ABORT, 'expert_questions is append-only');
  END;
  CREATE TRIGGER expert_questions_no_delete
  BEFORE DELETE ON expert_questions BEGIN
    SELECT RAISE(ABORT, 'expert_questions is append-only');
  END;
  CREATE TRIGGER expert_question_answers_no_update
  BEFORE UPDATE ON expert_question_answers BEGIN
    SELECT RAISE(ABORT, 'expert_question_answers is append-only');
  END;
  CREATE TRIGGER expert_question_answers_no_delete
  BEFORE DELETE ON expert_question_answers BEGIN
    SELECT RAISE(ABORT, 'expert_question_answers is append-only');
  END;
`;

export const protocolExpertsMigration = defineMigration({
  version: 5,
  name: 'protocol and experts',
  sql: protocolExpertsSql,
});
