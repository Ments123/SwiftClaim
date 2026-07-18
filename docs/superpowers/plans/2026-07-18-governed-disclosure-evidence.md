# Governed Disclosure and Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build tenant-safe exact-document disclosure review, provisional AI assistance, human privilege decisions, immutable disclosure lists, redaction lineage and inspection control.

**Architecture:** Add a bounded `disclosure` domain beside documents, evidence and proceedings. Migration 11 retains immutable decisions and events; pure projections apply privilege precedence; the service enforces capabilities and narrow Fastify commands feed a lazy Matter 360 workspace.

**Tech Stack:** Node.js 24, TypeScript 7, Fastify 5, SQLite `DatabaseSync`, Zod 4, React 19, Vite 8, Vitest 4 and Testing Library.

## Implementation Evidence — 2026-07-19

- Full test suite: 82 files and 392 tests passed.
- TypeScript verification: `npm run typecheck` passed.
- Production build: `npm run build` passed.
- Disclosure UI remains lazy-loaded: `DisclosurePanel` 5.83 kB (1.98 kB gzip) and `DisclosureDialogs` 4.99 kB (1.62 kB gzip).
- Guardrail terminology scan found only deliberate specification exclusions, safeguards and a negative route-test title; no prohibited product copy was introduced.

## Global Constraints

- SwiftClaim Litigation only; no SwiftBridge or Proclaim migration implementation.
- An exact immutable document version is the review unit; later versions require fresh review.
- AI output is provisional, provenance-bearing and labelled `AI suggestion — human review required`.
- AI never finalises relevance, privilege, disclosure, redaction, list generation, service or inspection.
- Restricted material is excluded from ordinary search, counts, summaries, exports and general AI context.
- Disclosable, listed, served, received, inspection requested, provided and completed remain distinct facts.
- Only partner/admin may record privilege waiver; solicitor or above approves decisions, redactions and lists.
- Redaction links exact source/redacted versions and never overwrites the source.
- Every command is firm/matter scoped, strict, idempotent, concurrency protected and atomically audited/outboxed.
- Inaccessible records return generic `404`; sensitive operational metadata never contains document content.

---

### Task 1: Contracts, capabilities and migration 11

**Files:**
- Create: `src/server/migrations/011-governed-disclosure-evidence.ts`
- Create: `src/server/disclosure/types.ts`
- Create: `src/server/contracts.disclosure.test.ts`
- Modify: `src/server/migrations/index.ts`
- Modify: `src/server/migrations.test.ts`
- Modify: `src/shared/contracts.ts`
- Modify: `src/server/policy.ts`
- Modify: `src/server/policy.test.ts`

**Interfaces:**
- Produces: migration 11, eight capabilities, strict command schemas and inferred types.
- Consumes: existing UUID/date/idempotency helpers and matter/proceeding/document-version conventions.

- [ ] **Step 1: Write failing contracts, policy and migration tests**

```ts
it('rejects a final AI disclosure decision', () => {
  expect(() => createDisclosureAiSuggestionSchema.parse({
    idempotencyKey: 'ai-suggestion-001', relevance: 'likely_relevant',
    privilegeWarning: 'possible', finalDecision: 'disclose',
    rationale: 'Matches repair issues.', model: 'evaluation-local-v1',
    policyVersion: 'disclosure-v1', sourceHash: 'a'.repeat(64),
    citedSpans: ['repair chronology'],
  })).toThrow();
});

it('installs append-only disclosure decisions', () => {
  const db = createDatabase(':memory:');
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'disclosure_reviews'").get()).toBeTruthy();
  expect(() => db.prepare('DELETE FROM disclosure_decisions').run())
    .toThrow('disclosure decisions are append-only');
});

it('reserves privilege waiver for partner and admin', () => {
  expect(hasCapability(user('partner'), 'disclosure.waive_privilege')).toBe(true);
  expect(hasCapability(user('solicitor'), 'disclosure.waive_privilege')).toBe(false);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/contracts.disclosure.test.ts src/server/migrations.test.ts src/server/policy.test.ts`

Expected: FAIL because schemas, migration and capabilities are absent.

- [ ] **Step 3: Define strict schemas and DTOs**

