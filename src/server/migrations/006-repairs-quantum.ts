import { defineMigration } from './types.js';

const repairsQuantumSql = String.raw`
  CREATE TABLE work_schedules (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    schedule_version INTEGER NOT NULL CHECK (schedule_version > 0),
    record_version INTEGER NOT NULL DEFAULT 1 CHECK (record_version > 0),
    title TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN (
      'expert_report', 'agreed_schedule', 'landlord_response',
      'solicitor_review', 'other'
    )),
    source_document_id TEXT,
    source_document_version_id TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (
      status IN ('draft', 'approved', 'superseded')
    ),
    based_on_schedule_id TEXT,
    approval_note TEXT NOT NULL DEFAULT '',
    acknowledged_warnings_json TEXT NOT NULL DEFAULT '[]'
      CHECK (json_valid(acknowledged_warnings_json)
        AND json_type(acknowledged_warnings_json) = 'array'),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    approved_by TEXT,
    approved_at TEXT,
    CHECK (
      (status = 'draft' AND approved_by IS NULL AND approved_at IS NULL)
      OR (status IN ('approved', 'superseded')
        AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    ),
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (source_document_id, firm_id, matter_id)
      REFERENCES documents(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_document_version_id, firm_id, source_document_id)
      REFERENCES document_versions(id, firm_id, document_id) ON DELETE RESTRICT,
    FOREIGN KEY (based_on_schedule_id, firm_id, matter_id)
      REFERENCES work_schedules(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (updated_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (approved_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, schedule_version),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE work_items (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    schedule_id TEXT NOT NULL,
    lineage_key TEXT NOT NULL,
    area TEXT NOT NULL,
    description TEXT NOT NULL,
    responsibility_position TEXT NOT NULL CHECK (
      responsibility_position IN ('agreed', 'disputed', 'unknown')
    ),
    priority TEXT NOT NULL CHECK (priority IN ('urgent', 'high', 'routine')),
    target_start_on TEXT,
    target_completion_on TEXT,
    estimated_cost_minor INTEGER CHECK (
      estimated_cost_minor IS NULL OR estimated_cost_minor >= 0
    ),
    currency TEXT NOT NULL DEFAULT 'GBP' CHECK (currency = 'GBP'),
    contractor TEXT NOT NULL DEFAULT '',
    source_note TEXT NOT NULL,
    display_position INTEGER NOT NULL CHECK (display_position >= 0),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (schedule_id, firm_id, matter_id)
      REFERENCES work_schedules(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (schedule_id, lineage_key),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE work_item_defects (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    work_item_id TEXT NOT NULL,
    defect_id TEXT NOT NULL,
    linked_by TEXT NOT NULL,
    linked_at TEXT NOT NULL,
    FOREIGN KEY (work_item_id, firm_id, matter_id)
      REFERENCES work_items(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (defect_id, firm_id, matter_id)
      REFERENCES defects(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (linked_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (work_item_id, defect_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE work_item_evidence_links (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    work_item_id TEXT NOT NULL,
    evidence_item_id TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN (
      'source', 'access', 'progress', 'completion', 'verification',
      'invoice', 'other'
    )),
    linked_by TEXT NOT NULL,
    linked_at TEXT NOT NULL,
    FOREIGN KEY (work_item_id, firm_id, matter_id)
      REFERENCES work_items(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (evidence_item_id, firm_id, matter_id)
      REFERENCES evidence_items(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (linked_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (work_item_id, evidence_item_id, purpose),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE repair_events (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    work_item_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
      'proposed', 'appointment_booked', 'access_offered', 'access_provided',
      'access_refused', 'access_unavailable', 'started', 'paused',
      'completion_asserted', 'client_disputes_completion',
      'failed_inspection', 'verified_complete', 'superseded'
    )),
    occurred_at TEXT NOT NULL,
    actor_type TEXT NOT NULL CHECK (actor_type IN (
      'client', 'landlord', 'contractor', 'expert', 'solicitor', 'other'
    )),
    note TEXT NOT NULL,
    appointment_from TEXT,
    appointment_to TEXT,
    verifier TEXT NOT NULL DEFAULT '',
    supersedes_event_id TEXT,
    correction_reason TEXT NOT NULL DEFAULT '',
    idempotency_key TEXT NOT NULL,
    command_payload_json TEXT NOT NULL CHECK (json_valid(command_payload_json)),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (
      event_type <> 'superseded' OR supersedes_event_id IS NOT NULL
    ),
    CHECK (
      supersedes_event_id IS NULL OR length(correction_reason) >= 10
    ),
    FOREIGN KEY (work_item_id, firm_id, matter_id)
      REFERENCES work_items(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_event_id, firm_id, matter_id)
      REFERENCES repair_events(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE repair_event_evidence_links (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    repair_event_id TEXT NOT NULL,
    evidence_item_id TEXT NOT NULL,
    linked_by TEXT NOT NULL,
    linked_at TEXT NOT NULL,
    FOREIGN KEY (repair_event_id, firm_id, matter_id)
      REFERENCES repair_events(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (evidence_item_id, firm_id, matter_id)
      REFERENCES evidence_items(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (linked_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (repair_event_id, evidence_item_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE loss_schedules (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    schedule_version INTEGER NOT NULL CHECK (schedule_version > 0),
    record_version INTEGER NOT NULL DEFAULT 1 CHECK (record_version > 0),
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (
      status IN ('draft', 'approved', 'superseded')
    ),
    based_on_schedule_id TEXT,
    valuation_on TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (currency = 'GBP'),
    notes TEXT NOT NULL DEFAULT '',
    approval_note TEXT NOT NULL DEFAULT '',
    acknowledged_gaps_json TEXT NOT NULL DEFAULT '[]'
      CHECK (json_valid(acknowledged_gaps_json)
        AND json_type(acknowledged_gaps_json) = 'array'),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    approved_by TEXT,
    approved_at TEXT,
    CHECK (
      (status = 'draft' AND approved_by IS NULL AND approved_at IS NULL)
      OR (status IN ('approved', 'superseded')
        AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    ),
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (based_on_schedule_id, firm_id, matter_id)
      REFERENCES loss_schedules(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (updated_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (approved_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, schedule_version),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE loss_items (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    schedule_id TEXT NOT NULL,
    record_version INTEGER NOT NULL DEFAULT 1 CHECK (record_version > 0),
    lineage_key TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN (
      'damaged_belongings', 'additional_heating', 'cleaning',
      'temporary_accommodation', 'travel', 'medical_expense',
      'loss_of_earnings', 'other'
    )),
    description TEXT NOT NULL,
    period_start_on TEXT,
    period_end_on TEXT,
    calculation_type TEXT NOT NULL CHECK (calculation_type IN (
      'fixed', 'quantity_rate', 'period_rate', 'manual'
    )),
    quantity TEXT,
    unit_label TEXT NOT NULL DEFAULT '',
    rate_minor INTEGER CHECK (rate_minor IS NULL OR rate_minor >= 0),
    fixed_amount_minor INTEGER CHECK (
      fixed_amount_minor IS NULL OR fixed_amount_minor >= 0
    ),
    manual_amount_minor INTEGER CHECK (
      manual_amount_minor IS NULL OR manual_amount_minor >= 0
    ),
    manual_basis TEXT NOT NULL DEFAULT '',
    calculated_amount_minor INTEGER NOT NULL CHECK (calculated_amount_minor >= 0),
    currency TEXT NOT NULL CHECK (currency = 'GBP'),
    position TEXT NOT NULL CHECK (
      position IN ('claimed', 'accepted', 'disputed', 'withdrawn')
    ),
    evidence_status TEXT NOT NULL CHECK (
      evidence_status IN ('supported', 'partial', 'missing', 'not_applicable')
    ),
    source_note TEXT NOT NULL,
    display_position INTEGER NOT NULL CHECK (display_position >= 0),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (schedule_id, firm_id, matter_id)
      REFERENCES loss_schedules(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (updated_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (schedule_id, lineage_key),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE loss_item_evidence_links (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    loss_item_id TEXT NOT NULL,
    evidence_item_id TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'support' CHECK (
      purpose IN ('support', 'calculation', 'provenance', 'other')
    ),
    linked_by TEXT NOT NULL,
    linked_at TEXT NOT NULL,
    FOREIGN KEY (loss_item_id, firm_id, matter_id)
      REFERENCES loss_items(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (evidence_item_id, firm_id, matter_id)
      REFERENCES evidence_items(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (linked_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (loss_item_id, evidence_item_id, purpose),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE general_damages_reviews (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    valuation_on TEXT NOT NULL,
    low_minor INTEGER NOT NULL CHECK (low_minor >= 0),
    high_minor INTEGER NOT NULL CHECK (high_minor >= low_minor),
    preferred_minor INTEGER CHECK (
      preferred_minor IS NULL
      OR (preferred_minor >= low_minor AND preferred_minor <= high_minor)
    ),
    currency TEXT NOT NULL CHECK (currency = 'GBP'),
    basis TEXT NOT NULL,
    authorities_json TEXT NOT NULL CHECK (
      json_valid(authorities_json) AND json_type(authorities_json) = 'array'
    ),
    review_note TEXT NOT NULL,
    none_presently_advanced INTEGER NOT NULL DEFAULT 0 CHECK (
      none_presently_advanced IN (0, 1)
    ),
    supersedes_review_id TEXT,
    idempotency_key TEXT NOT NULL,
    command_payload_json TEXT NOT NULL CHECK (json_valid(command_payload_json)),
    reviewed_by TEXT NOT NULL,
    reviewed_at TEXT NOT NULL,
    CHECK (
      none_presently_advanced = 0
      OR (low_minor = 0 AND high_minor = 0 AND preferred_minor IS NULL)
    ),
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (supersedes_review_id, firm_id, matter_id)
      REFERENCES general_damages_reviews(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (reviewed_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE general_damages_evidence_links (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    review_id TEXT NOT NULL,
    evidence_item_id TEXT NOT NULL,
    linked_by TEXT NOT NULL,
    linked_at TEXT NOT NULL,
    FOREIGN KEY (review_id, firm_id, matter_id)
      REFERENCES general_damages_reviews(id, firm_id, matter_id)
      ON DELETE RESTRICT,
    FOREIGN KEY (evidence_item_id, firm_id, matter_id)
      REFERENCES evidence_items(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (linked_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (review_id, evidence_item_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE offers (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    offer_reference TEXT NOT NULL,
    record_version INTEGER NOT NULL DEFAULT 1 CHECK (record_version > 0),
    direction TEXT NOT NULL CHECK (direction IN ('claimant', 'defendant')),
    offer_type TEXT NOT NULL CHECK (offer_type IN (
      'part_36', 'wpsatc', 'open', 'protocol_compensation',
      'costs_only', 'global'
    )),
    confidentiality TEXT NOT NULL CHECK (confidentiality IN (
      'open', 'protected_costs', 'protected_negotiation'
    )),
    scope TEXT NOT NULL CHECK (scope IN (
      'whole_claim', 'part_of_claim', 'issue'
    )),
    scope_description TEXT NOT NULL,
    damages_minor INTEGER CHECK (damages_minor IS NULL OR damages_minor >= 0),
    costs_minor INTEGER CHECK (costs_minor IS NULL OR costs_minor >= 0),
    total_minor INTEGER CHECK (total_minor IS NULL OR total_minor >= 0),
    currency TEXT NOT NULL CHECK (currency = 'GBP'),
    works_terms TEXT NOT NULL DEFAULT '',
    non_money_terms TEXT NOT NULL DEFAULT '',
    interest_treatment TEXT NOT NULL DEFAULT '',
    written_document_id TEXT,
    written_document_version_id TEXT,
    made_on TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    command_payload_json TEXT NOT NULL CHECK (json_valid(command_payload_json)),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      offer_type NOT IN ('part_36', 'wpsatc')
      OR confidentiality = 'protected_costs'
    ),
    CHECK (
      offer_type <> 'part_36' OR written_document_version_id IS NOT NULL
    ),
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (written_document_id, firm_id, matter_id)
      REFERENCES documents(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (written_document_version_id, firm_id, written_document_id)
      REFERENCES document_versions(id, firm_id, document_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (updated_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, offer_reference),
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE part_36_terms (
    offer_id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    record_version INTEGER NOT NULL DEFAULT 1 CHECK (record_version > 0),
    relevant_period_days INTEGER NOT NULL CHECK (relevant_period_days >= 21),
    relevant_period_basis TEXT NOT NULL,
    service_on TEXT,
    service_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (
      service_confirmed IN (0, 1)
    ),
    projected_period_end_on TEXT,
    calculation_explanation TEXT NOT NULL DEFAULT '',
    includes_counterclaim INTEGER NOT NULL CHECK (includes_counterclaim IN (0, 1)),
    payment_period_days INTEGER NOT NULL CHECK (payment_period_days > 0),
    validation_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (
      validation_status IN ('unreviewed', 'reviewed', 'not_valid')
    ),
    validation_note TEXT NOT NULL DEFAULT '',
    reviewed_by TEXT,
    reviewed_at TEXT,
    FOREIGN KEY (offer_id, firm_id, matter_id)
      REFERENCES offers(id, firm_id, matter_id) ON DELETE CASCADE,
    FOREIGN KEY (reviewed_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (offer_id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE offer_events (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    offer_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
      'made', 'served', 'clarified', 'improved', 'withdrawn', 'accepted',
      'rejected', 'not_accepted', 'superseded'
    )),
    occurred_at TEXT NOT NULL,
    note TEXT NOT NULL,
    source_document_id TEXT,
    source_document_version_id TEXT,
    supersedes_event_id TEXT,
    correction_reason TEXT NOT NULL DEFAULT '',
    explicit_confirmation INTEGER NOT NULL DEFAULT 0 CHECK (
      explicit_confirmation IN (0, 1)
    ),
    idempotency_key TEXT NOT NULL,
    command_payload_json TEXT NOT NULL CHECK (json_valid(command_payload_json)),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (
      event_type NOT IN ('accepted', 'withdrawn') OR explicit_confirmation = 1
    ),
    CHECK (
      supersedes_event_id IS NULL OR length(correction_reason) >= 10
    ),
    FOREIGN KEY (offer_id, firm_id, matter_id)
      REFERENCES offers(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_document_id, firm_id, matter_id)
      REFERENCES documents(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_document_version_id, firm_id, source_document_id)
      REFERENCES document_versions(id, firm_id, document_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_event_id, firm_id, matter_id)
      REFERENCES offer_events(id, firm_id, matter_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE TABLE quantum_command_receipts (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    command_type TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
    result_type TEXT NOT NULL,
    result_id TEXT NOT NULL,
    result_json TEXT NOT NULL CHECK (json_valid(result_json)),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, command_type, idempotency_key),
    UNIQUE (id, firm_id, matter_id)
  ) STRICT;

  CREATE INDEX idx_work_schedules_current
    ON work_schedules(firm_id, matter_id, status, schedule_version DESC);
  CREATE INDEX idx_work_items_schedule
    ON work_items(firm_id, matter_id, schedule_id, display_position);
  CREATE INDEX idx_repair_events_history
    ON repair_events(firm_id, matter_id, work_item_id, occurred_at, created_at);
  CREATE INDEX idx_loss_schedules_current
    ON loss_schedules(firm_id, matter_id, status, schedule_version DESC);
  CREATE INDEX idx_loss_items_schedule
    ON loss_items(firm_id, matter_id, schedule_id, display_position);
  CREATE INDEX idx_general_damages_current
    ON general_damages_reviews(firm_id, matter_id, reviewed_at DESC);
  CREATE INDEX idx_offers_open
    ON offers(firm_id, matter_id, confidentiality, made_on DESC);
  CREATE INDEX idx_offer_events_history
    ON offer_events(firm_id, matter_id, offer_id, occurred_at, created_at);

  CREATE TRIGGER work_schedules_approved_no_update
  BEFORE UPDATE ON work_schedules
  WHEN OLD.status IN ('approved', 'superseded') BEGIN
    SELECT RAISE(ABORT, 'approved work schedules are immutable');
  END;
  CREATE TRIGGER work_schedules_approved_no_delete
  BEFORE DELETE ON work_schedules
  WHEN OLD.status IN ('approved', 'superseded') BEGIN
    SELECT RAISE(ABORT, 'approved work schedules are immutable');
  END;
  CREATE TRIGGER work_items_approved_no_update
  BEFORE UPDATE ON work_items
  WHEN EXISTS (
    SELECT 1 FROM work_schedules s
    WHERE s.id = OLD.schedule_id AND s.status <> 'draft'
  ) BEGIN
    SELECT RAISE(ABORT, 'approved work items are immutable');
  END;
  CREATE TRIGGER work_items_approved_no_delete
  BEFORE DELETE ON work_items
  WHEN EXISTS (
    SELECT 1 FROM work_schedules s
    WHERE s.id = OLD.schedule_id AND s.status <> 'draft'
  ) BEGIN
    SELECT RAISE(ABORT, 'approved work items are immutable');
  END;
  CREATE TRIGGER work_item_defects_no_update
  BEFORE UPDATE ON work_item_defects BEGIN
    SELECT RAISE(ABORT, 'work item defect links are immutable');
  END;
  CREATE TRIGGER work_item_evidence_links_no_update
  BEFORE UPDATE ON work_item_evidence_links BEGIN
    SELECT RAISE(ABORT, 'work item evidence links are immutable');
  END;
  CREATE TRIGGER work_item_evidence_links_no_delete
  BEFORE DELETE ON work_item_evidence_links BEGIN
    SELECT RAISE(ABORT, 'work item evidence links are immutable');
  END;
  CREATE TRIGGER repair_events_no_update
  BEFORE UPDATE ON repair_events BEGIN
    SELECT RAISE(ABORT, 'repair events are append-only');
  END;
  CREATE TRIGGER repair_events_no_delete
  BEFORE DELETE ON repair_events BEGIN
    SELECT RAISE(ABORT, 'repair events are append-only');
  END;
  CREATE TRIGGER repair_event_evidence_links_no_update
  BEFORE UPDATE ON repair_event_evidence_links BEGIN
    SELECT RAISE(ABORT, 'repair event evidence links are immutable');
  END;
  CREATE TRIGGER repair_event_evidence_links_no_delete
  BEFORE DELETE ON repair_event_evidence_links BEGIN
    SELECT RAISE(ABORT, 'repair event evidence links are immutable');
  END;
  CREATE TRIGGER loss_schedules_approved_no_update
  BEFORE UPDATE ON loss_schedules
  WHEN OLD.status IN ('approved', 'superseded') BEGIN
    SELECT RAISE(ABORT, 'approved loss schedules are immutable');
  END;
  CREATE TRIGGER loss_schedules_approved_no_delete
  BEFORE DELETE ON loss_schedules
  WHEN OLD.status IN ('approved', 'superseded') BEGIN
    SELECT RAISE(ABORT, 'approved loss schedules are immutable');
  END;
  CREATE TRIGGER loss_items_approved_no_update
  BEFORE UPDATE ON loss_items
  WHEN EXISTS (
    SELECT 1 FROM loss_schedules s
    WHERE s.id = OLD.schedule_id AND s.status <> 'draft'
  ) BEGIN
    SELECT RAISE(ABORT, 'approved loss items are immutable');
  END;
  CREATE TRIGGER loss_items_approved_no_delete
  BEFORE DELETE ON loss_items
  WHEN EXISTS (
    SELECT 1 FROM loss_schedules s
    WHERE s.id = OLD.schedule_id AND s.status <> 'draft'
  ) BEGIN
    SELECT RAISE(ABORT, 'approved loss items are immutable');
  END;
  CREATE TRIGGER loss_item_evidence_links_no_update
  BEFORE UPDATE ON loss_item_evidence_links BEGIN
    SELECT RAISE(ABORT, 'loss evidence links are immutable');
  END;
  CREATE TRIGGER loss_item_evidence_links_no_delete
  BEFORE DELETE ON loss_item_evidence_links BEGIN
    SELECT RAISE(ABORT, 'loss evidence links are immutable');
  END;
  CREATE TRIGGER general_damages_reviews_no_update
  BEFORE UPDATE ON general_damages_reviews BEGIN
    SELECT RAISE(ABORT, 'general damages reviews are immutable');
  END;
  CREATE TRIGGER general_damages_reviews_no_delete
  BEFORE DELETE ON general_damages_reviews BEGIN
    SELECT RAISE(ABORT, 'general damages reviews are immutable');
  END;
  CREATE TRIGGER offer_events_no_update
  BEFORE UPDATE ON offer_events BEGIN
    SELECT RAISE(ABORT, 'offer events are append-only');
  END;
  CREATE TRIGGER offer_events_no_delete
  BEFORE DELETE ON offer_events BEGIN
    SELECT RAISE(ABORT, 'offer events are append-only');
  END;
  CREATE TRIGGER quantum_command_receipts_no_update
  BEFORE UPDATE ON quantum_command_receipts BEGIN
    SELECT RAISE(ABORT, 'quantum command receipts are immutable');
  END;
  CREATE TRIGGER quantum_command_receipts_no_delete
  BEFORE DELETE ON quantum_command_receipts BEGIN
    SELECT RAISE(ABORT, 'quantum command receipts are immutable');
  END;
`;

export const repairsQuantumMigration = defineMigration({
  version: 6,
  name: 'repairs quantum and offers',
  sql: repairsQuantumSql,
});
