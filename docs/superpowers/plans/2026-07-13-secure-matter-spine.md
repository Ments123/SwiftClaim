# Secure Matter Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a runnable SwiftClaim Litigation vertical slice with secure tenant isolation, matter-level permissions, matters, parties, deadlines, immutable documents, timeline, and append-only audit.

**Architecture:** A TypeScript modular monolith exposes a Fastify API and serves a React/Vite client. Node SQLite is the development persistence adapter, filesystem storage is private behind authorised download routes, and all tenant access is derived from the authenticated session.

**Tech Stack:** Node 24, TypeScript 5, Fastify 5, Node SQLite, Zod, React 19, Vite, Vitest, Testing Library, native Node crypto.

## Global Constraints

- The product name in user-facing copy is `SwiftClaim Litigation`.
- The GitHub target is the private repository `Ments123/SwiftClaim`.
- Every tenant-owned query includes a server-derived `firm_id` predicate.
- Audit records are append-only and protected from SQL update and delete by triggers.
- Uploaded files are limited to 25 MiB and stored outside the public web root.
- Existing document bytes and document-version rows are immutable.
- All external-system identifiers are compatibility metadata and never primary keys.
- AI, calling, billing, OCR, and the SwiftBridge migration engine are outside Step 1.

---

## File map

| Path | Responsibility |
|---|---|
| `package.json` | Commands and pinned runtime dependencies |
| `tsconfig.json` | Shared strict TypeScript rules |
| `tsconfig.server.json` | Server production build |
| `vite.config.ts` | Web build and development API proxy |
| `vitest.config.ts` | Node and browser test projects |
| `src/shared/contracts.ts` | Zod request/response schemas and shared types |
| `src/server/database.ts` | SQLite creation, migrations, transactions, and seed data |
| `src/server/security.ts` | Password hashes, session tokens, cookies, and authentication |
| `src/server/policy.ts` | Firm roles and matter permission decisions |
| `src/server/store.ts` | Tenant-scoped SQL repository and append-only activity writes |
| `src/server/storage.ts` | Immutable local file storage and SHA-256 calculation |
| `src/server/app.ts` | Fastify plugins, error mapping, and route handlers |
| `src/server/index.ts` | Runtime configuration, startup, and shutdown |
| `src/server/app.test.ts` | API acceptance and tenant-isolation tests |
| `src/server/audit.test.ts` | Database-level append-only tests |
| `src/client/api.ts` | Typed fetch wrapper and API errors |
| `src/client/App.tsx` | Session state and page routing |
| `src/client/components/AppShell.tsx` | Responsive global navigation and search |
| `src/client/components/Dialog.tsx` | Accessible mutation dialog primitive |
| `src/client/pages/LoginPage.tsx` | Sign-in experience and demo access |
| `src/client/pages/DashboardPage.tsx` | Work dashboard and accessible matters |
| `src/client/pages/MatterPage.tsx` | Matter aggregate, tabs, and mutations |
| `src/client/styles.css` | Design tokens, layout, states, and responsive rules |
| `src/client/main.tsx` | React entry point |
| `src/client/App.test.tsx` | Authentication and dashboard rendering tests |
| `README.md` | Setup, credentials, architecture, tests, and safety boundary |

### Task 1: Project foundation and executable test harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.server.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `index.html`
- Create: `.gitignore`

**Interfaces:**
- Produces: `npm test`, `npm run typecheck`, `npm run build`, `npm run dev`, and `npm start`.

- [ ] **Step 1: Create configuration with strict compilation and two test environments**

Use ESM, Node 24 or newer, a server test project matching `src/server/**/*.test.ts`, and a jsdom client project matching `src/client/**/*.test.tsx`. Configure Vite to proxy `/api` to `http://127.0.0.1:4100` and emit the client into `dist/client`.

- [ ] **Step 2: Install dependencies**

Run:

```bash
npm install
```

Expected: exit code `0` and a generated `package-lock.json`.

- [ ] **Step 3: Verify the empty test harness**

Run:

```bash
npm test -- --passWithNoTests
```

Expected: exit code `0` with no tests found.

- [ ] **Step 4: Initialise Git and commit the foundation**

