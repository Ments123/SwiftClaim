# Intake and Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tenant-safe claimant Housing Conditions journey from a new enquiry through conflict and legal assessment, onboarding controls, and atomic conversion into an Evidence-stage governed matter.

**Architecture:** Add a pre-matter intake domain beside the existing matter and workflow domains. `IntakeService` owns permissions, readiness, decisions, and conversion; `IntakeStore` owns tenant-scoped persistence; the existing `WorkflowStore` gains one transaction-aware intake bootstrap operation. The React application gains an enquiry queue and a sectioned intake workspace, while converted intake data is exposed as independently loaded Client & Household and Property & Tenancy matter resources.

**Tech Stack:** TypeScript, Node.js 24 `node:sqlite`, Fastify, Zod, React 19, Vitest, Testing Library, Vite, existing CSS and Lucide icons.

## Global Constraints

- The product is for claimant solicitors conducting Housing Conditions claims in England.
- Use only synthetic evaluation data; the build remains unapproved for live client material.
- The application must never auto-clear a conflict, auto-accept a case, or auto-determine liability.
- Every tenant-owned read and write is scoped by server-derived `firm_id`; inaccessible and cross-firm resources return the same generic `404` envelope.
- Every command uses explicit capabilities and assigned-enquiry access; finance and read-only roles cannot access prospective-client intake records.
- Conflict searches and decisions, enquiry status events, conversion records, audit records, and chronology records are append-only.
- Mutable intake aggregates use optimistic integer versions and return `409 CONFLICT` for stale commands.
- Identity fields store verification status and necessary structured facts, not raw identity-document images.
- Money is integer minor units with ISO currency; date-only legal dates remain `YYYY-MM-DD` strings.
- Accepted intake records convert atomically into canonical contacts, matter participation, housing case, tenancy, assignments, and a pinned workflow at Evidence and notice.
- Existing manual matter creation remains an administrative compatibility path, but the normal claimant UI starts with an enquiry.
- No new third-party service or package is required.

---

### Task 1: Intake schema migration

**Files:**
- Create: `src/server/migrations/003-intake-onboarding.ts`
- Modify: `src/server/migrations/index.ts`
- Modify: `src/server/migrations.test.ts`
- Modify: `src/server/database.test.ts`

**Interfaces:**
- Produces migration version `3`, named `intake and onboarding`.
- Produces tenant-owned tables: `contacts`, `organisations`, `properties`, `enquiries`, `enquiry_status_events`, `conflict_checks`, `conflict_decisions`, `housing_assessments`, `onboarding_profiles`, `household_members`, `tenancies`, `matter_participants`, `housing_cases`, `intake_conversions`, and `reference_sequences`.
- Produces append-only triggers for status events, conflict checks/decisions, and conversions.

- [ ] **Step 1: Write failing migration tests**

Add tests that expect migration version 3, all listed tables, composite tenant foreign keys, unique `(firm_id, reference)`, unique conversion per enquiry, and append-only mutation rejection.

```ts
expect(migrations.map(({ version, name }) => ({ version, name }))).toEqual([
  { version: 1, name: 'secure matter spine' },
  { version: 2, name: 'workflow foundation' },
  { version: 3, name: 'intake and onboarding' },
]);
expect(tableNames).toEqual(expect.arrayContaining([
  'contacts', 'organisations', 'properties', 'enquiries',
  'enquiry_status_events', 'conflict_checks', 'conflict_decisions',
  'housing_assessments', 'onboarding_profiles', 'household_members',
  'tenancies', 'matter_participants', 'housing_cases',
  'intake_conversions', 'reference_sequences',
]));
expect(() => database.exec(
  "DELETE FROM conflict_decisions WHERE id = 'fixture-decision'",
)).toThrow(/append-only/);
```

- [ ] **Step 2: Run the migration tests and verify RED**

Run: `npm test -- src/server/migrations.test.ts src/server/database.test.ts`

Expected: FAIL because migration 3 and the intake tables do not exist.

- [ ] **Step 3: Add the complete migration**

Use strict tables, composite uniqueness, explicit checks, and indexes. The core current-state columns are:

