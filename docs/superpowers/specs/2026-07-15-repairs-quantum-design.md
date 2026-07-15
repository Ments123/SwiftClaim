# SwiftClaim Repairs and Quantum Design

**Date:** 15 July 2026
**Status:** Approved
**Product:** SwiftClaim Litigation
**Workflow:** Housing Conditions — Claimant (England)

## 1. Purpose

This slice makes the existing **Repairs and quantum** workflow stage operational. It gives a claimant solicitor one governed current position for:

- the works required and the provenance of each requirement;
- appointments, access, progress, completion assertions and verification;
- the client's claimed losses and the evidence for each figure;
- reviewed general-damages valuation without automated legal conclusions;
- offers, their protected status, material terms and event history; and
- objective readiness to progress to negotiation.

The workspace continues the synthetic Maya Patel evaluation matter from intake through expert evidence. It records a synthetic expert report, advances the matter to Repairs and quantum, and demonstrates incomplete repairs, a reviewed loss schedule and controlled offers on one coherent file.

The slice remains evaluation-only. It must not be presented as a substitute for solicitor judgment, an expert opinion, current legal research or a production-ready live-data environment.

## 2. Chosen approach

### A. Add forms to the existing evidence screen

Rejected. This would mix historical defect proof with current remedial performance, obscure schedule versions and make settlement figures difficult to audit.

### B. Build unrelated Repairs, Damages and Offers modules

Rejected. The boundaries are clean, but users would have to reconcile three conflicting versions of the current case position manually.

### C. Connected domain with separately loaded views — chosen

Add a bounded `quantum` domain that owns schedules of works, repair events, loss schedules, valuation reviews and offers. The client presents Repairs, Quantum and Offers views inside one independently loaded Matter 360 workspace. Records remain separately governed while a server projection gives the solicitor one current position.

## 3. Outcomes

A solicitor must be able to:

1. create a versioned schedule of works from an expert report, agreed schedule, landlord response or solicitor review;
2. relate work items to existing defects without copying or mutating evidential history;
3. record repair appointments, access and progress as append-only events;
4. distinguish a landlord or contractor completion assertion from client or expert verification;
5. create and revise a loss schedule with deterministic calculations and exact evidence links;
6. record a human-reviewed general-damages valuation range and provenance;
7. approve an immutable loss-schedule version and retain later superseding versions;
8. record offers without disclosing protected material in ordinary merits projections;
9. record written service, withdrawal, rejection and acceptance events without destructive updates;
10. prevent automated offer acceptance, automated valuation and unsupported workflow progression; and
11. show missing evidence, overdue works, disputed completion and approval blockers clearly.

## 4. Scope boundaries

### Included

- schedules of works and versioned work items;
- work-item links to existing defects and source documents;
- repair appointments, access and completion evidence;
- current repair-status projection and overdue/urgent warnings;
- versioned schedules of loss;
- fixed, quantity-by-rate, period-by-rate and reviewed-manual calculations;
- special-damages categories and evidence sufficiency;
- human-reviewed general-damages ranges and provenance;
- offer register and append-only offer events;
- Part 36 metadata and relevant-period projection;
- open, protocol, Part 36, without-prejudice-save-as-to-costs, costs-only and global offers;
- confidentiality-aware workspace responses;
- objective workflow readiness and privileged override integration;
- synthetic Maya evaluation data; and
- complete audit, chronology and outbox records for material commands.

### Excluded

- AI or rules-based damages valuation;
- autonomous legal conclusions or settlement recommendations;
- automatic sending, service, acceptance, rejection or withdrawal;
- communication composition, email, WhatsApp or telephony;
- proceedings, court filing or costs drafting;
- trust accounting, billing or payment reconciliation;
- external contractor or landlord portals;
- document OCR or AI extraction;
- SwiftBridge or live Proclaim migration; and
- live client data.

Offers are included because they are necessary to represent the current quantum position. Settlement authority and active negotiation remain the next workflow stage.

## 5. Legal and product posture

The data model supports the current Housing Conditions protocol requirement to identify intended remedial works, anticipated start and completion dates, a timetable and compensation. It also supports schedules produced by experts or agreed after joint inspection.

Part 36 records support the structured facts required for solicitor review: writing, offer type, scope, relevant period, service, money terms, interest and event history. SwiftClaim does not determine validity or legal effect. The UI labels every calculated date as a reviewable projection and retains the rule basis used.

Without-prejudice and Part 36 material is access-controlled and excluded from ordinary merits summaries, document assembly and unrestricted operational projections. Authorised users enter an explicit protected-offer view to see it.

All conclusions remain human decisions. Source links and timestamps help a solicitor verify the record but do not make it legally correct.

## 6. Architecture

