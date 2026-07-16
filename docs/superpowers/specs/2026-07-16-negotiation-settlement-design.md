# Negotiation and Settlement Authority Design

**Date:** 16 July 2026
**Status:** Approved
**Product:** SwiftClaim Litigation
**Jurisdictional scope:** Claimant Housing Conditions matters in England

## Purpose

This milestone makes SwiftClaim's Negotiation and Settlement stages operational without allowing software to make a legal decision for a solicitor or client. It extends the existing governed offers, quantum, communications, documents and workflow records with:

- a human-reviewed current negotiation position;
- understandable advice linked to the exact sources reviewed;
- immutable client instructions;
- exact-term client and firm authority;
- controlled approval and external-action gates;
- structured settlement terms and instruments; and
- post-settlement obligation tracking through completion, dispute or authorised waiver.

The design continues the synthetic Maya Clarke evaluation matter from Repairs and quantum into Negotiation. It preserves the existing protected Part 36 offer, records a human advice and instruction journey, and demonstrates a counteroffer that cannot be communicated until exact-term authority is present.

## Design decision

### Selected: a bounded negotiation domain

Add `src/server/negotiation/` as a separate domain that references existing offers and immutable source records. It owns advice, client instructions, authority, negotiation actions, settlements and compliance. The browser receives one purpose-built workspace through a narrow service boundary.

This is preferred because:

- quantum remains responsible for arithmetic, valuation provenance, repairs and offer facts;
- communications remains responsible for what was recorded or externally dispatched;
- negotiation owns the human decision and authority chain;
- settlement owns agreed terms and outstanding performance; and
- protected material can be segregated before counts or payload assembly.

### Rejected: extend the quantum store

This would be quicker initially but would combine valuation, protected advice, client decisions, authority and settlement compliance in an already broad persistence boundary. It would also make permissions and future supervised-AI boundaries harder to reason about.

### Deferred: combine proceedings with negotiation and settlement

Proceedings requires a separate court model for issue, service, statements of case, directions, hearings, orders and court-specific deadlines. Combining it with this milestone would reduce testability and encourage incomplete legal abstractions. Proceedings is the next milestone.

## Official source boundary

The feature records source facts and human decisions. It does not encode these sources as an autonomous legal decision engine.

1. **SRA Code of Conduct for Solicitors, RELs, RFLs and RSLs**, current version stated effective from 11 April 2025, retrieved 16 July 2026:
   - solicitors act only on instructions from the client or a properly authorised person;
   - suspected instructions that do not represent the client's wishes require resolution before acting;
   - information must be provided in a way the client can understand so the client can make informed decisions.
   - Source: `https://www.sra.org.uk/solicitors/standards-regulations/code-conduct-solicitors/`
2. **Civil Procedure Rules Part 36**, retrieved 16 July 2026:
   - Part 36 is a self-contained procedural code;
   - an offer must be in writing and include the structured matters in rule 36.5;
   - acceptance is by serving written notice;
   - court permission is required in specified circumstances;
   - acceptance may stay all or part of a claim; and
   - the single-sum payment period is subject to rule 36.14 and any written agreement or order.
   - Source: `https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part36`
3. **Civil Procedure Rules Part 40**, retrieved 16 July 2026:
   - rule 40.6 governs judgments and orders in agreed terms;
   - agreed stays, payments, dismissals, discharge and costs provisions may require a consent judgment or order; and
   - the order must retain its agreed form, consent marking and required signatures.
   - Source: `https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part40`

SwiftClaim stores the source title, URL, retrieval date and reviewed rule version used for any date projection. Historic records do not silently change when a source changes.

## Goals

An authorised user must be able to:

1. see the current damages, repairs and offer position without copying the underlying records;
2. compare selected offers and material terms side by side;
3. record a solicitor's advice against exact source versions;
4. record how information was communicated in an accessible form;
5. record the client's exact instruction and identity/authority basis;
6. define and version the authority applicable to a proposed action;
7. request and record partner approval for an exact action version;
8. invalidate authority and approval when material terms change;
9. prevent an acceptance, rejection, withdrawal or counteroffer action without the required current instruction and approval;
10. link an external negotiation act to an immutable communication or document source;
11. record agreed settlement terms without claiming that they are valid or binding;
12. retain the executed or filed settlement instrument as an exact document version;
13. create and monitor structured settlement obligations;
14. prevent closure while an obligation is outstanding, disputed or unreviewed; and
15. preserve protected material outside ordinary chronology, counts and payloads.

