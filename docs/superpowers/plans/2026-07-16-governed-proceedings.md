# Governed Proceedings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an evaluation-safe Proceedings control plane for issue authority, filings, service, applications, sealed orders, directions, hearings and objective workflow readiness.

**Architecture:** Add a bounded `proceedings` domain to the TypeScript modular monolith. SQLite stores tenant-scoped immutable legal events and exact document-version references; pure functions project operational state; the service layer enforces capability, exact-version and idempotency rules; Fastify exposes strict commands; React lazy-loads a responsive Matter 360 workspace.

**Tech Stack:** Node.js 24, TypeScript 7, Fastify 5, SQLite `DatabaseSync`, Zod 4, React 19, Vite 8, Vitest 4 and Testing Library.

**Implementation evidence (18 July 2026):** The governed domain, migration, projections, storage, service gates, readiness, API, evaluation seed and responsive five-view Matter 360 workspace are implemented. The API and permission-gated UI are command-complete for authority, filings, service, applications, orders, directions, hearings and their distinct verified events. Full verification passed with 66 test files / 314 tests, both strict TypeScript targets and the Vite production build; command dialogs are emitted as a separate lazy chunk.

## Global Constraints

- SwiftClaim Litigation only; do not add SwiftBridge code.
- No live HMCTS, CE-File, MyHMCTS, payment, filing or service integration.
- A submission or acknowledgement is never labelled accepted or issued.
- A completed service step is never labelled valid service without a retained human review.
- Draft or agreed orders are never labelled sealed orders.
- `performance_asserted` never means a court direction is satisfied.
- Court directions can be waived only by a later retained sealed order.
- Overdue is a time comparison and never an assertion that a sanction applies.
- All legal events, source links, receipts and command receipts are immutable or append-only.
- Every row and query is firm- and matter-scoped; inaccessible resources return generic `404`.
- Every command binds its idempotency receipt to firm, matter, route entity and validated input hash.
- No AI drafting, extraction or legal conclusion is included in this milestone.

---

### Task 1: Canonical contracts, capabilities and migration 9

**Files:**
- Create: `src/server/migrations/009-governed-proceedings.ts`
- Create: `src/server/proceedings/types.ts`
- Create: `src/server/contracts.proceedings.test.ts`
- Modify: `src/server/migrations/index.ts`
- Modify: `src/server/migrations.test.ts`
- Modify: `src/shared/contracts.ts`
- Modify: `src/server/policy.ts`
- Modify: `src/server/policy.test.ts`

**Interfaces:**
- Produces: all strict proceedings command schemas, `ProceedingState`, `FilingState`, `ServiceState`, `DirectionState`, `HearingState`, migration version `9`, and eight proceedings capabilities.
- Consumes: existing `FirmRole`, `Migration`, matter/document/user foreign keys, audit/domain/outbox conventions and `defineMigration`.

- [ ] **Step 1: Write failing contract, migration and policy tests**

```ts
it('rejects an issued event without sealed claim form, court and case number', () => {
  expect(() => recordProceedingEventSchema.parse({
    eventType: 'issued', expectedVersion: 2, idempotencyKey: 'issue-event-001',
    occurredAt: '2026-07-16T10:00:00.000Z', note: 'Court issued the claim.',
    sourceDocumentVersionId: null, courtName: '', caseNumber: '',
  })).toThrow();
});

it('installs append-only proceedings records', () => {
  const db = createDatabase(':memory:');
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'court_proceedings'").get()).toBeTruthy();
  expect(() => db.prepare('DELETE FROM court_proceeding_events').run())
    .toThrow('court proceeding events are append-only');
});

it('keeps issue approval and external court acts separate', () => {
  expect(hasCapability(user('partner'), 'proceedings.approve_issue')).toBe(true);
  expect(hasCapability(user('solicitor'), 'proceedings.record_external')).toBe(true);
  expect(hasCapability(user('paralegal'), 'proceedings.record_external')).toBe(false);
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- src/server/contracts.proceedings.test.ts src/server/migrations.test.ts src/server/policy.test.ts`
Expected: FAIL because proceedings contracts, tables and capabilities do not exist.

