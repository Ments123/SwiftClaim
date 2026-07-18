# Governed Pleadings and Response Control Design

**Status:** Approved by the product owner on 18 July 2026
**Date:** 18 July 2026
**Scope:** SwiftClaim Litigation only

## Outcome

SwiftClaim will add a defendant-centric Pleadings & responses workspace inside Proceedings. It will preserve the exact statements of case and the events that affect them, project response dates only from verified inputs, and give solicitors an auditable review surface for acknowledgments of service, defences, replies, counterclaims, amendments and default-judgment preparation.

The feature is a legal operations control plane. It does not decide whether a pleading is legally sufficient, service is valid, a deadline has expired as a matter of law, default judgment is available, an amendment is permissible, or a statement of truth may be signed. Those remain human decisions supported by retained sources.

## Delivery boundary

This milestone includes:

- claimant and defendant statements of case in one governed ledger;
- a separate response track for each defendant and claim pairing;
- acknowledgment, defence, reply, counterclaim and defence-to-counterclaim positions;
- admissions and jurisdiction challenges as recorded positions, not full standalone workflows;
- exact document-version lineage and immutable prepared, filed, accepted, served, rejected, corrected and superseded events;
- filing and service state kept separate for every document and recipient;
- source-backed response-date projections with explicit review and exception states;
- amendment routes based on service position, written consent or court permission;
- statement-of-truth status and signatory metadata without signing or approving legal content;
- a default-judgment review checklist that never asserts eligibility;
- permission-gated commands, idempotency, optimistic concurrency, audit, timeline and outbox records;
- a responsive Pleadings & responses tab and representative synthetic evaluation data.

This milestone does not include:

- automated legal advice, autonomous pleading or statement-of-truth signing;
- automated default-judgment applications or conclusions about entitlement;
- end-to-end admissions, jurisdiction, set-aside or relief-from-sanctions workflows;
- live HMCTS, CE-File, MyHMCTS, payment or service-provider integrations;
- AI drafting or document extraction;
- disclosure, witness evidence, trial bundles, costs, enforcement, SwiftBridge or Proclaim migration.

## Source position

The design is grounded in the official Civil Procedure Rules in force at design time:

- [CPR Part 9](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part09) describes the principal ways a defendant may respond.
- [CPR Part 10](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part10) governs acknowledgment of service, including its general period and its relationship with jurisdiction challenges.
- [CPR Part 11](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part11) requires acknowledgment before an application disputing jurisdiction.
- [CPR Part 15](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part15) contains the general defence periods and their exceptions.
- [CPR Part 12](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part12) contains default-judgment conditions and exclusions; [CPR Part 13](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part13) addresses setting aside or varying default judgment.
- [CPR Part 16](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part16), [Practice Direction 16](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part16/pd_part16) and [CPR Part 22](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part22) govern statement-of-case content and verification.
- [CPR Part 17](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part17) and [Practice Direction 17](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part17/pd_part17) govern amendments, permission and amended-document practice.
- [CPR Part 20](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part20) governs counterclaims and other additional claims.
- [CPR Part 6](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part06), [Practice Direction 6B](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part06/pd_part06b) and [CPR Part 8](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part08) demonstrate why ordinary Part 7 response periods cannot be applied universally.

Rules, orders and procedural facts can change. Every projection therefore retains its rule key, rule version, source URL, trigger fact, inputs, timezone, calculation outcome and human-review state. A court-stated date is retained as a source date and is not recalculated.

## Approaches considered

### Extend court filings only

Adding more filing categories would be fast, but a filing attempt cannot represent a party-specific response regime, pleading lineage, amendment authority or the difference between filing and service. This approach was rejected.

### Full workflow engine per pleading

A configurable workflow could model every procedural branch, but it would introduce premature complexity and encourage SwiftClaim to encode legal conclusions. This can be revisited after several real firms have exercised the canonical event model.

### Event-led, per-party response ledger — selected

Use an immutable ledger for exact pleading versions and legally relevant external events, scoped to each defendant and claim pairing. Deterministic projections then provide current positions, dates and review prompts. This extends SwiftClaim's existing governed Proceedings architecture and supports future integrations without making an external provider response authoritative by itself.

## Domain model

### Response track

