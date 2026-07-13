# SwiftClaim Step 1: Secure Matter Spine

## Outcome

Build the first usable vertical slice of SwiftClaim Litigation around the safest and most durable unit in a legal practice: the matter record. A test firm can sign in, see only the matters they are entitled to see, create and work a matter, add people, control deadlines, preserve documents, and inspect a chronological and immutable record of activity.

This is not a visual prototype. Every visible action uses a real API and a durable local SQLite database. The same service boundaries can later move to PostgreSQL and object storage without changing the web application contracts.

## Product boundary

Step 1 includes:

- firm, user, role, and matter-level access control;
- secure session authentication;
- a litigation dashboard and matter workspace;
- matters with reference, type, stage, status, risk, owner, and migration identifiers;
- parties and their role in a matter;
- tasks and deadlines with assignment, priority, and completion state;
- a version-ready document register with immutable file versions and SHA-256 hashes;
- a chronological matter timeline;
- an append-only audit trail;
- seeded demonstration firms and users for evaluation;
- automated security, domain, API, and build checks.

Step 1 intentionally excludes AI generation, WhatsApp calling, billing, court integrations, workflow design, email sync, OCR, and full Proclaim migration. Those systems depend on this matter spine and should not define it.

## Users and access model

The initial roles are `admin`, `partner`, `solicitor`, `paralegal`, `finance`, and `readonly`.

- An `admin` or `partner` can see every matter in their firm and create matters.
- A `solicitor` or `paralegal` can see a matter only when they own it or have a row in `matter_members`.
- A `finance` or `readonly` user has read-only access to firm matters in Step 1.
- A user can never supply or override their firm identifier. The server derives it from the session.
- A resource outside the user's firm or matter access is returned as `404`, preventing existence disclosure.

## Core workflows

### Sign in

The user submits email and password. The server verifies a scrypt password hash, stores only a hash of a random session token, and sends the raw token in an HTTP-only, same-site cookie. Production cookies are secure. Logout revokes the database session.

### Open a matter

An authorised user enters the reference, title, client, matter type, owner, stage, risk, description, and optional legacy identifiers. The server creates the matter and owner membership in one transaction, appends a matter timeline event, and appends an audit event.

### Work a matter

The matter workspace loads a single aggregate containing the matter header, parties, tasks, documents, timeline, and audit history. Mutations update only the intended entity and append both a human-readable timeline event and a machine-auditable event where appropriate.

### Preserve a document

An authorised user uploads a file of at most 25 MiB. The server streams it to non-public storage, calculates SHA-256, inserts an immutable document-version row, and records activity and audit entries. A future upload for the same logical document creates a new version; it never mutates stored bytes or an existing version row.

## Canonical data model

Every tenant-owned table contains `firm_id`, even when it is derivable through another relation. This allows explicit tenant predicates, safer indexes, and later PostgreSQL row-level security.

| Entity | Purpose | Important invariants |
|---|---|---|
| `firms` | Tenant boundary | Stable UUID |
| `users` | Identity and firm role | Email is normalised; password is never stored |
| `sessions` | Revocable login | Only token hash is stored; expiry is enforced |
| `matters` | Canonical litigation record | Reference unique per firm; firm never changes |
| `matter_members` | Matter-level access | Unique user/matter pair; same-firm only |
| `parties` | Client, opponent, expert, court, insurer, witness | Belongs to exactly one matter and firm |
| `tasks` | Work and deadlines | Assignee must belong to the matter's firm |
| `documents` | Logical document identity | Belongs to exactly one matter and firm |
| `document_versions` | Immutable file evidence | Unique version per document; bytes addressed by random storage key and hash |
| `timeline_events` | Human chronology | Append-only through application API |
| `audit_events` | Evidential change history | Database triggers reject update and delete |

All migrated entities can retain `external_source`, `external_id`, and `import_batch_id`. These fields are non-authoritative compatibility metadata and do not replace SwiftClaim IDs.

## API contracts

All JSON endpoints live below `/api`. Mutations accept Zod-validated payloads and use a consistent error shape: `{ "error": { "code": string, "message": string, "fields"?: object } }`.

