# Protocol and Experts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SwiftClaim's Pre-Action Protocol and Expert evidence stages operational with a source-linked Letter of Claim, immutable generated DOCX versions, controlled service and landlord responses, expert governance, legal deadlines and server-enforced readiness.

**Architecture:** Add a bounded `protocol` domain beside the existing evidence and workflow domains. Pure assembly and rendering modules create reviewable documents; `ProtocolStore` owns tenant-scoped persistence and atomic workflow trigger integration; `ProtocolService` owns permissions, approval and idempotency; `ProtocolReadinessProvider` supplies objective transition gates to `WorkflowService`. Matter 360 loads one independent Protocol & experts workspace.

**Tech Stack:** TypeScript, Node.js 24 `node:sqlite`, Fastify, Zod, React 19, Vitest, Testing Library, Vite, `docx` 9.7.1, existing private file storage and workflow calculator.

## Global Constraints

- The product is for claimant Housing Conditions matters concerning residential property in England.
- Use only synthetic evaluation data; the build remains unapproved for live client material.
- The system must never determine liability, limitation, causation, quantum, professional competence or whether expert evidence is legally necessary.
- A draft or generated file never proves dispatch, receipt, landlord response, inspection or report service.
- Every legal trigger is explicitly confirmed by an authorised human and retains its rule, source, calendar and calculation explanation.
- A 20-working-day landlord response target follows confirmed Letter of Claim receipt; a 20-working-day inspection target follows a recorded landlord response; a 10-working-day report target follows completed inspection.
- The paragraph 6.3 substantive-response target is 20 working days after the expert report or agreed schedule only where the solicitor confirms that trigger.
- CPR 35.6 clarification timing is 28 calendar days and is created only after an explicit CPR 35 basis and report-service confirmation.
- Every tenant-owned read and write is scoped by server-derived `firm_id`; inaccessible and cross-firm resources return the same generic `404` envelope.
- Paralegals may prepare but cannot approve or issue letters, confirm legal receipt, approve an expert route or instruction, clear a conflict, or review a report.
- Approved letters, dispatch/receipt events, responses, conflict checks, instructions, milestones, reports, questions and answers are immutable or append-only.
- Mutable aggregates use optimistic integer versions and return `409 CONFLICT` for stale commands.
- Retryable append-only commands require canonical idempotency and reject key reuse with different payloads.
- Generated DOCX bytes use private random storage keys, SHA-256 hashes and authorised downloads.
- Money is integer minor units with ISO currency; legal date-only values remain `YYYY-MM-DD`.
- No email, post, WhatsApp, telephony, professional-register or AI provider is added in this slice.

---

### Task 1: Protocol and expert schema migration

**Files:**
- Create: `src/server/migrations/005-protocol-experts.ts`
- Modify: `src/server/migrations/index.ts`
- Modify: `src/server/migrations.test.ts`
- Modify: `src/server/database.test.ts`

**Interfaces:**
- Produces migration version `5`, named `protocol and experts`.
- Produces tenant-owned tables `protocol_cases`, `letters_of_claim`, `letter_of_claim_versions`, `protocol_service_events`, `landlord_responses`, `landlord_response_defects`, `expert_engagements`, `expert_conflict_checks`, `expert_instruction_versions`, `expert_milestone_events`, `expert_report_records`, `expert_questions`, and `expert_question_answers`.
- Adds append-only/immutable triggers for all evidential versions and events.

- [x] **Step 1: Write failing migration tests**

Add expectations for migration 5, every table, strict mode, composite firm/matter foreign keys, one protocol case and working letter per matter, unique version sequences, cross-matter link rejection, and trigger rejection:

```ts
expect(migrations.at(-1)).toMatchObject({
  version: 5,
  name: 'protocol and experts',
});
expect(tableNames).toEqual(expect.arrayContaining([
  'protocol_cases', 'letters_of_claim', 'letter_of_claim_versions',
  'protocol_service_events', 'landlord_responses',
  'landlord_response_defects', 'expert_engagements',
  'expert_conflict_checks', 'expert_instruction_versions',
  'expert_milestone_events', 'expert_report_records',
  'expert_questions', 'expert_question_answers',
]));
expect(() => database.exec(
  "DELETE FROM protocol_service_events WHERE id = 'fixture-service-event'",
)).toThrow(/append-only/);
```

- [x] **Step 2: Run the migration tests and verify RED**

Run: `npm test -- src/server/migrations.test.ts src/server/database.test.ts`

Expected: FAIL because migration 5 and its tables do not exist.

- [x] **Step 3: Add the strict migration**

Use controlled checks from the design. The key current-state shapes are:

```sql
CREATE TABLE protocol_cases (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL,
  matter_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  protocol_status TEXT NOT NULL CHECK (protocol_status IN (
    'preparing','approved','issued','awaiting_response',
    'response_received','expert_work','taking_stock','complete'
  )),
  expert_route TEXT NOT NULL CHECK (expert_route IN (
    'undecided','proposed_single_joint','single_joint_joint_instructions',
    'single_joint_separate_instructions','separate_experts',
    'joint_inspection','urgent_own_expert','not_required'
  )),
  expert_route_reason TEXT NOT NULL DEFAULT '',
  urgent_reason TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (matter_id, firm_id) REFERENCES matters(id, firm_id),
  FOREIGN KEY (created_by, firm_id) REFERENCES users(id, firm_id),
  FOREIGN KEY (updated_by, firm_id) REFERENCES users(id, firm_id),
  UNIQUE (matter_id), UNIQUE (id, firm_id), UNIQUE (id, firm_id, matter_id)
) STRICT;

CREATE TABLE letter_of_claim_versions (
  id TEXT PRIMARY KEY,
  firm_id TEXT NOT NULL, matter_id TEXT NOT NULL,
  protocol_case_id TEXT NOT NULL, letter_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  source_manifest_json TEXT NOT NULL CHECK (json_valid(source_manifest_json)),
  template_key TEXT NOT NULL, renderer_version TEXT NOT NULL,
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  document_version_id TEXT NOT NULL,
  approved_by TEXT NOT NULL, approved_at TEXT NOT NULL,
  FOREIGN KEY (protocol_case_id, firm_id, matter_id)
    REFERENCES protocol_cases(id, firm_id, matter_id),
  FOREIGN KEY (letter_id, firm_id, matter_id)
    REFERENCES letters_of_claim(id, firm_id, matter_id),
  FOREIGN KEY (document_version_id, firm_id)
    REFERENCES document_versions(id, firm_id),
  FOREIGN KEY (approved_by, firm_id) REFERENCES users(id, firm_id),
  UNIQUE (letter_id, version), UNIQUE (id, firm_id),
  UNIQUE (id, firm_id, matter_id)
) STRICT;
```

Every child table must include `firm_id` and `matter_id`. Add JSON validity, date-shape, integer-minor-unit, ISO-currency, non-empty reason and optimistic-version checks. Use `supersedes_*_id` for factual corrections rather than updates.

- [x] **Step 4: Add immutable triggers and indexes**

Protect letter versions, service events, responses and response-defect rows, conflict checks, instruction versions, milestone events, report records, questions and answers from update and delete. Add indexes for matter workspace reads, due milestone ordering, response versions and engagement status.

- [x] **Step 5: Run migration tests and commit**

Run: `npm test -- src/server/migrations.test.ts src/server/database.test.ts`

Expected: PASS.

Commit: `feat: add protocol and expert schema`

---

### Task 2: Contracts, protocol types and capabilities

**Files:**
- Modify: `src/shared/contracts.ts`
- Modify: `src/server/policy.ts`
- Modify: `src/server/policy.test.ts`
- Create: `src/server/protocol/types.ts`
- Create: `src/server/contracts.protocol.test.ts`

**Interfaces:**
- Produces Zod schemas for every public command.
- Produces `ProtocolWorkspace`, `ProtocolReadiness`, `LetterReviewModel`, `ProtocolMutationContext` and domain record types.
- Produces capabilities `protocol.prepare`, `protocol.approve`, `protocol.override_conflict` and `protocol.review_report`.

- [x] **Step 1: Write failing contract and policy tests**

Cover trimmed narratives, `expectedVersion`, exact route enums, minor-unit money, conditional reasons, at-least-one defect position, service event proof rules, CPR 35 basis and role boundaries:

```ts
expect(hasCapability(user('paralegal'), 'protocol.prepare')).toBe(true);
expect(hasCapability(user('paralegal'), 'protocol.approve')).toBe(false);
expect(hasCapability(user('solicitor'), 'protocol.approve')).toBe(true);
expect(hasCapability(user('solicitor'), 'protocol.override_conflict')).toBe(false);
expect(hasCapability(user('partner'), 'protocol.override_conflict')).toBe(true);

expect(recordProtocolServiceEventSchema.safeParse({
  idempotencyKey: 'receipt-2026-07-16',
  letterVersionId,
  eventType: 'actual_receipt',
  method: 'email',
  occurredAt: '2026-07-16T09:30:00.000Z',
  legalTriggerOn: '2026-07-16',
  recipient: 'Meridian Housing',
  destination: 'repairs@example.test',
  sourceDetail: 'Delivery receipt reviewed by Ava Morgan.',
  supportingDocumentVersionId: null,
  supersedesEventId: null,
  correctionReason: '',
}).success).toBe(true);
```

