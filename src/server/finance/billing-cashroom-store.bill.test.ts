import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, seedCommunicationsEvaluation, seedDatabase, seedFinanceEvaluation, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import { BillingCashroomStore, type GeneratedBillFile } from './billing-cashroom-store.js';

const fixedNow = () => new Date('2026-10-05T12:00:00.000Z');
const audit = { requestId: 'billing-store-test', ipAddress: '127.0.0.1' };
const partner: SessionUser = { id: SEED_IDS.partner, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal', email: 'partner@northstar.test', name: 'Marcus Reed', role: 'partner' };
const solicitor: SessionUser = { id: SEED_IDS.ava, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal', email: 'ava@northstar.test', name: 'Ava Morgan', role: 'solicitor' };
const finance: SessionUser = { id: SEED_IDS.finance, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal', email: 'finance@northstar.test', name: 'Priya Shah', role: 'finance' };
const otherFirm: SessionUser = { id: SEED_IDS.southbankUser, firmId: SEED_IDS.southbankFirm, firmName: 'Southbank Law', email: 'oliver@southbank.test', name: 'Oliver Grant', role: 'partner' };

describe('BillingCashroomStore bill lifecycle', () => {
  let database: DatabaseSync;
  let store: BillingCashroomStore;
  let written: GeneratedBillFile[];

  beforeEach(async () => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    await seedCommunicationsEvaluation(database);
    seedFinanceEvaluation(database);
    written = [];
    store = new BillingCashroomStore(database, fixedNow, (document) => {
      const bytes = new TextEncoder().encode(document.content);
      const generated = {
        storageKey: `generated-${document.billReference}`,
        sizeBytes: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        ...document,
      };
      written.push(generated);
      return generated;
    });
    configureBilling();
  });

  afterEach(() => database.close());

  function configureBilling() {
    const insertAccount = database.prepare(`INSERT INTO finance_accounts (
      id, firm_id, code, name, account_class, designation, currency, active, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, 'office', 'GBP', 1, ?, ?)`);
    insertAccount.run('a1000000-0000-4000-8000-000000000001', partner.firmId, 'TRADE-DEBTORS', 'Trade debtors', 'office_asset', finance.id, fixedNow().toISOString());
    insertAccount.run('a1000000-0000-4000-8000-000000000002', partner.firmId, 'FEE-INCOME', 'Fee income', 'income', finance.id, fixedNow().toISOString());
    insertAccount.run('a1000000-0000-4000-8000-000000000003', partner.firmId, 'VAT-CONTROL', 'VAT control', 'vat_control', finance.id, fixedNow().toISOString());
    database.prepare(`INSERT INTO finance_vat_profiles (
      id, firm_id, name, registration_number_masked, created_by, created_at
    ) VALUES (?, ?, 'Northstar VAT', 'GB *** 1234', ?, ?)`).run(
      'a2000000-0000-4000-8000-000000000001', partner.firmId, finance.id, fixedNow().toISOString(),
    );
    database.prepare(`INSERT INTO finance_vat_rates (
      id, firm_id, vat_profile_id, treatment, rate_numerator, rate_denominator,
      effective_from, effective_to, note, approved_by, approved_at
    ) VALUES (?, ?, ?, 'standard', 20, 100, '2026-01-01', NULL, ?, ?, ?)`).run(
      'a3000000-0000-4000-8000-000000000001', partner.firmId,
      'a2000000-0000-4000-8000-000000000001', 'Approved UK standard VAT rate.', partner.id,
      '2026-01-01T00:00:00.000Z',
    );
    database.prepare(`INSERT INTO finance_bill_series (
      id, firm_id, prefix, year_pattern, next_number, padding, active, created_by, created_at
    ) VALUES (?, ?, 'SC-', 'YYYY-', 1, 6, 1, ?, ?)`).run(
      'a4000000-0000-4000-8000-000000000001', partner.firmId, finance.id, fixedNow().toISOString(),
    );
  }

  function eligibleSources() {
    const time = database.prepare(`SELECT a.time_entry_id AS id, a.charge_minor AS netMinor
      FROM finance_time_approvals a JOIN finance_time_entry_events e
        ON e.time_entry_id = a.time_entry_id AND e.firm_id = a.firm_id AND e.matter_id = a.matter_id
      WHERE a.firm_id = ? AND a.matter_id = ? AND e.event_type = 'approved' LIMIT 1`)
      .get(partner.firmId, SEED_IDS.northstarMatter) as { id: string; netMinor: number };
    const disbursement = database.prepare(`SELECT d.id, d.net_minor AS netMinor
      FROM finance_disbursements d WHERE d.firm_id = ? AND d.matter_id = ?
      AND (SELECT e.event_type FROM finance_disbursement_events e WHERE e.disbursement_id = d.id
        ORDER BY e.sequence DESC LIMIT 1) = 'incurred' LIMIT 1`)
      .get(partner.firmId, SEED_IDS.northstarMatter) as { id: string; netMinor: number };
    return { time, disbursement };
  }

  function prepare(key = 'prepare-bill-001') {
    const { time, disbursement } = eligibleSources();
    return store.prepareBill(solicitor, SEED_IDS.northstarMatter, {
      idempotencyKey: key,
      clientPartyId: SEED_IDS.northstarClient,
      dueOn: '2026-11-04',
      sourceEntries: [
        { sourceKind: 'time' as const, sourceId: time.id, netMinor: time.netMinor, narrative: 'Approved housing conditions legal work' },
        { sourceKind: 'disbursement' as const, sourceId: disbursement.id, netMinor: disbursement.netMinor, narrative: 'Court issue fee incurred for this matter' },
      ],
      adjustments: [{ adjustmentKind: 'reduction' as const, sourceId: time.id, amountMinor: 2_000, reason: 'Agreed partner reduction before submission.' }],
    }, audit);
  }

  function approve(prepared = prepare()) {
    const submitted = store.submitBill(solicitor, SEED_IDS.northstarMatter, prepared.id, {
      expectedVersion: prepared.version, idempotencyKey: 'submit-bill-001',
      note: 'Exact sources and explicit reduction checked before independent review.', explicitHumanConfirmation: true,
    }, audit);
    return store.approveBill(partner, SEED_IDS.northstarMatter, prepared.id, {
      expectedVersion: submitted.version, idempotencyKey: 'approve-bill-001',
      approvedAt: '2026-10-05T12:10:00.000Z', note: 'The exact submitted bill version was independently checked.', explicitHumanApproval: true,
    }, audit);
  }

  it('prepares exact eligible sources with explicit reductions and tenant isolation', () => {
    const bill = prepare();
    expect(bill).toMatchObject({ status: 'draft', version: 1, currency: 'GBP', clientPartyId: SEED_IDS.northstarClient });
    expect(bill.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKind: 'time', netMinor: 48_000 }),
      expect.objectContaining({ sourceKind: 'disbursement', netMinor: 45_500 }),
      expect.objectContaining({ sourceKind: 'adjustment', netMinor: 2_000 }),
    ]));
    expect(bill.netMinor).toBe(91_500);
    expect(store.getBill(otherFirm, SEED_IDS.northstarMatter, bill.id)).toBeNull();
    expect(() => store.prepareBill(otherFirm, SEED_IDS.northstarMatter, {
      idempotencyKey: 'cross-tenant-bill', clientPartyId: SEED_IDS.northstarClient, dueOn: '2026-11-04',
      sourceEntries: [{ sourceKind: 'time', sourceId: eligibleSources().time.id, netMinor: 1, narrative: 'Cross tenant source attempt' }], adjustments: [],
    }, audit)).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('issues once with sequential numbering, exact document, source consumption and a posted balanced journal', () => {
    const approved = approve();
    const issued = store.issueBill(finance, SEED_IDS.northstarMatter, approved.id, {
      expectedVersion: approved.version, idempotencyKey: 'issue-bill-001', taxPoint: '2026-10-05', explicitHumanConfirmation: true,
    }, audit);

    expect(issued).toMatchObject({ status: 'issued', version: 4, billReference: 'SC-2026-000001', taxPoint: '2026-10-05' });
    expect(issued.vatMinor).toBe(9_200);
    expect(issued.grossMinor).toBe(100_700);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ billReference: 'SC-2026-000001', mimeType: 'text/html' });
    expect(written[0]!.content).toContain('SC-2026-000001');
    expect(database.prepare('SELECT sha256 FROM finance_bill_documents WHERE bill_id = ?').get(issued.id))
      .toEqual({ sha256: written[0]!.sha256 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM finance_bill_source_allocations WHERE bill_id = ?').get(issued.id))
      .toEqual({ count: 2 });
    expect(database.prepare(`SELECT COUNT(*) AS count FROM finance_journal_events e
      JOIN finance_journals j ON j.id = e.journal_id WHERE j.source_id = ? AND e.event_type = 'posted'`).get(issued.id))
      .toEqual({ count: 1 });
    expect(() => store.issueBill(finance, SEED_IDS.northstarMatter, issued.id, {
      expectedVersion: issued.version, idempotencyKey: 'issue-bill-again', taxPoint: '2026-10-05', explicitHumanConfirmation: true,
    }, audit)).toThrow(/issued|state/i);
    expect(store.issueBill(finance, SEED_IDS.northstarMatter, approved.id, {
      expectedVersion: approved.version, idempotencyKey: 'issue-bill-001', taxPoint: '2026-10-05', explicitHumanConfirmation: true,
    }, audit)).toEqual(issued);
  });

  it('does not consume a source at draft and blocks it from a second issued bill', () => {
    const first = approve();
    const second = prepare('prepare-bill-002');
    expect(database.prepare('SELECT COUNT(*) AS count FROM finance_bill_source_allocations').get()).toEqual({ count: 0 });
    store.issueBill(finance, SEED_IDS.northstarMatter, first.id, {
      expectedVersion: first.version, idempotencyKey: 'issue-first-competing-bill', taxPoint: '2026-10-05', explicitHumanConfirmation: true,
    }, audit);
    const secondSubmitted = store.submitBill(solicitor, SEED_IDS.northstarMatter, second.id, {
      expectedVersion: second.version, idempotencyKey: 'submit-second-bill',
      note: 'Second competing draft submitted for the concurrency regression.', explicitHumanConfirmation: true,
    }, audit);
    const secondApproved = store.approveBill(partner, SEED_IDS.northstarMatter, second.id, {
      expectedVersion: secondSubmitted.version, idempotencyKey: 'approve-second-bill', approvedAt: '2026-10-05T12:20:00.000Z',
      note: 'Second bill approved before issue eligibility was rechecked.', explicitHumanApproval: true,
    }, audit);
    expect(() => store.issueBill(finance, SEED_IDS.northstarMatter, second.id, {
      expectedVersion: secondApproved.version, idempotencyKey: 'issue-second-competing-bill', taxPoint: '2026-10-05', explicitHumanConfirmation: true,
    }, audit)).toThrow(/consumed|eligible/i);
    expect(database.prepare('SELECT next_number FROM finance_bill_series WHERE firm_id = ?').get(partner.firmId)).toEqual({ next_number: 2 });
    expect(written).toHaveLength(1);
  });

  it('records delivery only with exact same-matter evidence and rolls back every issue fact if generation fails', () => {
    const approved = approve();
    const failing = new BillingCashroomStore(database, fixedNow, () => { throw new Error('renderer failed'); });
    expect(() => failing.issueBill(finance, SEED_IDS.northstarMatter, approved.id, {
      expectedVersion: approved.version, idempotencyKey: 'issue-render-failure', taxPoint: '2026-10-05', explicitHumanConfirmation: true,
    }, audit)).toThrow(/renderer failed/);
    expect(database.prepare('SELECT next_number FROM finance_bill_series WHERE firm_id = ?').get(partner.firmId)).toEqual({ next_number: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM finance_bill_source_allocations').get()).toEqual({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM finance_bill_documents').get()).toEqual({ count: 0 });

    const issued = store.issueBill(finance, SEED_IDS.northstarMatter, approved.id, {
      expectedVersion: approved.version, idempotencyKey: 'issue-after-render-failure', taxPoint: '2026-10-05', explicitHumanConfirmation: true,
    }, audit);
    expect(() => store.recordBillDelivery(finance, SEED_IDS.northstarMatter, issued.id, {
      expectedVersion: issued.version, idempotencyKey: 'deliver-wrong-evidence', deliveredAt: '2026-10-05T13:00:00.000Z',
      channel: 'email', recipient: 'Maya Clarke', evidenceDocumentVersionId: SEED_IDS.bedroomPhotoVersion,
      explicitHumanConfirmation: true,
    }, audit)).not.toThrow();
    const delivered = store.getBill(finance, SEED_IDS.northstarMatter, issued.id)!;
    expect(delivered).toMatchObject({ status: 'delivered', version: 5, deliveredAt: '2026-10-05T13:00:00.000Z' });
  });

  it('issues an independently approved credit as a separate document and journal without rewriting the bill', () => {
    const approved = approve();
    const issued = store.issueBill(finance, SEED_IDS.northstarMatter, approved.id, {
      expectedVersion: approved.version, idempotencyKey: 'issue-bill-for-credit', taxPoint: '2026-10-05', explicitHumanConfirmation: true,
    }, audit);
    const timeLine = issued.lines.find((line) => line.sourceKind === 'time')!;
    const credit = store.prepareCreditNote(partner, SEED_IDS.northstarMatter, issued.id, {
      idempotencyKey: 'prepare-credit-note-001', reason: 'A specific portion of the approved time charge is being credited.',
      lines: [{ billLineId: timeLine.id, netMinor: 1_000, vatMinor: 200 }], explicitHumanConfirmation: true,
    }, audit);
    expect(() => store.issueCreditNote(partner, SEED_IDS.northstarMatter, credit.id, {
      expectedVersion: credit.version, idempotencyKey: 'self-issue-credit-note',
      issuedAt: '2026-10-05T13:00:00.000Z', explicitHumanApproval: true,
    }, audit)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    const issuedCredit = store.issueCreditNote(finance, SEED_IDS.northstarMatter, credit.id, {
      expectedVersion: credit.version, idempotencyKey: 'issue-credit-note-001',
      issuedAt: '2026-10-05T13:00:00.000Z', explicitHumanApproval: true,
    }, audit);
    expect(issuedCredit).toMatchObject({ status: 'issued', version: 3, creditReference: 'CN-SC-2026-000001-001', grossMinor: 1_200 });
    expect(store.getBill(finance, SEED_IDS.northstarMatter, issued.id)).toMatchObject({
      grossMinor: 100_700, creditedMinor: 1_200, outstandingMinor: 99_500,
    });
    expect(database.prepare(`SELECT COUNT(*) AS count FROM finance_journal_events e JOIN finance_journals j
      ON j.id = e.journal_id WHERE j.source_id = ? AND e.event_type = 'posted'`).get(credit.id)).toEqual({ count: 1 });
    expect(() => database.prepare('UPDATE finance_credit_note_lines SET net_minor = 1').run()).toThrow(/immutable/i);
    expect(() => database.prepare('UPDATE finance_bill_versions SET gross_minor = 1').run()).toThrow(/immutable/i);
  });
});