```ts
export const intakeOnboardingMigration = defineMigration({
  version: 3,
  name: 'intake and onboarding',
  sql: `
    CREATE TABLE contacts (
      id TEXT NOT NULL, firm_id TEXT NOT NULL, given_name TEXT NOT NULL,
      family_name TEXT NOT NULL, display_name TEXT NOT NULL,
      date_of_birth TEXT, email TEXT, phone TEXT,
      preferred_channel TEXT NOT NULL DEFAULT 'email',
      safe_contact_instructions TEXT NOT NULL DEFAULT '',
      accessibility_needs TEXT NOT NULL DEFAULT '', interpreter_language TEXT,
      normalized_name TEXT NOT NULL, normalized_email TEXT, normalized_phone TEXT,
      external_source TEXT, external_id TEXT, import_batch_id TEXT,
      created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (id), UNIQUE (id, firm_id),
      FOREIGN KEY (firm_id) REFERENCES firms(id),
      FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id)
    ) STRICT;
    CREATE INDEX idx_contacts_dedupe
      ON contacts(firm_id, normalized_name, normalized_email, normalized_phone);

    CREATE TABLE organisations (
      id TEXT NOT NULL, firm_id TEXT NOT NULL, name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('landlord','referrer','solicitor','other')),
      email TEXT, phone TEXT, address TEXT NOT NULL DEFAULT '',
      normalized_name TEXT NOT NULL, external_source TEXT, external_id TEXT,
      import_batch_id TEXT, created_by TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (id), UNIQUE (id, firm_id),
      FOREIGN KEY (firm_id) REFERENCES firms(id),
      FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id)
    ) STRICT;

    CREATE TABLE properties (
      id TEXT NOT NULL, firm_id TEXT NOT NULL, address_line_1 TEXT NOT NULL,
      address_line_2 TEXT NOT NULL DEFAULT '', city TEXT NOT NULL,
      county TEXT NOT NULL DEFAULT '', postcode TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT 'England', uprn TEXT,
      property_type TEXT NOT NULL DEFAULT 'unknown', normalized_address TEXT NOT NULL,
      external_source TEXT, external_id TEXT, import_batch_id TEXT,
      created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (id), UNIQUE (id, firm_id),
      FOREIGN KEY (firm_id) REFERENCES firms(id),
      FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id)
    ) STRICT;
    CREATE INDEX idx_properties_dedupe ON properties(firm_id, normalized_address);

    CREATE TABLE enquiries (
      id TEXT NOT NULL, firm_id TEXT NOT NULL, reference TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN
        ('new','assessment','accepted','declined','referred','duplicate',
         'unable_to_contact','converted')),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      source TEXT NOT NULL, referrer_name TEXT NOT NULL DEFAULT '',
      prospective_contact_id TEXT NOT NULL, property_id TEXT NOT NULL,
      landlord_organisation_id TEXT, assigned_user_id TEXT NOT NULL,
      summary TEXT NOT NULL, defect_summary TEXT NOT NULL,
      desired_outcome TEXT NOT NULL DEFAULT '', first_complained_on TEXT,
      currently_occupied INTEGER NOT NULL CHECK (currently_occupied IN (0,1)),
      urgency TEXT NOT NULL CHECK (urgency IN ('routine','priority','urgent','critical')),
      immediate_safety_concerns TEXT NOT NULL DEFAULT '',
      communication_requirements TEXT NOT NULL DEFAULT '',
      decision_reason TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (id), UNIQUE (id, firm_id), UNIQUE (firm_id, reference),
      FOREIGN KEY (prospective_contact_id, firm_id) REFERENCES contacts(id, firm_id),
      FOREIGN KEY (property_id, firm_id) REFERENCES properties(id, firm_id),
      FOREIGN KEY (landlord_organisation_id, firm_id) REFERENCES organisations(id, firm_id),
      FOREIGN KEY (assigned_user_id, firm_id) REFERENCES users(id, firm_id),
      FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id)
    ) STRICT;
  `,
});
```

Use this exact schema contract for the remaining tables:

| Table | Required columns and constraints |
|---|---|
| `reference_sequences` | `firm_id`, `resource_key`, `next_value > 0`; primary key `(firm_id, resource_key)` |
| `enquiry_status_events` | `id`, `firm_id`, `enquiry_id`, nullable `from_status`, `to_status`, `reason`, `actor_user_id`, `occurred_at`; unique `(id, firm_id)` and append-only triggers |
| `conflict_checks` | `id`, `firm_id`, `enquiry_id`, valid `query_json`, valid `results_json`, `match_count >= 0`, `run_by`, `run_at`; unique `(id, firm_id)` and append-only triggers |
| `conflict_decisions` | `id`, `firm_id`, `enquiry_id`, `conflict_check_id`, `decision` checked to `clear`, `blocked`, or `cleared_with_override`, `reason`, `decided_by`, `decided_at`; append-only triggers |
| `housing_assessments` | `id`, `firm_id`, unique `enquiry_id`, nullable `matter_id`, `version > 0`, jurisdiction flag, claimant relationship, notice summary, unresolved flag, optional condition start, access/evidence/limitation text, valid legal-issues and escalations JSON, merits/proportionality ratings, decision, reason, nullable reviewer/time, update actor/time |
| `onboarding_profiles` | `id`, `firm_id`, unique `enquiry_id`, nullable `matter_id`, `version > 0`, checked identity/client-care/authority/privacy/funding/signature statuses, funding type, vulnerability/accessibility/safe-contact text, interpreter language, owner and supervisor user IDs, update actor/time |
| `household_members` | `id`, `firm_id`, `enquiry_id`, nullable `matter_id` and `contact_id`, display name, relationship, current-occupancy flag, claim-participant flag, vulnerability and accessibility text, created actor/time; unique `(id, firm_id)` |
| `tenancies` | `id`, `firm_id`, unique `enquiry_id`, nullable unique `matter_id`, property and landlord IDs, checked tenancy type, optional start/end and occupancy dates, non-negative `rent_minor`, three-character `currency`, checked rent frequency, update actor/time; unique `(id, firm_id)` |
| `matter_participants` | `id`, `firm_id`, `matter_id`, nullable `contact_id`, nullable `organisation_id`, checked role, primary flag, created actor/time; check that exactly one participant ID is set and unique role/participant per matter |
| `housing_cases` | `id`, `firm_id`, unique `matter_id`, unique `source_enquiry_id`, claimant contact, property, tenancy, landlord organisation, current-occupancy flag, created actor/time; unique `(id, firm_id)` |
| `intake_conversions` | `id`, `firm_id`, unique `enquiry_id`, unique `matter_id`, unique `(firm_id, idempotency_key)`, `converted_by`, `converted_at`; append-only triggers |

All child references use the existing `(id, firm_id)` composite-key convention. Add tenant-leading indexes for enquiry status/assignee, normalized organisation name, conflict enquiry/time, household enquiry, and matter profile lookup.

- [ ] **Step 4: Run migration and full database tests**

Run: `npm test -- src/server/migrations.test.ts src/server/database.test.ts`

Expected: PASS with migration versions 1–3 and append-only constraints enforced.

- [ ] **Step 5: Commit**

```bash
git add src/server/migrations src/server/migrations.test.ts src/server/database.test.ts
git commit -m "feat: add intake and onboarding schema"
```

---

### Task 2: Intake contracts, capabilities, and tenant-scoped enquiry store

**Files:**
- Modify: `src/shared/contracts.ts`
- Modify: `src/server/policy.ts`
- Modify: `src/server/policy.test.ts`
- Create: `src/server/intake/types.ts`
- Create: `src/server/intake/store.ts`
- Create: `src/server/intake/store.test.ts`

**Interfaces:**
- Produces `createEnquirySchema`, `updateEnquirySchema`, and stable DTOs `EnquiryListItem` and `EnquiryDetail`.
- Produces capabilities `intake.read`, `intake.write`, `intake.decide`, `intake.override_conflict`, and `intake.convert`.
- Produces `IntakeStore.listEnquiries`, `getEnquiry`, `createEnquiry`, and `updateEnquiry`.

- [ ] **Step 1: Write failing policy and store tests**

Test partner firm-wide access, assigned solicitor/paralegal access, finance denial, cross-firm non-disclosure, server-generated `HDR-E-YYYY-NNNN` references, audit creation, and stale-version conflict.

```ts
expect(hasCapability(ava, 'intake.write')).toBe(true);
expect(hasCapability(finance, 'intake.read')).toBe(false);
const enquiry = store.createEnquiry(ava, validInput, context);
expect(enquiry.reference).toBe('HDR-E-2026-0001');
expect(() => store.updateEnquiry(ava, enquiry.id, {
  expectedVersion: 1,
  summary: 'Stale write after a successful update',
}, context)).toThrowError(IntakeStateConflictError);
expect(store.getEnquiry(lewis, enquiry.id)).toBeUndefined();
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/server/policy.test.ts src/server/intake/store.test.ts`