```bash
git init -b main
git add package.json package-lock.json tsconfig.json tsconfig.server.json vite.config.ts vitest.config.ts index.html .gitignore docs
git commit -m "chore: initialise SwiftClaim"
```

Expected: one root commit on `main`.

### Task 2: Authentication, tenant context, and policy

**Files:**
- Create: `src/shared/contracts.ts`
- Create: `src/server/database.ts`
- Create: `src/server/security.ts`
- Create: `src/server/policy.ts`
- Create: `src/server/app.test.ts`

**Interfaces:**
- Produces: `createDatabase(path: string): DatabaseSync`, `seedDatabase(db): void`, `buildApp(options): FastifyInstance`, `SessionUser`, `canCreateMatter(user)`, `canReadMatter(user, matter)` and `canWriteMatter(user, matter)`.
- Consumes: Node `crypto`, Node `sqlite`, and Zod.

- [ ] **Step 1: Write the failing authentication and isolation tests**

Create fixtures that initialise a fresh temporary database and seed two firms. Exercise real Fastify injection and cookies:

```ts
it('creates a revocable HTTP-only session for valid credentials', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'ava@northstar.test', password: 'SwiftClaim!2026' },
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers['set-cookie']).toContain('HttpOnly');
  expect(response.json().user.email).toBe('ava@northstar.test');
});

it('returns 404 instead of disclosing another firm matter', async () => {
  const cookie = await login(app, 'ava@northstar.test');
  const response = await app.inject({
    method: 'GET',
    url: `/api/matters/${seedIds.southbankMatter}`,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(404);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run src/server/app.test.ts
```

Expected: failure because `buildApp` and the schema do not exist.

- [ ] **Step 3: Implement the schema and security primitives**

Create all canonical tables from the design, foreign keys, scoped unique indexes, and the audit protection triggers. Implement scrypt hashes in the encoded form `scrypt$<salt-hex>$<hash-hex>`, 32-byte random session tokens, stored SHA-256 token hashes, and server-derived `SessionUser` values.

The policy surface is:

```ts
export type FirmRole = 'admin' | 'partner' | 'solicitor' | 'paralegal' | 'finance' | 'readonly';

export interface SessionUser {
  id: string;
  firmId: string;
  firmName: string;
  email: string;
  name: string;
  role: FirmRole;
}

export const canCreateMatter = (user: SessionUser) =>
  user.role === 'admin' || user.role === 'partner';
```

Implement login, logout, `/api/me`, expiry cleanup, cookie flags, generic invalid-credential errors, and `404` for inaccessible resources.

- [ ] **Step 4: Run authentication tests and verify GREEN**

Run:

```bash
npx vitest run src/server/app.test.ts
```

Expected: all authentication and cross-tenant tests pass.

- [ ] **Step 5: Commit the security boundary**

```bash
git add src/shared src/server package.json package-lock.json
git commit -m "feat: add secure tenant authentication"
```

### Task 3: Matter aggregate, membership, timeline, and audit

**Files:**
- Create: `src/server/store.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/app.test.ts`
- Create: `src/server/audit.test.ts`

**Interfaces:**
- Produces: `listMatters(ctx)`, `getMatterAggregate(ctx, id)`, `createMatter(ctx, input)`, `appendTimeline(tx, event)`, and `appendAudit(tx, event)`.
- Consumes: authenticated `SessionUser` and Zod `createMatterSchema`.

- [ ] **Step 1: Write failing matter permission and audit tests**

```ts
it('creates a matter, owner membership, timeline entry, and audit row atomically', async () => {
  const cookie = await login(app, 'partner@northstar.test');
  const response = await app.inject({
    method: 'POST',
    url: '/api/matters',
    headers: { cookie },
    payload: {
      reference: 'LIT-2026-0042',
      title: 'Ahmed v Orion Logistics',
      clientName: 'Samira Ahmed',
      matterType: 'Commercial dispute',
      stage: 'Pre-action',
      riskLevel: 'medium',
      ownerUserId: seedIds.ava,
      description: 'Contract and loss dispute.',
    },
  });
  expect(response.statusCode).toBe(201);
  expect(response.json().timeline[0].type).toBe('matter.created');
  expect(response.json().audit[0].action).toBe('matter.created');
});

it('rejects direct changes to an audit row', () => {
  expect(() => db.exec("UPDATE audit_events SET action = 'changed'")).toThrow(/append-only/);
  expect(() => db.exec('DELETE FROM audit_events')).toThrow(/append-only/);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx vitest run src/server/app.test.ts src/server/audit.test.ts
```

