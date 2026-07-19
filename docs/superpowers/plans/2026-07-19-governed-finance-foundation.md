# Governed Finance Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build governed activity-derived time, immutable rates, approved WIP, estimates/warnings, disbursements, balanced non-cash journals and transparent matter-finance visibility.

**Architecture:** Add a bounded `finance` domain beside matters and litigation domains. Pure integer calculations and projections sit above migration 12; `FinanceStore` owns tenant-safe atomic persistence; `FinanceService` enforces separated capabilities; strict Fastify commands feed a lazy Matter 360 Time & finance workspace.

**Tech Stack:** Node.js 24, TypeScript 7, Fastify 5, SQLite `DatabaseSync`, Zod 4, React 19, Vite 8, Vitest 4 and Testing Library.

## Global Constraints

- SwiftClaim Litigation only; no SwiftBridge or Proclaim migration work.
- Monetary values use signed integer minor units and explicit `GBP`; no floating-point money.
- Durations use integer minutes; every approved time entry snapshots its exact rate and calculation inputs.
- AI/activity output is provisional and labelled `AI suggestion — human review required`.
- AI never posts time, approves rates/WIP, records disbursements, posts journals or moves money.
- Posted financial facts are append-only; corrections use linked reversal and replacement facts.
- Posted journals have at least two lines, one currency and exactly balanced debit/credit totals.
- Client, office and neutral account designations never net or substitute for each other.
- Unimplemented client/office/billed/paid positions render `Not yet connected`, never fabricated zero balances.
- All commands are firm/matter scoped, strict, idempotent, concurrency protected and atomically audited/outboxed.
- Generic `404` protects inaccessible references; stale versions and changed idempotency replays return `409`.

---

### Task 1: Financial contracts, capabilities and integer calculations

**Files:**
- Create: `src/server/contracts.finance.test.ts`
- Create: `src/server/finance/types.ts`
- Create: `src/server/finance/calculations.ts`
- Create: `src/server/finance/calculations.test.ts`
- Modify: `src/shared/contracts.ts`
- Modify: `src/server/policy.ts`
- Modify: `src/server/policy.test.ts`

**Interfaces:**
- Produces: strict finance command schemas, nine capabilities, `calculateTimeValue`, `validateJournalLines` and finance DTOs.
- Consumes: existing UUID/date/idempotency patterns and `FirmRole`.

- [x] **Step 1: Write failing contract, policy and arithmetic tests**

```ts
it('rejects decimal money and autonomous time posting', () => {
  expect(() => submitFinanceTimeSchema.parse({
    idempotencyKey: 'finance-time-001', minutes: 37, valueMinor: 1250.5,
    currency: 'GBP', aiApproved: true,
  })).toThrow();
});

it('calculates exact value using integer arithmetic', () => {
  expect(calculateTimeValue({ minutes: 37, hourlyRateMinor: 24_000 }))
    .toEqual({ chargeMinor: 14_800, remainderNumerator: 0, denominator: 60 });
});

it('rejects an unbalanced or mixed-currency journal', () => {
  expect(() => validateJournalLines([
    line('debit', 10_000, 'GBP'), line('credit', 9_999, 'GBP'),
  ])).toThrow('Journal debits and credits must balance exactly.');
});
```

