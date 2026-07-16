# Negotiation and Settlement Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tenant-safe Negotiation and Settlement workspace where exact client instructions and firm approval govern external actions, concluded terms remain source-linked, and unresolved settlement obligations prevent closure.

**Architecture:** Add a bounded `negotiation` domain beside quantum and communications. Immutable reviews, instructions, action versions, approval events, settlement-term versions and obligation events feed pure projections; `NegotiationService` enforces exact-version authority; `NegotiationReadinessProvider` supplies objective workflow controls and the alternate Negotiation-to-Settlement path. React lazy-loads a dedicated Matter 360 workspace and never infers validity, binding effect, service, satisfaction or legal suitability.

**Tech Stack:** Node.js 24, TypeScript 7, Fastify 5, SQLite `DatabaseSync`, Zod 4, React 19, Vite 8, Vitest 4 and Testing Library.

## Global Constraints

- This slice remains evaluation-only and performs no live external communication, filing, signing or payment.
- No AI recommendation, autonomous advice, valuation, acceptance, rejection, waiver or legal conclusion is included.
- Every domain row is firm- and matter-scoped; inaccessible tenant or confidential records return generic `404`.
- Protected content is filtered before counts, joins, chronology projection and response assembly.
- Advice, instructions, authority decisions, action versions, settlement-term versions, obligation events and their source links are immutable or append-only.
- Money uses integer GBP minor units; the server does not decide whether a figure is reasonable.
- Exact action terms must match the current client instruction, authority version and required approval.
- Any material term edit invalidates prior instruction and approval for external action.
- Recording a decision is never external communication; external status requires an immutable communication, document/service or verified manual-act source.
- A performance assertion never means an obligation is satisfied.
- A settlement record never means valid, binding, enforceable or suitable.
- SwiftBridge, Proclaim migration and Proceedings are out of scope.

---

### Task 1: Canonical contracts and pure projections

**Files:**
- Create: `src/server/negotiation/types.ts`
- Create: `src/server/negotiation/projections.ts`
- Create: `src/server/negotiation/projections.test.ts`
- Create: `src/server/contracts.negotiation.test.ts`
- Modify: `src/shared/contracts.ts`

**Interfaces:**
- Produces: strict command schemas, `NegotiationActionState`, `SettlementState`, `ObligationState`, `projectAction`, `projectSettlement`, `projectObligation`.
- Consumes: existing communication confidentiality, document UUID, ISO date/time and integer-money conventions.

- [ ] **Step 1: Write failing projection tests**

```ts
it('invalidates approval when a newer exact action version exists', () => {
  expect(projectAction({
    currentVersion: 2,
    instructions: [instruction(1)],
    approvals: [approval(1)],
    externalActs: [],
  })).toMatchObject({
    state: 'instruction_required',
    instructionCurrent: false,
    approvalCurrent: false,
    canRecordExternalAction: false,
  });
});

it('keeps asserted performance separate from satisfaction', () => {
  expect(projectObligation([
    obligationEvent('performance_asserted', '2026-09-01T09:00:00.000Z'),
  ], '2026-09-02T09:00:00.000Z')).toMatchObject({
    state: 'performance_asserted',
    satisfiedAt: null,
  });
});
```

- [ ] **Step 2: Run projection tests and confirm RED**

Run: `npm test -- src/server/negotiation/projections.test.ts`

Expected: FAIL because the negotiation projection module does not exist.

- [ ] **Step 3: Implement deterministic projection types and folds**

```ts
export type NegotiationActionState =
  | 'draft'
  | 'instruction_required'
  | 'approval_required'
  | 'authorised'
  | 'externally_recorded'
  | 'cancelled'
  | 'superseded';

export type ObligationState =
  | 'outstanding'
  | 'performance_asserted'
  | 'part_satisfied'
  | 'satisfied'
  | 'disputed'
  | 'waived';

export function projectObligation(
  events: readonly ObligationEvent[],
  asOf: string,
): ObligationProjection {
  const effective = orderAndRemoveCorrectedEvents(events);
  return foldObligationEvents(effective, asOf);
}
```

Order by occurred time, recorded time and ID. Corrections suppress only the explicitly superseded event. `overdue` is an operational date comparison and never changes the evidential state.

