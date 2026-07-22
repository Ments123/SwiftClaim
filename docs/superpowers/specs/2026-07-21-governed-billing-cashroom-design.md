# Governed Billing & Cashroom Design

**Status:** Approved 21 July 2026  
**Product:** SwiftClaim Litigation  
**Milestone:** Billing, client/office money, cashroom and bank reconciliation

## Outcome

SwiftClaim will turn approved WIP and incurred disbursements into immutable bills, record imported or manually evidenced receipts and payments, maintain separate client and office ledgers, control client-money withdrawals, and reconcile recorded bank activity. Fee earners get a clear matter-money view; finance users get a firm-wide bills register, cashbook, exception queues and reconciliation workspace.

This is an operational legal-accounting vertical slice. It follows money from approved work to an issued bill, then through receipt/allocation, an authorised client-to-office transfer and bank reconciliation. It does not initiate a real bank payment in this milestone.

## Boundary

Included:

- Bill assembly from approved, unbilled time and eligible disbursements.
- Explicit reductions, write-offs and narrative amendments.
- Approval, sequential numbering, issue/delivery evidence and immutable bill documents.
- Credit notes and reversals instead of edits to issued records.
- Effective-dated VAT profiles and exact line-level VAT snapshots.
- Client, office and mixed receipts; controlled allocation and reallocation.
- Client payments/refunds and client-to-office transfers for delivered bills.
- Matter/client sufficiency checks and negative-balance prevention.
- Bank-account registers, statement imports, matching and reconciliation.
- Independent reconciliation sign-off, exception queues and exports.
- Matter and firm-wide finance views, aged debt and residual-balance warnings.

Excluded:

- Live payment initiation or autonomous movement of money.
- Direct live bank feeds; a provider-neutral adapter is defined for later use.
- Payroll, MTD/VAT submission, corporation tax and statutory accounts.
- Costs Dossier, external Costs Room and DMD Costs integration.
- Purchase-order automation and a full supplier procurement workflow.

## Non-negotiable invariants

1. Money uses safe integer minor units with explicit `GBP`; floating-point money is forbidden.
2. Client money, office money and neutral control accounts never net or substitute for one another.
3. Every posted movement is a balanced journal in an open period; only posted journals affect balances.
4. A client-to-office transfer for costs requires a specific issued bill and recorded delivery evidence.
5. A client withdrawal cannot exceed cleared, unrestricted funds held for that exact firm, client and matter allocation.
6. Mixed receipts remain unallocated until a human confirms each client/office split.
7. The preparer cannot approve their own client withdrawal or sign off their own reconciliation.
8. Issued bills, posted journals, statement lines and signed reconciliations are immutable; corrections use linked reversal/replacement records.
9. Bill numbering is sequential within an immutable firm numbering series and allocated only inside the issue transaction.
10. Bank statement import is evidence, not authority to post or match money.
11. AI may suggest narratives, matches and anomalies but cannot issue bills, post money, approve withdrawals, confirm matches or sign reconciliations.
12. Every command is strict, tenant-scoped, idempotent, concurrency-protected and atomically audited/outboxed.
13. Inaccessible identifiers return generic `404`; stale versions and changed replays return `409`.
14. Exact documents and financial evidence are visible only through finance-specific grants.
15. Accounting records expose retention metadata and cannot be destructively deleted.

## Architecture

Billing and cashroom extend the existing bounded `finance` domain. Pure billing and allocation calculations remain separate from persistence. `BillingCashroomStore` owns atomic commands and projections while using the existing finance journal validation and posting kernel. Routes and UI are split into matter-level billing/money views and firm-level cashroom views.

### Billing lifecycle

`draft -> submitted -> approved -> issued -> delivered -> part_paid -> paid`

Rejected and cancelled drafts remain in history. An issued bill is never edited or renumbered. A credit note is a separate approved and issued document linked to the exact bill lines it reduces. Bill status is projected from immutable events, allocations and credit notes rather than stored as a mutable truth.

