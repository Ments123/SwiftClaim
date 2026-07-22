# Matter Closure & Reopening release verification

Date: 22 July 2026

Base: `origin/main` at `733bce48cf6ea9aaa3cb68d04502ce7c9cbdfa2a`

Feature head before the final milestone commit: `462da071c25b72651eaad3093624bb323cbbf64b`

Branch: `feat/matter-closure-reopening`

## Verified scope

This milestone provides a governed route from an active matter through objective readiness review, final client reporting, independent approval, closure, read-only archived operation, retention/legal-hold control and authorised reopening. Closure is never a direct status toggle, and reopening does not rewrite the original closure history.

The release review covered:

- authoritative client-money, issued-bill, task, deadline and settlement-obligation blockers;
- exact issued-credit-note and posted-payment treatment in office balances;
- controlled residual obligations with a named active owner, future due date and retained source blocker;
- exact final client report version, outcome, closure reason, lessons, document position and retention basis;
- independent solicitor preparation and partner/admin approval;
- transactional freshness checks at preparation, approval and final closure;
- stable idempotency for successful and blocked commands;
- tenant-scoped reads and generic cross-tenant `404` behaviour;
- central read-only enforcement across legacy matter mutation routes;
- immutable reviews, blockers, events, active periods, obligations, schedules and legal-hold evidence;
- exact audit and outbox entity identifiers;
- separately lazy-loaded Matter 360 closure panel and dialogs; and
- absence of automatic destruction, data deletion, autonomous authority and Legal Costs behaviour.

## Defects found and corrected during release review

1. Residual transfers accepted invented or duplicate blocker keys. The classifier now requires one exact transfer for one authoritative transferable blocker.
2. Failed closure preparation was rejected but not retained. Blocked attempts now append an immutable event, audit record, timeline record and outbox message.
3. A blocked idempotency key could later succeed after the underlying facts changed. The original key now deterministically replays the blocked outcome; a materially new attempt requires a new key.
4. Retention and transferred-obligation dates could already be expired. Preparation now requires future dates, and final closure rechecks them so a once-valid approval cannot become stale unnoticed.
5. Closure debt ignored issued credit notes and could falsely block a fully credited bill. The balance now subtracts only immutable issued credits and validates every minor-unit value with safe-integer arithmetic.
6. Blocked, reopened and legal-hold audit records were labelled as closure reviews. Audit, timeline and outbox evidence now identifies the exact closure event or legal hold.
7. Service methods relied on route validation for the explicit-human-authority flag. Every decision service now independently rechecks that authority boundary.
8. The canonical migration-ledger assertion ended at version 13. It now records checksummed migration 14 explicitly.

Each behavioural defect was reproduced by a failing test before the production correction.

## Automated evidence

Command:

```text
npm test
```

Result:

```text
Test Files  117 passed (117)
Tests       551 passed (551)
Duration    17.93s
```

Command:

```text
npm run typecheck && npm run build && git diff --check
```

Result: both TypeScript targets passed, the Vite production build completed after transforming 1,829 modules, and the diff whitespace check passed.

Relevant production chunks:

| Asset | Raw | Gzip |
|---|---:|---:|
| `ClosurePanel` | 9.58 kB | 2.66 kB |
| `ClosureDialogs` | 6.09 kB | 1.99 kB |
| Main client entry | 492.62 kB | 118.89 kB |
| Client CSS | 134.42 kB | 23.00 kB |

The closure panel and its command dialogs remain separately lazy-loaded from unrelated Matter 360 functionality.

## Evaluation journey

The rerunnable Northstar journey is executed twice and proves stable row counts and operational state. It retains:

- an initial closure attempt blocked by an open document-return task;
- a later review that converts only that eligible residual task into a named, dated post-closure obligation;
- the exact sent final client report version and retention evidence;
- independent partner approval and a second transactional readiness check at closure;
- a completed first active period and read-only closed state;
- a legal hold suspending destruction eligibility without deleting any record; and
- an authorised reopening with a reason and new responsible owner, while preserving the original closure period and event history.

## Security and records conclusions

- Critical client money, office debt, court deadlines and settlement obligations cannot be transferred or overridden.
- Explicit undertaking and complaint attestations remain human declarations because SwiftClaim does not yet contain full undertaking or complaints registers; the exact attestation and actor are retained.
- Closed matters stay searchable and readable to authorised users, while ordinary writes fail at the common authenticated mutation boundary.
- Reopening requires partner/admin capability, a substantive reason, an active same-firm owner and explicit human authority.
- Legal holds are append-only and suspend destruction eligibility. This milestone has no destruction job, delete command or automatic purge.
- Command receipts bind idempotency keys to canonical payload hashes and reject changed-payload reuse.
- All closure SQL reads and writes include firm and matter scope; cross-tenant references receive the same generic not-found response.
- The evaluation report document uses deterministic metadata for tests. Production report downloads continue to require an exact stored document version through the existing secured document path.

## Release boundary and limitations

This remains an evaluation/pilot implementation. It does not replace solicitor, supervisor, COLP, COFA, records-management, privacy, security, backup, disaster-recovery or regulatory review.

No automated destruction is implemented. Retention schedules express eligibility only, and any active legal hold suspends it. Undertaking and complaint clearance are explicit retained attestations until dedicated source registers exist.

The dedicated Legal Costs module is outside this milestone and has not been started. It requires separate user approval after this closure release is accepted.
