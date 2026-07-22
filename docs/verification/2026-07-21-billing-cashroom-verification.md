# Billing & Cashroom release verification

Date: 22 July 2026

Base: `origin/main` at `858253cbee7b0db6d9c77f429c40b2b5f0e5cab4`

Feature head before the release-review commit: `68c49d0c7c0400463f996d98aace5ae491cfaf76`

Branch: `feat/billing-cashroom`

## Verified scope

This milestone provides one governed route from approved WIP and disbursements to an issued bill, receipt allocation, controlled client-money movements, bank-statement evidence, reconciliation, Matter 360 billing and a firm Cashroom workspace. It does not connect to a bank or initiate a payment.

The release review covered:

- safe-integer minor-unit arithmetic, VAT snapshots and exact bill totals;
- client, office and suspense account combinations;
- exact firm, matter and client foreign keys and balance sufficiency;
- bill, payment, transfer, credit-note and reconciliation maker-checker paths;
- command idempotency and changed-payload rejection;
- tenant-scoped reads and generic cross-tenant `404` behaviour;
- exact-version finance document grants;
- CSV formula-injection protection and retained export checksums;
- privacy-safe timeline, audit, domain-event and outbox payloads;
- append-only/immutable database triggers and reversal-only corrections; and
- React structure, hook dependencies, semantic controls, keyboard operation, focus restoration and lazy route/dialog loading.

## Defects found and corrected during release review

1. Reconciliation arithmetic validated only the final result. An intermediate value could exceed JavaScript's safe-integer range, lose a minor unit and later return to an apparently safe value. The calculation now validates every addition and subtraction, with a regression at `Number.MAX_SAFE_INTEGER`.
2. A retained statement match previously required only a posted journal in the firm. It now requires a distinct journal with the exact signed movement on the reconciled bank account's linked ledger, rejects amount mismatches, rejects reuse against that bank account and validates split totals without unsafe intermediate arithmetic.

Both defects were reproduced with failing tests before the production changes were made.

## Automated evidence

Command:

```text
npm test -- --run
```

Result:

```text
Test Files  110 passed (110)
Tests       527 passed (527)
Duration    16.64s
```

Command:

```text
npm run typecheck && npm run build
```

Result: both TypeScript targets passed and the Vite production build completed successfully after transforming 1,827 modules.

Relevant production chunks:

| Asset | Raw | Gzip |
|---|---:|---:|
| `CashroomPage` | 11.43 kB | 3.15 kB |
| `CashroomDialogs` | 1.77 kB | 0.89 kB |
| `BillingPanel` | 11.81 kB | 3.25 kB |
| `BillingDialogs` | 5.39 kB | 2.04 kB |
| Main client entry | 491.32 kB | 118.51 kB |
| Client CSS | 132.02 kB | 22.59 kB |

The Billing and Cashroom pages and their command dialogs remain separately lazy-loaded.

## Production-server check

The exact built server was started with synthetic evaluation data and checked over HTTP. The client shell returned `200 OK` with the security-header set, finance authentication succeeded, and the authenticated Cashroom projection returned:

- access granted only to the finance user;
- bill `SC-2026-000001`;
- masked account identifier `****5678`;
- a signed-off reconciliation;
- £1,007 issued, £407 outstanding and £150 unallocated in suspense; and
- one blocking financial exception.

The available browser verifier could not run in this filesystem sandbox because its local daemon was prohibited from binding a socket (`Operation not permitted`). No visual browser pass is claimed. Desktop/mobile behaviour remains covered by the responsive component tests, semantic UI tests, TypeScript gate and production HTTP check.

## Accounting and security conclusions

- Imported or manually recorded bank activity is evidence only. It never posts a journal or authorises a payment by resemblance.
- Match suggestions remain provisional. Human decisions are immutable and now bind to the exact bank-ledger movement.
- SwiftClaim stores no online-banking credentials and exposes no bank-payment initiation path.
- Cleared, restricted, reserved and available client money are separate from office and suspense money.
- Approved pending movements reserve funds, and posting rechecks the current exact matter/client balance.
- Issued bills, bill lines, source allocations, receipts, statement lines, payment/transfer events, reconciliation evidence, sign-offs and export manifests are immutable or append-only.
- Corrections use credit notes, reversals or later events; posted financial facts are not overwritten.
- Operational events omit beneficiary names, fingerprints, full bank identifiers and privileged matter narrative.
- Financial downloads require the authenticated firm, exact finance record and exact retained document version.
- CSV exports protect spreadsheet formula prefixes and retain the exact columns, filters, row count, author, timestamp and SHA-256 digest.

## Release boundary and limitations

This remains an evaluation/pilot implementation. It does not claim automatic compliance with the SRA Accounts Rules or replace cashier, COFA, accountant, regulatory, security, privacy, backup, disaster-recovery or professional-indemnity review.

Banking is manual/imported for this release. Provider interfaces exist for later work, but there are no live bank feeds, bank credentials, payment initiation, automatic statement posting or autonomous financial approvals.

The release tree must be published through a non-force feature-branch pull request, merged into `main`, fetched again and compared by Git tree hash with this verified local tree.
