# Governed Billing & Cashroom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build immutable VAT-aware billing, client/office ledgers, controlled cashroom movements, imported bank activity and independently signed reconciliation on the verified finance foundation.

**Architecture:** Extend the bounded finance domain with pure billing/reconciliation calculations, migration 13 and a tenant-safe `BillingCashroomStore`. Reuse the existing balanced journal kernel for all posted positions. Expose strict APIs to lazy matter billing/money panels and a firm-wide Cashroom workspace.

**Tech Stack:** Node.js 24, TypeScript 7, Fastify 5, SQLite `DatabaseSync`, Zod 4, React 19, Vite 8, Vitest 4 and Testing Library.

## Global Constraints

- All money is safe integer minor units with explicit `GBP`; no floating-point money.
- Client, office and neutral positions never net or substitute for one another.
- An issued bill and delivery evidence are required before a costs transfer.
- Client withdrawals use cleared, unrestricted funds for the exact matter/client allocation.
- AI remains provisional and cannot issue, post, approve, match or sign financial facts.
- Issued/posted/imported/signed facts are immutable; correction uses reversal/replacement.
- Every command is tenant-scoped, strict, idempotent, concurrency-protected and atomically audited/outboxed.
- Generic `404` protects inaccessible IDs; stale state and changed replays return `409`.
- This milestone records/imports bank activity but does not initiate a live bank payment.

---

### Task 1: Billing contracts, capabilities and exact calculations

**Files:**
- Create: `src/server/finance/billing-calculations.ts`
- Create: `src/server/finance/billing-calculations.test.ts`
- Create: `src/server/contracts.billing-cashroom.test.ts`
- Modify: `src/shared/contracts.ts`
- Modify: `src/server/finance/types.ts`
- Modify: `src/server/policy.ts`
- Modify: `src/server/policy.test.ts`

**Interfaces:** Produces strict commands, billing/cashroom DTOs, `calculateVat`, `calculateBillTotals`, `validateAllocation`, `calculateAgedDebt` and the eleven new capabilities.

- [ ] Write tests proving decimal/unsafe money, autonomous issue/post fields, dual client/office allocation and invalid VAT fractions fail.
- [ ] Run `npm test -- src/server/contracts.billing-cashroom.test.ts src/server/finance/billing-calculations.test.ts src/server/policy.test.ts`; expect missing exports/capabilities.
- [ ] Implement integer VAT as quotient/remainder snapshots and totals as checked safe-integer sums. Define explicit `standard`, `zero`, `exempt` and `outside_scope` treatments.
- [ ] Add commands for bill draft/submit/approve/issue/deliver, credit notes, bank import, receipt classification/allocation, payments, transfers, reconciliation and export. All schemas are `.strict()` and reject AI authority properties.
- [ ] Add the exact capability matrix from the specification and test finance/partner/solicitor/admin/readonly boundaries.
- [ ] Run the selected tests and `npm run typecheck`; expect green.
- [ ] Commit: `feat: define governed billing calculations`.

### Task 2: Migration 13 and immutable billing/cashroom schema

**Files:**
- Create: `src/server/migrations/013-governed-billing-cashroom.ts`
- Modify: `src/server/migrations/index.ts`
- Modify: `src/server/migrations.test.ts`

**Interfaces:** Produces the persistence model and database invariants consumed by all later tasks.

- [ ] Add failing migration tests for VAT/bill/bank/receipt/payment/reconciliation tables, composite tenant keys, unique bill numbers, statement deduplication and immutable triggers.
- [ ] Run `npm test -- src/server/migrations.test.ts`; expect migration 13 tables to be absent.
- [ ] Create migration 13 with the exact tables listed in the approved specification, `STRICT` checks, composite foreign keys, causal event sequence numbers and update/delete guards.
- [ ] Add an atomic firm bill-number counter/series that can allocate only during issue and cannot reuse a committed number.
- [ ] Add unique statement checksum/provider-line and receipt-fingerprint constraints plus finance command-receipt scope.
- [ ] Run migration tests and `npm run typecheck`; expect green.
- [ ] Commit: `feat: install billing cashroom schema`.

### Task 3: Bill and credit projections

**Files:**
- Create: `src/server/finance/billing.ts`
- Create: `src/server/finance/billing.test.ts`

**Interfaces:** Produces `projectBill`, `projectBillRegister`, `projectWipEligibility` and `projectCreditImpact`.