Add a bounded `quantum` domain beside `protocol`, `evidence`, `intake`, `matter` and `workflow`:

- `QuantumStore` owns firm- and matter-scoped persistence, optimistic versions and atomic append operations.
- `QuantumService` owns authorisation, invariants, calculations, approval, confidentiality and audit commands.
- pure calculation functions return integer minor-unit results and explicit validation errors;
- `QuantumReadinessProvider` validates Repairs and quantum workflow checklist controls from server records;
- `quantumRoutes` expose resource-specific commands and a separately loaded workspace;
- `RepairsQuantumPanel` owns the three client views without loading protected offers into unrelated Matter 360 sections.

The existing modular monolith remains appropriate. A schedule approval, audit record, domain event, chronology event and outbox message can remain within one database transaction.

## 7. Data model

All domain tables contain `firm_id` and `matter_id`, use composite foreign keys where the current schema supports them, and are queried with both values. IDs are UUIDs. Times are UTC ISO timestamps. Civil dates use `YYYY-MM-DD`.

Money is stored as integer minor units with an ISO currency code. The first workflow supports GBP only, but the invariant is explicit rather than implicit.

### 7.1 Work schedules

`work_schedules`

- id, firm_id, matter_id;
- version number unique per matter;
- title and source type: `expert_report`, `agreed_schedule`, `landlord_response`, `solicitor_review`, `other`;
- source document ID when available;
- status: `draft`, `approved`, `superseded`;
- based-on schedule ID for revisions;
- created by/at, approved by/at and approval note;
- optimistic record version.

`work_items`

- id, schedule ID, firm_id, matter_id and stable lineage key;
- area and concise required-work description;
- responsibility position: `agreed`, `disputed`, `unknown`;
- priority: `urgent`, `high`, `routine`;
- target start and completion dates;
- estimated cost in minor units when stated by the source;
- contractor or responsible-party text;
- current status is projected from events rather than overwritten;
- source note and display position.

`work_item_defects`

- work item ID and existing evidence defect ID;
- immutable link created by/at.

`work_item_evidence_links`

- work item ID and existing immutable evidence item ID;
- purpose: `source`, `access`, `progress`, `completion`, `verification`, `invoice`, `other`;
- immutable link created by/at.

An approved schedule cannot be edited. A correction creates a new draft from the approved version and preserves stable lineage keys so current and historic items can be compared.

### 7.2 Repair events

`repair_events` is append-only:

- id, firm_id, matter_id, work item ID;
- type: `proposed`, `appointment_booked`, `access_offered`, `access_provided`, `access_refused`, `access_unavailable`, `started`, `paused`, `completion_asserted`, `client_disputes_completion`, `failed_inspection`, `verified_complete`, `superseded`;
- occurred-at timestamp or civil date plus optional time;
- actor type: `client`, `landlord`, `contractor`, `expert`, `solicitor`, `other`;
- note, appointment window and outcome where relevant;
- supersedes event ID only for a clearly identified correction;
- created by/at.

`verified_complete` requires completion evidence and an explicit verifier. `completion_asserted` never projects as verified. Access refusal or unavailability is recorded as an event, never inferred from a missed target.

### 7.3 Loss schedules and items

`loss_schedules`

- id, firm_id, matter_id and version number;
- title, status: `draft`, `approved`, `superseded`;
- based-on schedule ID;
- valuation date;
- currency fixed to GBP for this workflow;
- notes, created by/at, approved by/at and approval note;
- optimistic record version.

`loss_items`

- id, schedule ID, firm_id, matter_id and stable lineage key;
- category: `damaged_belongings`, `additional_heating`, `cleaning`, `temporary_accommodation`, `travel`, `medical_expense`, `loss_of_earnings`, `other`;
- description and period start/end where relevant;
- calculation type: `fixed`, `quantity_rate`, `period_rate`, `manual`;
- quantity and unit label, rate in minor units, fixed/manual amount in minor units;
- deterministic calculated amount in minor units;
- position: `claimed`, `accepted`, `disputed`, `withdrawn`;
- evidential status: `supported`, `partial`, `missing`, `not_applicable`;
- source note and display position.

`loss_item_evidence_links`

- loss item ID and existing immutable evidence item ID;
- purpose and immutable creation metadata.

Approved schedule totals are calculated from the approved line snapshot, not a mutable cached client total. A schedule cannot mix currencies.

### 7.4 General-damages reviews

`general_damages_reviews` is append-only:

- id, firm_id, matter_id;
- valuation date;
- low and high values in minor units;
- preferred current value when the reviewer records one;
- basis narrative;
- human-entered authorities, internal references or counsel/expert source notes;
- supporting document/evidence IDs;
- reviewed by/at and review note;
- supersedes review ID.