- [x] **Step 2: Run tests and verify RED**

Run: `npm test -- src/server/contracts.protocol.test.ts src/server/policy.test.ts`

Expected: FAIL because schemas, types and capabilities are absent.

- [x] **Step 3: Add schemas and exported input types**

Create and export:

```ts
saveLetterOfClaimSchema
approveLetterOfClaimSchema
recordProtocolServiceEventSchema
recordLandlordResponseSchema
varyProtocolDeadlineSchema
selectExpertRouteSchema
createExpertEngagementSchema
updateExpertEngagementSchema
recordExpertConflictCheckSchema
approveExpertInstructionSchema
recordExpertMilestoneSchema
recordExpertReportSchema
recordExpertQuestionSchema
recordExpertQuestionAnswerSchema
```

Add confirmed workflow trigger event types:

```ts
'expert.report.received'
'expert.report.served_cpr35'
```

Every append-only schema includes an `idempotencyKey` of 8–200 characters. Corrections require both a superseded ID and a reason of at least 10 characters. `urgent_own_expert` and `not_required` routes require a reason.

- [x] **Step 4: Add focused domain types and capabilities**

`ProtocolWorkspace` contains:

```ts
interface ProtocolWorkspace {
  matterId: string;
  case: ProtocolCaseRecord;
  letter: LetterOfClaimRecord;
  letterVersions: LetterOfClaimVersionRecord[];
  serviceEvents: ProtocolServiceEventRecord[];
  landlordResponses: LandlordResponseRecord[];
  experts: ExpertEngagementRecord[];
  deadlines: ProtocolDeadlineSummary[];
  readiness: ProtocolReadiness;
  risks: ProtocolRisk[];
  permissions: {
    canPrepare: boolean;
    canApprove: boolean;
    canOverrideConflict: boolean;
    canReviewReport: boolean;
  };
}
```

Grant prepare to admin, partner, solicitor and paralegal; approval and report review to admin, partner and solicitor; potential-conflict override only to admin and partner. Finance and read-only retain read access only where existing matter permissions allow.

- [x] **Step 5: Run tests and commit**

Run: `npm test -- src/server/contracts.protocol.test.ts src/server/policy.test.ts`

Expected: PASS.

Commit: `feat: define protocol contracts and permissions`

---

### Task 3: Source-linked Letter of Claim assembler

**Files:**
- Create: `src/server/protocol/assembler.ts`
- Create: `src/server/protocol/assembler.test.ts`
- Modify: `src/server/protocol/types.ts`

**Interfaces:**
- Consumes `LetterAssemblySources` and the mutable letter narrative.
- Produces `assembleLetterOfClaim(input): LetterAssemblyResult`.
- Produces deterministic content, source manifest, blockers and warnings without database or file-system side effects.

- [x] **Step 1: Write failing assembler tests**

Use a fixed Maya fixture and assert the official paragraph 5 content, stable ordering, source IDs/versions, missing-fact blockers and stale-source warnings:

```ts
const result = assembleLetterOfClaim(fixture);
expect(result.model).toMatchObject({
  claimant: { name: 'Maya Clarke' },
  property: { addressLine1: '18 Alder Court' },
  defects: expect.arrayContaining([
    expect.objectContaining({ title: 'Bedroom damp and mould' }),
  ]),
  disclosureRequests: expect.arrayContaining([
    'Tenancy agreement and tenancy conditions',
    'Tenancy file',
    'Inspection reports and works records',
    'Computerised repair and complaint records',
  ]),
});
expect(result.manifest.defects).toEqual(
  expect.arrayContaining([{ id: bedroomDefectId, version: 1 }]),
);
expect(result.blockers).toContainEqual(
  expect.objectContaining({ key: 'effect_on_client_missing' }),
);
```

- [x] **Step 2: Run assembler tests and verify RED**

Run: `npm test -- src/server/protocol/assembler.test.ts`

Expected: FAIL because the assembler does not exist.

- [x] **Step 3: Implement deterministic assembly**

Use canonical source values for names, property, landlord, tenancy, defects, notice and access. Sort defects by location/title and events by legal date then ID. Add no prose that is not either standard protocol copy or a reviewed narrative.

Block approval when claimant, property, landlord, active defect schedule, notice position, effect narrative or access availability is missing. Warn rather than block for missing optional personal-injury, special-damages or proposed-expert content when the user has explicitly recorded `none`/`not yet proposed`.

