import { describe, expect, it } from 'vitest';

import {
  approveLetterOfClaimSchema,
  createExpertEngagementSchema,
  recordExpertConflictCheckSchema,
  recordExpertQuestionSchema,
  recordLandlordResponseSchema,
  recordProtocolServiceEventSchema,
  saveLetterOfClaimSchema,
  selectExpertRouteSchema,
} from '../shared/contracts.js';

const id = (suffix: string) => `10000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

describe('protocol command contracts', () => {
  it('accepts a complete trimmed Letter of Claim draft and approval version', () => {
    const result = saveLetterOfClaimSchema.parse({
      expectedVersion: 1,
      claimantAddress: ' 18 Alder Court, Salford, M5 4QJ ',
      landlordRecipient: ' Meridian Housing Association ',
      landlordAddress: ' 1 Civic Square, Salford, M5 1AA ',
      effectNarrative: ' Damp and mould affect the family use of the bedroom. ',
      personalInjuryStatus: 'minor_gp_evidence',
      personalInjurySummary: ' GP attendance is recorded for asthma symptoms. ',
      specialDamagesStatus: 'under_review',
      specialDamagesSummary: '',
      accessWindows: [
        { date: '2026-07-20', from: '10:00', to: '13:00', notes: 'Call first.' },
      ],
      expertProposalSummary: 'A single joint building surveyor is proposed.',
      disclosureRequests: ['Tenancy file', 'Inspection and works records'],
      additionalContent: '',
      state: 'ready_for_review',
    });

    expect(result.claimantAddress).toBe('18 Alder Court, Salford, M5 4QJ');
    expect(approveLetterOfClaimSchema.parse({
      expectedVersion: 2,
      idempotencyKey: 'approve-letter-v1',
    })).toEqual({ expectedVersion: 2, idempotencyKey: 'approve-letter-v1' });
  });

  it('requires a confirmed legal trigger for receipt but not dispatch', () => {
    const base = {
      idempotencyKey: 'service-event-001',
      letterVersionId: id('1'),
      method: 'email',
      occurredAt: '2026-07-16T09:30:00.000Z',
      recipient: 'Meridian Housing Association',
      destination: 'repairs@example.test',
      sourceDetail: 'Delivery status reviewed by Ava Morgan.',
      supportingDocumentVersionId: null,
      supersedesEventId: null,
      correctionReason: '',
    };

    expect(recordProtocolServiceEventSchema.safeParse({
      ...base,
      eventType: 'dispatched',
      legalTriggerOn: null,
    }).success).toBe(true);
    expect(recordProtocolServiceEventSchema.safeParse({
      ...base,
      eventType: 'actual_receipt',
      legalTriggerOn: null,
    }).success).toBe(false);
    expect(recordProtocolServiceEventSchema.safeParse({
      ...base,
      eventType: 'actual_receipt',
      legalTriggerOn: '2026-07-16',
    }).success).toBe(true);
  });

  it('requires reasons for urgent or no-expert route decisions', () => {
    expect(selectExpertRouteSchema.safeParse({
      expectedVersion: 1,
      route: 'not_required',
      reason: '',
      urgentReason: '',
    }).success).toBe(false);
    expect(selectExpertRouteSchema.safeParse({
      expectedVersion: 1,
      route: 'urgent_own_expert',
      reason: 'A building surveyor is required to preserve evidence.',
      urgentReason: 'There is a documented risk that evidence will be lost.',
    }).success).toBe(true);
  });

  it('requires response defect positions except for an explicit no-response record', () => {
    const response = {
      idempotencyKey: 'landlord-response-001',
      responseType: 'initial',
      receivedOn: '2026-07-28',
      respondingParty: 'Meridian Housing Association',
      contactName: 'Synthetic Repairs Team',
      generalLiabilityPosition: 'partly_admitted',
      liabilityReasons: 'The response admits the bathroom leak only.',
      noticePosition: 'Notice is accepted from November 2025.',
      accessPosition: 'Further access is requested.',
      disclosureStatus: 'partial',
      disclosureSummary: 'Repair logs supplied; tenancy file outstanding.',
      expertProposalPosition: 'agreed',
      expertProposalSummary: 'The proposed single joint expert is agreed.',
      worksSchedule: 'Bathroom inspection proposed.',
      worksStartOn: null,
      worksCompleteOn: null,
      compensationOfferMinor: null,
      costsOfferMinor: null,
      currency: 'GBP',
      sourceDocumentVersionId: null,
      supersedesResponseId: null,
      correctionReason: '',
      defectPositions: [],
    };

    expect(recordLandlordResponseSchema.safeParse(response).success).toBe(false);
    expect(recordLandlordResponseSchema.safeParse({
      ...response,
      defectPositions: [
        { defectId: id('2'), position: 'admitted', reason: 'Leak accepted.' },
      ],
    }).success).toBe(true);
    expect(recordLandlordResponseSchema.safeParse({
      ...response,
      responseType: 'no_response_recorded',
      receivedOn: null,
      respondingParty: 'No response received',
      generalLiabilityPosition: 'no_response',
      disclosureStatus: 'none',
      expertProposalPosition: 'not_addressed',
      defectPositions: [],
    }).success).toBe(true);
  });

  it('keeps expert money integral and potential conflicts explicitly overridden', () => {
    const engagement = {
      route: 'proposed_single_joint',
      expertRole: 'building_surveyor',
      expertName: 'Elena Ward',
      organisation: 'Northfield Building Surveyors',
      email: 'elena@example.test',
      phone: '',
      expertise: 'Residential housing conditions',
      qualifications: 'Synthetic MRICS profile',
      registrationBody: 'RICS',
      registrationReference: 'SYNTHETIC-RICS-1042',
      verificationStatus: 'unverified',
      verificationMethod: '',
      verifiedOn: null,
      proposedBy: 'claimant',
      singleJoint: true,
      termsStatus: 'received',
      feeBasis: 'Fixed inspection and report fee',
      feeMinor: 95_000,
      currency: 'GBP',
      payerSplit: { claimantPercent: 50, landlordPercent: 50 },
      availabilitySummary: 'Inspection available within 15 working days.',
      targetReportOn: '2026-08-31',
    };
    expect(createExpertEngagementSchema.safeParse(engagement).success).toBe(true);
    expect(createExpertEngagementSchema.safeParse({
      ...engagement,
      feeMinor: 950.5,
    }).success).toBe(false);

    expect(recordExpertConflictCheckSchema.safeParse({
      idempotencyKey: 'expert-conflict-001',
      partiesChecked: ['Maya Clarke', 'Meridian Housing Association'],
      method: 'Written declaration and supplied conflict search',
      searchDetail: 'Synthetic evaluation check.',
      outcome: 'potential',
      decision: 'proceed_with_override',
      reason: 'Partner reviewed the disclosed historic instruction and approved progression.',
    }).success).toBe(true);
  });

  it('requires a report service date when CPR 35.6 is selected', () => {
    const question = {
      idempotencyKey: 'expert-question-001',
      reportId: id('3'),
      question: 'Please clarify which bedroom works are urgent.',
      clarificationPurpose: 'Clarify the prioritisation in paragraph 14.',
      dispatchedOn: '2026-09-01',
      responseDueOn: null,
      legalBasis: 'cpr35_6',
      reportServedOn: null,
    };
    expect(recordExpertQuestionSchema.safeParse(question).success).toBe(false);
    expect(recordExpertQuestionSchema.safeParse({
      ...question,
      reportServedOn: '2026-08-30',
    }).success).toBe(true);
  });
});