## Out of scope

This milestone does not include:

- AI-generated settlement recommendations or autonomous advice;
- automatic valuation, liability, prospects, costs or Part 36 validity conclusions;
- automatic acceptance, rejection, withdrawal, counteroffer or waiver;
- live email, WhatsApp, post, e-signature, court filing or payment integrations;
- client portal signing or identity verification;
- client-money accounting, trust ledgers or payment reconciliation;
- costs budgeting, detailed assessment or bill preparation;
- court proceedings, directions, hearings or enforcement applications;
- template selection that implies a consent order, Tomlin order or agreement is legally suitable; or
- SwiftBridge or Proclaim migration work.

## Core principles

### Exact terms, exact authority

Authority applies to one immutable action version containing the selected offer or proposed terms, recipients, scope and intended action. Any material edit creates a new version and invalidates prior client instruction and firm approval for that action.

### Instructions are evidence, not a checkbox

A client instruction records the decision, the advice version considered, who gave it, who took it, when and how it was received, the identity/authority basis, accessibility measures, understanding confirmation and any retained source communication or document. A later instruction supersedes rather than updates the earlier record.

### Advice remains human-authored

SwiftClaim may assemble source facts and calculate exact arithmetic already approved by the quantum domain. It does not select an outcome or produce a recommendation. The advice record names its author and reviewer and separates:

- confirmed source facts;
- options explained;
- human risk analysis;
- costs/funding consequences explained;
- human recommendation, if any;
- information or advice limitations; and
- the client's questions.

### Recording is not communication

Creating an action, instruction, approval or settlement record does not communicate anything externally. An external act requires an explicit immutable source:

- a dispatched communication ledger entry;
- an exact document version plus a verified dispatch/service record; or
- a manual external-act record with actor, occurred time, recipient, method and retained evidence.

The UI never labels an action sent, served, accepted or binding from draft or provider-accepted state alone.

### Settlement is not closure

A concluded settlement can still have payment, repairs, costs, filing, confidentiality, document or other obligations. The matter remains operational until every obligation is satisfied or waived by an authorised human with a retained reason.

## Domain architecture

### `NegotiationStore`

Owns tenant-scoped persistence and atomic writes for reviews, instructions, authority, actions, approvals, settlements and obligations. Every write also appends the correctly redacted audit, chronology, domain-event and integration-outbox records in the same database transaction.

### `NegotiationService`

Owns capabilities and legal safety invariants:

- protected access;
- source visibility;
- current-version checks;
- exact advice/instruction/action linkage;
- client and firm authority requirements;
- settlement conclusion gates;
- external-source requirements; and
- workflow readiness.

### Pure projections

Pure modules fold append-only events into:

- current authority status;
- current negotiation action state;
- settlement status;
- obligation status;
- readiness controls; and
- warnings.

They use deterministic event ordering and never infer legal validity, reasonableness, breach or enforceability.

### `NegotiationReadinessProvider`

Integrates with the workflow service. It supports:

- Negotiation → Proceedings when settlement authority has been reviewed and no unacknowledged critical authority blocker remains;
- Negotiation → Settlement through a new explicit alternate-stage transition when agreed terms and current authority are recorded; and
- Settlement → Closure only when the settlement instrument and obligations are complete or validly waived for workflow purposes.

The workflow result is operational readiness, not a legal conclusion.

## Data model

Migration 8 adds the following firm- and matter-scoped records with composite foreign keys.

### `negotiation_reviews`

Immutable human review of the current negotiating position:

- ID, firm, matter and sequential review number;
- confidentiality: `ordinary`, `privileged` or `protected_negotiation`;
- reviewed-on and author/reviewer users;
- selected offer IDs;
- exact loss-schedule, valuation-review and work-schedule IDs where applicable;
- liability/causation/quantum/costs/risk narrative entered by a legal user;
- options explained and human recommendation;
- advice limitations and outstanding information;
- source manifest JSON and digest;
- superseded review ID and reason; and
- created time and command idempotency key.

The source manifest contains stable IDs, record versions and document hashes. It does not duplicate protected offer terms into ordinary records.

### `client_instructions`

Immutable instruction evidence:

- instruction type: `accept`, `reject`, `counter`, `clarify`, `continue_negotiation`, `issue_proceedings`, `agree_terms`, `other`;
- linked advice/review ID;
- linked negotiation action version when the instruction concerns exact terms;
- instructing person and relationship/authority basis;
- decision and bounded factual note;
- received method and time;
- taken-by user;
- identity status and note;
- understanding confirmation and accessibility measures;
- source communication-entry or document-version ID;
- explicit confirmation that the user is recording the client's instruction;
- superseded instruction ID and reason; and
- immutable audit metadata.