- [x] **Step 4: Add source freshness comparison**

Implement:

```ts
export function compareSourceManifest(
  approved: LetterSourceManifest,
  current: LetterSourceManifest,
): SourceFreshnessResult;
```

It returns exact added, changed and removed source references and never silently refreshes an approved version.

- [x] **Step 5: Run tests and commit**

Run: `npm test -- src/server/protocol/assembler.test.ts`

Expected: PASS.

Commit: `feat: assemble source-linked letters of claim`

---

### Task 4: Deterministic DOCX generation and generated-file storage

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/server/storage.ts`
- Create: `src/server/storage.test.ts`
- Create: `src/server/protocol/renderer.ts`
- Create: `src/server/protocol/renderer.test.ts`

**Interfaces:**
- Adds dependencies `docx@^9.7.1` and `jszip@^3.10.1`.
- Produces `renderLetterOfClaimDocx(model): Promise<Buffer>`.
- Produces `renderExpertInstructionDocx(model): Promise<Buffer>`.
- Produces `storeGeneratedFile(storagePath, bytes): Promise<StoredFile>` with the same private storage guarantees as uploads.

- [x] **Step 1: Write failing renderer and storage tests**

Assert valid ZIP/DOCX bytes, deterministic logical content, HTML-free user text, size/hash correctness, UUID storage key, private mode and cleanup:

```ts
const bytes = await renderLetterOfClaimDocx(letterModel);
expect(bytes.subarray(0, 2).toString()).toBe('PK');
expect(bytes.length).toBeGreaterThan(2_000);

const stored = await storeGeneratedFile(storagePath, Buffer.from('generated'));
expect(stored.sha256).toBe(
  createHash('sha256').update('generated').digest('hex'),
);
expect(readFileSync(join(storagePath, `${stored.storageKey}.blob`), 'utf8'))
  .toBe('generated');
```

- [x] **Step 2: Run tests and verify RED**

Run: `npm test -- src/server/storage.test.ts src/server/protocol/renderer.test.ts`

Expected: FAIL because the renderer and generated-file helper do not exist.

- [x] **Step 3: Install the pinned compatible dependency**

Run: `npm --cache /tmp/npm-cache install docx@^9.7.1`

Expected: package and lock file update with no install error.

- [x] **Step 4: Implement generated storage and renderers**

Write bytes to a random temporary file with mode `0600`, hash while writing, reject anything above `MAX_UPLOAD_BYTES`, then atomically rename to the UUID `.blob` path. Render DOCX with firm/matter heading, reviewed sections, tables for defects/notice/access, disclosure requests, expert proposal and a footer identifying the immutable SwiftClaim version. Construct text nodes directly; never interpret narrative as XML or HTML.

- [x] **Step 5: Run tests, audit and commit**

Run:

```bash
npm test -- src/server/storage.test.ts src/server/protocol/renderer.test.ts
npm audit --omit=dev
```

Expected: tests PASS and audit reports zero vulnerabilities.

Commit: `feat: generate private protocol documents`

---

### Task 5: Letter, service, response and variation domain

**Files:**
- Create: `src/server/protocol/store.ts`
- Create: `src/server/protocol/store.test.ts`
- Create: `src/server/protocol/service.ts`
- Create: `src/server/protocol/service.test.ts`
- Modify: `src/server/store.ts`

**Interfaces:**
- Produces tenant-scoped `ProtocolStore` read/write methods.
- Produces `ProtocolService.getWorkspace`, `saveLetter`, `approveLetter`, `recordServiceEvent`, and `recordLandlordResponse`.
- Produces a transaction-aware generated-document persistence seam.

- [x] **Step 1: Write failing store tests**

Cover workspace visibility, automatic initial case/letter projection, optimistic save, exact source reads, approval atomicity, immutable version/document link, canonical idempotency, service correction, response-by-defect atomicity, cross-matter links, chronology and audit.

```ts
const approved = await service.approveLetter(
  solicitor,
  matterId,
  { expectedVersion: 2, idempotencyKey: 'approve-loc-v1' },
  audit,
);
expect(approved.version.version).toBe(1);
expect(approved.version.documentVersion.sha256).toMatch(/^[a-f0-9]{64}$/);
expect(() => database.exec(
  `UPDATE letter_of_claim_versions SET renderer_version = 'changed'
   WHERE id = '${approved.version.id}'`,
)).toThrow(/immutable/);
```

- [x] **Step 2: Run store tests and verify RED**

Run: `npm test -- src/server/protocol/store.test.ts`

Expected: FAIL because the store does not exist.

- [x] **Step 3: Implement tenant-scoped reads and current-state commands**

Follow the evidence store's generic-404 pattern. `getWorkspace(user, matterId)` must use existing matter access rules; firm/matter IDs are always predicates. Source assembly reads the canonical housing case and evidence records by the same firm and matter.

`saveLetter` updates only the mutable working record with `expectedVersion`. An approved version is never modified. A subsequent edit increments the draft version and marks source freshness without changing prior snapshots.

- [x] **Step 4: Implement approval and generated document atomicity**

Render and store bytes before the database transaction. Inside one transaction create the document, document version, approved letter version, protocol status, chronology and audit. Delete the stored bytes if any persistence step fails. Canonical command payload comparison makes an identical retry return the first approved version and a changed retry return `IDEMPOTENCY_KEY_REUSED`.

Expose a narrow `MatterStore.getDocumentFileByVersion(firmId, matterId, versionId)` read for generated-version downloads without accepting a document from another matter.

- [x] **Step 5: Implement service and response events**

Dispatch requires an approved exact letter version. Receipt requires approval capability, a legal trigger date and an existing dispatch for that version. `deemed_receipt` must carry the confirmed date and source explanation; the service may return a proposed post date but may not persist it until confirmed.

Landlord response insertion and every linked defect position occur in one transaction. `no_response_recorded` is permitted only after the current response deadline is overdue. Corrections create superseding records.

- [x] **Step 6: Implement service permission/error mapping**

Use stable codes:

```ts
type ProtocolErrorCode =
  | 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED' | 'PROTOCOL_INVALID'
  | 'APPROVAL_BLOCKED' | 'TRIGGER_BLOCKED';
