# Matter 360 and Workflow Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first complete, visible foundation of the claimant Housing Disrepair CMS: ordered migrations, effective-dated workflows, explainable working-day deadlines, capability checks, stage transitions and a Matter 360 overview.

**Architecture:** Keep the existing modular monolith and add a focused workflow domain beside the tenant-scoped matter store. Persist versioned workflow definitions and immutable deadline calculations in SQLite, expose them through resource-specific Fastify routes, and render a dense operational Matter 360 interface without weakening existing security, timeline or audit guarantees.

**Tech Stack:** Node.js 24+, npm 11+, TypeScript 7, Fastify 5, Node SQLite, Zod 4, React 19, Vite 8, Vitest 4, Testing Library and Lucide React.

## Global Constraints

- The first configured workflow is claimant-side Housing Conditions Claims in England.
- Evaluation uses synthetic data only; no identifiable client data enters source control.
- Every tenant-owned query is scoped by the authenticated user's server-derived `firmId`.
- Inaccessible matters and child resources return `404` without existence disclosure.
- Audit, timeline, domain-event and deadline-calculation history is append-only.
- Legal deadlines are date-only records with trigger, rule version, calendar and explanation; generated tasks are operational reminders, not the authoritative legal record.
- The business timezone is `Europe/London`; working days exclude Saturday, Sunday and effective-dated configured holidays.
- A user confirms legal trigger dates. Software never decides liability, limitation or whether proceedings should be issued.
- Existing APIs continue to work while Matter 360 adopts resource-specific endpoints.
- Use test-driven development: observe each new test fail before implementing it.
- Commit each task only after its focused tests and the existing suite pass.

## Programme Position

This is delivery slice 1 of the approved nine-slice CMS programme. On completion, the next plan is intake/onboarding, followed by defects/evidence, protocol/experts, repairs/quantum/offers, proceedings, operational depth, time/finance/reporting and administration/hardening.

## File Map

### Create

- `src/server/migrations/types.ts` — migration contract and checksum helper.
- `src/server/schema.ts` — the existing Step 1 schema literal, moved without semantic changes.
- `src/server/migrations/001-secure-matter-spine.ts` — Step 1 schema baseline.
- `src/server/migrations/002-workflow-foundation.ts` — workflow, calendar, deadline, domain-event and outbox schema.
- `src/server/migrations/index.ts` — ordered transactional migration runner.
- `src/server/migrations.test.ts` — empty/upgrade/checksum migration tests.
- `src/server/workflow/calendar.ts` — date-only working-day calculations.
- `src/server/workflow/calendar.test.ts` — weekend, holiday and explanation tests.
- `src/server/workflow/types.ts` — domain and transport-neutral workflow types.
- `src/server/workflow/definitions.ts` — versioned Housing Disrepair workflow definition.
- `src/server/workflow/store.ts` — tenant-scoped workflow persistence.
- `src/server/workflow/store.test.ts` — instantiation, idempotency and isolation tests.
- `src/server/workflow/service.ts` — stage transition and deadline orchestration.
- `src/server/workflow/service.test.ts` — readiness, transition, deadline and audit tests.
- `src/server/workflow/routes.ts` — resource-specific workflow API plugin.
- `src/server/workflow/routes.test.ts` — authenticated route and non-disclosure tests.
- `src/server/policy.test.ts` — role capability behavior.
- `src/client/components/matter/MatterHeader.tsx` — persistent matter command header.
- `src/client/components/matter/MatterSectionRail.tsx` — section navigation.
- `src/client/components/matter/WorkflowCard.tsx` — stage progress and transition control.
- `src/client/components/matter/DeadlineCard.tsx` — deadline source/explanation display.
- `src/client/components/matter/OperationalOverview.tsx` — Matter 360 overview composition.
- `src/client/components/matter/OperationalOverview.test.tsx` — solicitor-facing interaction tests.

### Modify

- `src/server/database.ts` — delegate schema creation to ordered migrations and seed the workflow foundation.
- `src/server/database.test.ts` — assert workflow seed and append-only protections.
- `src/server/policy.ts` — introduce capability checks while preserving role behavior.
- `src/server/app.ts` — register workflow routes and expose scoped dependencies.
- `src/server/app.test.ts` — retain existing API regression coverage.
- `src/server/store.ts` — add a lightweight Matter 360 summary query without expanding the legacy aggregate.
- `src/shared/contracts.ts` — add workflow/deadline command schemas.
- `src/client/api.ts` — add Matter 360, workflow and deadline response types.
- `src/client/pages/MatterPage.tsx` — compose the new overview and retain existing sections.
- `src/client/styles.css` — add dense responsive Matter 360 styles.
- `src/client/App.test.tsx` — cover the enhanced matter route.
- `README.md` — document workflow behavior, legal-source posture and evaluation path.

---

### Task 1: Ordered Database Migrations

**Files:**
- Create: `src/server/migrations/types.ts`
- Create: `src/server/schema.ts`
- Create: `src/server/migrations/001-secure-matter-spine.ts`
- Create: `src/server/migrations/index.ts`
- Test: `src/server/migrations.test.ts`
- Modify: `src/server/database.ts`

**Interfaces:**
- Consumes: existing Step 1 schema string from `src/server/database.ts`.
- Produces: `Migration`, `defineMigration(input)`, `migrationChecksum(sql)`, `runMigrations(database, migrations, appliedAt)` and `migrations`.

- [ ] **Step 1: Write failing migration tests**

Create `src/server/migrations.test.ts` with these cases:

```ts
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { runMigrations } from './migrations/index.js';
import type { Migration } from './migrations/types.js';

function memoryDatabase() {
  return new DatabaseSync(':memory:');
}

describe('runMigrations', () => {
  it('applies migrations once in version order and records checksums', () => {
    const database = memoryDatabase();
    const migrations: Migration[] = [
      { version: 1, name: 'one', checksum: 'one-hash', sql: 'CREATE TABLE one (id TEXT);' },
      { version: 2, name: 'two', checksum: 'two-hash', sql: 'CREATE TABLE two (id TEXT);' },
    ];

    runMigrations(database, migrations, '2026-07-13T12:00:00.000Z');
    runMigrations(database, migrations, '2026-07-13T13:00:00.000Z');

    expect(database.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all())
      .toEqual([
        { version: 1, name: 'one', checksum: 'one-hash' },
        { version: 2, name: 'two', checksum: 'two-hash' },
      ]);
  });

  it('rolls back a failed migration without recording it', () => {
    const database = memoryDatabase();
    expect(() => runMigrations(database, [
      { version: 1, name: 'broken', checksum: 'broken-hash', sql: 'CREATE TABLE ok (id TEXT); INVALID SQL;' },
    ], '2026-07-13T12:00:00.000Z')).toThrow();

    const table = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ok'").get();
    expect(table).toBeUndefined();
  });

  it('rejects a checksum mismatch for an applied migration', () => {
    const database = memoryDatabase();
    runMigrations(database, [
      { version: 1, name: 'one', checksum: 'original', sql: 'CREATE TABLE one (id TEXT);' },
    ], '2026-07-13T12:00:00.000Z');

    expect(() => runMigrations(database, [
      { version: 1, name: 'one', checksum: 'changed', sql: 'CREATE TABLE one (id TEXT);' },
    ], '2026-07-13T13:00:00.000Z')).toThrow('Migration 1 checksum mismatch');
  });
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `npm test -- src/server/migrations.test.ts`

Expected: FAIL because `./migrations/index.js` and `./migrations/types.js` do not exist.

- [ ] **Step 3: Implement migration contracts and runner**

Create `src/server/migrations/types.ts`:

```ts
import { createHash } from 'node:crypto';

export interface Migration {
  version: number;
  name: string;
  checksum: string;
  sql: string;
}

export function migrationChecksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export function defineMigration(input: Omit<Migration, 'checksum'>): Migration {
  return { ...input, checksum: migrationChecksum(input.sql) };
}
```

Create `src/server/migrations/index.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite';

import { secureMatterSpineMigration } from './001-secure-matter-spine.js';
import type { Migration } from './types.js';

export const migrations: Migration[] = [secureMatterSpineMigration];

export function runMigrations(
  database: DatabaseSync,
  orderedMigrations: Migration[],
  appliedAt = new Date().toISOString(),
): void {
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT,
    checksum TEXT,
    applied_at TEXT NOT NULL
  ) STRICT;`);

  const columns = new Set(
    (database.prepare('PRAGMA table_info(schema_migrations)').all() as Array<{ name: string }>)
      .map((column) => column.name),
  );
  if (!columns.has('name')) database.exec('ALTER TABLE schema_migrations ADD COLUMN name TEXT;');
  if (!columns.has('checksum')) database.exec('ALTER TABLE schema_migrations ADD COLUMN checksum TEXT;');

  const sorted = [...orderedMigrations].sort((a, b) => a.version - b.version);
  const versions = new Set<number>();
  for (const migration of sorted) {
    if (versions.has(migration.version)) throw new Error(`Duplicate migration ${migration.version}`);
    versions.add(migration.version);
    const applied = database.prepare(
      'SELECT name, checksum FROM schema_migrations WHERE version = ?',
    ).get(migration.version) as { name: string | null; checksum: string | null } | undefined;
    if (applied) {
      if (applied.checksum && applied.checksum !== migration.checksum) {
        throw new Error(`Migration ${migration.version} checksum mismatch`);
      }
      if (!applied.checksum) {
        database.prepare(
          'UPDATE schema_migrations SET name = ?, checksum = ? WHERE version = ?',
        ).run(migration.name, migration.checksum, migration.version);
      }
      continue;
    }
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(migration.sql);
      database.prepare(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
      ).run(migration.version, migration.name, migration.checksum, appliedAt);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}
```

Move the complete existing `const schema = String.raw\`...\`` declaration from `src/server/database.ts` into `src/server/schema.ts` without changing its SQL, rename it `secureMatterSpineSql`, and export it. Create `src/server/migrations/001-secure-matter-spine.ts` with this complete content:

```ts
import { secureMatterSpineSql } from '../schema.js';
import { defineMigration } from './types.js';

export const secureMatterSpineMigration = defineMigration({
  version: 1,
  name: 'secure matter spine',
  sql: secureMatterSpineSql,
});
```

Modify `createDatabase` to configure pragmas and call `runMigrations(database, migrations)`. Remove the direct `database.exec(schema)` call and the manual version insert.

- [ ] **Step 4: Run migration and regression tests**

Run: `npm test -- src/server/migrations.test.ts src/server/database.test.ts src/server/app.test.ts`

Expected: migration tests PASS and all existing database/API tests PASS.

- [ ] **Step 5: Run type checking**

Run: `npm run typecheck`

Expected: both TypeScript checks exit 0.

- [ ] **Step 6: Commit the migration foundation**

```bash
git add src/server/migrations src/server/migrations.test.ts src/server/database.ts
git commit -m "refactor: add ordered database migrations"
```

---

### Task 2: Working-Day Calendar and Explainable Deadline Calculator

**Files:**
- Create: `src/server/workflow/calendar.ts`
- Test: `src/server/workflow/calendar.test.ts`
- Create: `src/server/workflow/types.ts`

**Interfaces:**
- Produces: `BusinessCalendar`, `DeadlineRule`, `DeadlineCalculation`, `calculateDeadline(input)` and `isWorkingDay(date, calendar)`.
- Consumed by: workflow store/service and deadline API responses.

- [ ] **Step 1: Write failing calendar tests**

