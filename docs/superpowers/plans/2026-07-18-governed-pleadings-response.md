# Governed Pleadings and Response Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tenant-safe, event-led Pleadings & responses workspace for exact statements of case, qualified response-date projections, governed amendments and human default-judgment review.

**Architecture:** Extend the TypeScript modular monolith with a focused `pleadings` domain linked to governed Proceedings. SQLite retains immutable exact versions and events; pure functions calculate qualified projections; services enforce capability, source, concurrency and idempotency rules; Fastify exposes strict commands; React lazy-loads a defendant-centric workspace.

**Tech Stack:** Node.js 24, TypeScript 7, Fastify 5, SQLite `DatabaseSync`, Zod 4, React 19, Vite 8, Vitest 4 and Testing Library.

**Implementation evidence (2026-07-18):** Tasks 1–7 were delivered as commits `160062c` through `5ee06b3`, including the complete synthetic evaluation journey. Final verification passed 74 test files / 362 tests, both strict TypeScript targets, and the production build. Vite retained separate lazy chunks for `PleadingsResponsesPanel` (6.48 kB), `PleadingsDialogs` (13.37 kB), and `ProceedingsDialogs` (36.65 kB); the initial application chunk was 487.44 kB. The scope and terminology scan found only intentional SwiftBridge exclusions, safeguard prose, and negative assertions—no SwiftBridge implementation or prohibited default-eligibility product copy.

## Global Constraints

- SwiftClaim Litigation only; do not add SwiftBridge code.
- Claimant and defendant statements share one ledger; admissions and jurisdiction challenges are recorded positions, not standalone workflows.
- `filed`, `provider_acknowledged`, `court_accepted` and `served` are always distinct states.
- A deadline is labelled `projected` or `source_date`, never presented as an authoritative legal conclusion.
- Ordinary Part 7 calculations run only from a confirmed qualifying regime and reviewed trigger facts.
- Part 8, service-out, court-directed, disputed and incomplete inputs default to a safe manual or blocked state.
- Default review outcomes are only `review_incomplete`, `blockers_recorded` or `human_review_completed`; never `eligible` or equivalent.
- Amended pleadings create immutable versions and retain exact consent, application or sealed-order authority sources.
- No autonomous pleading, signing, default request, legal advice or live court/provider integration.
- All rows and queries are firm- and matter-scoped; inaccessible resources return generic `404`.
- Every command binds an idempotency receipt to firm, matter, proceeding, route entity and validated input hash.
- Every accepted command atomically writes the legal event, security audit, matter timeline and transactional outbox record.

---

### Task 1: Contracts, capabilities and migration 10

**Files:**
- Create: `src/server/migrations/010-governed-pleadings-response.ts`
- Create: `src/server/pleadings/types.ts`
- Create: `src/server/contracts.pleadings.test.ts`
- Modify: `src/server/migrations/index.ts`
- Modify: `src/server/migrations.test.ts`
- Modify: `src/shared/contracts.ts`
- Modify: `src/server/policy.ts`
- Modify: `src/server/policy.test.ts`

**Interfaces:**
- Produces: migration version `10`; six pleading capabilities; strict schemas and inferred inputs for response tracks, statement versions/events, deadline review, amendments and default reviews.
- Consumes: `FirmRole`, existing UUID/date/idempotency helpers, proceedings/document/service/filing foreign keys and migration conventions.

- [ ] **Step 1: Write failing contract, policy and migration tests**

```ts
it('rejects an automated default eligibility result', () => {
  expect(() => completeDefaultReviewSchema.parse({
    expectedVersion: 1,
    idempotencyKey: 'default-review-001',
    outcome: 'eligible',
    reviewedAt: '2026-07-18T12:00:00.000Z',
    blockers: [],
    note: 'Checked the response record and service evidence.',
  })).toThrow();
});

it('installs immutable pleading records', () => {
  const db = createDatabase(':memory:');
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'claim_response_tracks'").get()).toBeTruthy();
  expect(() => db.prepare('DELETE FROM statement_of_case_events').run())
    .toThrow('statement of case events are append-only');
});

it('limits completed default review to solicitors and above', () => {
  expect(hasCapability(user('solicitor'), 'pleadings.review_default')).toBe(true);
  expect(hasCapability(user('paralegal'), 'pleadings.review_default')).toBe(false);
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- src/server/contracts.pleadings.test.ts src/server/migrations.test.ts src/server/policy.test.ts`
Expected: FAIL because the schemas, migration and capabilities do not exist.

