# Repairs and Quantum Implementation Plan

> **Execution:** Follow this plan task by task with test-driven development. Every behavior begins with a failing focused test, then the smallest implementation, then focused and regression verification.

**Goal:** Make SwiftClaim's Housing Conditions Repairs and quantum stage operational with governed work schedules, repair evidence, loss schedules, human valuation reviews, protected offers and objective workflow readiness.

**Architecture:** Add a bounded `quantum` domain beside evidence and protocol. `QuantumStore` owns tenant-scoped persistence and atomic record appends; pure calculation/projection modules own deterministic money and repair state; `QuantumService` owns permission, invariants, approval, confidentiality and readiness; `QuantumReadinessProvider` plugs into the existing workflow service. The React matter page lazy-loads one Repairs & quantum workspace with Repairs, Quantum and Offers views.

**Tech stack:** TypeScript, Node.js 24 `node:sqlite`, Fastify, Zod, React 19, Vitest, Testing Library, Vite, the existing private file/evidence model and workflow engine.

**Design:** `docs/superpowers/specs/2026-07-15-repairs-quantum-design.md`

---

## Task 1: Contracts, exact money and repair projections

**Files**

- Create: `src/server/quantum/types.ts`
- Create: `src/server/quantum/calculations.ts`
- Create: `src/server/quantum/calculations.test.ts`
- Create: `src/server/quantum/repair-projection.ts`
- Create: `src/server/quantum/repair-projection.test.ts`
- Modify: `src/shared/contracts.ts`
- Modify: `src/server/contracts.protocol.test.ts`

### 1. Write failing calculation tests

Cover:

- fixed, quantity-rate, period-rate and reviewed-manual amounts;
- exact decimal quantities without binary floating-point drift;
- documented half-up penny rounding;
- negative, malformed, excessive-precision and unsafe integer rejection;
- totals by category and claim position;
- separate general-damages range and combined mathematical display;
- evidence-gap count and unsupported amount.

Run:

```bash
npm test -- src/server/quantum/calculations.test.ts
```

Expected: FAIL because the module does not exist.

### 2. Implement exact calculation primitives

Use integer minor units and parsed decimal numerator/scale values. Never accept JavaScript floating-point money at a command boundary. Return structured validation failures rather than silently coercing values.

### 3. Write failing repair-projection tests

Cover:

- proposed, appointment, access, started, paused and current statuses;
- completion assertion remaining unverified;
- client dispute and failed inspection overriding an assertion;
- verified completion requiring verifier and completion evidence;
- correction by explicit supersession;
- urgent/overdue warnings without inferring breach or refusal;
- deterministic ordering when occurred times match.

### 4. Implement the pure event fold

The function receives a current work item, valid append-only events and an `asOf` date. It returns status, producing event, access outcome, assertion/client/verification positions and warnings.

### 5. Add Zod command contracts and transport-neutral types

Define enums and schemas for work schedules/items, repair events, loss schedules/items, valuation reviews, offers, Part 36 review and event commands. Use strict ISO date/time fields, digit-string money inputs or integer minor-unit outputs, expected versions and bounded notes.

### 6. Verify and commit

```bash
npm test -- src/server/quantum/calculations.test.ts src/server/quantum/repair-projection.test.ts src/server/contracts.protocol.test.ts
npm run typecheck
git add src/server/quantum src/shared/contracts.ts src/server/contracts.protocol.test.ts
git commit -m "feat: define quantum calculations and commands"
```

## Task 2: Persistence migration and immutability

**Files**

- Create: `src/server/migrations/006-repairs-quantum.ts`
- Modify: `src/server/migrations/index.ts`
- Modify: `src/server/migrations.test.ts`
- Modify: `src/server/database.test.ts`

### 1. Write failing migration tests

Assert:

- migration 6 follows migration 5 and is checksum-protected;
- all design tables, indexes, foreign keys and checks exist;
- every domain row is firm- and matter-scoped;
- money is integer minor units and currency is constrained;
- approved schedules, repair events, approved loss lines, valuation reviews, offer events and evidence links cannot be updated or deleted;
- draft records permit only intended updates;
- cross-matter defect/evidence links fail;
- duplicate schedule versions, stable references and idempotency identities fail.

Run:

```bash
npm test -- src/server/migrations.test.ts src/server/database.test.ts
```

Expected: FAIL because migration 6 is absent.

### 2. Implement migration 6

Create:

