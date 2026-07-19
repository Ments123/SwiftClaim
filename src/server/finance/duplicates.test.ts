import { describe, expect, it } from 'vitest';

import { findPotentialDisbursementDuplicates } from './duplicates.js';

describe('disbursement duplicate findings', () => {
  const existing = [{
    id: 'disbursement-1', supplier: 'Acme Medical Reports Ltd.',
    invoiceReference: 'INV-0042', grossMinor: 36_000, invoiceDate: '2026-07-10',
  }];

  it('returns a deterministic provisional blocker for a normalised exact match', () => {
    const candidate = {
      supplier: '  ACME medical reports limited ', invoiceReference: 'inv 0042',
      grossMinor: 36_000, invoiceDate: '2026-07-10',
    };
    const findings = findPotentialDisbursementDuplicates(existing, candidate);

    expect(findings).toEqual(findPotentialDisbursementDuplicates(existing, candidate));
    expect(findings).toEqual([expect.objectContaining({
      existingDisbursementId: 'disbursement-1', confidence: 'high',
      matchedFields: ['supplier', 'invoice_reference', 'gross_minor', 'invoice_date'],
      label: 'Possible duplicate — human review required', provisional: true,
      blocksAutomaticApproval: true,
    })]);
    expect(findings[0]).not.toHaveProperty('finalDecision');
  });

  it('flags supplier/amount/reference matches even when the invoice date differs', () => {
    expect(findPotentialDisbursementDuplicates(existing, {
      supplier: 'Acme Medical Reports', invoiceReference: 'INV0042',
      grossMinor: 36_000, invoiceDate: '2026-07-11',
    })).toEqual([expect.objectContaining({ confidence: 'medium' })]);
  });

  it('does not flag amount-only or supplier-only coincidences', () => {
    expect(findPotentialDisbursementDuplicates(existing, {
      supplier: 'Different Expert Ltd', invoiceReference: 'OTHER-1',
      grossMinor: 36_000, invoiceDate: '2026-07-10',
    })).toEqual([]);
    expect(findPotentialDisbursementDuplicates(existing, {
      supplier: 'Acme Medical Reports Ltd', invoiceReference: 'OTHER-2',
      grossMinor: 10_000, invoiceDate: '2026-07-12',
    })).toEqual([]);
  });
});
