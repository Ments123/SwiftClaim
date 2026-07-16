# Governed Communications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an evaluation-safe, provider-neutral matter communications ledger with controlled drafting, approval, dispatch, call capture, confidentiality and a complete Matter 360 workspace.

**Architecture:** Add a bounded `communications` domain to the existing TypeScript modular monolith. SQLite owns immutable legal records and append-only provider events; a service layer enforces capabilities and dispatch invariants; a narrow provider port keeps Microsoft Graph and WhatsApp payloads out of the canonical model. React lazy-loads a filtered workspace and never infers delivery or service from provider acceptance.

**Tech Stack:** Node.js 24, TypeScript 7, Fastify 5, SQLite `DatabaseSync`, Zod 4, React 19, Vite 8, Vitest 4, Testing Library.

## Global Constraints

- The slice remains evaluation-only and performs no live external network call.
- All domain rows are firm- and matter-scoped; inaccessible tenant/confidential records return generic `404`.
- Entries, draft versions, approval decisions, provider events, attachment links, service assertions and audit history are immutable or append-only.
- `provider_accepted` never means delivered, read, served or legally effective.
- Protected-negotiation and privileged content never enters ordinary chronology, counts or payloads.
- External dispatch always requires `communications.send`, an explicit confirmation and an idempotency key.
- Sensitive dispatch additionally requires approval of the exact current draft version.
- Internal communications cannot have external recipients or be dispatched.
- Recording artifacts require notice/consent metadata and a stated basis.
- Provider credentials never enter the database, logs, audit records or API responses.
- No AI transcription, summarisation, drafting or automatic legal conclusion is included.

---

### Task 1: Canonical contracts and database migration

**Files:**
- Create: `src/server/migrations/007-communications.ts`
- Create: `src/server/communications/types.ts`
- Modify: `src/server/migrations/index.ts`
- Modify: `src/shared/contracts.ts`
- Modify: `src/server/migrations.test.ts`
- Create: `src/server/contracts.communications.test.ts`

**Interfaces:**
- Produces: `CommunicationChannel`, `CommunicationConfidentiality`, `CommunicationTransportState`, `CommunicationProvider`, all communication command schemas, and migration version `7`.
- Consumes: existing `Migration`, `document_versions`, `documents`, `firms`, `matters`, `users`, audit, timeline, domain-event and outbox tables.

- [ ] **Step 1: Write failing contract and migration tests**

```ts
it('rejects an internal draft with an external recipient', () => {
  expect(() => createCommunicationDraftSchema.parse({
    channel: 'internal', confidentiality: 'internal',
    participants: [{ role: 'to', displayName: 'Landlord', endpointType: 'email', endpoint: 'landlord@example.test' }],
    subject: 'Private note', body: 'Internal case analysis.', bodyFormat: 'plain', attachmentVersionIds: [],
  })).toThrow();
});

it('installs immutable communication records', () => {
  const db = createDatabase(':memory:');
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'communication_entries'").get()).toBeTruthy();
  expect(() => db.prepare('DELETE FROM communication_entries').run()).toThrow('communication_entries is append-only');
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- src/server/contracts.communications.test.ts src/server/migrations.test.ts`
Expected: FAIL because communication schemas and migration 7 do not exist.

- [ ] **Step 3: Add canonical types and Zod command contracts**

```ts
export type CommunicationChannel = 'email' | 'whatsapp' | 'telephone' | 'letter' | 'portal' | 'sms' | 'in_person' | 'internal';
export type CommunicationConfidentiality = 'ordinary' | 'internal' | 'privileged' | 'protected_negotiation';
export type CommunicationTransportState = 'recorded' | 'queued' | 'attempting' | 'provider_accepted' | 'delivered' | 'failed' | 'read' | 'cancelled';

export const dispatchCommunicationSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(200),
  providerKey: z.string().regex(/^[a-z][a-z0-9_-]*$/).max(80),
  confirmed: z.literal(true),
});
```

Define schemas for manual record, draft creation, draft version, submission, decision, dispatch, provider event and manual call. Derive exported input types with `z.infer`.

- [ ] **Step 4: Add migration 7 and register it**

```ts
export const communicationsMigration: Migration = {
  version: 7,
  name: 'communications',
  checksum: createHash('sha256').update(sql).digest('hex'),
  sql,
};
```