- [ ] Write failing tests for lifecycle ordering, unissued draft non-consumption, exact issued snapshots, part-payment, credits and cancellation boundaries.
- [ ] Run `npm test -- src/server/finance/billing.test.ts`; expect module-not-found RED.
- [ ] Implement projections from immutable events/source allocations only. Ensure an issued line cannot be repriced and a credit cannot exceed the remaining credited capacity.
- [ ] Add deterministic aged-debt buckets from delivered/issued due dates and allocations, never from mutable status labels.
- [ ] Run selected tests and `npm run typecheck`; expect green.
- [ ] Commit: `feat: project immutable billing states`.

### Task 4: Tenant-safe bill preparation, approval, issue and delivery

**Files:**
- Create: `src/server/finance/billing-cashroom-store.ts`
- Create: `src/server/finance/billing-cashroom-store.bill.test.ts`
- Modify: `src/server/database.ts`

**Interfaces:** Produces `prepareBill`, `submitBill`, `approveBill`, `issueBill`, `recordBillDelivery`, `prepareCreditNote` and `issueCreditNote`.

- [ ] Write store tests for tenant isolation, source eligibility, explicit reductions, independent approval, concurrent numbering, source double-consumption, exact document/checksum, delivery evidence and atomic rollback.
- [ ] Run the bill store test; expect missing store RED.
- [ ] Implement commands with existing transaction/audit/timeline/outbox/idempotency patterns. Issue must revalidate sources and allocate the number inside one `BEGIN IMMEDIATE` transaction.
- [ ] Generate the bill document from immutable snapshots and persist the exact document version/checksum before commit.
- [ ] Implement credits as linked issue transactions; never mutate the original bill or journal.
- [ ] Run selected tests, full server type-check and production document-generation tests; expect green.
- [ ] Commit: `feat: govern bill issue and credits`.

### Task 5: Receipts, allocations, client payments and transfers

**Files:**
- Create: `src/server/finance/billing-cashroom-store.money.test.ts`
- Create: `src/server/finance/cashroom.ts`
- Create: `src/server/finance/cashroom.test.ts`
- Modify: `src/server/finance/billing-cashroom-store.ts`

**Interfaces:** Produces receipt/payment/transfer commands and `projectMatterMoney`/`projectCashbook`.

- [ ] Write failing tests for client, office, mixed and suspense receipts; duplicate blockers; allocation reversals; cleared/restricted funds; bill-before-transfer; matter-specific sufficiency; maker-checker; changed-beneficiary blocking; and no live bank initiation.
- [ ] Run the money tests; expect missing commands/projections RED.
- [ ] Implement immutable receipt evidence and human classifications. Post balanced journals only after an authorised allocation command.
- [ ] Implement payment requisition and independent approval with in-transaction balance recheck. Record external completion evidence without sending a payment.
- [ ] Implement client-to-office transfer limited to delivered bill balance and exact available client funds, with linked client/office entries.
- [ ] Run selected tests and type-check; expect green.
- [ ] Commit: `feat: govern legal cashroom movements`.

### Task 6: Statement import, matching and reconciliation

**Files:**
- Create: `src/server/finance/bank-provider.ts`
- Create: `src/server/finance/reconciliation.ts`
- Create: `src/server/finance/reconciliation.test.ts`
- Create: `src/server/finance/billing-cashroom-store.reconciliation.test.ts`
- Modify: `src/server/finance/billing-cashroom-store.ts`

**Interfaces:** Produces `BankActivityProvider`, `ManualCsvBankProvider`, match suggestions, reconciliation calculation and lifecycle commands.

- [ ] Write failing tests for masked accounts, checksum-idempotent batches, duplicate lines, provisional matches, split/reject decisions, reconciliation equation, difference blocking, immutable completion and independent sign-off.
- [ ] Run reconciliation tests; expect missing modules RED.
- [ ] Implement normalised manual/CSV imports while preserving exact raw evidence hashes. Never store online banking credentials.
- [ ] Implement deterministic match suggestions with amount/date/reference explanations; label AI/rule output provisional.
- [ ] Implement exact reconciliation snapshots and 35-day default next-review projection. Require zero difference and a distinct signatory.
- [ ] Run selected tests and type-check; expect green.
- [ ] Commit: `feat: reconcile imported bank activity`.

### Task 7: Authenticated API and safe financial evidence

**Files:**
- Create: `src/server/finance/billing-cashroom-routes.ts`
- Create: `src/server/finance/billing-cashroom-routes.test.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/storage.ts`

**Interfaces:** Produces strict `/api/finance/billing/*` and `/api/finance/cashroom/*` commands/queries and exact authorised downloads.

