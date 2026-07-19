import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import { FinanceStore } from './store.js';

const now = () => new Date('2026-07-19T12:00:00.000Z');
const audit = { requestId: 'finance-journal-store-test', ipAddress: '127.0.0.1' };
const partner: SessionUser = { id: SEED_IDS.partner, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal', email: 'partner@northstar.test', name: 'Marcus Reed', role: 'partner' };
const finance: SessionUser = { id: SEED_IDS.finance, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal', email: 'finance@northstar.test', name: 'Priya Shah', role: 'finance' };

describe('FinanceStore journal lifecycle', () => {
  let database: DatabaseSync;
  let store: FinanceStore;
  const accounts = {
    wip: '91000000-0000-4000-8000-000000000001',
    offset: '91000000-0000-4000-8000-000000000002',
    client: '91000000-0000-4000-8000-000000000003',
    office: '91000000-0000-4000-8000-000000000004',
  };

  beforeEach(() => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    const insertAccount = database.prepare(`INSERT INTO finance_accounts (
      id, firm_id, code, name, account_class, designation, currency, active, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'GBP', 1, ?, ?)`);
    insertAccount.run(accounts.wip, partner.firmId, 'WIP', 'Unbilled WIP control', 'wip_asset', 'neutral', finance.id, now().toISOString());
    insertAccount.run(accounts.offset, partner.firmId, 'WIP-OFFSET', 'WIP offset control', 'suspense', 'neutral', finance.id, now().toISOString());
    insertAccount.run(accounts.client, partner.firmId, 'CLIENT-CASH', 'Client cash placeholder', 'client_asset', 'client', finance.id, now().toISOString());
    insertAccount.run(accounts.office, partner.firmId, 'OFFICE-CASH', 'Office cash placeholder', 'office_asset', 'office', finance.id, now().toISOString());
    database.prepare(`INSERT INTO finance_accounting_periods (
      id, firm_id, starts_on, ends_on, status, closed_by, closed_at, created_by, created_at
    ) VALUES (?, ?, '2026-01-01', '2026-12-31', 'open', NULL, NULL, ?, ?)`)
      .run('92000000-0000-4000-8000-000000000001', partner.firmId, finance.id, now().toISOString());
    store = new FinanceStore(database, now);
  });
  afterEach(() => database.close());

  function balancedInput(sourceId: string = SEED_IDS.repairVersion, idempotencyKey: string = 'prepare-balanced-journal') {
    return {
      idempotencyKey, accountingDate: '2026-07-19', sourceKind: 'other' as const,
      sourceId, description: 'Non-cash WIP control entry supported by an exact retained source.',
      lines: [
        { accountId: accounts.wip, debitMinor: 14_800, creditMinor: 0, currency: 'GBP' as const, matterId: null, memo: 'Recognise approved WIP control' },
        { accountId: accounts.offset, debitMinor: 0, creditMinor: 14_800, currency: 'GBP' as const, matterId: null, memo: 'Offset approved WIP control' },
      ],
    };
  }

  it('posts a balanced journal only after independent approval', () => {
    const prepared = store.prepareJournal(partner, SEED_IDS.northstarMatter, balancedInput(), audit);
    expect(prepared).toMatchObject({ status: 'draft', version: 1, totalDebitMinor: 14_800, totalCreditMinor: 14_800 });
    expect(() => store.approveJournal(partner, SEED_IDS.northstarMatter, prepared.id, {
      expectedVersion: 1, idempotencyKey: 'self-approve-journal',
      approvedAt: '2026-07-19T12:10:00.000Z', note: 'Self approval must be rejected.', explicitHumanApproval: true,
    }, audit)).toThrowError(expect.objectContaining({ code: 'INDEPENDENCE_REQUIRED' }));
    const approved = store.approveJournal(finance, SEED_IDS.northstarMatter, prepared.id, {
      expectedVersion: 1, idempotencyKey: 'approve-balanced-journal',
      approvedAt: '2026-07-19T12:10:00.000Z',
      note: 'Balanced lines, exact source, accounts and open period independently checked.', explicitHumanApproval: true,
    }, audit);
    const posted = store.postJournal(finance, SEED_IDS.northstarMatter, prepared.id, {
      expectedVersion: approved.version, idempotencyKey: 'post-balanced-journal',
      postedAt: '2026-07-19T12:20:00.000Z', explicitHumanConfirmation: true,
    }, audit);

    expect(posted).toMatchObject({ status: 'posted', version: 3, preparedBy: partner.id, approvedBy: finance.id, postedBy: finance.id });
    expect(store.getWorkspace(finance, SEED_IDS.northstarMatter)?.ledger.balances)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ accountId: accounts.wip, netMinor: 14_800 }),
        expect.objectContaining({ accountId: accounts.offset, netMinor: -14_800 }),
      ]));
    expect(() => database.prepare('UPDATE finance_journal_lines SET debit_minor = 1').run()).toThrow(/immutable/i);
    expect(() => database.prepare("UPDATE finance_accounts SET designation = 'office'").run()).toThrow(/immutable/i);
  });

  it('rejects unbalanced, client/office and closed-period entries before insert', () => {
    expect(() => store.prepareJournal(partner, SEED_IDS.northstarMatter, {
      ...balancedInput(SEED_IDS.bedroomPhotoVersion, 'prepare-unbalanced-journal'),
      lines: [
        { accountId: accounts.wip, debitMinor: 10_000, creditMinor: 0, currency: 'GBP', matterId: null, memo: 'Unbalanced debit' },
        { accountId: accounts.offset, debitMinor: 0, creditMinor: 9_000, currency: 'GBP', matterId: null, memo: 'Unbalanced credit' },
      ],
    }, audit)).toThrow(/balance/i);
    expect(() => store.prepareJournal(partner, SEED_IDS.northstarMatter, {
      ...balancedInput(SEED_IDS.bathroomPhotoVersion, 'prepare-cash-mix-journal'),
      lines: [
        { accountId: accounts.client, debitMinor: 10_000, creditMinor: 0, currency: 'GBP', matterId: null, memo: 'Client side' },
        { accountId: accounts.office, debitMinor: 0, creditMinor: 10_000, currency: 'GBP', matterId: null, memo: 'Office side' },
      ],
    }, audit)).toThrow(/cashroom|client|office/i);
    database.prepare("UPDATE finance_accounting_periods SET status = 'closed', closed_by = ?, closed_at = ? WHERE firm_id = ?")
      .run(finance.id, '2026-07-19T12:00:00.000Z', finance.firmId);
    expect(() => store.prepareJournal(partner, SEED_IDS.northstarMatter,
      balancedInput(SEED_IDS.complaintVersion, 'prepare-closed-period-journal'), audit)).toThrow(/period/i);
    expect(database.prepare('SELECT COUNT(*) AS count FROM finance_journals').get()).toEqual({ count: 0 });
  });

  it('does not let the preparer post even after another user approves', () => {
    const prepared = store.prepareJournal(finance, SEED_IDS.northstarMatter,
      balancedInput(SEED_IDS.complaintVersion, 'prepare-self-post-journal'), audit);
    const approved = store.approveJournal(partner, SEED_IDS.northstarMatter, prepared.id, {
      expectedVersion: 1, idempotencyKey: 'approve-self-post-journal',
      approvedAt: '2026-07-19T12:10:00.000Z',
      note: 'The partner independently approved this finance-prepared journal.', explicitHumanApproval: true,
    }, audit);
    expect(() => store.postJournal(finance, SEED_IDS.northstarMatter, prepared.id, {
      expectedVersion: approved.version, idempotencyKey: 'attempt-self-post-journal',
      postedAt: '2026-07-19T12:20:00.000Z', explicitHumanConfirmation: true,
    }, audit)).toThrowError(expect.objectContaining({ code: 'INDEPENDENCE_REQUIRED' }));
  });

  it('reverses a posted journal with separate inverted immutable lines', () => {
    const original = store.prepareJournal(partner, SEED_IDS.northstarMatter, balancedInput(), audit);
    const approved = store.approveJournal(finance, SEED_IDS.northstarMatter, original.id, {
      expectedVersion: 1, idempotencyKey: 'approve-original-journal', approvedAt: '2026-07-19T12:10:00.000Z',
      note: 'Original journal independently checked before posting.', explicitHumanApproval: true,
    }, audit);
    store.postJournal(finance, SEED_IDS.northstarMatter, original.id, {
      expectedVersion: approved.version, idempotencyKey: 'post-original-journal',
      postedAt: '2026-07-19T12:20:00.000Z', explicitHumanConfirmation: true,
    }, audit);
    const reversal = store.reverseJournal(partner, SEED_IDS.northstarMatter, original.id, {
      idempotencyKey: 'prepare-reversal-journal', accountingDate: '2026-07-19',
      reason: 'The original non-cash control entry was posted against the wrong source.', explicitHumanApproval: true,
    }, audit);
    expect(reversal).toMatchObject({ status: 'draft', reversesJournalId: original.id });
    expect(reversal.lines).toEqual([
      expect.objectContaining({ accountId: accounts.wip, debitMinor: 0, creditMinor: 14_800 }),
      expect.objectContaining({ accountId: accounts.offset, debitMinor: 14_800, creditMinor: 0 }),
    ]);
    const reversalApproved = store.approveJournal(finance, SEED_IDS.northstarMatter, reversal.id, {
      expectedVersion: 1, idempotencyKey: 'approve-reversal-journal', approvedAt: '2026-07-19T12:30:00.000Z',
      note: 'Inverted lines and reversal source independently checked.', explicitHumanApproval: true,
    }, audit);
    store.postJournal(finance, SEED_IDS.northstarMatter, reversal.id, {
      expectedVersion: reversalApproved.version, idempotencyKey: 'post-reversal-journal',
      postedAt: '2026-07-19T12:40:00.000Z', explicitHumanConfirmation: true,
    }, audit);

    expect(store.getJournal(finance, SEED_IDS.northstarMatter, original.id)).toMatchObject({ status: 'reversed', version: 4 });
    expect(store.getWorkspace(finance, SEED_IDS.northstarMatter)?.ledger.balances.every(({ netMinor }) => netMinor === 0)).toBe(true);
    expect(database.prepare('SELECT COUNT(*) AS count FROM finance_journals').get()).toEqual({ count: 2 });
  });
});