Expected: FAIL because the capabilities and intake store do not exist.

- [ ] **Step 3: Add exact Zod command contracts**

```ts
export const createEnquirySchema = z.object({
  source: z.string().trim().min(2).max(120),
  referrerName: z.string().trim().max(200).default(''),
  client: z.object({
    givenName: z.string().trim().min(1).max(100),
    familyName: z.string().trim().min(1).max(100),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    email: z.union([z.literal(''), z.string().trim().email().max(254)]),
    phone: z.string().trim().max(80),
    preferredChannel: z.enum(['email','phone','sms','post']),
  }),
  property: z.object({
    addressLine1: z.string().trim().min(2).max(200),
    addressLine2: z.string().trim().max(200).default(''),
    city: z.string().trim().min(2).max(120),
    county: z.string().trim().max(120).default(''),
    postcode: z.string().trim().min(5).max(12),
    country: z.literal('England'),
    propertyType: z.enum(['house','flat','maisonette','bungalow','other','unknown']),
  }),
  landlordName: z.string().trim().min(2).max(200),
  summary: z.string().trim().min(10).max(4000),
  defectSummary: z.string().trim().min(5).max(4000),
  desiredOutcome: z.string().trim().max(2000).default(''),
  firstComplainedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  currentlyOccupied: z.boolean(),
  urgency: z.enum(['routine','priority','urgent','critical']),
  immediateSafetyConcerns: z.string().trim().max(2000).default(''),
  communicationRequirements: z.string().trim().max(2000).default(''),
  assignedUserId: z.string().uuid(),
});
```

`updateEnquirySchema` accepts `expectedVersion` plus the editable enquiry fields and rejects empty updates.

- [ ] **Step 4: Implement normalization, access scope, CRUD, and audit**

Use lowercase alphanumeric normalization for names, email, phone, and addresses. Create/reuse contacts, properties, and landlord organisations by exact normalized tenant-local keys; never reuse across firms. Every update increments `version` in the guarded `WHERE version = ?` statement and records `enquiry.updated` audit metadata.

```ts
const changed = database.prepare(`
  UPDATE enquiries SET summary = ?, defect_summary = ?, version = version + 1,
    updated_at = ?
  WHERE firm_id = ? AND id = ? AND version = ?
`).run(input.summary, input.defectSummary, now, user.firmId, enquiryId,
  input.expectedVersion);
if (changed.changes !== 1) throw new IntakeStateConflictError();
```

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- src/server/policy.test.ts src/server/intake/store.test.ts`

```bash
git add src/shared/contracts.ts src/server/policy.ts src/server/policy.test.ts src/server/intake
git commit -m "feat: add tenant-scoped enquiry records"
```

---

### Task 3: Explicit conflict search and decision controls

**Files:**
- Modify: `src/shared/contracts.ts`
- Create: `src/server/intake/conflicts.ts`
- Create: `src/server/intake/conflicts.test.ts`
- Modify: `src/server/intake/store.ts`
- Modify: `src/server/intake/store.test.ts`

**Interfaces:**
- Produces `IntakeConflictService.runCheck(user, enquiryId)` and `recordDecision(user, enquiryId, command)`.
- Produces decisions `clear`, `blocked`, and `cleared_with_override`.
- Returns capped, permission-safe match summaries with `source`, `display`, and `matchedOn`; it does not expose another firm's identifiers or counts.

- [ ] **Step 1: Write failing conflict tests**

Cover same-firm name/email/property matches, self-record exclusion, no cross-firm matches, immutable repeat searches, required human decision, solicitor denial for a match override, and partner override with reason.

```ts
const check = service.runCheck(ava, enquiry.id, context);
expect(check.matches).toEqual(expect.arrayContaining([
  expect.objectContaining({ source: 'matter', matchedOn: ['client_name'] }),
]));
expect(() => service.recordDecision(ava, enquiry.id, {
  checkId: check.id, decision: 'cleared_with_override',
  reason: 'Potential match reviewed and confirmed to be a different person.',
}, context)).toThrowErrorMatchingObject({ code: 'FORBIDDEN' });
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/server/intake/conflicts.test.ts`

Expected: FAIL because the conflict service does not exist.

- [ ] **Step 3: Implement deterministic tenant-local search**

Search normalized contact name/email/phone, property address/postcode, landlord organisation, legacy parties, and matter client/title within `user.firmId`. Exclude the enquiry's own canonical contact/property/landlord. Cap results at 25 and store the exact query and projected results in immutable JSON.

- [ ] **Step 4: Implement the decision matrix**

```ts
if (command.decision === 'clear' && check.matchCount > 0) {
  throw new IntakeError('CONFLICT_REVIEW_REQUIRED',
    'Potential matches require an authorised override.');
}
if (command.decision === 'cleared_with_override' &&
    !hasCapability(user, 'intake.override_conflict')) {
  throw new IntakeError('FORBIDDEN',
    'You cannot override a potential conflict match.');
}
```

Require a minimum 10-character reason, append `conflict.decision_recorded` audit, and never mutate the search record.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- src/server/intake/conflicts.test.ts src/server/intake/store.test.ts`