Expected: failures because matter repositories and audit triggers are not yet wired.

- [ ] **Step 3: Implement transactional matter creation and scoped reads**

All SQL methods accept a context containing `userId`, `firmId`, and role. Administrative readers filter on `m.firm_id = ?`; matter-scoped workers additionally require owner or membership. Create the matter, owner membership, first timeline row, and audit row in one SQLite transaction. Map reference conflicts to HTTP `409`.

- [ ] **Step 4: Implement dashboard and matter endpoints**

Add accessible-matter listing, aggregate retrieval, dashboard counts, overdue and due-soon task calculations, recent matters, and server-side query filtering by reference, title, client, or owner.

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```bash
npx vitest run src/server/app.test.ts src/server/audit.test.ts
```

Expected: matter creation, membership, tenant isolation, and append-only tests pass.

- [ ] **Step 6: Commit the matter spine**

```bash
git add src/server src/shared
git commit -m "feat: add matter spine and audit trail"
```

### Task 4: Parties, deadlines, and immutable documents

**Files:**
- Create: `src/server/storage.ts`
- Modify: `src/server/store.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/app.test.ts`

**Interfaces:**
- Produces: `addParty`, `addTask`, `updateTask`, `storeDocument`, and authorised document download.
- Consumes: accessible matter context and multipart file streams.

- [ ] **Step 1: Write failing child-resource tests**

Test a same-firm member adding a party, assignment rejection for a user in another firm, task completion chronology, document hash calculation, byte-for-byte download, 25 MiB rejection, and cross-tenant download returning `404`.

```ts
it('stores an immutable document version with a SHA-256 digest', async () => {
  const cookie = await login(app, 'ava@northstar.test');
  const body = multipartFile('evidence.txt', 'text/plain', Buffer.from('signed evidence'));
  const response = await app.inject({
    method: 'POST',
    url: `/api/matters/${seedIds.northstarMatter}/documents`,
    headers: { cookie, ...body.headers },
    payload: body.payload,
  });
  expect(response.statusCode).toBe(201);
  expect(response.json().latestVersion.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(response.json().latestVersion.version).toBe(1);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run src/server/app.test.ts -t "party|task|document"
```

Expected: failures because the child-resource routes are absent.

- [ ] **Step 3: Implement parties and tasks**

Validate party kind, names, emails, task due times, priority, and same-firm assignees. Write the mutation and its timeline/audit records transactionally. Allow task status transitions among `open`, `in_progress`, `completed`, and `cancelled`; set `completed_at` only for `completed`.

- [ ] **Step 4: Implement private immutable file storage**

Generate storage keys from random UUIDs, stream bytes to a temporary file, calculate SHA-256 while writing, atomically rename after success, and remove the temporary file on failure. Do not join paths using the upload's original name. Serve downloads only after matter authorisation.

- [ ] **Step 5: Run the API suite and verify GREEN**

Run:

```bash
npm test -- --project server
```

Expected: all server tests pass with no leaked temporary files.

- [ ] **Step 6: Commit the working matter operations**

```bash
git add src/server src/shared
git commit -m "feat: add matter people tasks and documents"
```

### Task 5: Responsive SwiftClaim Litigation client

**Files:**
- Create: `src/client/api.ts`
- Create: `src/client/App.tsx`
- Create: `src/client/components/AppShell.tsx`
- Create: `src/client/components/Dialog.tsx`
- Create: `src/client/pages/LoginPage.tsx`
- Create: `src/client/pages/DashboardPage.tsx`
- Create: `src/client/pages/MatterPage.tsx`
- Create: `src/client/main.tsx`
- Create: `src/client/styles.css`
- Create: `src/client/App.test.tsx`

