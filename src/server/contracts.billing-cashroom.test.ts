import { describe, expect, it } from 'vitest';

import {
  allocateFinanceReceiptSchema,
  approveFinanceBillSchema,
  approveFinanceClientPaymentSchema,
  completeFinanceReconciliationSchema,
  importFinanceBankStatementSchema,
  issueFinanceBillSchema,
  prepareFinanceBillSchema,
  recordFinanceBillDeliverySchema,
} from '../shared/contracts.js';

const uuid = () => crypto.randomUUID();

describe('billing and cashroom contracts', () => {
  it('exports strict governed billing and cashroom schemas', () => {
    expect(prepareFinanceBillSchema).toBeDefined();
    expect(approveFinanceBillSchema).toBeDefined();
    expect(issueFinanceBillSchema).toBeDefined();
    expect(recordFinanceBillDeliverySchema).toBeDefined();
    expect(importFinanceBankStatementSchema).toBeDefined();
    expect(allocateFinanceReceiptSchema).toBeDefined();
    expect(approveFinanceClientPaymentSchema).toBeDefined();
    expect(completeFinanceReconciliationSchema).toBeDefined();
  });

  it('rejects decimal money and autonomous issue or posting authority', () => {
    expect(() => prepareFinanceBillSchema.parse({
      idempotencyKey: 'bill-draft-001',
      dueOn: '2026-08-20',
      clientPartyId: uuid(),
      sourceEntries: [{ sourceKind: 'time', sourceId: uuid(), netMinor: 14_800.5, narrative: 'Review of the repair evidence.' }],
      adjustments: [],
    })).toThrow();

    expect(() => issueFinanceBillSchema.parse({
      expectedVersion: 3,
      idempotencyKey: 'bill-issue-001',
      taxPoint: '2026-07-21',
      explicitHumanConfirmation: true,
      aiApproved: true,
    })).toThrow();
  });

  it('requires exact delivery evidence and leaves bill issue separate from delivery', () => {
    expect(() => recordFinanceBillDeliverySchema.parse({
      expectedVersion: 4,
      idempotencyKey: 'bill-delivery-001',
      deliveredAt: '2026-07-21T10:00:00.000Z',
      channel: 'email',
      recipient: 'Client',
      evidenceDocumentVersionId: null,
      explicitHumanConfirmation: true,
    })).toThrow('Bill delivery requires exact retained evidence.');
  });

  it('requires receipt allocations to identify exactly one client/office/suspense designation', () => {
    const result = allocateFinanceReceiptSchema.parse({
      expectedVersion: 1,
      idempotencyKey: 'receipt-allocate-001',
      allocations: [
        { designation: 'client', matterId: uuid(), clientPartyId: uuid(), billId: null, amountMinor: 10_000 },
        { designation: 'office', matterId: uuid(), clientPartyId: uuid(), billId: uuid(), amountMinor: 5_000 },
      ],
      note: 'The mixed receipt split was checked against exact remittance evidence.',
      explicitHumanConfirmation: true,
    });
    expect(result.allocations.map(({ designation }) => designation)).toEqual(['client', 'office']);

    expect(() => allocateFinanceReceiptSchema.parse({
      expectedVersion: 1,
      idempotencyKey: 'receipt-allocate-002',
      allocations: [{ designation: 'both', matterId: uuid(), clientPartyId: uuid(), billId: null, amountMinor: 15_000 }],
      note: 'Attempted conflated client and office allocation.',
      explicitHumanConfirmation: true,
    })).toThrow();
  });

  it('keeps imported bank activity provisional and reconciliation human-controlled', () => {
    expect(() => importFinanceBankStatementSchema.parse({
      idempotencyKey: 'bank-import-001', bankAccountId: uuid(), statementFrom: '2026-07-01',
      statementTo: '2026-07-21', openingBalanceMinor: 0, closingBalanceMinor: 15_000,
      currency: 'GBP', evidenceDocumentVersionId: uuid(), rawChecksum: 'a'.repeat(64),
      automaticallyPost: true,
    })).toThrow();
    expect(() => completeFinanceReconciliationSchema.parse({
      expectedVersion: 2, idempotencyKey: 'reconciliation-complete-001',
      completedAt: '2026-07-21T12:00:00.000Z', explicitHumanConfirmation: false,
    })).toThrow();
  });
});
