# Matter Closure & Reopening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a governed end-to-end matter closure, archive and reopening lifecycle with objective readiness, immutable evidence, independent authority and read-only closed-matter enforcement.

**Architecture:** Add a bounded `closure` domain beside workflow and finance. Migration 14 stores append-only readiness snapshots, preparation/approval/closure events, post-closure obligations, retention schedules, legal holds, active periods and audit/outbox evidence; server projections derive blockers from authoritative domain tables. Fastify exposes matter-scoped commands and a lazy Matter 360 workspace, while central mutation guards prevent closed matters being changed through older routes.

**Tech Stack:** TypeScript 7, Node 24 SQLite, Fastify 5, Zod 4, React 19, Vitest, Testing Library, Vite.

## Global Constraints

- Closure is never a direct matter-status toggle.
- Critical client-money, court, undertaking, complaint, settlement and legal-hold facts cannot be overridden away.
- A residual issue may survive closure only as a named post-closure obligation with owner, due date, reason and source blocker.
- Preparation and approval must be performed by different authorised humans.
- Closed and archived matters remain searchable and readable but ordinary domain mutations fail closed.
- Reopening appends a new active period and never rewrites the original closure record.
- Legal holds suspend destruction eligibility; no automatic deletion or destruction is implemented.
- Every command is tenant-scoped, idempotent, audited and rejects AI/autonomous authority.
- The dedicated Legal Costs module is outside this milestone and must not start without user approval.

---

### Task 1: Immutable closure schema and pure readiness model

**Files:**
- Create: `src/server/migrations/014-matter-closure-reopening.ts`
- Modify: `src/server/migrations/index.ts`
- Create: `src/server/closure/types.ts`
- Create: `src/server/closure/readiness.ts`
- Test: `src/server/closure/readiness.test.ts`
- Test: `src/server/migrations.test.ts`

**Interfaces:**
- Produces: `ClosureBlocker`, `ClosureReadinessSnapshot`, `classifyClosureReadiness(input)` and migration version 14.
- Consumes: integer-minor finance values and current authoritative task/deadline/settlement records.

- [ ] Write failing tests proving critical blockers cannot be transferred, eligible residual blockers require complete owner/due-date/reason data, and an all-clear snapshot is closable.
- [ ] Run `npm test -- src/server/closure/readiness.test.ts src/server/migrations.test.ts` and confirm failure because the domain and migration do not exist.
- [ ] Add strict tenant-scoped tables for closure reviews, immutable blockers, decisions, active periods, post-closure obligations, retention schedules, legal holds and closure events, including update/delete prevention triggers.
- [ ] Implement the pure classifier with explicit blocker severity and transfer eligibility.
- [ ] Rerun the focused tests and commit `feat: add governed closure foundation`.

### Task 2: Authoritative readiness, preparation and approval service

**Files:**
- Create: `src/server/closure/store.ts`
- Create: `src/server/closure/service.ts`
- Test: `src/server/closure/store.test.ts`
- Test: `src/server/closure/service.test.ts`
- Modify: `src/server/policy.ts`

**Interfaces:**
- Produces: `ClosureStore.getWorkspace`, `prepareClosure`, `approveClosure`, `closeMatter`, `addLegalHold`, `releaseLegalHold` and role capabilities `closure.read`, `closure.prepare`, `closure.approve`, `closure.reopen`, `closure.manage_hold`.
- Consumes: matter membership, posted finance facts, bill balances, latest task/deadline statuses and latest settlement-obligation events.

- [ ] Write failing store tests for client/office balances, open tasks/deadlines, unresolved settlement obligations and fresh immutable readiness snapshots.
- [ ] Write failing service tests for maker-checker authority, stale snapshot rejection, critical-blocker rejection, controlled residual transfer and idempotent command replay.
- [ ] Run the focused tests and confirm the expected missing-service failures.
- [ ] Implement tenant-scoped transactional commands, audit/outbox records and exact freshness rechecks immediately before approval and close.
- [ ] Add capabilities so solicitors prepare, partners approve/reopen/manage holds, readonly users only inspect, and finance users cannot close legal matters.
- [ ] Rerun the focused tests and commit `feat: govern matter closure authority`.

### Task 3: Central read-only enforcement and governed reopening

**Files:**
- Modify: `src/server/store.ts`
- Modify: `src/server/app.ts`
- Modify: domain route/service entry points under `src/server/{workflow,intake,evidence,protocol,quantum,communications,negotiation,proceedings,pleadings,disclosure,finance}` as required by the central guard
- Create: `src/server/closure/mutation-guard.ts`
- Test: `src/server/closure/mutation-guard.test.ts`
- Test: `src/server/closure/reopening.test.ts`

