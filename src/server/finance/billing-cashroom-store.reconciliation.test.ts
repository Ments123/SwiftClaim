import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import { BillingCashroomStore } from './billing-cashroom-store.js';

const now = () => new Date('2026-10-10T12:00:00.000Z');
const audit = { requestId: 'reconciliation-store-test', ipAddress: '127.0.0.1' };
const finance: SessionUser = { id: SEED_IDS.finance, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal', email: 'finance@northstar.test', name: 'Priya Shah', role: 'finance' };
const partner: SessionUser = { id: SEED_IDS.partner, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal', email: 'partner@northstar.test', name: 'Marcus Reed', role: 'partner' };

describe('BillingCashroomStore bank reconciliation', () => {
  let database: DatabaseSync;
  let store: BillingCashroomStore;

  beforeEach(() => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    store = new BillingCashroomStore(database, now);
    const account = database.prepare(`INSERT INTO finance_accounts
      (id,firm_id,code,name,account_class,designation,currency,active,created_by,created_at)
      VALUES (?,?,?,?,?,?,'GBP',1,?,?)`);
    account.run('b0100000-0000-4000-8000-000000000001', finance.firmId, 'CLIENT-BANK-TEST', 'Client bank test', 'client_asset', 'client', finance.id, now().toISOString());
    account.run('b0100000-0000-4000-8000-000000000002', finance.firmId, 'CLIENT-LIABILITY-TEST', 'Client liability test', 'client_liability', 'client', finance.id, now().toISOString());
    database.prepare(`INSERT INTO finance_bank_accounts
      (id,firm_id,name,designation,ledger_account_id,provider,account_identifier_masked,currency,active,created_by,created_at)
      VALUES ('b1000000-0000-4000-8000-000000000001',?,'Client account','client','b0100000-0000-4000-8000-000000000001','manual','****5678','GBP',1,?,?)`)
      .run(finance.firmId, finance.id, now().toISOString());
  });

  afterEach(() => database.close());

  const importInput = {
    idempotencyKey: 'statement-import-001', bankAccountId: 'b1000000-0000-4000-8000-000000000001',
    statementFrom: '2026-10-01', statementTo: '2026-10-05', openingBalanceMinor: 0,
    closingBalanceMinor: 100_000, currency: 'GBP' as const,
    evidenceDocumentVersionId: SEED_IDS.complaintVersion, rawChecksum: 'a'.repeat(64),
    lines: [{ lineNumber: 1, providerLineId: 'client-bank-1', transactionDate: '2026-10-05',
      valueDate: '2026-10-05', amountMinor: 100_000, reference: 'Maya funds', payerPayee: 'Maya Clarke',
      rawLineHash: 'b'.repeat(64) }],
  };

  function postLedgerJournal(id: string, amountMinor: number) {
    database.prepare(`INSERT OR IGNORE INTO finance_accounting_periods
      (id,firm_id,starts_on,ends_on,status,closed_by,closed_at,created_by,created_at)
      VALUES ('b2000000-0000-4000-8000-000000000001',?,'2026-01-01','2026-12-31','open',NULL,NULL,?,?)`)
      .run(finance.firmId, finance.id, now().toISOString());
    database.prepare(`INSERT INTO finance_journals
      (id,firm_id,matter_id,period_id,accounting_date,source_kind,source_id,description,currency,reverses_journal_id,prepared_by,prepared_at)
      VALUES (?,?,?,'b2000000-0000-4000-8000-000000000001','2026-10-05','other',?,?,'GBP',NULL,?,?)`)
      .run(id, finance.firmId, SEED_IDS.northstarMatter, `source-${id}`, `Bank test ${id}`, finance.id, now().toISOString());
    const line = database.prepare(`INSERT INTO finance_journal_lines
      (id,firm_id,matter_id,journal_id,line_number,account_id,debit_minor,credit_minor,currency,memo)
      VALUES (?,?,?,?,?,?,?,?,'GBP','Reconciliation test line')`);
    line.run(`${id.slice(0, -2)}${id.at(-1)}3`, finance.firmId, SEED_IDS.northstarMatter, id, 1, 'b0100000-0000-4000-8000-000000000001', amountMinor, 0);
    line.run(`${id.slice(0, -2)}${id.at(-1)}4`, finance.firmId, SEED_IDS.northstarMatter, id, 2, 'b0100000-0000-4000-8000-000000000002', 0, amountMinor);
    database.prepare(`INSERT INTO finance_journal_events
      (id,firm_id,matter_id,journal_id,sequence,event_type,note,occurred_at,recorded_by,recorded_at)
      VALUES (?,?,?, ?,1,'posted','Posted test journal.',?,?,?)`)
      .run(`${id.slice(0, -2)}${id.at(-1)}5`, finance.firmId, SEED_IDS.northstarMatter, id, now().toISOString(), finance.id, now().toISOString());
  }

  it('imports an immutable checksum-idempotent batch and never posts money from evidence alone', () => {
    const batch = store.importBankStatement(finance, importInput, audit);
    expect(batch).toMatchObject({ closingBalanceMinor: 100_000, lineCount: 1, lines: [expect.objectContaining({ amountMinor: 100_000 })] });
    expect(store.importBankStatement(finance, importInput, audit)).toEqual(batch);
    expect(() => store.importBankStatement(finance, { ...importInput, idempotencyKey: 'statement-import-002' }, audit))
      .toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
    expect(database.prepare("SELECT COUNT(*) AS count FROM finance_journals WHERE source_kind='bank'").get()).toEqual({ count: 0 });
    expect(() => database.prepare('UPDATE finance_bank_statement_lines SET amount_minor=1').run()).toThrow(/immutable/i);
    expect(() => store.importBankStatement(finance, { ...importInput, idempotencyKey: 'statement-import-bad-total',
      rawChecksum: 'e'.repeat(64), closingBalanceMinor: 99_999,
      lines: [{ ...importInput.lines[0]!, providerLineId: 'bad-total-line', rawLineHash: 'f'.repeat(64) }] }, audit))
      .toThrowError(expect.objectContaining({ code: 'INVALID_STATE' }));
  });

  it('keeps match decisions human-controlled and requires zero difference plus independent sign-off', () => {
    postLedgerJournal('b3000000-0000-4000-8000-000000000009', 100_000);
    const batch = store.importBankStatement(finance, importInput, audit);
    const reconciliation = store.prepareReconciliation(finance, {
      idempotencyKey: 'reconciliation-prepare-001', bankAccountId: importInput.bankAccountId,
      statementBatchId: batch.id, ledgerClearedBalanceMinor: 100_000,
      outstandingLodgementsMinor: 0, unpresentedPaymentsMinor: 0, documentedAdjustmentsMinor: 0,
      items: [], note: 'Prepared against the exact imported statement and ledger snapshot.', explicitHumanConfirmation: true,
    }, audit);
    expect(reconciliation).toMatchObject({ status: 'prepared', differenceMinor: 0, version: 1 });
    const completed = store.completeReconciliation(finance, reconciliation.id, {
      expectedVersion: 1, idempotencyKey: 'reconciliation-complete-001',
      completedAt: '2026-10-10T13:00:00.000Z', explicitHumanConfirmation: true,
    }, audit);
    expect(completed).toMatchObject({ status: 'completed', version: 2 });
    expect(() => store.signoffReconciliation(finance, reconciliation.id, {
      expectedVersion: 2, idempotencyKey: 'reconciliation-signoff-self',
      signedOffAt: '2026-10-10T14:00:00.000Z', note: 'Self sign-off must be refused.', explicitHumanApproval: true,
    }, audit)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    const signed = store.signoffReconciliation(partner, reconciliation.id, {
      expectedVersion: 2, idempotencyKey: 'reconciliation-signoff-001',
      signedOffAt: '2026-10-10T14:00:00.000Z', note: 'The exact zero-difference reconciliation was independently reviewed.', explicitHumanApproval: true,
    }, audit);
    expect(signed).toMatchObject({ status: 'signed_off', nextReviewDueOn: '2026-11-09' });
    expect(() => store.completeReconciliation(finance, reconciliation.id, {
      expectedVersion: 2, idempotencyKey: 'reconciliation-complete-again',
      completedAt: '2026-10-10T15:00:00.000Z', explicitHumanConfirmation: true,
    }, audit)).toThrow();
  });

  it('retains explicit split and reject decisions without allowing a suggestion to confirm itself', () => {
    postLedgerJournal('b3000000-0000-4000-8000-000000000001', 60_000);
    postLedgerJournal('b3000000-0000-4000-8000-000000000002', 40_000);
    const batch = store.importBankStatement(finance, { ...importInput, idempotencyKey: 'statement-import-split',
      rawChecksum: 'c'.repeat(64), lines: [{ ...importInput.lines[0]!, providerLineId: 'split-line', rawLineHash: 'd'.repeat(64) }] }, audit);
    const reconciliation = store.prepareReconciliation(finance, {
      idempotencyKey: 'reconciliation-prepare-split', bankAccountId: importInput.bankAccountId,
      statementBatchId: batch.id, ledgerClearedBalanceMinor: 100_000, outstandingLodgementsMinor: 0,
      unpresentedPaymentsMinor: 0, documentedAdjustmentsMinor: 0, items: [],
      note: 'Prepared for an explicit split decision.', explicitHumanConfirmation: true,
    }, audit);
    const split = store.decideReconciliationMatch(finance, reconciliation.id, {
      expectedVersion: 1, idempotencyKey: 'reconciliation-split-001', statementLineId: batch.lines[0]!.id,
      decision: 'split', matches: [
        { journalId: 'b3000000-0000-4000-8000-000000000001', amountMinor: 60_000 },
        { journalId: 'b3000000-0000-4000-8000-000000000002', amountMinor: 40_000 },
      ], explanation: 'The single bank line settles two exact posted ledger entries.', explicitHumanConfirmation: true,
    }, audit);
    expect(split).toMatchObject({ status: 'prepared', version: 2 });
    expect(split.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ amountMinor: 60_000 }), expect.objectContaining({ amountMinor: 40_000 }),
    ]));
    expect(() => store.decideReconciliationMatch(finance, reconciliation.id, {
      expectedVersion: 2, idempotencyKey: 'reconciliation-reject-after-split', statementLineId: batch.lines[0]!.id,
      decision: 'reject', matches: [], explanation: 'A retained decision cannot be silently replaced.', explicitHumanConfirmation: true,
    }, audit)).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
  });

  it('blocks completion where the frozen arithmetic does not reconcile', () => {
    postLedgerJournal('b3000000-0000-4000-8000-000000000008', 90_000);
    const batch = store.importBankStatement(finance, importInput, audit);
    const reconciliation = store.prepareReconciliation(finance, {
      idempotencyKey: 'reconciliation-prepare-difference', bankAccountId: importInput.bankAccountId,
      statementBatchId: batch.id, ledgerClearedBalanceMinor: 90_000,
      outstandingLodgementsMinor: 0, unpresentedPaymentsMinor: 0, documentedAdjustmentsMinor: 0,
      items: [], note: 'A difference remains and must block completion.', explicitHumanConfirmation: true,
    }, audit);
    expect(reconciliation.differenceMinor).toBe(10_000);
    expect(() => store.completeReconciliation(finance, reconciliation.id, {
      expectedVersion: 1, idempotencyKey: 'reconciliation-complete-difference',
      completedAt: '2026-10-10T13:00:00.000Z', explicitHumanConfirmation: true,
    }, audit)).toThrowError(expect.objectContaining({ code: 'INVALID_STATE' }));
  });
});