```bash
git add src/shared/contracts.ts src/server/intake
git commit -m "feat: add controlled conflict checks"
```

---

### Task 4: Assessment, onboarding, readiness, and intake decisions

**Files:**
- Modify: `src/shared/contracts.ts`
- Create: `src/server/intake/service.ts`
- Create: `src/server/intake/service.test.ts`
- Modify: `src/server/intake/store.ts`
- Modify: `src/server/intake/types.ts`

**Interfaces:**
- Produces `saveAssessment`, `saveOnboarding`, `decideEnquiry`, and `getReadiness`.
- Assessment decisions: `draft`, `proceed`, `decline`, `refer`.
- Enquiry outcomes: `accepted`, `declined`, `referred`, `duplicate`, `unable_to_contact`.
- Onboarding includes owner, supervisor, verification/control statuses, tenancy, and a replace-by-command household list.

- [ ] **Step 1: Write failing readiness and decision tests**

Cover missing conflict decision, non-England rejection, unresolved/notice/limitation fields, urgent escalation requiring supervisor review, incomplete onboarding, stale versions, terminal outcome history, and complete accepted conversion readiness.

```ts
expect(service.getReadiness(ava, enquiry.id)).toMatchObject({
  assessment: { ready: false, blockers: expect.arrayContaining([
    expect.objectContaining({ key: 'conflict_decision' }),
  ])},
  conversion: { ready: false },
});
expect(() => service.decideEnquiry(ava, enquiry.id, {
  expectedVersion: 3, outcome: 'accepted',
  reason: 'Claim meets the approved Housing Conditions intake criteria.',
}, context)).toThrowErrorMatchingObject({ code: 'READINESS_BLOCKED' });
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/server/intake/service.test.ts`

- [ ] **Step 3: Add assessment and onboarding contracts**

```ts
export const saveAssessmentSchema = z.object({
  expectedVersion: z.number().int().positive(),
  jurisdictionConfirmed: z.boolean(),
  claimantRelationship: z.enum(['tenant','former_tenant','leaseholder','other']),
  noticeSummary: z.string().trim().min(10).max(4000),
  conditionsUnresolved: z.boolean(),
  conditionStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  accessSummary: z.string().trim().max(2000),
  evidenceSummary: z.string().trim().max(4000),
  limitationReview: z.string().trim().min(10).max(2000),
  legalIssues: z.array(z.enum(['section_11','fitness','statutory','contractual'])),
  escalations: z.array(z.enum([
    'personal_injury','possession','homelessness','safeguarding',
    'urgent_injunction','critical_hazard',
  ])),
  meritsRating: z.enum(['weak','borderline','reasonable','strong']),
  proportionalityRating: z.enum(['poor','borderline','reasonable','strong']),
  decision: z.enum(['draft','proceed','decline','refer']),
  decisionReason: z.string().trim().min(10).max(2000),
});
```

`saveOnboardingSchema` requires explicit statuses for identity, client care, authority, privacy, funding, and signature; `ownerUserId`, `supervisorUserId`; tenancy type, dates, rent in minor units; vulnerability/access/safe-contact details; and `householdMembers[]`.

- [ ] **Step 4: Implement readiness as pure projections**

