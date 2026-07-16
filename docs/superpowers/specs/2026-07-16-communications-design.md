# SwiftClaim Governed Communications Design

**Date:** 16 July 2026
**Status:** Approved
**Product:** SwiftClaim Litigation
**Workflow:** Housing Conditions — Claimant (England)

## 1. Purpose

This slice makes the Matter 360 **Communications** section operational. It gives a solicitor one matter-scoped ledger for email, WhatsApp, telephone, letter/post, portal, SMS, in-person and internal communications while preserving the legal distinction between a message, a provider acknowledgement, delivery evidence, receipt and formal service.

The first release is an evaluation-safe communications core. It includes a deterministic manual provider for end-to-end testing and provider-neutral interfaces for Microsoft Graph and WhatsApp Business. It does not transmit to a live third party until a pilot firm supplies approved credentials and an administrator enables the relevant provider capability.

## 2. Chosen approach

### A. Manual communications ledger only

Rejected. It is safe and quick, but it would make later email and WhatsApp integration a second data model and would not test dispatch controls.

### B. Build directly around Microsoft Graph and Meta payloads

Rejected. It would couple legal records to provider-specific delivery states, make imports harder and create false confidence where account, region or product capabilities differ.

### C. Governed provider-neutral core with adapters — chosen

SwiftClaim owns a canonical, immutable communications ledger. Drafting, approval, dispatch attempts and provider events are separate records. A narrow provider interface translates canonical commands to provider payloads. The evaluation provider proves the complete workflow without external transmission; Microsoft Graph and WhatsApp adapters can be activated later without changing the domain model.

## 3. Outcomes

A solicitor must be able to:

1. see a unified, filterable matter communications timeline without loading it into unrelated Matter 360 sections;
2. record inbound and outbound communications with exact participants, direction, channel, occurrence time and provenance;
3. group records into conversations while retaining each immutable message or call record;
4. link exact immutable document versions and hashes as attachments or source evidence;
5. create versioned outbound drafts, submit sensitive drafts for approval and dispatch only an approved version;
6. distinguish queued, provider-accepted, delivered, failed, read and cancelled states without treating any of them as legal service;
7. record a telephone or WhatsApp call, identity checks, consent/notice, recording status and source artifacts;
8. restrict privileged and protected-negotiation material independently from ordinary communications;
9. inspect audit history, dispatch attempts and webhook/provider events; and
10. use a synthetic Maya Patel journey without sending real messages or making real calls.

## 4. Scope boundaries

### Included

- canonical conversations, participants, communication entries and immutable attachments;
- email, WhatsApp, telephone, letter/post, portal, SMS, in-person and internal channels;
- inbound, outbound and internal directions;
- versioned drafts, approval decisions and guarded dispatch;
- deterministic evaluation provider and provider capability reporting;
- dispatch outbox, idempotency, provider-event ingestion and replay protection;
- call sessions, identity verification, consent/notice and recording metadata;
- immutable recording, transcript and note artifact links;
- ordinary, internal, privileged and protected-negotiation confidentiality;
- separate permissions for reading, writing, approving, sending, privileged access and provider administration;
- Matter 360 Communications timeline, thread view, compose flow and manual call capture;
- synthetic Maya pilot records; and
- audit, chronology and outbox records for material commands.

### Excluded

- live Microsoft or Meta credentials and live external transmission;
- OAuth consent screens or provider administration UI;
- live WhatsApp Calling availability claims;
- AI transcription, summarisation or drafting;
- autonomous sending, replying, legal-service conclusions or deadline creation;
- bulk marketing, general-purpose WhatsApp AI chatbots or unsolicited messaging;
- inbox-wide mailbox synchronisation unrelated to a SwiftClaim matter;
- document OCR;
- SwiftBridge or Proclaim migration; and
- live client data.

## 5. Legal and product posture

A provider response is evidence about transport, not a legal conclusion. Microsoft Graph `sendMail` can return `202 Accepted`; SwiftClaim records that as `provider_accepted`, never as delivered or served. Delivery, read and failure events require separately authenticated provider evidence. A user may record service facts only as an explicit human assertion with a method, date, source and review status.

Every externally addressed draft requires an explicit Send confirmation. Protected-negotiation and privileged content never appears in ordinary chronology, unrestricted search results, notification previews or workspace counts. Internal notes cannot be dispatched.