An instruction without an exact action version can support general strategy but cannot authorise an external accept, reject, withdraw or counter action.

### `settlement_authority_versions`

Versioned matter-level authority envelope:

- version and status: `draft`, `current`, `superseded`;
- source: `client_specific`, `retainer`, `firm_policy`, `court_or_representative`, `other`;
- scope and offer/action types covered;
- monetary minimum/maximum in integer minor units where supplied;
- permitted non-money terms;
- costs and repair constraints;
- expiry/review date;
- client-instruction requirement;
- partner-approval requirement;
- source document version;
- human review note; and
- creator/reviewer and timestamps.

The server compares only explicit structured constraints. It does not decide that an amount is reasonable or in the client's best interests.

### `negotiation_actions` and `negotiation_action_versions`

Mutable aggregate with immutable exact versions:

- action type: `make_offer`, `counteroffer`, `accept`, `reject`, `withdraw`, `clarify`, `record_agreement`;
- linked existing offer where relevant;
- confidentiality;
- recipients and scope;
- damages, costs and total amounts in integer minor units;
- works, non-money, interest, confidentiality and payment terms;
- proposed instrument type;
- exact document versions;
- current version, status and optimistic record version;
- current client-instruction ID;
- current firm-approval status; and
- external-act source after authorised performance.

Statuses are `draft`, `instruction_required`, `approval_required`, `authorised`, `externally_recorded`, `cancelled` and `superseded`. Status changes retain append-only events.

### `negotiation_approval_events`

Append-only decisions for an exact action version:

- `submitted`, `approved`, `rejected`, `withdrawn`, `invalidated`;
- actor and role;
- note;
- linked instruction and authority version;
- occurred time; and
- source request ID.

Only the latest approval for the current action version can authorise performance.

### `settlements`

Settlement aggregate with controlled mutable preparation state and immutable concluded versions:

- settlement reference and type: `part36_acceptance`, `consent_order`, `tomlin_order`, `settlement_agreement`, `deed`, `oral_recorded`, `other`;
- scope: whole claim, part, issue, costs only or works only;
- confidentiality;
- linked originating action, offer and client instruction;
- status: `preparing`, `authority_required`, `terms_agreed`, `instrument_pending`, `court_approval_pending`, `concluded`, `failed`, `superseded`;
- explicit court-approval-required position: `unknown`, `not_required_reviewed`, `required`, `obtained`;
- current terms version;
- concluded-by user and time; and
- source external act and exact instrument document version.

### `settlement_term_versions`

Immutable versions containing:

- damages, costs and total amounts;
- payment method and due date;
- repair items, standards and dates;
- access, inspection and verification terms;
- liability/admission position as entered;
- interest, confidentiality, discontinuance/stay/dismissal and enforcement wording;
- other terms;
- source manifest and digest; and
- author/reviewer metadata.

Changing any term invalidates prior approval and conclusion authority.

### `settlement_obligations`

Created from human-confirmed agreed terms, not inferred from free text:

- type: `payment`, `costs`, `repair`, `access`, `inspection`, `document`, `filing`, `confidentiality`, `other`;
- responsible party;
- beneficiary;
- description;
- amount where applicable;
- due date/time and timezone;
- evidence requirement;
- status projection; and
- source settlement-term version.

### `settlement_obligation_events`

Append-only events:

- `due_confirmed`, `performance_asserted`, `satisfied`, `part_satisfied`, `overdue_reviewed`, `disputed`, `waived`, `corrected`;
- occurred time, actor, note and evidence document/communication IDs;
- amount satisfied where applicable;
- superseded event and correction reason; and
- explicit confirmation for satisfaction or waiver.

`performance_asserted` never becomes `satisfied` automatically. Waiver requires partner/admin capability and a retained authority source.

### `negotiation_command_receipts`

Stores firm, matter, command type, idempotency key, payload digest, result entity and created time. Reusing a key with a different payload returns `409`.

## Permissions

Add capabilities:

- `negotiation.read`;
- `negotiation.read_protected`;
- `negotiation.prepare`;
- `negotiation.record_instruction`;
- `negotiation.approve`;
- `negotiation.record_external_action`;
- `settlement.manage`;
- `settlement.conclude`;
- `settlement.waive_obligation`.