Create `src/server/workflow/calendar.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { calculateDeadline, isWorkingDay } from './calendar.js';
import type { BusinessCalendar, DeadlineRule } from './types.js';

const calendar: BusinessCalendar = {
  id: 'england-wales-2026',
  name: 'England and Wales 2026',
  timezone: 'Europe/London',
  weekendDays: [0, 6],
  holidays: ['2026-08-31', '2026-12-25', '2026-12-28'],
};

const rule: DeadlineRule = {
  id: 'protocol-response-v1',
  key: 'housing.protocol.landlord_response',
  version: 1,
  name: 'Landlord response to Letter of Claim',
  triggerEventType: 'letter_of_claim.received',
  offset: 20,
  unit: 'working_days',
  direction: 'after',
  sourceTitle: 'Pre-Action Protocol for Housing Conditions Claims (England), 6.2',
  sourceUrl: 'https://www.justice.gov.uk/courts/procedure-rules/civil/protocol/prot_hou',
  effectiveFrom: '2021-08-19',
  effectiveTo: null,
};

describe('working-day deadlines', () => {
  it('recognises weekends and configured holidays', () => {
    expect(isWorkingDay('2026-08-28', calendar)).toBe(true);
    expect(isWorkingDay('2026-08-29', calendar)).toBe(false);
    expect(isWorkingDay('2026-08-31', calendar)).toBe(false);
  });

  it('counts from the next day and skips weekends and holidays', () => {
    const result = calculateDeadline({
      triggerDate: '2026-08-03',
      triggerEventId: 'event-1',
      rule,
      calendar,
    });
    expect(result.dueDate).toBe('2026-09-01');
    expect(result.explanation).toContain('20 working days after 3 August 2026');
    expect(result.explanation).toContain('1 configured holiday');
  });

  it('does not mutate the source rule or calendar', () => {
    const frozenRule = Object.freeze({ ...rule });
    const frozenCalendar = Object.freeze({ ...calendar, holidays: Object.freeze([...calendar.holidays]) });
    expect(() => calculateDeadline({
      triggerDate: '2026-07-13', triggerEventId: 'event-2', rule: frozenRule, calendar: frozenCalendar,
    })).not.toThrow();
  });

  it('rejects an invalid date-only trigger', () => {
    expect(() => calculateDeadline({
      triggerDate: '13/07/2026', triggerEventId: 'event-3', rule, calendar,
    })).toThrow('triggerDate must be YYYY-MM-DD');
  });
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm test -- src/server/workflow/calendar.test.ts`

Expected: FAIL because calendar/types modules do not exist.

- [ ] **Step 3: Define workflow types**

Create `src/server/workflow/types.ts`:

```ts
export type DeadlineUnit = 'calendar_days' | 'working_days';

export interface BusinessCalendar {
  id: string;
  name: string;
  timezone: string;
  weekendDays: readonly number[];
  holidays: readonly string[];
}

export interface DeadlineRule {
  id: string;
  key: string;
  version: number;
  name: string;
  triggerEventType: string;
  offset: number;
  unit: DeadlineUnit;
  direction: 'after';
  sourceTitle: string;
  sourceUrl: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface DeadlineCalculation {
  triggerEventId: string;
  triggerDate: string;
  dueDate: string;
  rule: DeadlineRule;
  calendarId: string;
  explanation: string;
  excludedDates: string[];
}

export interface WorkflowStageDefinition {
  key: string;
  name: string;
  position: number;
  description: string;
  requiredChecklistKeys: readonly string[];
}

export interface WorkflowDefinition {
  key: string;
  version: number;
  name: string;
  jurisdiction: 'england';
  matterType: 'housing_conditions_claimant';
  effectiveFrom: string;
  stages: readonly WorkflowStageDefinition[];
  deadlineRules: readonly DeadlineRule[];
}
```

- [ ] **Step 4: Implement date-only calculation**

Create `src/server/workflow/calendar.ts` with UTC arithmetic used only for civil date values:

```ts
import type { BusinessCalendar, DeadlineCalculation, DeadlineRule } from './types.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(value: string, field: string): Date {
  if (!DATE_ONLY.test(value)) throw new Error(`${field} must be YYYY-MM-DD`);
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (formatDateOnly(date) !== value) throw new Error(`${field} is not a valid date`);
  return date;
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(parseDateOnly(value, 'date'));
}

export function isWorkingDay(value: string, calendar: BusinessCalendar): boolean {
  const date = parseDateOnly(value, 'date');
  return !calendar.weekendDays.includes(date.getUTCDay()) && !calendar.holidays.includes(value);
}

export function calculateDeadline(input: {
  triggerDate: string;
  triggerEventId: string;
  rule: DeadlineRule;
  calendar: BusinessCalendar;
}): DeadlineCalculation {
  const cursor = parseDateOnly(input.triggerDate, 'triggerDate');
  const excludedDates: string[] = [];
  let counted = 0;
  while (counted < input.rule.offset) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const value = formatDateOnly(cursor);
    if (input.rule.unit === 'working_days' && !isWorkingDay(value, input.calendar)) {
      excludedDates.push(value);
      continue;
    }
    counted += 1;
  }
  const dueDate = formatDateOnly(cursor);
  const holidayCount = excludedDates.filter((date) => input.calendar.holidays.includes(date)).length;
  return {
    triggerEventId: input.triggerEventId,
    triggerDate: input.triggerDate,
    dueDate,
    rule: input.rule,
    calendarId: input.calendar.id,
    excludedDates,
    explanation: `${input.rule.offset} ${input.rule.unit.replace('_', ' ')} after ${displayDate(input.triggerDate)} is ${displayDate(dueDate)}; weekends and ${holidayCount} configured holiday${holidayCount === 1 ? '' : 's'} excluded.`,
  };
}
```

- [ ] **Step 5: Run focused and full tests**

Run: `npm test -- src/server/workflow/calendar.test.ts`

Expected: 4 calendar tests PASS.

Run: `npm test`

Expected: all existing and new tests PASS.

- [ ] **Step 6: Commit the calculator**

```bash
git add src/server/workflow/calendar.ts src/server/workflow/calendar.test.ts src/server/workflow/types.ts
git commit -m "feat: add explainable working-day deadlines"
```

---

### Task 3: Workflow Persistence and Housing Disrepair Definition

**Files:**
- Create: `src/server/migrations/002-workflow-foundation.ts`
- Modify: `src/server/migrations/index.ts`
- Create: `src/server/workflow/definitions.ts`
- Create: `src/server/workflow/store.ts`
- Test: `src/server/workflow/store.test.ts`
- Modify: `src/server/database.ts`
- Modify: `src/server/database.test.ts`

**Interfaces:**
- Consumes: `WorkflowDefinition`, `BusinessCalendar`, migration runner and existing `SEED_IDS`.
- Produces: `HOUSING_DISREPAIR_WORKFLOW`, `seedWorkflowDefinitions(database)`, and `WorkflowStore` methods `instantiateMatterWorkflow`, `getMatterWorkflow`, `recordTriggerAndDeadline` and `listMatterDeadlines`.

- [ ] **Step 1: Write failing workflow-store tests**

Create `src/server/workflow/store.test.ts` using a temporary database and the fixed clock `2026-07-13T12:00:00.000Z`. Cover:

```ts
it('instantiates the first workflow stage once for a matter', () => {
  const first = store.instantiateMatterWorkflow(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter, userId);
  const second = store.instantiateMatterWorkflow(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter, userId);
  expect(second.id).toBe(first.id);
  expect(first.currentStage.key).toBe('enquiry');
  expect(database.prepare('SELECT COUNT(*) AS count FROM matter_workflows WHERE matter_id = ?').get(SEED_IDS.northstarMatter))
    .toEqual({ count: 1 });
});

it('cannot read another firm workflow through a tenant-scoped lookup', () => {
  store.instantiateMatterWorkflow(SEED_IDS.southbankFirm, SEED_IDS.southbankMatter, southbankUserId);
  expect(store.getMatterWorkflow(SEED_IDS.northstarFirm, SEED_IDS.southbankMatter)).toBeUndefined();
});

it('records one immutable deadline per trigger and rule', () => {
  const event = store.recordTriggerAndDeadline({
    firmId: SEED_IDS.northstarFirm,
    matterId: SEED_IDS.northstarMatter,
    actorUserId: userId,
    triggerEventType: 'letter_of_claim.received',
    triggerDate: '2026-08-03',
    idempotencyKey: 'loc-received-1',
  });
  const replay = store.recordTriggerAndDeadline({
    firmId: SEED_IDS.northstarFirm,
    matterId: SEED_IDS.northstarMatter,
    actorUserId: userId,
    triggerEventType: 'letter_of_claim.received',
    triggerDate: '2026-08-03',
    idempotencyKey: 'loc-received-1',
  });
  expect(replay.deadline.id).toBe(event.deadline.id);
  expect(event.deadline.dueDate).toBe('2026-09-01');
  expect(database.prepare('SELECT COUNT(*) AS count FROM workflow_generated_tasks WHERE deadline_id = ?').get(event.deadline.id))
    .toEqual({ count: 1 });
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm test -- src/server/workflow/store.test.ts`

Expected: FAIL because workflow migration, definition and store do not exist.

- [ ] **Step 3: Add workflow schema migration**

Create migration 002 with complete strict tables and indexes:

```sql
CREATE TABLE business_calendars (
  id TEXT PRIMARY KEY, firm_id TEXT, name TEXT NOT NULL, timezone TEXT NOT NULL,
  weekend_days_json TEXT NOT NULL, effective_from TEXT NOT NULL, effective_to TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE,
  UNIQUE (id, firm_id)
) STRICT;
CREATE TABLE business_calendar_holidays (
  calendar_id TEXT NOT NULL, date TEXT NOT NULL, name TEXT NOT NULL,
  PRIMARY KEY (calendar_id, date), FOREIGN KEY (calendar_id) REFERENCES business_calendars(id) ON DELETE CASCADE
) STRICT;
CREATE TABLE workflow_templates (
  id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  jurisdiction TEXT NOT NULL, matter_type TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE workflow_versions (
  id TEXT PRIMARY KEY, template_id TEXT NOT NULL, version INTEGER NOT NULL,
  effective_from TEXT NOT NULL, effective_to TEXT, status TEXT NOT NULL CHECK (status IN ('draft','active','retired')),
  definition_json TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY (template_id) REFERENCES workflow_templates(id) ON DELETE RESTRICT,
  UNIQUE (template_id, version)
) STRICT;
CREATE TABLE workflow_stages (
  id TEXT PRIMARY KEY, workflow_version_id TEXT NOT NULL, key TEXT NOT NULL,
  name TEXT NOT NULL, position INTEGER NOT NULL, description TEXT NOT NULL,
  required_checklist_json TEXT NOT NULL,
  FOREIGN KEY (workflow_version_id) REFERENCES workflow_versions(id) ON DELETE CASCADE,
  UNIQUE (workflow_version_id, key), UNIQUE (workflow_version_id, position)
) STRICT;
CREATE TABLE deadline_rules (
  id TEXT PRIMARY KEY, workflow_version_id TEXT NOT NULL, key TEXT NOT NULL,
  version INTEGER NOT NULL, name TEXT NOT NULL, trigger_event_type TEXT NOT NULL,
  offset INTEGER NOT NULL, unit TEXT NOT NULL CHECK (unit IN ('calendar_days','working_days')),
  source_title TEXT NOT NULL, source_url TEXT NOT NULL, effective_from TEXT NOT NULL,
  effective_to TEXT, definition_json TEXT NOT NULL,
  FOREIGN KEY (workflow_version_id) REFERENCES workflow_versions(id) ON DELETE CASCADE,
  UNIQUE (workflow_version_id, key, version)
) STRICT;
CREATE TABLE matter_workflows (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL,
  workflow_version_id TEXT NOT NULL, current_stage_key TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  started_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_version_id) REFERENCES workflow_versions(id) ON DELETE RESTRICT,
  UNIQUE (firm_id, matter_id), UNIQUE (id, firm_id)
) STRICT;
CREATE TABLE matter_stage_history (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL,
  matter_workflow_id TEXT NOT NULL, from_stage_key TEXT, to_stage_key TEXT NOT NULL,
  reason TEXT NOT NULL, actor_user_id TEXT NOT NULL, occurred_at TEXT NOT NULL,
  FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE CASCADE,
  FOREIGN KEY (matter_workflow_id, firm_id) REFERENCES matter_workflows(id, firm_id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE matter_workflow_checklist (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL,
  matter_workflow_id TEXT NOT NULL, checklist_key TEXT NOT NULL,
  completed_by TEXT NOT NULL, completed_at TEXT NOT NULL,
  FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE CASCADE,
  FOREIGN KEY (matter_workflow_id, firm_id) REFERENCES matter_workflows(id, firm_id) ON DELETE CASCADE,
  FOREIGN KEY (completed_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
  UNIQUE (firm_id, matter_id, checklist_key), UNIQUE (id, firm_id)
) STRICT;
CREATE TABLE domain_events (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL,
  type TEXT NOT NULL, occurred_on TEXT NOT NULL, actor_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
  UNIQUE (firm_id, matter_id, idempotency_key), UNIQUE (id, firm_id)
) STRICT;
CREATE TABLE matter_deadlines (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL,
  domain_event_id TEXT NOT NULL, deadline_rule_id TEXT NOT NULL, calendar_id TEXT NOT NULL,
  title TEXT NOT NULL, trigger_date TEXT NOT NULL, due_date TEXT NOT NULL,
  initial_status TEXT NOT NULL DEFAULT 'pending' CHECK (initial_status = 'pending'),
  explanation TEXT NOT NULL, calculation_json TEXT NOT NULL, created_by TEXT NOT NULL,
  created_at TEXT NOT NULL, supersedes_deadline_id TEXT,
  FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE CASCADE,
  FOREIGN KEY (domain_event_id, firm_id) REFERENCES domain_events(id, firm_id) ON DELETE RESTRICT,
  FOREIGN KEY (deadline_rule_id) REFERENCES deadline_rules(id) ON DELETE RESTRICT,
  FOREIGN KEY (calendar_id) REFERENCES business_calendars(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
  UNIQUE (firm_id, domain_event_id, deadline_rule_id), UNIQUE (id, firm_id)
) STRICT;
CREATE TABLE deadline_status_events (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT NOT NULL,
  deadline_id TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending','satisfied','superseded','cancelled')),
  reason TEXT NOT NULL, actor_user_id TEXT NOT NULL, occurred_at TEXT NOT NULL,
  FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE CASCADE,
  FOREIGN KEY (deadline_id, firm_id) REFERENCES matter_deadlines(id, firm_id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_user_id, firm_id) REFERENCES users(id, firm_id) ON DELETE RESTRICT,
  UNIQUE (id, firm_id)
) STRICT;
CREATE TABLE workflow_generated_tasks (
  firm_id TEXT NOT NULL, matter_id TEXT NOT NULL, deadline_id TEXT NOT NULL,
  task_id TEXT NOT NULL, source_key TEXT NOT NULL,
  PRIMARY KEY (firm_id, source_key),
  FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE CASCADE,
  FOREIGN KEY (deadline_id, firm_id) REFERENCES matter_deadlines(id, firm_id) ON DELETE RESTRICT,
  FOREIGN KEY (task_id, firm_id) REFERENCES tasks(id, firm_id) ON DELETE CASCADE,
  UNIQUE (firm_id, deadline_id), UNIQUE (firm_id, task_id)
) STRICT;
CREATE TABLE integration_outbox (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, matter_id TEXT,
  topic TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending','processing','completed','failed')),
  attempts INTEGER NOT NULL DEFAULT 0, available_at TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE,
  FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id) ON DELETE CASCADE
) STRICT;

CREATE TRIGGER domain_events_no_update BEFORE UPDATE ON domain_events BEGIN SELECT RAISE(ABORT, 'domain_events is append-only'); END;
CREATE TRIGGER domain_events_no_delete BEFORE DELETE ON domain_events BEGIN SELECT RAISE(ABORT, 'domain_events is append-only'); END;
CREATE TRIGGER matter_deadlines_no_update BEFORE UPDATE ON matter_deadlines BEGIN SELECT RAISE(ABORT, 'matter_deadlines is immutable'); END;
CREATE TRIGGER matter_deadlines_no_delete BEFORE DELETE ON matter_deadlines BEGIN SELECT RAISE(ABORT, 'matter_deadlines is immutable'); END;
CREATE TRIGGER deadline_status_events_no_update BEFORE UPDATE ON deadline_status_events BEGIN SELECT RAISE(ABORT, 'deadline_status_events is append-only'); END;
CREATE TRIGGER deadline_status_events_no_delete BEFORE DELETE ON deadline_status_events BEGIN SELECT RAISE(ABORT, 'deadline_status_events is append-only'); END;
CREATE TRIGGER matter_stage_history_no_update BEFORE UPDATE ON matter_stage_history BEGIN SELECT RAISE(ABORT, 'matter_stage_history is append-only'); END;
CREATE TRIGGER matter_stage_history_no_delete BEFORE DELETE ON matter_stage_history BEGIN SELECT RAISE(ABORT, 'matter_stage_history is append-only'); END;
CREATE TRIGGER matter_workflow_checklist_no_update BEFORE UPDATE ON matter_workflow_checklist BEGIN SELECT RAISE(ABORT, 'matter_workflow_checklist is append-only'); END;
CREATE TRIGGER matter_workflow_checklist_no_delete BEFORE DELETE ON matter_workflow_checklist BEGIN SELECT RAISE(ABORT, 'matter_workflow_checklist is append-only'); END;
```