WhatsApp capabilities vary by business account, geography and provider approval. SwiftClaim exposes adapter capabilities and blocks unavailable operations. The UI must not imply that WhatsApp Calling is live merely because the channel exists in the canonical model.

Call recording and transcription require a human-recorded notice/consent basis before a recording artifact can be attached. SwiftClaim records the basis supplied; it does not determine whether recording is lawful.

## 6. Architecture

Add a bounded `communications` domain beside `evidence`, `protocol`, `quantum`, `intake` and `workflow`:

- `CommunicationStore` owns firm- and matter-scoped persistence, append-only entries, draft versions and atomic event writes.
- `CommunicationService` owns authorisation, validation, approval, dispatch invariants, confidentiality and audit commands.
- `CommunicationProvider` is a narrow port for capability discovery and dispatch. The domain never stores provider secrets.
- `EvaluationCommunicationProvider` returns deterministic acceptance events and performs no network calls.
- `CommunicationReadModel` assembles the filtered workspace and computes transport status from append-only events.
- `communicationRoutes` expose resource-specific commands, provider-event ingestion and the separately loaded workspace.
- `CommunicationsPanel` owns the timeline, thread, compose and call-recording views in Matter 360.

The existing modular monolith remains appropriate. A command writes its domain record, audit event, chronology projection and outbox event in one SQLite transaction. Provider network calls are outside that transaction and report back through an idempotent dispatch-result command.

## 7. Data model

Every domain table contains `firm_id` and `matter_id`, uses composite foreign keys where supported and is queried with both values. IDs are UUIDs. Times are UTC ISO timestamps; civil dates use `YYYY-MM-DD`. JSON payloads contain canonical non-secret metadata only.

### 7.1 Conversations and participants

`communication_conversations`

- id, firm_id, matter_id;
- canonical channel and optional subject;
- confidentiality: `ordinary`, `internal`, `privileged`, `protected_negotiation`;
- status: `open`, `closed`;
- external thread reference and provider name when imported;
- created by/at.

`communication_participants`

- id, conversation ID, firm_id, matter_id;
- party ID or user ID when linked;
- role: `from`, `to`, `cc`, `bcc`, `caller`, `callee`, `attendee`, `author`, `recipient`;
- display name and normalised endpoint;
- endpoint type: `email`, `phone`, `whatsapp`, `postal_address`, `portal`, `user`, `unknown`;
- created by/at.

Participant snapshots are immutable so later party edits do not rewrite historic correspondence.

### 7.2 Communication entries

`communication_entries` is append-only:

- id, conversation ID, firm_id, matter_id;
- channel: `email`, `whatsapp`, `telephone`, `letter`, `portal`, `sms`, `in_person`, `internal`;
- direction: `inbound`, `outbound`, `internal`;
- confidentiality inherited from the conversation and repeated for constrained querying;
- subject, body text and body format: `plain`, `html`, `structured_note`;
- occurred at, recorded at and recorded by;
- source: `manual`, `provider`, `import`, `system`;
- provider name, external message ID and external thread ID where available;
- transport projection; service assertions refer back to the entry and never mutate it;
- supersedes entry ID only for a clearly identified correction.

The original entry is never edited or deleted. Corrections append a new entry and retain the relationship.

`communication_attachments`

- entry or draft-version ID;
- exact existing `document_version_id`, firm_id and matter_id;
- purpose: `attachment`, `recording`, `transcript`, `call_note`, `delivery_evidence`, `service_evidence`, `other`;
- copied SHA-256 and file name for visible provenance;
- created by/at.

An attachment must belong to the same firm and matter. Linking a later document version requires a new link.

### 7.3 Drafts and approvals

`communication_drafts`

- id, conversation ID, firm_id, matter_id;
- channel, confidentiality and current status: `draft`, `pending_approval`, `approved`, `rejected`, `dispatched`, `cancelled`;
- created by/at and optimistic record version.

`communication_draft_versions` is immutable:

- id, draft ID, firm_id, matter_id and positive version number;
- exact participant snapshots, subject, body and format;
- created by/at.

`communication_approval_events` is append-only:

- draft-version ID;
- decision: `submitted`, `approved`, `rejected`, `approval_revoked`;
- note, actor and occurred at.

Any content or recipient change creates a new version and invalidates the older approval. `privileged` and `protected_negotiation` outbound drafts require approval by a user with `communications.approve`. Ordinary drafts may be sent by a user with `communications.send`, but still require interactive confirmation.