- [ ] **Step 4: Write failing strict-contract tests**

Cover exact action version linkage, explicit confirmations, instruction source requirements, authority limits, settlement court-approval position, obligation evidence and correction reasons.

```ts
expect(() => recordClientInstructionSchema.parse({
  actionId,
  actionVersion: 2,
  instructionType: 'accept',
  explicitClientInstruction: false,
  sourceCommunicationEntryId: null,
  sourceDocumentVersionId: null,
})).toThrow();
```

- [ ] **Step 5: Run contract tests and confirm RED**

Run: `npm test -- src/server/contracts.negotiation.test.ts`

Expected: FAIL because negotiation schemas are not exported.

- [ ] **Step 6: Add schemas and inferred input types**

Export:

```ts
createNegotiationReviewSchema
recordClientInstructionSchema
createSettlementAuthorityVersionSchema
createNegotiationActionSchema
appendNegotiationActionVersionSchema
submitNegotiationActionSchema
decideNegotiationActionSchema
recordNegotiationExternalActionSchema
createSettlementSchema
appendSettlementTermsSchema
concludeSettlementSchema
createSettlementObligationSchema
recordSettlementObligationEventSchema
```

Every object is `.strict()`. Cross-field refinements require an exact action for action-specific instructions, one retained source for externally material instructions, an instrument or permitted retained source for conclusion, evidence for `satisfied`, approval authority for `waived`, and at least ten characters for corrections.

- [ ] **Step 7: Run focused tests and commit**

Run: `npm test -- src/server/negotiation/projections.test.ts src/server/contracts.negotiation.test.ts`

Expected: PASS.

```bash
git add src/shared/contracts.ts src/server/contracts.negotiation.test.ts src/server/negotiation/types.ts src/server/negotiation/projections.ts src/server/negotiation/projections.test.ts
git commit -m "feat: define negotiation authority contracts"
```

### Task 2: Migration 8 and immutable persistence model

**Files:**
- Create: `src/server/migrations/008-negotiation-settlement.ts`
- Modify: `src/server/migrations/index.ts`
- Modify: `src/server/migrations.test.ts`
- Modify: `src/server/database.test.ts`

**Interfaces:**
- Produces: migration version 8 and all negotiation/settlement tables, foreign keys, indexes and immutability triggers.
- Consumes: `firms`, `matters`, `users`, `offers`, `loss_schedules`, `general_damages_reviews`, `work_schedules`, `documents`, `document_versions`, `communication_entries` and workflow/audit operational tables.

- [ ] **Step 1: Write failing migration tests**

```ts
expect(migrations.map(({ version, name }) => ({ version, name }))).toContainEqual({
  version: 8,
  name: 'negotiation and settlement authority',
});

for (const table of [
  'negotiation_reviews', 'client_instructions',
  'settlement_authority_versions', 'negotiation_actions',
  'negotiation_action_versions', 'negotiation_approval_events',
  'negotiation_external_acts', 'settlements', 'settlement_term_versions',
  'settlement_obligations', 'settlement_obligation_events',
  'negotiation_command_receipts',
]) expect(tableNames).toContain(table);
```

Assert cross-firm action/offer links fail, action versions reject update/delete, authority current-version uniqueness holds and a corrected obligation event cannot target another matter.

- [ ] **Step 2: Run migration tests and confirm RED**

Run: `npm test -- src/server/migrations.test.ts src/server/database.test.ts`

Expected: FAIL because migration 8 is absent.

- [ ] **Step 3: Implement and register migration 8**

Use composite unique keys such as `(id, firm_id, matter_id)` on parent records and composite child foreign keys. Add:

```sql
UNIQUE (firm_id, matter_id, review_number)
UNIQUE (action_id, version)
UNIQUE (settlement_id, version)
UNIQUE (firm_id, matter_id, command_type, idempotency_key)
```

Add partial indexes for current authority, current action status, outstanding obligations and protected workspace filtering. Add no-update/no-delete triggers to every immutable table and no-delete triggers to controlled aggregate rows.

- [ ] **Step 4: Run migration and database tests**