```

Paralegals can save a draft and create non-legal preparation facts but cannot approve, confirm receipt, record `no_response_recorded`, vary a legal deadline or approve a correction that changes a legal trigger.

- [x] **Step 7: Run store/service tests and commit**

Run: `npm test -- src/server/protocol/store.test.ts src/server/protocol/service.test.ts`

Expected: PASS.

Commit: `feat: govern protocol letters and responses`

---

### Task 6: Expert engagement domain

**Files:**
- Modify: `src/server/protocol/store.ts`
- Modify: `src/server/protocol/store.test.ts`
- Modify: `src/server/protocol/service.ts`
- Modify: `src/server/protocol/service.test.ts`
- Create: `src/server/protocol/instruction.ts`
- Create: `src/server/protocol/instruction.test.ts`

**Interfaces:**
- Adds route decision, engagement, conflict, instruction, milestone, report, question and answer commands.
- Produces `assembleExpertInstruction(input): ExpertInstructionModel`.
- Preserves every instruction/report/question/answer against an exact immutable document version.

- [x] **Step 1: Write failing expert-domain tests**

Cover route reasons, role permissions, terms/fee fields, human conflict decisions, potential-conflict partner override, deterministic instruction sources, generated DOCX approval, inspection/report milestones, exact report versions, question/answer append-only behaviour and cross-matter rejection.

```ts
expect(() => service.approveInstruction(
  solicitor,
  matterId,
  engagementId,
  { expectedVersion: 2, idempotencyKey: 'instruction-v1' },
  audit,
)).toThrowErrorMatchingObject({ code: 'APPROVAL_BLOCKED' });