```ts
export const disclosureDecisionSchema = z.enum([
  'disclose', 'withhold_privilege', 'withhold_not_relevant',
  'withhold_other', 'duplicate_only', 'review_required',
]);
export const privilegeOutcomeSchema = z.enum([
  'restricted', 'not_privileged', 'further_review', 'waived',
]);
export const createDisclosureAiSuggestionSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  relevance: z.enum(['likely_relevant', 'likely_not_relevant', 'uncertain']),
  privilegeWarning: z.enum(['none', 'possible', 'likely']),
  rationale: z.string().trim().min(10).max(2000),
  model: z.string().trim().min(2).max(120),
  policyVersion: z.string().trim().min(2).max(120),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  citedSpans: z.array(z.string().trim().min(1).max(500)).max(20),
}).strict();
```

Add strict inputs for review scope, candidates, human decisions, privilege/waiver, redaction, lists and inspection. Refine waiver to require `confirmExposure: true`; require exact evidence for redaction/provision/completion.

- [ ] **Step 4: Add and register migration 11**

Create composite firm/matter scoped tables:

```sql
disclosure_reviews; disclosure_review_events; disclosure_documents;
disclosure_ai_suggestions; disclosure_decisions; disclosure_privilege_reviews;
disclosure_redactions; disclosure_lists; disclosure_list_entries;
inspection_requests; inspection_request_items; inspection_events;
disclosure_command_receipts;
```

Add exact-version/proceeding/party foreign keys, optimistic root versions, immutable snapshot/suggestion/decision triggers and append-only event/history triggers.

- [ ] **Step 5: Add capabilities and make focused tests GREEN**

```ts
type DisclosureCapability =
  | 'disclosure.read' | 'disclosure.prepare' | 'disclosure.review'
  | 'disclosure.review_privilege' | 'disclosure.waive_privilege'
  | 'disclosure.approve_redaction' | 'disclosure.generate_list'
  | 'disclosure.record_external';
```

Admin/partner receive all; solicitor all except waiver; paralegal read/prepare/record external; finance/readonly none. Run Step 2; expect PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/contracts.ts src/server/contracts.disclosure.test.ts src/server/migrations src/server/migrations.test.ts src/server/disclosure/types.ts src/server/policy.ts src/server/policy.test.ts
git commit -m "feat: define governed disclosure records"
```

---

### Task 2: Safe projections and deterministic AI evaluation

**Files:**
- Create: `src/server/disclosure/projections.ts`
- Create: `src/server/disclosure/projections.test.ts`
- Create: `src/server/disclosure/evaluation.ts`
- Create: `src/server/disclosure/evaluation.test.ts`

**Interfaces:**
- Produces: `projectDisclosureCandidate`, `projectInspection`, `evaluateDisclosureDocument`.
- Consumes: Task 1 types and immutable histories; no database/network.

- [ ] **Step 1: Write failing safe-precedence tests**

```ts
it('keeps a candidate restricted when AI suggests relevance', () => {
  expect(projectDisclosureCandidate({
    documentVersionId: VERSION_ID, suggestions: [suggestion('likely_relevant')],
    privilegeReviews: [privilege('restricted')], decisions: [], redactions: [],
  })).toMatchObject({ restricted: true, canList: false });
});

