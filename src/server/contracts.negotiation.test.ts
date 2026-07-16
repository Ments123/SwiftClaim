import { describe, expect, it } from 'vitest';

import {
  concludeSettlementSchema,
  createNegotiationActionSchema,
  createSettlementAuthorityVersionSchema,
  recordClientInstructionSchema,
  recordSettlementObligationEventSchema,
} from '../shared/contracts.js';

const actionId = '10000000-0000-4000-8000-000000000001';
const actionVersionId = '10000000-0000-4000-8000-000000000002';
const communicationEntryId = '10000000-0000-4000-8000-000000000003';
const termsVersionId = '10000000-0000-4000-8000-000000000004';

describe('negotiation and settlement contracts', () => {
  it('requires explicit, sourced client instruction for exact external terms', () => {
    const base = {
      idempotencyKey: 'client-instruction-001',
      confidentiality: 'privileged' as const,
      reviewId: null,
      actionId,
      actionVersionId,
      instructionType: 'accept' as const,
      instructingPerson: 'Maya Clarke',
      relationshipToClient: 'self',
      authorityBasis: 'Client giving her own instructions.',
      decisionNote: 'Maya instructs acceptance of the exact terms reviewed.',
      receivedMethod: 'telephone' as const,
      receivedAt: '2026-08-20T09:00:00.000Z',
      identityStatus: 'confirmed' as const,
      identityNote: 'Name, address and matter context confirmed.',
      understandingConfirmed: true,
      accessibilityMeasures: 'Advice explained verbally and checked back.',
      sourceCommunicationEntryId: communicationEntryId,
      sourceDocumentVersionId: null,
      supersedesInstructionId: null,
      correctionReason: '',
      explicitClientInstruction: true,
    };

    expect(recordClientInstructionSchema.parse(base)).toMatchObject({
      actionVersionId,
      explicitClientInstruction: true,
    });
    expect(() => recordClientInstructionSchema.parse({
      ...base,
      explicitClientInstruction: false,
    })).toThrow();
    expect(() => recordClientInstructionSchema.parse({
      ...base,
      sourceCommunicationEntryId: null,
    })).toThrow();
  });

  it('requires a bounded authority source and coherent money limits', () => {
    const base = {
      idempotencyKey: 'authority-version-001',
      source: 'client_specific' as const,
      scope: 'Counteroffer for damages, works and costs.',
      actionTypes: ['counteroffer'] as const,
      minimumAmountMinor: 300_000,
      maximumAmountMinor: 250_000,
      nonMoneyConstraints: 'Repairs must remain included.',
      costsConstraints: 'Costs remain subject to separate agreement.',
      repairConstraints: 'Bathroom works must be independently inspected.',
      expiresAt: null,
      reviewOn: '2026-09-01',
      requiresClientInstruction: true,
      requiresPartnerApproval: true,
      sourceDocumentVersionId: null,
      reviewNote: 'Authority recorded from the synthetic client instruction.',
    };
    expect(() => createSettlementAuthorityVersionSchema.parse(base)).toThrow();
    expect(createSettlementAuthorityVersionSchema.parse({
      ...base,
      maximumAmountMinor: 350_000,
    })).toMatchObject({ minimumAmountMinor: 300_000, maximumAmountMinor: 350_000 });
  });

  it('keeps exact proposed terms structured and integer-valued', () => {
    const action = createNegotiationActionSchema.parse({
      idempotencyKey: 'negotiation-action-001',
      actionType: 'counteroffer',
      linkedOfferId: null,
      confidentiality: 'protected_negotiation',
      recipients: [{
        displayName: 'Meridian Housing Legal Team',
        endpointType: 'email',
        endpoint: 'fictional-legal@example.test',
      }],
      scope: 'whole_claim',
      scopeDescription: 'Synthetic full-claim counteroffer.',
      damagesMinor: 300_000,
      costsMinor: null,
      totalMinor: 300_000,
      currency: 'GBP',
      worksTerms: 'Complete the listed bathroom works within 28 days.',
      nonMoneyTerms: '',
      interestTreatment: 'Inclusive to the date of the synthetic counteroffer.',
      confidentialityTerms: 'Without prejudice save as to costs.',
      paymentTerms: 'Payment within 14 days of a recorded agreement.',
      proposedInstrumentType: 'settlement_agreement',
      documentVersionIds: [],
    });
    expect(action.damagesMinor).toBe(300_000);
    expect(() => createNegotiationActionSchema.parse({
      ...action,
      damagesMinor: 300_000.5,
    })).toThrow();
  });

  it('requires reviewed court approval and a retained instrument to conclude', () => {
    const base = {
      expectedVersion: 2,
      idempotencyKey: 'settlement-conclusion-001',
      termsVersionId,
      clientInstructionId: '10000000-0000-4000-8000-000000000005',
      courtApprovalPosition: 'unknown' as const,
      instrumentDocumentVersionId: null,
      sourceCommunicationEntryId: null,
      conclusionNote: 'The exact synthetic terms were agreed by authorised humans.',
      obligationsReviewed: true,
      explicitHumanConfirmation: true,
    };
    expect(() => concludeSettlementSchema.parse(base)).toThrow();
    expect(concludeSettlementSchema.parse({
      ...base,
      courtApprovalPosition: 'not_required_reviewed',
      instrumentDocumentVersionId: '10000000-0000-4000-8000-000000000006',
    })).toMatchObject({ explicitHumanConfirmation: true });
  });

  it('requires evidence for satisfaction and authority for waiver', () => {
    const base = {
      idempotencyKey: 'obligation-event-001',
      eventType: 'satisfied' as const,
      occurredAt: '2026-09-02T09:00:00.000Z',
      note: 'The obligation was checked against retained evidence.',
      amountSatisfiedMinor: null,
      evidenceDocumentVersionIds: [] as string[],
      evidenceCommunicationEntryIds: [] as string[],
      supersedesEventId: null,
      correctionReason: '',
      waiverAuthorityDocumentVersionId: null,
      explicitConfirmation: true,
    };
    expect(() => recordSettlementObligationEventSchema.parse(base)).toThrow();
    expect(recordSettlementObligationEventSchema.parse({
      ...base,
      evidenceCommunicationEntryIds: [communicationEntryId],
    })).toMatchObject({ eventType: 'satisfied' });
    expect(() => recordSettlementObligationEventSchema.parse({
      ...base,
      eventType: 'waived',
    })).toThrow();
  });
});
