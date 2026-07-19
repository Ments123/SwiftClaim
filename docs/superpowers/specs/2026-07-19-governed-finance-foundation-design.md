# Governed Finance Foundation Design

**Status:** Approved for specification  
**Product:** SwiftClaim Litigation only  
**Milestone:** Time, rates, WIP, estimates, disbursements and legal-ledger foundation

## Outcome

SwiftClaim will give fee earners, supervisors, partners and cashiers an accurate matter-finance view built from governed source records. Routine work already performed inside SwiftClaim will generate provisional time suggestions; users can confirm, correct, split or reject them through a fast daily workflow. Approved time, immutable rate snapshots, estimates and disbursements will produce transparent WIP and matter balances. A balanced journal kernel will establish the accounting invariant required by later billing, client/office ledgers, cashroom and bank reconciliation.

Finance is built before specialist costs drafting because a reliable Costs Dossier requires clean time, rate, disbursement, funding, billing and ledger history. The later Costs Dossier and external Costs Room will consume this foundation and can connect to DMD Costs through a provider-neutral adapter.

This milestone does not create or issue bills, move client money, connect to a bank, submit VAT/MTD returns, operate a purchase ledger, draft a bill of costs or expose a costs-draftsman portal. Those are deliberately sequenced later, not excluded from SwiftClaim.

## Product sequence

1. **Finance Foundation — this milestone:** activity suggestions, timers, approved time, rate cards, estimates/warnings, disbursements, WIP, balanced journal kernel and matter dashboard.
2. **Billing and Cashroom:** draft/final bills, credit notes, receipts, allocations, client/office ledgers, transfer requisitions, payment approvals, bank feeds and reconciliation.
3. **Firm Accounts and Reporting:** nominal/purchase ledgers, accounting periods, tax reports, trial balance, profit and loss, balance sheet and accounting integrations.
4. **Costs Dossier and Costs Room:** immutable costing instructions, portable packs, read-only external access, questions and returned drafts.
5. **DMD Costs connector:** secure instruction/dossier synchronisation, signed webhooks, status, questions and returned drafts.

## Non-negotiable safeguards

- All monetary values are signed integer minor units with explicit `GBP`; floating-point money is forbidden.
- Duration is stored as integer minutes. Units and rates are explicit; display rounding never changes retained source facts.
- A rate-card version is immutable after activation. Each approved time entry snapshots its rate, grade and calculation basis.
- AI output is labelled `AI suggestion — human review required`. AI cannot post time, alter a rate, approve WIP, record a disbursement, create a journal or move money.
- Activity-derived time is provisional. Only an authorised human can confirm, edit, split or reject it.
- Posted financial facts are append-only. Corrections use an explicit reversal and replacement linked to the original.
- Every posted journal has at least two lines and total debits equal total credits in the same currency before the transaction commits.
- Journal line accounts, matter, client/office designation and source record are exact and immutable.
- Client money and office money are distinct account classes. No projection may net them together or describe one as available to the other.
- This milestone displays no fabricated bank/client balance. Until Billing and Cashroom create verified postings, those positions are labelled `Not yet connected`.
- A disbursement distinguishes anticipated, incurred, paid, billed and recovered facts. One state never implies another.
- WIP, billed, paid, written off and recovered remain separate values.
- All commands are firm- and matter-scoped, strict, idempotent, concurrency protected and atomically audited/outboxed.
- Inaccessible records return generic `404`; stale versions and reused idempotency keys with changed input return `409`.
- Finance audit metadata contains identifiers and safe amounts, never privileged narrative or document contents.

## Recommended architecture

Create a bounded `finance` domain beside matters, communications, quantum, proceedings and disclosure.

### Activity and time capture

An `ActivityEvidenceAdapter` consumes safe, already-recorded operational facts from SwiftClaim: a completed task, approved document revision, communication/call duration, attendance, filing, hearing or other supported event. The adapter emits at most one deterministic candidate per source event and user. It never inspects keystrokes, passive device activity or restricted content.

Manual timers are server-authoritative sessions. A user may have one running timer; starting another stops the first at the supplied/verified server time. Timer output is still a suggestion until human confirmation. Manual entry remains available for work outside SwiftClaim.

Each suggestion carries source kind/ID, observed start/end or duration evidence, proposed matter, fee earner, activity code, costs phase, narrative, confidence explanation, model/policy version and input hash. Suggestions cannot infer chargeability from privileged content.

### Rate and calculation engine

Firm administrators maintain draft rate cards composed of effective-dated rate versions and entries by fee-earner grade, activity/category and optional matter override. Activation requires finance/partner approval and freezes the version.