Default evaluation policy:

- admin/partner: all capabilities;
- solicitor: read, protected read, prepare, record instruction, record external action, manage settlement and conclude when separate approval is not required;
- paralegal: ordinary read and prepare only;
- finance and readonly: no negotiation or settlement workspace access.

Matter access remains an additional requirement. Cross-firm and inaccessible resources return generic `404`. Capability failures on an otherwise visible matter return `403`.

## Confidentiality

Ordinary workspace queries never join or serialise protected offer terms, protected advice, protected instructions, protected actions or protected settlements. Protected counts are computed only for users with `negotiation.read_protected` and are otherwise omitted rather than returned as zero.

Protected access requires an explicit endpoint/action. General chronology and outbox metadata use neutral labels and redacted payloads. Audit payload sensitivity follows the source record.

No protected term enters:

- ordinary Matter 360 summary;
- ordinary dashboard counts;
- ordinary workflow blocker text;
- unrestricted search indexes;
- generated merits documents; or
- logs and error responses.

## Action and settlement invariants

An external negotiation action is rejected unless:

1. the exact current action version is selected;
2. the action is not stale, cancelled or superseded;
3. a current client instruction expressly covers that action version;
4. the instruction identity/authority position is confirmed;
5. all required firm approval applies to that same action version;
6. the selected authority version is current and not expired;
7. the actor has the external-action capability;
8. explicit performance confirmation is true; and
9. an immutable external source is supplied.

A settlement is rejected as concluded unless:

1. the exact current terms version is approved;
2. current client instructions agree those exact terms;
3. required firm approval is current;
4. the court-approval position has been explicitly reviewed;
5. required court approval is recorded as obtained;
6. an exact instrument or permitted retained source is linked;
7. structured obligations have been reviewed; and
8. the concluding user explicitly confirms they are recording a human decision and external fact.

These checks are operational controls only. Passing them never labels the settlement legally valid, binding, enforceable or advisable.

## Workflow integration

The workflow definition gains explicit alternate transitions rather than assuming every matter must enter proceedings:

- `negotiation -> proceedings`;
- `negotiation -> settlement`; and
- existing sequential transitions elsewhere.

Negotiation readiness exposes:

- `negotiation_position_reviewed`;
- `settlement_authority_recorded`;
- `client_instruction_current` where an action is selected; and
- no unacknowledged critical authority blocker.

Settlement readiness exposes:

- `settlement_terms_recorded`;
- `settlement_instrument_recorded`;
- `court_approval_position_reviewed`; and
- `settlement_obligations_resolved`.

The browser cannot satisfy an objective control by sending a checked key. The server compares it with the negotiation projection. Partner override retains every unresolved blocker and requires a reason.

## HTTP API

All bodies use strict Zod schemas and all mutations use current versions and idempotency keys where appropriate.

Workspace:

- `GET /api/matters/:matterId/negotiation-settlement`
- `GET /api/matters/:matterId/negotiation-settlement/protected`

Reviews and instructions:

- `POST /api/matters/:matterId/negotiation-reviews`
- `POST /api/matters/:matterId/client-instructions`

Authority and actions:

- `POST /api/matters/:matterId/settlement-authority-versions`
- `POST /api/matters/:matterId/negotiation-actions`
- `POST /api/matters/:matterId/negotiation-actions/:actionId/versions`
- `POST /api/matters/:matterId/negotiation-actions/:actionId/submit`
- `POST /api/matters/:matterId/negotiation-actions/:actionId/decisions`
- `POST /api/matters/:matterId/negotiation-actions/:actionId/external-actions`

Settlement:

- `POST /api/matters/:matterId/settlements`
- `POST /api/matters/:matterId/settlements/:settlementId/terms`
- `POST /api/matters/:matterId/settlements/:settlementId/conclude`
- `POST /api/matters/:matterId/settlements/:settlementId/obligations`
- `POST /api/matters/:matterId/settlement-obligations/:obligationId/events`

Error mapping:

- malformed/invalid command: `400`;
- visible matter but missing capability: `403`;
- concealed or missing tenant/confidential resource: `404`;
- stale version, idempotency mismatch or invalid state: `409`;
- accepted command that records an external fact: `201`; and
- reads: `200`.

Every error uses the existing `{ error: { code, message, fields? } }` envelope and never returns protected content in an error message.

## Matter 360 user experience

Enable a new rail section between Repairs & quantum and Proceedings: **Negotiation & settlement**.

