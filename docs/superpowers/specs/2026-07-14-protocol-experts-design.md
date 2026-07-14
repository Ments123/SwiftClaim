# SwiftClaim Protocol and Experts Design

**Status:** Approved for implementation  
**Date:** 14 July 2026  
**Product:** SwiftClaim Litigation  
**Scope:** Claimant Housing Conditions matters in England

## 1. Purpose

This slice makes the existing **Pre-Action Protocol** and **Expert evidence** workflow stages operational. A solicitor must be able to turn the governed intake, tenancy, defect, notice and evidence records already held by SwiftClaim into a controlled Letter of Claim, record dispatch and receipt, monitor the landlord's response, and manage the expert route from proposal through report review.

The slice activates the existing **Protocol & experts** section in Matter 360. It does not decide whether the landlord is liable, decide whether expert evidence is legally necessary, send correspondence through an external provider, or replace solicitor review.

## 2. Approaches considered

### A. Document-first generator

Generate a Letter of Claim from a template and leave the response and expert work in tasks and free text. This is quick, but it recreates the document-led fragmentation SwiftClaim is intended to remove. It also makes deadline and workflow readiness dependent on users remembering what happened outside the system.

### B. Unified governed protocol caseboard — selected

Build one independently loaded Matter 360 workspace with a structured Letter of Claim, immutable approved versions, dispatch and receipt evidence, landlord response capture, expert engagement controls, milestone events and objective workflow readiness. Protocol and expert records remain separate bounded units behind one solicitor journey.

### C. Separate protocol and expert applications

This produces strong technical separation, but adds navigation and duplicated matter context before the product has enough expert volume to justify it. The domain boundaries in approach B permit a later split without imposing that cost on the first pilot.

## 3. Governing sources and product interpretation

The design was checked on 14 July 2026 against:

- the [Pre-Action Protocol for Housing Conditions Claims (England)](https://www.justice.gov.uk/courts/procedure-rules/civil/protocol/prot_hou);
- [CPR Part 35 — Experts and Assessors](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part35); and
- [Practice Direction 35 — Experts and Assessors](https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part35/pd_part35).

The product interpretation is deliberately conservative:

1. The Letter of Claim must expose the information listed in Protocol paragraph 5.2 and the disclosure request in paragraph 5.3.
2. The landlord response long stop is 20 working days from receipt under paragraph 6.2. A file or draft does not prove dispatch or receipt.
3. A single joint expert, separately instructed expert or joint inspection is a human-selected route. SwiftClaim never chooses the route.
4. Where a landlord response is recorded, the protocol inspection target is 20 working days from that response and the report or agreed schedule target is 10 working days from inspection under paragraph 7.4.
5. A further landlord response may be due within 20 working days after the single joint report or agreed schedule under paragraph 6.3.
6. The Protocol permits urgent earlier instruction and recognises that an expert may not be necessary. Both are explicit solicitor decisions with reasons.
7. CPR 35.6's 28-day rule for written clarification questions is not automatically applied to a pre-action report. The user may select a CPR 35 context only where a solicitor determines it applies.
8. Expert instructions, opinions and reports must preserve the expert's overriding independence. SwiftClaim cannot edit an expert opinion or present an expert as the client's advocate.
9. Protocol time limits may be varied by agreement, but the variation and reason must be recorded. A varied date supersedes rather than erases the original calculation.
10. Every legal calculation remains a reviewable aid. A solicitor must confirm the trigger fact and remains responsible for limitation and procedural decisions.

## 4. Goals

1. Prepare a complete, source-linked Letter of Claim from governed matter facts.
2. Preserve every approved and issued letter as an immutable document version and fact snapshot.
3. Record dispatch, actual or deemed receipt, corrections and supporting evidence without inferring service from document existence.
4. Calculate explainable protocol deadlines from user-confirmed legal events.
5. Capture the landlord's response by defect and across disclosure, access, works, compensation and costs.
6. Control expert proposal, conflict checks, terms, instruction, inspection, report and clarification milestones.
7. Support single joint expert, separate instructions to one expert, separate experts, joint inspection, urgent own expert and reasoned no-expert routes.
8. Prevent unsupported workflow confirmation while preserving a reasoned partner or administrator override.
9. Preserve tenant isolation, optimistic concurrency, idempotency, chronology and append-only audit evidence.
10. Provide a realistic synthetic evaluation journey in the existing Maya Clarke matter.

## 5. Non-goals

This slice does not include:

- automatic liability, causation, limitation, quantum or expert-necessity decisions;
- AI-generated legal conclusions, AI report analysis or unsupervised drafting;
- external email, post, WhatsApp, e-signature or telephony delivery;
- an expert portal, expert payments or supplier accounting;
- automatic RICS, CIEH, GMC or other professional-register verification;
- medical expert workflows or the Personal Injury Pre-Action Protocol;
- court permission applications, directions, expert discussions or joint statements after issue;
- damages schedules, offers, works verification or proceedings;
- editing or deleting issued letters, service events, responses, instructions, reports or questions; or
- approval for live client material.

## 6. Architecture

Add a bounded `protocol` domain beside `evidence`, `intake`, `matter` and `workflow`:

- `ProtocolStore` owns tenant-scoped persistence and workspace projections.
- `ProtocolService` owns permissions, optimistic commands, approval gates, idempotency, audit and chronology.
- `LetterOfClaimAssembler` converts authoritative matter records into a review model and source manifest.
- `LetterOfClaimRenderer` produces an HTML preview and deterministic DOCX bytes from the approved review model.
- `ProtocolReadinessProvider` validates protocol-stage and expert-stage workflow actions from server records.
- `protocol/routes.ts` exposes the workspace and resource commands.
- `ProtocolExpertsPanel` consumes one independently loaded workspace resource and delegates focused forms to letter, response and expert components.

The browser never supplies a firm identifier. Every store query includes the server-derived `firm_id` and authorised `matter_id`. The domain may read existing intake, tenancy, defects, notice, access, evidence and document records, but it cannot mutate them.

## 7. Data model

Migration `005-protocol-experts` adds strict, tenant-owned tables. Every child uses composite firm and matter foreign keys. Mutable aggregates use optimistic integer versions; evidential events and approved versions are append-only.

### 7.1 `protocol_cases`

One current-state coordinator per matter:

- `id`, `firm_id`, `matter_id`, `version`;
- `protocol_status`: `preparing`, `approved`, `issued`, `awaiting_response`, `response_received`, `expert_work`, `taking_stock`, `complete`;
- `expert_route`: `undecided`, `proposed_single_joint`, `single_joint_joint_instructions`, `single_joint_separate_instructions`, `separate_experts`, `joint_inspection`, `urgent_own_expert`, `not_required`;
- `expert_route_reason` and `urgent_reason`;
- `created_by`, `created_at`, `updated_by`, `updated_at`.

Changing the expert route requires a reason once a letter has been approved. `not_required` and `urgent_own_expert` require a solicitor, partner or administrator and cannot be inferred from claim value or defect severity.

### 7.2 `letters_of_claim`

One mutable working letter per protocol case:

- `id`, `firm_id`, `matter_id`, `protocol_case_id`, `version`;
- client/property and landlord addressee selections;
- effect-on-client narrative;
- personal-injury indicator and claimant summary;
- special-damages summary;
- access windows;
- proposed expert and instruction reference;
- disclosure requests;
- additional reviewed content;
- `draft`, `ready_for_review`, `approved`, `superseded` state;
- author, reviewer and timestamps.

The server assembles canonical defect, notice and repair-attempt histories from source records. The browser may add reviewed narrative but cannot replace source identifiers with unsupported facts.

### 7.3 `letter_of_claim_versions`

Every approval creates an immutable version containing:

- monotonically increasing version number;
- complete content JSON;
- source manifest JSON with record IDs and versions;
- template key and renderer version;
- SHA-256 content digest;
- exact generated `document_version_id` for the DOCX;
- approver and approval timestamp.

The source manifest makes later changes visible without silently rewriting the issued letter. A changed defect or notice produces a stale-source warning and requires a new reviewed version.

### 7.4 `protocol_service_events`

Append-only dispatch and receipt facts:

- event type: `dispatched`, `actual_receipt`, `deemed_receipt`, `receipt_disputed`, `delivery_failed`, `corrected`;
- method: `email`, `post`, `hand`, `portal`, `courier`, `other`;
- occurred date/time and date-only legal trigger where applicable;
- recipient and destination;
- exact issued letter version;
- optional supporting `document_version_id`;
- source detail, correction reason and `supersedes_event_id`;
- actor and timestamp.

A dispatch event never creates a receipt trigger by itself. For post, SwiftClaim may propose the Protocol's two-day deemed-receipt date, but a permitted solicitor must confirm it before deadline creation.

### 7.5 `landlord_responses`

Append-only response versions preserve:

- received date and responding party/contact;
- response type: `initial`, `expert_proposal`, `substantive`, `supplemental`, `no_response_recorded`;
- general liability position and reasons;
- notice and access position;
- disclosure supplied, withheld or outstanding;
- expert proposal response and instruction position;
- works schedule, intended start/completion dates and narrative;
- compensation and costs offers in integer minor units and ISO currency;
- source `document_version_id` where a response document exists;
- correction reason and superseded response;
- actor and timestamp.

Each response has append-only `landlord_response_defects` rows linking a defect and its admitted, denied, partly admitted, not addressed or unclear position. SwiftClaim reports what the response says; it does not decide whether that position is correct.

### 7.6 `expert_engagements`

One versioned engagement per proposed or instructed expert:

- route and role: building surveyor, environmental health, other housing-conditions expert;
- expert name, organisation and contact details;
- expertise, qualifications, registration body and registration reference as supplied;
- proposed-by party and single-joint indicator;
- terms status, fee basis, fee in integer minor units, currency and payer split;
- availability summary and target report date;
- state: `candidate`, `checks_pending`, `terms_pending`, `approved`, `instructed`, `inspection_booked`, `report_due`, `report_received`, `reviewed`, `cancelled`;
- version, actors and timestamps.

Storing a registration reference does not mean SwiftClaim has verified it. The UI labels the verification source and date explicitly.

### 7.7 `expert_conflict_checks`

Append-only checks record:

- checked expert engagement;
- parties and organisations included in the check;
- method and search detail;
- outcome: `clear`, `potential`, `blocked`, `unable_to_complete`;
- human decision and reason;
- checker and timestamp.

Search results never auto-clear a conflict. Only a permitted solicitor, partner or administrator can record the decision; a partner or administrator is required to proceed after a documented potential conflict.

### 7.8 `expert_instruction_versions`

Every approved instruction is immutable:

- engagement and instruction route;
- issues and questions;
- property, parties and access details;
- source document/evidence manifest;
- all material instructions supplied to the expert;
- urgent-work, schedule-of-works and cost-estimate requests;
- terms and report deadline;
- template and renderer versions;
- exact generated DOCX `document_version_id` and SHA-256 digest;
- approver and approval timestamp.

Instructions state the expert's duty to the court and avoid advocacy language. A subsequent change creates a new version; it never alters the version already sent.

### 7.9 `expert_milestone_events`

Append-only events cover:

- expert proposed, agreed, objected to or withdrawn;
- terms offered, accepted or rejected;
- instruction dispatched and acknowledged;
- inspection proposed, booked, rescheduled, completed, failed or cancelled;
- access provided, refused or unavailable;
- report received, reviewed, superseded or shared;
- joint schedule received;
- urgent issue escalated; and
- engagement completed or cancelled.

Events may link an exact instruction, report or supporting document version and may supersede an incorrect factual event.

### 7.10 `expert_report_records`, `expert_questions` and `expert_question_answers`

An expert report record links an exact immutable document version to the engagement and captures report type, report date, received date, coverage and urgent-work flag. Report review is a later append-only milestone with the reviewer and review timestamp; it never updates the report record. SwiftClaim stores no editable copy of the opinion.

Expert questions are append-only records linked to the exact report version. They contain the question, clarification purpose, author, dispatched date and agreed or solicitor-set response date. A later answer creates an append-only `expert_question_answers` row linked to an exact answer document version. A CPR 35.6 date can be calculated only when the user explicitly selects that legal basis and confirms the report service date.

## 8. Letter of Claim assembly and approval

`LetterOfClaimAssembler` builds a deterministic review model from:

- claimant and property records;
- tenancy and landlord records;
- active defect schedule and status histories;
- notice and access histories;
- linked evidence and immutable document versions;
- effects, personal-injury indicator and special-damages narrative reviewed in the letter workspace;
- proposed expert and instruction route; and
- standard disclosure requests from Protocol paragraph 5.3.

The assembler returns the source manifest and explicit blockers. It never invents missing dates, recipients, effects, losses or legal conclusions.

The approval journey is:

1. A matter writer refreshes source facts and edits permitted narratives.
2. SwiftClaim displays missing, stale or conflicting source facts.
3. A solicitor, partner or administrator marks the draft ready and reviews a complete preview.
4. Approval atomically creates an immutable snapshot, DOCX document version, audit event and chronology entry.
5. Dispatch is a separate command requiring the exact approved version.
6. Any amendment creates a new draft and approval version; the issued version remains unchanged.

Paralegals may prepare but cannot approve, record a legal receipt trigger, choose `not_required`, approve expert instruction or override readiness.

## 9. Deadline behaviour

The existing versioned workflow calculator remains authoritative. This slice connects it to controlled protocol events and adds the substantive-response rule where necessary.

| Confirmed event | Governed result |
|---|---|
| Letter of Claim actual or confirmed deemed receipt | Landlord response due after 20 working days. |
| Landlord response received | Expert inspection target after 20 working days. |
| Expert inspection completed | Report or agreed schedule target after 10 working days. |
| Expert report or agreed schedule received | Substantive landlord response target after 20 working days where paragraph 6.3 applies. |
| CPR 35.6 report service explicitly selected and confirmed | Clarification questions target after 28 calendar days. |

Each result records the trigger date, excluded weekends and holidays, rule version, source and calculation explanation. Agreed variation creates a superseding immutable deadline with the original retained. If no landlord response is received, SwiftClaim marks the response target overdue and exposes the Protocol paragraph 6.4 issue; it does not manufacture a `landlord_response.received` event or an inspection deadline.

## 10. Readiness and workflow enforcement

### 10.1 Protocol stage

`letter_of_claim_sent` is eligible for confirmation only when:

- an approved immutable Letter of Claim version exists;
- the exact version has a dispatch event;
- an actual or solicitor-confirmed deemed receipt event exists; and
- the server has created the corresponding landlord-response deadline idempotently.

Progression from Protocol to Expert evidence also requires one of:

- a landlord response has been captured;
- the response deadline has expired and a solicitor has recorded `no_response_recorded`; or
- an urgent expert route has been approved with reasons.

The expert route must be selected before ordinary progression.

### 10.2 Expert stage

`expert_instruction_confirmed` is eligible when an engagement has:

- an authorised route decision;
- an acceptable human conflict decision;
- recorded terms, fees and availability;
- an approved immutable instruction version; and
- an instruction-dispatched event.

Ordinary progression from Expert evidence to Repairs and quantum additionally requires either:

- completed inspection, received report or agreed schedule, and solicitor review; or
- an authorised `not_required` decision with reasons.

An overdue, failed or refused inspection remains a blocker until resolved or overridden. A partner or administrator may use the existing explicit override path with a mandatory reason. Every unsupported browser checklist value is rejected by the server.

## 11. API

The primary read resource is:

`GET /api/matters/:matterId/protocol-experts`

It returns protocol state, letter draft and versions, source manifest and blockers, service history, deadlines, landlord responses, expert engagements, conflict checks, instruction versions, milestones, reports, questions, readiness, risks and permissions.

Mutation routes are:

- `PUT /api/matters/:matterId/protocol/letter`;
- `POST /api/matters/:matterId/protocol/letter/approve`;
- `POST /api/matters/:matterId/protocol/service-events`;
- `POST /api/matters/:matterId/protocol/deadline-variations`;
- `POST /api/matters/:matterId/protocol/landlord-responses`;
- `PUT /api/matters/:matterId/protocol/expert-route`;
- `POST /api/matters/:matterId/experts`;
- `PATCH /api/matters/:matterId/experts/:engagementId`;
- `POST /api/matters/:matterId/experts/:engagementId/conflict-checks`;
- `POST /api/matters/:matterId/experts/:engagementId/instructions/approve`;
- `POST /api/matters/:matterId/experts/:engagementId/milestones`;
- `POST /api/matters/:matterId/experts/:engagementId/reports`;
- `POST /api/matters/:matterId/experts/:engagementId/questions`; and
- `POST /api/matters/:matterId/experts/:engagementId/questions/:questionId/answers`.

Mutable commands require `expectedVersion` and return `409 CONFLICT` when stale. Append-only commands require an idempotency key. A generated document, its metadata, audit, chronology and domain event are created atomically or not at all. Inaccessible and cross-firm resources return the same generic `404` envelope.

## 12. Risk projection

The workspace returns deterministic operational risks:

- Letter of Claim source facts changed after approval;
- approved letter not dispatched or receipt not confirmed;
- landlord response overdue or response document missing;
- response omits a defect, disclosure category or works date;
- expert route undecided;
- potential or blocked expert conflict;
- terms, fees, availability or instruction approval missing;
- inspection due soon, overdue, failed or lacking access;
- report overdue, missing, superseded or not reviewed;
- urgent works identified but not escalated; and
- clarification answer overdue against an explicitly recorded date.

Risk wording must distinguish fact, source and inference. It must not state that liability, breach, causation, professional competence or recoverability is established.

## 13. Audit and chronology

Every successful mutation adds the domain record or version, a solicitor-readable matter chronology entry and an audit event with actor, request ID, IP address and relevant before/after state.

Database triggers reject update or deletion of approved letter versions, service events, landlord response versions and defect positions, conflict checks, instruction versions, milestones, report records, questions and answers. Corrections use explicit supersession. Generated document versions retain private storage, SHA-256 verification and authorised download controls.

## 14. Matter 360 experience

The activated **Protocol & experts** workspace uses three views within one page.

### 14.1 Letter of Claim

- protocol status, source freshness and deadline strip;
- source-linked sections matching the official Letter of Claim content;
- evidence and disclosure coverage summary;
- missing-fact blockers and stale-source warnings;
- edit, refresh facts, preview, approve and download controls; and
- approved/issued version history.

### 14.2 Landlord response

- dispatch and receipt chronology;
- 20-working-day deadline and calculation explanation;
- response capture with exact source document;
- by-defect admissions and denials;
- disclosure, notice, access, works, compensation and costs positions; and
- no-response and agreed-variation controls.

### 14.3 Experts

- selected route and reason;
- expert cards with conflict, terms, fee, availability and instruction state;
- inspection and report milestone timeline;
- exact instruction/report document versions;
- urgent-work escalation; and
- clarification questions and answers.

Read-only users may inspect but cannot mutate. Paralegals see preparation actions only. Mobile places deadline/risk and next action before long content. Dialogs remain keyboard operable and every state uses text as well as colour.

## 15. Synthetic evaluation state

The Maya Clarke matter is seeded with:

- a complete draft Letter of Claim assembled from the existing five defects and notice evidence;
- one deliberate stale or missing source issue visible before approval;
- an approved synthetic letter version and dispatch/receipt history for the longer-running protocol journey;
- a synthetic landlord response addressing some but not all defects;
- a proposed single joint surveyor with supplied qualifications, conflict decision, terms and availability;
- an inspection milestone and report due state; and
- a deliberate response or expert gap to exercise the risk projection.

Southbank remains the separate tenant proving non-disclosure. All people, organisations, claims, documents and professional details are fictional and visibly evaluation-only.

## 16. Testing

### Database

- migration order and strict table creation;
- composite tenant and matter foreign keys;
- append-only and immutable triggers;
- exact document-version relationships;
- cross-matter expert/report rejection; and
- uniqueness and optimistic version constraints.

### Domain

- deterministic source assembly and stale-source detection;
- approval permission and immutable version creation;
- deterministic DOCX generation and SHA-256 preservation;
- service correction and confirmed receipt rules;
- response-by-defect atomicity;
- expert route, conflict, terms and instruction gates;
- milestone and report idempotency;
- deadline creation, variation and no-response behaviour;
- protocol and expert readiness enforcement;
- authorised override, audit and chronology; and
- transaction rollback when document storage or persistence fails.

### API and security

- validation and stable error envelopes;
- solicitor, paralegal and read-only capability boundaries;
- generic `404` for inaccessible, cross-firm and cross-matter resources;
- stale-command `409`;
- idempotent retries; and
- no source facts or generated documents disclosed across tenants.

### Client

- all three workspace views render seeded state;
- missing and stale facts are understandable;
- role-based actions are hidden or disabled correctly;
- approval requires a complete preview and confirmation;
- deadline explanations and official-source links are visible;
- conflict, overdue inspection and unreviewed report blockers display correctly;
- responsive and keyboard interaction; and
- mutation refresh and error recovery.

### Release verification

- complete automated suite, typecheck and production build;
- dependency audit after adding the DOCX renderer;
- fresh-data solicitor journey from draft through report review;
- partner override journey;
- read-only and cross-firm denial;
- restart persistence and generated-file download;
- zero HTTP 5xx in the exercised journey; and
- no tracked runtime data, generated client documents, secrets or uploads.

## 17. Security and legal safeguards

- The server derives firm and user identity from the session.
- Generated letters and instructions remain private matter documents.
- Free text is escaped in preview output; DOCX construction never interprets user HTML.
- File names never become storage paths.
- Money uses integer minor units and ISO currency.
- Date-only legal triggers remain `YYYY-MM-DD` values and use the pinned business calendar.
- Approval, receipt confirmation, expert route, conflict decision and report review are human actions with named actors.
- No AI model can approve, issue, instruct, vary a deadline or clear a conflict.
- Official sources and rule versions remain visible beside each calculation.
- The build remains evaluation-only until security, privacy, legal-rule, professional-indemnity, disaster-recovery and operational reviews are complete.

## 18. Acceptance criteria

This slice is complete when:

1. A solicitor can produce, review, approve and download a source-linked Letter of Claim DOCX.
2. The approved version and its source manifest cannot be edited or deleted.
3. Dispatch alone does not create a legal receipt trigger.
4. Confirmed receipt creates one explainable 20-working-day response deadline.
5. A landlord response can be recorded against every existing defect without cross-matter linking.
6. A solicitor can record an expert route, expert, conflict decision, terms and immutable instruction.
7. Inspection and report milestones create only the deadlines supported by confirmed facts.
8. An exact report document version can be reviewed and questioned without editing the expert's opinion.
9. Unsupported protocol or expert workflow progression is blocked server-side.
10. Authorised overrides require reasons and are auditable.
11. Read-only and cross-firm users cannot mutate or discover protected resources.
12. The synthetic Maya Clarke journey demonstrates both completed controls and deliberate gaps.
13. Tests, typecheck, production build, dependency audit and the production HTTP journey pass.

## 19. Deferred follow-on

The next SwiftClaim slice after Protocol and Experts is **Repairs and Quantum**: repair-item and works verification, special damages, general-damages periods, rent and occupancy impact, expert cost schedules, loss evidence and solicitor-reviewed valuation ranges.

Correspondence capture, provider delivery, AI document analysis, WhatsApp calling and SwiftBridge remain separate later programmes. This slice creates the structured facts, immutable documents, events and review controls those capabilities will require.