`claim_response_tracks` is the stable aggregate for one proceeding, claimant-side claim and responding defendant. It stores tenant and matter scope, proceeding, claimant party, defendant party, procedure regime, service position, active claim-form and particulars versions, optimistic version and current projection metadata.

The procedure regime is one of `part_7_domestic`, `part_7_service_out`, `part_8`, `court_directed` or `manual_review`. Selecting a regime records a human assertion, not a legal conclusion.

`claim_response_track_events` is append-only:

- `track_opened`
- `service_basis_recorded`
- `regime_confirmed`
- `response_source_date_recorded`
- `deadline_reviewed`
- `extension_recorded`
- `stay_recorded`
- `stay_lifted`
- `track_closed`
- `correction`

A service basis links the exact claim-form and particulars service records used as trigger facts. It never upgrades an unreviewed service event into valid service.

### Statements of case

`statements_of_case` identifies a logical pleading: claim form, particulars, acknowledgment of service, defence, reply, counterclaim, defence to counterclaim, Part 8 acknowledgment, amended statement or other statement of case.

`statement_of_case_versions` is immutable. Each version records:

- exact retained document version;
- party on whose behalf it is made and affected response track;
- version number, predecessor and amendment reason;
- prepared time and preparer;
- statement-of-truth status: `not_applicable`, `required_unconfirmed`, `present_unsigned`, `signed`, `defective_or_disputed` or `not_reviewed`;
- stated signatory name, capacity and signed date when human-recorded;
- response positions: defend all, defend part, admit all, admit part, jurisdiction challenged, counterclaim included or not recorded;
- amendment route: before service, written consent, court permission, court direction or not applicable;
- exact consent, application or sealed-order source where required.

SwiftClaim records what a human or retained source says. It does not determine whether the wording, signature or amendment complies with the CPR.

`statement_of_case_events` is append-only:

- `prepared`
- `approved_for_filing`
- `filed`
- `provider_acknowledged`
- `court_accepted`
- `served`
- `rejected`
- `withdrawn`
- `corrected`
- `superseded`
- `permission_granted`
- `permission_refused`

Filing and service events link existing governed `court_filings` and `court_service_records`. Provider acknowledgment is never treated as court acceptance. Each recipient's service remains distinct.

### Deadline projections

`pleading_deadline_projections` stores a reproducible projection rather than an authoritative legal deadline. Projection kinds include acknowledgment, defence, reply, counterclaim response and amended-statement filing/service.

The calculation service accepts verified trigger facts and returns one of:

- `projected`: a date can be calculated under an explicitly selected rule;
- `source_date`: the date was stated by a court order or other retained source;
- `manual_court_period_required`: the regime does not support a safe built-in calculation;
- `blocked_missing_facts`: required trigger facts are absent or unreviewed;
- `superseded`: a later event replaced the projection.

Ordinary 14-day and 28-day Part 7 calculations are available only when the confirmed regime and reviewed service inputs qualify. Part 8, service out, court-directed periods, disputed service, inconsistent source dates and unknown exceptions do not receive an ordinary default calculation.

Every projection stores the calculation inputs, source rule, source version/date, source URL, generated time and reviewer. Extension events create a new projection and retain the old one.

### Default-judgment review

`default_judgment_reviews` is a versioned human checklist, never an eligibility determination. A review covers:

- exact claim and service sources reviewed;
- acknowledgment, defence and admission searches performed;
- projected or source response date and its review state;
- Part 12 exclusion questions;
- claim type and requested judgment method;
- multiple-defendant and separability review;
- amount or remedy requiring court determination;
- other known applications, stays, extensions or jurisdiction positions;
- reviewer, review time, notes and unresolved blockers.

The UI labels its outcome `review incomplete`, `blockers recorded` or `human review completed`. It must never display `eligible`, `entitled`, `safe to enter` or equivalent legal conclusions. Recording a request for default judgment and recording the resulting judgment are separate filing and court events.

### Amendments

An amended pleading is always a new immutable `statement_of_case_version`. The amendment record retains both the marked-up proposal and clean amended document when available, plus the exact authority source.

The command layer requires:

- a reviewed not-served position for the `before_service` route;
- exact written consent for the `written_consent` route;
- a sealed order or recorded application outcome for `court_permission` or `court_direction`;
- statement-of-truth status;
- separate filing and per-recipient service events after amendment.