Create the tables specified in the approved design with composite firm/matter foreign keys, unique idempotency/replay constraints, query indexes and no-update/no-delete triggers on immutable tables. Keep mutable status only on draft and dispatch aggregate rows; retain every decision and transport change as an append-only event.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `npm test -- src/server/contracts.communications.test.ts src/server/migrations.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/contracts.ts src/server/contracts.communications.test.ts src/server/communications/types.ts src/server/migrations/007-communications.ts src/server/migrations/index.ts src/server/migrations.test.ts
git commit -m "feat: add governed communications schema"
```

### Task 2: Transport projection and provider boundary

**Files:**
- Create: `src/server/communications/provider.ts`
- Create: `src/server/communications/evaluation-provider.ts`
- Create: `src/server/communications/projection.ts`
- Create: `src/server/communications/provider.test.ts`
- Create: `src/server/communications/projection.test.ts`

**Interfaces:**
- Produces: `CommunicationProvider`, `EvaluationCommunicationProvider`, `projectTransportState(events)`, `ProviderDispatchCommand`, `ProviderDispatchResult`, `VerifiedProviderEvent`.
- Consumes: communication types from Task 1 only; no database or Fastify dependency.

- [ ] **Step 1: Write failing provider and projection tests**

```ts
it('does not promote provider acceptance to delivery', () => {
  expect(projectTransportState([
    event('queued'), event('attempting'), event('provider_accepted'),
  ])).toEqual({ state: 'provider_accepted', deliveredAt: null, readAt: null });
});

it('advertises unsupported calling without making a network call', async () => {
  const provider = new EvaluationCommunicationProvider(() => new Date('2026-07-16T09:00:00.000Z'));
  await expect(provider.capabilities()).resolves.toMatchObject({
    key: 'evaluation', operations: { send_email: true, send_whatsapp_message: true, start_whatsapp_call: false },
  });
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm test -- src/server/communications/provider.test.ts src/server/communications/projection.test.ts`
Expected: FAIL because provider and projection modules do not exist.

- [ ] **Step 3: Implement the provider port and deterministic adapter**

```ts
export interface CommunicationProvider {
  readonly key: string;
  capabilities(): Promise<CommunicationProviderCapabilities>;
  dispatch(command: ProviderDispatchCommand): Promise<ProviderDispatchResult>;
  verifyEvent(input: ProviderEventInput): Promise<VerifiedProviderEvent>;
}

export class EvaluationCommunicationProvider implements CommunicationProvider {
  readonly key = 'evaluation';
  async dispatch(command: ProviderDispatchCommand) {
    return { providerEventId: `evaluation:${command.idempotencyKey}`, type: 'provider_accepted' as const, occurredAt: this.now().toISOString(), externalMessageId: `eval-${command.dispatchId}` };
  }
}
```

Reject unsupported channels and calls with a typed `PROVIDER_CAPABILITY_UNAVAILABLE` error. Verification accepts only evaluation events carrying the configured deterministic signature and returns a safe canonical event.

- [ ] **Step 4: Implement monotonic, evidence-based projection**

```ts
export function projectTransportState(events: readonly TransportEvent[]): TransportProjection {
  const authenticated = events.filter((item) => item.authenticated);
  const last = [...authenticated].sort(compareOccurredReceived)[authenticated.length - 1];
  return foldTransportEvents(authenticated, last);
}
```

Failed does not erase a prior delivered/read event, read implies delivered evidence, unauthenticated events have no effect, and event time never alters entry occurrence time.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `npm test -- src/server/communications/provider.test.ts src/server/communications/projection.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/communications/provider.ts src/server/communications/evaluation-provider.ts src/server/communications/projection.ts src/server/communications/provider.test.ts src/server/communications/projection.test.ts
git commit -m "feat: add communication provider boundary"
```

### Task 3: Tenant-safe persistence and read model

**Files:**
- Create: `src/server/communications/store.ts`
- Create: `src/server/communications/store.test.ts`

**Interfaces:**
- Produces: `CommunicationStore.getWorkspace`, `recordEntry`, `createDraft`, `appendDraftVersion`, `recordApprovalEvent`, `createDispatch`, `recordProviderEvent`, `recordCall`, `getProviderDispatchCommand`.
- Consumes: migration tables, append helpers in `src/server/store.ts`, projection from Task 2 and `SessionUser`.

- [ ] **Step 1: Write failing store tests**