- `work_schedules`, `work_items`, `work_item_defects`, `work_item_evidence_links`, `repair_events`;
- `loss_schedules`, `loss_items`, `loss_item_evidence_links`;
- `general_damages_reviews`;
- `offers`, `part_36_terms`, `offer_events`;
- `quantum_command_receipts` for idempotent commands where replay is legally material.

Add append-only and approved-record triggers with explicit error messages. Add composite indexes used by firm/matter-scoped reads and projections.

### 3. Verify and commit

```bash
npm test -- src/server/migrations.test.ts src/server/database.test.ts
npm run typecheck
git add src/server/migrations src/server/database.test.ts src/server/migrations.test.ts
git commit -m "feat: persist repairs quantum and offers"
```

## Task 3: Tenant-scoped store and atomic record operations

**Files**

- Create: `src/server/quantum/store.ts`
- Create: `src/server/quantum/store.test.ts`

### 1. Write failing store tests

Test:

- creating draft work and loss schedules with deterministic next versions;
- copying an approved schedule into a revision while retaining lineage keys;
- approving schedules and superseding the prior approved version atomically;
- appending repair and offer events;
- creating valuation reviews and superseding by reference;
- exact workspace projection reads;
- firm and matter isolation with generic absence;
- stale expected-version conflicts;
- idempotent command replay returns the original result;
- rollback when audit/domain/outbox insertion fails;
- protected and open offer queries are physically separate methods.

Run:

```bash
npm test -- src/server/quantum/store.test.ts
```

Expected: FAIL because `QuantumStore` does not exist.

### 2. Implement `QuantumStore`

Follow the current explicit-statement store style. Every query receives firm and matter IDs. Mutating public methods support an existing transaction or own one `BEGIN IMMEDIATE` transaction and append timeline, audit, domain-event and outbox records with safe labels.

Do not return protected offer details from the ordinary workspace method.

### 3. Verify and commit

```bash
npm test -- src/server/quantum/store.test.ts src/server/evidence/store.test.ts src/server/protocol/store.test.ts
npm run typecheck
git add src/server/quantum/store.ts src/server/quantum/store.test.ts
git commit -m "feat: add tenant scoped quantum store"
```

## Task 4: Service invariants, approval and confidentiality

**Files**

- Create: `src/server/quantum/service.ts`
- Create: `src/server/quantum/service.test.ts`
- Modify: `src/server/policy.ts`
- Modify: `src/server/policy.test.ts`

### 1. Write failing policy tests

Add capabilities:

- `quantum.read`, `quantum.write`, `quantum.approve`;
- `offers.read_open`, `offers.read_protected`, `offers.write`, `offers.record_outcome`.

Partners/admins approve and see protected offers; solicitors write and record governed outcomes; paralegals prepare drafts and repair events but cannot approve or see protected terms; finance has no access.

### 2. Write failing service tests

Cover:

- matter membership and generic non-disclosure;
- work-schedule creation with existing defect/source verification;
- approved schedule immutability and revision;
- verified-complete evidence/verifier requirement;
- factual access events without inferred labels;
- loss-item server recalculation ignoring supplied totals;
- one-currency invariant and unsupported evidence projection;
- approval permission and completeness checks;
- valuation range ordering and required human basis;
- offer type/confidentiality consistency;
- Part 36 required fields, service confirmation and reviewable date projection;
- acceptance/withdrawal as retained events only, never external communication;
- protected reads denied without capability;
- stale version, replay and audit behavior.

### 3. Implement `QuantumService`

Use narrow store methods and pure functions. Verify linked defect, evidence and document IDs belong to the authorised matter. Return safe typed workspace projections. Keep protected-offer access in a distinct method and DTO.

### 4. Verify and commit

```bash
npm test -- src/server/policy.test.ts src/server/quantum/service.test.ts
npm run typecheck
git add src/server/quantum/service.ts src/server/quantum/service.test.ts src/server/policy.ts src/server/policy.test.ts
git commit -m "feat: govern repairs damages and offers"
```

## Task 5: Objective workflow readiness

**Files**

- Modify: `src/server/quantum/service.ts`
- Modify: `src/server/quantum/service.test.ts`
- Modify: `src/server/workflow/service.ts`
- Modify: `src/server/workflow/service.test.ts`
- Modify: `src/server/workflow/definitions.test.ts`

### 1. Write failing readiness tests