- [ ] **Step 3: Define strict contracts and shared workspace DTOs**

```ts
export const procedureRegimeSchema = z.enum([
  'part_7_domestic', 'part_7_service_out', 'part_8',
  'court_directed', 'manual_review',
]);

export const defaultReviewOutcomeSchema = z.enum([
  'review_incomplete', 'blockers_recorded', 'human_review_completed',
]);

export const statementEventTypeSchema = z.enum([
  'prepared', 'approved_for_filing', 'filed', 'provider_acknowledged',
  'court_accepted', 'served', 'rejected', 'withdrawn', 'corrected',
  'superseded', 'permission_granted', 'permission_refused',
]);
```

Add strict command schemas with cross-field refinements: source-date projections require an exact source; service events require a service record; amendment authority requires the appropriate exact consent/application/order source; `signed` statement-of-truth status requires stated signatory metadata.

- [ ] **Step 4: Add and register migration 10**

Create tenant-scoped strict tables and indexes for:

```sql
claim_response_tracks; claim_response_track_events;
statements_of_case; statement_of_case_versions; statement_of_case_events;
pleading_deadline_projections; default_judgment_reviews;
default_judgment_review_items; pleadings_command_receipts;
```

Use composite firm/matter foreign keys, exact document-version/source keys, optimistic versions, append-only triggers and immutable-version triggers. Register the migration after `governedProceedingsMigration`.

- [ ] **Step 5: Add role capabilities and make focused tests GREEN**

```ts
export type Capability = ExistingCapability
  | 'pleadings.read' | 'pleadings.prepare' | 'pleadings.record_external'
  | 'pleadings.approve_claimant_statement' | 'pleadings.review_default'
  | 'pleadings.record_amendment_authority';
```

Admin and partner receive all six. Solicitor receives all six. Paralegal receives read, prepare and record external. Finance and readonly receive none.

Run the focused command from Step 2.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/contracts.ts src/server/contracts.pleadings.test.ts src/server/migrations src/server/migrations.test.ts src/server/pleadings/types.ts src/server/policy.ts src/server/policy.test.ts
git commit -m "feat: define governed pleading records"
```

---

### Task 2: Qualified deadline and event projections

**Files:**
- Create: `src/server/pleadings/deadlines.ts`
- Create: `src/server/pleadings/deadlines.test.ts`
- Create: `src/server/pleadings/projections.ts`
- Create: `src/server/pleadings/projections.test.ts`

**Interfaces:**
- Produces: `projectResponseDeadlines(input): DeadlineProjection[]`, `projectStatement(events)`, `projectResponseTrack(events)` and `projectDefaultReview(review)`.
- Consumes: enums and DTOs from `src/server/pleadings/types.ts`; reviewed ISO trigger dates only.

- [ ] **Step 1: Write failing safe-calculation tests**

```ts
it('projects 14-day acknowledgment and defence dates for reviewed domestic Part 7 service', () => {
  const result = projectResponseDeadlines({
    regime: 'part_7_domestic', serviceReviewState: 'reviewed',
    particularsServiceDate: '2026-07-01', acknowledgmentRecorded: false,
    courtSourceDate: null, extensionDate: null,
  });
  expect(result.map(({ kind, outcome, date }) => ({ kind, outcome, date }))).toEqual([
    { kind: 'acknowledgment', outcome: 'projected', date: '2026-07-15' },
    { kind: 'defence', outcome: 'projected', date: '2026-07-15' },
  ]);
});