```ts
it('filters protected content before counts and chronology are assembled', () => {
  seedOrdinaryAndProtectedRecords(database);
  const ordinary = store.getWorkspace(paralegal, SEED_IDS.northstarMatter);
  expect(ordinary.entries).toHaveLength(1);
  expect(JSON.stringify(ordinary)).not.toContain('protected settlement position');
});

it('deduplicates provider events by firm, provider and event id', () => {
  const first = store.recordProviderEvent(user, matterId, dispatchId, providerEvent, audit);
  const replay = store.recordProviderEvent(user, matterId, dispatchId, providerEvent, audit);
  expect(replay).toEqual({ ...first, replayed: true });
  expect(countRows(database, 'communication_provider_events')).toBe(1);
});
```

- [ ] **Step 2: Run store tests and confirm RED**

Run: `npm test -- src/server/communications/store.test.ts`
Expected: FAIL because `CommunicationStore` does not exist.

- [ ] **Step 3: Implement scoped writes and operational records**

```ts
export class CommunicationStore {
  constructor(private readonly database: DatabaseSync, private readonly now: () => Date) {}
  recordEntry(user: SessionUser, matterId: string, input: RecordCommunicationInput, audit: AuditContext): CommunicationEntry;
  createDraft(user: SessionUser, matterId: string, input: CreateCommunicationDraftInput, audit: AuditContext): CommunicationDraft;
  recordProviderEvent(user: SessionUser, matterId: string, dispatchId: string, event: VerifiedProviderEvent, audit: AuditContext): ProviderEventResult;
}
```

Resolve every document version through `document_versions JOIN documents` constrained by firm and matter. Append redacted timeline/domain/outbox metadata for privileged/protected records. Transactions must include domain data, audit, chronology and outbox writes.

- [ ] **Step 4: Implement confidentiality-aware workspace assembly**

The single workspace query accepts an access mask derived from capabilities. It loads conversations, entries, participants, exact attachment provenance, calls, drafts and dispatch events only after confidentiality filtering. It returns counts derived from that filtered set and marks inaccessible records neither by ID nor count.

- [ ] **Step 5: Run store tests and confirm GREEN**

Run: `npm test -- src/server/communications/store.test.ts`
Expected: PASS for tenant scoping, immutable corrections, attachment links, draft versions, approval invalidation, idempotent dispatches/events and call consent.

- [ ] **Step 6: Commit**

```bash
git add src/server/communications/store.ts src/server/communications/store.test.ts
git commit -m "feat: persist governed communications"
```

### Task 4: Service invariants, permissions and HTTP API

**Files:**
- Create: `src/server/communications/service.ts`
- Create: `src/server/communications/service.test.ts`
- Create: `src/server/communications/routes.ts`
- Create: `src/server/communications/routes.test.ts`
- Modify: `src/server/policy.ts`
- Modify: `src/server/policy.test.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/app.test.ts`

**Interfaces:**
- Produces: `CommunicationService`, `communicationRoutes`, capability checks and all approved REST endpoints.
- Consumes: Task 1 schemas, Task 2 provider registry and Task 3 store.

- [ ] **Step 1: Write failing permission, service and route tests**

```ts
it('requires approval of the exact sensitive draft version', async () => {
  const approved = service.decide(partner, matterId, draftId, { draftVersionId: version1, decision: 'approved', note: 'Reviewed exact recipients and content.' }, audit);
  service.appendDraftVersion(solicitor, matterId, draftId, changedRecipients, audit);
  await expect(service.dispatch(solicitor, matterId, draftId, { expectedVersion: approved.version + 1, providerKey: 'evaluation', idempotencyKey: 'sensitive-v2-send', confirmed: true }, audit)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
});

it('conceals a protected conversation from an ordinary reader', async () => {
  const response = await app.inject({ method: 'GET', url: `/api/matters/${matterId}/communications`, headers: { cookie: paralegalCookie } });
  expect(response.statusCode).toBe(200);
  expect(response.body).not.toContain('protected settlement position');
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- src/server/policy.test.ts src/server/communications/service.test.ts src/server/communications/routes.test.ts src/server/app.test.ts`
Expected: FAIL because communication capabilities, service and routes do not exist.

- [ ] **Step 3: Add capabilities and service rules**

Add `communications.read`, `write`, `approve`, `send`, `read_privileged`, `read_protected`, `manage_provider` to `Capability`. Admin/partner receive all; solicitor receives read/write/send/privileged/protected, with approval limited to partner/admin in this evaluation role model; paralegal receives read/write; finance receives none; readonly receives ordinary read.