Assert `works_status_reviewed` eligibility requires an approved current schedule, a projected status for each live work item and explicit review of urgent, overdue, access and completion-verification warnings.

Assert `damages_schedule_reviewed` eligibility requires an approved reproducible loss schedule, acknowledged evidence gaps and a current human general-damages review or authorised `none presently advanced` review.

Assert:

- work need not be complete;
- browser-supplied checklist keys cannot bypass objective blockers;
- protected offer content never appears in blocker text;
- partner/admin reasoned override continues to work and retain blockers;
- readiness changes after a material superseding schedule or review.

### 2. Implement `QuantumReadinessProvider`

Expose the same narrow provider shape used by evidence and protocol. Inject it into `WorkflowService` after those providers. Only validate checklist keys belonging to the Repairs and quantum stage.

### 3. Verify and commit

```bash
npm test -- src/server/quantum/service.test.ts src/server/workflow/service.test.ts src/server/workflow/definitions.test.ts
npm run typecheck
git add src/server/quantum/service.ts src/server/quantum/service.test.ts src/server/workflow
git commit -m "feat: enforce repairs and quantum readiness"
```

## Task 6: Fastify routes and app composition

**Files**

- Create: `src/server/quantum/routes.ts`
- Create: `src/server/quantum/routes.test.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/app.test.ts`

### 1. Write failing route tests

Test every design endpoint for:

- authentication;
- firm and matter isolation;
- role/capability enforcement;
- validation and bounded request bodies;
- optimistic conflicts;
- idempotent replays;
- correct status codes and safe error bodies;
- ordinary workspace excluding protected terms;
- protected endpoint requiring capability;
- mutation audit/request context.

### 2. Implement `quantumRoutes`

Register resource-specific routes with schemas and existing `requireUser`/matter posture. Do not duplicate business rules in handlers.

Compose `QuantumStore` and `QuantumService` in `buildApp`, inject readiness into `WorkflowService`, and extend the public permission projection without exposing sensitive data.

### 3. Verify and commit

```bash
npm test -- src/server/quantum/routes.test.ts src/server/app.test.ts src/server/security.test.ts
npm run typecheck
git add src/server/quantum/routes.ts src/server/quantum/routes.test.ts src/server/app.ts src/server/app.test.ts
git commit -m "feat: expose repairs and quantum api"
```

## Task 7: Client contracts and workspace views

**Files**

- Modify: `src/client/api.ts`
- Create: `src/client/components/matter/RepairsQuantumPanel.tsx`
- Create: `src/client/components/matter/RepairsQuantumPanel.test.tsx`
- Create: `src/client/components/matter/RepairsView.tsx`
- Create: `src/client/components/matter/QuantumView.tsx`
- Create: `src/client/components/matter/OffersView.tsx`
- Create: `src/client/components/matter/QuantumDialogs.tsx`
- Modify: `src/client/components/matter/MatterSectionRail.tsx`
- Modify: `src/client/pages/MatterPage.tsx`
- Modify: `src/client/App.test.tsx`
- Modify: `src/client/styles.css`

### 1. Write failing component tests

Cover:

- lazy loading only when the section is selected;
- tab semantics and keyboard-visible controls;
- repair headline counts and grouped work items;
- assertion, client dispute and verified-complete distinctions;
- urgent/overdue warnings and evidence indicators;
- loss calculation text, totals, general range and evidence gaps;
- schedule approval controls by capability;
- open offers visible in ordinary workspace;
- protected offers fetched only after an authorised explicit action;
- Part 36 legal-review warning;
- no send or automatic response control;
- empty, loading, forbidden, error, validation and version-conflict states;
- refresh after successful mutations.

### 2. Add typed client DTOs and API calls

Mirror safe server projections, keeping protected offer DTOs separate from the ordinary workspace type.

### 3. Implement the workspace

Enable the existing `damages_offers` rail item and label it **Repairs & quantum**. Use three compact views with shared headline position, progressive disclosure for event history and source links, and dialogs for draft commands.

Follow existing visual language and responsive breakpoints. Do not redesign unrelated Matter 360 sections.

### 4. Verify and commit

```bash
npm test -- src/client/components/matter/RepairsQuantumPanel.test.tsx src/client/App.test.tsx
npm run typecheck
npm run build
git add src/client
git commit -m "feat: add repairs and quantum workspace"
```

## Task 8: Extend the Maya evaluation journey

**Files**