- [x] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/contracts.finance.test.ts src/server/finance/calculations.test.ts src/server/policy.test.ts`

Expected: FAIL because finance schemas, calculations and capabilities are absent.

- [x] **Step 3: Define strict contracts and integer calculations**

Add strict schemas for activity suggestion decisions, timers, manual/submitted time, approval/reversal, rate cards/versions/entries, estimate versions/warning events, disbursement events and journals. Money is `z.number().int().safe()`; minutes are non-negative safe integers; currency is `z.literal('GBP')`; unknown properties fail.

```ts
export function calculateTimeValue(input: { minutes: number; hourlyRateMinor: number }) {
  const numerator = input.minutes * input.hourlyRateMinor;
  if (!Number.isSafeInteger(numerator)) throw new FinanceCalculationError('ARITHMETIC_OVERFLOW');
  return {
    chargeMinor: Math.trunc(numerator / 60),
    remainderNumerator: numerator % 60,
    denominator: 60,
  };
}
```

`validateJournalLines` requires at least two lines, one non-zero side per line, one currency and equal safe-integer totals.

- [x] **Step 4: Add separated capabilities**

Add `finance.read_matter`, `read_firm`, `record_time`, `approve_time`, `manage_rates`, `manage_estimates`, `manage_disbursements`, `prepare_journal`, `approve_journal`, and `post_journal`. Fee earners record time; solicitors/partners approve within matter access; finance/admin manage firm finance; journal preparation and approval/posting remain distinct service checks.

- [x] **Step 5: Run GREEN and commit**

Run: `npm test -- src/server/contracts.finance.test.ts src/server/finance/calculations.test.ts src/server/policy.test.ts && npm run typecheck`

Expected: selected tests and both TypeScript targets pass.

```bash
git add src/shared/contracts.ts src/server/policy* src/server/contracts.finance.test.ts src/server/finance/types.ts src/server/finance/calculations*
git commit -m "feat: define governed finance calculations"
```

---

### Task 2: Migration 12 and immutable journal kernel

**Files:**
- Create: `src/server/migrations/012-governed-finance-foundation.ts`
- Modify: `src/server/migrations/index.ts`
- Modify: `src/server/migrations.test.ts`
- Create: `src/server/finance/journal.ts`
- Create: `src/server/finance/journal.test.ts`

**Interfaces:**
- Produces: finance tables/triggers and pure journal projection helpers.
- Consumes: finance DTOs and calculation validation from Task 1.

- [x] **Step 1: Write failing migration and journal tests**

```ts
it('installs immutable balanced finance infrastructure', () => {
  const db = createDatabase(':memory:');
  expect(tableNames(db)).toEqual(expect.arrayContaining([
    'finance_time_entries', 'finance_rate_cards', 'finance_estimates',
    'finance_disbursements', 'finance_accounts', 'finance_journals', 'finance_journal_lines',
  ]));
  expect(triggerNames(db)).toContain('finance_journal_lines_no_update');
});

it('projects only posted journals into balances', () => {
  expect(projectAccountBalances([draftJournal, postedJournal])).toEqual(postedBalances);
});
```

- [x] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/migrations.test.ts src/server/finance/journal.test.ts`

Expected: FAIL because migration 12 and journal projections are absent.

- [x] **Step 3: Create and register migration 12**

Create the design tables: activity suggestions/decisions, timer sessions/events, rate cards/versions/entries, time entries/events, estimates/versions/thresholds/warnings, disbursements/events, accounts, periods, journals/lines/events and command receipts. Use composite firm/matter/user/source foreign keys, safe-integer checks, JSON validity checks and immutable/update-delete triggers. Journal lines enforce one positive debit or credit side and `GBP`; posting balance is enforced again in the store transaction.

- [x] **Step 4: Implement pure journal projection**

`projectAccountBalances` ignores draft/approved/rejected journals, folds only posted lines by account and matter, and applies reversals as independent balanced posted journals. It returns debit, credit and signed net minor units without client/office netting.

- [x] **Step 5: Run GREEN and commit**

Run: `npm test -- src/server/migrations.test.ts src/server/finance/journal.test.ts && npm run typecheck`

Expected: all selected tests and type-check pass.

```bash
git add src/server/migrations src/server/migrations.test.ts src/server/finance/journal*
git commit -m "feat: install immutable finance journal kernel"
```

---

### Task 3: Deterministic activity suggestions and timers

**Files:**
- Create: `src/server/finance/activity.ts`
- Create: `src/server/finance/activity.test.ts`
- Create: `src/server/finance/projections.ts`
- Create: `src/server/finance/projections.test.ts`

**Interfaces:**
- Produces: `suggestTimeFromActivity`, timer projection and `projectMatterFinance`.
- Consumes: safe operational facts, exact source IDs and finance DTOs.

- [x] **Step 1: Write failing activity/projection tests**

```ts
it('creates one deterministic provisional suggestion from a safe call fact', () => {
  const result = suggestTimeFromActivity(callFact);
  expect(result).toEqual(suggestTimeFromActivity(callFact));
  expect(result).toMatchObject({
    label: 'AI suggestion — human review required', sourceKind: 'communication_call',
    sourceId: callFact.id, minutes: 18,
  });
  expect(result).not.toHaveProperty('posted');
});

it('shows unavailable cash positions rather than zero', () => {
  expect(projectMatterFinance(emptyInput)).toMatchObject({
    clientBalance: { state: 'not_connected' }, officeBalance: { state: 'not_connected' },
  });
});
```