These are data-quality guards, not conclusions that permission is legally required or sufficient.

## State, security and integrations

All reads and commands are tenant- and matter-scoped. Cross-tenant identifiers return not found. Commands use optimistic versions and an idempotency key bound to firm, matter, proceeding, route entity and validated input hash. Reusing a key with different input returns conflict; retrying the same command returns its original receipt without duplicate legal events, audits, timeline entries or outbox messages.

Corrections append a replacement event that identifies the superseded event and reason. No legal event or exact document version is overwritten.

Every accepted command writes the aggregate event, a security audit record, a matter timeline event and a transactional outbox message in one transaction. Logs and general chronology omit protected document content, service endpoints, signatures and privileged notes.

## Permissions

This milestone adds:

- `pleadings.read`
- `pleadings.prepare`
- `pleadings.record_external`
- `pleadings.approve_claimant_statement`
- `pleadings.review_default`
- `pleadings.record_amendment_authority`

Admin and partner roles receive all capabilities. Solicitors receive all capabilities, subject to the existing independent-review policy for their own claimant pleading. Paralegals may read, prepare and record externally verified filing/service facts, but may not approve claimant statements, complete default review or record amendment authority. Finance and readonly roles receive no pleading capability in this milestone.

Existing `proceedings.read` remains necessary to enter the containing workspace. A user must satisfy both the containing Proceedings permission and the command-specific Pleadings permission.

## API and application services

The read endpoint returns a single defendant-centric workspace projection containing response tracks, statements and versions, filing/service positions, deadlines, amendment lineage, default reviews and available commands.

Command endpoints are narrow and append-only:

- open a response track and record its regime/service basis;
- add a statement version;
- record approval, filing, acceptance, rejection or service;
- record a response source date or reviewed rule projection;
- record an extension, stay or correction;
- record amendment authority and supersession;
- create or complete a default-judgment review.

All request and response contracts use strict schemas and stable enum values. Application services own authorization, transaction boundaries, idempotency and audit/outbox creation. Stores own persistence only. Pure projection functions own chronology and current-state calculation.

## User experience

Matter 360 gains a lazy-loaded **Pleadings & responses** tab within Proceedings. The default view is grouped by defendant and shows:

- current response position and exact active versions;
- nearest projected or source response date with its basis and review badge;
- acknowledgment, defence, counterclaim and amendment status;
- unreviewed facts, contradictions and default-review blockers;
- filing and service as separate, explicit states.

Detail drawers show immutable history and source links. Permission-gated dialogs perform commands. Legal-state copy is precise: `filed` is not `accepted`, `accepted` is not `served`, `projected` is not `court ordered`, and `review completed` is not `eligible for default judgment`.

Protected client instructions and privileged notes are not included in the general workspace payload unless the user separately has the applicable protected-content capability.

## Evaluation journey

Synthetic matter data will demonstrate:

1. a domestic Part 7 defendant whose reviewed service basis projects acknowledgment and defence dates;
2. an acknowledgment recorded before the defence projection is refreshed;
3. a received defence containing a counterclaim, with filing and service represented separately;
4. an amendment proposal linked to a permission source and a superseded pleading version;
5. a default review that remains blocked by an unresolved Part 12 question.

No real client, court, solicitor, address or document data is used.

## Verification

Tests must prove:

- migration constraints, tenant scoping and immutable version/event history;
- strict contracts and stable response shapes;
- ordinary Part 7 14/28-day projection behavior and safe blocking for Part 8, service out, disputed or incomplete inputs;
- source dates and extensions supersede rather than mutate prior projections;
- filing, acknowledgment, acceptance and service remain distinct;
- amendment routes retain exact authority and document sources;
- default review never exposes an automated eligibility conclusion;
- role and cross-tenant restrictions on reads and commands;
- idempotent retries and conflicts for changed payloads;
- one audit, timeline and outbox record per accepted command;
- accessible responsive UI states and permission-gated controls;
- typecheck, complete automated suite and production build.

## Acceptance criteria

The milestone is accepted when an authorized solicitor can open a defendant response track, retain exact pleading versions, record distinct filing and service events, see a reproducible and explicitly qualified response-date projection, record a governed amendment, and complete a source-backed default review without SwiftClaim making a legal conclusion.