Run: `npm test -- src/server/migrations.test.ts src/server/database.test.ts`

Expected: PASS with migration checksums of length 64 and tenant/immutability assertions enforced by SQLite.

- [ ] **Step 5: Commit**

```bash
git add src/server/migrations/008-negotiation-settlement.ts src/server/migrations/index.ts src/server/migrations.test.ts src/server/database.test.ts
git commit -m "feat: add negotiation settlement schema"
```

### Task 3: Tenant-safe reviews, instructions and authority store

**Files:**
- Create: `src/server/negotiation/store.ts`
- Create: `src/server/negotiation/store.test.ts`

**Interfaces:**
- Produces: `NegotiationStore.getWorkspace`, `getProtectedWorkspace`, `createReview`, `recordInstruction`, `createAuthorityVersion`, source resolvers and command-receipt helpers.
- Consumes: migration 8, `SessionUser`, `AuditContext`, projections and operational audit/chronology/event/outbox tables.

- [ ] **Step 1: Write failing store tests**

```ts
it('filters protected records before counts and source assembly', () => {
  seedOrdinaryAndProtectedNegotiation(database);
  const ordinary = store.getWorkspace(paralegal, matterId);
  expect(JSON.stringify(ordinary)).not.toContain('protected settlement floor');
  expect(ordinary).not.toHaveProperty('protectedCount');
});

it('rejects a source version from another matter', () => {
  expect(() => store.createReview(ava, matterId, {
    ...reviewInput,
    lossScheduleId: foreignLossScheduleId,
  }, audit)).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
});
```

Test idempotent replay, mismatched idempotency payload `409`, source-manifest digest stability, instruction supersession, expired authority warnings and atomic operational records.

- [ ] **Step 2: Run store tests and confirm RED**

Run: `npm test -- src/server/negotiation/store.test.ts`

Expected: FAIL because `NegotiationStore` does not exist.

- [ ] **Step 3: Implement scoped source resolution and operational append**

```ts
private resolveOffer(firmId: string, matterId: string, offerId: string) {
  return this.requireRow(`
    SELECT id, confidentiality, record_version AS recordVersion
    FROM offers WHERE id = ? AND firm_id = ? AND matter_id = ?
  `, [offerId, firmId, matterId]);
}
```

Resolve documents through `document_versions JOIN documents` constrained by firm and matter. Build canonical manifests with stable ordering and SHA-256 digest. Protected operational metadata uses neutral titles and excludes offer terms, monetary terms, instructions and narrative.

- [ ] **Step 4: Implement reviews, instructions and authority writes**

Each command runs in `BEGIN IMMEDIATE` and writes the domain row, command receipt, audit event, neutral/safe chronology item, domain event and integration outbox entry atomically. Instructions require one exact retained source and an explicit human confirmation. Creating a current authority version supersedes the previous current row through an append-only status event or controlled aggregate pointer rather than updating evidential content.

- [ ] **Step 5: Implement confidentiality-aware workspace assembly**

Return ordinary reviews, instructions, authority and actions only after the confidentiality predicate is applied. `getProtectedWorkspace` separately checks protected capability and returns protected records without copying them into the ordinary response.

- [ ] **Step 6: Run tests and commit**

Run: `npm test -- src/server/negotiation/store.test.ts`

Expected: PASS for tenant scoping, protected absence, immutable sources, idempotency and atomic operational writes.

```bash
git add src/server/negotiation/store.ts src/server/negotiation/store.test.ts
git commit -m "feat: persist negotiation advice and authority"
```

### Task 4: Exact-version action and approval lifecycle

**Files:**
- Modify: `src/server/negotiation/store.ts`
- Modify: `src/server/negotiation/store.test.ts`
- Create: `src/server/negotiation/service.ts`
- Create: `src/server/negotiation/service.test.ts`

**Interfaces:**
- Produces: action store methods and `NegotiationService` methods for preparation, versioning, submission, decisions and external-action recording.
- Consumes: current authority, exact client instructions, policy capabilities and source-linked communication/document records.

- [ ] **Step 1: Write failing action lifecycle tests**