it.each(['part_7_service_out', 'part_8', 'court_directed', 'manual_review'] as const)(
  'does not apply ordinary dates to %s', (regime) => {
    expect(projectResponseDeadlines(reviewedInput(regime))[0]?.outcome)
      .toBe('manual_court_period_required');
  },
);

it('uses 28 days for defence after acknowledgment without mutating the old projection', () => {
  const result = projectResponseDeadlines({ ...reviewedDomesticInput, acknowledgmentRecorded: true });
  expect(result.find((item) => item.kind === 'defence')?.date).toBe('2026-07-29');
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/pleadings/deadlines.test.ts src/server/pleadings/projections.test.ts`
Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement date arithmetic and safe outcomes**

```ts
export function addUtcDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
```

Return `blocked_missing_facts` for absent/unreviewed triggers, `manual_court_period_required` for exceptional regimes, `source_date` for retained court dates and new immutable `projected` rows when an acknowledgment or extension changes the result. Keep rule key, version, URL and all input facts in every result.

- [ ] **Step 4: Implement deterministic event projections**

```ts
const EVENT_ORDER: Record<StatementEventType, number> = {
  prepared: 1, approved_for_filing: 2, filed: 3,
  provider_acknowledged: 4, court_accepted: 5, served: 6,
  rejected: 7, withdrawn: 8, corrected: 9, superseded: 10,
  permission_granted: 11, permission_refused: 12,
};
```

Sort by occurred time, recorded time and ID; omit explicitly superseded events; expose filing and service positions separately. Default-review projection accepts only the three approved neutral outcomes.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- src/server/pleadings/deadlines.test.ts src/server/pleadings/projections.test.ts`
Expected: PASS.

```bash
git add src/server/pleadings/deadlines.ts src/server/pleadings/deadlines.test.ts src/server/pleadings/projections.ts src/server/pleadings/projections.test.ts
git commit -m "feat: project qualified pleading deadlines"
```

---

### Task 3: Tenant-safe persistence and workspace assembly

**Files:**
- Create: `src/server/pleadings/store.ts`
- Create: `src/server/pleadings/store.test.ts`

**Interfaces:**
- Produces: `PleadingsStore`, `getWorkspace(firmId, matterId, proceedingId)`, exact-source validators and transaction command methods.
- Consumes: migration 10 tables, projection functions, existing proceedings records, audit/timeline/outbox tables and `DatabaseSync`.

- [ ] **Step 1: Write failing isolation, immutability and atomicity tests**

```ts
it('never returns another firm response track by UUID', () => {
  const { store } = fixture();
  expect(store.getTrack(OTHER_FIRM, MATTER_ID, TRACK_ID)).toBeUndefined();
});

it('writes one receipt, event, audit, timeline and outbox record atomically', () => {
  const { store, db } = fixture();
  store.openTrack(context, openTrackInput, auditInput);
  expect(count(db, 'pleadings_command_receipts')).toBe(1);
  expect(count(db, 'claim_response_track_events')).toBe(1);
  expect(count(db, 'security_audit_events')).toBe(1);
  expect(count(db, 'matter_timeline_events')).toBe(1);
  expect(count(db, 'domain_outbox')).toBe(1);
});

it('returns the original receipt for an identical retry and conflicts on changed input', () => {
  const first = store.openTrack(context, openTrackInput, auditInput);
  expect(store.openTrack(context, openTrackInput, auditInput)).toEqual(first);
  expect(() => store.openTrack(context, { ...openTrackInput, regime: 'part_8' }, auditInput))
    .toThrow('Idempotency key already used with different input');
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/pleadings/store.test.ts`
Expected: FAIL because `PleadingsStore` does not exist.

- [ ] **Step 3: Implement scoped queries and exact-source validation**

```ts
getTrack(firmId: string, matterId: string, trackId: string): ClaimResponseTrack | undefined;
assertDocumentVersion(firmId: string, matterId: string, documentVersionId: string): void;
assertProceeding(firmId: string, matterId: string, proceedingId: string): void;
assertServiceRecord(firmId: string, matterId: string, serviceRecordId: string): void;
```

Every query includes `firm_id = ? AND matter_id = ?`. Workspace assembly groups exact versions and projections by defendant while returning available source options as labels plus IDs, never document content.

- [ ] **Step 4: Implement one transactional command primitive**

```ts
runCommand<T>(scope: CommandScope, input: unknown, write: () => T): T {
  return this.database.transaction(() => {
    const previous = this.findReceipt(scope);
    if (previous) return this.replayOrConflict(previous, input);
    const result = write();
    this.writeAuditTimelineOutboxAndReceipt(scope, input, result);
    return result;
  })();
}
```

Use the primitive for tracks, statement versions/events, deadline reviews, amendment authority and default reviews. Enforce optimistic versions in the update predicates.

- [ ] **Step 5: Assemble the defendant-centric workspace and make tests GREEN**

Run: `npm test -- src/server/pleadings/store.test.ts`
Expected: PASS, including cross-tenant, exact-source, replay/conflict and rollback tests.

- [ ] **Step 6: Commit**

```bash
git add src/server/pleadings/store.ts src/server/pleadings/store.test.ts
git commit -m "feat: persist tenant safe pleading events"
```

---

### Task 4: Authorization and command services

**Files:**
- Create: `src/server/pleadings/service.ts`
- Create: `src/server/pleadings/service.test.ts`

**Interfaces:**
- Produces: `PleadingsService` read and command methods consumed by routes.
- Consumes: `PleadingsStore`, session `RequestContext`, capability policy and validated schema inputs.

- [ ] **Step 1: Write failing capability and legal-state guard tests**

```ts
it('requires both proceedings and pleadings read capabilities', () => {
  expect(() => service.getWorkspace(readonlyContext, MATTER_ID, PROCEEDING_ID))
    .toThrow('Not found');
});

it('prevents a paralegal completing default review', () => {
  expect(() => service.completeDefaultReview(paralegalContext, MATTER_ID, REVIEW_ID, input))
    .toThrow('Forbidden');
});

it('requires exact written consent for a written-consent amendment', () => {
  expect(() => service.recordAmendmentAuthority(solicitorContext, MATTER_ID, VERSION_ID, {
    ...authorityInput, route: 'written_consent', consentDocumentVersionId: null,
  })).toThrow('Written consent source is required');
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/pleadings/service.test.ts`
Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement authorization and independent-review gates**

```ts
private require(context: RequestContext, capability: Capability): void {
  if (!hasCapability(context.user, capability)) throw new ForbiddenError();
}
```

Reads require both `proceedings.read` and `pleadings.read`. Commands require the narrow capability from the design. Claimant-statement approval rejects self-approval when the exact version's preparer is the acting user.

- [ ] **Step 4: Implement source and transition guards**

Before persistence, validate qualifying deadline facts, exact statement versions, filing/service links, amendment sources and allowed default-review outcomes. Do not infer service validity or permission requirements.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- src/server/pleadings/service.test.ts`
Expected: PASS.

```bash
git add src/server/pleadings/service.ts src/server/pleadings/service.test.ts
git commit -m "feat: govern pleading commands"
```

---

### Task 5: Fastify API and application wiring

**Files:**
- Create: `src/server/pleadings/routes.ts`
- Create: `src/server/pleadings/routes.test.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/database.ts`

**Interfaces:**
- Produces: `GET /api/matters/:matterId/proceedings/:proceedingId/pleadings` and narrow `POST` command routes.
- Consumes: strict schemas, authenticated request context and `PleadingsService`.

- [ ] **Step 1: Write failing HTTP contract tests**

```ts
it('returns the pleading workspace for an authorized solicitor', async () => {
  const response = await app.inject({
    method: 'GET', url: `/api/matters/${MATTER_ID}/proceedings/${PROCEEDING_ID}/pleadings`,
    headers: sessionHeaders('solicitor'),
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ proceedingId: PROCEEDING_ID, tracks: expect.any(Array) });
});

it('rejects unknown command properties', async () => {
  const response = await command('tracks', { ...validTrack, legalConclusion: 'valid service' });
  expect(response.statusCode).toBe(400);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/pleadings/routes.test.ts`
Expected: FAIL with route not found.

- [ ] **Step 3: Register read and command routes**

Expose commands for opening/updating a track, adding a statement version, recording a statement event, reviewing a deadline, recording amendment authority, creating a default review and completing a default review. Parse body with the exact strict schema, map not-found/forbidden/conflict consistently, and return `201` for new resources or `200` for events/replays.

- [ ] **Step 4: Wire store/service once per application**

Instantiate `PleadingsStore` from the application database, then `PleadingsService`, and register routes under the authenticated API scope.

- [ ] **Step 5: Run route and regression tests, then commit**

Run: `npm test -- src/server/pleadings/routes.test.ts src/server/app.test.ts src/server/database.test.ts`
Expected: PASS.

```bash
git add src/server/pleadings/routes.ts src/server/pleadings/routes.test.ts src/server/app.ts src/server/database.ts
git commit -m "feat: expose governed pleading api"
```

---

### Task 6: Synthetic evaluation journey

**Files:**
- Create: `src/server/pleadings/seed.test.ts`
- Modify: `src/server/database.ts`

**Interfaces:**
- Produces: deterministic pleading seed records for the existing Maya evaluation matter.
- Consumes: known synthetic firm, matter, party, proceeding, document, filing and service IDs.

- [ ] **Step 1: Write a failing seed journey test**

```ts
it('seeds the qualified Maya pleading journey without a default eligibility conclusion', () => {
  const workspace = pleadingsStore.getWorkspace(FIRM_ID, MAYA_MATTER_ID, PROCEEDING_ID);
  expect(workspace.tracks[0]).toMatchObject({ regime: 'part_7_domestic' });
  expect(workspace.tracks[0].deadlines).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'defence', outcome: 'projected' }),
  ]));
  expect(JSON.stringify(workspace)).not.toMatch(/eligible|entitled|safe to enter/i);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/pleadings/seed.test.ts`
Expected: FAIL because no pleading journey is seeded.

- [ ] **Step 3: Seed deterministic exact-source records**

Seed one reviewed domestic Part 7 response track, acknowledgment, defence with counterclaim, distinct filing/service events, one permission-backed amendment and one default review blocked by an unresolved Part 12 question. Reuse only synthetic sources and stable UUIDs. Make inserts idempotent with `ON CONFLICT DO NOTHING`.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/server/pleadings/seed.test.ts src/server/database.test.ts`
Expected: PASS on both fresh and repeated database initialization.

```bash
git add src/server/database.ts src/server/pleadings/seed.test.ts
git commit -m "feat: seed pleading response journey"
```

---

### Task 7: Defendant-centric React workspace

**Files:**
- Create: `src/client/components/matter/PleadingsResponsesPanel.tsx`
- Create: `src/client/components/matter/PleadingsResponsesPanel.test.tsx`
- Create: `src/client/components/matter/PleadingsDialogs.tsx`
- Modify: `src/client/components/matter/ProceedingsPanel.tsx`
- Modify: `src/client/components/matter/ProceedingsPanel.test.tsx`
- Modify: `src/client/api.ts`
- Modify: `src/client/styles.css`

**Interfaces:**
- Produces: lazy-loaded Pleadings & responses subview and permission-gated command dialogs.
- Consumes: pleading workspace DTO, API methods, existing `Dialog`, Proceedings tabs, labels and responsive styles.

- [ ] **Step 1: Write failing rendering and terminology tests**

```tsx
it('shows qualified dates and distinct filing and service states', async () => {
  render(<PleadingsResponsesPanel workspace={fixtureWorkspace} capabilities={solicitorCapabilities} />);
  expect(screen.getByText('Projected from reviewed service facts')).toBeInTheDocument();
  expect(screen.getByText('Court accepted')).toBeInTheDocument();
  expect(screen.getByText('Not yet served')).toBeInTheDocument();
});

it('never presents default review as eligibility', () => {
  render(<PleadingsResponsesPanel workspace={fixtureWorkspace} capabilities={solicitorCapabilities} />);
  expect(screen.queryByText(/eligible|entitled|safe to enter/i)).not.toBeInTheDocument();
  expect(screen.getByText('Blockers recorded')).toBeInTheDocument();
});

it('hides default completion from a paralegal', () => {
  render(<PleadingsResponsesPanel workspace={fixtureWorkspace} capabilities={paralegalCapabilities} />);
  expect(screen.queryByRole('button', { name: 'Complete human review' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- src/client/components/matter/PleadingsResponsesPanel.test.tsx src/client/components/matter/ProceedingsPanel.test.tsx`
Expected: FAIL because the subview does not exist.

- [ ] **Step 3: Add typed API methods and lazy loading**

```ts
const PleadingsResponsesPanel = lazy(() =>
  import('./PleadingsResponsesPanel').then((module) => ({ default: module.PleadingsResponsesPanel })),
);
const PleadingsDialogs = lazy(() =>
  import('./PleadingsDialogs').then((module) => ({ default: module.PleadingsDialogs })),
);
```

Fetch the workspace only when the subview is selected. Add typed command functions using the existing authenticated `request` helper.

- [ ] **Step 4: Implement cards, history and exact legal-state copy**

Group by defendant. Show current response position, nearest qualified date and basis, exact active versions, acknowledgment/defence/counterclaim status, amendment lineage, review blockers and separate filing/service badges. Provide accessible empty, loading, error and retry states.

- [ ] **Step 5: Implement permission-gated command dialogs**

Dialogs cover track creation, statement version/event, deadline review, amendment authority and default review. Source selectors display human-readable labels and IDs. Submit buttons remain disabled until mandatory exact sources and review notes are present.

- [ ] **Step 6: Add responsive styles and make tests GREEN**

At desktop widths use a summary rail plus detail area; below the existing mobile breakpoint stack cards and keep controls full-width. Preserve visible focus, semantic headings, labels and status text independent of color.

Run the focused command from Step 2.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/client/api.ts src/client/components/matter/PleadingsResponsesPanel.tsx src/client/components/matter/PleadingsResponsesPanel.test.tsx src/client/components/matter/PleadingsDialogs.tsx src/client/components/matter/ProceedingsPanel.tsx src/client/components/matter/ProceedingsPanel.test.tsx src/client/styles.css
git commit -m "feat: add pleadings response workspace"
```

---

### Task 8: Full verification and release evidence

**Files:**
- Modify: `docs/superpowers/plans/2026-07-18-governed-pleadings-response.md`

**Interfaces:**
- Produces: verified milestone evidence and a clean publishable branch.
- Consumes: all prior tasks.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`
Expected: every test file and test passes with zero unhandled errors.

- [ ] **Step 2: Run both strict TypeScript targets**

Run: `npm run typecheck`
Expected: exit code `0` with no diagnostics.

- [ ] **Step 3: Build the production application**

Run: `npm run build`
Expected: server compilation and Vite production build succeed; pleadings dialogs/panel remain outside the initial application chunk.

- [ ] **Step 4: Inspect scope and forbidden terminology**

Run: `rg -n "SwiftBridge|eligible for default|entitled to default|safe to enter" src docs/superpowers/specs/2026-07-18-governed-pleadings-response-design.md`
Expected: no new SwiftBridge code and no forbidden product copy; references in explicit safeguards/tests are reviewed manually.

Run: `git diff --check && git status --short`
Expected: no whitespace errors and only the intended plan evidence edit remains.

- [ ] **Step 5: Record exact evidence and commit**

Add the test-file/test count, typecheck result, build result and chunk evidence beneath the plan header.

```bash
git add docs/superpowers/plans/2026-07-18-governed-pleadings-response.md
git commit -m "docs: record pleading milestone verification"
```

- [ ] **Step 6: Review and publish**

Use `superpowers:requesting-code-review`, fix any concrete findings, rerun affected checks, then use `superpowers:verification-before-completion`. Publish the exact verified tree to GitHub, open a pull request, merge it into `main`, and report the PR and merge commit.