- [ ] **Step 3: Add strict command contracts and domain state types**

```ts
export const createProceedingSchema = z.object({
  idempotencyKey: commandKeySchema,
  procedureType: z.enum(['part7', 'part8']),
  jurisdiction: z.enum(['england_wales']),
  courtName: z.string().trim().min(2).max(300),
  courtCode: z.string().trim().max(80).nullable(),
  hearingCentre: z.string().trim().max(300).nullable(),
}).strict();

export const recordProceedingEventSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: commandKeySchema,
  eventType: proceedingEventTypeSchema,
  occurredAt: z.string().datetime({ offset: true }),
  note: z.string().trim().min(10).max(4_000),
  sourceDocumentVersionId: z.string().uuid().nullable(),
  courtName: z.string().trim().max(300).default(''),
  caseNumber: z.string().trim().max(120).default(''),
}).strict().superRefine(requireIssuedSource);
```

Define complete schemas for authority versions, filings and filing events, service records and events, applications and events, orders, directions and direction events, hearings and hearing events. Export every `z.infer` input type. Cross-field refinements enforce the design distinctions.

- [ ] **Step 4: Add migration 9 and register it**

Create strict tenant-scoped tables:

```sql
court_proceedings; proceeding_authority_versions; court_proceeding_events;
court_documents; court_filings; court_filing_documents; court_filing_events;
court_service_records; court_service_events; court_applications;
court_application_events; court_orders; court_directions;
court_direction_events; court_hearings; court_hearing_events;
proceedings_command_receipts;
```

Use composite firm/matter foreign keys, document-version foreign keys, query indexes, unique command keys, immutability triggers and append-only delete/update triggers. Register `governedProceedingsMigration` after migration 8.

- [ ] **Step 5: Add role capabilities and make focused tests GREEN**

```ts
export type Capability = ExistingCapability
  | 'proceedings.read' | 'proceedings.prepare'
  | 'proceedings.approve_issue' | 'proceedings.record_external'
  | 'proceedings.manage_directions' | 'proceedings.manage_hearings'
  | 'proceedings.record_order' | 'proceedings.record_relief';
```

Run the focused command from Step 2.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/contracts.ts src/server/contracts.proceedings.test.ts src/server/migrations src/server/migrations.test.ts src/server/proceedings/types.ts src/server/policy.ts src/server/policy.test.ts
git commit -m "feat: define governed proceedings records"
```

---

### Task 2: Deterministic event projections

**Files:**
- Create: `src/server/proceedings/projections.ts`
- Create: `src/server/proceedings/projections.test.ts`

**Interfaces:**
- Produces: `projectProceeding`, `projectFiling`, `projectService`, `projectDirection`, `projectHearing`.
- Consumes: state unions from `src/server/proceedings/types.ts` and timestamped immutable event DTOs.

- [ ] **Step 1: Write failing projection tests**

```ts
it('does not project issue from a submitted request', () => {
  expect(projectProceeding([{ id: '1', eventType: 'issue_request_submitted', occurredAt: ISO, recordedAt: ISO }]).state)
    .toBe('submitted');
});

it('keeps performance assertion distinct from satisfaction', () => {
  const result = projectDirection([
    directionEvent('created'), directionEvent('performance_asserted'),
  ], '2026-07-20T00:00:00.000Z', '2026-07-18T16:00:00.000Z');
  expect(result.state).toBe('performance_asserted');
});