- [ ] Write route tests for authentication, capability boundaries, generic cross-tenant `404`, stale/replay `409`, multipart statement evidence, exports and finance-only document grants.
- [ ] Run route tests; expect route-not-found RED.
- [ ] Register all commands against authenticated user context and strict schemas; map domain errors without leaking record existence.
- [ ] Permit exact bill/evidence downloads only through a bill/cashroom grant, not the general matter-document path.
- [ ] Run route/app/security tests, type-check and build; expect green.
- [ ] Commit: `feat: expose governed billing cashroom api`.

### Task 8: Idempotent Northstar evaluation journey

**Files:**
- Modify: `src/server/database.ts`
- Create: `src/server/finance/billing-cashroom-seed.test.ts`

**Interfaces:** Produces a rerunnable end-to-end financial scenario for UI and release evaluation.

- [ ] Write the seed test asserting bill `SC-2026-000001`, exact bill/VAT totals, receipt allocation, partial transfer, zero-difference reconciliation, suspense receipt and blocked beneficiary warning.
- [ ] Run the seed test; expect absent facts RED.
- [ ] Seed entirely through governed services/stores with stable UUIDs and idempotency keys; do not direct-insert posted business facts.
- [ ] Re-run twice and assert counts, bill number and all balances are unchanged.
- [ ] Run seed/full database tests and type-check; expect green.
- [ ] Commit: `feat: seed billing cashroom journey`.

### Task 9: Matter billing and money workspace

**Files:**
- Create: `src/client/components/matter/BillingPanel.tsx`
- Create: `src/client/components/matter/BillingPanel.test.tsx`
- Create: `src/client/components/matter/BillingDialogs.tsx`
- Create: `src/client/components/matter/BillingDialogs.test.tsx`
- Modify: `src/client/pages/MatterPage.tsx`
- Modify: `src/client/api.ts`
- Modify: `src/client/styles.css`

**Interfaces:** Produces lazy Matter 360 Billing, Money and History views with permission-safe commands.

- [ ] Write UI tests for eligible-source selection, adjustments, approval/issue/delivery, client/office separation, transfer sufficiency, immutable drill-down and stable retry idempotency keys.
- [ ] Run selected UI tests; expect missing components RED.
- [ ] Implement lazy panels/dialogs and typed API methods. Totals must drill down to exact sources; no command renders without its capability.
- [ ] Ensure responsive tables, keyboard operation, focus restoration, accessible error summaries and no colour-only status meaning.
- [ ] Run UI tests, type-check and build; expect separate lazy chunks.
- [ ] Commit: `feat: deliver matter billing workspace`.

### Task 10: Firm Cashroom workspace and exports

**Files:**
- Create: `src/client/pages/CashroomPage.tsx`
- Create: `src/client/pages/CashroomPage.test.tsx`
- Create: `src/client/components/cashroom/CashroomDialogs.tsx`
- Modify: `src/client/App.tsx`
- Modify: `src/client/components/AppShell.tsx`
- Modify: `src/client/api.ts`
- Modify: `src/client/styles.css`

**Interfaces:** Produces Bills, Receipts, Payments, Bank, Reconciliation and Exceptions queues plus audited CSV exports.

- [ ] Write UI tests for finance-only routing, queue filtering, provisional match decisions, reconciliation/sign-off separation, aged debt, exceptions and export manifests.
- [ ] Run selected tests; expect route/component RED.
- [ ] Implement the lazy firm-wide workspace with exact permissions, masked bank identifiers and source drill-down.
- [ ] Create server-generated CSV exports with fixed column schemas, injection-safe cells, filter manifest and SHA-256 checksum.
- [ ] Run UI/API tests, type-check and build; expect green and lazy cashroom chunks.
- [ ] Commit: `feat: deliver firm cashroom workspace`.

### Task 11: Security, accounting and release verification

**Files:**
- Create: `docs/verification/2026-07-21-billing-cashroom-verification.md`
- Modify only defects proven by the review/test cycle.

**Interfaces:** Produces release evidence and an exact publishable branch.

- [ ] Review integer overflow, client/office account combinations, exact matter/client sufficiency, maker-checker paths, idempotency, tenant secrecy, document grants, CSV injection, logs/outbox privacy and immutable triggers.
- [ ] Run `npm test -- --run`; require all test files/tests to pass.
- [ ] Run `npm run typecheck && npm run build`; require both TypeScript targets and production build to pass.
- [ ] Apply the React best-practices review to the new TSX surface and browser-verify desktop/mobile production UI where the sandbox permits.
- [ ] Record commit, test counts, build chunks, limitations and manual/imported banking boundary in the verification document.
- [ ] Commit: `docs: verify billing cashroom milestone`.
- [ ] Publish the exact verified branch, open/merge its PR, fetch remote `main`, and compare every published file hash to the verified local tree.
