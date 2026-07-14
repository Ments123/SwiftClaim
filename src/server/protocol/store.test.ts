import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  RecordLandlordResponseInput,
  SaveLetterOfClaimInput,
} from '../../shared/contracts.js';
import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { SessionUser } from '../policy.js';
import { ProtocolError, ProtocolService } from './service.js';
import { ProtocolStore } from './store.js';

const NOW = new Date('2026-07-15T09:00:00.000Z');
const audit = { requestId: 'request-protocol-test', ipAddress: '127.0.0.1' };

function user(
  id: string,
  role: SessionUser['role'],
  firmId: string = SEED_IDS.northstarFirm,
): SessionUser {
  return {
    id,
    role,
    firmId,
    firmName: firmId === SEED_IDS.northstarFirm ? 'Northstar Legal' : 'Southbank Law',
    email: `${role}@example.test`,
    name: role,
  };
}

const solicitor = user(SEED_IDS.ava, 'solicitor');
const paralegal = user(SEED_IDS.ben, 'paralegal');
const partner = user(SEED_IDS.partner, 'partner');
const outsider = user(SEED_IDS.southbankUser, 'partner', SEED_IDS.southbankFirm);

const draft: SaveLetterOfClaimInput = {
  expectedVersion: 1,
  claimantAddress: '18 Alder Court, Salford, M5 4QJ',
  landlordRecipient: 'Meridian Housing Association',
  landlordAddress: '1 Meridian Square, Manchester, M1 1AA',
  effectNarrative: 'The child cannot safely use the affected bedroom because of mould.',
  personalInjuryStatus: 'minor_gp_evidence',
  personalInjurySummary: 'The client reports a GP attendance concerning asthma symptoms.',
  specialDamagesStatus: 'under_review',
  specialDamagesSummary: '',
  accessWindows: [{ date: '2026-07-20', from: '10:00', to: '13:00', notes: 'Call first.' }],
  expertProposalSummary: 'A single joint building surveyor is proposed.',
  disclosureRequests: ['Tenancy file', 'Inspection and works records'],
  additionalContent: '',
  state: 'ready_for_review',
};