Return blockers with stable keys, labels, and severity. Do not hide blockers merely because an outcome is desired. `accepted` requires the latest conflict decision to be `clear` or `cleared_with_override`, an assessment decision of `proceed`, and no assessment blockers. Conversion additionally requires all six onboarding controls complete, owner/supervisor, tenancy, and no conversion blockers.

- [ ] **Step 5: Persist decisions and history atomically**

Update current `enquiries.status` with expected version and insert `enquiry_status_events`, audit, and an intake outbox event in one transaction. Terminal outcomes remain readable and cannot be edited or converted.

- [ ] **Step 6: Verify GREEN and commit**

Run: `npm test -- src/server/intake/service.test.ts src/server/intake/store.test.ts`

```bash
git add src/shared/contracts.ts src/server/intake
git commit -m "feat: govern intake assessment and onboarding"
```

---

### Task 5: Atomic conversion into a governed Housing Conditions matter

**Files:**
- Modify: `src/server/workflow/store.ts`
- Modify: `src/server/workflow/store.test.ts`
- Modify: `src/server/intake/store.ts`
- Modify: `src/server/intake/service.ts`
- Modify: `src/server/intake/service.test.ts`

**Interfaces:**
- Produces `WorkflowStore.bootstrapFromIntakeInTransaction(input)`; caller owns the surrounding transaction.
- Produces `IntakeService.convertEnquiry(user, enquiryId, { expectedVersion, idempotencyKey }, context)`.
- Returns `{ matterId, reference, workflowVersion, currentStageKey: 'evidence' }`.

- [ ] **Step 1: Write failing conversion tests**

Test readiness blocking, idempotent replay, stale version, one matter only, generated reference, contact/organisation/property reuse, matter participants, housing case, tenancy link, owner/supervisor membership, workflow pinning at `evidence`, completed checklist keys, full stage history, audit/outbox, and rollback when workflow bootstrap fails.

```ts
const converted = service.convertEnquiry(ava, enquiry.id, {
  expectedVersion: accepted.version,
  idempotencyKey: 'convert-intake-fixture-0001',
}, context);
expect(converted).toMatchObject({ currentStageKey: 'evidence' });
expect(store.getEnquiry(ava, enquiry.id)?.status).toBe('converted');
expect(workflowStore.getMatterWorkflow(ava.firmId, converted.matterId))
  .toMatchObject({ currentStage: { key: 'evidence' }, version: 4 });
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/server/intake/service.test.ts src/server/workflow/store.test.ts`

- [ ] **Step 3: Refactor workflow bootstrap without changing existing behavior**

Extract the active-definition lookup and insert operations from `instantiateMatterWorkflow`. Keep the current public method transaction-owning. Add a transaction-aware method that inserts stage history `enquiry → assessment → onboarding → evidence`, completes all required checklist keys for the first three stages, and sets instance version 4. Do not begin, commit, or roll back inside this new method.

- [ ] **Step 4: Implement one conversion transaction**

