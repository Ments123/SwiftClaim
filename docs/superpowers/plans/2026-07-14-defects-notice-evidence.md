# Defects, Notice and Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Housing Conditions Evidence and notice stage operational with structured defects, notice/access chronology, immutable evidence links, explainable risk/readiness and two complete Matter 360 sections.

**Architecture:** Add a focused `evidence` domain with store, service, readiness and route boundaries. Persist current defect state with optimistic versions while preserving notices, access events, evidence items, links and status history as append-only records. Inject a narrow readiness provider into the existing workflow service so human checklist confirmation is accepted only when the records support it or a partner records an override.

**Tech Stack:** TypeScript 7, Node.js 24 `node:sqlite`, Fastify 5, Zod 4, React 19, Vitest, Testing Library, Vite, existing private file/document storage.

## Global Constraints

- Work on SwiftClaim only; do not create or modify SwiftBridge.
- Use only synthetic evaluation data; the build remains unapproved for live client material.
- Never auto-determine liability, breach, causation, limitation, hazard classification or quantum.
- Every tenant-owned query uses server-derived `firm_id`; inaccessible resources return generic `404`.
- Defect mutations use optimistic versions; notices, access, evidence and link records are append-only.
- Evidence points to an exact immutable `document_version`, never a mutable latest document.
- Workflow controls remain human-confirmed; the server validates objective eligibility and retains partner/admin override with a reason.
- No new npm package or external provider is required.

---

### Task 1: Evidence contracts and migration

**Files:**
- Create: `src/server/migrations/004-defects-notice-evidence.ts`
- Modify: `src/server/migrations/index.ts`
- Modify: `src/server/migrations.test.ts`
- Modify: `src/server/database.test.ts`
- Modify: `src/shared/contracts.ts`

**Interfaces:**
- Produces migration version `4`, name `defects notice and evidence`.
- Produces Zod schemas `createDefectSchema`, `updateDefectSchema`, `createNoticeSchema`, `createAccessEventSchema`, and `createEvidenceItemSchema`.

- [x] **Step 1: Write migration and contract tests that fail**

Assert migration order, all eight new tables, strict composite tenant foreign keys, immutable triggers, version checks and representative schema rejection:

```ts
expect(migrations.map(({ version, name }) => ({ version, name }))).toEqual([
  { version: 1, name: 'secure matter spine' },
  { version: 2, name: 'workflow foundation' },
  { version: 3, name: 'intake and onboarding' },
  { version: 4, name: 'defects notice and evidence' },
]);
expect(tableNames).toEqual(expect.arrayContaining([
  'defects', 'defect_status_events', 'notices', 'access_events',
  'evidence_items', 'defect_evidence_links', 'notice_evidence_links',
  'access_evidence_links',
]));
expect(() => database.exec('DELETE FROM notices')).toThrow(/append-only/);
```

- [x] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- src/server/migrations.test.ts src/server/database.test.ts`

Expected: FAIL because migration 4 and the schemas do not exist.

- [x] **Step 3: Add complete request contracts**

Use exact enums and limits:

```ts
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idempotencyKey = z.string().trim().min(8).max(200);

export const createDefectSchema = z.object({
  location: z.string().trim().min(2).max(120),
  category: z.enum(['damp_mould', 'leak', 'heating', 'electrical', 'structural', 'pest', 'ventilation', 'sanitation', 'other']),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10).max(4_000),
  severity: z.enum(['low', 'moderate', 'serious', 'critical']),
  firstObservedOn: dateOnly.nullable(),
  healthImpact: z.string().trim().max(2_000).default(''),
  hazardTags: z.array(z.string().trim().min(2).max(80)).max(20).default([]),
});