- [x] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/finance/activity.test.ts src/server/finance/projections.test.ts`

Expected: FAIL because adapters and projections are absent.

- [x] **Step 3: Implement safe deterministic adapters**

Support completed task, communication call, approved document revision, filing, hearing and manual timer facts through a discriminated input union. Never consume message/document body text. Hash the source metadata and output matter/user/source IDs, observed duration, proposed code/phase, neutral narrative, model/policy version and explanation. Timer projection permits one running timer per user and rejects negative/reordered events.

- [x] **Step 4: Implement matter projection**

Separate provisional minutes/value from approved WIP. Project disbursement statuses and active estimate variance independently. Client/office/billed/paid positions are explicit `{ state: 'not_connected' }` values.

- [x] **Step 5: Run GREEN and commit**

Run: `npm test -- src/server/finance/activity.test.ts src/server/finance/projections.test.ts && npm run typecheck`

Expected: all selected tests and type-check pass.

```bash
git add src/server/finance/activity* src/server/finance/projections*
git commit -m "feat: suggest safe finance activity and projections"
```

---

### Task 4: Tenant-safe store for time, rates and WIP

**Files:**
- Create: `src/server/finance/store.ts`
- Create: `src/server/finance/store.time.test.ts`

**Interfaces:**
- Produces: `FinanceStore.getWorkspace`, rate commands, suggestion/timer commands, time submission/approval/reversal.
- Consumes: migration tables, calculations, projections and audit context.

- [x] **Step 1: Write failing store tests**

```ts
it('approves time with an immutable exact rate snapshot into WIP', () => {
  const approved = store.approveTime(supervisor, matterId, entry.id, approval, audit);
  expect(approved).toMatchObject({ status: 'approved', rateVersionId, hourlyRateMinor: 24_000, chargeMinor: 14_800 });
  expect(store.getWorkspace(supervisor, matterId)?.snapshot.approvedWipMinor).toBe(14_800);
});

it('replays one activity source and rejects a changed idempotency payload', () => {
  expect(store.createSuggestion(user, matterId, input, audit)).toEqual(store.createSuggestion(user, matterId, input, audit));
  expect(() => store.createSuggestion(user, matterId, { ...input, minutes: 19 }, audit)).toThrow(/idempotency/i);
});
```

- [x] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/finance/store.time.test.ts`

Expected: FAIL because `FinanceStore` is absent.

- [x] **Step 3: Implement scoped rate/time persistence**

Every query includes firm/matter/user predicates. Activate immutable rate versions with independent approval. Persist one source/user suggestion, timer events, decisions and time entries. Approval resolves the exact active rate at work date, snapshots calculation inputs/result and writes receipt, audit, timeline and outbox atomically. Corrections reverse/replace approved records; no update/delete occurs.

- [x] **Step 4: Run GREEN and commit**

Run: `npm test -- src/server/finance/store.time.test.ts && npm run typecheck`

Expected: selected tests and type-check pass.

```bash
git add src/server/finance/store.ts src/server/finance/store.time.test.ts
git commit -m "feat: persist governed time rates and wip"
```

---

### Task 5: Estimates, warnings and disbursements

**Files:**
- Modify: `src/server/finance/store.ts`
- Create: `src/server/finance/store.costs.test.ts`
- Create: `src/server/finance/duplicates.ts`
- Create: `src/server/finance/duplicates.test.ts`

**Interfaces:**
- Produces: immutable estimate/warning/disbursement commands and duplicate findings.
- Consumes: exact document versions, integer money and matter projection.

- [x] **Step 1: Write failing estimate/disbursement tests**

```ts
it('opens a warning once approved exposure crosses the configured threshold', () => {
  store.addEstimateVersion(partner, matterId, estimateAt10k, audit);
  store.approveTime(partner, matterId, entryAt8k.id, approval, audit);
  expect(store.getWorkspace(partner, matterId)?.warnings).toContainEqual(expect.objectContaining({ thresholdPercent: 80, state: 'open' }));
});

it('keeps incurred paid billed and recovered disbursement facts distinct', () => {
  const paid = store.recordDisbursementEvent(finance, matterId, id, paidExternally, audit);
  expect(paid).toMatchObject({ incurred: true, paidExternally: true, billed: false, recovered: false });
});
```