it('treats a stay as controlling until a later resume', () => {
  expect(projectDirection([directionEvent('created'), directionEvent('stayed')], ISO, null).state)
    .toBe('stayed');
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/proceedings/projections.test.ts`
Expected: FAIL because the projection module does not exist.

- [ ] **Step 3: Implement ordered, correction-aware projections**

```ts
function ordered<T extends ProjectionEvent>(events: readonly T[]): T[] {
  const superseded = new Set(events.flatMap((event) => event.supersedesEventId ? [event.supersedesEventId] : []));
  return events.filter((event) => !superseded.has(event.id))
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
}
```

Implement explicit transition reducers. `projectDirection` applies due-soon/overdue only while operationally open and returns flags separately from legal conclusions.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/server/proceedings/projections.test.ts`
Expected: PASS.

```bash
git add src/server/proceedings/projections.ts src/server/proceedings/projections.test.ts
git commit -m "feat: project immutable proceedings events"
```

---

### Task 3: Tenant-safe persistence and workspace assembly

**Files:**
- Create: `src/server/proceedings/store.ts`
- Create: `src/server/proceedings/store.test.ts`

**Interfaces:**
- Produces: `ProceedingsStore`, transaction command methods, `getWorkspace(firmId, matterId)` and source validators.
- Consumes: migration 9 tables, projection functions, existing audit/timeline/domain/outbox tables and `DatabaseSync`.

- [ ] **Step 1: Write failing store tests**

```ts
it('never returns another firm proceeding by UUID', () => {
  const store = fixture().store;
  expect(store.getProceeding(SOUTHBANK_FIRM, NORTHSTAR_MATTER, PROCEEDING_ID)).toBeUndefined();
});

it('writes a command receipt, legal event, audit and outbox atomically', () => {
  const { store, db } = fixture();
  store.createProceeding(ctx, input, audit);
  expect(count(db, 'proceedings_command_receipts')).toBe(1);
  expect(count(db, 'audit_events')).toBeGreaterThan(0);
  expect(count(db, 'integration_outbox')).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/proceedings/store.test.ts`
Expected: FAIL because `ProceedingsStore` does not exist.

- [ ] **Step 3: Implement focused SQL methods and transactions**

```ts
getProceeding(firmId: string, matterId: string, proceedingId: string) {
  return this.database.prepare(`SELECT * FROM court_proceedings
    WHERE firm_id = ? AND matter_id = ? AND id = ?`).get(firmId, matterId, proceedingId);
}
```

Keep SQL tenant predicates in every method. Build workspace queries in bounded helpers for authority, case events, filings, service, applications, orders, directions and hearings. Write mutations through one `transactionalCommand` helper that persists the idempotency response only after all legal and operational records succeed.

- [ ] **Step 4: Verify replay and rollback behavior**

Add tests proving identical replay returns the stored response, conflicting reuse throws, and a failed source foreign key leaves no event/audit/outbox row.

Run: `npm test -- src/server/proceedings/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/proceedings/store.ts src/server/proceedings/store.test.ts
git commit -m "feat: persist tenant-safe proceedings workspace"
```

---

### Task 4: Governance service and exact-version gates

**Files:**
- Create: `src/server/proceedings/service.ts`
- Create: `src/server/proceedings/service.test.ts`

**Interfaces:**
- Produces: `ProceedingsService`, `ProceedingsServiceError`, every command method used by routes and `getWorkspace`.
- Consumes: `ProceedingsStore`, policy capabilities, strict inputs and exact document/source validators.

- [ ] **Step 1: Write failing governance tests**

```ts
it('refuses issue where authority names an older claim form version', () => {
  expect(() => service.recordProceedingEvent(solicitor, matterId, proceedingId, issuedWithNewVersion, audit))
    .toThrowError(expect.objectContaining({ code: 'AUTHORITY_VERSION_MISMATCH' }));
});

it('refuses self-approval under the evaluation independent-review policy', () => {
  expect(() => service.createAuthorityVersion(solicitor, matterId, proceedingId, selfApproved, audit))
    .toThrowError(expect.objectContaining({ code: 'INDEPENDENT_REVIEW_REQUIRED' }));
});

it('requires evidence before satisfying a direction', () => {
  expect(() => service.recordDirectionEvent(solicitor, matterId, proceedingId, directionId, satisfiedWithoutEvidence, audit))
    .toThrowError(expect.objectContaining({ code: 'EVIDENCE_REQUIRED' }));
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/proceedings/service.test.ts`
Expected: FAIL because the governance service does not exist.

- [ ] **Step 3: Implement capability and invariant guards**

```ts
private require(user: SessionUser, capability: Capability): void {
  if (!hasCapability(user, capability)) throw new ProceedingsServiceError('FORBIDDEN', 'Action unavailable.');
}

private requireIssuedSource(input: RecordProceedingEventInput, authority: AuthorityRecord): void {
  if (input.sourceDocumentVersionId !== authority.claimFormVersionId)
    throw new ProceedingsServiceError('AUTHORITY_VERSION_MISMATCH', 'Issue authority does not cover this exact claim form.');
}
```

Implement generic `404`, optimistic version conflict, idempotency binding, independent issue review, exact document authority, submitted/accepted/issued separation, reviewed service provenance, sealed order checks, evidence-backed direction satisfaction and sealed-order-only waiver.

- [ ] **Step 4: Run service and policy tests**

Run: `npm test -- src/server/proceedings/service.test.ts src/server/policy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/proceedings/service.ts src/server/proceedings/service.test.ts
git commit -m "feat: govern court actions and compliance"
```

---

### Task 5: Workflow readiness and source-backed court dates

**Files:**
- Create: `src/server/proceedings/readiness.ts`
- Create: `src/server/proceedings/readiness.test.ts`
- Modify: `src/server/workflow/service.ts`
- Modify: `src/server/workflow/service.test.ts`
- Modify: `src/server/workflow/store.ts`
- Modify: `src/server/workflow/types.ts`

**Interfaces:**
- Produces: `DatabaseProceedingsReadiness`, proceedings readiness provider and objective `court_authority_recorded`/settlement transition blockers.
- Consumes: current approved authority, issued projection, direction projections, disposal review and existing workflow override behavior.

- [ ] **Step 1: Write failing readiness tests**

```ts
it('does not satisfy court authority with a stale document version', () => {
  expect(readiness.getProceedingsReadiness(FIRM, MATTER, 'negotiation').controls)
    .toContainEqual(expect.objectContaining({ key: 'court_authority_recorded', eligible: false }));
});

it('keeps an overdue direction visible after a workflow override', () => {
  expect(service.transition(partner, commandWithOverride, audit).risks)
    .toContainEqual(expect.objectContaining({ key: expect.stringContaining('court_direction_open') }));
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/proceedings/readiness.test.ts src/server/workflow/service.test.ts`
Expected: FAIL because proceedings readiness is not wired.

- [ ] **Step 3: Implement objective readiness**

```ts
export interface ProceedingsReadinessProvider {
  getProceedingsReadiness(firmId: string, matterId: string, stageKey: 'negotiation' | 'proceedings'):
    { controls: ReadinessControl[]; progressionBlockers: WorkflowBlocker[] };
}
```

Negotiation-to-Proceedings requires current exact approved issue authority. Proceedings-to-Settlement requires verified issue, no critical operative direction, and human-reviewed disposal/settlement procedure. Preserve override capability without suppressing risks.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/server/proceedings/readiness.test.ts src/server/workflow/service.test.ts`
Expected: PASS.

```bash
git add src/server/proceedings/readiness.ts src/server/proceedings/readiness.test.ts src/server/workflow
git commit -m "feat: enforce proceedings workflow readiness"
```

---

### Task 6: Fastify routes and application composition

**Files:**
- Create: `src/server/proceedings/routes.ts`
- Create: `src/server/proceedings/routes.test.ts`
- Modify: `src/server/app.ts`

**Interfaces:**
- Produces: `proceedingsRoutes` and the API boundary listed in the design.
- Consumes: `ProceedingsService`, shared schemas, authenticated user and audit context.

- [ ] **Step 1: Write failing route tests**

```ts
it('returns a generic 404 for a cross-tenant proceeding UUID', async () => {
  const response = await app.inject({ method: 'POST', url: southbankUrl(NORTHSTAR_PROCEEDING), payload: event });
  expect(response.statusCode).toBe(404);
  expect(response.json().error.code).toBe('NOT_FOUND');
});

it('returns the original result for an identical retry', async () => {
  const first = await app.inject(issueRequest);
  const second = await app.inject(issueRequest);
  expect(second.json()).toEqual(first.json());
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/proceedings/routes.test.ts`
Expected: FAIL because routes are not registered.

- [ ] **Step 3: Implement schema-first routes and error mapping**

```ts
function parseCommand<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new InvalidProceedingsCommand(result.error);
  return result.data;
}
```

Register all routes from the design. Map invalid input to `400`, forbidden to `403`, inaccessible source to `404`, optimistic/idempotency conflicts to `409`, and created resources to `201`.

- [ ] **Step 4: Compose store, service, readiness and routes in `buildApp`**

Instantiate `ProceedingsStore` from the app database, pass `ProceedingsService` into routes, and provide `DatabaseProceedingsReadiness` to `WorkflowService`.

- [ ] **Step 5: Run API regression and commit**

Run: `npm test -- src/server/proceedings/routes.test.ts src/server/app.test.ts`
Expected: PASS.

```bash
git add src/server/proceedings/routes.ts src/server/proceedings/routes.test.ts src/server/app.ts
git commit -m "feat: expose governed proceedings commands"
```

---

### Task 7: Evaluation journey and replay safety

**Files:**
- Modify: `src/server/database.ts`
- Modify: `src/server/database.test.ts`
- Modify: `src/server/index.ts`
- Create: `src/server/proceedings/seed.test.ts`

**Interfaces:**
- Produces: `seedProceedingsEvaluation(database)` and the Maya proceedings journey.
- Consumes: existing synthetic users, Maya matter, document versions, negotiation state and proceedings service/store invariants.

- [ ] **Step 1: Write failing seed tests**

```ts
it('seeds the Maya proceedings journey exactly once', () => {
  seedProceedingsEvaluation(db); seedProceedingsEvaluation(db);
  expect(count(db, 'court_proceedings')).toBe(1);
  expect(countWhere(db, 'court_proceeding_events', "event_type = 'issued'")).toBe(1);
});

it('keeps expert performance assertion unsatisfied', () => {
  const direction = workspace(db).directions.find((item) => item.category === 'expert_evidence');
  expect(direction?.projection.state).toBe('performance_asserted');
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/proceedings/seed.test.ts`
Expected: FAIL because the seed does not exist.

- [ ] **Step 3: Add deterministic synthetic source versions and events**

Seed exact claim form, particulars, sealed claim form, service evidence, defence, directions questionnaire, sealed directions order and listing notice. Seed authority, issue, service, filings, disclosure satisfaction, due-soon witness direction, performance-asserted expert direction and listed hearing. Use fixed UUIDs and insert guards.

- [ ] **Step 4: Wire startup and verify replay**

```ts
if (shouldSeed) {
  // existing seeds
  seedProceedingsEvaluation(database);
}
```

Run: `npm test -- src/server/proceedings/seed.test.ts src/server/database.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/database.ts src/server/database.test.ts src/server/index.ts src/server/proceedings/seed.test.ts
git commit -m "feat: seed governed proceedings evaluation"
```

---

### Task 8: Matter 360 Proceedings workspace

**Files:**
- Create: `src/client/components/matter/ProceedingsPanel.tsx`
- Create: `src/client/components/matter/ProceedingsPanel.test.tsx`
- Create: `src/client/components/matter/ProceedingsDialogs.tsx`
- Modify: `src/client/api.ts`
- Modify: `src/client/components/matter/MatterSectionRail.tsx`
- Modify: `src/client/pages/MatterPage.tsx`
- Modify: `src/client/styles.css`

**Interfaces:**
- Produces: typed `ProceedingsWorkspace`, lazy loading, five-tab workspace and governed command dialogs.
- Consumes: proceedings HTTP routes, existing `Dialog`, Matter 360 rail and responsive style conventions.

- [ ] **Step 1: Write failing UI tests**

```tsx
it('distinguishes submitted, issued, service-reviewed and direction states', () => {
  render(<ProceedingsPanel matterId={MATTER} workspace={fixture} onRefresh={vi.fn()} />);
  expect(screen.getByText('Issued')).toBeVisible();
  expect(screen.getByText('Service reviewed')).toBeVisible();
  expect(screen.getByText('Performance asserted — evidence not accepted')).toBeVisible();
});

it('keeps urgent court work visible on a narrow workspace', () => {
  render(<ProceedingsPanel matterId={MATTER} workspace={fixture} onRefresh={vi.fn()} />);
  expect(screen.getByRole('heading', { name: /next court date/i })).toBeVisible();
  expect(screen.getByText(/overdue direction/i)).toBeVisible();
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- src/client/components/matter/ProceedingsPanel.test.tsx`
Expected: FAIL because the panel does not exist.

- [ ] **Step 3: Add complete workspace DTOs and request helpers**

```ts
export interface ProceedingsWorkspace {
  proceeding: CourtProceeding | null;
  authority: ProceedingAuthority | null;
  filings: CourtFiling[];
  services: CourtServiceRecord[];
  applications: CourtApplication[];
  orders: CourtOrder[];
  directions: CourtDirection[];
  hearings: CourtHearing[];
  risks: ProceedingsRisk[];
  permissions: ProceedingsPermissions;
}
```

Add typed command helpers with `jsonBody`, preserving server validation errors.

- [ ] **Step 4: Implement the five-tab panel and dialogs**

Render Case, Filings & service, Directions, Applications and Hearings & orders. Put nearest court date, issue/service risk and overdue directions in the header. Use explicit labels for every critical state distinction. Gate buttons using server permissions.

- [ ] **Step 5: Activate the rail and lazy loading**

Set the Proceedings rail item `available: true`. Add state, loading/error handling, abort-safe lazy request, count and panel rendering in `MatterPage`.

- [ ] **Step 6: Add responsive styles and run UI tests**

Use existing design tokens. At `max-width: 760px`, stack summary cards, make tabs horizontally scrollable, and keep the critical summary before detailed chronology.

Run: `npm test -- src/client/components/matter/ProceedingsPanel.test.tsx src/client/components/matter/OperationalOverview.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/client/api.ts src/client/components/matter/ProceedingsPanel.tsx src/client/components/matter/ProceedingsPanel.test.tsx src/client/components/matter/ProceedingsDialogs.tsx src/client/components/matter/MatterSectionRail.tsx src/client/pages/MatterPage.tsx src/client/styles.css
git commit -m "feat: add Matter 360 proceedings workspace"
```

---

### Task 9: Documentation, full verification and publication

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-16-governed-proceedings.md`

**Interfaces:**
- Produces: accurate product boundary, API list, evaluation guide and a verified publishable branch.
- Consumes: all completed proceedings capabilities and test evidence.

- [ ] **Step 1: Update README capability and evaluation sections**

Document the active Proceedings rail, legal-state distinctions, evaluation-only boundary, new API routes, migration 9, Maya journey and next milestone. Do not claim live court integration or autonomous legal conclusions.

- [ ] **Step 2: Run focused security checks**

```bash
npm test -- src/server/proceedings src/server/policy.test.ts src/server/workflow/service.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 3: Run complete verification**

```bash
npm test
npm run typecheck
npm run build
git diff --check origin/main...HEAD
```

Expected: all tests pass, both TypeScript configurations pass, production build succeeds and diff check is empty.

- [ ] **Step 4: Update completed plan checkboxes and commit docs**

```bash
git add README.md docs/superpowers/plans/2026-07-16-governed-proceedings.md
git commit -m "docs: document governed proceedings workspace"
```

- [ ] **Step 5: Review and publish**

Perform an inline security and correctness review of the complete diff, fix findings test-first, rerun Step 3, publish `feat/proceedings`, open a pull request with the exact test evidence and merge only when the remote tree matches the verified local tree.