### 7.4 Dispatch and provider events

`communication_dispatches`

- id, draft-version ID, firm_id, matter_id;
- provider key and client-generated idempotency key;
- status: `queued`, `attempting`, `provider_accepted`, `delivered`, `failed`, `read`, `cancelled`;
- attempt count, last error code and safe error detail;
- created by/at and last event at;
- unique `(firm_id, provider_key, idempotency_key)`.

`communication_provider_events` is append-only:

- dispatch ID, firm_id, matter_id;
- provider event ID and type;
- authenticated flag and authentication method;
- occurred at, received at and canonical safe payload JSON;
- unique `(firm_id, provider_key, provider_event_id)` for replay protection.

Transport state is a projection over valid events. A retry uses the same idempotency key until a terminal failure is recorded; the service never silently creates a second dispatch. Unknown or unauthenticated webhook events are quarantined from the projection and audited.

### 7.5 Calls and service assertions

`communication_call_sessions`

- entry ID, firm_id, matter_id;
- provider key or `manual`;
- started at, ended at and duration seconds;
- purpose and outcome;
- identity-check status: `not_recorded`, `confirmed`, `failed`, with note;
- recording status: `not_recorded`, `notice_given`, `consent_recorded`, `recorded`, `unavailable`;
- notice/consent basis text and actor;
- external call ID where available.

`communication_service_assertions` is append-only:

- entry ID, firm_id, matter_id;
- asserted method, service date/time, recipient and address/endpoint;
- source document-version ID or retained factual note;
- review status: `unreviewed`, `reviewed`, `disputed`;
- asserted and reviewed by/at.

Service assertions are excluded from automated deadline calculation in this slice.

## 8. Provider interface

```ts
interface CommunicationProvider {
  readonly key: string;
  capabilities(): Promise<CommunicationProviderCapabilities>;
  dispatch(command: ProviderDispatchCommand): Promise<ProviderDispatchResult>;
  verifyEvent(input: ProviderEventInput): Promise<VerifiedProviderEvent>;
}
```

Capabilities explicitly state supported channels and operations such as `send_email`, `send_whatsapp_message`, `start_whatsapp_call`, `receive_events` and `delivery_receipts`. The evaluation provider supports deterministic email and WhatsApp-message acceptance only. It does not support calls or real delivery receipts.

Provider credentials are injected through environment/managed-secret configuration and are never returned by API responses, logged, audited or written to domain tables. The future Microsoft Graph adapter must request the narrowest applicable permission and map `202` to `provider_accepted`. A future WhatsApp adapter must verify its business-account calling and messaging capabilities during onboarding.

## 9. Permissions and confidentiality

Add capabilities:

- `communications.read`;
- `communications.write`;
- `communications.approve`;
- `communications.send`;
- `communications.read_privileged`;
- `communications.read_protected`;
- `communications.manage_provider`.

Recommended role defaults:

- admin and partner: all communications capabilities;
- solicitor: read, write and send; privileged/protected access follows matter assignment; approval is granted to designated supervisors;
- paralegal: read, write and submit for approval; no send, privileged, protected or provider administration by default;
- finance: no communications access;
- readonly: ordinary read only when the user is a matter member.

Every route first resolves firm and matter membership, then capability and confidentiality. Cross-firm, inaccessible privileged and inaccessible protected resources return the same generic `404`. List counts and filters are computed after confidentiality filtering.

## 10. Commands and API

The first API surface is:

- `GET /api/matters/:matterId/communications` — filtered workspace;
- `POST /api/matters/:matterId/communications/record` — immutable manual inbound/outbound/internal entry;
- `POST /api/matters/:matterId/communication-drafts` — create draft and version 1;
- `POST /api/matters/:matterId/communication-drafts/:draftId/versions` — append a version;
- `POST /api/matters/:matterId/communication-drafts/:draftId/submit`;
- `POST /api/matters/:matterId/communication-drafts/:draftId/decisions`;
- `POST /api/matters/:matterId/communication-drafts/:draftId/dispatch` — explicit confirmation and idempotency key required;
- `POST /api/matters/:matterId/communication-dispatches/:dispatchId/events` — authenticated adapter callback in evaluation mode;
- `POST /api/matters/:matterId/communication-calls` — manual call record;
- `GET /api/communication-providers/capabilities` — non-secret capability state.

