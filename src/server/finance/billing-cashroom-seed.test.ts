import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createDatabase,
  seedBillingCashroomEvaluation,
  seedCommunicationsEvaluation,
  seedDatabase,
  seedFinanceEvaluation,
  SEED_IDS,
} from '../database.js';
import type { SessionUser } from '../policy.js';
import { BillingCashroomStore } from './billing-cashroom-store.js';

const finance: SessionUser = {
  id: SEED_IDS.finance,
  firmId: SEED_IDS.northstarFirm,
  firmName: 'Northstar Legal',
  email: 'finance@northstar.test',
  name: 'Priya Shah',
  role: 'finance',
};

const governedTables = [
  'finance_bills',
  'finance_bill_versions',
  'finance_bill_lines',
  'finance_bill_events',
  'finance_bill_documents',
  'finance_bill_source_allocations',
  'finance_receipts',
  'finance_receipt_events',
  'finance_receipt_allocations',
  'finance_client_office_transfers',
  'finance_transfer_events',
  'finance_payment_requisitions',
  'finance_payment_events',
  'finance_exceptions',
  'finance_bank_statement_batches',
  'finance_bank_statement_lines',
  'finance_reconciliations',
  'finance_reconciliation_items',
  'finance_reconciliation_events',
  'finance_reconciliation_signoffs',
] as const;

function counts(database: DatabaseSync) {
  return Object.fromEntries(governedTables.map((table) => [
    table,
    Number((database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count),
  ]));
}

describe('Billing & Cashroom Northstar evaluation seed', () => {
  let database: DatabaseSync;

  beforeEach(async () => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    await seedCommunicationsEvaluation(database);
    seedFinanceEvaluation(database);
  });

  afterEach(() => database.close());

  it('seeds the governed bill-to-reconciliation journey idempotently', () => {
    seedBillingCashroomEvaluation(database);
    const firstCounts = counts(database);
    seedBillingCashroomEvaluation(database);

    expect(counts(database)).toEqual(firstCounts);

    const store = new BillingCashroomStore(database, () => new Date('2026-10-10T15:00:00.000Z'));
    const billRow = database.prepare(`SELECT id FROM finance_bills
      WHERE firm_id=? AND matter_id=? AND bill_reference='SC-2026-000001'`).get(
      finance.firmId,
      SEED_IDS.northstarMatter,
    ) as { id: string };
    const bill = store.getBill(finance, SEED_IDS.northstarMatter, billRow.id)!;

    expect(bill).toMatchObject({
      status: 'part_paid',
      billReference: 'SC-2026-000001',
      netMinor: 91_500,
      vatMinor: 9_200,
      grossMinor: 100_700,
      paidMinor: 60_000,
      outstandingMinor: 40_700,
    });
    expect(bill.deliveredAt).not.toBeNull();
    expect(store.getMatterMoney(finance, SEED_IDS.northstarMatter, SEED_IDS.northstarClient)).toMatchObject({
      clientHeldMinor: 8_000,
      clientAvailableMinor: 8_000,
      officeHeldMinor: 60_000,
    });

    expect(database.prepare(`SELECT COUNT(*) AS count FROM finance_receipt_allocations
      WHERE firm_id=? AND designation='suspense' AND amount_minor=15000`).get(finance.firmId)).toEqual({ count: 1 });
    expect(database.prepare(`SELECT severity FROM finance_exceptions
      WHERE firm_id=? AND matter_id=? AND exception_kind='changed_beneficiary'`).get(
      finance.firmId,
      SEED_IDS.northstarMatter,
    )).toEqual({ severity: 'blocker' });

    const reconciliationRow = database.prepare(`SELECT id FROM finance_reconciliations
      WHERE firm_id=? ORDER BY prepared_at DESC LIMIT 1`).get(finance.firmId) as { id: string };
    expect(store.getReconciliation(finance, reconciliationRow.id)).toMatchObject({
      status: 'signed_off',
      statementClosingBalanceMinor: 23_000,
      ledgerClearedBalanceMinor: 8_000,
      outstandingLodgementsMinor: 15_000,
      differenceMinor: 0,
      nextReviewDueOn: '2026-11-09',
    });
  });
});