export const updateDefectSchema = createDefectSchema.extend({
  expectedVersion: z.number().int().positive(),
  status: z.enum(['open', 'monitoring', 'repaired', 'disputed', 'superseded']),
  statusReason: z.string().trim().min(10).max(1_000),
});
```

Notice/access/evidence schemas require body `idempotencyKey`. Evidence requires one immutable `documentVersionId` and deduplicated arrays `defectIds`, `noticeIds`, `accessEventIds`, with at least one link target.

- [x] **Step 4: Implement migration 4**

Use strict tables, composite `(id, firm_id, matter_id)` uniqueness for link integrity, JSON validity checks and triggers that reject update/delete on append-only tables. Store `idempotency_key` and canonical `command_payload_json` on notice, access and evidence item records with unique `(firm_id, matter_id, idempotency_key)` per resource.

- [x] **Step 5: Verify GREEN and commit**

Run: `npm test -- src/server/migrations.test.ts src/server/database.test.ts && npm run typecheck`

Commit: `feat: add evidence domain schema`

---

### Task 2: Tenant-scoped evidence store and projections

**Files:**
- Create: `src/server/evidence/types.ts`
- Create: `src/server/evidence/store.ts`
- Create: `src/server/evidence/store.test.ts`

**Interfaces:**
- Produces `EvidenceStore.getWorkspace(user, matterId)`.
- Produces transactional methods `createDefect`, `updateDefect`, `createNotice`, `createAccessEvent`, and `createEvidenceItem`.
- Produces `EvidenceWorkspace`, `EvidenceReadiness`, and `EvidenceRisk` response types.
- Mutation methods consume `EvidenceMutationContext { actorUserId, occurredAt, requestId, ipAddress }` and own the domain row, chronology and audit transaction.

- [x] **Step 1: Write failing store tests**

Cover readable/writable matter scope, five record kinds, exact document-version linking, stale version conflict, cross-matter link rollback, idempotent replay and overlapping risks.

```ts
expect(store.getWorkspace(ava, SEED_IDS.northstarMatter)).toMatchObject({
  matterId: SEED_IDS.northstarMatter,
  permissions: { canWrite: true },
  readiness: {
    controls: expect.arrayContaining([
      expect.objectContaining({ key: 'defect_schedule_recorded' }),
      expect.objectContaining({ key: 'notice_evidence_recorded' }),
      expect.objectContaining({ key: 'photographs_recorded' }),
    ]),
  },
});
expect(store.getWorkspace(ava, SEED_IDS.northstarRestrictedMatter)).toBeUndefined();
```

- [x] **Step 2: Run and verify RED**

Run: `npm test -- src/server/evidence/store.test.ts`

Expected: FAIL because the evidence store does not exist.

- [x] **Step 3: Implement exact mapping and scope helpers**

Follow `MatterStore` access rules. Return `undefined` rather than leaking whether an inaccessible matter or child record exists. Project document versions from the existing `documents` and `document_versions` tables.

- [x] **Step 4: Implement deterministic readiness and risks**

```ts
const controls = [
  control('defect_schedule_recorded', activeDefects.length > 0,
    activeDefects.length ? 'The active defect schedule is structured.' : 'Record at least one active defect.'),
  control('notice_evidence_recorded', notices.some((notice) => notice.proofStatus !== 'unknown'),
    notices.length ? 'Record an explicit proof position for a notice.' : 'Record the landlord notice history.'),
  control('photographs_recorded', evidence.some((item) =>
    item.kind === 'photograph' && item.defectIds.length > 0),
    'Link at least one preserved photograph to an active defect.'),
];
```

Return every applicable risk, not one mutually exclusive kind. Use stable keys composed from type and entity ID.

- [x] **Step 5: Implement transaction-safe writes**

Defect update SQL includes `WHERE version = ?`; zero changes raises `EvidenceStateConflictError`. Append-only replay compares canonical payload JSON and rejects a reused key with changed input. Evidence-item creation validates every document version and target belongs to the same firm/matter before inserting anything.

- [x] **Step 6: Verify GREEN and commit**

Run: `npm test -- src/server/evidence/store.test.ts && npm run typecheck`

Commit: `feat: add evidence investigation store`

---

### Task 3: Evidence service, audit and chronology

**Files:**
- Create: `src/server/evidence/service.ts`
- Create: `src/server/evidence/service.test.ts`

**Interfaces:**
- Produces `EvidenceService` methods matching the store commands.
- Produces `EvidenceError(statusCode, code, message, details)`.
- Produces `EvidenceReadinessProvider.getEvidenceReadiness(firmId, matterId)`.

- [x] **Step 1: Write failing service tests**

Test read-only denial, writer success, stale conflict mapping, immutable correction semantics, timeline/audit metadata and transaction rollback.

```ts
expect(auditRow).toMatchObject({
  action: 'evidence.defect_created',
  userId: ava.id,
  requestId: audit.requestId,
  ipAddress: audit.ipAddress,
});
expect(timelineRow).toMatchObject({
  type: 'evidence.defect_created',
  actorUserId: ava.id,
});
```

- [x] **Step 2: Run and verify RED**

Run: `npm test -- src/server/evidence/service.test.ts`

Expected: FAIL because `EvidenceService` does not exist.

- [x] **Step 3: Implement command validation and error mapping**

Require matter write access for mutations and matter read access for workspace reads. Map stale state to `409 CONFLICT`, changed idempotency payload to `409 IDEMPOTENCY_KEY_REUSED`, invalid link targets to generic `404`, and domain validation to `422 EVIDENCE_INVALID`.

- [x] **Step 4: Pass audit context into store-owned transactions**

Build one `EvidenceMutationContext` from the authorised actor, service clock and HTTP audit context. The store inserts the domain row, status event where applicable, chronology and audit before committing its transaction. Audit before/after defect state; append-only events record the canonical created record and link IDs.

- [x] **Step 5: Verify GREEN and commit**

Run: `npm test -- src/server/evidence/service.test.ts src/server/evidence/store.test.ts`

Commit: `feat: govern evidence investigation commands`

---

### Task 4: Workflow evidence readiness enforcement

**Files:**
- Modify: `src/server/workflow/service.ts`
- Modify: `src/server/workflow/service.test.ts`
- Modify: `src/server/app.ts`

**Interfaces:**
- Consumes `EvidenceReadinessProvider`.
- Preserves the existing `WorkflowService` public API.

- [x] **Step 1: Write failing workflow tests**

At the `evidence` stage, assert that checking `photographs_recorded` without an eligible readiness control returns `READINESS_BLOCKED`; assert supported confirmations pass; assert partner override still records the reason and blockers.

- [x] **Step 2: Run and verify RED**

Run: `npm test -- src/server/workflow/service.test.ts -t "evidence readiness"`

Expected: FAIL because checklist confirmation currently trusts the browser.

- [x] **Step 3: Inject and enforce the readiness provider**

Before merging supplied checklist keys, filter current-stage evidence keys and verify each exists with `eligible: true`. Unsupported supplied keys become structured blockers. Do not auto-complete eligible keys. Apply the existing privileged override checks to objective evidence blockers.

- [x] **Step 4: Verify GREEN and commit**

Run: `npm test -- src/server/workflow/service.test.ts src/server/evidence/service.test.ts && npm run typecheck`

Commit: `feat: enforce evidence stage readiness`

---

### Task 5: Evidence HTTP boundary and security

**Files:**
- Create: `src/server/evidence/routes.ts`
- Create: `src/server/evidence/routes.test.ts`
- Modify: `src/server/app.ts`
- Modify: `src/shared/contracts.ts`

**Interfaces:**
- Exposes the six routes in the approved design.
- Reuses session resolution and the global stable error envelope.

- [x] **Step 1: Write failing route tests**

Cover signed-out `401`, readable workspace, writer mutations, read-only `403`, same-firm inaccessible and cross-firm `404`, stale `409`, validation fields, idempotent replay and changed-payload rejection.

- [x] **Step 2: Run and verify RED**

Run: `npm test -- src/server/evidence/routes.test.ts`

Expected: FAIL with route `404` responses.

- [x] **Step 3: Implement route registration and error mapping**

Define `evidenceRoutes(app, { requireUser, service })`. Parse every body with the exact Zod schema. Pass `{ requestId: request.id, ipAddress: request.ip }` to service commands. Map `EvidenceError` without stack or row leakage.

- [x] **Step 4: Verify GREEN and commit**

Run: `npm test -- src/server/evidence/routes.test.ts src/server/security.test.ts src/server/app.test.ts`

Commit: `feat: expose evidence investigation API`

---

### Task 6: Synthetic evaluation evidence

**Files:**
- Modify: `src/server/database.ts`
- Modify: `src/server/database.test.ts`
- Modify: `src/server/evidence/store.test.ts`

**Interfaces:**
- Adds stable `SEED_IDS` for five defects, notices, access events, evidence items and exact document versions.
- Keeps `seedDatabase` idempotent.

- [x] **Step 1: Write failing seed tests**

Assert Northstar's main matter has five defects over four locations, multi-channel notices, access history, linked photographs and at least one visible evidence gap. Assert Southbank records are absent from Northstar projections and repeated seeding does not duplicate rows.

- [x] **Step 2: Run and verify RED**

Run: `npm test -- src/server/database.test.ts -t "evidence investigation"`

- [x] **Step 3: Add clearly synthetic seed records**

Use Maya Clarke's converted Housing Conditions matter. Include bedroom damp/mould, bathroom leak, kitchen ventilation, intermittent heating and communal water ingress. Label source documents and evidence descriptions `Synthetic evaluation evidence` and preserve an exact document version SHA/storage key row.

- [x] **Step 4: Verify GREEN and commit**

Run: `npm test -- src/server/database.test.ts src/server/evidence/store.test.ts`

Commit: `feat: seed housing evidence investigation`

---

### Task 7: Defects & repairs Matter 360 section

**Files:**
- Create: `src/client/components/matter/DefectsRepairsPanel.tsx`
- Create: `src/client/components/matter/DefectsRepairsPanel.test.tsx`
- Create: `src/client/components/matter/EvidenceDialogs.tsx`
- Modify: `src/client/api.ts`
- Modify: `src/client/pages/MatterPage.tsx`
- Modify: `src/client/components/matter/MatterSectionRail.tsx`
- Modify: `src/client/styles.css`

**Interfaces:**
- Consumes `EvidenceWorkspace` from `/evidence-investigation`.
- Produces create/edit defect, create notice and create access interactions.

- [x] **Step 1: Write failing component tests**

Test lazy loading, summary metrics, location grouping, risk/readiness strip, accessible dialogs, create/edit payloads, notice/access histories, read-only controls, conflict refresh and mobile semantic order.

- [x] **Step 2: Run and verify RED**

Run: `npm test -- src/client/components/matter/DefectsRepairsPanel.test.tsx`

Expected: FAIL because the section is disabled and the component is absent.

- [x] **Step 3: Add exact client contracts and lazy loading**

Add discriminated TypeScript types matching the API. Load the workspace only when `defects_repairs` or `evidence` is active, use `AbortController`, cache the result for both sections and refresh after successful mutations.

- [x] **Step 4: Implement the panel and dialogs**

Use semantic sections, articles, lists, labels, native buttons/selects and the existing `Dialog`. Group defects by `location`, sort critical/serious first, show evidence count and never colour alone as the status signal.

- [x] **Step 5: Add responsive styles and verify GREEN**

Run: `npm test -- src/client/components/matter/DefectsRepairsPanel.test.tsx src/client/App.test.tsx && npm run typecheck`

Commit: `feat: add defects and notice workspace`

---

### Task 8: Evidence Matter 360 section

**Files:**
- Create: `src/client/components/matter/EvidenceInvestigationPanel.tsx`
- Create: `src/client/components/matter/EvidenceInvestigationPanel.test.tsx`
- Modify: `src/client/pages/MatterPage.tsx`
- Modify: `src/client/components/matter/MatterSectionRail.tsx`
- Modify: `src/client/styles.css`

**Interfaces:**
- Reuses the cached `EvidenceWorkspace` and mutation refresh from Task 7.
- Produces evidence filtering, gap inspection and exact document-version linking.

- [x] **Step 1: Write failing evidence UI tests**

Test all three readiness controls, multiple simultaneous risks, provenance, immutable version display, defect/notice/access selection, disabled mutation controls and navigation to Documents when no version is available.

- [x] **Step 2: Run and verify RED**

Run: `npm test -- src/client/components/matter/EvidenceInvestigationPanel.test.tsx`

- [x] **Step 3: Implement evidence panel and linking dialog**

Require an exact document version and at least one target. Display source filename, version, SHA prefix, provenance and every linked fact. Keep medical links descriptive only; do not preview or expose sensitive file bytes in the aggregate.

- [x] **Step 4: Activate both section-rail items and verify GREEN**

Run: `npm test -- src/client/components/matter/EvidenceInvestigationPanel.test.tsx src/client/components/matter/DefectsRepairsPanel.test.tsx src/client/App.test.tsx && npm run typecheck`

Commit: `feat: add evidence investigation workspace`

---

### Task 9: Operating guide, release verification and publication

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-14-defects-notice-evidence.md`