The migration begins at `CREATE TABLE business_calendars`; Task 1 already upgrades legacy `schema_migrations` metadata through `PRAGMA table_info`.

- [ ] **Step 4: Define and seed the active workflow**

Create `HOUSING_DISREPAIR_WORKFLOW` with these exact ordered stage keys:

```ts
['enquiry', 'assessment', 'onboarding', 'evidence', 'protocol', 'expert',
 'repairs_quantum', 'negotiation', 'proceedings', 'settlement', 'closure']
```

Seed these first rules:

```ts
[
  { key: 'housing.protocol.landlord_response', triggerEventType: 'letter_of_claim.received', offset: 20, unit: 'working_days' },
  { key: 'housing.expert.inspection', triggerEventType: 'landlord_response.received', offset: 20, unit: 'working_days' },
  { key: 'housing.expert.report', triggerEventType: 'expert.inspection.completed', offset: 10, unit: 'working_days' },
]
```

Every rule uses the official protocol URL and the applicable paragraph in `sourceTitle`. Seed the official 2026 England and Wales holidays: `2026-01-01`, `2026-04-03`, `2026-04-06`, `2026-05-04`, `2026-05-25`, `2026-08-31`, `2026-12-25` and `2026-12-28`, with source `https://www.gov.uk/bank-holidays`. Use stable UUID constants exported from `definitions.ts` so test fixtures remain deterministic.

- [ ] **Step 5: Implement tenant-scoped workflow persistence**

Implement `WorkflowStore` so every method accepts `firmId` and `matterId`, queries both, and wraps event/deadline creation in `BEGIN IMMEDIATE`/`COMMIT`. `recordTriggerAndDeadline` must:

1. find the matter's pinned workflow version;
2. find one active rule matching the trigger type and trigger date;
3. insert/reuse the idempotent domain event;
4. calculate with the pinned business calendar;
5. insert/reuse the immutable deadline and append its initial `pending` status event;
6. insert/reuse one operational reminder task due at noon UTC on the date-only deadline and link it through `workflow_generated_tasks` using source key `deadline:<deadlineId>`;
7. append a timeline event, audit event and outbox event in the same transaction; and
8. return the persisted deadline with its latest append-only status, parsed calculation and source fields.

