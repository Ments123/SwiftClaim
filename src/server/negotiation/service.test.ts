import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  CreateNegotiationActionInput,
  RecordClientInstructionInput,
} from '../../shared/contracts.js';
import {
  createDatabase,
  seedCommunicationsEvaluation,
  seedDatabase,
  SEED_IDS,
} from '../database.js';
import type { SessionUser } from '../policy.js';
import { NegotiationService } from './service.js';
import { NegotiationStore } from './store.js';

const now = () => new Date('2026-08-20T12:00:00.000Z');
const audit = { requestId: 'negotiation-service-test', ipAddress: '127.0.0.1' };

const ava: SessionUser = {
  id: SEED_IDS.ava,
  firmId: SEED_IDS.northstarFirm,
  firmName: 'Northstar Legal',
  email: 'ava@northstar.test',
  name: 'Ava Morgan',
  role: 'solicitor',
};

const partner: SessionUser = {
  ...ava,
  id: SEED_IDS.partner,
  email: 'partner@northstar.test',
  name: 'Priya Shah',
  role: 'partner',
};

const ben: SessionUser = {
  ...ava,
  id: SEED_IDS.ben,
  email: 'ben@northstar.test',
  name: 'Ben Foster',
  role: 'paralegal',
};

const actionInput: CreateNegotiationActionInput = {
  idempotencyKey: 'create-counteroffer-001',
  actionType: 'counteroffer',
  linkedOfferId: null,
  confidentiality: 'protected_negotiation',
  recipients: [{
    displayName: 'Meridian Housing Legal Team',
    endpointType: 'email',
    endpoint: 'fictional-legal@example.test',
  }],
  scope: 'whole_claim',
  scopeDescription: 'The complete synthetic housing conditions claim.',
  damagesMinor: 300_000,
  costsMinor: null,
  totalMinor: 300_000,
  currency: 'GBP',
  worksTerms: 'The specified repair schedule remains required.',
  nonMoneyTerms: '',
  interestTreatment: 'Interest remains reserved.',
  confidentialityTerms: 'Without prejudice save as to costs.',
  paymentTerms: 'Payment within 21 days of agreement.',
  proposedInstrumentType: 'settlement_agreement',
  documentVersionIds: [],
};