service.recordConflictCheck(partner, matterId, engagementId, {
  idempotencyKey: 'expert-conflict-1',
  partiesChecked: ['Maya Clarke', 'Meridian Housing'],
  method: 'Written declaration and supplied conflict search',
  searchDetail: 'Synthetic evaluation check.',
  outcome: 'potential',
  decision: 'proceed_with_override',
  reason: 'Partner reviewed the disclosed historic instruction and approved progression.',
}, audit);
```

- [x] **Step 2: Run tests and verify RED**

Run: `npm test -- src/server/protocol/instruction.test.ts src/server/protocol/store.test.ts src/server/protocol/service.test.ts`

Expected: FAIL because expert operations are absent.

- [x] **Step 3: Implement route, engagement and conflict commands**

Require reasoned authorised decisions for `not_required` and `urgent_own_expert`. Store supplied qualifications and registration metadata as unverified unless a human supplies verification method/date. Require terms status, fee, payer split and availability before instruction approval.

A `clear` conflict outcome still requires a named human decision. `potential` can proceed only with `protocol.override_conflict`; `blocked` and `unable_to_complete` cannot be overridden into an instruction.

- [x] **Step 4: Implement instruction assembly and approval**

Assemble property, parties, all material source documents, issues/questions, access, urgent-work request, schedule-of-works request, cost estimate request, terms and deadline. Include the expert-duty statement. Use the same generated-file rollback pattern as Letter of Claim approval.

- [x] **Step 5: Implement milestones, reports, questions and answers**

Only a booked inspection can become completed/failed/cancelled; rescheduling supersedes the prior booking fact. A report record requires an exact document version from the same matter. Report review is an append-only milestone, not an update. Questions require clarification purpose and exact report. Answers create separate rows with exact document versions.

- [x] **Step 6: Run tests and commit**

Run: `npm test -- src/server/protocol/instruction.test.ts src/server/protocol/store.test.ts src/server/protocol/service.test.ts`

Expected: PASS.

Commit: `feat: control expert evidence lifecycle`

---

### Task 7: Deadline integration and objective workflow readiness

**Files:**
- Modify: `src/server/workflow/definitions.ts`
- Modify: `src/server/workflow/definitions.test.ts`
- Modify: `src/server/workflow/store.ts`
- Modify: `src/server/workflow/store.test.ts`
- Modify: `src/server/workflow/service.ts`
- Modify: `src/server/workflow/service.test.ts`
- Modify: `src/server/protocol/store.ts`
- Modify: `src/server/protocol/service.ts`

**Interfaces:**
- Adds deadline rules `housing.protocol.substantive_response` and `housing.expert.clarification_questions`.
- Produces `WorkflowStore.recordTriggerAndDeadlineInTransaction` and `WorkflowStore.varyDeadline`.
- Makes `ProtocolService` implement `ProtocolReadinessProvider`.
- Makes `WorkflowService` enforce protocol/expert objective blockers.

- [x] **Step 1: Write failing deadline and readiness tests**

Assert exact working/calendar-day due dates, one event/deadline/task on retry, rollback with the protocol event, immutable superseding variation, unsupported checklist filtering and partner override audit.

```ts
expect(ruleFor('expert.report.received')).toMatchObject({
  key: 'housing.protocol.substantive_response',
  offset: 20,
  unit: 'working_days',
});
expect(ruleFor('expert.report.served_cpr35')).toMatchObject({
  key: 'housing.expert.clarification_questions',
  offset: 28,
  unit: 'calendar_days',
});
```

- [x] **Step 2: Run tests and verify RED**

Run: `npm test -- src/server/workflow/definitions.test.ts src/server/workflow/store.test.ts src/server/workflow/service.test.ts`

Expected: FAIL because the new rules and readiness provider are absent.

- [x] **Step 3: Add rules and transaction-aware trigger recording**

Refactor the existing trigger implementation into:

```ts
recordTriggerAndDeadline(input: RecordTriggerInput): TriggerDeadlineResult
recordTriggerAndDeadlineInTransaction(input: RecordTriggerInput): TriggerDeadlineResult
```

The public wrapper owns `BEGIN/COMMIT/ROLLBACK`; the in-transaction method performs the identical writes without transaction statements. `ProtocolStore` uses the in-transaction method so receipt/report facts and deadlines are atomic.

- [x] **Step 4: Add immutable deadline variation**

`varyDeadline` validates firm/matter/current deadline, records the original as `superseded`, creates a new immutable deadline pointing to `supersedes_deadline_id`, creates a new reminder task, cancels the old open generated task, and records the agreement date, reason, actor, audit and chronology. It never updates the original deadline row.

- [x] **Step 5: Implement protocol readiness**

Return controls and blockers for both stages:

```ts
interface ProtocolReadinessProvider {
  getProtocolReadiness(
    firmId: string,
    matterId: string,
    stageKey: 'protocol' | 'expert',
  ): ProtocolReadiness;
}
```

Protocol requires approved exact letter, dispatch, confirmed receipt, response deadline and response/no-response/urgent route. Expert instruction requires route, acceptable conflict, terms, immutable instruction and dispatch; leaving expert additionally requires reviewed report/agreed schedule or authorised `not_required`.

- [x] **Step 6: Enforce readiness in `WorkflowService`**

Filter unsupported `letter_of_claim_sent` and `expert_instruction_confirmed` confirmations exactly as evidence controls are filtered. Add progression blockers even when the stage checklist key was previously completed. Preserve partner/admin reasoned override and audit.

- [x] **Step 7: Run tests and commit**

Run: `npm test -- src/server/workflow/definitions.test.ts src/server/workflow/store.test.ts src/server/workflow/service.test.ts src/server/protocol/service.test.ts`

Expected: PASS.

Commit: `feat: enforce protocol and expert readiness`

---

### Task 8: Protocol API and application composition

**Files:**
- Create: `src/server/protocol/routes.ts`
- Create: `src/server/protocol/routes.test.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/app.test.ts`

**Interfaces:**
- Exposes the read and mutation routes from design section 11.
- Composes `ProtocolStore`, `ProtocolService`, renderers, generated storage and workflow dependencies in `buildApp`.

- [x] **Step 1: Write failing route tests**

Exercise login plus workspace read, draft save, blocked paralegal approval, solicitor approval/download, service/receipt, response, expert route/engagement/conflict/instruction, milestones/report/question/answer, idempotent replay, stale `409`, cross-firm `404` and read-only `403`.

- [x] **Step 2: Run routes and verify RED**

Run: `npm test -- src/server/protocol/routes.test.ts`

Expected: FAIL with route `404`s.

- [x] **Step 3: Implement route error and command handling**

Use the existing error envelope with field errors nested in `error.fields`. Parse every route body before service invocation, require the validated `idempotencyKey` field on retryable append-only bodies, and return `201` for newly appended resources, `200` for projections/updates and `204` only when no body exists.

- [x] **Step 4: Register the domain in `buildApp`**

Construct one `ProtocolStore` and one `ProtocolService`; inject the service into `WorkflowService` as readiness provider. Generated storage uses `options.storagePath`. Keep middleware, rate limits, session policy and generic error handling unchanged.

- [x] **Step 5: Add exact-version generated download**

Expose:

`GET /api/matters/:matterId/protocol/generated/:documentVersionId/download`

It requires matter read access, looks up the exact version in that firm/matter, uses the stored MIME/name and sends `nosniff` plus attachment headers. It cannot substitute a newer version.

- [x] **Step 6: Run API tests and commit**

Run: `npm test -- src/server/protocol/routes.test.ts src/server/app.test.ts`

Expected: PASS.

Commit: `feat: expose protocol and expert API`

---

### Task 9: Synthetic Protocol and Experts evaluation journey

**Files:**
- Modify: `src/server/database.ts`
- Modify: `src/server/database.test.ts`
- Modify: `src/server/index.ts`
- Create: `src/server/protocol/seed.test.ts`

**Interfaces:**
- Produces `seedProtocolExpertsEvaluation(database, storagePath): Promise<void>`.
- Produces idempotent Maya protocol/expert data and real downloadable generated bytes without making the existing synchronous `seedDatabase` API asynchronous.

- [x] **Step 1: Write failing seed tests**

Assert one case/letter, approved version, dispatch and receipt, partial landlord response, expert candidate/conflict/terms, instruction, inspection/report due state, deliberate gaps, exact document file existence when storage is supplied, tenant isolation and idempotency after double seed.

- [x] **Step 2: Run seed tests and verify RED**

Run: `npm test -- src/server/protocol/seed.test.ts src/server/database.test.ts`

Expected: FAIL because protocol seed data does not exist.

- [x] **Step 3: Add deterministic IDs and the synthetic journey**

Use fictional surveyor `Elena Ward`, fictional organisation `Northfield Building Surveyors`, supplied/unverified RICS reference `SYNTHETIC-RICS-1042`, GBP minor-unit terms, and no real contact information. Seed a landlord response that leaves the communal ingress defect unaddressed and disclosure incomplete. Seed one completed inspection and omit the report so `report_overdue_or_missing` is visible.

Remove the existing future-stage `letter_of_claim_sent` checklist key from the evidence-to-protocol seed transition. Let the protocol records make the key objectively eligible.

- [x] **Step 4: Seed real generated bytes only with a storage path**

After the existing synchronous matter/intake/evidence seed, `index.ts` calls:

```ts
if (shouldSeed) {
  seedDatabase(database);
  await seedProtocolExpertsEvaluation(database, storagePath);
}
```

The awaited seed creates private deterministic-content DOCX bytes through the production renderer/storage path, while IDs and command keys remain idempotent. Existing unit tests remain unchanged; protocol seed tests and route tests call the new async function explicitly with temporary storage.

- [x] **Step 5: Run seed tests and commit**

Run: `npm test -- src/server/protocol/seed.test.ts src/server/database.test.ts`

Expected: PASS.

Commit: `feat: seed protocol and expert evaluation`

---

### Task 10: Matter 360 Protocol & experts workspace

**Files:**
- Modify: `src/client/api.ts`
- Modify: `src/client/pages/MatterPage.tsx`
- Modify: `src/client/components/matter/MatterSectionRail.tsx`
- Create: `src/client/components/matter/ProtocolExpertsPanel.tsx`
- Create: `src/client/components/matter/ProtocolLetterView.tsx`
- Create: `src/client/components/matter/LandlordResponseView.tsx`
- Create: `src/client/components/matter/ExpertEvidenceView.tsx`
- Create: `src/client/components/matter/ProtocolDialogs.tsx`
- Create: `src/client/components/matter/ProtocolExpertsPanel.test.tsx`
- Modify: `src/client/styles.css`

**Interfaces:**
- Adds client `ProtocolWorkspace` type matching the API.
- Activates `protocol_experts` in the Matter Section rail.
- Lazy-loads the workspace only when selected.

- [x] **Step 1: Write failing panel tests**

Test seeded status, 20-working-day calculation, source freshness, blocker/risk text, letter version/download, landlord by-defect position, expert conflict/terms/milestone/report states, role-specific actions, three internal views and retry state.

- [x] **Step 2: Run client tests and verify RED**

Run: `npm test -- src/client/components/matter/ProtocolExpertsPanel.test.tsx`

Expected: FAIL because the panel does not exist.

- [x] **Step 3: Add API types and lazy MatterPage loading**

Mirror the server projection exactly. Add `protocolWorkspace`, loading and error state; reset it on matter change; fetch `/api/matters/:matterId/protocol-experts` only when `section === 'protocol_experts'`; refresh after mutations. Set the rail entry to `available: true` and show expert count.

- [x] **Step 4: Build the unified caseboard**

Use three accessible view buttons: `Letter of Claim`, `Landlord response`, `Experts`. Place status, next legal date, risks and readiness at the top. Show explicit labels for `Confirmed fact`, `User supplied`, `Unverified`, `Missing` and `Official calculation`.

- [x] **Step 5: Add focused controlled dialogs**

Provide preparation/edit, approval confirmation, service/receipt, response, expert route, engagement/terms, conflict, instruction approval, milestone, report, question and answer dialogs. Disable approval when server blockers exist but still display the server error on races. Paralegal and read-only views must not render unauthorised actions.

- [x] **Step 6: Add responsive styling and run tests**

Desktop uses a dense caseboard with a main column and right status rail. Below 980px stack the legal deadline/risk card before content. Below 640px preserve view buttons, primary action and exact version/provenance labels without horizontal clipping.

Run:

```bash
npm test -- src/client/components/matter/ProtocolExpertsPanel.test.tsx
npm run typecheck
```

Expected: PASS.

- [x] **Step 7: Commit**

Commit: `feat: add protocol and expert workspace`

---

### Task 11: Documentation, full verification and publication

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-14-protocol-experts.md`