| Method | Route | Permission | Result |
|---|---|---|---|
| `POST` | `/api/auth/login` | Public, rate-limited | Session and current user |
| `POST` | `/api/auth/logout` | Signed in | Revokes session |
| `GET` | `/api/me` | Signed in | User, firm, and permissions |
| `GET` | `/api/dashboard` | Matter read | Counts, urgent tasks, recent matters |
| `GET` | `/api/matters` | Matter read | Accessible matter summaries |
| `POST` | `/api/matters` | Matter create | New matter and activity |
| `GET` | `/api/matters/:id` | Matter read | Full matter workspace aggregate |
| `POST` | `/api/matters/:id/parties` | Matter write | New party and activity |
| `POST` | `/api/matters/:id/tasks` | Matter write | New task and activity |
| `PATCH` | `/api/matters/:id/tasks/:taskId` | Matter write | Updated task and activity |
| `POST` | `/api/matters/:id/documents` | Matter write | Logical document and first immutable version |
| `GET` | `/api/matters/:id/documents/:documentId/download` | Matter read | Authorised file stream |
| `GET` | `/api/health` | Public | Liveness only; no internal data |

## Interface

The application is desktop-first but usable on tablets and phones. Its visual language is restrained legal operations software: warm off-white canvas, deep ink navigation, cobalt action colour, emerald success, amber deadline warnings, compact information density, generous whitespace, and no decorative gradients.

The signed-in shell contains:

- persistent navigation for Today, Matters, Documents, and Administration;
- firm identity and current user;
- global matter search;
- a dashboard focused on urgent work rather than vanity metrics;
- matter cards with reference, client, stage, owner, next deadline, and risk;
- a matter workspace with overview, people, documents, tasks, activity, and audit sections;
- clear empty, loading, error, success, and permission states.

## Security and evidential controls

- Tenant predicates are mandatory in every repository query.
- Matter authorisation runs before child-resource lookup.
- Login is rate-limited and uses constant-time password verification through Node crypto.
- Session tokens are 256-bit random values; only SHA-256 token hashes are stored.
- Cookies are HTTP-only, same-site `lax`, path-limited, and secure in production.
- Mutation payloads are schema-validated and SQL is parameterised.
- Uploaded names never become filesystem paths.
- File downloads require a live session and matter access.
- Upload size is capped at 25 MiB and the stored hash is returned in metadata.
- Audit records include actor, action, entity, before/after JSON, request ID, IP, and timestamp.
- Audit rows cannot be updated or deleted, including through direct SQL.
- Error responses do not expose stack traces or cross-tenant existence.

## Migration seams

The schema is designed for SwiftBridge without implementing the migration engine in Step 1:

- core records retain source system and source identifier;
- import batches can group and reconcile transferred data;
- document hashes allow byte-level reconciliation;
- stable SwiftClaim UUIDs prevent future source IDs becoming primary keys;
- audit events can identify imported versus user-created records;
- the API can later expose idempotent upsert endpoints keyed by source and source ID.

## Acceptance criteria

1. A seeded user can sign in and reload without losing the session.
2. A user never sees another firm's matter, even by guessing its UUID.
3. A solicitor without membership cannot see a same-firm restricted matter.
4. An authorised partner can create a matter and immediately see matching timeline and audit entries.
5. A matter worker can add a party, create and complete a task, and see each action in the chronology.
6. A document upload produces an immutable version with size and SHA-256 metadata and can be downloaded only by an authorised user.
7. Direct update or deletion of an audit row fails at the database layer.
8. The dashboard and matter workspace are responsive and contain no mocked interaction.
9. `npm test`, `npm run typecheck`, and `npm run build` pass from a clean checkout.
10. The repository contains setup instructions, seeded credentials, architecture notes, and a production-hardening boundary.

## Deployment boundary

The development build uses Node's SQLite driver and local private file storage so the test client can run it with one command. Before processing live client data, the deployment must use managed PostgreSQL, encrypted object storage, managed secrets, encrypted backups, centralised audit export, SSO/MFA, malware scanning, retention policies, monitoring, penetration testing, and the firm's documented regulatory controls.