```ts
it('requires instruction and approval for the exact current version', () => {
  const approvedV1 = approveExactVersion(actionV1);
  const actionV2 = service.appendActionVersion(ava, matterId, action.id, changedTerms, audit);
  expect(() => service.recordExternalAction(ava, matterId, action.id, {
    expectedVersion: actionV2.recordVersion,
    actionVersionId: actionV2.currentVersion.id,
    explicitConfirmation: true,
    sourceCommunicationEntryId,
  }, audit)).toThrowError(expect.objectContaining({ code: 'AUTHORITY_REQUIRED' }));
  expect(approvedV1.currentVersion.version).toBe(1);
});
```

Also test internal notes cannot serve as an external source, provider acceptance is not delivery/service, cancelled actions cannot revive, protected actions remain concealed and solicitors cannot self-approve when partner approval is required.

- [ ] **Step 2: Run lifecycle tests and confirm RED**

Run: `npm test -- src/server/negotiation/store.test.ts src/server/negotiation/service.test.ts`

Expected: FAIL because action lifecycle methods are absent.

- [ ] **Step 3: Implement immutable versions and approval events**

```ts
createAction(user, matterId, input, audit)
appendActionVersion(user, matterId, actionId, input, audit)
submitAction(user, matterId, actionId, input, audit)
recordApprovalDecision(user, matterId, actionId, input, audit)
recordExternalAction(user, matterId, actionId, input, audit)
```

Appending a version creates an `invalidated` event for the prior approval projection. The service compares the current version ID, instruction action version, current authority constraints and exact approval event before allowing the external fact to be recorded.

- [ ] **Step 4: Implement typed service errors and capability gates**

Use codes `INVALID_STATE`, `CONFLICT`, `INSTRUCTION_REQUIRED`, `AUTHORITY_REQUIRED`, `APPROVAL_REQUIRED`, `SOURCE_REQUIRED`, `FORBIDDEN` and `NOT_FOUND`. Error messages identify the missing gate without including protected terms.

- [ ] **Step 5: Run lifecycle tests and commit**

Run: `npm test -- src/server/negotiation/store.test.ts src/server/negotiation/service.test.ts`

Expected: PASS for exact-version authority, invalidation, roles, external-source truth and protected concealment.

```bash
git add src/server/negotiation/store.ts src/server/negotiation/store.test.ts src/server/negotiation/service.ts src/server/negotiation/service.test.ts
git commit -m "feat: govern exact negotiation actions"
```

### Task 5: Settlement terms, obligations and workflow readiness

**Files:**
- Modify: `src/server/negotiation/store.ts`
- Modify: `src/server/negotiation/store.test.ts`
- Modify: `src/server/negotiation/service.ts`
- Modify: `src/server/negotiation/service.test.ts`
- Create: `src/server/negotiation/readiness.ts`
- Create: `src/server/negotiation/readiness.test.ts`
- Modify: `src/server/workflow/types.ts`
- Modify: `src/server/workflow/definitions.ts`
- Modify: `src/server/workflow/service.ts`
- Modify: `src/server/workflow/service.test.ts`

**Interfaces:**
- Produces: settlement and obligation store/service methods, `NegotiationReadinessProvider`, explicit `allowedNextStageKeys` and objective Negotiation/Settlement controls.
- Consumes: exact action authority, instrument document versions and workflow transition commands.

- [ ] **Step 1: Write failing settlement and obligation tests**

Cover exact-term conclusion, unknown court-approval position, missing instrument, current instruction/approval, required approval not obtained, obligation assertion vs satisfaction, evidence-backed satisfaction, partner-only waiver and correction-by-supersession.

```ts
expect(() => service.concludeSettlement(ava, matterId, settlementId, {
  expectedVersion: 2,
  termsVersionId,
  courtApprovalPosition: 'unknown',
  explicitHumanConfirmation: true,
}, audit)).toThrowError(expect.objectContaining({ code: 'COURT_APPROVAL_REVIEW_REQUIRED' }));
```

- [ ] **Step 2: Write failing readiness and alternate-path tests**