**Interfaces:**
- Documents only implemented behaviour and retains evaluation-only boundaries.
- Sets the next SwiftClaim slice to Repairs and Quantum.

- [x] **Step 1: Run the complete quality gates**

Run:

```bash
npm test
npm run typecheck
npm run build
npm audit --omit=dev
git diff --check
```

Expected: all tests pass, both TypeScript programs pass, production build succeeds, audit reports zero vulnerabilities and no whitespace errors exist.

- [x] **Step 2: Exercise the production solicitor journey**

With fresh temporary data and storage, build and start production, then verify:

1. Ava signs in and opens Maya's Protocol & experts workspace.
2. Source facts, approved letter, dispatch/receipt and exact deadline render.
3. A new draft can be saved and approved to a real downloadable DOCX.
4. A landlord response can be recorded against defects.
5. Expert route, conflict, terms, instruction, inspection and report controls work.
6. Objective transition rejection and partner override work.
7. Priya receives `403` on mutation and Lewis receives generic `404` for Maya's resource.
8. Restart preserves records and generated files.
9. Exercised requests produce zero HTTP 5xx.

- [x] **Step 3: Run tracked-file and secret hygiene**

Run:

```bash
git status --short
git ls-files | rg '(^|/)(data|dist|uploads)/|\.sqlite$|\.blob$'
git grep -nEi '(api[_-]?key|secret|token|password)\s*[:=]\s*["'"'][^"'"']+["'"']' -- ':!package-lock.json'
```

Expected: no runtime database, uploads, generated client documents or secrets are tracked.

- [x] **Step 4: Update README and complete this checklist**

Document Protocol & Experts capabilities, synthetic journey, API routes, official sources, human controls and limitations. Do not claim external delivery, AI analysis, professional-register verification, migration or full CMS completion. Set **Repairs and Quantum** as the next SwiftClaim slice.

- [x] **Step 5: Commit and publish safely**

Commit: `docs: complete protocol and expert guide`

Re-read GitHub `main` and verify the merged evidence commit is still an ancestor. Publish the exact tested snapshot through a non-force feature branch, open a draft PR with verification evidence, independently verify the file list and head SHA, then mark the checklist complete. Do not merge until GitHub reports the PR mergeable and the final head is re-verified.
