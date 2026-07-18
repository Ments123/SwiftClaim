# Governed Proceedings Design

**Status:** Approved under the product owner's standing instruction to follow the recommended SwiftClaim delivery path
**Date:** 16 July 2026
**Scope:** SwiftClaim Litigation only

## Outcome

SwiftClaim will add a tenant-safe Proceedings workspace that controls the transition from pre-action work to an issued civil claim and then preserves the authoritative record of filing, service, court directions, applications, hearings, orders and compliance.

The workspace is a legal operations control plane. It does not decide whether proceedings should be issued, whether service is valid, whether a deadline can be varied, whether a sanction applies, or what a solicitor should plead. Those decisions remain human decisions supported by retained source records.

## Delivery boundary

This milestone includes:

- authority and exact-document controls before an issue request is recorded;
- one or more court proceedings per matter, while exposing one active proceeding in the primary workspace;
- court, venue, jurisdiction, procedure, claim number and track/allocation facts;
- immutable proceeding events for prepared, submitted, issued, transferred, stayed, restored, disposed and corrected states;
- exact document-version filing records with submission channel, fee, receipt and rejection history;
- service records per document and recipient, including the completed service step, reviewed deemed-service position and supporting evidence;
- received statements of case and court documents;
- applications, their requested orders, evidence, notice position and outcomes;
- sealed orders and judgments with exact source documents;
- direction obligations derived by a human from an order or rule source, with append-only compliance events;
- hearings, listing notices, venue/remote method, attendees, bundle source, outcome and resulting order;
- objective readiness for transition from Proceedings to Settlement;
- a responsive Matter 360 Proceedings workspace and synthetic evaluation journey.

This milestone does not include:

- live HMCTS, CE-File, MyHMCTS or payment integrations;
- automated filing, service or court fee payment;
- autonomous pleading, statement-of-truth signing or legal advice;
- automated conclusions that service is valid, an order has been complied with, a sanction applies, relief is available, or a claim is disposed;
- full disclosure review, witness-proofing, trial-bundle generation, costs budgeting or enforcement workflows;
- SwiftBridge or Proclaim migration work;
- AI extraction or drafting. Those capabilities will later consume these governed records and require human review.

## Source position

The design is grounded in the current official Civil Procedure Rules:

- [CPR Part 7](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part07) distinguishes the request to issue from the court's act of issuing and specifies the general claim-form service period.
- [CPR Part 6](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part06) governs service methods and deemed service.
- [CPR Part 15](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part15) contains the general defence periods and agreed extension rule.
- [CPR Part 23](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part23) governs applications, filing, notice and supporting material.
- [CPR Parts 28 and 29](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part28) govern directions and case timetables for allocated claims.
- [CPR Part 3](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part03) makes clear that sanctions may take effect on non-compliance unless relief is obtained.
- [CPR Part 39](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part39) recognises in-person, telephone, video and other simultaneous hearings.
- [CPR Part 40](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part40) governs judgments, sealed orders, service and when orders take effect.

Rules and court orders can change. Every calculated rule-based date therefore records the rule key, rule version, source URL, source title, trigger fact, calculation inputs and human review. A date stated in a sealed order is a source date, not a calculated date.

## Approaches considered

### Document-led proceedings

Treat documents and folders as the primary model, with metadata attached to each PDF or DOCX. This is quick to build and familiar to legacy case-management users, but it cannot reliably answer whether a document was merely prepared, actually filed, accepted, issued, served or rejected. It also encourages chronology inference from filenames.

### Deadline-led proceedings

Treat the court timetable and tasks as the primary model. This is operationally useful, but it risks detaching a deadline from the sealed order, filing receipt, service event or procedural rule that created it. Amendments and stays become difficult to explain.

### Event-led control plane — selected

Use immutable legal events and exact source versions as the primary record, then project current proceeding, filing, service, direction and hearing state. This matches the existing SwiftClaim communication, repair, offer and settlement patterns. It supports manual evaluation today and future court adapters without changing the canonical model.

