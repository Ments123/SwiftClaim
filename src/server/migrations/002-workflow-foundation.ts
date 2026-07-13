import { defineMigration } from './types.js';

const workflowFoundationSql = String.raw`
  CREATE TABLE business_calendars (
    id TEXT PRIMARY KEY,
    firm_id TEXT,
    name TEXT NOT NULL,
    timezone TEXT NOT NULL,
    weekend_days_json TEXT NOT NULL CHECK (json_valid(weekend_days_json)),
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    source_title TEXT NOT NULL,
    source_url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE,
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE TABLE business_calendar_holidays (
    calendar_id TEXT NOT NULL,
    date TEXT NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (calendar_id, date),
    FOREIGN KEY (calendar_id) REFERENCES business_calendars(id) ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE workflow_templates (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    jurisdiction TEXT NOT NULL,
    matter_type TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE workflow_versions (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
    definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
    created_at TEXT NOT NULL,
    FOREIGN KEY (template_id) REFERENCES workflow_templates(id) ON DELETE RESTRICT,
    UNIQUE (template_id, version)
  ) STRICT;

  CREATE TABLE workflow_stages (
    id TEXT PRIMARY KEY,
    workflow_version_id TEXT NOT NULL,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    description TEXT NOT NULL,
    required_checklist_json TEXT NOT NULL CHECK (json_valid(required_checklist_json)),
    FOREIGN KEY (workflow_version_id) REFERENCES workflow_versions(id) ON DELETE CASCADE,
    UNIQUE (workflow_version_id, key),
    UNIQUE (workflow_version_id, position)
  ) STRICT;

  CREATE TABLE deadline_rules (
    id TEXT PRIMARY KEY,
    workflow_version_id TEXT NOT NULL,
    key TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    name TEXT NOT NULL,
    trigger_event_type TEXT NOT NULL,
    offset INTEGER NOT NULL CHECK (offset >= 0),
    unit TEXT NOT NULL CHECK (unit IN ('calendar_days', 'working_days')),
    source_title TEXT NOT NULL,
    source_url TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
    FOREIGN KEY (workflow_version_id) REFERENCES workflow_versions(id) ON DELETE CASCADE,
    UNIQUE (workflow_version_id, key, version)
  ) STRICT;

  CREATE TABLE matter_workflows (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    workflow_version_id TEXT NOT NULL,
    current_stage_key TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_version_id) REFERENCES workflow_versions(id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id),
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE TABLE matter_stage_history (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    matter_workflow_id TEXT NOT NULL,
    from_stage_key TEXT,
    to_stage_key TEXT NOT NULL,
    reason TEXT NOT NULL,
    actor_user_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (matter_workflow_id, firm_id) REFERENCES matter_workflows(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (actor_user_id, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE TABLE matter_workflow_checklist (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    matter_workflow_id TEXT NOT NULL,
    checklist_key TEXT NOT NULL,
    completed_by TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (matter_workflow_id, firm_id) REFERENCES matter_workflows(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (completed_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, checklist_key),
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE TABLE domain_events (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    type TEXT NOT NULL,
    occurred_on TEXT NOT NULL,
    actor_user_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    created_at TEXT NOT NULL,
    FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (actor_user_id, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, matter_id, idempotency_key),
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE TABLE matter_deadlines (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    domain_event_id TEXT NOT NULL,
    deadline_rule_id TEXT NOT NULL,
    calendar_id TEXT NOT NULL,
    title TEXT NOT NULL,
    trigger_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    initial_status TEXT NOT NULL DEFAULT 'pending' CHECK (initial_status = 'pending'),
    explanation TEXT NOT NULL,
    calculation_json TEXT NOT NULL CHECK (json_valid(calculation_json)),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    supersedes_deadline_id TEXT,
    FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (domain_event_id, firm_id) REFERENCES domain_events(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (deadline_rule_id) REFERENCES deadline_rules(id) ON DELETE RESTRICT,
    FOREIGN KEY (calendar_id) REFERENCES business_calendars(id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (supersedes_deadline_id, firm_id) REFERENCES matter_deadlines(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (firm_id, domain_event_id, deadline_rule_id),
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE TABLE deadline_status_events (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    deadline_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'satisfied', 'superseded', 'cancelled')),
    reason TEXT NOT NULL,
    actor_user_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (deadline_id, firm_id) REFERENCES matter_deadlines(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (actor_user_id, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
    UNIQUE (id, firm_id)
  ) STRICT;

  CREATE TABLE workflow_generated_tasks (
    firm_id TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    deadline_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    PRIMARY KEY (firm_id, source_key),
    FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    FOREIGN KEY (deadline_id, firm_id) REFERENCES matter_deadlines(id, firm_id) ON DELETE RESTRICT,
    FOREIGN KEY (task_id, firm_id) REFERENCES tasks(id, firm_id) ON DELETE CASCADE,
    UNIQUE (firm_id, deadline_id),
    UNIQUE (firm_id, task_id)
  ) STRICT;

  CREATE TABLE integration_outbox (
    id TEXT PRIMARY KEY,
    firm_id TEXT NOT NULL,
    matter_id TEXT,
    topic TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    deduplication_key TEXT NOT NULL,
    FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE,
    FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE CASCADE,
    UNIQUE (firm_id, deduplication_key)
  ) STRICT;

  CREATE INDEX idx_business_calendars_effective
    ON business_calendars(firm_id, effective_from, effective_to);
  CREATE INDEX idx_workflow_versions_active
    ON workflow_versions(template_id, status, effective_from, effective_to);
  CREATE INDEX idx_deadline_rules_trigger
    ON deadline_rules(workflow_version_id, trigger_event_type, effective_from, effective_to);
  CREATE INDEX idx_matter_stage_history_matter
    ON matter_stage_history(firm_id, matter_id, occurred_at DESC);
  CREATE INDEX idx_domain_events_matter
    ON domain_events(firm_id, matter_id, occurred_on DESC);
  CREATE INDEX idx_matter_deadlines_due
    ON matter_deadlines(firm_id, matter_id, due_date);
  CREATE INDEX idx_deadline_status_latest
    ON deadline_status_events(firm_id, deadline_id, occurred_at DESC);
  CREATE INDEX idx_integration_outbox_pending
    ON integration_outbox(status, available_at, created_at);

  CREATE TRIGGER domain_events_no_update
  BEFORE UPDATE ON domain_events
  BEGIN
    SELECT RAISE(ABORT, 'domain_events is append-only');
  END;

  CREATE TRIGGER domain_events_no_delete
  BEFORE DELETE ON domain_events
  BEGIN
    SELECT RAISE(ABORT, 'domain_events is append-only');
  END;

  CREATE TRIGGER matter_deadlines_no_update
  BEFORE UPDATE ON matter_deadlines
  BEGIN
    SELECT RAISE(ABORT, 'matter_deadlines is immutable');
  END;

  CREATE TRIGGER matter_deadlines_no_delete
  BEFORE DELETE ON matter_deadlines
  BEGIN
    SELECT RAISE(ABORT, 'matter_deadlines is immutable');
  END;

  CREATE TRIGGER deadline_status_events_no_update
  BEFORE UPDATE ON deadline_status_events
  BEGIN
    SELECT RAISE(ABORT, 'deadline_status_events is append-only');
  END;

  CREATE TRIGGER deadline_status_events_no_delete
  BEFORE DELETE ON deadline_status_events
  BEGIN
    SELECT RAISE(ABORT, 'deadline_status_events is append-only');
  END;

  CREATE TRIGGER matter_stage_history_no_update
  BEFORE UPDATE ON matter_stage_history
  BEGIN
    SELECT RAISE(ABORT, 'matter_stage_history is append-only');
  END;

  CREATE TRIGGER matter_stage_history_no_delete
  BEFORE DELETE ON matter_stage_history
  BEGIN
    SELECT RAISE(ABORT, 'matter_stage_history is append-only');
  END;

  CREATE TRIGGER matter_workflow_checklist_no_update
  BEFORE UPDATE ON matter_workflow_checklist
  BEGIN
    SELECT RAISE(ABORT, 'matter_workflow_checklist is append-only');
  END;

  CREATE TRIGGER matter_workflow_checklist_no_delete
  BEFORE DELETE ON matter_workflow_checklist
  BEGIN
    SELECT RAISE(ABORT, 'matter_workflow_checklist is append-only');
  END;
`;

export const workflowFoundationMigration = defineMigration({
  version: 2,
  name: 'workflow foundation',
  sql: workflowFoundationSql,
});
