import { defineMigration } from './types.js';

const enquiryStatuses = String.raw`'new','assessment','accepted','declined',
    'referred','duplicate','unable_to_contact','converted'`;

const intakeOnboardingSql = String.raw`
  CREATE TABLE contacts (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    given_name TEXT NOT NULL,
    family_name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    date_of_birth TEXT,
    email TEXT,
    phone TEXT,
    preferred_channel TEXT NOT NULL DEFAULT 'email'
      CHECK (preferred_channel IN ('email', 'phone', 'sms', 'post')),
    safe_contact_instructions TEXT NOT NULL DEFAULT '',
    accessibility_needs TEXT NOT NULL DEFAULT '',
    interpreter_language TEXT,
    normalized_name TEXT NOT NULL,
    normalized_email TEXT,
    normalized_phone TEXT,
    external_source TEXT,
    external_id TEXT,
    import_batch_id TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE TABLE organisations (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('landlord', 'referrer', 'solicitor', 'other')),
    email TEXT,
    phone TEXT,
    address TEXT NOT NULL DEFAULT '',
    normalized_name TEXT NOT NULL,
    external_source TEXT,
    external_id TEXT,
    import_batch_id TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE TABLE properties (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    address_line_1 TEXT NOT NULL,
    address_line_2 TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL,
    county TEXT NOT NULL DEFAULT '',
    postcode TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'England',
    uprn TEXT,
    property_type TEXT NOT NULL DEFAULT 'unknown'
      CHECK (property_type IN ('house', 'flat', 'maisonette', 'bungalow', 'other', 'unknown')),
    normalized_address TEXT NOT NULL,
    external_source TEXT,
    external_id TEXT,
    import_batch_id TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE TABLE reference_sequences (
    firm_id TEXT NOT NULL,
    resource_key TEXT NOT NULL,
    next_value INTEGER NOT NULL CHECK (next_value > 0),
    PRIMARY KEY (firm_id, resource_key),
    FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE enquiries (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    reference TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (${enquiryStatuses})),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    source TEXT NOT NULL,
    referrer_name TEXT NOT NULL DEFAULT '',
    prospective_contact_id TEXT NOT NULL,
    property_id TEXT NOT NULL,
    landlord_organisation_id TEXT,
    assigned_user_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    defect_summary TEXT NOT NULL,
    desired_outcome TEXT NOT NULL DEFAULT '',
    first_complained_on TEXT,
    currently_occupied INTEGER NOT NULL CHECK (currently_occupied IN (0, 1)),
    urgency TEXT NOT NULL CHECK (urgency IN ('routine', 'priority', 'urgent', 'critical')),
    immediate_safety_concerns TEXT NOT NULL DEFAULT '',
    communication_requirements TEXT NOT NULL DEFAULT '',
    decision_reason TEXT NOT NULL DEFAULT '',
    external_source TEXT,
    external_id TEXT,
    import_batch_id TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE RESTRICT,
    FOREIGN KEY (prospective_contact_id, firm_id)
      REFERENCES contacts(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (property_id, firm_id)
      REFERENCES properties(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (landlord_organisation_id, firm_id)
      REFERENCES organisations(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (assigned_user_id, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id),
    UNIQUE (firm_id, reference)
  ) STRICT;

  CREATE TABLE enquiry_status_events (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    enquiry_id TEXT NOT NULL,
    from_status TEXT CHECK (from_status IS NULL OR from_status IN (${enquiryStatuses})),
    to_status TEXT NOT NULL CHECK (to_status IN (${enquiryStatuses})),
    reason TEXT NOT NULL,
    actor_user_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    FOREIGN KEY (enquiry_id, firm_id)
      REFERENCES enquiries(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (actor_user_id, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE TABLE conflict_checks (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    enquiry_id TEXT NOT NULL,
    query_json TEXT NOT NULL CHECK (json_valid(query_json)),
    results_json TEXT NOT NULL CHECK (json_valid(results_json)),
    match_count INTEGER NOT NULL CHECK (match_count >= 0),
    run_by TEXT NOT NULL,
    run_at TEXT NOT NULL,
    FOREIGN KEY (enquiry_id, firm_id)
      REFERENCES enquiries(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (run_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE TABLE conflict_decisions (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    enquiry_id TEXT NOT NULL,
    conflict_check_id TEXT NOT NULL,
    decision TEXT NOT NULL
      CHECK (decision IN ('clear', 'blocked', 'cleared_with_override')),
    reason TEXT NOT NULL,
    decided_by TEXT NOT NULL,
    decided_at TEXT NOT NULL,
    FOREIGN KEY (enquiry_id, firm_id)
      REFERENCES enquiries(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (conflict_check_id, firm_id)
      REFERENCES conflict_checks(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (decided_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE TABLE housing_assessments (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    enquiry_id TEXT NOT NULL,
    matter_id TEXT,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    jurisdiction_confirmed INTEGER NOT NULL DEFAULT 0
      CHECK (jurisdiction_confirmed IN (0, 1)),
    claimant_relationship TEXT NOT NULL DEFAULT 'other'
      CHECK (claimant_relationship IN ('tenant', 'former_tenant', 'leaseholder', 'other')),
    notice_summary TEXT NOT NULL DEFAULT '',
    conditions_unresolved INTEGER NOT NULL DEFAULT 0
      CHECK (conditions_unresolved IN (0, 1)),
    condition_start_date TEXT,
    access_summary TEXT NOT NULL DEFAULT '',
    evidence_summary TEXT NOT NULL DEFAULT '',
    limitation_review TEXT NOT NULL DEFAULT '',
    legal_issues_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(legal_issues_json)),
    escalations_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(escalations_json)),
    merits_rating TEXT NOT NULL DEFAULT 'borderline'
      CHECK (merits_rating IN ('weak', 'borderline', 'reasonable', 'strong')),
    proportionality_rating TEXT NOT NULL DEFAULT 'borderline'
      CHECK (proportionality_rating IN ('poor', 'borderline', 'reasonable', 'strong')),
    decision TEXT NOT NULL DEFAULT 'draft'
      CHECK (decision IN ('draft', 'proceed', 'decline', 'refer')),
    decision_reason TEXT NOT NULL DEFAULT '',
    reviewed_by TEXT,
    reviewed_at TEXT,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (enquiry_id, firm_id)
      REFERENCES enquiries(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (reviewed_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (updated_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id),
    UNIQUE (firm_id, enquiry_id),
    UNIQUE (firm_id, matter_id)
  ) STRICT;

  CREATE TABLE onboarding_profiles (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    enquiry_id TEXT NOT NULL,
    matter_id TEXT,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    identity_status TEXT NOT NULL DEFAULT 'not_started'
      CHECK (identity_status IN ('not_started', 'pending', 'complete', 'failed')),
    client_care_status TEXT NOT NULL DEFAULT 'not_started'
      CHECK (client_care_status IN ('not_started', 'pending', 'complete')),
    authority_status TEXT NOT NULL DEFAULT 'not_started'
      CHECK (authority_status IN ('not_started', 'pending', 'complete')),
    privacy_status TEXT NOT NULL DEFAULT 'not_started'
      CHECK (privacy_status IN ('not_started', 'pending', 'complete')),
    funding_type TEXT NOT NULL DEFAULT 'unconfirmed'
      CHECK (funding_type IN ('unconfirmed', 'cfa', 'legal_aid', 'private',
        'before_event', 'trade_union', 'other')),
    funding_status TEXT NOT NULL DEFAULT 'not_started'
      CHECK (funding_status IN ('not_started', 'pending', 'complete')),
    signature_status TEXT NOT NULL DEFAULT 'not_started'
      CHECK (signature_status IN ('not_started', 'sent', 'complete')),
    vulnerability_summary TEXT NOT NULL DEFAULT '',
    accessibility_needs TEXT NOT NULL DEFAULT '',
    interpreter_language TEXT,
    safe_contact_instructions TEXT NOT NULL DEFAULT '',
    owner_user_id TEXT,
    supervisor_user_id TEXT,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (enquiry_id, firm_id)
      REFERENCES enquiries(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (owner_user_id, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (supervisor_user_id, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (updated_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id),
    UNIQUE (firm_id, enquiry_id),
    UNIQUE (firm_id, matter_id)
  ) STRICT;

  CREATE TABLE household_members (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    enquiry_id TEXT NOT NULL,
    matter_id TEXT,
    contact_id TEXT,
    display_name TEXT NOT NULL,
    relationship TEXT NOT NULL,
    currently_occupies INTEGER NOT NULL CHECK (currently_occupies IN (0, 1)),
    claim_participant INTEGER NOT NULL CHECK (claim_participant IN (0, 1)),
    vulnerability_summary TEXT NOT NULL DEFAULT '',
    accessibility_needs TEXT NOT NULL DEFAULT '',
    external_source TEXT,
    external_id TEXT,
    import_batch_id TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (enquiry_id, firm_id)
      REFERENCES enquiries(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (contact_id, firm_id)
      REFERENCES contacts(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE TABLE tenancies (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    enquiry_id TEXT NOT NULL,
    matter_id TEXT,
    property_id TEXT NOT NULL,
    landlord_organisation_id TEXT NOT NULL,
    tenancy_type TEXT NOT NULL
      CHECK (tenancy_type IN ('secure', 'assured', 'assured_shorthold',
        'introductory', 'flexible', 'leasehold', 'licence', 'other', 'unknown')),
    started_on TEXT,
    ended_on TEXT,
    rent_minor INTEGER NOT NULL DEFAULT 0 CHECK (rent_minor >= 0),
    currency TEXT NOT NULL DEFAULT 'GBP' CHECK (length(currency) = 3),
    rent_frequency TEXT NOT NULL DEFAULT 'monthly'
      CHECK (rent_frequency IN ('weekly', 'fortnightly', 'monthly', 'quarterly', 'annual', 'other')),
    occupancy_started_on TEXT,
    occupancy_ended_on TEXT,
    external_source TEXT,
    external_id TEXT,
    import_batch_id TEXT,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (enquiry_id, firm_id)
      REFERENCES enquiries(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (property_id, firm_id)
      REFERENCES properties(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (landlord_organisation_id, firm_id)
      REFERENCES organisations(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (updated_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id),
    UNIQUE (firm_id, enquiry_id),
    UNIQUE (firm_id, matter_id)
  ) STRICT;

  CREATE TABLE matter_participants (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    contact_id TEXT,
    organisation_id TEXT,
    role TEXT NOT NULL
      CHECK (role IN ('claimant', 'household_member', 'landlord', 'referrer', 'other')),
    is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
    external_source TEXT,
    external_id TEXT,
    import_batch_id TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK ((contact_id IS NOT NULL AND organisation_id IS NULL)
      OR (contact_id IS NULL AND organisation_id IS NOT NULL)),
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (contact_id, firm_id)
      REFERENCES contacts(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (organisation_id, firm_id)
      REFERENCES organisations(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE TABLE housing_cases (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    source_enquiry_id TEXT NOT NULL,
    claimant_contact_id TEXT NOT NULL,
    property_id TEXT NOT NULL,
    tenancy_id TEXT NOT NULL,
    landlord_organisation_id TEXT NOT NULL,
    currently_occupied INTEGER NOT NULL CHECK (currently_occupied IN (0, 1)),
    external_source TEXT,
    external_id TEXT,
    import_batch_id TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (source_enquiry_id, firm_id)
      REFERENCES enquiries(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (claimant_contact_id, firm_id)
      REFERENCES contacts(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (property_id, firm_id)
      REFERENCES properties(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (tenancy_id, firm_id)
      REFERENCES tenancies(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (landlord_organisation_id, firm_id)
      REFERENCES organisations(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id),
    UNIQUE (firm_id, matter_id),
    UNIQUE (firm_id, source_enquiry_id)
  ) STRICT;

  CREATE TABLE intake_conversions (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    enquiry_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    converted_by TEXT NOT NULL,
    converted_at TEXT NOT NULL,
    FOREIGN KEY (enquiry_id, firm_id)
      REFERENCES enquiries(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (matter_id, firm_id)
      REFERENCES matters(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (converted_by, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id),
    UNIQUE (firm_id, enquiry_id),
    UNIQUE (firm_id, matter_id),
    UNIQUE (firm_id, idempotency_key)
  ) STRICT;

  CREATE TABLE intake_audit_events (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    enquiry_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
    after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
    request_id TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (enquiry_id, firm_id)
      REFERENCES enquiries(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, firm_id)
      REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE INDEX idx_contacts_dedupe
    ON contacts(firm_id, normalized_name, normalized_email, normalized_phone);
  CREATE INDEX idx_organisations_dedupe
    ON organisations(firm_id, normalized_name);
  CREATE INDEX idx_properties_dedupe
    ON properties(firm_id, normalized_address);
  CREATE INDEX idx_enquiries_queue
    ON enquiries(firm_id, status, assigned_user_id, updated_at DESC);
  CREATE INDEX idx_conflict_checks_enquiry
    ON conflict_checks(firm_id, enquiry_id, run_at DESC);
  CREATE INDEX idx_conflict_decisions_enquiry
    ON conflict_decisions(firm_id, enquiry_id, decided_at DESC);
  CREATE INDEX idx_household_enquiry
    ON household_members(firm_id, enquiry_id, created_at);
  CREATE INDEX idx_intake_audit_enquiry
    ON intake_audit_events(firm_id, enquiry_id, created_at DESC);
  CREATE INDEX idx_matter_participants_contact
    ON matter_participants(firm_id, contact_id, matter_id)
    WHERE contact_id IS NOT NULL;
  CREATE INDEX idx_matter_participants_organisation
    ON matter_participants(firm_id, organisation_id, matter_id)
    WHERE organisation_id IS NOT NULL;
  CREATE UNIQUE INDEX idx_matter_participant_contact_role
    ON matter_participants(firm_id, matter_id, role, contact_id)
    WHERE contact_id IS NOT NULL;
  CREATE UNIQUE INDEX idx_matter_participant_org_role
    ON matter_participants(firm_id, matter_id, role, organisation_id)
    WHERE organisation_id IS NOT NULL;

  CREATE TRIGGER enquiry_status_events_no_update
  BEFORE UPDATE ON enquiry_status_events BEGIN
    SELECT RAISE(ABORT, 'enquiry_status_events is append-only');
  END;
  CREATE TRIGGER enquiry_status_events_no_delete
  BEFORE DELETE ON enquiry_status_events BEGIN
    SELECT RAISE(ABORT, 'enquiry_status_events is append-only');
  END;
  CREATE TRIGGER conflict_checks_no_update
  BEFORE UPDATE ON conflict_checks BEGIN
    SELECT RAISE(ABORT, 'conflict_checks is append-only');
  END;
  CREATE TRIGGER conflict_checks_no_delete
  BEFORE DELETE ON conflict_checks BEGIN
    SELECT RAISE(ABORT, 'conflict_checks is append-only');
  END;
  CREATE TRIGGER conflict_decisions_no_update
  BEFORE UPDATE ON conflict_decisions BEGIN
    SELECT RAISE(ABORT, 'conflict_decisions is append-only');
  END;
  CREATE TRIGGER conflict_decisions_no_delete
  BEFORE DELETE ON conflict_decisions BEGIN
    SELECT RAISE(ABORT, 'conflict_decisions is append-only');
  END;
  CREATE TRIGGER intake_conversions_no_update
  BEFORE UPDATE ON intake_conversions BEGIN
    SELECT RAISE(ABORT, 'intake_conversions is append-only');
  END;
  CREATE TRIGGER intake_conversions_no_delete
  BEFORE DELETE ON intake_conversions BEGIN
    SELECT RAISE(ABORT, 'intake_conversions is append-only');
  END;
  CREATE TRIGGER intake_audit_events_no_update
  BEFORE UPDATE ON intake_audit_events BEGIN
    SELECT RAISE(ABORT, 'intake_audit_events is append-only');
  END;
  CREATE TRIGGER intake_audit_events_no_delete
  BEFORE DELETE ON intake_audit_events BEGIN
    SELECT RAISE(ABORT, 'intake_audit_events is append-only');
  END;
`;

export const intakeOnboardingMigration = defineMigration({
  version: 3,
  name: 'intake and onboarding',
  sql: intakeOnboardingSql,
});