```ts
async dispatch(user: SessionUser, matterId: string, draftId: string, input: DispatchCommunicationInput, audit: AuditContext) {
  this.require(user, 'communications.send');
  const command = this.store.prepareDispatch(user, matterId, draftId, input, audit);
  const result = await this.providers.require(input.providerKey).dispatch(command);
  return this.store.recordDispatchResult(user, matterId, command.dispatchId, result, audit);
}
```

The service rejects unconfirmed sends, stale versions, unsupported channels, internal dispatch, mismatched recipients and missing exact-version sensitive approval.

- [ ] **Step 4: Register routes and map errors**

Implement every endpoint in the design. Parse all bodies with Zod. Map validation `400`, forbidden `403`, concealed/missing `404`, stale/idempotency conflict `409`, and successful evaluation dispatch `202`. Provider capabilities return booleans and reasons only.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `npm test -- src/server/policy.test.ts src/server/communications/service.test.ts src/server/communications/routes.test.ts src/server/app.test.ts`
Expected: PASS for ordinary access, finance denial, cross-firm concealment, protected filtering, approvals, explicit dispatch, replay and safe capability output.

- [ ] **Step 6: Commit**

```bash
git add src/server/policy.ts src/server/policy.test.ts src/server/app.ts src/server/app.test.ts src/server/communications/service.ts src/server/communications/service.test.ts src/server/communications/routes.ts src/server/communications/routes.test.ts
git commit -m "feat: expose governed communication commands"
```

### Task 5: Matter 360 Communications workspace

**Files:**
- Create: `src/client/components/matter/CommunicationsPanel.tsx`
- Create: `src/client/components/matter/CommunicationComposeDialog.tsx`
- Create: `src/client/components/matter/CommunicationCallDialog.tsx`
- Create: `src/client/components/matter/CommunicationsPanel.test.tsx`
- Modify: `src/client/api.ts`
- Modify: `src/client/pages/MatterPage.tsx`
- Modify: `src/client/components/matter/MatterSectionRail.tsx`
- Modify: `src/client/App.test.tsx`
- Modify: `src/client/styles.css`

**Interfaces:**
- Produces: accessible lazy-loaded Communications section, filters, conversation details, compose/approval/dispatch controls and manual call capture.
- Consumes: `CommunicationWorkspace` and approved routes from Task 4.

- [ ] **Step 1: Write failing UI tests**