The server validates arithmetic and ordering only. It does not derive a figure, select an authority or state that a value is reasonable.

### 7.5 Offers

`offers`

- id, firm_id, matter_id and stable reference;
- direction: `claimant` or `defendant`;
- type: `part_36`, `wpsatc`, `open`, `protocol_compensation`, `costs_only`, `global`;
- confidentiality: `open`, `protected_costs`, `protected_negotiation`;
- scope: `whole_claim`, `part_of_claim`, `issue` with scope description;
- damages, costs and total minor-unit fields where stated;
- works terms and non-money terms;
- interest treatment text;
- written-offer document ID;
- made date and created by/at;
- optimistic record version.

`part_36_terms`

- offer ID;
- user-confirmed `is_part_36`;
- relevant-period days and basis text;
- service date and service confirmation metadata;
- projected relevant-period end date and calculation explanation;
- counterclaim inclusion and payment-period terms;
- solicitor validation status: `unreviewed`, `reviewed`, `not_valid`, with note and reviewer.

`offer_events` is append-only:

- type: `made`, `served`, `clarified`, `improved`, `withdrawn`, `accepted`, `rejected`, `not_accepted`, `superseded`;
- occurred-at, note, source document/evidence ID;
- created by/at and supersedes event ID.

An accepted event requires an authorised legal user, explicit confirmation and a source document or retained note. It records an event only; it does not communicate acceptance externally. Withdrawal, improvement and correction never overwrite the original offer.

## 8. Calculations

Calculations use integers or exact decimal parsing. Floating-point money is not accepted at the API boundary.

- `fixed`: amount supplied directly;
- `quantity_rate`: exact validated decimal quantity multiplied by integer rate, with documented rounding to the nearest penny;
- `period_rate`: integer count of declared units multiplied by integer rate;
- `manual`: a human-entered reviewed amount, with required basis text.

The projection returns:

- special-damages total;
- claimed, accepted, disputed and withdrawn subtotals;
- totals by category;
- general-damages reviewed range separately;
- combined low/high current valuation as a mathematical display only; and
- evidence-gap count and unsupported amount.

No client-supplied total is trusted.

## 9. Current repair projection

For each live work-item lineage, the server selects the latest item from the current approved schedule and folds valid repair events in occurred/created order. It exposes:

- current status and the event producing it;
- target dates and whether a target is overdue;
- last appointment/access outcome;
- completion assertion state;
- client position;
- independent verification state;
- linked evidence count; and
- warnings for urgent outstanding work, disputed completion or missing completion evidence.

The projection never changes historical events and never equates elapsed time with refusal, completion or breach.

## 10. Confidentiality and permissions

Extend capabilities with narrowly scoped controls:

- `quantum.read`, `quantum.write`, `quantum.approve`;
- `offers.read_open`, `offers.read_protected`, `offers.write`, `offers.record_outcome`.

Partners and administrators can approve schedules and view protected offers. Solicitors can create and manage records and, subject to existing role policy, record outcomes. Paralegals can prepare drafts and repair events but cannot approve schedules or view protected offers unless the firm later configures that capability. Finance-only users receive no matter access through this domain.

Tenant and matter membership checks run before resource existence is disclosed. Unauthorised and cross-firm lookups preserve the existing generic 404 posture.

The default workspace response includes open offers only. Protected offers require an explicit endpoint and capability. Protected content is not included in Matter 360 summaries, chronology labels visible to users without the capability, workflow blocker detail or generated merits documents.

## 11. Commands and API

Read endpoints:

- `GET /api/matters/:id/repairs-quantum`
- `GET /api/matters/:id/offers/protected`

Write endpoints:

- `POST /api/matters/:id/work-schedules`
- `POST /api/matters/:id/work-schedules/:scheduleId/approve`
- `POST /api/matters/:id/work-items/:workItemId/events`
- `POST /api/matters/:id/loss-schedules`
- `POST /api/matters/:id/loss-schedules/:scheduleId/items`
- `PATCH /api/matters/:id/loss-schedules/:scheduleId/items/:itemId`
- `POST /api/matters/:id/loss-schedules/:scheduleId/approve`
- `POST /api/matters/:id/general-damages-reviews`
- `POST /api/matters/:id/offers`
- `POST /api/matters/:id/offers/:offerId/events`
- `POST /api/matters/:id/offers/:offerId/part-36-review`

Commands use Zod contracts, idempotency keys where replay could duplicate a legal record, expected versions for mutable drafts, and resource-specific errors. All server commands re-read authorised state inside their transaction.

## 12. Workflow readiness

`works_status_reviewed` is objectively eligible only when:

- an approved current work schedule exists;
- every live work item has a current projected status;
- each completion assertion is either supported and verified or explicitly recorded as disputed/unverified;
- urgent outstanding work and overdue targets have been acknowledged in the review command; and
- any access problem has a recorded factual event rather than an inferred label.