The pure `calculateTimeValue` function accepts approved minutes, explicit unit convention, snapshotted rate and rounding policy. The first policy uses one-minute retained duration and six-minute display units without rounding the underlying minutes. Charge value in minor units is calculated deterministically with integer arithmetic and the remainder policy documented in the snapshot.

Changing a future rate never reprices approved historical time. Explicit repricing is a later governed reversal/replacement operation.

### WIP projection

Approved time becomes unbilled WIP. Write-off, transfer, billing and recovery are separate immutable allocation facts in later milestones. During this foundation milestone the projection shows:

- approved unbilled time at charge value;
- unapproved/provisional time separately;
- approved disbursement exposure by status;
- current estimate and cost limit;
- WIP variance against the active estimate;
- client/office/billed/paid positions as `Not yet connected` rather than zero.

### Estimates and client-cost warnings

An estimate stream retains effective-dated versions with scope, fee estimate, disbursement estimate, VAT treatment, overall limit, review date, source exact document version where available and human approval. A new version supersedes but never mutates the old version.

Threshold rules generate operational warnings at configurable percentages. A warning records when the threshold was crossed and remains open until a human records review, client notification evidence or a superseding estimate. SwiftClaim does not claim that a warning satisfies a professional obligation.

### Disbursements

Disbursements record supplier/payee, category, description, net/VAT/gross amounts, VAT treatment, status, incurred/due/paid dates and exact invoice/payment evidence. The initial workflow supports proposed, approved, incurred, paid externally, cancelled and corrected events. Recording `paid externally` requires exact evidence and does not itself post client or office cash.

AI may extract supplier, invoice reference, dates and monetary candidates from an exact retained document, but every field remains provisional until finance/human confirmation. Duplicate supplier/reference/amount/date combinations produce a blocker, not automatic rejection.

### Double-entry journal kernel

The foundation installs a chart-of-accounts model and immutable journal infrastructure even though live cashroom postings follow later. Account classes include client asset/liability, office asset/liability, WIP asset, income, expense, VAT control, disbursement control, suspense and equity. Accounts carry an explicit client/office/neutral designation.

`postJournal` validates balanced signed lines, currency, open accounting period, allowed account combinations, exact source and capability. Journals have `draft`, `approved`, `posted` and `reversed` facts; only posted lines affect balances. No posted row is updated or deleted. The evaluation seed uses non-cash WIP/disbursement control journals only and must never fabricate a bank balance.

### Persistence layer

`FinanceStore` owns tenant-safe reads and atomic commands. The migration creates:

- `finance_activity_suggestions` and immutable suggestion decisions;
- `finance_timer_sessions` and timer events;
- `finance_rate_cards`, versions and rate entries;
- `finance_time_entries` and append-only entry events;
- `finance_estimates`, versions, thresholds and warning events;
- `finance_disbursements` and append-only disbursement events;
- `finance_accounts`, accounting periods, journals and journal lines;
- `finance_command_receipts`.

Composite firm/matter/user/source keys prevent cross-tenant references. Financial event and journal triggers prevent update/delete. Calculated snapshots retain every input used to reproduce a value.

### Service and policy layer

Capabilities are separated by duty:

- `finance.read_matter`
- `finance.read_firm`
- `finance.record_time`
- `finance.approve_time`
- `finance.manage_rates`
- `finance.manage_estimates`
- `finance.manage_disbursements`
- `finance.prepare_journal`
- `finance.approve_journal`
- `finance.post_journal`

Fee earners may read assigned matters and record their own time. Supervising solicitors/partners approve time and estimates within matter access. Finance users may read firm-wide financial metadata, manage disbursements and prepare/post authorised finance records without receiving general access to privileged matter content. Rate activation and journal posting require independent approval: the preparer cannot approve/post their own journal. Admin can configure but cannot bypass balance, separation or immutable-posting rules.

### Matter 360 interface

Enable the existing **Time & finance** section with five views:

1. **Snapshot** — approved WIP, provisional time, disbursements, estimate variance, warnings and clearly unavailable later-phase balances.
2. **Time** — running timer, daily suggestion inbox, manual entry, source provenance and approval status.
3. **Rates & estimates** — effective rate snapshot, estimate history, thresholds and client-warning evidence.
4. **Disbursements** — proposed/incurred/paid-external states, exact invoices/evidence and duplicate warnings.
5. **Ledger foundation** — safe journal/status view for authorised finance users; ordinary fee earners see only matter totals and source links.

The daily time workflow prioritises speed: approve clean suggestions individually or by explicit selection, edit in place, split across matters, and retain rejected suggestions outside WIP. Mixed matters/rates or low-confidence candidates cannot use bulk approval.

## Domain decisions

### Time status