Commands use the existing request-context transaction, audit and domain-event patterns. Validation errors are `400`, stale optimistic versions are `409`, missing capability is `403`, and tenant/confidentiality concealment is `404`.

## 11. Matter 360 experience

Enable the Communications rail item. The section lazy-loads and shows:

- a compact channel/confidentiality/direction filter bar;
- a newest-first ledger with participant, subject/summary, channel, direction, occurred time and transport badge;
- a conversation detail view with immutable entries and attachment provenance;
- a compose drawer with recipients, channel, confidentiality, exact document-version attachments and approval state;
- an explicit confirmation dialog before dispatch;
- a manual call form with identity, timing, outcome, recording notice/consent and artifact links; and
- visible badges for manual/provider/import source, provider acceptance, delivery evidence, service assertion and protected access.

Provider acceptance copy must read “Accepted by provider”, never “Sent”, “Delivered” or “Served”. Unsupported provider operations are disabled with the capability reason. No AI button appears in this slice.

## 12. Synthetic Maya journey

Seed the evaluation matter with:

- an inbound ordinary email from the landlord's solicitor with one immutable attachment;
- an outbound WhatsApp appointment message accepted by the evaluation provider but not marked delivered;
- a manual telephone call note with identity confirmed and no recording;
- an outbound letter record with an explicit, unreviewed service assertion;
- an internal privileged case note visible only to authorised users; and
- a protected-negotiation draft awaiting supervisor approval.

No seeded record performs a network call. The journey demonstrates confidentiality filtering, provider-state honesty and approval controls.

## 13. Error handling and invariants

- No command trusts client-supplied firm, actor, transport state or approval state.
- Inbound/provider records require a unique external ID when one exists; duplicates return the existing record without appending a second chronology event.
- A dispatched draft version is immutable and cannot be dispatched twice under a different idempotency key.
- Rejected, superseded, unapproved sensitive or recipient-mismatched versions cannot be dispatched.
- Internal entries and drafts cannot have external recipients or dispatches.
- Call recording artifacts require `notice_given` or `consent_recorded` plus basis text.
- Attachment hashes are checked against the selected immutable document version.
- Provider errors expose a safe code and retryability, never credentials or raw sensitive payloads.
- Provider-event timestamps cannot rewrite entry occurrence time.
- No transport state automatically creates service, deadline, acceptance, settlement or legal-effect conclusions.

## 14. Testing and acceptance

### Domain and persistence

- migrations apply from a fresh database and preserve existing data;
- append-only and immutable triggers reject update/delete attempts;
- every query is firm- and matter-scoped;
- document-version attachments reject cross-matter and cross-firm links;
- draft changes invalidate approvals;
- sensitive drafts require approval and explicit dispatch confirmation;
- duplicate dispatch and provider events are idempotent;
- `provider_accepted` is never projected as delivered or served;
- unauthenticated events do not affect transport state;
- call recordings require notice/consent metadata; and
- protected records do not affect ordinary counts, chronology or payloads.

### API and security

- ordinary authorised requests succeed;
- finance access returns `403` at the workspace boundary;
- cross-firm and unauthorised confidentiality access return generic `404`;
- paralegal dispatch is denied by default;
- provider capability responses contain no secrets; and
- all material commands produce audit and outbox records.

### Client

- Communications lazy-loads only when selected;
- filters and thread selection are keyboard accessible;
- compose shows version, approval and attachment provenance;
- dispatch requires confirmation;
- unsupported WhatsApp Calling is visibly disabled; and
- compact and narrow viewports remain usable.

### Production journey

A fresh production build must demonstrate ordinary access, finance denial, cross-firm concealment, privileged/protected filtering, one approved evaluation-provider dispatch, one replayed event with no duplicate effect, one call record and the complete Maya seed. Typecheck, all tests, production build and dependency audit must pass.

## 15. Delivery sequence

1. shared contracts, migration and persistence constraints;
2. provider-neutral service, evaluation adapter and transport projection;
3. authorisation, commands, routes and idempotent provider events;
4. Matter 360 Communications workspace;
5. Maya synthetic seed, documentation and production verification.

Live Microsoft Graph/WhatsApp onboarding and AI transcription/summarisation are intentionally separate future slices because they require real tenant consent, credentials, retention decisions and provider capability verification.