it('returns deterministic provisional provenance without a final decision', () => {
  const result = evaluateDisclosureDocument({
    sourceHash: 'a'.repeat(64), title: 'Repair chronology',
    extractedText: 'Repairs were reported and inspected.', issueTags: ['repairs'],
  });
  expect(result).toMatchObject({
    relevance: 'likely_relevant', model: 'evaluation-local-v1',
    policyVersion: 'disclosure-evaluation-v1', sourceHash: 'a'.repeat(64),
  });
  expect(result).not.toHaveProperty('finalDecision');
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/disclosure/projections.test.ts src/server/disclosure/evaluation.test.ts`

Expected: FAIL because modules are absent.

- [ ] **Step 3: Implement projections**

```ts
export function projectDisclosureCandidate(input: CandidateHistory): CandidateProjection {
  const privilege = latest(input.privilegeReviews);
  const decision = latest(input.decisions);
  const restricted = ['restricted', 'further_review'].includes(privilege?.outcome ?? '');
  const redaction = latestApproved(input.redactions);
  return {
    state: decision ? 'human_decision_recorded' : input.suggestions.length ? 'human_review_required' : 'unreviewed',
    restricted,
    canList: decision?.decision === 'disclose' && !restricted && (!decision.redactionRequired || Boolean(redaction)),
    effectiveDocumentVersionId: redaction?.redactedDocumentVersionId ?? input.documentVersionId,
  };
}
```

Sort by recorded time/ID. Keep request, response, provided and completed inspection facts separate.

- [ ] **Step 4: Implement the evaluation adapter**

Use fixed term maps for relevance, possible privilege/protected-negotiation and personal/confidential warnings. Return matched spans, issue tags, hash hints, model and policy provenance; never return a decision.

- [ ] **Step 5: Run and commit**

Run Step 2; expect PASS.

```bash
git add src/server/disclosure/projections.ts src/server/disclosure/projections.test.ts src/server/disclosure/evaluation.ts src/server/disclosure/evaluation.test.ts
git commit -m "feat: project safe disclosure review states"
```

---

### Task 3: Tenant-safe review persistence

**Files:**
- Create: `src/server/disclosure/store.ts`
- Create: `src/server/disclosure/store.test.ts`

**Interfaces:**
- Produces: `DisclosureStore`, workspace assembly, `openReview`, `addCandidate`, `recordAiSuggestion` and transaction primitive.
- Consumes: migration 11, projections and existing audit/timeline/outbox/source tables.

- [ ] **Step 1: Write failing isolation/atomicity/replay tests**

```ts
it('does not resolve another matter candidate by UUID', () => {
  expect(fixture().store.getCandidate(FIRM_ID, OTHER_MATTER_ID, CANDIDATE_ID)).toBeUndefined();
});

it('atomically opens review, event, receipt, audit, timeline and outbox', () => {
  const { store, db } = fixture();
  store.openReview(scope, input, audit);
  for (const table of ['disclosure_reviews', 'disclosure_review_events', 'disclosure_command_receipts', 'security_audit_events', 'matter_timeline_events', 'domain_outbox']) {
    expect(count(db, table)).toBe(1);
  }
});

it('replays identical input and conflicts on changed input', () => {
  const first = store.addCandidate(scope, candidateInput, audit);
  expect(store.addCandidate(scope, candidateInput, audit)).toEqual(first);
  expect(() => store.addCandidate(scope, { ...candidateInput, custodian: 'Changed' }, audit))
    .toThrow('Idempotency key already used with different input');
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/disclosure/store.test.ts`

Expected: FAIL because the store is absent.

- [ ] **Step 3: Implement scoped source resolution and workspace assembly**

Predicate every query by firm/matter. Resolve exact versions via `document_versions JOIN documents`; verify proceeding/party membership. Return safe labels/IDs without document content.

- [ ] **Step 4: Implement atomic command primitive**

```ts
private runCommand<T>(scope: CommandScope, input: unknown, write: () => T): T {
  return this.transaction(() => {
    const receipt = this.findReceipt(scope);
    if (receipt) return this.replayOrConflict(receipt, input);
    const result = write();
    this.writeAuditTimelineOutboxReceipt(scope, result);
    return result;
  });
}
```

Sensitive commands emit only entity IDs/event/restriction state outside disclosure tables.

- [ ] **Step 5: Implement review, candidate and suggestion appends**

Open one review per proceeding/party/scope version. Candidate uniqueness is review + exact version. Suggestions append with provenance and never mutate candidate/decision state.

- [ ] **Step 6: Run and commit**

Run Step 2; expect PASS.

```bash
git add src/server/disclosure/store.ts src/server/disclosure/store.test.ts
git commit -m "feat: persist tenant safe disclosure reviews"
```

---

### Task 4: Human decisions, privilege and redactions

**Files:**
- Modify: `src/server/disclosure/store.ts`
- Modify: `src/server/disclosure/store.test.ts`
- Create: `src/server/disclosure/service.ts`
- Create: `src/server/disclosure/service.test.ts`

**Interfaces:**
- Produces: capability-gated decision, privilege, waiver and redaction commands.
- Consumes: Tasks 1–3.

- [ ] **Step 1: Write failing invariants and role tests**

```ts
it('blocks disclosure with unresolved privilege warning', () => {
  expect(() => fixtureWithPossiblePrivilege().service.recordDecision(
    solicitor, MATTER_ID, CANDIDATE_ID,
    { expectedVersion: 1, idempotencyKey: 'decision-001', decision: 'disclose',
      reason: 'Relevant repair record reviewed by solicitor.', redactionRequired: false, reviewedAt: NOW }, audit,
  )).toThrow('Resolve the privilege warning before recording disclosure');
});

it('prevents solicitor privilege waiver', () => {
  expect(() => fixture().service.recordPrivilegeReview(solicitor, MATTER_ID, CANDIDATE_ID, waiverInput, audit))
    .toThrow('You do not have permission');
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/disclosure/store.test.ts src/server/disclosure/service.test.ts`

Expected: FAIL because commands/service are absent.

- [ ] **Step 3: Implement immutable human decisions**

Require expected candidate version, reason/reviewer time. Append and supersede; never update. Reject disclose under possible/likely/restricted/further-review privilege state.

- [ ] **Step 4: Implement privilege and partner-only waiver**

Restricted/not-privileged/further-review require review capability. Waived additionally requires waiver capability, `confirmExposure === true`, 20-character reason and verified nullable authority version.

- [ ] **Step 5: Implement redaction lineage**

Require different exact original/redacted versions in the same matter, categories/reasons and visual-review confirmation. Only approval capability creates approved state.

- [ ] **Step 6: Implement service access filtering**

Parse before access; generic not-found; exact capabilities per command. Users without privilege capability receive restricted safe metadata only.

- [ ] **Step 7: Run and commit**

Run Step 2; expect PASS.

```bash
git add src/server/disclosure/store.ts src/server/disclosure/store.test.ts src/server/disclosure/service.ts src/server/disclosure/service.test.ts
git commit -m "feat: govern disclosure and privilege decisions"
```

---

### Task 5: List snapshots and inspection ledger

**Files:**
- Modify: `src/server/disclosure/store.ts`
- Modify: `src/server/disclosure/store.test.ts`
- Modify: `src/server/disclosure/service.ts`
- Modify: `src/server/disclosure/service.test.ts`

**Interfaces:**
- Produces: `generateList`, `createInspectionRequest`, `recordInspectionEvent`.
- Consumes: effective projections and exact evidence.

- [ ] **Step 1: Write failing snapshot/inspection tests**

```ts
it('omits blocked candidates and records blockers', () => {
  const list = fixture().service.generateList(solicitor, MATTER_ID, REVIEW_ID, listInput, audit);
  expect(list.entries.map((entry) => entry.candidateId)).toEqual([APPROVED_ID]);
  expect(list.blockers).toContainEqual({ candidateId: PRIVILEGED_ID, reason: 'privilege_restricted' });
});

it('keeps inspection provision and completion separate', () => {
  const { store } = fixture();
  expect(store.recordInspectionEvent(scope, providedInput, audit).projection.completed).toBe(false);
  expect(store.recordInspectionEvent(scope, completedInput, audit).projection.completed).toBe(true);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/disclosure/store.test.ts src/server/disclosure/service.test.ts`

Expected: FAIL because commands are absent.

- [ ] **Step 3: Implement immutable list generation**

Re-project all candidates transactionally. Snapshot only `canList`, substituting approved exact redactions. Persist effective decision/reviewer and blocker IDs/reasons. Do not sign/file/serve.

- [ ] **Step 4: Implement inspection events**

Bind requests to exact list/entries/requesting party. Append received, acknowledged, refused, agreed, provided and completed. Provided requires exact version/delivery evidence; completion requires prior provision plus note.

- [ ] **Step 5: Gate, test and commit**

List generation requires `generate_list`; external inspection requires `record_external`. Run Step 2; expect PASS.

```bash
git add src/server/disclosure/store.ts src/server/disclosure/store.test.ts src/server/disclosure/service.ts src/server/disclosure/service.test.ts
git commit -m "feat: retain disclosure lists and inspections"
```

---

### Task 6: API and application wiring

**Files:**
- Create: `src/server/disclosure/routes.ts`
- Create: `src/server/disclosure/routes.test.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/index.ts`

**Interfaces:**
- Produces: authenticated workspace and narrow POST commands.
- Consumes: `DisclosureService` and authenticated audit context.

- [ ] **Step 1: Write failing route tests**

```ts
it('returns a privilege-safe paralegal workspace', async () => {
  const response = await app.inject({ method: 'GET',
    url: `/api/matters/${MATTER_ID}/proceedings/${PROCEEDING_ID}/disclosure`, headers: auth(paralegal) });
  expect(response.statusCode).toBe(200);
  expect(response.json().reviews[0].restrictedCandidates[0]).not.toHaveProperty('documentTitle');
});

it('maps inaccessible candidates to generic 404', async () => {
  const response = await app.inject({ method: 'POST',
    url: `/api/matters/${OTHER_MATTER}/disclosure/candidates/${CANDIDATE_ID}/decisions`,
    headers: auth(solicitor), payload: validDecision });
  expect(response.statusCode).toBe(404);
  expect(response.json()).toEqual({ error: 'Disclosure record not found.' });
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/disclosure/routes.test.ts`

Expected: FAIL because routes are absent.

- [ ] **Step 3: Implement routes and error mapping**

Expose GET workspace and POST review/candidate/suggestion/decision/privilege/redaction/list/inspection endpoints. Identity comes only from authentication. Map validation 400, generic access/not-found 404, stale/idempotency 409.

- [ ] **Step 4: Register store/service and make GREEN**

Construct one store/service from existing database in `index.ts`; pass service into app following pleadings. Run Step 2; expect PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/disclosure/routes.ts src/server/disclosure/routes.test.ts src/server/app.ts src/server/index.ts
git commit -m "feat: expose governed disclosure api"
```

---

### Task 7: Synthetic evaluation journey

**Files:**
- Create: `src/server/disclosure/seed.test.ts`
- Modify: `src/server/database.ts`
- Modify: `src/server/database.test.ts`

**Interfaces:**
- Produces: idempotent Maya disclosure journey.
- Consumes: existing seed proceeding/direction/documents and service commands.

- [ ] **Step 1: Write failing acceptance test**

```ts
it('seeds a mixed governed journey idempotently', () => {
  seedDisclosureEvaluation(db); seedDisclosureEvaluation(db);
  const workspace = service.getWorkspace(admin, SEED_IDS.matterId, SEED_IDS.proceedingId);
  expect(workspace.reviews).toHaveLength(1);
  expect(workspace.reviews[0].candidates.some((item) => item.projection.restricted)).toBe(true);
  expect(workspace.reviews[0].candidates.some((item) => item.projection.canList)).toBe(true);
  expect(workspace.reviews[0].lists).toHaveLength(1);
  expect(workspace.reviews[0].inspectionRequests[0].projection.completed).toBe(false);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/disclosure/seed.test.ts src/server/database.test.ts`

Expected: FAIL because seed is absent.

- [ ] **Step 3: Seed through service commands**

Use stable IDs/keys: claimant review linked to directions order, mixed candidates, duplicate suggestion, restricted advice, uncertain AI suggestion, approved repair document, approved redaction, immutable list and partial inspection. Avoid direct legal-record SQL.

- [ ] **Step 4: Run twice and commit**

Run Step 2 twice; expect identical passing counts.

```bash
git add src/server/disclosure/seed.test.ts src/server/database.ts src/server/database.test.ts
git commit -m "feat: seed disclosure evaluation journey"
```

---

### Task 8: Lazy Matter 360 workspace

**Files:**
- Create: `src/client/components/matter/DisclosurePanel.tsx`
- Create: `src/client/components/matter/DisclosurePanel.test.tsx`
- Create: `src/client/components/matter/DisclosureDialogs.tsx`
- Modify: `src/client/pages/MatterPage.tsx`
- Modify: `src/client/pages/MatterPage.test.tsx`
- Modify: `src/client/api.ts`
- Modify: `src/client/styles.css`

**Interfaces:**
- Produces: Review queue, Privilege, Lists and Inspection views and permission-gated dialogs.
- Consumes: Task 6 DTO/routes and existing lazy/Dialog/request patterns.

- [ ] **Step 1: Write failing safety/UI tests**

```tsx
it('separates provisional AI output from human decision', () => {
  render(<DisclosurePanel initialWorkspace={workspace} matterId={MATTER_ID} proceedingId={PROCEEDING_ID} />);
  expect(screen.getByText('AI suggestion — human review required')).toBeInTheDocument();
  expect(screen.getByText('Human decision: Review required')).toBeInTheDocument();
});

it('hides restricted metadata from a paralegal', () => {
  render(<DisclosurePanel initialWorkspace={paralegalWorkspace} matterId={MATTER_ID} proceedingId={PROCEEDING_ID} />);
  expect(screen.getByText('Restricted document')).toBeInTheDocument();
  expect(screen.queryByText('Privileged solicitor advice')).not.toBeInTheDocument();
});

it('does not expose waiver to a solicitor', () => {
  render(<DisclosurePanel initialWorkspace={solicitorWorkspace} matterId={MATTER_ID} proceedingId={PROCEEDING_ID} />);
  expect(screen.queryByRole('button', { name: 'Record privilege waiver' })).toBeNull();
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- src/client/components/matter/DisclosurePanel.test.tsx src/client/pages/MatterPage.test.tsx`

Expected: FAIL because section/panel are absent.

- [ ] **Step 3: Add DTOs and lazy navigation**

Define safe/restricted candidate variants and permission flags; add `disclosure` Matter section/navigation/lazy fetch with abort, retry and errors.

- [ ] **Step 4: Implement four views and exact copy**

Show exact source/version, AI provenance, human decision, privilege status, redaction lineage, list blockers and inspection facts. Restricted rows expose only safe operational metadata.

- [ ] **Step 5: Add permission-gated dialogs**

Cover candidate, AI suggestion, decision, privilege/waiver, redaction, list and inspection commands. Use labelled exact-source selectors, required notes and confirmations.

- [ ] **Step 6: Style, test and commit**

Use semantic responsive cards/tabs and separate lazy dialog chunk. Run Step 2 plus `npm run typecheck && npm run build`; expect PASS.

```bash
git add src/client/api.ts src/client/pages/MatterPage.tsx src/client/pages/MatterPage.test.tsx src/client/components/matter/DisclosurePanel.tsx src/client/components/matter/DisclosurePanel.test.tsx src/client/components/matter/DisclosureDialogs.tsx src/client/styles.css
git commit -m "feat: add governed disclosure workspace"
```

---

### Task 9: Verification, review and release

**Files:**
- Modify: `docs/superpowers/plans/2026-07-18-governed-disclosure-evidence.md`

**Interfaces:**
- Produces: exact evidence and clean GitHub merge.
- Consumes: Tasks 1–8.

- [ ] **Step 1: Run complete suite**

Run: `npm test`

Expected: all tests pass with no unhandled failures.

- [ ] **Step 2: Run strict targets**

Run: `npm run typecheck`

Expected: exit 0 with no diagnostics.

- [ ] **Step 3: Build production output**

Run: `npm run build`

Expected: server/Vite succeed and Disclosure panel/dialogs are separate chunks.

- [ ] **Step 4: Inspect scope/copy/state**

```bash
rg -n "SwiftBridge|AI approved|AI decision|safe to disclose|legally compliant|privilege confirmed by AI" src docs/superpowers/specs/2026-07-18-governed-disclosure-evidence-design.md || true
git diff --check
git status --short
```

Expected: only exclusions/negative assertions; no whitespace defects; only evidence edit remains.

- [ ] **Step 5: Record evidence and commit**

Add exact test counts/typecheck/build chunks beneath header.

```bash
git add docs/superpowers/plans/2026-07-18-governed-disclosure-evidence.md
git commit -m "docs: record disclosure milestone verification"
```

- [ ] **Step 6: Review and publish**

Use requesting-code-review, fix critical/important findings test-first, rerun affected/full checks, then verification-before-completion. Publish exact verified tree to `feat/disclosure-evidence-control`, open PR against GitHub `main`, verify head/file list, merge and report PR/merge commit.