- [ ] **Step 6: Run focused tests and database regressions**

Run: `npm test -- src/server/workflow/store.test.ts src/server/database.test.ts src/server/migrations.test.ts`

Expected: workflow tests PASS; existing isolation/immutability tests remain PASS.

- [ ] **Step 7: Commit workflow persistence**

```bash
git add src/server/migrations src/server/workflow src/server/database.ts src/server/database.test.ts
git commit -m "feat: persist versioned housing workflows"
```

---

### Task 4: Workflow Service, Readiness and Stage Transitions

**Files:**
- Create: `src/server/workflow/service.ts`
- Test: `src/server/workflow/service.test.ts`
- Modify: `src/server/workflow/store.ts`
- Modify: `src/server/store.ts`

**Interfaces:**
- Consumes: `WorkflowStore`, existing append-only audit/timeline helpers and authenticated `SessionUser`.
- Produces: `WorkflowService.getMatter360(user, matterId)`, `transitionStage(user, matterId, input, auditContext)` and `confirmTrigger(user, matterId, input, auditContext)`.

- [ ] **Step 1: Write failing service tests**

Cover these exact behaviors:

```ts
it('returns stages, current position, readiness blockers and critical deadlines');
it('moves to the next stage and records immutable stage history, timeline and audit');
it('rejects a transition with blockers unless overrideReason is supplied and the user has workflow.override');
it('returns NOT_FOUND for a matter outside the user read scope');
it('confirms a trigger once and returns the explainable generated deadline');
it('returns CONFLICT when expectedVersion is stale');
```

Use concrete inputs:

```ts
const transition = {
  toStageKey: 'assessment',
  expectedVersion: 1,
  completedChecklistKeys: ['enquiry.contact_recorded', 'enquiry.property_identified'],
  reason: 'Initial enquiry recorded and suitable for assessment.',
};

const trigger = {
  eventType: 'letter_of_claim.received',
  occurredOn: '2026-08-03',
  idempotencyKey: 'northstar-loc-received-2026-08-03',
};
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/server/workflow/service.test.ts`

Expected: FAIL because `WorkflowService` does not exist.

- [ ] **Step 3: Implement domain errors and summary model**

Define:

```ts
export class WorkflowError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'READINESS_BLOCKED' | 'CONFLICT' | 'RULE_NOT_FOUND',
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) { super(message); }
}

export interface Matter360 {
  matter: MatterSummary;
  workflow: {
    id: string;
    version: number;
    currentStageKey: string;
    stages: Array<WorkflowStageDefinition & { state: 'completed' | 'current' | 'upcoming' }>;
    blockers: Array<{ key: string; label: string; severity: 'warning' | 'critical' }>;
  };
  deadlines: Array<{
    id: string; title: string; triggerDate: string; dueDate: string; status: string;
    explanation: string; sourceTitle: string; sourceUrl: string;
  }>;
  nextActions: MatterTask[];
  alerts: Array<{ key: string; severity: string; title: string; detail: string }>;
  permissions: { canWrite: boolean; canTransition: boolean; canOverrideWorkflow: boolean };
}
```

- [ ] **Step 4: Implement transition orchestration**

The service must authorise read/write using the existing matter scope, verify `expectedVersion`, persist newly completed checklist keys idempotently, evaluate the target stage's checklist keys, require a non-empty reason, and update `matter_workflows.current_stage_key` and `version` atomically. It appends stage history, domain event, timeline and audit rows. It updates `matters.stage` to the human stage name for backward compatibility.

An override is allowed only when `hasCapability(user, 'workflow.override')` is true and `overrideReason.trim().length >= 10`. The audit `after` JSON includes blockers and override reason.

- [ ] **Step 5: Run focused and full server tests**

Run: `npm test -- src/server/workflow/service.test.ts src/server/store.test.ts src/server/app.test.ts`

Expected: all selected tests PASS.

- [ ] **Step 6: Commit the service**

```bash
git add src/server/workflow/service.ts src/server/workflow/service.test.ts src/server/workflow/store.ts src/server/store.ts
git commit -m "feat: add controlled workflow transitions"
```

---

### Task 5: Capabilities and Resource-Specific Workflow API

**Files:**
- Modify: `src/server/policy.ts`
- Modify: `src/shared/contracts.ts`
- Create: `src/server/workflow/routes.ts`
- Test: `src/server/workflow/routes.test.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/app.test.ts`

**Interfaces:**
- Consumes: `WorkflowService`, `SessionUser`, `AuditContext` and Zod.
- Produces: `hasCapability(user, capability)`, `workflowRoutes(options)` and routes for Matter 360, transition and trigger confirmation.

- [ ] **Step 1: Write failing capability and route tests**

Add policy unit assertions:

```ts
expect(hasCapability(partner, 'workflow.override')).toBe(true);
expect(hasCapability(solicitor, 'workflow.transition')).toBe(true);
expect(hasCapability(paralegal, 'workflow.override')).toBe(false);
expect(hasCapability(finance, 'workflow.transition')).toBe(false);
```

Create route tests for:

- `GET /api/matters/:id/summary` returns Matter 360 to an assigned solicitor;
- `POST /api/matters/:id/workflow/transitions` returns `200` and increments version;
- missing checklist returns `409 READINESS_BLOCKED` with blocker keys;
- stale `expectedVersion` returns `409 CONFLICT`;
- `POST /api/matters/:id/workflow/triggers` creates the 20-working-day deadline;
- another-firm and unassigned matters return identical `404` envelopes;
- finance and readonly roles cannot transition.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/server/workflow/routes.test.ts src/server/policy.test.ts`

Expected: FAIL because capability and routes are absent. If `policy.test.ts` does not exist, create it beside `policy.ts`.

- [ ] **Step 3: Add explicit capability mapping**

Use this mapping in `policy.ts`:

```ts
export type Capability =
  | 'matter.read' | 'matter.write' | 'matter.create'
  | 'workflow.transition' | 'workflow.override' | 'deadline.confirm'
  | 'administration.view';