- [x] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/finance/store.costs.test.ts src/server/finance/duplicates.test.ts`

Expected: FAIL because commands and duplicate evaluation are absent.

- [x] **Step 3: Implement governed estimates and warnings**

Version estimates with exact optional source versions, net/disbursement/VAT/limit amounts, effective date and approval. Open threshold facts deterministically; review/client-notification evidence closes a specific warning without claiming compliance. Superseding versions preserve history.

- [x] **Step 4: Implement disbursement states and duplicate findings**

Record proposed/approved/incurred/paid_external/cancelled/corrected events. `paid_external` requires exact evidence and does not create cash journal lines. Duplicate matching compares normalised supplier, reference, gross amount and invoice date and returns provisional blockers only.

- [x] **Step 5: Run GREEN and commit**

Run: `npm test -- src/server/finance/store.costs.test.ts src/server/finance/duplicates.test.ts && npm run typecheck`

Expected: selected tests and type-check pass.

```bash
git add src/server/finance/store.ts src/server/finance/store.costs.test.ts src/server/finance/duplicates*
git commit -m "feat: govern estimates warnings and disbursements"
```

---

### Task 6: Journal preparation, independent approval and posting

**Files:**
- Modify: `src/server/finance/store.ts`
- Create: `src/server/finance/store.journal.test.ts`
- Create: `src/server/finance/service.ts`
- Create: `src/server/finance/service.test.ts`

**Interfaces:**
- Produces: `FinanceService` and journal prepare/approve/post/reverse commands.
- Consumes: capabilities, balanced journal validation, account/period policy and store.

- [x] **Step 1: Write failing journal/service tests**

```ts
it('prevents preparer self-approval and self-posting', () => {
  const journal = service.prepareJournal(financeUser, matterId, input, audit);
  expect(() => service.approveJournal(financeUser, matterId, journal.id, approval, audit)).toThrow(/independent/i);
});

it('posts a balanced journal atomically and reverses without mutation', () => {
  const posted = approveAndPost(journal);
  const reversal = service.reverseJournal(partner, matterId, posted.id, reverseInput, audit);
  expect(reversal.reversesJournalId).toBe(posted.id);
  expect(accountNet(posted, reversal)).toBe(0);
});
```

- [x] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/finance/store.journal.test.ts src/server/finance/service.test.ts`

Expected: FAIL because journal commands/service are absent.

- [x] **Step 3: Implement journal/store invariants**

Resolve exact accounts/source/matter/period, validate client-office combinations and balance before insert and again inside posting. Require independent preparer/approver and authorised poster. Posted journals and lines never update/delete. Reversal creates inverted lines linked to the original. Evaluation seed journals are non-cash WIP/disbursement control only.

- [x] **Step 4: Implement service capability boundaries**

Map store errors consistently; enforce own-time versus supervisor approval, firm-wide finance metadata versus privileged content, rate/estimate/disbursement rights and prepare/approve/post separation. Admin cannot bypass invariants.

- [x] **Step 5: Run GREEN and commit**

Run: `npm test -- src/server/finance/store.journal.test.ts src/server/finance/service.test.ts && npm run typecheck`

Expected: selected tests and type-check pass.

```bash
git add src/server/finance/store.ts src/server/finance/store.journal.test.ts src/server/finance/service*
git commit -m "feat: govern balanced finance journal posting"
```

---

### Task 7: Strict finance API and application wiring

**Files:**
- Create: `src/server/finance/routes.ts`
- Create: `src/server/finance/routes.test.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/index.ts`

**Interfaces:**
- Produces: authenticated finance workspace and narrow command routes.
- Consumes: strict schemas and `FinanceService`.

- [x] **Step 1: Write failing route tests**

```ts
it('rejects autonomous AI posting properties', async () => {
  const response = await app.inject({ method: 'POST', url: suggestionDecisionUrl,
    headers: { cookie }, payload: { ...decision, status: 'approved', aiApproved: true } });
  expect(response.statusCode).toBe(400);
});

it('returns generic 404 for another firm rate or evidence source', async () => {
  const response = await app.inject({ method: 'POST', url: timeUrl,
    headers: { cookie }, payload: { ...timeInput, sourceDocumentVersionId: otherFirmVersion } });
  expect(response.statusCode).toBe(404);
});
```

