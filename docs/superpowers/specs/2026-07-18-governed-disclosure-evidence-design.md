# Governed Disclosure and Evidence Design

**Status:** Approved for implementation  
**Product:** SwiftClaim Litigation only  
**Milestone:** Disclosure, inspection and privilege control

## Outcome

SwiftClaim will give litigation teams a single, tenant-safe workspace for collecting potentially disclosable material, making exact document-level disclosure decisions, protecting privilege, responding to inspection requests and producing reviewable disclosure lists. AI may extract, cluster and recommend classifications, but its output is always visibly provisional and has no legal effect until an authorised human records a decision.

This milestone extends the existing document, evidence and Proceedings foundations. It does not build SwiftBridge, ingest Proclaim data, connect to a live court/provider, send a disclosure list, waive privilege, or decide the scope of a party's disclosure obligations.

## Non-negotiable safeguards

- The exact immutable `document_version` is the unit reviewed. A later document version requires a fresh review.
- AI classifications are suggestions with model, prompt/policy version, timestamp and input provenance. They cannot become final by timeout, bulk default or workflow progression.
- Only a solicitor, partner or administrator with the relevant capability can approve a disclosure decision. Only partner/admin can approve a privilege waiver.
- Privileged, potentially privileged and protected-negotiation material is excluded from ordinary search results, counts, exports, generated lists, summaries and general AI context.
- A reviewer must affirmatively resolve a privilege warning before a document can be marked disclosable.
- `disclosable`, `listed`, `served`, `received`, `inspection requested`, `inspection provided` and `inspection completed` are distinct facts.
- Redaction never overwrites the original. A disclosed redaction links an exact redacted document version to its exact source version and approved redaction review.
- No record is described as legally compliant, complete, privileged as a matter of law, or safe to disclose. SwiftClaim records human conclusions and unresolved risks.
- All commands are firm- and matter-scoped, idempotent, concurrency protected, audited and written with timeline/outbox facts in one transaction. Inaccessible resources return generic `404`.

## Recommended architecture

Create a bounded `disclosure` domain beside `evidence`, `documents`, `proceedings` and `pleadings`.

### Pure policy and projection layer

Pure functions project the current review state from immutable decisions and events. They calculate operational states only: unreviewed, AI suggested, human review required, approved decision, listed, inspection outstanding and inspection completed. They never infer legal compliance or privilege.

### Persistence layer

`DisclosureStore` owns tenant-scoped queries and atomic commands. Migration 11 creates:

- `disclosure_reviews` — one governed review scope per proceeding and party;
- `disclosure_review_events` — opened, scope recorded, human review completed and superseded facts;
- `disclosure_documents` — exact document-version candidates in a review;
- `disclosure_ai_suggestions` — immutable provisional suggestions and provenance;
- `disclosure_decisions` — immutable human decisions with reason, confidence acknowledgement and reviewer;
- `disclosure_privilege_reviews` — privilege type, basis, status and reasoned waiver decision;
- `disclosure_redactions` — original/redacted version lineage and human approval;
- `disclosure_lists` and `disclosure_list_entries` — immutable generated list snapshots;
- `inspection_requests`, `inspection_request_items` and `inspection_events` — request, response and fulfilment ledger;
- `disclosure_command_receipts` — scoped input hashes and replay results.

Append-only and immutable triggers protect legal records. Composite firm/matter keys prevent cross-tenant references. Exact sources reference existing document versions rather than copying content.

### Service and policy layer

`DisclosureService` parses strict contracts, resolves matter access and enforces capabilities:

- `disclosure.read`
- `disclosure.prepare`
- `disclosure.review`
- `disclosure.review_privilege`
- `disclosure.waive_privilege`
- `disclosure.approve_redaction`
- `disclosure.generate_list`
- `disclosure.record_external`

Paralegals may prepare candidates, run approved AI assistance and record external operational facts. Solicitors may review disclosure and privilege and approve redactions/lists. Only partners/admin may record privilege waiver. Finance/readonly have no disclosure access in this milestone.

### API layer

Fastify exposes a read workspace plus narrow commands for opening a review, adding candidates, recording AI suggestions, making a human decision, reviewing privilege, approving a redaction, generating an immutable list and managing inspection events. Every input uses strict Zod schemas; the server supplies identity and audit context.

### Matter 360 interface

A lazy-loaded **Disclosure** area contains four views:

1. **Review queue** — exact candidates grouped by review state, source and duplicate family.
2. **Privilege review** — restricted queue with warnings, bases and reasoned decisions.
3. **Disclosure lists** — immutable snapshots, entries, omissions, unresolved blockers and export-ready status.
4. **Inspection** — requests, item-level responses, delivery evidence and outstanding actions.

Each document row shows exact version, source, date, custodian, AI suggestion and provenance, human decision, privilege restriction, redaction lineage and list/inspection state. Sensitive rows reveal only safe metadata to users without privileged access. Bulk actions require explicit selection, show the number of affected exact versions and reject mixed privilege states.

## Domain model and decisions

### Review scope

A disclosure review belongs to one proceeding and disclosing party. Its human-authored scope note records the applicable order/direction source when present, date range, custodians and issue tags. SwiftClaim does not generate the legal scope. Scope changes create a new event/version and mark affected approved decisions as requiring confirmation rather than silently reusing them.

### Candidate collection and families