A draft snapshots candidate WIP/disbursement source IDs but does not consume them. Issue atomically:

- rechecks every source is approved, eligible and not already consumed;
- snapshots line narrative, net, VAT rate/basis, VAT and gross amounts;
- allocates the next bill number;
- creates the exact generated document and checksum;
- marks source allocations through append-only facts;
- posts balanced office-side billing journals;
- appends audit, timeline and outbox records.

Delivery is a separate fact with channel, recipient, timestamp and exact evidence. It is required before a costs transfer can be approved.

### VAT

Firm VAT profiles and rates are immutable effective-dated versions. Every bill line snapshots the selected profile, rate numerator/denominator, rounding outcome and tax point. VAT calculation uses integer arithmetic. A zero/exempt/out-of-scope line requires an explicit treatment code. Changing a later VAT profile never reprices an issued bill.

### Client and office ledgers

The existing chart of accounts gains real bank/control accounts. Ledger projections are derived exclusively from posted journals and retain designation, matter, client, source and cleared status. The matter view shows:

- client funds held, cleared, restricted and available;
- office balance and outstanding bills;
- unbilled WIP and disbursement exposure;
- issued, credited, allocated, paid and overdue amounts;
- pending requisitions and unreconciled items.

No aggregate firm cash balance is presented as available to an individual client or matter.

### Receipts and allocations

A receipt begins as imported or manually evidenced bank activity. Finance records payer/payee, amount, date, reference, bank account and exact evidence. Duplicate fingerprints open a blocker. A human classifies the item as client, office, mixed or suspense and allocates it.

Allocations are immutable. Corrections reverse the original allocation and create replacements. Client receipt allocation posts client bank debit and the exact client/matter liability credit. Office receipt allocation credits debt/income/control as appropriate. Mixed money creates distinct balanced client and office journal groups with a shared receipt source.

### Client payments and transfers

Payment requisitions contain exact payee/beneficiary evidence, purpose, matter/client allocation, amount and requested payment method. Changed beneficiary details create a high-risk warning and require independent reverification. Approval rechecks available cleared funds and separation of duties inside the same transaction. This milestone records the authorised/manual external payment and its evidence; it does not transmit payment instructions to a bank.

A client-to-office transfer is tied to one or more delivered bills. The transfer cannot exceed the lower of cleared client funds available for that matter and the bill balance due. Approval and posting remain separate human acts and create linked client and office journal entries without losing the transfer trail.

### Bank accounts, statements and reconciliation

Bank accounts store provider, currency, designation and masked account identifiers; full credentials are never retained in application records. `BankActivityProvider` supports manual and CSV imports now and later authenticated providers through the same normalised contract.

An imported statement batch is immutable and checksum-deduplicated. Statement lines retain their raw evidence hash and normalised values. Deterministic rules and AI may suggest candidate journal matches with an explanation and confidence, but a human confirms, splits or rejects them.

A reconciliation covers one bank account and statement closing date. It proves:

`statement closing balance = ledger cleared balance + outstanding lodgements - unpresented payments + documented adjustments`

Differences block completion. Completion freezes the exact statement lines, ledger entries, outstanding items and calculation snapshot. A manager, partner or COFA-equivalent role who did not prepare it signs off. The system tracks the next review deadline from the firm's configured cadence, defaulting to 35 days, without claiming regulatory compliance automatically.

### Exceptions and reports

Firm finance includes:

- central bills register and bill-number gap report;
- aged debt by client/matter and credit-control drafts;
- cashbook and client/office ledger exports;
- unallocated and suspense receipts;
- negative-balance attempts and rejected withdrawals;
- unpresented payments and outstanding lodgements;
- unreconciled statement lines and overdue reconciliations;
- residual/stale client balances;
- duplicate receipt and changed-beneficiary warnings;
- immutable CSV export manifests with actor, filters, timestamp and checksum.

### Capabilities and separation of duties

Add:

- `finance.prepare_bill`
- `finance.approve_bill`
- `finance.issue_bill`
- `finance.record_bank_activity`
- `finance.allocate_money`
- `finance.prepare_client_payment`
- `finance.approve_client_payment`
- `finance.post_cashroom`
- `finance.prepare_reconciliation`
- `finance.signoff_reconciliation`
- `finance.export_accounts`

Solicitors/partners may prepare matter bills within matter access. Bill approval is partner/supervisor controlled; issue and accounting posting are finance controlled. Finance users can process firm-wide financial metadata but do not gain general privileged matter access. Admin configures numbering, VAT and bank metadata but cannot bypass accounting invariants.

### Persistence

Migration 13 creates immutable/append-only tables for VAT profiles/rates, bill series, bills/versions/lines/events/source allocations/documents, credit notes/lines/events, bank accounts, bank statement batches/lines, receipts/events/allocations, payment requisitions/events, transfers/events, reconciliation sessions/items/events/sign-offs, finance exceptions and export manifests.

Composite firm, matter, client and source keys enforce tenant boundaries. Unique indexes cover bill numbers, statement checksums, provider line IDs, receipt fingerprints and active reconciliation scopes. Triggers forbid update/delete on immutable financial facts.

### User experience

Matter 360 gains:

- **Billing:** eligible WIP, draft builder, adjustments, approval, issue/delivery and credit notes.
- **Money:** client/office balances, receipts, bill allocations, transfers and payment requisitions.
- **History:** source-linked immutable ledger and documents.

A firm-level **Cashroom** workspace provides Bills, Receipts, Payments, Bank, Reconciliation and Exceptions queues. Dense financial tables remain keyboard-accessible, filterable and exportable. Every total drills down to exact source transactions.

## AI boundaries

Allowed provisional assistance:

- recommend eligible approved WIP/disbursements for a draft bill;
- rewrite a draft client-facing narrative without changing amount/source;
- flag missing time, unusual reductions, duplicate receipts and changed beneficiaries;
- suggest statement-to-journal matches and explain reconciliation differences;
- draft credit-control communications.

Prohibited:

- creating or approving monetary facts autonomously;
- issuing a bill or allocating a bill number;
- posting, reversing or transferring money;
- confirming a bank match or reconciliation;
- fabricating delivery, payment or bank evidence;
- accessing privileged matter text outside an exact authorised source grant.

## Evaluation journey

The Northstar seed will create a VAT profile, bill series, approved WIP and an incurred court fee; assemble and approve a draft; issue and deliver bill `SC-2026-000001`; import a client receipt; allocate it; prepare and independently approve a partial client-to-office transfer; import a statement batch; match the postings; and complete/sign off a reconciliation with zero difference. A second receipt remains in suspense and a changed-beneficiary payment remains blocked. Re-running the seed creates no duplicates.

## Testing and release gates

- Contract tests cover integer VAT, strict commands and AI/autonomous-field rejection.
- Migration tests cover composite keys, sequential numbering, immutability and deduplication.
- Pure tests cover bill totals, credits, allocation sufficiency, aged debt and reconciliation equations.
- Store tests cover issue atomicity, concurrent number allocation, source consumption, delivery-before-transfer, matter-specific funds, maker-checker controls, reversal/replacement and tenant isolation.
- Route tests cover authentication, generic `404`, `409`, finance evidence grants and safe exports.
- UI tests cover complete matter billing and cashroom journeys with permission-safe commands.
- Seed tests prove rerun safety and exact expected balances.
- Release requires the complete suite, both TypeScript targets, production build, React/accessibility review, security review and exact remote-tree verification.

## Completion criterion

The milestone is complete when the synthetic firm can issue an immutable VAT-aware bill from governed sources, record and allocate imported/manual money, perform a controlled bill transfer, prevent invalid client withdrawals, reconcile an imported bank statement, inspect exact matter and firm-wide finance positions, and export auditable records without initiating a live payment.