```tsx
it('labels provider acceptance honestly and requires confirmation before dispatch', async () => {
  render(<CommunicationsPanel matterId="matter-1" workspace={workspace} onRefresh={vi.fn()} />);
  expect(screen.getByText('Accepted by provider')).toBeInTheDocument();
  expect(screen.queryByText('Delivered')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Dispatch approved draft' }));
  expect(screen.getByRole('dialog', { name: 'Confirm external dispatch' })).toBeInTheDocument();
});

it('shows WhatsApp Calling as unavailable with its capability reason', () => {
  render(<CommunicationsPanel matterId="matter-1" workspace={workspaceWithoutCalling} onRefresh={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Start WhatsApp call' })).toBeDisabled();
  expect(screen.getByText('Not enabled for the evaluation provider')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run UI tests and confirm RED**

Run: `npm test -- src/client/components/matter/CommunicationsPanel.test.tsx src/client/App.test.tsx`
Expected: FAIL because Communications is disabled and the panel does not exist.

- [ ] **Step 3: Add client types and lazy loading**

Add `CommunicationWorkspace` shapes to `src/client/api.ts`. In `MatterPage`, fetch `/api/matters/${matterId}/communications` only when `section === 'communications'`, with abort, retry and error states matching evidence/protocol/quantum sections. Enable the rail item.

- [ ] **Step 4: Implement the responsive ledger and thread view**

Render newest-first entries, exact participant endpoints, source/confidentiality/channel/direction badges, attachment version/hash provenance and transport wording. Filters are labelled controls and conversation rows are keyboard-operable buttons. Protected content is rendered only if present in the already-filtered response.

- [ ] **Step 5: Implement controlled compose and call dialogs**

Use existing `Dialog` and `request/jsonBody` helpers. Draft saving displays its immutable version. Sensitive drafts show submission/decision state. Dispatch opens a separate confirmation dialog and sends `confirmed: true` plus a generated idempotency key. Manual calls require identity and notice/consent fields before recording artifacts.

- [ ] **Step 6: Add compact/narrow styling and run UI tests**

Run: `npm test -- src/client/components/matter/CommunicationsPanel.test.tsx src/client/App.test.tsx`
Expected: PASS, including lazy loading, keyboard controls, honest status copy, confirmation and unsupported calling.

- [ ] **Step 7: Commit**

```bash
git add src/client/api.ts src/client/pages/MatterPage.tsx src/client/components/matter/MatterSectionRail.tsx src/client/components/matter/CommunicationsPanel.tsx src/client/components/matter/CommunicationComposeDialog.tsx src/client/components/matter/CommunicationCallDialog.tsx src/client/components/matter/CommunicationsPanel.test.tsx src/client/App.test.tsx src/client/styles.css
git commit -m "feat: add Matter 360 communications workspace"
```

### Task 6: Synthetic Maya communications journey

**Files:**
- Modify: `src/server/database.ts`
- Create: `src/server/communications/seed.test.ts`
- Modify: `README.md`
- Modify: `.env.example`

**Interfaces:**
- Produces: idempotent `seedCommunicationsEvaluation(database)` and documented evaluation-provider configuration.
- Consumes: `SEED_IDS`, existing Maya documents/evidence, `CommunicationService`, `CommunicationStore`, evaluation provider.

- [ ] **Step 1: Write the failing seed test**

```ts
it('seeds the complete Maya communication journey idempotently without transmission', async () => {
  seedCommunicationsEvaluation(database);
  seedCommunicationsEvaluation(database);
  const workspace = service.getWorkspace(ava, SEED_IDS.northstarMatter);
  expect(workspace.entries.map((item) => item.channel)).toEqual(expect.arrayContaining(['email', 'whatsapp', 'telephone', 'letter']));
  expect(workspace.entries.find((item) => item.channel === 'whatsapp')?.transport.state).toBe('provider_accepted');
  expect(countRows(database, 'communication_dispatches')).toBe(1);
});
```

- [ ] **Step 2: Run the seed test and confirm RED**

Run: `npm test -- src/server/communications/seed.test.ts`
Expected: FAIL because the communications seed does not exist.

- [ ] **Step 3: Seed the approved synthetic records**

Create the inbound landlord-solicitor email and attachment, evaluation-accepted WhatsApp appointment message, manual phone call, letter plus unreviewed service assertion, privileged internal note and protected draft awaiting approval. Use stable IDs/idempotency keys. Do not invoke a live network adapter.

- [ ] **Step 4: Document safe configuration and run seed test**

Document `COMMUNICATION_PROVIDER=evaluation` and state that Graph/Meta credentials are unsupported in this slice. Run: `npm test -- src/server/communications/seed.test.ts`
Expected: PASS with one record per stable seed key.

- [ ] **Step 5: Commit**

```bash
git add src/server/database.ts src/server/communications/seed.test.ts README.md .env.example
git commit -m "feat: seed communications pilot journey"
```

### Task 7: Full verification and integration readiness

**Files:**
- No planned source changes. A failure returns execution to the task that owns the affected file, where the correction is tested and committed before verification resumes.

**Interfaces:**
- Produces: a clean feature branch ready for review and merge.
- Consumes: all prior tasks.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`
Expected: all tests PASS with zero failures.

- [ ] **Step 2: Run static and production verification**

Run: `npm run typecheck`
Expected: both client and server TypeScript checks PASS.

Run: `npm run build`
Expected: server compilation and Vite production build PASS.

Run: `npm audit --omit=dev`
Expected: zero production vulnerabilities.

- [ ] **Step 3: Run a fresh production HTTP journey**

Start the built server against a fresh temporary database with evaluation seed enabled. Verify:

```text
GET ordinary communications                 200
GET as finance                              403
GET cross-firm                              404
ordinary response contains protected text   false
approved evaluation dispatch                202 provider_accepted
replayed provider event duplicate count     0
manual call identity confirmed              true
WhatsApp Calling capability                 false
```

- [ ] **Step 4: Run browser verification or record the supported fallback**

Run `agent-browser --version`. If it succeeds, use the browser verifier against the production build and exercise section loading, filtering, thread selection, compose, confirmation, manual call and a 390-pixel viewport. If it exits with command-not-found, record that exact limitation in the handoff and rely on the passing Testing Library tests plus production HTTP journey.

- [ ] **Step 5: Review the diff for confidentiality and scope**

Run: `git diff --check origin/main...HEAD` and `git status --short`.
Expected: no whitespace errors, secrets, generated databases, recordings or unrelated SwiftBridge work.