const ROLE_CAPABILITIES: Record<FirmRole, readonly Capability[]> = {
  admin: ['matter.read','matter.write','matter.create','workflow.transition','workflow.override','deadline.confirm','administration.view'],
  partner: ['matter.read','matter.write','matter.create','workflow.transition','workflow.override','deadline.confirm','administration.view'],
  solicitor: ['matter.read','matter.write','workflow.transition','deadline.confirm'],
  paralegal: ['matter.read','matter.write','workflow.transition','deadline.confirm'],
  finance: ['matter.read'],
  readonly: ['matter.read'],
};

export function hasCapability(user: SessionUser, capability: Capability): boolean {
  return ROLE_CAPABILITIES[user.role].includes(capability);
}
```

Keep existing scope checks; capabilities do not grant access to an unassigned matter.

- [ ] **Step 4: Add command schemas**

Add to shared contracts:

```ts
export const transitionWorkflowSchema = z.object({
  toStageKey: z.string().regex(/^[a-z][a-z0-9_]*$/).max(80),
  expectedVersion: z.number().int().positive(),
  completedChecklistKeys: z.array(z.string().max(120)).max(100).default([]),
  reason: z.string().trim().min(10).max(1_000),
  overrideReason: z.string().trim().min(10).max(1_000).optional(),
});

export const confirmWorkflowTriggerSchema = z.object({
  eventType: z.enum([
    'letter_of_claim.received',
    'landlord_response.received',
    'expert.inspection.completed',
  ]),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  idempotencyKey: z.string().trim().min(8).max(200),
});
```

- [ ] **Step 5: Register focused workflow routes**

Export a Fastify plugin receiving `{ service, requireUser, auditContext }`. Routes parse inputs, call the service and map `WorkflowError`:

```ts
const statusByCode = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  READINESS_BLOCKED: 409,
  CONFLICT: 409,
  RULE_NOT_FOUND: 422,
} as const;
```

Error bodies include `{ error: { code, message, fields? }, details? }`; tenant-safe messages do not identify inaccessible resources.

- [ ] **Step 6: Run API regression and type checks**

Run: `npm test -- src/server/workflow/routes.test.ts src/server/app.test.ts src/server/policy.test.ts`

Run: `npm run typecheck`

Expected: tests PASS and type checks exit 0.

- [ ] **Step 7: Commit the API**

```bash
git add src/server/policy.ts src/server/policy.test.ts src/shared/contracts.ts src/server/workflow/routes.ts src/server/workflow/routes.test.ts src/server/app.ts src/server/app.test.ts
git commit -m "feat: expose matter workflow controls"
```

---

### Task 6: Matter 360 Operational Overview

**Files:**
- Modify: `src/client/api.ts`
- Create: `src/client/components/matter/MatterHeader.tsx`
- Create: `src/client/components/matter/MatterSectionRail.tsx`
- Create: `src/client/components/matter/WorkflowCard.tsx`
- Create: `src/client/components/matter/DeadlineCard.tsx`
- Create: `src/client/components/matter/OperationalOverview.tsx`
- Test: `src/client/components/matter/OperationalOverview.test.tsx`
- Modify: `src/client/pages/MatterPage.tsx`
- Modify: `src/client/App.test.tsx`
- Modify: `src/client/styles.css`

**Interfaces:**
- Consumes: `GET /api/matters/:id/summary`, transition route and trigger-confirmation route.
- Produces: typed `Matter360Data` and a responsive operational overview that preserves existing people/documents/tasks/activity/audit sections.

- [ ] **Step 1: Write failing operational-overview tests**

Render a fixture with current stage `protocol`, 11 stages, one critical blocker and a landlord response deadline. Assert:

```tsx
expect(screen.getByRole('heading', { name: 'Clarke v Meridian Housing' })).toBeVisible();
expect(screen.getByText('Pre-Action Protocol')).toBeVisible();
expect(screen.getByText('Landlord response to Letter of Claim')).toBeVisible();
expect(screen.getByText(/20 working days after/)).toBeVisible();
expect(screen.getByRole('link', { name: /official source/i })).toHaveAttribute('href', expect.stringContaining('justice.gov.uk'));
expect(screen.getByText('1 readiness blocker')).toBeVisible();
```

Interaction tests must verify that transition opens a confirmation panel, requires a reason, sends `expectedVersion`, shows `409` conflict copy and reloads the summary after success.

- [ ] **Step 2: Run client tests and verify failure**

Run: `npm test -- src/client/components/matter/OperationalOverview.test.tsx`

Expected: FAIL because Matter 360 components do not exist.

- [ ] **Step 3: Add typed client contracts**

Add exact client types matching `Matter360` from Task 4. Do not import server modules into browser code. Add:

```ts
export type MatterSection =
  | 'overview' | 'client_household' | 'property_tenancy' | 'defects_repairs'
  | 'evidence' | 'documents' | 'communications' | 'protocol_experts'
  | 'damages_offers' | 'proceedings' | 'tasks_calendar' | 'time_finance'
  | 'chronology' | 'audit';