- Modify: `src/server/database.ts`
- Modify: `src/server/database.test.ts`
- Create: `src/server/quantum/seed.test.ts`
- Modify: `src/server/protocol/seed.test.ts`
- Modify: `src/client/App.test.tsx`

### 1. Write failing seed tests

On a fresh database, assert Maya has:

- a synthetic reviewed expert report and workflow at Repairs and quantum;
- one approved work schedule with urgent, disputed-completion and verified items;
- evidence links to existing immutable synthetic records;
- one approved loss schedule with supported and acknowledged-gap items;
- one current human general-damages review;
- one open protocol offer and one protected Part 36 offer;
- safe ordinary workspace and authorised protected projection;
- accurate readiness blockers despite incomplete works.

Seed twice and assert no duplicates across every new table, audit, chronology, domain event and outbox. Assert Southbank and finance users cannot discover the records.

### 2. Implement idempotent seeding

Use normal service/store commands where practical. Clearly mark every generated person, fact, figure, source and document as synthetic. Preserve the existing protocol evaluation behavior in focused fixtures even though the default Maya journey advances.

### 3. Verify and commit

```bash
npm test -- src/server/database.test.ts src/server/quantum/seed.test.ts src/server/protocol/seed.test.ts src/client/App.test.tsx
npm run typecheck
git add src/server/database.ts src/server/database.test.ts src/server/quantum/seed.test.ts src/server/protocol/seed.test.ts src/client/App.test.tsx
git commit -m "feat: seed repairs and quantum pilot journey"
```

## Task 9: Documentation and evaluation instructions

**Files**

- Modify: `README.md`
- Modify: `.env.example` only if a documented setting is genuinely added

### 1. Update operating documentation

Document:

- implemented Repairs & quantum capabilities;
- permissions and protected-offer boundary;
- calculation and human-review posture;
- API routes;
- Maya evaluation steps;
- synthetic/live-data warning;
- current architecture and schema migration 6;
- next build as correspondence and communication capture, followed by negotiation authority;
- SwiftBridge remains deferred.

### 2. Verify documentation claims

Cross-check every claimed capability against a route, test and visible UI path. Remove future-tense claims for completed functionality and do not imply production readiness.

### 3. Commit

```bash
git diff --check
git add README.md .env.example
git commit -m "docs: document repairs and quantum workflow"
```

## Task 10: Full verification, review and publication

### 1. Run the complete automated suite

```bash
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

Expected: all tests pass, typecheck/build exit 0, production audit reports no known vulnerabilities.

### 2. Run fresh-database and production HTTP verification

Use a temporary data/storage directory and the production server. Verify:

- migrations from empty database and double seed;
- Ava login and Maya workspace;
- repair event, loss item and safe offer reads;
- Marcus protected-offer access and approval controls;
- ordinary users cannot receive protected terms;
- Lewis cross-firm lookups remain generic 404;
- finance receives no access;
- workflow readiness rejects unsupported confirmation and accepts a valid/overridden transition as designed;
- no external communication is emitted.

### 3. Run browser verification

Inspect desktop and narrow layouts. Exercise Repairs, Quantum and Offers, one safe mutation, a validation failure, protected-offer entry and keyboard navigation. Check console and network errors.

### 4. Review the final diff

```bash
git status --short
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

Check confidentiality, tenant isolation, integer money, immutability, accessible controls, README accuracy and absence of live personal data or secrets.

### 5. Request code review and address findings

Use the code-review workflow against the full branch. Reproduce every actionable issue before changing code, add a regression test, and rerun proportionate verification.

### 6. Publish

Push `feat/repairs-quantum`, create a focused pull request, verify the remote tree and checks, then merge only when all verification remains green. Confirm remote `main` contains the exact reviewed tree.

---

## Completion checklist

- [ ] Exact money calculations are deterministic and tested.
- [ ] Repair assertion, dispute and verification are distinct.
- [ ] Approved schedules and legal events are immutable.
- [ ] Every record is firm- and matter-scoped.
- [ ] Protected offers are absent from ordinary projections.
- [ ] No command sends or accepts an offer externally.
- [ ] Workflow readiness is objective and override remains reasoned.
- [ ] Maya demonstrates one coherent synthetic journey.
- [ ] Full suite, typecheck, build and audit pass.
- [ ] Production HTTP and browser journeys pass.
- [ ] README matches the implemented product.
- [ ] GitHub main contains the verified tree.