Within `BEGIN IMMEDIATE`: re-read authorised enquiry/version/readiness, reserve a matter reference, insert matter and memberships, link canonical participants, housing case, tenancy/onboarding records, bootstrap workflow, insert immutable conversion/status events, timeline, audit, and outbox, then commit. On any error, roll back every insert.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- src/server/intake/service.test.ts src/server/workflow/store.test.ts src/server/database.test.ts`

```bash
git add src/server/intake src/server/workflow/store.ts src/server/workflow/store.test.ts
git commit -m "feat: convert intake into governed matters"
```

---

### Task 6: Tenant-safe intake and converted-profile APIs

**Files:**
- Create: `src/server/intake/routes.ts`
- Create: `src/server/intake/routes.test.ts`
- Modify: `src/server/app.ts`

**Interfaces:**
- `GET /api/enquiries`
- `POST /api/enquiries`
- `GET /api/enquiries/:id`
- `PATCH /api/enquiries/:id`
- `POST /api/enquiries/:id/conflict-checks`
- `POST /api/enquiries/:id/conflict-decisions`
- `PUT /api/enquiries/:id/assessment`
- `PUT /api/enquiries/:id/onboarding`
- `POST /api/enquiries/:id/decisions`
- `POST /api/enquiries/:id/convert`
- `GET /api/matters/:id/intake-profile`

- [ ] **Step 1: Write failing route tests**

Cover valid commands, validation envelopes, finance `403`, assigned access, unassigned/cross-firm identical `404`, stale `409`, readiness `409` with blockers, idempotent conversion replay, and converted matter profile access.

```ts
expect(crossFirm.statusCode).toBe(404);
expect(unassigned.statusCode).toBe(404);
expect(crossFirm.json()).toEqual(unassigned.json());
expect(stale.json()).toMatchObject({ error: { code: 'CONFLICT' } });
expect(blocked.json()).toMatchObject({
  error: { code: 'READINESS_BLOCKED' },
  details: { blockers: expect.any(Array) },
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/server/intake/routes.test.ts`

- [ ] **Step 3: Register thin routes**

Parse every command with the shared Zod schema and delegate to `IntakeService`. Map domain errors to stable JSON envelopes. Use the existing request ID/IP audit context. Never accept a `firmId` or actor ID in a body or query.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test -- src/server/intake/routes.test.ts src/server/app.test.ts`

```bash
git add src/server/intake/routes.ts src/server/intake/routes.test.ts src/server/app.ts
git commit -m "feat: expose intake and onboarding APIs"
```

---

### Task 7: Enquiry queue and sectioned intake workspace

**Files:**
- Modify: `src/client/api.ts`
- Modify: `src/client/App.tsx`
- Modify: `src/client/App.test.tsx`
- Modify: `src/client/components/AppShell.tsx`
- Create: `src/client/pages/IntakeQueuePage.tsx`
- Create: `src/client/pages/IntakeQueuePage.test.tsx`
- Create: `src/client/pages/EnquiryPage.tsx`
- Create: `src/client/pages/EnquiryPage.test.tsx`
- Create: `src/client/components/intake/EnquiryOverview.tsx`
- Create: `src/client/components/intake/ConflictPanel.tsx`
- Create: `src/client/components/intake/AssessmentPanel.tsx`
- Create: `src/client/components/intake/OnboardingPanel.tsx`
- Create: `src/client/components/intake/DecisionPanel.tsx`
- Modify: `src/client/styles.css`

**Interfaces:**
- Routes `/intake` and `/intake/:enquiryId`.
- The primary navigation exposes `Enquiries` only when `user.permissions.canReadIntake`.
- Conversion navigates to `/matters/:matterId`.

- [ ] **Step 1: Write failing client journey tests**

Test queue loading/empty/error states, new enquiry creation, assigned access, section navigation, conflict search and decision, readiness blockers, assessment save, onboarding save, accept, conversion, conflict/validation errors, keyboard-labelled controls, and AbortController cleanup.

```tsx
render(<EnquiryPage enquiryId="enquiry-1" onConverted={onConverted} />);
expect(await screen.findByRole('heading', { name: 'Leah Benton' })).toBeVisible();
await user.click(screen.getByRole('button', { name: 'Run conflict check' }));
expect(await screen.findByText('Human decision required')).toBeVisible();
await user.click(screen.getByRole('button', { name: 'Convert to matter' }));
await waitFor(() => expect(onConverted).toHaveBeenCalledWith('matter-1'));
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/client/pages/IntakeQueuePage.test.tsx src/client/pages/EnquiryPage.test.tsx src/client/App.test.tsx`

- [ ] **Step 3: Add typed client resources and routing**

Define `EnquiryListItem`, `EnquiryDetail`, readiness, conflict, assessment, onboarding, and conversion response types in `api.ts`. Extend `Route` with queue and enquiry variants and stable push-state paths. Keep matter and dashboard routes unchanged.

- [ ] **Step 4: Build the dense queue**

Show counts for New, Assessment, Accepted/onboarding, and Urgent; filter by status/assignee; search client, property, landlord, or reference; and provide a `New enquiry` dialog. Do not expose the manual matter dialog as the normal claimant entry point.

- [ ] **Step 5: Build the sectioned enquiry workspace**

Use a compact sticky header and five clearly labelled panels: Enquiry, Conflicts, Assessment, Onboarding, Decision. Display version/readiness state, explicit save controls, error envelopes, human-decision copy, and audit-safe reasons. Disable conversion until the server says it is ready; never duplicate readiness logic as authoritative client code.

- [ ] **Step 6: Add responsive and accessible styling**

At desktop widths use a section rail plus two-column operational content; at mobile widths preserve the action/status summary first. Use semantic buttons, labels, fieldsets/legends for grouped controls, focus-visible styles, and no colour-only status meaning.

- [ ] **Step 7: Verify GREEN and commit**

Run: `npm test -- src/client/pages/IntakeQueuePage.test.tsx src/client/pages/EnquiryPage.test.tsx src/client/App.test.tsx`

```bash
git add src/client
git commit -m "feat: add claimant intake workspace"
```

---

### Task 8: Activate Matter 360 client, household, property, and tenancy sections

**Files:**
- Modify: `src/client/api.ts`
- Modify: `src/client/pages/MatterPage.tsx`
- Create: `src/client/components/matter/ClientHouseholdPanel.tsx`
- Create: `src/client/components/matter/PropertyTenancyPanel.tsx`
- Create: `src/client/components/matter/IntakeProfilePanels.test.tsx`
- Modify: `src/client/components/matter/MatterSectionRail.tsx`
- Modify: `src/client/styles.css`

**Interfaces:**
- Consumes `GET /api/matters/:id/intake-profile` only when either active section is selected.
- Preserves the existing Matter 360 summary-first load and does not reload the aggregate after simple section navigation.

- [ ] **Step 1: Write failing panel tests**

Cover converted client data, household vulnerabilities, safe contact instructions, property/landlord/tenancy facts, no-profile state for legacy matters, generic error state, and request cancellation on matter change.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/client/components/matter/IntakeProfilePanels.test.tsx`

- [ ] **Step 3: Implement independently loaded panels**

Render identity verification status without identity-image details. Put vulnerability, interpreter, accessibility, and safe-contact instructions in a prominent controlled-contact block. Display rent as GBP using integer minor units and dates as date-only values.

- [ ] **Step 4: Mark both rail sections operational**

Remove `Planned` only for Client & Household and Property & Tenancy. Leave later-program sections honestly disabled.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- src/client/components/matter/IntakeProfilePanels.test.tsx src/client/App.test.tsx`

```bash
git add src/client
git commit -m "feat: surface onboarding data in Matter 360"
```

---

### Task 9: Evaluation seed, full verification, documentation, and publication

**Files:**
- Modify: `src/server/database.ts`
- Modify: `src/server/database.test.ts`
- Modify: `README.md`

**Interfaces:**
- Seeds a synthetic accepted enquiry for Leah Benton and Civic North Homes with one onboarding control intentionally incomplete.
- Backfills Maya Clarke's converted intake profile for the existing evaluation matter.
- Seeds a separate Southbank enquiry for tenant-isolation acceptance.

- [ ] **Step 1: Write failing seed tests**

Assert idempotent counts, Leah's assigned Northstar access, funding blocker, Maya's complete matter profile, and Southbank isolation.

- [ ] **Step 2: Verify RED**

Run: `npm test -- src/server/database.test.ts`

- [ ] **Step 3: Seed through production domain methods where practical**

Use fixed synthetic IDs and dates. Leah's file should have a completed no-match conflict decision, assessment `proceed`, accepted status, tenancy/household facts, identity/client-care/authority/privacy/signature completed, and funding pending so Ava can complete one meaningful control and convert it.

- [ ] **Step 4: Run full automated verification**

Run:

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: all test files and tests pass; both TypeScript configurations pass; Vite production build exits 0; no whitespace errors.

- [ ] **Step 5: Run production HTTP acceptance**

Against a fresh temporary database and `npm start`, verify: HTML 200, Ava login, enquiry queue, Leah detail, funding save, conversion, reload at Evidence workflow version 4, generated matter profile, replay idempotency, Lewis generic 404, and finance 403. Capture only synthetic output in `/tmp`.

- [ ] **Step 6: Attempt rendered browser acceptance**

Use the available browser harness for desktop and mobile. If the environment blocks localhost rendering, record that exact environment limitation and retain the HTTP and automated client-test evidence; do not claim a screenshot was produced.

- [ ] **Step 7: Update README accurately**

Document the intake workflow, permissions, evaluation journey, API routes, and the next CMS slice: Defects and Evidence. Keep SwiftBridge deferred and preserve the no-live-client boundary.

- [ ] **Step 8: Commit, merge, and publish**

```bash
git add src/server/database.ts src/server/database.test.ts README.md
git commit -m "feat: seed claimant intake evaluation journey"
```

Run the verification-before-completion checklist again after merging into `main`, then publish the verified main tree to `Ments123/SwiftClaim` and confirm the remote commit and representative files.