- [x] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/finance/routes.test.ts`

Expected: FAIL because routes are absent.

- [x] **Step 3: Register strict routes**

Expose GET matter workspace and narrow POST commands for suggestions/decisions, timers, time submit/approve/reverse, rate cards/activation, estimates/warnings, disbursements/events and journals/approval/post/reversal. Server supplies identity/audit context. Return `201` for new commands, replay the original status, and map validation/access/conflict errors consistently.

- [x] **Step 4: Run GREEN and commit**

Run: `npm test -- src/server/finance/routes.test.ts src/server/app.test.ts && npm run typecheck`

Expected: selected tests and type-check pass.

```bash
git add src/server/finance/routes* src/server/app.ts src/server/index.ts
git commit -m "feat: expose governed finance foundation api"
```

---

### Task 8: Synthetic finance journey

**Files:**
- Modify: `src/server/database.ts`
- Modify: `src/server/database.test.ts`
- Create: `src/server/finance/seed.test.ts`

**Interfaces:**
- Produces: idempotent Northstar finance evaluation state.
- Consumes: finance store/service and existing matter/activity/document IDs.

- [x] **Step 1: Write failing seed test**

```ts
it('seeds a governed finance journey idempotently', () => {
  seedDatabase(db); seedDatabase(db);
  const workspace = service.getWorkspace(ava, SEED_IDS.northstarMatter);
  expect(workspace.snapshot).toMatchObject({
    approvedWipMinor: expect.any(Number),
    clientBalance: { state: 'not_connected' }, officeBalance: { state: 'not_connected' },
  });
  expect(workspace.suggestions.some(({ status }) => status === 'suggested')).toBe(true);
  expect(workspace.journals.every(({ cashEffect }) => cashEffect === 'none')).toBe(true);
});
```

- [x] **Step 2: Run and confirm RED**

Run: `npm test -- src/server/finance/seed.test.ts src/server/database.test.ts`

Expected: FAIL because finance seed data is absent.

- [x] **Step 3: Seed exact evaluation data**

Seed one active rate version, two fee-earner grades, safe call/document suggestions, a timer result, rejected duplicate, approved snapshotted time, estimate/80% warning, proposed expert disbursement, confirmed court fee and a balanced non-cash control journal. Preserve idempotency and unavailable cash positions.

- [x] **Step 4: Run GREEN and commit**

Run: `npm test -- src/server/finance/seed.test.ts src/server/database.test.ts && npm run typecheck`

Expected: selected tests and type-check pass.

```bash
git add src/server/database.ts src/server/database.test.ts src/server/finance/seed.test.ts
git commit -m "feat: seed governed finance foundation journey"
```

---

### Task 9: Lazy Matter 360 Time & finance workspace

**Files:**
- Create: `src/client/components/matter/FinancePanel.tsx`
- Create: `src/client/components/matter/FinanceDialogs.tsx`
- Create: `src/client/components/matter/FinancePanel.test.tsx`
- Modify: `src/client/api.ts`
- Modify: `src/client/pages/MatterPage.tsx`
- Modify: `src/client/components/matter/MatterSectionRail.tsx`
- Modify: `src/client/styles.css`

**Interfaces:**
- Produces: five-view lazy finance workspace and permission-gated commands.
- Consumes: safe finance DTO and command routes.

- [x] **Step 1: Write failing UI tests**

```tsx
it('separates provisional suggestions from approved WIP', () => {
  render(<FinancePanel workspace={workspace} />);
  expect(screen.getByText('AI suggestion — human review required')).toBeVisible();
  expect(screen.getByText('Approved WIP')).toBeVisible();
});

it('never renders unconnected client money as zero', () => {
  render(<FinancePanel workspace={workspace} />);
  expect(screen.getByText('Client balance · Not yet connected')).toBeVisible();
  expect(screen.queryByText('Client balance · £0.00')).not.toBeInTheDocument();
});
```

- [x] **Step 2: Run and confirm RED**

Run: `npm test -- src/client/components/matter/FinancePanel.test.tsx`

Expected: FAIL because the finance UI is absent.

- [x] **Step 3: Implement responsive safe workspace**

Enable `time_finance` and lazy-load named panel/dialog exports. Build Snapshot, Time, Rates & estimates, Disbursements and Ledger foundation views. Provide running timer, explicit suggestion selection/approval, source/provenance chips, integer-money formatting, warning cards, exact evidence links and permission-safe journal metadata. Mixed/low-confidence suggestions cannot bulk approve.

- [x] **Step 4: Apply React quality review and run GREEN**

Check lazy boundaries, stable list keys, derived-state rendering, accessible labels/dialog focus, no unnecessary effects and no privileged payload in client props.

Run: `npm test -- src/client/components/matter/FinancePanel.test.tsx && npm run typecheck`

Expected: selected tests and type-check pass.

- [x] **Step 5: Commit**

```bash
git add src/client/api.ts src/client/pages/MatterPage.tsx src/client/components/matter/Finance* src/client/components/matter/MatterSectionRail.tsx src/client/styles.css
git commit -m "feat: add governed time and finance workspace"
```

---

### Task 10: Full verification and release evidence

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-governed-finance-foundation.md`

