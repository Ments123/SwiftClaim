import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import { BillingCashroomStore } from './billing-cashroom-store.js';

const now = () => new Date('2026-10-05T12:00:00.000Z');
const audit = { requestId: 'cashroom-store-test', ipAddress: '127.0.0.1' };
const finance: SessionUser = { id: SEED_IDS.finance, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal', email: 'finance@northstar.test', name: 'Priya Shah', role: 'finance' };
const partner: SessionUser = { id: SEED_IDS.partner, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal', email: 'partner@northstar.test', name: 'Marcus Reed', role: 'partner' };

describe('BillingCashroomStore money movements', () => {
  let database: DatabaseSync;
  let store: BillingCashroomStore;

  beforeEach(() => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    store = new BillingCashroomStore(database, now);
    configure();
  });

  afterEach(() => database.close());

  function configure() {
    const account = database.prepare(`INSERT INTO finance_accounts
      (id,firm_id,code,name,account_class,designation,currency,active,created_by,created_at)
      VALUES (?,?,?,?,?,?,'GBP',1,?,?)`);
    account.run('a1100000-0000-4000-8000-000000000001', finance.firmId, 'CLIENT-BANK', 'Client bank', 'client_asset', 'client', finance.id, now().toISOString());
    account.run('a1100000-0000-4000-8000-000000000002', finance.firmId, 'CLIENT-LIABILITY', 'Client liability', 'client_liability', 'client', finance.id, now().toISOString());
    account.run('a1100000-0000-4000-8000-000000000003', finance.firmId, 'OFFICE-BANK', 'Office bank', 'office_asset', 'office', finance.id, now().toISOString());
    account.run('a1100000-0000-4000-8000-000000000004', finance.firmId, 'TRADE-DEBTORS', 'Trade debtors', 'office_asset', 'office', finance.id, now().toISOString());
    account.run('a1100000-0000-4000-8000-000000000005', finance.firmId, 'SUSPENSE', 'Suspense', 'suspense', 'neutral', finance.id, now().toISOString());
    database.prepare(`INSERT INTO finance_accounting_periods
      (id,firm_id,starts_on,ends_on,status,closed_by,closed_at,created_by,created_at)
      VALUES ('a1200000-0000-4000-8000-000000000001',?,'2026-01-01','2026-12-31','open',NULL,NULL,?,?)`)
      .run(finance.firmId, finance.id, now().toISOString());
    database.prepare(`INSERT INTO finance_bank_accounts
      (id,firm_id,name,designation,ledger_account_id,provider,account_identifier_masked,currency,active,created_by,created_at)
      VALUES ('a1300000-0000-4000-8000-000000000001',?,'Client account','client','a1100000-0000-4000-8000-000000000001','manual','****1234','GBP',1,?,?)`)
      .run(finance.firmId, finance.id, now().toISOString());
    database.prepare(`INSERT INTO finance_bill_series
      (id,firm_id,prefix,year_pattern,next_number,padding,active,created_by,created_at)
      VALUES ('a1350000-0000-4000-8000-000000000001',?,'SC-','YYYY-',2,6,1,?,?)`)
      .run(finance.firmId, finance.id, now().toISOString());

    database.prepare(`INSERT INTO finance_bills
      (id,firm_id,matter_id,client_party_id,series_id,bill_number,bill_reference,currency,due_on,prepared_by,prepared_at)
      VALUES ('a1400000-0000-4000-8000-000000000001',?,?,?,'a1350000-0000-4000-8000-000000000001',1,'SC-2026-000001','GBP','2026-11-01',?,'2026-10-01T09:00:00.000Z')`)
      .run(finance.firmId, SEED_IDS.northstarMatter, SEED_IDS.northstarClient, partner.id);
    database.prepare(`INSERT INTO finance_bill_versions
      (id,firm_id,matter_id,bill_id,version_number,due_on,net_minor,vat_minor,gross_minor,currency,note,prepared_by,created_at)
      VALUES ('a1500000-0000-4000-8000-000000000001',?,?, 'a1400000-0000-4000-8000-000000000001',1,'2026-11-01',80000,20000,100000,'GBP','Exact issued test bill',?,'2026-10-01T09:00:00.000Z')`)
      .run(finance.firmId, SEED_IDS.northstarMatter, partner.id);
    const event = database.prepare(`INSERT INTO finance_bill_events
      (id,firm_id,matter_id,bill_id,sequence,event_type,bill_version_id,note,evidence_document_version_id,occurred_at,recorded_by,recorded_at)
      VALUES (?,?,?,?,?,?,'a1500000-0000-4000-8000-000000000001',?,?,?, ?,?)`);
    ['prepared','submitted','approved','issued','delivered'].forEach((type, index) => event.run(
      `a1600000-0000-4000-8000-00000000000${index + 1}`, finance.firmId, SEED_IDS.northstarMatter,
      'a1400000-0000-4000-8000-000000000001', index + 1, type, `${type} test bill`,
      type === 'delivered' ? SEED_IDS.complaintVersion : null, `2026-10-0${index + 1}T09:00:00.000Z`,
      index === 2 ? partner.id : finance.id, `2026-10-0${index + 1}T09:00:00.000Z`,
    ));
  }

  function recordReceipt(key = 'record-receipt-001', amountMinor = 100_000) {
    return store.recordReceipt(finance, {
      idempotencyKey: key, bankAccountId: 'a1300000-0000-4000-8000-000000000001', statementLineId: null,
      amountMinor, receivedOn: '2026-10-05', payer: 'Maya Clarke', reference: 'Matter funds',
      evidenceDocumentVersionId: SEED_IDS.complaintVersion, fingerprint: key.padEnd(64, 'a').slice(0, 64),
      explicitHumanConfirmation: true,
    }, audit);
  }

  it('records evidence without posting, then atomically allocates client, office and suspense money', () => {
    const receipt = recordReceipt();
    expect(receipt).toMatchObject({ status: 'recorded', version: 1, allocatedMinor: 0 });
    expect(database.prepare(`SELECT COUNT(*) AS count FROM finance_journals WHERE source_id LIKE ?`).get(`${receipt.id}%`)).toEqual({ count: 0 });

    const allocated = store.allocateReceipt(finance, receipt.id, {
      expectedVersion: 1, idempotencyKey: 'allocate-receipt-001', allocations: [
        { designation: 'client', matterId: SEED_IDS.northstarMatter, clientPartyId: SEED_IDS.northstarClient, billId: null, amountMinor: 70_000, cleared: true, restricted: false },
        { designation: 'office', matterId: SEED_IDS.northstarMatter, clientPartyId: SEED_IDS.northstarClient, billId: 'a1400000-0000-4000-8000-000000000001', amountMinor: 20_000, cleared: true, restricted: false },
        { designation: 'suspense', matterId: null, clientPartyId: null, billId: null, amountMinor: 10_000, cleared: false, restricted: false },
      ], note: 'The mixed receipt was split against exact remittance evidence.', explicitHumanConfirmation: true,
    }, audit);
    expect(allocated).toMatchObject({ status: 'allocated', version: 3, allocatedMinor: 100_000 });
    expect(store.getMatterMoney(finance, SEED_IDS.northstarMatter, SEED_IDS.northstarClient)).toMatchObject({
      clientHeldMinor: 70_000, clientAvailableMinor: 70_000, officeHeldMinor: 20_000,
    });
    expect(database.prepare(`SELECT COUNT(*) AS count FROM finance_journal_events WHERE event_type='posted'
      AND journal_id IN (SELECT journal_id FROM finance_receipt_allocations WHERE receipt_id=?)`).get(receipt.id)).toEqual({ count: 2 });
    const clientAllocation = allocated.allocations.find((allocation) => allocation.designation === 'client')!;
    const reversed = store.reverseReceiptAllocation(finance, receipt.id, {
      expectedVersion: allocated.version, idempotencyKey: 'reverse-receipt-allocation-001', allocationId: String(clientAllocation.id),
      note: 'The original client split was incorrect and is being reversed intact.', explicitHumanConfirmation: true,
    }, audit);
    expect(reversed).toMatchObject({ status: 'reversed', version: 4, allocatedMinor: 30_000 });
    expect(() => database.prepare('UPDATE finance_receipt_allocations SET amount_minor=1').run()).toThrow(/immutable/i);
  });

  it('blocks duplicate receipts and transfers only delivered bill value from exact available matter funds', () => {
    const receipt = recordReceipt('record-client-funds-001', 80_000);
    expect(() => recordReceipt('record-client-funds-002', 80_000)).not.toThrow();
    expect(() => store.recordReceipt(finance, {
      idempotencyKey: 'duplicate-fingerprint', bankAccountId: 'a1300000-0000-4000-8000-000000000001', statementLineId: null,
      amountMinor: 80_000, receivedOn: '2026-10-05', payer: 'Maya Clarke', reference: 'Matter funds',
      evidenceDocumentVersionId: SEED_IDS.complaintVersion, fingerprint: 'record-client-funds-001'.padEnd(64, 'a').slice(0, 64), explicitHumanConfirmation: true,
    }, audit)).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
    store.allocateReceipt(finance, receipt.id, {
      expectedVersion: 1, idempotencyKey: 'allocate-client-funds-001', allocations: [
        { designation: 'client', matterId: SEED_IDS.northstarMatter, clientPartyId: SEED_IDS.northstarClient, billId: null, amountMinor: 70_000, cleared: true, restricted: false },
        { designation: 'client', matterId: SEED_IDS.northstarMatter, clientPartyId: SEED_IDS.northstarClient, billId: null, amountMinor: 10_000, cleared: true, restricted: true },
      ], note: 'Cleared client funds allocated to this exact client and matter.', explicitHumanConfirmation: true,
    }, audit);
    const transfer = store.prepareClientOfficeTransfer(finance, SEED_IDS.northstarMatter, {
      idempotencyKey: 'prepare-transfer-001', clientPartyId: SEED_IDS.northstarClient,
      billId: 'a1400000-0000-4000-8000-000000000001', amountMinor: 60_000,
      note: 'Partial transfer against the exact delivered bill.', explicitHumanConfirmation: true,
    }, audit);
    expect(() => store.approveClientOfficeTransfer(finance, SEED_IDS.northstarMatter, transfer.id, {
      expectedVersion: 1, idempotencyKey: 'self-approve-transfer', approvedAt: '2026-10-05T12:05:00.000Z',
      note: 'Attempted same-person approval must not succeed.', explicitHumanApproval: true,
    }, audit)).toThrowError(expect.objectContaining({ code: 'INDEPENDENCE_REQUIRED' }));
    const approved = store.approveClientOfficeTransfer(partner, SEED_IDS.northstarMatter, transfer.id, {
      expectedVersion: 1, idempotencyKey: 'approve-transfer-001', approvedAt: '2026-10-05T12:05:00.000Z',
      note: 'Exact bill delivery and available funds independently checked.', explicitHumanApproval: true,
    }, audit);
    const posted = store.postClientOfficeTransfer(finance, SEED_IDS.northstarMatter, transfer.id, {
      expectedVersion: approved.version, idempotencyKey: 'post-transfer-001', postedAt: '2026-10-05T12:10:00.000Z', explicitHumanConfirmation: true,
    }, audit);
    expect(posted).toMatchObject({ status: 'posted', amountMinor: 60_000, version: 3 });
    expect(store.getMatterMoney(finance, SEED_IDS.northstarMatter, SEED_IDS.northstarClient)).toMatchObject({
      clientAvailableMinor: 10_000, clientRestrictedMinor: 10_000,
    });
    expect(store.getBill(finance, SEED_IDS.northstarMatter, 'a1400000-0000-4000-8000-000000000001')).toMatchObject({ paidMinor: 60_000, outstandingMinor: 40_000 });
  });

  it('requires independent payment approval and only records external completion evidence', () => {
    const receipt = recordReceipt('record-payment-funds-001', 50_000);
    store.allocateReceipt(finance, receipt.id, {
      expectedVersion: 1, idempotencyKey: 'allocate-payment-funds-001', allocations: [
        { designation: 'client', matterId: SEED_IDS.northstarMatter, clientPartyId: SEED_IDS.northstarClient, billId: null, amountMinor: 50_000, cleared: true, restricted: false },
      ], note: 'Cleared client funds allocated before the payment request.', explicitHumanConfirmation: true,
    }, audit);
    const payment = store.prepareClientPayment(finance, SEED_IDS.northstarMatter, {
      idempotencyKey: 'prepare-payment-001', clientPartyId: SEED_IDS.northstarClient,
      bankAccountId: 'a1300000-0000-4000-8000-000000000001', amountMinor: 15_000,
      purpose: 'Refund unused client funds after the matter balance review.', beneficiaryName: 'Maya Clarke',
      beneficiaryFingerprint: 'b'.repeat(64), beneficiaryEvidenceDocumentVersionId: SEED_IDS.complaintVersion,
      requestedPaymentMethod: 'bank_transfer', explicitHumanConfirmation: true,
    }, audit);
    expect(() => store.approveClientPayment(partner, SEED_IDS.northstarMatter, payment.id, {
      expectedVersion: 1, idempotencyKey: 'backdated-payment-approval', approvedAt: '2026-10-05T11:59:00.000Z',
      beneficiaryEvidenceDocumentVersionId: SEED_IDS.complaintVersion,
      note: 'A backdated approval must not be accepted.', explicitHumanApproval: true,
    }, audit)).toThrow(/after preparation/i);
    expect(() => store.approveClientPayment(finance, SEED_IDS.northstarMatter, payment.id, {
      expectedVersion: 1, idempotencyKey: 'self-approve-payment', approvedAt: '2026-10-05T12:05:00.000Z',
      beneficiaryEvidenceDocumentVersionId: SEED_IDS.complaintVersion, note: 'Same-person approval attempt.', explicitHumanApproval: true,
    }, audit)).toThrowError(expect.objectContaining({ code: 'INDEPENDENCE_REQUIRED' }));
    const approved = store.approveClientPayment(partner, SEED_IDS.northstarMatter, payment.id, {
      expectedVersion: 1, idempotencyKey: 'approve-payment-001', approvedAt: '2026-10-05T12:05:00.000Z',
      beneficiaryEvidenceDocumentVersionId: SEED_IDS.complaintVersion,
      note: 'Beneficiary and available client balance independently verified.', explicitHumanApproval: true,
    }, audit);
    expect(approved.status).toBe('approved');
    const competing = store.prepareClientPayment(finance, SEED_IDS.northstarMatter, {
      idempotencyKey: 'prepare-competing-payment', clientPartyId: SEED_IDS.northstarClient,
      bankAccountId: 'a1300000-0000-4000-8000-000000000001', amountMinor: 40_000,
      purpose: 'Competing payment must not consume already reserved client funds.', beneficiaryName: 'Maya Clarke',
      beneficiaryFingerprint: 'b'.repeat(64), beneficiaryEvidenceDocumentVersionId: SEED_IDS.complaintVersion,
      requestedPaymentMethod: 'bank_transfer', explicitHumanConfirmation: true,
    }, audit);
    expect(() => store.approveClientPayment(partner, SEED_IDS.northstarMatter, competing.id, {
      expectedVersion: 1, idempotencyKey: 'approve-competing-payment', approvedAt: '2026-10-05T12:06:00.000Z',
      beneficiaryEvidenceDocumentVersionId: SEED_IDS.complaintVersion,
      note: 'Independent check must account for the existing reserved payment.', explicitHumanApproval: true,
    }, audit)).toThrow(/exceeds.*funds/i);
    expect(database.prepare(`SELECT COUNT(*) AS count FROM finance_journals WHERE source_id=?`).get(payment.id)).toEqual({ count: 0 });
    const completed = store.recordClientPayment(finance, SEED_IDS.northstarMatter, payment.id, {
      expectedVersion: approved.version, idempotencyKey: 'record-payment-001', completedAt: '2026-10-05T12:10:00.000Z',
      evidenceDocumentVersionId: SEED_IDS.complaintVersion, note: 'External bank completion evidence checked and retained.', explicitHumanConfirmation: true,
    }, audit);
    expect(completed).toMatchObject({ status: 'recorded_external', version: 4 });
    expect(store.getMatterMoney(finance, SEED_IDS.northstarMatter, SEED_IDS.northstarClient).clientAvailableMinor).toBe(35_000);
    store.prepareClientPayment(finance, SEED_IDS.northstarMatter, {
      idempotencyKey: 'prepare-changed-beneficiary', clientPartyId: SEED_IDS.northstarClient,
      bankAccountId: 'a1300000-0000-4000-8000-000000000001', amountMinor: 5_000,
      purpose: 'Second refund request with changed beneficiary account details.', beneficiaryName: 'Maya Clarke',
      beneficiaryFingerprint: 'c'.repeat(64), beneficiaryEvidenceDocumentVersionId: SEED_IDS.complaintVersion,
      requestedPaymentMethod: 'bank_transfer', explicitHumanConfirmation: true,
    }, audit);
    expect(database.prepare(`SELECT severity FROM finance_exceptions WHERE firm_id=? AND matter_id=?
      AND exception_kind='changed_beneficiary'`).get(finance.firmId, SEED_IDS.northstarMatter)).toEqual({ severity: 'blocker' });
  });
});
