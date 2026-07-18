import { describe, expect, it } from 'vitest';

import {
  createCourtDirectionSchema,
  createCourtOrderSchema,
  createProceedingAuthorityVersionSchema,
  recordCourtDirectionEventSchema,
  recordCourtServiceEventSchema,
  recordProceedingEventSchema,
} from '../shared/contracts.js';

const uuid = (suffix: string) => `90000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

describe('governed proceedings contracts', () => {
  it('rejects an issued event without the sealed claim form, court and case number', () => {
    const base = {
      expectedVersion: 2,
      idempotencyKey: 'proceeding-issued-001',
      eventType: 'issued' as const,
      occurredAt: '2026-09-10T10:00:00.000Z',
      note: 'The court issue is being recorded from retained source evidence.',
      sourceDocumentVersionId: null,
      courtName: '',
      caseNumber: '',
      track: null,
      supersedesEventId: null,
      correctionReason: '',
      explicitHumanConfirmation: true,
    };
    expect(() => recordProceedingEventSchema.parse(base)).toThrow();
    expect(recordProceedingEventSchema.parse({
      ...base,
      sourceDocumentVersionId: uuid('1'),
      courtName: 'County Court at Central London',
      caseNumber: 'K00CL123',
    })).toMatchObject({ eventType: 'issued', caseNumber: 'K00CL123' });
  });

  it('requires exact claim documents and independent approval for issue authority', () => {
    const base = {
      idempotencyKey: 'proceeding-authority-001',
      clientInstructionId: uuid('2'),
      procedureType: 'part7' as const,
      scope: 'Issue the synthetic housing conditions claim against the named landlord.',
      defendantPartyIds: [uuid('3')],
      claimFormDocumentVersionId: uuid('4'),
      particularsDocumentVersionId: uuid('5'),
      preparedByUserId: uuid('6'),
      approvedByUserId: uuid('6'),
      limitationPosition: 'Limitation reviewed by the responsible solicitor.',
      risks: 'Issue and service risks reviewed against retained sources.',
      reviewNote: 'Exact claim form and particulars reviewed for synthetic evaluation.',
      expiresAt: null,
      reviewOn: '2026-09-30',
      explicitApproval: true,
    };
    expect(() => createProceedingAuthorityVersionSchema.parse(base)).toThrow();
    expect(createProceedingAuthorityVersionSchema.parse({
      ...base,
      approvedByUserId: uuid('7'),
    })).toMatchObject({ procedureType: 'part7' });
  });

  it('keeps a completed service step separate from reviewed service', () => {
    const base = {
      expectedVersion: 1,
      idempotencyKey: 'court-service-event-001',
      eventType: 'human_reviewed' as const,
      occurredAt: '2026-09-11T10:00:00.000Z',
      note: 'The solicitor reviewed the service evidence and applicable source.',
      preciseStep: '',
      assertedServiceAt: '2026-09-10T12:00:00.000Z',
      assertedDeemedServiceAt: '2026-09-14T00:00:00.000Z',
      reviewPosition: 'reviewed' as const,
      ruleSourceTitle: '',
      ruleSourceUrl: '',
      evidenceDocumentVersionIds: [] as string[],
      evidenceCommunicationEntryIds: [] as string[],
      supersedesEventId: null,
      correctionReason: '',
      explicitHumanConfirmation: true,
    };
    expect(() => recordCourtServiceEventSchema.parse(base)).toThrow();
    expect(recordCourtServiceEventSchema.parse({
      ...base,
      ruleSourceTitle: 'CPR Part 6',
      ruleSourceUrl: 'https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part06',
      evidenceDocumentVersionIds: [uuid('8')],
    })).toMatchObject({ reviewPosition: 'reviewed' });
  });

  it('requires a sealed retained source before recording an operative order', () => {
    const base = {
      idempotencyKey: 'court-order-001',
      orderType: 'directions' as const,
      title: 'Allocation and directions order',
      orderDate: '2026-09-20',
      takesEffectAt: '2026-09-20T00:00:00.000Z',
      judgeName: 'District Judge Example',
      judicialTitle: 'District Judge',
      sealedDocumentVersionId: null,
      variesOrderId: null,
      supersedesOrderId: null,
      servicePosition: 'court_to_serve' as const,
      explicitSealedConfirmation: true,
    };
    expect(() => createCourtOrderSchema.parse(base)).toThrow();
    expect(createCourtOrderSchema.parse({
      ...base,
      sealedDocumentVersionId: uuid('9'),
    })).toMatchObject({ orderType: 'directions' });
  });

  it('requires evidence for satisfaction and a sealed order for waiver', () => {
    const direction = createCourtDirectionSchema.parse({
      idempotencyKey: 'court-direction-001',
      sourceOrderId: uuid('10'),
      ruleSourceTitle: '',
      ruleSourceUrl: '',
      responsiblePartyId: uuid('11'),
      category: 'witness_evidence',
      requirementText: 'Serve signed witness statements on every other party.',
      dueAt: '2026-10-20T16:00:00.000Z',
      timezone: 'Europe/London',
      sanctionExpresslyStated: true,
      sanctionText: 'The witness may not be called without permission.',
      assignedUserId: uuid('12'),
    });
    expect(direction.sourceOrderId).toBe(uuid('10'));

    const base = {
      expectedVersion: 1,
      idempotencyKey: 'court-direction-event-001',
      eventType: 'satisfied' as const,
      occurredAt: '2026-10-19T15:00:00.000Z',
      note: 'Direction completion was checked against the retained filing source.',
      evidenceDocumentVersionIds: [] as string[],
      evidenceFilingIds: [] as string[],
      evidenceServiceRecordIds: [] as string[],
      sourceOrderId: null,
      revisedDueAt: null,
      supersedesEventId: null,
      correctionReason: '',
      explicitHumanConfirmation: true,
    };
    expect(() => recordCourtDirectionEventSchema.parse(base)).toThrow();
    expect(() => recordCourtDirectionEventSchema.parse({
      ...base,
      eventType: 'waived_by_order',
    })).toThrow();
  });
});