`damages_schedule_reviewed` is objectively eligible only when:

- an approved current loss schedule exists;
- its computed total is reproducible from approved lines;
- missing or partial evidence is explicitly acknowledged;
- a current human general-damages review exists or an authorised reviewer records that none is presently advanced; and
- the approved schedule and valuation review post-date material superseded records.

Eligibility does not tick a checklist automatically. The user confirms the controls during the existing versioned transition. Unsupported confirmation is rejected server-side. A partner or administrator may use the existing reasoned override, which retains blockers and reason in audit history.

Repairs need not be finished before progression. The system requires a reliable current position, not an artificial completed status.

## 13. Client experience

Enable the existing **Damages & offers** Matter 360 section and label the workspace **Repairs & quantum**. It contains:

### Repairs

- headline counts for required, in progress, asserted complete, disputed and verified work;
- current approved schedule and version history;
- compact work-item rows grouped by area;
- dates, responsibility, priority, status and evidence indicators;
- an event drawer for access, appointments, progress and verification;
- prominent urgent, overdue and disputed-completion warnings.

### Quantum

- current special-damages total and general-damages reviewed range;
- loss-schedule version and approval state;
- line-item table with transparent calculation text;
- evidence status and linked-source navigation;
- totals by category and position;
- draft/revise/approve controls based on capability.

### Offers

- open offers in the normal workspace;
- a clearly marked protected-offers gate for authorised users;
- direction, type, scope, money/works terms and current event status;
- Part 36 review card with service confirmation, projected relevant-period end and warning that legal validity requires solicitor review;
- no send or automatic response button.

Loading, empty, forbidden, validation, conflict and retry states are explicit. Mutations refresh only the independent workspace plus Matter 360 when readiness may have changed.

## 14. Audit and event semantics

Material commands append:

- a domain-specific record or event;
- a chronology entry with a non-protected safe label;
- an audit entry with before/after or source identifiers;
- a domain event; and
- an integration-outbox entry where a future external consumer may need the event.

Protected offer details stay inside the protected domain record and protected audit payload. General chronology shows a neutral authorised-action label where disclosure would reveal negotiating content.

No approved schedule, repair event, offer event, valuation review or evidential link is updated or deleted. Corrections are explicit superseding records.

## 15. Evaluation journey

Extend Maya Patel's synthetic matter through production service commands where practical:

1. record a synthetic expert report and complete expert review;
2. transition to Repairs and quantum;
3. approve a report-derived schedule containing urgent damp works and routine reinstatement;
4. record one verified repair, one landlord completion assertion disputed by Maya and one outstanding item;
5. approve a loss schedule with supported additional-heating and damaged-belongings items plus one acknowledged evidence gap;
6. record a human-reviewed general-damages range with synthetic basis text;
7. record an open protocol compensation offer and one protected Part 36 offer;
8. demonstrate that protected terms are absent without permission; and
9. show readiness blockers accurately without pretending all repairs are complete.

All people, organisations, figures, documents and facts remain visibly synthetic.

## 16. Testing strategy

### Pure unit tests

- exact decimal parsing, multiplication and rounding;
- totals by category and position;
- current repair-event folding;
- schedule lineage and supersession;
- relevant-period calculation inputs and explanation;
- confidentiality-safe projections.

### Store and migration tests

- ordered migration and constraints;
- firm and matter isolation;
- immutable approved/event tables;
- idempotent replay;
- version conflict;
- approval and supersession;
- rollback across domain/audit/outbox writes.

### Service and route tests

- capabilities and generic non-disclosure;
- approval gates;
- required evidence and confirmation rules;
- no automatic acceptance or communication;
- protected-offer segregation;
- readiness success, blockers and privileged override;
- malformed money and impossible date rejection.

### Client tests

- independent lazy loading;
- repairs, quantum and offers views;
- calculation and evidence display;
- protected-offer gate;
- loading, empty, error, forbidden and conflict states;
- mutations and refresh behavior;
- keyboard and accessible-name coverage.

### End-to-end verification

- full test, typecheck and production build;
- dependency and production audit;
- fresh database migration and double seed;
- production HTTP journey with synthetic users;
- browser journey through Maya's repairs, loss schedule and protected offers;
- cross-firm and capability non-disclosure;
- exact git diff and remote-tree verification before completion.

## 17. Completion criteria

The milestone is complete when an authorised solicitor can open Maya's matter, understand the current repair position without confusing assertion with verification, reproduce every loss figure from approved lines, review valuation provenance, see only offers they are permitted to see, and progress the workflow only when objective records support the confirmation or a partner retains a reasoned override.