```ts
expect(readiness.getNegotiationReadiness(firmId, matterId).controls)
  .toContainEqual(expect.objectContaining({
    key: 'settlement_authority_recorded', eligible: true,
  }));

expect(service.transitionStage(ava, matterId, {
  expectedVersion,
  toStageKey: 'settlement',
  completedChecklistKeys: ['settlement_authority_recorded'],
  reason: 'Settlement terms agreed before issue.',
  override: false,
}, audit).workflow.currentStageKey).toBe('settlement');
```

- [ ] **Step 3: Run focused tests and confirm RED**

Run: `npm test -- src/server/negotiation/service.test.ts src/server/negotiation/readiness.test.ts src/server/workflow/service.test.ts`

Expected: FAIL because settlement methods, readiness and alternate transitions are absent.

- [ ] **Step 4: Implement settlement term versions and conclusion gates**

Implement `createSettlement`, `appendSettlementTerms`, `concludeSettlement`, `createObligation` and `recordObligationEvent`. Conclusion requires the exact current terms, matching instruction and approval, reviewed court-approval position, obtained approval when required, retained instrument/source and reviewed structured obligations.

- [ ] **Step 5: Implement readiness and explicit alternate transitions**

Add optional `allowedNextStageKeys` to workflow stages. Define negotiation as `['proceedings', 'settlement']`; all other stages retain their existing sequential next stage. `WorkflowService` asks `NegotiationReadinessProvider` for controls at Negotiation and Settlement and refuses browser-supplied checklist keys not supported by the projection.

- [ ] **Step 6: Run focused and regression tests**

Run: `npm test -- src/server/negotiation/store.test.ts src/server/negotiation/service.test.ts src/server/negotiation/readiness.test.ts src/server/workflow/service.test.ts src/server/workflow/store.test.ts`

Expected: PASS, including the existing sequential workflow tests.

- [ ] **Step 7: Commit**

```bash
git add src/server/negotiation src/server/workflow/types.ts src/server/workflow/definitions.ts src/server/workflow/service.ts src/server/workflow/service.test.ts
git commit -m "feat: govern settlement terms and obligations"
```

### Task 6: Policy and HTTP boundary

**Files:**
- Create: `src/server/negotiation/routes.ts`
- Create: `src/server/negotiation/routes.test.ts`
- Modify: `src/server/policy.ts`
- Modify: `src/server/policy.test.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/app.test.ts`

**Interfaces:**
- Produces: negotiation/settlement capabilities and the approved REST surface.
- Consumes: strict schemas, `NegotiationService`, existing secure session/origin/error conventions.

- [ ] **Step 1: Write failing policy and route tests**

```ts
expect(hasCapability(user('partner'), 'settlement.waive_obligation')).toBe(true);
expect(hasCapability(user('solicitor'), 'negotiation.record_instruction')).toBe(true);
expect(hasCapability(user('paralegal'), 'negotiation.approve')).toBe(false);
expect(hasCapability(user('finance'), 'negotiation.read')).toBe(false);
```