**Interfaces:**
- Produces: login, dashboard, search, matter creation, party creation, task creation/completion, and document upload user flows.
- Consumes: the `/api` contracts from Tasks 2 through 4.

- [ ] **Step 1: Write failing client behaviour tests**

```tsx
it('shows urgent work and opens an accessible matter', async () => {
  server.use(http.get('/api/me', () => HttpResponse.json(meFixture)));
  server.use(http.get('/api/dashboard', () => HttpResponse.json(dashboardFixture)));
  render(<App />);
  expect(await screen.findByRole('heading', { name: /good morning, ava/i })).toBeVisible();
  await userEvent.click(screen.getByText('NCL-2026-0017'));
  expect(await screen.findByRole('heading', { name: /clarke v meridian/i })).toBeVisible();
});
```

Add tests for a failed login, empty search, mutation error, and keyboard-accessible dialog dismissal.

- [ ] **Step 2: Run the client test and verify RED**

Run:

```bash
npx vitest run --project client
```

Expected: failure because the React application is absent.

- [ ] **Step 3: Implement session and API state**

Create a typed `request<T>()` wrapper that always includes credentials, parses the shared error shape, and exposes status and field errors. Load `/api/me` once, show a deliberate loading state, and route unauthenticated users to login.

- [ ] **Step 4: Implement the dashboard and shell**

Build semantic navigation, responsive mobile controls, accessible search, work counts, urgent deadline rows, matter cards, and a create-matter dialog. Use real server data, visible focus rings, text labels in addition to icons, and CSS tokens from the design.

- [ ] **Step 5: Implement the matter workspace**

Render the aggregate header and tabbed sections. Provide validated forms for party and task creation, task status updates, and multipart document upload. Refresh the aggregate after a successful mutation and surface server failures beside the initiating control.

- [ ] **Step 6: Run client tests and verify GREEN**

Run:

```bash
npx vitest run --project client
```

Expected: all client behaviour tests pass.

- [ ] **Step 7: Commit the client**

```bash
git add index.html src/client
git commit -m "feat: add litigation workspace interface"
```

### Task 6: Runtime, documentation, and end-to-end verification

**Files:**
- Create: `src/server/index.ts`
- Create: `README.md`
- Create: `.env.example`
- Modify: `package.json`

**Interfaces:**
- Produces: local production server on `PORT`, seeded database at `DATA_DIR`, and clear operator instructions.
- Consumes: built client assets and the complete API.

- [ ] **Step 1: Write a failing production smoke test**

Extend the server suite to assert `/api/health` returns only `{ "status": "ok" }` and that an unknown API route returns the standard error shape without a stack trace.

- [ ] **Step 2: Run the smoke test and verify RED**

Run:

```bash
npx vitest run src/server/app.test.ts -t "health|unknown"
```

Expected: failure until the runtime error boundary is implemented.

- [ ] **Step 3: Implement startup and operator documentation**

Read `PORT`, `HOST`, `DATA_DIR`, `DATABASE_PATH`, `STORAGE_PATH`, and `NODE_ENV`; create directories safely; run migrations and idempotent seed data; serve `dist/client`; close the database on `SIGINT` and `SIGTERM`. Document installation, development, tests, production build, seeded users, architecture, data reset, and the live-data safety boundary.

- [ ] **Step 4: Run the complete automated verification**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: all commands exit `0` with no test failures or TypeScript errors.

- [ ] **Step 5: Run browser verification**

Start the production server with an isolated data directory, sign in as Ava, open the seeded matter, add a task, complete it, add a party, upload a text document, download it, reload, and confirm persistence. Check the login, dashboard, and matter workspace at desktop and mobile widths and inspect the browser console for errors.

- [ ] **Step 6: Commit the verified release**

```bash
git add .
git commit -m "docs: complete Step 1 operating guide"
git status -sb
```

Expected: a clean `main` branch.

- [ ] **Step 7: Publish to GitHub**

After the blank private repository exists and is available to the installed GitHub app, set `origin` to `https://github.com/Ments123/SwiftClaim.git`, push `main`, and verify the remote commit and file tree. Do not publish test databases, uploaded files, environment secrets, or dependency directories.