**Interfaces:**
- Produces: auditable release evidence and exact merge-ready tree.
- Consumes: every prior task.

- [x] **Step 1: Run full verification**

```bash
npm test
npm run typecheck
npm run build
git diff --check
rg -n "SwiftBridge|AI approved|AI posted|automatic client transfer|fabricated balance|financially compliant" src docs/superpowers/specs/2026-07-19-governed-finance-foundation-design.md
```

Expected: zero test/type/build/diff failures; terminology matches only explicit safeguards/negative tests; finance UI remains a separate lazy chunk.

- [x] **Step 2: Record exact evidence**

Add observed file/test counts, type/build results, lazy chunk sizes and terminology findings under `## Implementation Evidence — 2026-07-19`.

- [x] **Step 3: Direct security/correctness review**

Review the complete branch diff against the design and plan for money arithmetic, balance invariants, client/office separation, tenant access, independent approval, idempotency, restricted-data leakage and UI copy. Fix every critical/important issue and rerun affected tests.

- [x] **Step 4: Commit evidence and publish exact tree**

```bash
git add docs/superpowers/plans/2026-07-19-governed-finance-foundation.md
git commit -m "docs: record finance foundation verification"
```

Create a GitHub feature branch from current remote `main`, publish the exact verified tree, open a PR containing the evidence, merge without force-push and confirm the new remote `main` commit.

## Implementation Evidence — 2026-07-19

- Full Vitest run: **97 test files passed; 467 tests passed**.
- TypeScript: browser and server targets both passed `tsc --noEmit`.
- Production build: Vite transformed 1,823 modules and completed successfully.
- Finance remained lazy-loaded as separate production chunks:
  - `FinanceDialogs-BFPr1_qi.js` — 17.01 kB, 3.78 kB gzip;
  - `FinancePanel-BlN8nzrg.js` — 25.40 kB, 6.35 kB gzip.
- Main client bundle: `index-DwaRVTOZ.js` — 489.27 kB, 117.96 kB gzip. Finance CSS is included in the 123.66 kB stylesheet (21.25 kB gzip).
- `git diff --check` completed with no whitespace errors.
- Terminology scan found only the explicit SwiftClaim scope boundary, future-milestone statement and negative UI test; no autonomous AI approval/posting, fabricated balances or client-transfer claims exist in runtime source.
- Production-browser inspection was attempted against the built application. The isolated cloud browser correctly blocked workspace-local addresses, so no authentication bypass or public test deployment was introduced. Component interaction tests, API injection tests and the production build provide the retained UI evidence.

### Direct security and correctness review

- Money remains safe-integer minor units with explicit GBP; non-chargeable submitted time contributes minutes but no provisional monetary value.
- Client, office, billed, paid and recovered positions remain `Not yet connected`; the neutral journal foundation cannot post to client or office accounts.
- Journals are revalidated for exact balance, account designation, period and currency before approval and again before posting. Preparers cannot approve or post their own journal; reversal creates a separate balanced fact.
- Dialog command keys and human-event timestamps remain stable across lost-response retries. Accepted suggestions and stopped timers remain provisional and recoverable without double counting.
- Timer start and stop timestamps are server-authoritative. Split activity entries cannot exceed the source's exact observed duration.
- Warning closure by a replacement estimate is internal to the atomic estimate-version transaction and cannot be claimed through the public warning-event contract.
- Firm and matter predicates protect finance records and exact document versions. Finance users receive a minimal matter shell, no general parties/tasks/documents/chronology/audit payload, and can download only exact versions linked to governed estimate, warning, disbursement or journal evidence. Legal-work activity links alone do not grant finance document access.
- Cross-firm exact-version download, rate/evidence linking and finance route tests return generic `404` without existence disclosure.