`suggested`, `draft`, `submitted`, `approved`, `rejected`, `written_off`, `billed` and `reversed` are distinct. Only approved entries enter WIP. This milestone implements through approved/rejected/reversed; written-off and billed events are reserved for Billing and Cashroom.

An entry records work date, start/end when known, minutes, narrative, activity code, costs phase, fee earner, source evidence, chargeability, rate snapshot, value snapshot and approval. Correcting an approved entry creates reversal/replacement records; it never edits the approved row.

### Costs phases and activity codes

Codes are versioned firm configuration rather than hard-coded legal conclusions. The seed includes representative litigation phases and generic activities, but the UI labels them configurable. A later Costs Dossier exports exact code/version snapshots for the costs draftsman.

### Journal amounts

Journal lines store non-negative debit or credit minor units with exactly one side populated. A journal must balance before approval and again inside the posting transaction. Database constraints reject negative values, dual-sided lines, zero-line journals and mixed currencies.

### Finance visibility

Finance users can see financial metadata needed for cashiering across their firm, including matter reference, client display name, amounts, sources and approval state. They do not automatically gain access to privileged communications, legal advice, disclosure content or general matter documents. Exact invoice/payment evidence uses a finance-specific document grant or safe projection.

## Data flow

1. Supported SwiftClaim activity emits a safe operational source event.
2. The activity adapter produces one deterministic provisional time suggestion.
3. The fee earner reviews, edits/splits and submits it; an authorised supervisor approves it.
4. Approval snapshots the exact active rate and calculated charge value and enters WIP.
5. Estimates and thresholds project variance and create review warnings without claiming compliance.
6. Finance users record governed disbursement facts from exact evidence.
7. Non-cash control journals demonstrate balanced posting and reproducible matter totals.
8. Billing/Cashroom later consumes approved WIP/disbursements to create bills and verified client/office postings.
9. Costs Dossier later consumes immutable source histories rather than scraping UI totals.

## Failure and security behaviour

- Cross-firm/matter/user/source/document/rate references return generic `404`.
- Duplicate activity sources return the existing suggestion or idempotent response, never duplicate time.
- Overlapping approved time for one user is a blocking warning requiring explicit authorised resolution.
- Timers use server time and reject negative, implausible or stale session transitions.
- Missing rate produces `rate review required`; it never silently uses zero or the newest available rate.
- Arithmetic overflow, mixed currency, unbalanced journal, closed period or client/office rule violation fails closed before any write.
- A transaction failure rolls back domain records, receipt, audit, timeline and outbox together.
- Restricted source text never appears in finance projections, AI prompts, logs or outbox payloads.

## Evaluation seed

The synthetic Northstar matter includes an approved GBP rate-card version, Ava and paralegal grades, one completed-call suggestion, one document-review suggestion, one manual timer result, a rejected duplicate suggestion, approved time with exact rate snapshots, a current client estimate with an 80% warning, one proposed expert disbursement extracted provisionally from an exact invoice, one confirmed court-fee disbursement, and a balanced non-cash WIP control journal. The snapshot shows approved and provisional time separately and labels client/office/billed/paid balances `Not yet connected`. Re-running the seed is idempotent.

## Testing strategy

- Contract tests reject floating money, negative minutes, AI-posted time, mutable rate snapshots, self-approved journals and conflated money states.
- Migration tests prove exact tenant keys, account/line constraints and immutable financial triggers.
- Pure calculation tests cover integer rate calculation, remainder policy, WIP projection, thresholds and balanced journals.
- Activity tests prove deterministic one-source/one-suggestion behaviour and safe provenance.
- Store tests cover tenant isolation, exact sources, atomic audit/outbox writes, idempotency, rollback, concurrency and reversal/replacement.
- Service tests cover fee-earner, supervisor, partner, finance and admin separation of duties and prove finance access does not widen privileged access.
- Route tests cover authentication, strict validation, generic `404`, `409` and finance-specific safe evidence.
- UI tests cover fast daily approval, AI/human labels, source provenance, unavailable later-phase balances and permission-safe finance views.
- Release requires the full test suite, both TypeScript targets, production build, terminology/scope scan and exact GitHub tree verification.

## Delivery boundary

This milestone is complete when the synthetic firm can generate and review activity-derived time suggestions, run a timer, approve exact rate-snapshotted time into WIP, govern estimates and threshold warnings, record evidence-backed disbursement states, inspect a transparent matter-finance snapshot and prove balanced immutable non-cash journals through Matter 360. Bills, client/office cash postings, transfers, bank reconciliation, firm accounts, Costs Dossiers, external Costs Room, DMD integration, Proclaim migration and SwiftBridge remain subsequent SwiftClaim milestones.
