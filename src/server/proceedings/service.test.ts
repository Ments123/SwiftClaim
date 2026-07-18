import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CreateProceedingAuthorityVersionInput } from '../../shared/contracts.js';
import {
  createDatabase, seedCommunicationsEvaluation, seedDatabase,
  seedNegotiationSettlementEvaluation, seedProtocolExpertsEvaluation,
  seedRepairsQuantumEvaluation, SEED_IDS,
} from '../database.js';
import type { SessionUser } from '../policy.js';
import { ProceedingsService } from './service.js';
import { ProceedingsStore } from './store.js';

const now = () => new Date('2026-09-01T10:00:00.000Z');
const audit = { requestId: 'proceedings-service-test', ipAddress: '127.0.0.1' };
const ava: SessionUser = {
  id: SEED_IDS.ava, firmId: SEED_IDS.northstarFirm, firmName: 'Northstar Legal',
  email: 'ava@northstar.test', name: 'Ava Morgan', role: 'solicitor',
};
const partner: SessionUser = {
  ...ava, id: SEED_IDS.partner, email: 'marcus@northstar.test',
  name: 'Marcus Reed', role: 'partner',
};

describe('ProceedingsService', () => {
  let database: DatabaseSync;
  let directory: string;
  let service: ProceedingsService;
  let proceedingId: string;
  let authorityInput: CreateProceedingAuthorityVersionInput;
  let claimFormVersionId: string;
  let otherVersionId: string;
  let defendantId: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'swiftclaim-proceedings-service-'));
    mkdirSync(join(directory, 'storage'));
    database = createDatabase(':memory:');
    seedDatabase(database);
    await seedProtocolExpertsEvaluation(database, join(directory, 'storage'));
    seedRepairsQuantumEvaluation(database);
    await seedCommunicationsEvaluation(database);
    seedNegotiationSettlementEvaluation(database);
    service = new ProceedingsService(new ProceedingsStore(database, now), now);
    const proceeding = service.createProceeding(ava, SEED_IDS.northstarMatter, {
      idempotencyKey: 'service-create-proceeding', procedureType: 'part7',
      jurisdiction: 'england_wales', courtName: 'County Court at Central London',
      courtCode: null, hearingCentre: 'Central London',
    }, audit);
    proceedingId = proceeding.id;
    const versions = database.prepare(`SELECT dv.id FROM document_versions dv
      JOIN documents d ON d.id = dv.document_id AND d.firm_id = dv.firm_id
      WHERE dv.firm_id = ? AND d.matter_id = ? ORDER BY dv.created_at LIMIT 2`)
      .all(ava.firmId, SEED_IDS.northstarMatter) as Array<{ id: string }>;
    claimFormVersionId = versions[0]!.id;
    otherVersionId = versions[1]!.id;
    const instructionId = String((database.prepare(`SELECT id FROM client_instructions
      WHERE firm_id = ? AND matter_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(ava.firmId, SEED_IDS.northstarMatter) as { id: string }).id);
    defendantId = String((database.prepare(`SELECT id FROM parties
      WHERE firm_id = ? AND matter_id = ? AND kind = 'opponent' LIMIT 1`)
      .get(ava.firmId, SEED_IDS.northstarMatter) as { id: string }).id);
    authorityInput = {
      idempotencyKey: 'service-issue-authority', clientInstructionId: instructionId,
      procedureType: 'part7',
      scope: 'Issue the exact synthetic claim against the named landlord.',
      defendantPartyIds: [defendantId], claimFormDocumentVersionId: claimFormVersionId,
      particularsDocumentVersionId: otherVersionId, preparedByUserId: ava.id,
      approvedByUserId: partner.id,
      limitationPosition: 'Limitation was reviewed against retained matter sources.',
      risks: 'Issue, service, evidence and costs risks were independently reviewed.',
      reviewNote: 'Marcus independently approved these exact synthetic documents.',
      expiresAt: null, reviewOn: '2026-09-30', explicitApproval: true,
    };
  });

  afterEach(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('requires the acting approver to hold issue approval and match the authority record', () => {
    expect(() => service.createAuthorityVersion(
      ava, SEED_IDS.northstarMatter, proceedingId, authorityInput, audit,
    )).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(service.createAuthorityVersion(
      partner, SEED_IDS.northstarMatter, proceedingId, authorityInput, audit,
    )).toMatchObject({ approvedByUserId: partner.id });
  });

  it('refuses issue where the sealed source is not the exact authorised claim form', () => {
    service.createAuthorityVersion(
      partner, SEED_IDS.northstarMatter, proceedingId, authorityInput, audit,
    );
    expect(() => service.recordProceedingEvent(ava, SEED_IDS.northstarMatter, proceedingId, {
      expectedVersion: 2, idempotencyKey: 'service-issued-mismatch', eventType: 'issued',
      occurredAt: '2026-09-10T10:00:00.000Z',
      note: 'Court issue was checked against a retained but unauthorised version.',
      sourceDocumentVersionId: otherVersionId, courtName: 'County Court at Central London',
      caseNumber: 'K00CL123', track: null, supersedesEventId: null,
      correctionReason: '', explicitHumanConfirmation: true,
    }, audit)).toThrowError(expect.objectContaining({ code: 'AUTHORITY_VERSION_MISMATCH' }));
  });

  it('keeps issue submission distinct from court issue', () => {
    service.createAuthorityVersion(
      partner, SEED_IDS.northstarMatter, proceedingId, authorityInput, audit,
    );
    const result = service.recordProceedingEvent(ava, SEED_IDS.northstarMatter, proceedingId, {
      expectedVersion: 2, idempotencyKey: 'service-issue-submitted',
      eventType: 'issue_request_submitted', occurredAt: '2026-09-09T10:00:00.000Z',
      note: 'The issue request was submitted and awaits a separate court issue event.',
      sourceDocumentVersionId: claimFormVersionId, courtName: '', caseNumber: '',
      track: null, supersedesEventId: null, correctionReason: '',
      explicitHumanConfirmation: true,
    }, audit);
    expect(result.currentState).toBe('submitted');
    expect(result.caseNumber).toBeNull();
    expect(result.issuedAt).toBeNull();
  });

  it('keeps filing acknowledgement distinct from court acceptance', () => {
    const filing = service.createFiling(ava, SEED_IDS.northstarMatter, proceedingId, {
      idempotencyKey: 'service-filing-create',
      purpose: 'File the synthetic claim form and particulars for issue.',
      documentVersionIds: [claimFormVersionId, otherVersionId],
      submissionChannel: 'portal', feePosition: 'paid', feeMinor: 45500,
      currency: 'GBP',
    }, audit);
    const acknowledged = service.recordFilingEvent(
      ava, SEED_IDS.northstarMatter, proceedingId, filing.id, {
        expectedVersion: 1, idempotencyKey: 'service-filing-acknowledged',
        eventType: 'acknowledged', occurredAt: '2026-09-09T10:05:00.000Z',
        note: 'The portal acknowledged receipt but did not confirm court acceptance.',
        receiptDocumentVersionId: claimFormVersionId,
        externalReference: 'PORTAL-ACK-001', rejectionReason: '',
        supersedesEventId: null, correctionReason: '', explicitHumanConfirmation: true,
      }, audit,
    );
    expect(acknowledged.currentState).toBe('acknowledged');
    const workspace = service.getWorkspace(ava, SEED_IDS.northstarMatter);
    expect(workspace.filings[0]).toMatchObject({
      id: filing.id, currentState: 'acknowledged', documentVersionIds: [claimFormVersionId, otherVersionId],
    });
  });

  it('keeps a completed service step separate from reviewed service', () => {
    const serviceRecord = service.createServiceRecord(
      ava, SEED_IDS.northstarMatter, proceedingId, {
        idempotencyKey: 'service-record-create',
        courtDocumentVersionId: claimFormVersionId,
        recipientPartyId: defendantId,
        method: 'first_class_post', serviceAddress: '1 Synthetic Street, London',
        jurisdictionPosition: 'within_jurisdiction',
      }, audit,
    );
    const completed = service.recordServiceEvent(
      ava, SEED_IDS.northstarMatter, proceedingId, serviceRecord.id, {
        expectedVersion: 1, idempotencyKey: 'service-step-completed',
        eventType: 'step_completed', occurredAt: '2026-09-10T15:00:00.000Z',
        note: 'The envelope was posted using first class post and the act was recorded.',
        preciseStep: 'Placed with the postal provider using first class post.',
        assertedServiceAt: null, assertedDeemedServiceAt: null,
        reviewPosition: 'unreviewed', ruleSourceTitle: '', ruleSourceUrl: '',
        evidenceDocumentVersionIds: [], evidenceCommunicationEntryIds: [],
        supersedesEventId: null, correctionReason: '', explicitHumanConfirmation: true,
      }, audit,
    );
    expect(completed.currentState).toBe('step_completed');
    const reviewed = service.recordServiceEvent(
      ava, SEED_IDS.northstarMatter, proceedingId, serviceRecord.id, {
        expectedVersion: 2, idempotencyKey: 'service-human-review',
        eventType: 'human_reviewed', occurredAt: '2026-09-11T10:00:00.000Z',
        note: 'The solicitor reviewed the retained evidence and applicable CPR source.',
        preciseStep: '', assertedServiceAt: '2026-09-10T15:00:00.000Z',
        assertedDeemedServiceAt: '2026-09-14T00:00:00.000Z',
        reviewPosition: 'reviewed', ruleSourceTitle: 'CPR Part 6',
        ruleSourceUrl: 'https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part06',
        evidenceDocumentVersionIds: [claimFormVersionId],
        evidenceCommunicationEntryIds: [], supersedesEventId: null,
        correctionReason: '', explicitHumanConfirmation: true,
      }, audit,
    );
    expect(reviewed.currentState).toBe('reviewed');
  });

  it('requires retained evidence for direction satisfaction and a sealed order for waiver', () => {
    const order = service.createOrder(ava, SEED_IDS.northstarMatter, proceedingId, {
      idempotencyKey: 'service-directions-order', orderType: 'directions',
      title: 'Allocation and directions order', orderDate: '2026-09-20',
      takesEffectAt: '2026-09-20T00:00:00.000Z', judgeName: 'District Judge Example',
      judicialTitle: 'District Judge', sealedDocumentVersionId: claimFormVersionId,
      variesOrderId: null, supersedesOrderId: null,
      servicePosition: 'court_to_serve', explicitSealedConfirmation: true,
    }, audit);
    const direction = service.createDirection(
      ava, SEED_IDS.northstarMatter, proceedingId, {
        idempotencyKey: 'service-witness-direction', sourceOrderId: order.id,
        ruleSourceTitle: '', ruleSourceUrl: '', responsiblePartyId: defendantId,
        category: 'witness_evidence',
        requirementText: 'Serve signed witness statements on every other party.',
        dueAt: '2026-10-20T16:00:00.000Z', timezone: 'Europe/London',
        sanctionExpresslyStated: true,
        sanctionText: 'The witness may not be called without permission.',
        assignedUserId: ava.id,
      }, audit,
    );
    expect(() => service.recordDirectionEvent(
      ava, SEED_IDS.northstarMatter, proceedingId, direction.id, {
        expectedVersion: 1, idempotencyKey: 'service-direction-satisfied-no-evidence',
        eventType: 'satisfied', occurredAt: '2026-10-19T15:00:00.000Z',
        note: 'Completion is asserted without retained evidence and must be rejected.',
        evidenceDocumentVersionIds: [], evidenceFilingIds: [],
        evidenceServiceRecordIds: [], sourceOrderId: null, revisedDueAt: null,
        supersedesEventId: null, correctionReason: '', explicitHumanConfirmation: true,
      }, audit,
    )).toThrowError(expect.objectContaining({ code: 'EVIDENCE_REQUIRED' }));
    const asserted = service.recordDirectionEvent(
      ava, SEED_IDS.northstarMatter, proceedingId, direction.id, {
        expectedVersion: 1, idempotencyKey: 'service-direction-performance-asserted',
        eventType: 'performance_asserted', occurredAt: '2026-10-19T15:00:00.000Z',
        note: 'The responsible team asserted performance but evidence is not yet reviewed.',
        evidenceDocumentVersionIds: [], evidenceFilingIds: [],
        evidenceServiceRecordIds: [], sourceOrderId: null, revisedDueAt: null,
        supersedesEventId: null, correctionReason: '', explicitHumanConfirmation: true,
      }, audit,
    );
    expect(asserted.projection.state).toBe('performance_asserted');
    const satisfied = service.recordDirectionEvent(
      ava, SEED_IDS.northstarMatter, proceedingId, direction.id, {
        expectedVersion: 2, idempotencyKey: 'service-direction-satisfied-evidence',
        eventType: 'satisfied', occurredAt: '2026-10-19T16:00:00.000Z',
        note: 'The solicitor checked completion against the exact retained document.',
        evidenceDocumentVersionIds: [otherVersionId], evidenceFilingIds: [],
        evidenceServiceRecordIds: [], sourceOrderId: null, revisedDueAt: null,
        supersedesEventId: null, correctionReason: '', explicitHumanConfirmation: true,
      }, audit,
    );
    expect(satisfied.projection.state).toBe('satisfied');
  });

  it('keeps a hearing outcome separate from a resulting sealed order', () => {
    const hearing = service.createHearing(ava, SEED_IDS.northstarMatter, proceedingId, {
      idempotencyKey: 'service-hearing-create', hearingType: 'case_management',
      title: 'Case management conference', listingNoticeVersionId: claimFormVersionId,
      startsAt: '2026-11-10T10:00:00.000Z', endsAt: '2026-11-10T11:00:00.000Z',
      timezone: 'Europe/London', courtName: 'County Court at Central London',
      venue: 'Courtroom 3', attendanceMode: 'in_person', remoteAccessDetails: '',
      privacyPosition: 'public', judgeName: '', advocateNames: ['A. Advocate'],
      attendeeNames: ['Maya Clarke'], bundleDocumentVersionId: null,
    }, audit);
    const outcome = service.recordHearingEvent(
      ava, SEED_IDS.northstarMatter, proceedingId, hearing.id, {
        expectedVersion: 1, idempotencyKey: 'service-hearing-outcome',
        eventType: 'outcome_recorded', occurredAt: '2026-11-10T11:00:00.000Z',
        note: 'A factual hearing outcome note was recorded pending any sealed order.',
        sourceDocumentVersionId: null, resultingOrderId: null, revisedStartsAt: null,
        supersedesEventId: null, correctionReason: '', explicitHumanConfirmation: true,
      }, audit,
    );
    expect(outcome.projection.outcomeRecorded).toBe(true);
    expect(outcome.resultingOrderId).toBeNull();
  });

  it('requires a retained sealed order before recording an application as granted', () => {
    const application = service.createApplication(
      ava, SEED_IDS.northstarMatter, proceedingId, {
        idempotencyKey: 'service-application-create', applicantPartyId: defendantId,
        respondentPartyIds: [],
        requestedOrder: 'An order varying the synthetic case management timetable.',
        groundsSummary: 'The retained evidence supports a proportionate timetable variation.',
        noticePosition: 'on_notice', hearingRequiredPosition: 'requested',
        applicationNoticeVersionId: claimFormVersionId,
        evidenceDocumentVersionIds: [otherVersionId], draftOrderVersionId: otherVersionId,
      }, audit,
    );
    expect(() => service.recordApplicationEvent(
      ava, SEED_IDS.northstarMatter, proceedingId, application.id, {
        expectedVersion: 1, idempotencyKey: 'service-application-granted-no-order',
        eventType: 'granted', occurredAt: '2026-11-12T10:00:00.000Z',
        note: 'The application outcome was reported but no sealed order was retained.',
        sourceDocumentVersionId: null, resultingOrderId: null,
        supersedesEventId: null, correctionReason: '', explicitHumanConfirmation: true,
      }, audit,
    )).toThrowError(expect.objectContaining({ code: 'SEALED_ORDER_REQUIRED' }));
  });
});