describe('ProtocolStore and ProtocolService', () => {
  let database: DatabaseSync;
  let storagePath: string;
  let store: ProtocolStore;
  let service: ProtocolService;

  beforeEach(() => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    storagePath = join(tmpdir(), `swiftclaim-protocol-${crypto.randomUUID()}`);
    store = new ProtocolStore(database, () => NOW);
    service = new ProtocolService(database, store, storagePath, () => NOW);
  });

  afterEach(() => database.close());

  it('projects a tenant-scoped workspace and saves drafts optimistically', () => {
    const workspace = service.getWorkspace(solicitor, SEED_IDS.northstarMatter);
    expect(workspace).toMatchObject({
      matterId: SEED_IDS.northstarMatter,
      case: { version: 1, protocolStatus: 'preparing' },
      letter: { version: 1, state: 'draft' },
      permissions: { canPrepare: true, canApprove: true },
    });
    expect(service.getWorkspace(outsider, SEED_IDS.northstarMatter)).toBeUndefined();

    const saved = service.saveLetter(solicitor, SEED_IDS.northstarMatter, draft, audit);
    expect(saved).toMatchObject({ version: 2, state: 'ready_for_review' });
    expect(saved.source.model.defects.length).toBeGreaterThan(0);
    expect(() => service.saveLetter(solicitor, SEED_IDS.northstarMatter, draft, audit)).toThrowError(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
  });

  it('approves one immutable generated version with safe idempotent replay', async () => {
    service.saveLetter(solicitor, SEED_IDS.northstarMatter, draft, audit);
    const approved = await service.approveLetter(
      solicitor,
      SEED_IDS.northstarMatter,
      { expectedVersion: 2, idempotencyKey: 'approve-loc-v1' },
      audit,
    );
    const replay = await service.approveLetter(
      solicitor,
      SEED_IDS.northstarMatter,
      { expectedVersion: 2, idempotencyKey: 'approve-loc-v1' },
      audit,
    );

    expect(replay.version.id).toBe(approved.version.id);
    expect(approved.version).toMatchObject({ version: 1, rendererVersion: 'swiftclaim-docx-1' });
    expect(approved.version.documentVersion.sha256).toMatch(/^[a-f0-9]{64}$/);
    const file = store.getDocumentFileByVersion(
      solicitor.firmId,
      SEED_IDS.northstarMatter,
      approved.version.documentVersion.id,
    );
    expect(file?.storageKey).toBeTruthy();
    expect((await stat(join(storagePath, `${file?.storageKey}.blob`))).mode & 0o777).toBe(0o600);
    expect(() =>
      database.prepare('UPDATE letter_of_claim_versions SET renderer_version = ? WHERE id = ?')
        .run('changed', approved.version.id),
    ).toThrow(/immutable/i);

    await expect(
      service.approveLetter(
        solicitor,
        SEED_IDS.northstarMatter,
        { expectedVersion: 3, idempotencyKey: 'approve-loc-v1' },
        audit,
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(
      service.approveLetter(
        paralegal,
        SEED_IDS.northstarMatter,
        { expectedVersion: 2, idempotencyKey: 'approve-loc-paralegal' },
        audit,
      ),
    ).rejects.toBeInstanceOf(ProtocolError);
  });

  it('records governed dispatch, receipt and landlord positions by defect', async () => {
    const saved = service.saveLetter(solicitor, SEED_IDS.northstarMatter, draft, audit);
    const approved = await service.approveLetter(
      solicitor,
      SEED_IDS.northstarMatter,
      { expectedVersion: saved.version, idempotencyKey: 'approve-loc-events' },
      audit,
    );
    const versionId = approved.version.id;
    service.recordServiceEvent(solicitor, SEED_IDS.northstarMatter, {
      idempotencyKey: 'dispatch-loc-001',
      letterVersionId: versionId,
      eventType: 'dispatched',
      method: 'email',
      occurredAt: '2026-07-15T09:30:00.000Z',
      legalTriggerOn: null,
      recipient: 'Meridian Housing Association',
      destination: 'repairs@meridian.example.test',
      sourceDetail: 'Recorded from the reviewed outgoing email and attachment.',
      supportingDocumentVersionId: null,
      supersedesEventId: null,
      correctionReason: '',
    }, audit);
    const receipt = service.recordServiceEvent(solicitor, SEED_IDS.northstarMatter, {
      idempotencyKey: 'receipt-loc-001',
      letterVersionId: versionId,
      eventType: 'actual_receipt',
      method: 'email',
      occurredAt: '2026-07-15T10:00:00.000Z',
      legalTriggerOn: '2026-07-15',
      recipient: 'Meridian Housing Association',
      destination: 'repairs@meridian.example.test',
      sourceDetail: 'The landlord acknowledged receipt in a reply email.',
      supportingDocumentVersionId: null,
      supersedesEventId: null,
      correctionReason: '',
    }, audit);
    expect(receipt.legalTriggerOn).toBe('2026-07-15');

    const defectId = service.getWorkspace(solicitor, SEED_IDS.northstarMatter)!.letter.source.model.defects[0]!.id;
    const response: RecordLandlordResponseInput = {
      idempotencyKey: 'landlord-response-001',
      responseType: 'initial',
      receivedOn: '2026-07-16',
      respondingParty: 'Meridian Housing Association',
      contactName: 'Repairs Team',
      generalLiabilityPosition: 'partly_admitted',
      liabilityReasons: 'The landlord accepts the extractor issue but disputes the window cause.',
      noticePosition: 'Written notice is acknowledged.',
      accessPosition: 'Inspection access is requested.',
      disclosureStatus: 'partial',
      disclosureSummary: 'Repair logs supplied; complaint notes to follow.',
      expertProposalPosition: 'agreed',
      expertProposalSummary: 'A single joint surveyor is agreed in principle.',
      worksSchedule: 'Inspect extractor and bedroom window.',
      worksStartOn: '2026-07-22',
      worksCompleteOn: null,
      compensationOfferMinor: null,
      costsOfferMinor: null,
      currency: 'GBP',
      sourceDocumentVersionId: null,
      supersedesResponseId: null,
      correctionReason: '',
      defectPositions: [{ defectId, position: 'partly_admitted', reason: 'Cause requires inspection.' }],
    };
    const recorded = service.recordLandlordResponse(solicitor, SEED_IDS.northstarMatter, response, audit);
    expect(recorded.defectPositions).toEqual(response.defectPositions);
    expect(service.getWorkspace(solicitor, SEED_IDS.northstarMatter)?.case.protocolStatus).toBe('response_received');
  });

  it('governs expert route, conflict override and immutable instruction approval', async () => {
    const workspace = service.getWorkspace(solicitor, SEED_IDS.northstarMatter)!;
    const route = service.selectExpertRoute(solicitor, SEED_IDS.northstarMatter, {
      expectedVersion: workspace.case.version,
      route: 'proposed_single_joint',
      reason: 'The parties should seek proportionate independent condition evidence.',
      urgentReason: '',
    }, audit);
    expect(route.expertRoute).toBe('proposed_single_joint');

    const engagement = service.createExpertEngagement(solicitor, SEED_IDS.northstarMatter, {
      route: 'proposed_single_joint',
      expertRole: 'building_surveyor',
      expertName: 'Elena Ward',
      organisation: 'Northfield Building Surveyors',
      email: 'elena@example.test',
      phone: '0161 000 1010',
      expertise: 'Residential housing conditions and schedules of repair.',
      qualifications: 'BSc MRICS',
      registrationBody: 'RICS',
      registrationReference: 'SYNTHETIC-001',
      verificationStatus: 'user_verified',
      verificationMethod: 'Solicitor checked the supplied RICS profile on 15 July 2026.',
      verifiedOn: '2026-07-15',
      proposedBy: 'jointly',
      singleJoint: true,
      termsStatus: 'accepted',
      feeBasis: 'Fixed fee including inspection and report.',
      feeMinor: 90000,
      currency: 'GBP',
      payerSplit: { claimantPercent: 50, landlordPercent: 50 },
      availabilitySummary: 'Inspection available during the week of 20 July 2026.',
      targetReportOn: '2026-08-31',
    }, audit);
    const updatedEngagement = service.updateExpertEngagement(
      solicitor,
      SEED_IDS.northstarMatter,
      engagement.id,
      {
        expectedVersion: 1,
        availabilitySummary: 'Inspection confirmed for 20 July 2026 at 10:00.',
      },
      audit,
    );
    expect(updatedEngagement).toMatchObject({ version: 2, availabilitySummary: 'Inspection confirmed for 20 July 2026 at 10:00.' });

    expect(() => service.recordExpertConflictCheck(solicitor, SEED_IDS.northstarMatter, engagement.id, {
      idempotencyKey: 'expert-conflict-potential',
      partiesChecked: ['Maya Clarke', 'Meridian Housing Association'],
      method: 'Written declaration and supplied conflict search.',
      searchDetail: 'A historic unrelated instruction for the landlord was disclosed.',
      outcome: 'potential',
      decision: 'proceed_with_override',
      reason: 'The historic instruction was unrelated and presents no material current conflict.',
    }, audit)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));

    service.recordExpertConflictCheck(partner, SEED_IDS.northstarMatter, engagement.id, {
      idempotencyKey: 'expert-conflict-potential',
      partiesChecked: ['Maya Clarke', 'Meridian Housing Association'],
      method: 'Written declaration and supplied conflict search.',
      searchDetail: 'A historic unrelated instruction for the landlord was disclosed.',
      outcome: 'potential',
      decision: 'proceed_with_override',
      reason: 'The historic instruction was unrelated and presents no material current conflict.',
    }, audit);

    const approved = await service.approveExpertInstruction(
      solicitor,
      SEED_IDS.northstarMatter,
      engagement.id,
      {
        expectedVersion: 2,
        idempotencyKey: 'expert-instruction-v1',
        issues: ['Identify all adverse housing conditions at the property.'],
        questions: ['Set out the works required, urgency, duration and estimated cost.'],
        accessDetail: 'Access is available on 20 July 2026 from 10:00 to 13:00.',
        urgentWorksRequested: true,
        scheduleOfWorksRequested: true,
        costEstimateRequested: true,
        reportDueOn: '2026-08-31',
      },
      audit,
    );
    expect(approved.version).toMatchObject({ version: 1, approvedBy: solicitor.id });
    expect(approved.version.documentVersion.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(service.getWorkspace(solicitor, SEED_IDS.northstarMatter)?.experts[0])
      .toMatchObject({ state: 'instructed', conflictChecks: [{ outcome: 'potential' }] });

    const sourceDocument = database.prepare(
      `SELECT dv.id FROM documents d JOIN document_versions dv
        ON dv.document_id = d.id AND dv.firm_id = d.firm_id
       WHERE d.firm_id = ? AND d.matter_id = ?
         AND dv.mime_type <> 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
       LIMIT 1`,
    ).get(solicitor.firmId, SEED_IDS.northstarMatter) as { id: string };
    expect(() => service.recordExpertMilestone(
      solicitor,
      SEED_IDS.northstarMatter,
      engagement.id,
      {
        idempotencyKey: 'inspection-completed-too-soon',
        instructionVersionId: approved.version.id,
        eventType: 'inspection_completed',
        occurredAt: '2026-07-20T12:00:00.000Z',
        legalTriggerOn: '2026-07-20',
        detail: 'The expert completed the property inspection.',
        supportingDocumentVersionId: null,
        supersedesEventId: null,
        correctionReason: '',
      },
      audit,
    )).toThrowError(expect.objectContaining({ code: 'TRIGGER_BLOCKED' }));
    service.recordExpertMilestone(solicitor, SEED_IDS.northstarMatter, engagement.id, {
      idempotencyKey: 'inspection-booked-001',
      instructionVersionId: approved.version.id,
      eventType: 'inspection_booked',
      occurredAt: '2026-07-17T10:00:00.000Z',
      legalTriggerOn: null,
      detail: 'Inspection booked for 20 July 2026 at 10:00.',
      supportingDocumentVersionId: null,
      supersedesEventId: null,
      correctionReason: '',
    }, audit);
    service.recordExpertMilestone(solicitor, SEED_IDS.northstarMatter, engagement.id, {
      idempotencyKey: 'inspection-completed-001',
      instructionVersionId: approved.version.id,
      eventType: 'inspection_completed',
      occurredAt: '2026-07-20T12:00:00.000Z',
      legalTriggerOn: '2026-07-20',
      detail: 'The expert completed the property inspection.',
      supportingDocumentVersionId: null,
      supersedesEventId: null,
      correctionReason: '',
    }, audit);
    const report = service.recordExpertReport(solicitor, SEED_IDS.northstarMatter, engagement.id, {
      idempotencyKey: 'expert-report-001',
      reportType: 'single_joint_report',
      reportOn: '2026-07-29',
      receivedOn: '2026-07-30',
      coverageSummary: 'The report covers every recorded defect and sets out urgent works.',
      urgentWorksIdentified: true,
      documentVersionId: sourceDocument.id,
      supersedesReportId: null,
    }, audit);
    const question = service.recordExpertQuestion(solicitor, SEED_IDS.northstarMatter, engagement.id, {
      idempotencyKey: 'expert-question-001',
      reportId: report.id,
      question: 'Please clarify the sequencing and duration of the urgent bedroom works.',
      clarificationPurpose: 'The proposed schedule does not state whether the bedroom can remain occupied.',
      dispatchedOn: '2026-08-01',
      responseDueOn: '2026-08-29',
      legalBasis: 'cpr35_6',
      reportServedOn: '2026-08-01',
    }, audit);
    service.recordExpertQuestionAnswer(
      solicitor,
      SEED_IDS.northstarMatter,
      engagement.id,
      question.id,
      {
        idempotencyKey: 'expert-answer-001',
        receivedOn: '2026-08-12',
        summary: 'The expert confirmed a five-day sequence and temporary decant requirement.',
        documentVersionId: sourceDocument.id,
      },
      audit,
    );
    const finalWorkspace = service.getWorkspace(solicitor, SEED_IDS.northstarMatter)!;
    expect(finalWorkspace.experts[0])
      .toMatchObject({
        milestones: [{ eventType: 'inspection_booked' }, { eventType: 'inspection_completed' }],
        reports: [{ id: report.id }],
        questions: [{ id: question.id, answers: [{ receivedOn: '2026-08-12' }] }],
      });
    expect(finalWorkspace.deadlines).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleKey: 'housing.expert.report', dueDate: '2026-08-03' }),
      expect.objectContaining({ ruleKey: 'housing.protocol.substantive_response', dueDate: '2026-08-27' }),
      expect.objectContaining({ ruleKey: 'housing.expert.clarification_questions', dueDate: '2026-08-29' }),
    ]));
  });
});