Candidates may link existing matter documents, evidence items, communications or generated files, but each resolves to an exact document version. Hash and metadata matching may suggest duplicate families. A human can confirm family membership; a duplicate decision does not automatically inherit privilege or disclosure treatment.

### AI assistance

The first implementation uses a deterministic local evaluation adapter, not a live model call. The contract is ready for a later provider and returns:

- suggested relevance: likely relevant, likely not relevant or uncertain;
- suggested issue tags;
- possible privilege/protected-negotiation warning;
- possible personal/confidential information warning;
- duplicate-family suggestion;
- short rationale and cited extracted spans;
- model/policy version and source hash.

The interface labels all of these `AI suggestion — human review required`. Suggestions are immutable, cannot lower an existing restriction and are never included in exports as decisions.

### Human disclosure decision

Allowed decisions are `disclose`, `withhold_privilege`, `withhold_not_relevant`, `withhold_other`, `duplicate_only`, and `review_required`. A final decision requires a reason and reviewer timestamp. `disclose` is blocked while a privilege warning or unresolved privilege review exists. Each new decision supersedes but does not mutate the prior decision.

### Privilege and waiver

Privilege review records the human-selected category (`legal_advice`, `litigation`, `joint`, `without_prejudice_or_protected`, `other`, `none`, `uncertain`), basis, supporting source references and outcome (`restricted`, `not_privileged`, `further_review`, `waived`). Recording `waived` requires partner/admin capability, an exact authority source where available, a reason and a second explicit confirmation that the action may expose the document to disclosure workflows. Waiver never deletes the prior restriction history.

### Redactions

A proposed redaction links original and redacted document versions, records categories/reasons and starts as `awaiting_review`. Approval requires solicitor capability and confirmation that the redacted version was visually checked. Only approved redacted versions can be selected for a disclosure-list entry. The original remains restricted and excluded from ordinary export.

### Disclosure list

Generation creates an immutable snapshot from currently approved decisions. Entries retain exact document version, date, description, decision category, restriction/redaction reference and reviewer. Documents with unresolved decisions, privilege warnings or missing descriptions appear as blockers and are omitted from the generated snapshot. Generation does not approve, sign, file or serve the list.

### Inspection

Inspection requests identify the requesting party, exact list snapshot and selected entry IDs. Events separately record received, acknowledged, refused with human reason, agreed, provided with exact document/delivery evidence, and completed. SwiftClaim projects outstanding items but makes no legal conclusion about entitlement or adequacy.

## Data flow

1. An authorised user opens a review against an existing proceeding and party.
2. Exact document versions are added as candidates individually or by explicit bulk selection.
3. The evaluation adapter records optional AI suggestions with full provenance.
4. A human reviews relevance and privilege. Restrictions are applied before general review visibility.
5. An authorised reviewer records an immutable disclosure decision; privilege warnings block disclosure until resolved.
6. Where necessary, a redacted version is created through the existing document system and linked for approval.
7. A solicitor generates an immutable disclosure-list snapshot. Blocked candidates remain outside it and visible in the workspace.
8. External service/receipt and inspection actions are recorded only from exact evidence and independent events.

## Failure and security behaviour

- Cross-firm/matter/proceeding/document references return generic `404`.
- Stale expected versions return `409`; identical idempotent retries replay the original response; changed input with the same key returns `409`.
- A transaction failure rolls back the domain row, audit, timeline, outbox and receipt together.
- Restricted content never appears in ordinary logs, timeline descriptions or outbox payloads. Those channels carry IDs and redacted operational metadata only.
- Exports fail closed if an entry loses approval, its exact version is missing, a redaction is not approved or a privilege warning is unresolved.
- AI/provider errors produce a visible `suggestion unavailable` state and never block manual human review.

## Evaluation seed

The synthetic Maya Clarke matter will contain one review for the claimant, a reviewed scope linked to the existing directions order, a mixed candidate queue, one confirmed duplicate family, one privileged solicitor note restricted from ordinary users, one uncertain AI suggestion awaiting review, one approved non-privileged repair record, one approved redaction, one immutable draft list snapshot and one partially fulfilled inspection request. Re-running the seed must be idempotent.

## Testing strategy

- Contract tests reject autonomous/final AI decisions, disclosure with unresolved privilege and invalid waiver/redaction sources.
- Migration tests prove composite tenant keys and immutable/append-only triggers.
- Pure projection tests cover supersession, safe privilege precedence, list blockers and inspection status.
- Store tests cover tenant isolation, exact version validation, atomic audit/timeline/outbox/receipt writes, idempotent replay and rollback.
- Service tests cover every role boundary, including partner-only waiver and paralegal preparation without final approval.
- Route tests cover authentication, generic `404`, strict validation and conflict mapping.
- UI tests cover provisional AI labelling, privilege-safe rendering, distinct legal/operational states, permission-gated commands and responsive empty/error states.
- The full suite, both TypeScript targets, production build, terminology/scope scan and exact GitHub tree verification gate release.

## Delivery boundary

This milestone is complete when the synthetic client can collect exact candidates, see AI suggestions, record governed human relevance and privilege decisions, approve a redaction, generate an immutable disclosure-list snapshot and manage a partial inspection request through Matter 360. Live AI providers, document OCR, email/court dispatch, electronic disclosure exchange formats, Proclaim migration and SwiftBridge remain later milestones.