**Interfaces:**
- Documents the evaluation journey, API routes, evidence limitations and next SwiftClaim slice.

- [x] **Step 1: Run all automated gates**

Run: `npm test && npm run typecheck && npm run build && npm audit --omit=dev`

Expected: all tests pass, both TypeScript programs pass, production build succeeds and dependency audit reports zero high-severity vulnerabilities.

- [x] **Step 2: Run tracked-file and secret hygiene**

Run: `git diff --check && git status --short && git ls-files | rg '(^|/)(data|dist|uploads)/|\.sqlite$'`

Expected: no whitespace errors and no runtime data, build output, uploads or database files tracked.

- [x] **Step 3: Exercise the solicitor and partner journeys**

Using a fresh `DATA_DIR`, verify login, seeded evidence read, defect create/edit, notice/access capture, evidence linking, objective readiness rejection, supported normal progression, partner override, reload persistence, zero HTTP 5xx and no cross-firm disclosure.

- [x] **Step 4: Update README and complete this checklist**

Document what is implemented and explicitly retain the evaluation-only boundary. Set the next SwiftClaim slice to Protocol and Experts. Do not claim AI, calling, migration or full CMS completion.

- [ ] **Step 5: Commit and publish from the current GitHub head**

Commit: `docs: complete evidence investigation guide`

Before updating GitHub, re-read remote `main`, ensure it is still `2d119a11418cc47a1b6bef3ddb1d3e25365641af` or an ancestor of the intended branch, publish through a non-force branch/PR flow, and verify the published snapshot independently.