**Interfaces:**
- Produces: `assertMatterMutable(database, firmId, matterId)` and `reopenMatter`.
- Consumes: latest closure/reopening event and active-period state.

- [ ] Write failing tests proving old matter/task/document and specialist-domain mutation routes reject a closed matter while reads remain available.
- [ ] Write failing reopening tests requiring a reason, new responsible owner, independent authority and a new active period.
- [ ] Run tests and confirm mutations currently succeed against closed fixtures.
- [ ] Apply the guard at the common authenticated mutation boundary, exempting only closure/hold/reopening commands.
- [ ] Implement reopening as an append-only event that sets operational matter status back to open without altering prior evidence.
- [ ] Rerun security, cross-firm and read-only tests; commit `feat: enforce archived matter boundaries`.

### Task 4: Authenticated closure API and strict contracts

**Files:**
- Modify: `src/shared/contracts.ts`
- Create: `src/server/closure/routes.ts`
- Test: `src/server/contracts.closure.test.ts`
- Test: `src/server/closure/routes.test.ts`
- Modify: `src/server/app.ts`
- Modify: `src/client/api.ts`

**Interfaces:**
- Produces: `GET /api/matters/:matterId/closure`, preparation/approval/close/reopen/hold commands and `ClosureWorkspace` client DTO.
- Consumes: closure service and authenticated session capability checks.

- [ ] Write RED contract tests rejecting unbounded text, invalid dates, missing explicit-human-authority flags and autonomous/AI authority.
- [ ] Write RED route tests for generic cross-tenant `404`, capability `403`, stable conflicts, idempotent replay and minimal privacy-safe DTOs.
- [ ] Implement Zod commands, central error mapping and route registration.
- [ ] Rerun focused routes, contracts and TypeScript; commit `feat: expose closure lifecycle api`.

### Task 5: Lazy Matter 360 closure workspace

**Files:**
- Create: `src/client/components/matter/ClosurePanel.tsx`
- Create: `src/client/components/matter/ClosureDialogs.tsx`
- Test: `src/client/components/matter/ClosurePanel.test.tsx`
- Modify: `src/client/components/matter/MatterSectionRail.tsx`
- Modify: `src/client/pages/MatterPage.tsx`
- Modify: `src/client/styles.css`

**Interfaces:**
- Produces: lazy `ClosurePanel` and separately lazy command dialogs.
- Consumes: `ClosureWorkspace`, closure routes and exact capability-derived actions.

- [ ] Write failing UI tests for readiness summary, blocker severity, residual-transfer details, final client report, documents returned/retained, retention/legal-hold status, maker-checker actions and full history.
- [ ] Add a Closure & retention rail section and lazy data loader that does not enlarge unrelated matter chunks.
- [ ] Implement semantic responsive cards/tables, labelled controls, text-plus-colour states, focus restoration, retry/error/empty states and 390-pixel layout.
- [ ] Ensure closed matters show a clear read-only banner and only authorised reopening/hold actions.
- [ ] Run component, routing and production-build chunk tests; commit `feat: add matter closure workspace`.

### Task 6: Evaluation journey, security review and release gate

**Files:**
- Create: `src/server/closure/seed.test.ts`
- Modify: `src/server/database.ts`
- Create: `docs/verification/2026-07-22-matter-closure-reopening-verification.md`

**Interfaces:**
- Produces: rerunnable Northstar closure/reopening evaluation journey and release evidence.
- Consumes: all governed closure services and the production UI.

- [ ] Add a test-first idempotent seed journey covering a blocked review, resolved/controlled residual obligations, final reporting, independent approval, closure, legal hold, read-only access and governed reopening.
- [ ] Run the seed twice and compare row counts, active periods, history and operational status.
- [ ] Review tenant isolation, stale facts, integer finance arithmetic, immutable triggers, audit entity IDs, retention dates, maker-checker boundaries and absence of deletion/Legal Costs behaviour.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build` and `git diff --check`; record exact results.
- [ ] Inspect the staged diff, commit `feat: deliver matter closure and reopening`, and stop for user approval before Legal Costs.

## Self-review

- Spec coverage: final reporting, balances, document return, retention, closure reason/outcome/lessons, archived access, legal holds and reopening history each map to Tasks 1–6.
- Placeholder scan: no deferred production behaviour or unbounded “handle errors” step remains.
- Type consistency: `ClosureWorkspace` is the single server/client projection; all commands use the same closure service and central mutation guard.