describe('NegotiationService action lifecycle', () => {
  let database: DatabaseSync;
  let store: NegotiationStore;
  let service: NegotiationService;
  let instructionSourceId: string;
  let externalSourceId: string;
  let internalSourceId: string;

  beforeEach(async () => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    await seedCommunicationsEvaluation(database);
    store = new NegotiationStore(database, now);
    service = new NegotiationService(store);
    instructionSourceId = String((database.prepare(
      `SELECT id FROM communication_entries WHERE firm_id = ? AND matter_id = ?
       AND channel = 'telephone' LIMIT 1`,
    ).get(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter) as { id: string }).id);
    externalSourceId = String((database.prepare(
      `SELECT id FROM communication_entries WHERE firm_id = ? AND matter_id = ?
       AND channel = 'whatsapp' AND direction = 'outbound' LIMIT 1`,
    ).get(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter) as { id: string }).id);
    internalSourceId = String((database.prepare(
      `SELECT id FROM communication_entries WHERE firm_id = ? AND matter_id = ?
       AND channel = 'internal' AND direction = 'internal' LIMIT 1`,
    ).get(SEED_IDS.northstarFirm, SEED_IDS.northstarMatter) as { id: string }).id);
  });

  afterEach(() => database.close());

  function authority() {
    return service.createAuthorityVersion(ava, SEED_IDS.northstarMatter, {
      idempotencyKey: 'action-authority-001',
      source: 'client_specific',
      scope: 'Authority for the specified synthetic counteroffer only.',
      actionTypes: ['counteroffer'],
      minimumAmountMinor: 250_000,
      maximumAmountMinor: 350_000,
      nonMoneyConstraints: '',
      costsConstraints: '',
      repairConstraints: 'The specified repair schedule remains required.',
      expiresAt: null,
      reviewOn: '2026-09-01',
      requiresClientInstruction: true,
      requiresPartnerApproval: true,
      sourceDocumentVersionId: null,
      reviewNote: 'Human authority reviewed for this synthetic evaluation action.',
    }, audit);
  }

  function instruction(actionId: string, actionVersionId: string, key = 'action-instruction-001') {
    const input: RecordClientInstructionInput = {
      idempotencyKey: key,
      confidentiality: 'protected_negotiation',
      reviewId: null,
      actionId,
      actionVersionId,
      instructionType: 'counter',
      instructingPerson: 'Maya Clarke',
      relationshipToClient: 'self',
      authorityBasis: 'Maya is the client and gave her own instructions.',
      decisionNote: 'Make this exact synthetic counteroffer and retain the repair terms.',
      receivedMethod: 'telephone',
      receivedAt: '2026-08-20T11:00:00.000Z',
      identityStatus: 'confirmed',
      identityNote: 'Name, address and matter context were confirmed.',
      understandingConfirmed: true,
      accessibilityMeasures: 'The exact terms were read back and checked.',
      sourceCommunicationEntryId: instructionSourceId,
      sourceDocumentVersionId: null,
      supersedesInstructionId: null,
      correctionReason: '',
      explicitClientInstruction: true,
    };
    return service.recordInstruction(ava, SEED_IDS.northstarMatter, input, audit);
  }

  function initialSettlementInstruction() {
    return service.recordInstruction(ava, SEED_IDS.northstarMatter, {
      idempotencyKey: 'initial-settlement-instruction-001',
      confidentiality: 'privileged',
      reviewId: null,
      actionId: null,
      actionVersionId: null,
      instructionType: 'agree_terms',
      instructingPerson: 'Maya Clarke',
      relationshipToClient: 'self',
      authorityBasis: 'Maya is the client and gave her own instructions.',
      decisionNote: 'Prepare the recorded settlement position for exact terms review.',
      receivedMethod: 'telephone',
      receivedAt: '2026-08-20T11:00:00.000Z',
      identityStatus: 'confirmed',
      identityNote: 'Name, address and matter context were confirmed.',
      understandingConfirmed: true,
      accessibilityMeasures: 'The proposed process was explained and checked back.',
      sourceCommunicationEntryId: instructionSourceId,
      sourceDocumentVersionId: null,
      supersedesInstructionId: null,
      correctionReason: '',
      explicitClientInstruction: true,
    }, audit);
  }

  it('requires instruction and partner approval for the exact current action version', () => {
    const currentAuthority = authority();
    const actionV1 = service.createAction(ava, SEED_IDS.northstarMatter, actionInput, audit);
    const instructionV1 = instruction(actionV1.id, actionV1.currentVersion.id);
    const submitInput = {
      expectedVersion: actionV1.recordVersion,
      idempotencyKey: 'submit-counteroffer-v1',
      actionVersionId: actionV1.currentVersion.id,
      clientInstructionId: instructionV1.id,
      authorityVersionId: currentAuthority.id,
      note: 'Submit the exact instructed counteroffer for partner approval.',
    };
    const submitted = service.submitAction(
      ava, SEED_IDS.northstarMatter, actionV1.id, submitInput, audit,
    );
    const replayed = service.submitAction(
      ava, SEED_IDS.northstarMatter, actionV1.id, submitInput, audit,
    );
    expect(replayed.recordVersion).toBe(submitted.recordVersion);
    expect(database.prepare(
      "SELECT COUNT(*) AS count FROM negotiation_approval_events WHERE decision = 'submitted'",
    ).get()).toEqual({ count: 1 });

    expect(() => service.decideAction(ava, SEED_IDS.northstarMatter, actionV1.id, {
      expectedVersion: 2,
      idempotencyKey: 'self-approve-counteroffer-v1',
      actionVersionId: actionV1.currentVersion.id,
      clientInstructionId: instructionV1.id,
      authorityVersionId: currentAuthority.id,
      decision: 'approved',
      note: 'Attempted self approval must not satisfy the partner gate.',
    }, audit)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));

    const approvedV1 = service.decideAction(
      partner,
      SEED_IDS.northstarMatter,
      actionV1.id,
      {
        expectedVersion: 2,
        idempotencyKey: 'partner-approve-counteroffer-v1',
        actionVersionId: actionV1.currentVersion.id,
        clientInstructionId: instructionV1.id,
        authorityVersionId: currentAuthority.id,
        decision: 'approved',
        note: 'Partner approved this exact synthetic action version.',
      },
      audit,
    );
    expect(approvedV1.projection).toMatchObject({ state: 'authorised', approvalCurrent: true });

    const actionV2 = service.appendActionVersion(ava, SEED_IDS.northstarMatter, actionV1.id, {
      ...actionInput,
      expectedVersion: approvedV1.recordVersion,
      changeReason: 'The counteroffer amount changed after further client discussion.',
      damagesMinor: 325_000,
      totalMinor: 325_000,
    }, audit);
    expect(actionV2.currentVersion.version).toBe(2);
    expect(actionV2.projection).toMatchObject({
      state: 'instruction_required',
      instructionCurrent: false,
      approvalCurrent: false,
    });

    expect(() => service.recordExternalAction(ava, SEED_IDS.northstarMatter, actionV1.id, {
      expectedVersion: actionV2.recordVersion,
      idempotencyKey: 'record-counteroffer-v2-external',
      actionVersionId: actionV2.currentVersion.id,
      occurredAt: '2026-08-20T11:45:00.000Z',
      method: 'whatsapp',
      recipient: 'Meridian Housing Legal Team',
      sourceCommunicationEntryId: externalSourceId,
      sourceDocumentVersionId: null,
      factualNote: 'The exact counteroffer was communicated to the fictional opponent.',
      explicitConfirmation: true,
    }, audit)).toThrowError(expect.objectContaining({ code: 'INSTRUCTION_REQUIRED' }));
  });

  it('records an external fact only after exact-version gates and from an external source', () => {
    const currentAuthority = authority();
    const action = service.createAction(ava, SEED_IDS.northstarMatter, actionInput, audit);
    const exactInstruction = instruction(action.id, action.currentVersion.id);
    service.submitAction(ava, SEED_IDS.northstarMatter, action.id, {
      expectedVersion: 1,
      idempotencyKey: 'submit-counteroffer-external-001',
      actionVersionId: action.currentVersion.id,
      clientInstructionId: exactInstruction.id,
      authorityVersionId: currentAuthority.id,
      note: 'Submit the exact action for a separate partner decision.',
    }, audit);
    const approved = service.decideAction(partner, SEED_IDS.northstarMatter, action.id, {
      expectedVersion: 2,
      idempotencyKey: 'approve-counteroffer-external-001',
      actionVersionId: action.currentVersion.id,
      clientInstructionId: exactInstruction.id,
      authorityVersionId: currentAuthority.id,
      decision: 'approved',
      note: 'Partner approved the exact action for external recording.',
    }, audit);
    expect(() => service.recordExternalAction(ava, SEED_IDS.northstarMatter, action.id, {
      expectedVersion: approved.recordVersion,
      idempotencyKey: 'reject-internal-source-001',
      actionVersionId: action.currentVersion.id,
      occurredAt: '2026-08-20T11:44:00.000Z',
      method: 'other',
      recipient: 'Meridian Housing Legal Team',
      sourceCommunicationEntryId: internalSourceId,
      sourceDocumentVersionId: null,
      factualNote: 'An internal note cannot prove that an external action occurred.',
      explicitConfirmation: true,
    }, audit)).toThrowError(expect.objectContaining({ code: 'SOURCE_REQUIRED' }));
    const recorded = service.recordExternalAction(ava, SEED_IDS.northstarMatter, action.id, {
      expectedVersion: approved.recordVersion,
      idempotencyKey: 'record-counteroffer-external-001',
      actionVersionId: action.currentVersion.id,
      occurredAt: '2026-08-20T11:45:00.000Z',
      method: 'whatsapp',
      recipient: 'Meridian Housing Legal Team',
      sourceCommunicationEntryId: externalSourceId,
      sourceDocumentVersionId: null,
      factualNote: 'The exact action was communicated through the retained outbound entry.',
      explicitConfirmation: true,
    }, audit);

    expect(recorded.projection.state).toBe('externally_recorded');
    expect(recorded.externalActs).toHaveLength(1);
    expect(() => service.recordExternalAction(ava, SEED_IDS.northstarMatter, action.id, {
      expectedVersion: recorded.recordVersion,
      idempotencyKey: 'record-counteroffer-again-001',
      actionVersionId: action.currentVersion.id,
      occurredAt: '2026-08-20T11:46:00.000Z',
      method: 'telephone',
      recipient: 'Meridian Housing Legal Team',
      sourceCommunicationEntryId: instructionSourceId,
      sourceDocumentVersionId: null,
      factualNote: 'An internal instruction source cannot prove a second external act.',
      explicitConfirmation: true,
    }, audit)).toThrowError(expect.objectContaining({ code: 'INVALID_STATE' }));
  });

  it('prevents ordinary-only preparers from creating or targeting protected actions', () => {
    expect(() => service.createAction(
      ben, SEED_IDS.northstarMatter, actionInput, audit,
    )).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));

    const action = service.createAction(ava, SEED_IDS.northstarMatter, actionInput, audit);
    expect(() => service.appendActionVersion(ben, SEED_IDS.northstarMatter, action.id, {
      ...actionInput,
      expectedVersion: action.recordVersion,
      changeReason: 'Attempted protected action change by an ordinary-only preparer.',
    }, audit)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('concludes exact settlement terms and distinguishes assertion from satisfaction', () => {
    const initialInstruction = initialSettlementInstruction();
    const settlement = service.createSettlement(ava, SEED_IDS.northstarMatter, {
      idempotencyKey: 'create-settlement-001',
      settlementType: 'settlement_agreement',
      scope: 'whole_claim',
      confidentiality: 'privileged',
      originatingActionId: null,
      linkedOfferId: null,
      clientInstructionId: initialInstruction.id,
      title: 'Synthetic whole claim settlement',
    }, audit);
    const terms = service.appendSettlementTerms(ava, SEED_IDS.northstarMatter, settlement.id, {
      expectedVersion: settlement.recordVersion,
      idempotencyKey: 'settlement-terms-v1-001',
      changeReason: 'Initial exact settlement terms prepared for client review.',
      damagesMinor: 300_000,
      costsMinor: null,
      totalMinor: 300_000,
      currency: 'GBP',
      paymentMethod: 'Electronic transfer',
      paymentDueAt: '2026-09-10T16:00:00.000Z',
      repairTerms: 'The listed bathroom repairs will be completed.',
      accessTerms: 'Maya will provide access on reasonable written notice.',
      inspectionTerms: 'Completion will be checked through retained evidence.',
      liabilityAdmissionPosition: 'No admission is recorded by SwiftClaim.',
      interestTerms: '',
      confidentialityTerms: '',
      disposalTerms: 'The claim will be stayed on the recorded terms.',
      enforcementTerms: 'Enforcement rights are not determined by SwiftClaim.',
      otherTerms: '',
      sourceDocumentVersionIds: [],
      reviewNote: 'A human solicitor reviewed every structured term.',
    }, audit);
    if (!terms.currentTerms) throw new Error('Expected current settlement terms.');
    const currentTerms = terms.currentTerms;
    const exactInstruction = service.recordInstruction(ava, SEED_IDS.northstarMatter, {
      idempotencyKey: 'exact-settlement-instruction-001',
      confidentiality: 'privileged',
      reviewId: null,
      actionId: null,
      actionVersionId: null,
      settlementId: settlement.id,
      settlementTermsVersionId: currentTerms.id,
      instructionType: 'agree_terms',
      instructingPerson: 'Maya Clarke',
      relationshipToClient: 'self',
      authorityBasis: 'Maya is the client and gave her own instructions.',
      decisionNote: 'Agree the exact first immutable settlement terms version.',
      receivedMethod: 'telephone',
      receivedAt: '2026-08-20T11:20:00.000Z',
      identityStatus: 'confirmed',
      identityNote: 'Name, address and matter context were confirmed.',
      understandingConfirmed: true,
      accessibilityMeasures: 'Every material term was read back and checked.',
      sourceCommunicationEntryId: instructionSourceId,
      sourceDocumentVersionId: null,
      supersedesInstructionId: null,
      correctionReason: '',
      explicitClientInstruction: true,
    }, audit);

    expect(() => service.concludeSettlement(partner, SEED_IDS.northstarMatter, settlement.id, {
      expectedVersion: terms.recordVersion,
      idempotencyKey: 'conclude-settlement-unknown-001',
      termsVersionId: currentTerms.id,
      clientInstructionId: exactInstruction.id,
      courtApprovalPosition: 'unknown',
      instrumentDocumentVersionId: null,
      sourceCommunicationEntryId: externalSourceId,
      conclusionNote: 'The court approval position has not yet been reviewed.',
      obligationsReviewed: true,
      explicitHumanConfirmation: true,
    }, audit)).toThrowError(expect.objectContaining({ code: 'COURT_APPROVAL_REVIEW_REQUIRED' }));

    const concluded = service.concludeSettlement(
      partner,
      SEED_IDS.northstarMatter,
      settlement.id,
      {
        expectedVersion: terms.recordVersion,
        idempotencyKey: 'conclude-settlement-001',
        termsVersionId: currentTerms.id,
        clientInstructionId: exactInstruction.id,
        courtApprovalPosition: 'not_required_reviewed',
        instrumentDocumentVersionId: null,
        sourceCommunicationEntryId: externalSourceId,
        conclusionNote: 'Partner confirmed the exact terms and retained source after review.',
        obligationsReviewed: true,
        explicitHumanConfirmation: true,
      },
      audit,
    );
    expect(concluded.projection.state).toBe('concluded');

    const obligation = service.createObligation(ava, SEED_IDS.northstarMatter, settlement.id, {
      idempotencyKey: 'settlement-obligation-payment-001',
      settlementTermsVersionId: currentTerms.id,
      obligationType: 'payment',
      responsibleParty: 'Meridian Housing',
      beneficiary: 'Maya Clarke',
      description: 'Pay the exact recorded settlement damages amount.',
      amountMinor: 300_000,
      dueAt: '2026-09-10T16:00:00.000Z',
      timezone: 'Europe/London',
      evidenceRequirement: 'Retained payment confirmation or client communication.',
    }, audit);
    const asserted = service.recordObligationEvent(ava, SEED_IDS.northstarMatter, obligation.id, {
      idempotencyKey: 'payment-performance-asserted-001',
      eventType: 'performance_asserted',
      occurredAt: '2026-09-10T14:00:00.000Z',
      note: 'The opponent asserted that the settlement payment was made.',
      amountSatisfiedMinor: 300_000,
      evidenceDocumentVersionIds: [],
      evidenceCommunicationEntryIds: [],
      supersedesEventId: null,
      correctionReason: '',
      waiverAuthorityDocumentVersionId: null,
      explicitConfirmation: true,
    }, audit);
    expect(asserted.projection.state).toBe('performance_asserted');
    const satisfied = service.recordObligationEvent(ava, SEED_IDS.northstarMatter, obligation.id, {
      idempotencyKey: 'payment-satisfied-001',
      eventType: 'satisfied',
      occurredAt: '2026-09-10T15:00:00.000Z',
      note: 'Maya confirmed receipt in the retained communication record.',
      amountSatisfiedMinor: 300_000,
      evidenceDocumentVersionIds: [],
      evidenceCommunicationEntryIds: [instructionSourceId],
      supersedesEventId: null,
      correctionReason: '',
      waiverAuthorityDocumentVersionId: null,
      explicitConfirmation: true,
    }, audit);
    expect(satisfied.projection).toMatchObject({ state: 'satisfied', overdue: false });

    const filing = service.createObligation(ava, SEED_IDS.northstarMatter, settlement.id, {
      idempotencyKey: 'settlement-obligation-filing-001',
      settlementTermsVersionId: currentTerms.id,
      obligationType: 'filing',
      responsibleParty: 'Northstar Legal',
      beneficiary: 'Maya Clarke',
      description: 'File the recorded disposal document if the reviewed process requires it.',
      amountMinor: null,
      dueAt: null,
      timezone: 'Europe/London',
      evidenceRequirement: 'Retained filing or authorised waiver evidence.',
    }, audit);
    const waiverInput = {
      idempotencyKey: 'filing-waived-001',
      eventType: 'waived' as const,
      occurredAt: '2026-09-10T15:30:00.000Z',
      note: 'A human authorised waiver was recorded with the retained authority source.',
      amountSatisfiedMinor: null,
      evidenceDocumentVersionIds: [],
      evidenceCommunicationEntryIds: [],
      supersedesEventId: null,
      correctionReason: '',
      waiverAuthorityDocumentVersionId: SEED_IDS.complaintVersion,
      explicitConfirmation: true as const,
    };
    expect(() => service.recordObligationEvent(
      ava, SEED_IDS.northstarMatter, filing.id, waiverInput, audit,
    )).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(service.recordObligationEvent(
      partner, SEED_IDS.northstarMatter, filing.id, waiverInput, audit,
    ).projection.state).toBe('waived');
  });
});