Route tests cover `401`, finance `403`, cross-firm `404`, explicit protected endpoint, ordinary protected-content absence, validation `400`, stale version/idempotency `409` and successful commands.

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm test -- src/server/policy.test.ts src/server/negotiation/routes.test.ts src/server/app.test.ts`

Expected: FAIL because capabilities and routes are absent.

- [ ] **Step 3: Add capabilities and evaluation role mapping**

Add exactly the capabilities from the design. Partner/admin receive all. Solicitor receives read/protected/prepare/instruction/external-action/manage/conclude. Paralegal receives ordinary read and prepare. Finance/readonly receive none.

- [ ] **Step 4: Implement and register routes**

Parse every mutation with its named schema. Pass only server-derived `SessionUser`, route matter ID and audit context to the service. Map domain errors to the existing safe envelope and never include protected terms in errors.

- [ ] **Step 5: Run route/security tests and commit**

Run: `npm test -- src/server/policy.test.ts src/server/negotiation/routes.test.ts src/server/app.test.ts src/server/security.test.ts`

Expected: PASS for role, tenant, confidentiality, CSRF/origin and response safety.

```bash
git add src/server/negotiation/routes.ts src/server/negotiation/routes.test.ts src/server/policy.ts src/server/policy.test.ts src/server/app.ts src/server/app.test.ts
git commit -m "feat: expose negotiation settlement commands"
```

### Task 7: Matter 360 Negotiation and Settlement workspace

**Files:**
- Create: `src/client/components/matter/NegotiationSettlementPanel.tsx`
- Create: `src/client/components/matter/NegotiationReviewDialog.tsx`
- Create: `src/client/components/matter/ClientInstructionDialog.tsx`
- Create: `src/client/components/matter/NegotiationActionDialog.tsx`
- Create: `src/client/components/matter/SettlementDialog.tsx`
- Create: `src/client/components/matter/ObligationEventDialog.tsx`
- Create: `src/client/components/matter/NegotiationSettlementPanel.test.tsx`
- Modify: `src/client/api.ts`
- Modify: `src/client/pages/MatterPage.tsx`
- Modify: `src/client/components/matter/MatterSectionRail.tsx`
- Modify: `src/client/App.test.tsx`
- Modify: `src/client/styles.css`

**Interfaces:**
- Produces: lazy `negotiation_settlement` Matter section and accessible Position, Advice & instructions, Authority, Settlement & compliance views.
- Consumes: ordinary and explicit protected workspace APIs plus command endpoints from Task 6.

- [ ] **Step 1: Write failing UI tests**

```tsx
it('does not expose protected terms before the explicit load action', async () => {
  render(<NegotiationSettlementPanel workspace={ordinaryWorkspace} {...callbacks} />);
  expect(screen.queryByText('protected settlement floor')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Load protected negotiation records' }));
  expect(callbacks.onLoadProtected).toHaveBeenCalledOnce();
});

it('explains why external action is blocked', () => {
  render(<NegotiationSettlementPanel workspace={approvalPendingWorkspace} {...callbacks} />);
  expect(screen.getByText('Partner approval required for this exact version')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Record external action' })).toBeDisabled();
});
```

Test approval invalidation, assertion-vs-satisfaction wording, external/conclusion confirmation dialogs, source hashes, loading/error states and keyboard controls.

- [ ] **Step 2: Run UI tests and confirm RED**

Run: `npm test -- src/client/components/matter/NegotiationSettlementPanel.test.tsx src/client/App.test.tsx`

Expected: FAIL because the section and components do not exist.

- [ ] **Step 3: Add client contracts and lazy loading**

Add `NegotiationSettlementWorkspace`, protected workspace, review, instruction, authority, action, settlement, obligation and permission types. Add `negotiation_settlement` to `MatterSection`. Fetch only when that section is selected and abort stale requests.

- [ ] **Step 4: Implement the four-view workspace**

Render source facts separately from human analysis. Protected records appear only from the explicit protected response. Use stable IDs for list keys, native buttons, labelled controls and existing `Dialog`. Display exact source record/version/hash and permanent non-validity warnings.

- [ ] **Step 5: Implement controlled dialogs**

Dialogs collect the exact structured fields required by each command. External-action and settlement-conclusion commands require a second confirmation dialog. Obligation events label `performance_asserted` as unverified and restrict waiver controls to permission-bearing users.

- [ ] **Step 6: Add responsive styling and run client tests**

Run: `npm test -- src/client/components/matter/NegotiationSettlementPanel.test.tsx src/client/App.test.tsx`

Expected: PASS at component and application routing boundaries.

- [ ] **Step 7: Run React quality review and commit**

Check hook dependencies, derived state, semantic controls, stable keys, lazy loading and narrow-screen layout before committing.

```bash
git add src/client/api.ts src/client/pages/MatterPage.tsx src/client/components/matter/MatterSectionRail.tsx src/client/components/matter/NegotiationSettlementPanel.tsx src/client/components/matter/NegotiationReviewDialog.tsx src/client/components/matter/ClientInstructionDialog.tsx src/client/components/matter/NegotiationActionDialog.tsx src/client/components/matter/SettlementDialog.tsx src/client/components/matter/ObligationEventDialog.tsx src/client/components/matter/NegotiationSettlementPanel.test.tsx src/client/App.test.tsx src/client/styles.css
git commit -m "feat: add negotiation settlement workspace"
```

### Task 8: Synthetic Maya negotiation journey and documentation

**Files:**
- Create: `src/server/negotiation/seed.test.ts`
- Modify: `src/server/database.ts`
- Modify: `src/server/index.ts`
- Modify: `README.md`

**Interfaces:**
- Produces: idempotent `seedNegotiationSettlementEvaluation(database)` and a documented pilot journey.
- Consumes: Maya's approved work/loss schedules, valuation, protected Part 36 offer, documents, communications and workflow.

- [ ] **Step 1: Write the failing seed test**

```ts
await seedNegotiationSettlementEvaluation(database);
await seedNegotiationSettlementEvaluation(database);
const workspace = service.getWorkspace(ava, SEED_IDS.northstarMatter);
expect(workspace.currentReview).toMatchObject({ confidentiality: 'privileged' });
expect(workspace.currentInstruction).toMatchObject({ instructionType: 'counter' });
expect(workspace.currentAction).toMatchObject({
  confidentiality: 'protected_negotiation',
  state: 'approval_required',
  canRecordExternalAction: false,
});
expect(countRows(database, 'negotiation_actions')).toBe(1);
```

- [ ] **Step 2: Run seed test and confirm RED**

Run: `npm test -- src/server/negotiation/seed.test.ts`

Expected: FAIL because the seed function is absent.

- [ ] **Step 3: Seed the approved Maya journey idempotently**

Advance Repairs and quantum to Negotiation through the existing readiness controls. Create the privileged review, synthetic accessible advice record, exact client counter instruction, current authority version, protected counteroffer action and submitted/pending partner approval. Do not record an external act.

- [ ] **Step 4: Update README**

Document the new feature, security boundary, migration 8, APIs, architecture module and evaluation steps. State that no live communication, autonomous advice, legal validity decision or Proceedings feature is included.

- [ ] **Step 5: Run seed and documentation checks and commit**

Run: `npm test -- src/server/negotiation/seed.test.ts src/server/database.test.ts src/server/workflow/service.test.ts`

Expected: PASS with one seeded journey after two invocations.

Run: `git diff --check`

Expected: no whitespace errors.

```bash
git add src/server/negotiation/seed.test.ts src/server/database.ts src/server/index.ts README.md
git commit -m "feat: seed negotiation settlement pilot"
```

### Task 9: Full verification and GitHub integration

**Files:**
- No planned source changes. Failures return to the owning task and receive a focused regression test before verification restarts.

**Interfaces:**
- Produces: a reviewed branch merged to `main` through a GitHub pull request.
- Consumes: the complete milestone.

- [ ] **Step 1: Run complete automated verification**

Run: `npm test`

Expected: every test file and test passes with zero failures.

Run: `npm run typecheck`

Expected: client and server TypeScript checks pass.

Run: `npm run build`

Expected: server compilation and Vite production build pass.

Run: `npm audit --omit=dev`

Expected: zero production vulnerabilities.

- [ ] **Step 2: Run a fresh production-mode API journey**

Verify:

```text
solicitor ordinary workspace                         200
finance workspace                                    403
cross-firm workspace                                 404
ordinary response contains protected narrative      false
protected load by authorised solicitor               200
stale action external attempt                        409
pending partner approval external attempt            409
performance assertion projected as satisfied         false
settlement closure with outstanding obligation       409
```

- [ ] **Step 3: Run browser verification or supported fallback**

Run: `agent-browser --version`. If available, verify lazy loading, four tabs, protected gate, exact authority blocker, confirmation dialogs and 390-pixel layout. If unavailable, record the command-not-found limitation and rely on passing Testing Library tests plus the production-mode Fastify journey.

- [ ] **Step 4: Review confidentiality and scope**

Run:

```bash
git diff --check origin/main...HEAD
git status --short
git diff --name-only origin/main...HEAD
```

Confirm there are no secrets, databases, recordings, client material, SwiftBridge changes or unrelated refactors. Self-review the complete diff because subagent delegation is unavailable in this environment.

- [ ] **Step 5: Publish and merge**

Publish the exact verified tree to `feat/negotiation-settlement`, open a ready pull request with verification evidence, inspect GitHub status, and squash-merge only if the expected head SHA is unchanged and GitHub accepts the merge.