## Domain model

### Proceeding

`court_proceedings` is the stable aggregate root. It contains firm and matter scope, an internal proceeding reference, procedure type, jurisdiction, court name/code, hearing centre, current case number, current track, active flag and optimistic version.

The first version is claimant-side Part 7 and Part 8 civil proceedings in England and Wales. Procedure type remains explicit and no Part 15 deadline is projected for Part 8 proceedings.

`court_proceeding_events` is append-only. Event types are:

- `authority_recorded`
- `issue_request_prepared`
- `issue_request_submitted`
- `issued`
- `case_number_corrected`
- `transferred`
- `allocated`
- `stayed`
- `restored`
- `discontinued`
- `dismissed`
- `judgment_entered`
- `closed_by_court`
- `correction`

An `issued` event requires the sealed claim-form document version, issue date, court and case number. A submission or provider acknowledgement is never represented as issue.

### Authority to issue

`proceeding_authority_versions` retains the human decision to issue. Each immutable version records:

- the client instruction record;
- scope and defendants covered;
- procedure type;
- exact claim-form and particulars document versions;
- solicitor reviewer;
- recorded risks and limitation position;
- approval state and review note;
- expiry/review date where applicable.

Only partner, solicitor and admin roles can approve authority. The approving user must be different from the user who prepared the exact document version when firm policy requires independent review. The evaluation policy requires independent review for issue.

Any replacement claim-form or particulars version invalidates the authority for issue. SwiftClaim does not sign a statement of truth.

### Court documents and filings

`court_documents` classifies an exact retained document version as claim form, particulars, response pack, acknowledgment, defence, reply, counterclaim, directions questionnaire, application notice, evidence, draft order, sealed order, judgment, listing notice, witness statement, disclosure document, expert document, bundle, costs document, certificate of service or other.

`court_filings` represents a filing attempt, not a document. It stores filing purpose, exact document versions, submission channel, submitted time, submitted by, fee position and idempotency key.

`court_filing_events` is append-only:

- `prepared`
- `submitted`
- `acknowledged`
- `accepted`
- `rejected`
- `withdrawn`
- `corrected`

Provider acknowledgement is not acceptance. Acceptance is not issue. Each external state requires a retained receipt or a human-verified source reference.

### Service

`court_service_records` represents one attempt to serve one exact court-document version on one recipient. It stores the recipient party, served-by actor, method, service address or endpoint, jurisdiction position and current version.

`court_service_events` is append-only:

- `prepared`
- `step_completed`
- `delivery_evidence_received`
- `returned`
- `disputed`
- `human_reviewed`
- `set_aside`
- `corrected`

The `step_completed` event records the precise act and time: posting, leaving, delivery, personal-service step or electronic transmission. The event does not assert valid or effective service.

A human-reviewed service position records:

- asserted service date;
- asserted deemed-service date, if any;
- rule/source basis;
- reviewer and review note;
- supporting document or communication source;
- position: `unreviewed`, `reviewed`, `disputed` or `superseded`.

The ordinary communication ledger may be linked as evidence but cannot itself mark a court document served.

### Applications

`court_applications` records applicant, respondent, requested order, grounds summary, notice position, hearing requirement, exact application notice, evidence and draft-order versions.

Application events distinguish prepared, filed, served, listed, granted, refused, withdrawn and disposed. A granted application must link to the resulting sealed order before its operational effect can alter directions.

### Orders and judgments

`court_orders` records the exact sealed source, order date, judge/judicial title when stated, order type, taking-effect date, service position and whether it varies or supersedes another order.

Draft orders and agreed terms are not stored as sealed orders. `sealed` is a human-confirmed fact requiring a retained document version.

### Direction obligations

`court_directions` contains one atomic obligation created by an order or an expressly selected procedural rule. It records:

- responsible party;
- category: disclosure, witness evidence, expert evidence, bundle, costs, application, payment, filing, service, hearing preparation or other;
- exact requirement text as a concise human transcription;
- due date/time and timezone, if stated or calculated;
- source order, rule or court communication;
- whether breach may carry an expressly stated sanction;
- current version and assigned owner.

`court_direction_events` is append-only:

- `created`
- `assigned`
- `performance_asserted`
- `evidence_linked`
- `satisfied`
- `disputed`
- `extended`
- `stayed`
- `resumed`
- `relief_applied`
- `relief_granted`
- `relief_refused`
- `waived_by_order`
- `superseded`
- `corrected`

`performance_asserted` never means `satisfied`. Satisfaction requires an exact filing, service, document, communication or order source. A direction cannot be waived by an internal user; it can only be marked `waived_by_order` with a later sealed order. A user may record a risk or intended application without changing the obligation state.

Projections expose `open`, `due_soon`, `overdue`, `performance_asserted`, `satisfied`, `stayed`, `disputed`, `superseded` and `waived_by_order`. Overdue is a time comparison, not a conclusion that a sanction applies.

### Hearings

`court_hearings` records hearing type, listing source, start/end, timezone, court/venue, attendance mode, privacy position, judge, advocates, attendees, bundle version and notes.

Hearing events distinguish listed, relisted, adjourned, vacated, started, completed and outcome recorded. An outcome note is not an order. Any operative direction or judgment must link to a sealed order or judgment record.

Remote access details are sensitive. They are returned only to users with proceedings read access and are excluded from general chronology summaries and logs.

## State and projections

Current state is projected from immutable events using deterministic pure functions. Mutable aggregate rows contain only search/index fields, optimistic version and current foreign keys; they are not legal history.

Commands use an idempotency key and bind the receipt to firm, matter, proceeding, route entity and validated input hash. Reusing a key with different input returns conflict. Retrying an accepted command returns the original response without duplicate events, audit entries, timeline entries or outbox records.

Corrections never update a legal event. A correction event identifies the superseded event, retains a reason and provides replacement facts.

## Permissions

New capabilities are:

- `proceedings.read`
- `proceedings.prepare`
- `proceedings.approve_issue`
- `proceedings.record_external`
- `proceedings.manage_directions`
- `proceedings.manage_hearings`
- `proceedings.record_order`
- `proceedings.record_relief`

Role policy:

- admin and partner: all proceedings capabilities;
- solicitor: all except `proceedings.approve_issue` when self-approval would breach independent review;
- paralegal: read, prepare, manage directions and manage hearings, but cannot approve issue, confirm issue, record a sealed order, satisfy a direction, or record relief outcome;
- finance and readonly: no proceedings access in this milestone.

Inaccessible firms, matters, proceedings and sources return generic `404`. Counts are calculated after permission filtering.

## Service boundary

`ProceedingsStore` owns tenant-scoped SQL and transactions. `ProceedingsService` owns capabilities, exact-version rules, idempotency and cross-record invariants. Pure projection modules own event state. HTTP routes validate with strict Zod schemas and return stable workspace DTOs.

No route accepts a firm identifier from the browser. Firm scope comes from the authenticated session. Every write produces an append-only audit event, domain event and operational outbox record in the same transaction.

## API boundary

Primary routes:

- `GET /api/matters/:matterId/proceedings`
- `POST /api/matters/:matterId/proceedings`
- `POST /api/matters/:matterId/proceedings/:proceedingId/authority-versions`
- `POST /api/matters/:matterId/proceedings/:proceedingId/events`
- `POST /api/matters/:matterId/proceedings/:proceedingId/filings`
- `POST /api/matters/:matterId/proceedings/:proceedingId/filings/:filingId/events`
- `POST /api/matters/:matterId/proceedings/:proceedingId/service-records`
- `POST /api/matters/:matterId/proceedings/:proceedingId/service-records/:serviceId/events`
- `POST /api/matters/:matterId/proceedings/:proceedingId/applications`
- `POST /api/matters/:matterId/proceedings/:proceedingId/orders`
- `POST /api/matters/:matterId/proceedings/:proceedingId/directions`
- `POST /api/matters/:matterId/proceedings/:proceedingId/directions/:directionId/events`
- `POST /api/matters/:matterId/proceedings/:proceedingId/hearings`
- `POST /api/matters/:matterId/proceedings/:proceedingId/hearings/:hearingId/events`

