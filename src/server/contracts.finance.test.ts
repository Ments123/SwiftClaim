import { describe, expect, it } from 'vitest';

import {
  approveFinanceTimeSchema,
  createFinanceEstimateVersionSchema,
  decideFinanceActivitySuggestionSchema,
  prepareFinanceJournalSchema,
  recordFinanceDisbursementEventSchema,
  recordFinanceWarningEventSchema,
  startFinanceTimerSchema,
  stopFinanceTimerSchema,
  submitFinanceTimeSchema,
} from '../shared/contracts.js';

describe('finance contracts', () => {
  it('exports strict finance command schemas', () => {
    expect(decideFinanceActivitySuggestionSchema).toBeDefined();
    expect(submitFinanceTimeSchema).toBeDefined();
    expect(approveFinanceTimeSchema).toBeDefined();
    expect(createFinanceEstimateVersionSchema).toBeDefined();
    expect(recordFinanceDisbursementEventSchema).toBeDefined();
    expect(prepareFinanceJournalSchema).toBeDefined();
  });

  it('rejects decimal money and autonomous AI posting properties', () => {
    expect(() => submitFinanceTimeSchema.parse({
      idempotencyKey: 'finance-time-001', workDate: '2026-07-19', minutes: 37,
      narrative: 'Reviewed the exact repair evidence and prepared the chronology.',
      activityCode: 'DOCUMENT_REVIEW', costsPhase: 'witness_statements', chargeable: true,
      sourceKind: 'document_version', sourceId: crypto.randomUUID(), aiApproved: true,
    })).toThrow();
    expect(() => createFinanceEstimateVersionSchema.parse({
      idempotencyKey: 'finance-estimate-001', effectiveOn: '2026-07-19',
      scope: 'Estimated work through disclosure and witness evidence.', feesMinor: 10000.5,
      disbursementsMinor: 2000, vatMinor: 2400, overallLimitMinor: 14400,
      currency: 'GBP', reviewOn: '2026-08-19', sourceDocumentVersionId: null,
      approvalNote: 'The exact scope and monetary values were reviewed.', explicitApproval: true,
    })).toThrow();
  });

  it('requires exact evidence for an externally paid disbursement', () => {
    expect(() => recordFinanceDisbursementEventSchema.parse({
      expectedVersion: 1, idempotencyKey: 'finance-disbursement-001',
      eventType: 'paid_external', occurredAt: '2026-07-19T10:00:00.000Z',
      evidenceDocumentVersionId: null, note: 'The supplier payment was recorded externally.',
    })).toThrow();
  });

  it('reserves warning closure for the governed replacement-estimate transaction', () => {
    expect(() => recordFinanceWarningEventSchema.parse({
      expectedVersion: 1, idempotencyKey: 'finance-warning-close-001',
      eventType: 'closed_by_new_estimate', occurredAt: '2026-07-19T10:00:00.000Z',
      evidenceDocumentVersionId: crypto.randomUUID(),
      note: 'Attempt to close the warning without creating a replacement estimate.',
    })).toThrow();
  });

  it('keeps timer timestamps server-authoritative', () => {
    expect(startFinanceTimerSchema.parse({
      idempotencyKey: 'finance-timer-start-001', activityCode: 'case_progression',
      costsPhase: 'case_management', narrative: 'Reviewing the exact matter chronology.',
    })).not.toHaveProperty('startedAt');
    expect(stopFinanceTimerSchema.parse({
      expectedVersion: 1, idempotencyKey: 'finance-timer-stop-001',
    })).not.toHaveProperty('stoppedAt');
    expect(() => startFinanceTimerSchema.parse({
      idempotencyKey: 'finance-timer-start-002', startedAt: '2026-07-19T09:00:00.000Z',
      activityCode: 'case_progression', costsPhase: 'case_management',
      narrative: 'Attempting to choose a client-side timer timestamp.',
    })).toThrow();
    expect(() => stopFinanceTimerSchema.parse({
      expectedVersion: 1, idempotencyKey: 'finance-timer-stop-002',
      stoppedAt: '2026-07-19T09:30:00.000Z',
    })).toThrow();
  });

  it('accepts integer journal lines but leaves balancing to domain validation', () => {
    expect(prepareFinanceJournalSchema.parse({
      idempotencyKey: 'finance-journal-001', accountingDate: '2026-07-19',
      sourceKind: 'wip_control', sourceId: crypto.randomUUID(),
      description: 'Record approved time in the non-cash WIP control accounts.',
      lines: [
        { accountId: crypto.randomUUID(), debitMinor: 14800, creditMinor: 0, currency: 'GBP', matterId: crypto.randomUUID(), memo: 'WIP asset' },
        { accountId: crypto.randomUUID(), debitMinor: 0, creditMinor: 14800, currency: 'GBP', matterId: crypto.randomUUID(), memo: 'WIP offset' },
      ],
    }).lines).toHaveLength(2);
  });
});