### Position

- current reviewed damages and repairs source versions;
- selected open and protected offers, with protected terms behind the explicit gate;
- side-by-side monetary and non-money terms;
- unresolved source changes since the latest human review;
- clear labels separating arithmetic, source facts and human analysis; and
- actions to prepare a negotiation review or exact proposed action.

### Advice & instructions

- advice versions with author, reviewer and source freshness;
- accessible-information and costs/funding explanation fields;
- immutable instruction timeline;
- exact action-version linkage;
- identity, authority, method and retained-source provenance; and
- supersession rather than editing.

### Authority

- current authority envelope and expiry/review warnings;
- exact action version, required client instruction and approval state;
- partner decision timeline;
- prominent invalidation when terms change; and
- no send/record-external button until all gates pass.

### Settlement & compliance

- exact agreed-term versions;
- instrument and court-approval position;
- structured obligation board grouped by outstanding, asserted, disputed and resolved;
- due and overdue operational warnings;
- evidence links and exact hashes; and
- permanent warning that the record does not establish validity, enforceability or legal effect.

The layout must work at desktop, tablet and 390-pixel mobile widths. Interactive rows use native buttons, dialogs are keyboard accessible, filters have labels and loading/error/empty states match existing Matter 360 sections.

## Synthetic Maya journey

The idempotent evaluation seed will:

1. advance Maya's matter from Repairs and quantum to Negotiation using objective readiness;
2. retain the existing protected Part 36 offer through the explicit protected boundary;
3. create a privileged human negotiation review linked to the approved loss schedule, valuation, repair schedule and selected offer;
4. record that options, costs consequences and limitations were explained in an accessible form;
5. record Maya's synthetic instruction to reject that exact offer and make a specified counteroffer;
6. create a current client-specific authority version;
7. prepare the exact protected counteroffer action;
8. submit it for partner approval but leave the approval pending; and
9. show the external action as blocked with the precise missing authority reason.

No live communication or legal conclusion is created. The seed remains synthetic and safe to run repeatedly.

## Testing strategy

### Pure domain tests

- deterministic authority and action projections;
- approval invalidation after a new action version;
- obligation event ordering and correction;
- performance assertion remaining distinct from satisfaction;
- overdue warnings without inferring breach; and
- alternate workflow path selection.

### Contract and migration tests

- strict input validation and cross-field requirements;
- integer-minor-unit money boundaries;
- migration 8 ordering and checksum;
- composite tenant foreign keys;
- append-only triggers;
- exact source links; and
- idempotency uniqueness.

### Store and service tests

- protected filtering before counts and assembly;
- cross-firm and cross-matter source rejection;
- ordinary reader protected-content absence;
- exact instruction/action/approval linkage;
- stale authority rejection;
- role and capability decisions;
- settlement conclusion gates;
- authorised waiver only; and
- atomic audit, chronology, event and outbox writes.

### HTTP tests

- unauthenticated `401`;
- finance `403`;
- cross-firm `404`;
- protected endpoint capability enforcement;
- validation `400`;
- concurrency/idempotency `409`;
- successful ordinary and protected reads; and
- no protected material in ordinary responses or errors.

### Client tests

- lazy Matter 360 loading;
- explicit protected gate;
- source freshness and human-analysis labels;
- exact authority status;
- invalidated approvals;
- confirmation before recording an external act or conclusion;
- obligation status wording; and
- keyboard-accessible responsive controls.

### Release verification

- full test suite;
- strict client and server typecheck;
- production build;
- production dependency audit;
- fresh production-mode API journey;
- ordinary/protected confidentiality inspection;
- secret and generated-file scan; and
- browser verification when the supported browser tool is available, otherwise Testing Library plus production-mode Fastify injection.

## Acceptance criteria

This milestone is complete when:

1. Maya's Negotiation workspace loads from the seeded evaluation data;
2. ordinary users cannot infer protected record existence or content;
3. authorised users can trace advice and instructions to exact sources;
4. exact terms cannot be externally acted on without matching current instruction and approval;
5. changed terms invalidate prior authority;
6. settlement terms and instruments are versioned and source-linked;
7. obligations remain operational after agreement and block closure until resolved or authorisedly waived;
8. negotiation can proceed either to Proceedings or directly to Settlement through server-validated paths;
9. no screen or API claims an offer or settlement is valid, reasonable, binding, served or satisfied without the required human evidence; and
10. all automated and production verification gates pass before merge.
