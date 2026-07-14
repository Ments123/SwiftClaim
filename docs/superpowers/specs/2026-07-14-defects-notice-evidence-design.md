# SwiftClaim Defects, Notice and Evidence Design

**Status:** Approved for implementation  
**Date:** 14 July 2026  
**Product:** SwiftClaim Litigation  
**Scope:** Claimant Housing Conditions matters in England

## 1. Purpose

This slice makes the current **Evidence and notice** workflow stage operational. A solicitor must be able to open a converted Housing Conditions matter and build a structured, auditable account of:

- what is wrong at the property, by room or location;
- when and how the landlord was put on notice;
- what access was offered, attempted or completed;
- which immutable documents, photographs or videos support each fact; and
- which evidence gaps or serious hazards still require action.

The slice activates the existing **Defects & repairs** and **Evidence** sections in Matter 360. It does not determine liability, diagnose hazards, calculate damages or generate legal advice.

## 2. Approaches considered

### A. Defects-only register

This is the smallest release, but it leaves notice, access and proof in free text. It would not make the Evidence and notice stage genuinely operable and would preserve the spreadsheet/document fragmentation SwiftClaim is intended to remove.

### B. Governed evidence investigation vertical slice — selected

Build defects, notice, access, immutable evidence linking, risk projections, workflow readiness and both Matter 360 sections together. This produces one complete solicitor journey while retaining clear domain boundaries.

### C. Evidence plus Letter of Claim and expert workflow

This would create a broader demo, but it crosses into the next protocol slice before the source facts are trustworthy. Letter generation and expert controls depend on the records created here and therefore follow this release.

## 3. Goals

1. Maintain a room-by-room defect schedule with severity, health impact and state.
2. Maintain a chronological notice/complaint record with recipient, channel, proof position and response.
3. Maintain a chronological property-access record.
4. Link an exact immutable document version to one or more defects, notices or access events.
5. Project explainable evidence gaps and operational risks without making legal conclusions.
6. Prevent ordinary workflow progression when a user tries to confirm an evidence-stage control that the records do not support.
7. Preserve tenant isolation, optimistic concurrency, chronology and audit evidence.
8. Provide realistic synthetic evaluation data for the main Northstar Housing Conditions matter.

## 4. Non-goals

This slice does not include:

- Letter of Claim drafting, approval, dispatch or deemed receipt;
- expert selection, instruction, inspection or report extraction;
- repair work orders, valuation, losses, offers or proceedings;
- AI extraction, summarisation or automated defect classification;
- email, WhatsApp, telephony or provider integrations;
- medical record storage or a special-category access-control redesign;
- destructive deletion of evidential records; or
- automatic findings on breach, causation, liability, limitation or quantum.

## 5. Architecture

Add a bounded `evidence` domain beside `intake`, `matter` and `workflow`:

- `EvidenceStore` owns tenant-scoped persistence and projections.
- `EvidenceService` owns permissions, command validation, optimistic versions, transaction orchestration, audit and chronology.
- `EvidenceReadinessProvider` is a narrow interface consumed by `WorkflowService` only when the current stage is `evidence`.
- `evidence/routes.ts` exposes resource-specific HTTP routes.
- `EvidenceInvestigationPanel` and `DefectsRepairsPanel` consume one independently loaded evidence workspace resource.

The browser never supplies a firm identifier. Every store query includes the server-derived `firm_id` and authorised `matter_id`.

## 6. Data model

Migration `004-defects-notice-evidence` adds the following strict, tenant-owned tables.

### 6.1 `defects`

Mutable current state with optimistic versioning:

- `id`, `firm_id`, `matter_id`, `version`;
- `location`, `category`, `title`, `description`;
- `severity`: `low`, `moderate`, `serious`, `critical`;
- `status`: `open`, `monitoring`, `repaired`, `disputed`, `superseded`;
- `first_observed_on`, `health_impact`, `hazard_tags_json`;
- `created_by`, `created_at`, `updated_by`, `updated_at`.

Categories are controlled but include `other`. Hazard tags are descriptive escalation aids, not legal or technical determinations.

### 6.2 `defect_status_events`

Append-only history created with the defect and whenever its status changes. It preserves from/to state, reason, actor and timestamp.

### 6.3 `notices`

Append-only factual events:

- occurred date/time, channel, recipient type and recipient name;
- summary, proof status, response status and response summary;
- `supersedes_notice_id` for a correction;
- actor and creation timestamp.

Proof status is `linked`, `client_recollection`, `unavailable` or `unknown`. A correction creates a superseding event; it never rewrites the original.

### 6.4 `access_events`

Append-only events for access offered, scheduled, attempted, completed, refused by either party, no access or cancelled. Each event records the appointment date/time where known, actor, notes and an optional superseded event.

### 6.5 `evidence_items`

An immutable evidential classification of an existing immutable `document_version`:

- kind: photograph, video, correspondence, repair record, tenancy record, medical link, client statement or other;
- title, description and occurred date;
- provenance source and provenance detail;
- exact `document_version_id`;
- actor and creation timestamp.

The source document bytes remain governed by the existing private storage and SHA-256 model. An evidence item cannot point at a mutable “latest” document.

### 6.6 Evidence links

Separate append-only link tables preserve relational integrity:

- `defect_evidence_links`;
- `notice_evidence_links`; and
- `access_evidence_links`.

All linked records must belong to the same firm and matter. Links cannot be updated or deleted.

## 7. Commands and API

The primary read resource is:

`GET /api/matters/:matterId/evidence-investigation`

It returns defects, notices, access events, evidence items, available document versions, readiness controls, risk flags and permissions.

Mutation routes are:

- `POST /api/matters/:matterId/defects`;
- `PATCH /api/matters/:matterId/defects/:defectId`;
- `POST /api/matters/:matterId/notices`;
- `POST /api/matters/:matterId/access-events`; and
- `POST /api/matters/:matterId/evidence-items`.

Defect updates require `expectedVersion` and return `409 CONFLICT` when stale. Append-only commands use an `Idempotency-Key` where retry could otherwise duplicate an evidential event. The evidence-item command accepts arrays of defect, notice and access-event IDs and creates the item and every link atomically.

Stable errors use the existing envelope. Inaccessible or cross-firm resources return the same generic `404` response.

## 8. Readiness and risk

The read projection returns three evidence-stage controls:

| Workflow key | Eligible for human confirmation when |
|---|---|
| `defect_schedule_recorded` | At least one non-superseded defect exists and every active defect has a location, description and severity. |
| `notice_evidence_recorded` | At least one notice exists and its proof position is explicitly recorded. |
| `photographs_recorded` | At least one photograph evidence item is linked to a non-superseded defect. |

Eligibility does not automatically complete a workflow checklist item. The solicitor still confirms the control during the existing transition flow.

`WorkflowService` asks `EvidenceReadinessProvider` to validate evidence-stage checklist confirmations. An unsupported confirmation is rejected as `READINESS_BLOCKED` with an explainable blocker. A partner or administrator retains the existing explicit override path and mandatory reason.

Risk flags are deterministic operational prompts:

- serious or critical open defect;
- critical defect without linked evidence;
- notice proof unknown or unavailable;
- failed/refused access without a later completed access event;
- no defect-linked photograph; and
- one of the three readiness controls ineligible.

Risk wording must not state that liability, statutory breach or causation is established.

## 9. Audit and chronology

Every successful mutation adds:

- the domain record;
- a matter chronology entry suitable for solicitors; and
- an audit event with actor, request ID, IP address and relevant before/after state.

Append-only database triggers protect status history, notices, access events, evidence items and link rows from update or deletion. Defect current-state updates remain possible only through the service with version checks; status changes produce immutable status history.

## 10. Matter 360 experience

### 10.1 Defects & repairs

This section shows:

- summary counts for open, serious/critical and evidence-linked defects;
- readiness and risk strip;
- defects grouped by room/location;
- compact severity, state, first-observed and evidence indicators;
- accessible create and edit dialogs;
- notice/complaint chronology; and
- access chronology.

“Repairs” remains limited to the defect’s repaired state in this slice. Detailed repair items and verification events belong to the repairs/quantum release.

### 10.2 Evidence

This section shows:

- the three evidence-stage controls and why each is or is not eligible;
- evidence items with immutable source version, provenance and linked facts;
- explicit evidence gaps and risk flags;
- an “Add preserved evidence” dialog that selects an existing document version and links it to selected domain records; and
- a route to the existing Documents section when a file must first be uploaded.

Read-only users can inspect the workspace but cannot mutate it. Desktop uses a dense two-column layout; tablet and mobile preserve controls, risks and primary actions before long histories.

## 11. Synthetic evaluation state

The main Northstar Housing Conditions matter is seeded with five fictional defects across the bedroom, bathroom, kitchen and communal area, including damp/mould and heating examples. It also contains:

- multi-channel complaint/notice events;
- an offered and a failed access event;
- safe synthetic evidence metadata linked to exact document versions; and
- at least one deliberate evidence gap so the risk projection is visible.

Southbank remains the separate tenant used to prove non-disclosure. All evidence is visibly labelled synthetic and contains no real client data.

## 12. Testing

### Database

- migration order and strict tables;
- composite tenant foreign keys;
- append-only trigger enforcement;
- cross-matter link rejection; and
- defect version constraints.

### Domain

- authorised create/update commands;
- stale defect conflict;
- correction by supersession;
- evidence link atomicity;
- readiness and risk projections;
- audit and chronology creation; and
- workflow confirmation enforcement and privileged override.

### API and security

- signed-out, read-only, writer and partner behaviour;
- generic same-firm inaccessible and cross-firm `404`;
- stable validation/conflict envelopes;
- idempotent event creation; and
- no tenant identifiers accepted from the browser.

### Client

- loading, empty, populated, read-only and error states;
- location grouping, filters and risk/readiness display;
- defect create/edit and stale conflict handling;
- notice/access capture;
- preserved evidence selection and linking;
- section navigation and responsive semantic order; and
- no inaccessible mutation controls.

## 13. Acceptance criteria

The slice is complete when a solicitor can open the seeded matter, understand its defect and notice position, add or amend a defect, record notice/access, link preserved evidence, identify evidence gaps and progress the Evidence and notice workflow only when the supporting controls are genuinely eligible or a partner records an override.

The full automated suite, both TypeScript checks, production build, tracked-file hygiene and dependency audit must pass before publication. The repository remains evaluation-only and unapproved for live client material.