The first UI exposes the highest-risk commands: create proceeding, record authority, prepare filing, confirm external filing/issue, record service, retain order, create direction, record direction evidence and create/update hearing. Lower-frequency correction and application actions remain API-complete and may use compact dialogs.

## Matter 360 experience

The Proceedings rail item becomes active. The workspace header shows court, claim number, procedure, track, issue state and the nearest source-backed court date.

Tabs:

1. **Case** — authority, issue history, parties, court and allocation.
2. **Filings & service** — exact documents, receipts, per-recipient service and reviewed dates.
3. **Directions** — open, due-soon, overdue, stayed, disputed and satisfied obligations with provenance.
4. **Applications** — requested orders, evidence, notice, filing/service and outcome.
5. **Hearings & orders** — listings, attendance, bundles, outcomes, sealed orders and judgments.

Critical distinctions are visible in copy and colour but never colour alone: submitted vs accepted vs issued; step completed vs service reviewed; performance asserted vs satisfied; hearing outcome vs sealed order.

The mobile view keeps the next court date, overdue directions and issue/service risk above the fold. Destructive-looking actions use explicit confirmation text and state exactly what SwiftClaim will and will not assert.

## Workflow readiness

Negotiation to Proceedings retains the existing `court_authority_recorded` checklist key, now objectively backed by a current approved authority version for the exact claim documents.

Proceedings to Settlement is permitted only when:

- an issued proceeding has a retained sealed claim form and case number;
- all critical open court directions are satisfied, stayed, superseded or waived by a sealed order; and
- the court disposal/settlement procedural position has been human-reviewed.

A partner may use the existing workflow override mechanism for an operational transition, but the underlying proceeding risks remain visible and immutable.

## Evaluation journey

The Maya Patel matter is progressed into Proceedings in the synthetic seed with:

- independently approved authority for exact claim-form and particulars versions;
- a submitted issue request followed by a separately verified issued event and sealed claim form;
- service on the landlord with a completed postal step and reviewed deemed-service position;
- an acknowledged defence and directions questionnaire;
- a sealed allocation/directions order;
- disclosure satisfied with retained filing evidence;
- witness statements due soon;
- an expert direction marked performance asserted but not satisfied;
- a listed case-management hearing with a retained listing notice;
- no live provider calls and no real client or court data.

This seed must be replay-safe and must demonstrate that partner, solicitor, paralegal and cross-tenant users see different authorised outcomes.

## Testing

Tests cover:

- strict contracts and cross-field validation;
- migration installation, tenant foreign keys and append-only triggers;
- pure proceeding, filing, service, direction and hearing projections;
- exact-version issue authority and independent approval;
- submitted/accepted/issued separation;
- per-recipient service and human-reviewed date provenance;
- sealed-order requirements and direction supersession;
- evidence-required satisfaction and sealed-order-only waiver;
- idempotent retries and conflicting key reuse;
- generic `404` tenant isolation;
- role capability boundaries;
- workflow readiness and preserved override risks;
- seeded evaluation replay;
- Matter 360 rendering, critical labels and responsive interaction;
- full regression, type-check and production build.

## Future seams

Future HMCTS adapters will translate provider events into the same filing/event model. Future AI may propose document classifications, extract candidate directions, compare a draft pleading to source facts, summarise orders and prepare hearing notes. Every AI output must be stored as a generation with model/version, source set, structured candidate output and human disposition; it cannot create an issued event, service review, sealed order or satisfied direction directly.