```

Map the existing implemented tabs to active sections and render unimplemented programme sections as disabled with the label `Planned` rather than dead clickable controls.

- [ ] **Step 4: Implement the persistent header and rail**

`MatterHeader` shows reference, client, the temporary property label `Property being confirmed`, stage, owner, risk, next deadline and open-task count. `MatterSectionRail` uses semantic buttons, visible focus and `aria-current="page"`.

- [ ] **Step 5: Implement workflow and deadline cards**

`WorkflowCard` renders stages vertically, not in a long horizontal row. Completed/current/upcoming state must not rely on colour alone. The transition action is visible only when `canTransition` is true.

`DeadlineCard` renders due date, status, trigger date, explanation and an external official-source link. It never labels a generated date as guaranteed or legally approved.

- [ ] **Step 6: Compose the Matter 360 overview**

The desktop grid contains:

1. critical alerts across the full width;
2. matter position and next actions;
3. workflow progress and deadline register;
4. existing matter metrics and recent chronology.

At widths below 900px, use one column. Keep the next deadline and stage visible before secondary metrics. Reuse existing navy/off-white visual language and eliminate low-density blank panels.

- [ ] **Step 7: Integrate without breaking existing tabs**

`MatterPage` first fetches `/summary`, renders Matter 360, and lazily retains the existing aggregate call for current people/documents/tasks/activity/audit content. Mutations invalidate only the affected resource plus summary. During this compatibility slice, a summary reload after existing mutations is acceptable; do not delete `/api/matters/:id`.

- [ ] **Step 8: Run client tests, accessibility assertions and build**

Run: `npm test -- src/client/components/matter/OperationalOverview.test.tsx src/client/App.test.tsx`

Run: `npm run typecheck`

Run: `npm run build`

Expected: tests PASS, type checks exit 0 and Vite production build succeeds.

- [ ] **Step 9: Commit Matter 360**

```bash
git add src/client/api.ts src/client/components/matter src/client/pages/MatterPage.tsx src/client/App.test.tsx src/client/styles.css
git commit -m "feat: add Matter 360 workflow overview"
```

---

### Task 7: Realistic Housing Disrepair Evaluation Matter

**Files:**
- Modify: `src/server/database.ts`
- Modify: `src/server/database.test.ts`
- Modify: `src/server/workflow/definitions.ts`
- Modify: `src/server/workflow/store.test.ts`
- Modify: `src/client/App.test.tsx`

**Interfaces:**
- Consumes: stable `SEED_IDS`, workflow seeding and Matter 360 API.
- Produces: a fictional Northstar Housing Disrepair matter at protocol stage with explainable deadlines and a separate Southbank tenant fixture.

- [ ] **Step 1: Write failing seed acceptance tests**

Assert the primary matter has:

```ts
expect(summary.matter).toMatchObject({
  reference: 'NCL-2026-0017',
  matterType: 'Housing conditions claim',
  stage: 'Pre-Action Protocol',
  clientName: 'Maya Clarke',
});
expect(summary.workflow.currentStageKey).toBe('protocol');
expect(summary.deadlines).toEqual(expect.arrayContaining([
  expect.objectContaining({
    title: 'Landlord response to Letter of Claim',
    dueDate: '2026-08-11',
  }),
]));
```

Use a confirmed trigger date that produces the asserted due date under the seeded calendar; calculate it in the test through `calculateDeadline` rather than duplicating date arithmetic.

- [ ] **Step 2: Run seed tests and verify failure**

Run: `npm test -- src/server/database.test.ts src/server/workflow/store.test.ts src/client/App.test.tsx`

Expected: FAIL because current seed is generic insurance litigation without workflow state.

- [ ] **Step 3: Replace only the fictional Northstar seed narrative**

Use:

- client: Maya Clarke;
- opponent/landlord: Meridian Housing Association;
- property: 18 Alder Court, Salford, M5 4QJ;
- matter title: `Clarke v Meridian Housing`;
- matter type: `Housing conditions claim`;
- current stage: `Pre-Action Protocol`;
- risk: high;
- synthetic defects summary: damp and mould, defective bathroom extractor, leaking bedroom window, damaged plaster and intermittent heating;
- owner: Ava Morgan; supervisor: Marcus Reed;
- no real names, addresses, files or copied precedents.

Instantiate the workflow, append completed stage history through protocol and create a confirmed Letter of Claim receipt event. Seed through the same store/service commands used in production where practical; direct SQL seed helpers must produce identical audit/domain records.

- [ ] **Step 4: Verify isolation and deterministic reseeding**

Call `seedDatabase` twice and assert no duplicate workflow, stage history, domain event or deadline. Verify Lewis Grant still cannot see the Northstar matter and Ava cannot see the Southbank matter.

- [ ] **Step 5: Run the full suite**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 6: Commit the evaluation matter**

```bash
git add src/server/database.ts src/server/database.test.ts src/server/workflow src/client/App.test.tsx
git commit -m "feat: seed housing disrepair workflow matter"
```

---

### Task 8: Full Verification, Browser Journey and Operating Documentation

**Files:**
- Modify: `README.md`
- Modify: `.env.example` only if a new configuration variable is actually consumed.
- Modify: `docs/superpowers/specs/2026-07-13-claimant-housing-disrepair-cms-design.md` only for factual implementation notes, without changing approved scope.

**Interfaces:**
- Consumes: complete slice.
- Produces: verified repository state and an operator-readable handoff for the next CMS slice.

- [ ] **Step 1: Run clean automated verification**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected:

- all test files and tests pass;
- both TypeScript checks exit 0;
- server compilation and Vite production build succeed.

- [ ] **Step 2: Start the production build with synthetic data**

Run: `SEED_DEMO_DATA=true NODE_ENV=development npm start`

Expected: server listens on `http://127.0.0.1:4100` and `/api/health` returns `{ "status": "ok" }`.

- [ ] **Step 3: Verify the complete browser story**

Use the browser-verification workflow and complete:

1. sign in as Ava;
2. open `NCL-2026-0017`;
3. confirm Matter 360 shows Housing Disrepair stage progress;
4. inspect the official-source deadline explanation;
5. transition a test copy of the matter with the required checklist and reason;
6. verify the updated stage persists after reload;
7. sign in as Lewis and verify the Northstar matter remains invisible;
8. inspect desktop and 390px mobile layouts;
9. confirm no unexpected console errors and no HTTP 5xx responses.

- [ ] **Step 4: Update README accurately**

Document:

- Matter 360 and workflow capabilities now implemented;
- the three seeded protocol rules and official source posture;
- how deadline triggers are user-confirmed and calculations explained;
- evaluation accounts and synthetic nature of all data;
- the next plan is Intake and Onboarding;
- unchanged prohibition on live client data.

- [ ] **Step 5: Review the diff and repository status**

Run:

```bash
git diff --check
git status --short
git log --oneline --decorate -12
```

Expected: no whitespace errors; only intended documentation changes remain before the final commit.

- [ ] **Step 6: Commit verified documentation**

```bash
git add README.md .env.example docs/superpowers/specs/2026-07-13-claimant-housing-disrepair-cms-design.md
git commit -m "docs: document Matter 360 workflow foundation"
```

- [ ] **Step 7: Run final evidence commands after the commit**

Run:

```bash
npm test
npm run typecheck
npm run build
git status --short --branch
```

Expected: all verification gates pass and the feature branch is clean.

## Plan Completion Gate

Do not mark this plan complete unless:

- migration upgrade and checksum tests pass;
- working-day examples are proven by tests;
- workflow instantiation and trigger replay are idempotent;
- stage transitions enforce readiness, capability and optimistic concurrency;
- deadline records expose source and explanation;
- Matter 360 is browser-verified on desktop and mobile;
- existing tenant-isolation behavior remains unchanged;
- all automated verification gates pass from the committed branch; and
- README explicitly states that the application remains evaluation-only for synthetic/anonymised data.
