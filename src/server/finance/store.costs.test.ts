import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import { FinanceStore } from './store.js';

const now = () => new Date('2026-07-19T12:00:00.000Z');
const audit = { requestId: 'finance-costs-store-test', ipAddress: '127.0.0.1' };
const users = {
  ava: { id: SEED_IDS.ava, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal', email: 'ava@northstar.test', name: 'Ava Morgan', role: 'solicitor' },
  partner: { id: SEED_IDS.partner, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal', email: 'partner@northstar.test', name: 'Marcus Reed', role: 'partner' },
  finance: { id: SEED_IDS.finance, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal', email: 'finance@northstar.test', name: 'Priya Shah', role: 'finance' },
} satisfies Record<string, SessionUser>;

describe('FinanceStore estimates, warnings and disbursements', () => {
  let database: DatabaseSync;
  let store: FinanceStore;

  beforeEach(() => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    store = new FinanceStore(database, now);
  });
  afterEach(() => database.close());

  function addEstimate(overallLimitMinor = 10_000, key = 'estimate-version-001') {
    return store.addEstimateVersion(users.partner, SEED_IDS.northstarMatter, {
      idempotencyKey: key, effectiveOn: '2026-07-19',
      scope: 'Professional fees and approved disbursements through the current litigation phase.',
      feesMinor: overallLimitMinor, disbursementsMinor: 0, vatMinor: 0,
      overallLimitMinor, currency: 'GBP', reviewOn: '2026-08-19',
      sourceDocumentVersionId: SEED_IDS.complaintVersion,
      approvalNote: 'Estimate, scope, source and client cost limit independently checked.',
      explicitApproval: true,
    }, audit);
  }

  function approveEightThousandWip() {
    const card = store.createRateCard(users.finance, {
      idempotencyKey: 'warning-rate-card', name: 'Warning test rate',
      description: 'Synthetic rate used to prove estimate threshold warnings.', currency: 'GBP',
    }, audit);
    const rate = store.addRateVersion(users.finance, card.id, {
      expectedVersion: 1, idempotencyKey: 'warning-rate-version', effectiveFrom: '2026-01-01', effectiveTo: null,
      entries: [{ grade: 'solicitor', userId: users.ava.id, activityCode: '', matterId: null, hourlyRateMinor: 8_000, currency: 'GBP' }],
      note: 'Exact synthetic fee-earner rate prepared for independent approval.',
    }, audit);
    store.activateRateVersion(users.partner, card.id, {
      expectedVersion: 2, idempotencyKey: 'warning-rate-activation', rateVersionId: rate.id,
      approvedAt: '2026-07-19T12:10:00.000Z',
      approvalNote: 'Synthetic rate checked independently before activation.', explicitHumanApproval: true,
    }, audit);
    const time = store.submitTime(users.ava, SEED_IDS.northstarMatter, {
      idempotencyKey: 'warning-time-submit', workDate: '2026-07-19', minutes: 60,
      narrative: 'Completed a substantive review of evidence and procedural next steps.',
      activityCode: 'case_progression', costsPhase: 'case_management', chargeable: true,
      sourceKind: 'manual', sourceId: null,
    }, audit);
    return store.approveTime(users.partner, SEED_IDS.northstarMatter, time.id, {
      expectedVersion: 1, idempotencyKey: 'warning-time-approve',
      approvedAt: '2026-07-19T12:20:00.000Z',
      approvalNote: 'Time and exact applicable rate independently checked for WIP.', explicitHumanApproval: true,
    }, audit);
  }

  it('opens a warning once approved exposure crosses the configured threshold', () => {
    addEstimate();
    approveEightThousandWip();

    expect(store.getWorkspace(users.partner, SEED_IDS.northstarMatter)?.warnings)
      .toContainEqual(expect.objectContaining({ thresholdPercent: 80, state: 'open', exposureMinor: 8_000 }));
    expect(store.getWorkspace(users.partner, SEED_IDS.northstarMatter)?.warnings)
      .not.toContainEqual(expect.objectContaining({ thresholdPercent: 100 }));
    expect(database.prepare("SELECT COUNT(*) AS count FROM integration_outbox WHERE topic = 'finance.estimate_warning_opened'").get())
      .toEqual({ count: 1 });
  });

  it('closes old warnings when an approved estimate version supersedes the limit', () => {
    addEstimate();
    approveEightThousandWip();
    addEstimate(20_000, 'estimate-version-002');

    const warnings = store.getWorkspace(users.partner, SEED_IDS.northstarMatter)?.warnings ?? [];
    expect(warnings).toContainEqual(expect.objectContaining({ thresholdPercent: 80, state: 'closed_by_new_estimate' }));
    expect(store.getWorkspace(users.partner, SEED_IDS.northstarMatter)?.snapshot.estimate)
      .toMatchObject({ overallLimitMinor: 20_000, currentExposureMinor: 8_000, varianceMinor: 12_000 });
  });

  it('keeps incurred, paid, billed and recovered disbursement facts distinct', () => {
    const proposed = store.createDisbursement(users.finance, SEED_IDS.northstarMatter, {
      idempotencyKey: 'create-disbursement-001', supplier: 'Acme Medical Reports Ltd',
      invoiceReference: 'INV-0042', category: 'expert_report',
      description: 'Independent expert report invoice retained as exact evidence.',
      netMinor: 30_000, vatMinor: 6_000, grossMinor: 36_000, currency: 'GBP',
      invoiceDate: '2026-07-10', dueOn: '2026-08-09', sourceDocumentVersionId: SEED_IDS.complaintVersion,
    }, audit);
    const approved = store.recordDisbursementEvent(users.finance, SEED_IDS.northstarMatter, proposed.id, {
      expectedVersion: 1, idempotencyKey: 'approve-disbursement-001', eventType: 'approved',
      occurredAt: '2026-07-19T12:10:00.000Z', evidenceDocumentVersionId: SEED_IDS.complaintVersion,
      note: 'Invoice amount, supplier, matter allocation and evidence checked.',
    }, audit);
    const incurred = store.recordDisbursementEvent(users.finance, SEED_IDS.northstarMatter, proposed.id, {
      expectedVersion: approved.version, idempotencyKey: 'incur-disbursement-001', eventType: 'incurred',
      occurredAt: '2026-07-19T12:20:00.000Z', evidenceDocumentVersionId: SEED_IDS.complaintVersion,
      note: 'Liability to the supplier recorded against the retained invoice.',
    }, audit);
    const paid = store.recordDisbursementEvent(users.finance, SEED_IDS.northstarMatter, proposed.id, {
      expectedVersion: incurred.version, idempotencyKey: 'pay-disbursement-001', eventType: 'paid_external',
      occurredAt: '2026-07-19T12:30:00.000Z', evidenceDocumentVersionId: SEED_IDS.complaintVersion,
      note: 'External payment evidence retained without creating a SwiftClaim cash posting.',
    }, audit);

    expect(paid).toMatchObject({
      status: 'paid_external', approved: true, incurred: true,
      paidExternally: true, billed: false, recovered: false,
    });
    expect(database.prepare('SELECT COUNT(*) AS count FROM finance_journals').get()).toEqual({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM finance_journal_events').get()).toEqual({ count: 0 });
    expect(() => database.prepare('UPDATE finance_disbursements SET gross_minor = 1').run()).toThrow(/immutable/i);
  });

  it('requires exact retained evidence for an external payment fact', () => {
    const proposed = store.createDisbursement(users.finance, SEED_IDS.northstarMatter, {
      idempotencyKey: 'create-disbursement-no-evidence', supplier: 'Court Service', invoiceReference: '',
      category: 'court_fee', description: 'Issue fee recorded for controlled external payment testing.',
      netMinor: 45_500, vatMinor: 0, grossMinor: 45_500, currency: 'GBP',
      invoiceDate: '2026-07-18', dueOn: null, sourceDocumentVersionId: null,
    }, audit);
    const approved = store.recordDisbursementEvent(users.finance, SEED_IDS.northstarMatter, proposed.id, {
      expectedVersion: 1, idempotencyKey: 'approve-court-fee', eventType: 'approved',
      occurredAt: '2026-07-19T12:10:00.000Z', evidenceDocumentVersionId: null,
      note: 'Court fee approved as a liability before payment is evidenced.',
    }, audit);
    const incurred = store.recordDisbursementEvent(users.finance, SEED_IDS.northstarMatter, proposed.id, {
      expectedVersion: approved.version, idempotencyKey: 'incur-court-fee', eventType: 'incurred',
      occurredAt: '2026-07-19T12:20:00.000Z', evidenceDocumentVersionId: null,
      note: 'Court fee incurred but no payment fact has yet been recorded.',
    }, audit);
    expect(() => store.recordDisbursementEvent(users.finance, SEED_IDS.northstarMatter, proposed.id, {
      expectedVersion: incurred.version, idempotencyKey: 'pay-court-fee-without-evidence', eventType: 'paid_external',
      occurredAt: '2026-07-19T12:30:00.000Z', evidenceDocumentVersionId: null,
      note: 'This payment attempt must fail because exact evidence is absent.',
    }, audit)).toThrow(/evidence/i);
  });

  it('rejects estimate and disbursement evidence from another matter', () => {
    expect(() => store.addEstimateVersion(users.partner, SEED_IDS.northstarRestrictedMatter, {
      idempotencyKey: 'cross-matter-estimate', effectiveOn: '2026-07-19',
      scope: 'Deliberately invalid cross-matter estimate source for tenant safety testing.',
      feesMinor: 10_000, disbursementsMinor: 0, vatMinor: 0, overallLimitMinor: 10_000,
      currency: 'GBP', reviewOn: null, sourceDocumentVersionId: SEED_IDS.complaintVersion,
      approvalNote: 'This exact source belongs to another matter and must be rejected.', explicitApproval: true,
    }, audit)).toThrowError(expect.objectContaining({ code: 'INVALID_LINK' }));
  });
});
