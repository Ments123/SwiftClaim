import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import type { EvidenceReadinessProvider } from '../evidence/service.js';
import type { SessionUser } from '../policy.js';
import { MatterStore } from '../store.js';
import {
  WorkflowError,
  WorkflowService,
  type NegotiationReadinessProvider,
  type ProtocolReadinessProvider,
  type QuantumReadinessProvider,
} from './service.js';
import { WorkflowStore } from './store.js';

const FIXED_NOW = new Date('2026-07-13T12:00:00.000Z');
const TEST_MATTER_ID = SEED_IDS.northstarRestrictedMatter;
const UNASSIGNED_MATTER_ID = '30000000-0000-4000-8000-000000000099';
const AUDIT_CONTEXT = {
  requestId: 'request-workflow-service-1',
  ipAddress: '127.0.0.1',
};

const ava: SessionUser = {
  id: SEED_IDS.ava,
  firmId: SEED_IDS.northstarFirm,
  firmName: 'Northstar Legal',
  email: 'ava@northstar.test',
  name: 'Ava Morgan',
  role: 'solicitor',
};

const partner: SessionUser = {
  id: SEED_IDS.partner,
  firmId: SEED_IDS.northstarFirm,
  firmName: 'Northstar Legal',
  email: 'partner@northstar.test',
  name: 'Marcus Reed',
  role: 'partner',
};

describe('WorkflowService', () => {
  let database: DatabaseSync;
  let workflowStore: WorkflowStore;
  let service: WorkflowService;
  let eligibleEvidenceControls: Set<string>;
  let protocolEligible: boolean;
  let protocolProgressionBlocked: boolean;
  let quantumEligible: boolean;

  beforeEach(() => {
    database = createDatabase(':memory:');
    seedDatabase(database);
    database
      .prepare(
        `INSERT OR IGNORE INTO matter_members (
          firm_id, matter_id, user_id, access_level, added_at
        ) VALUES (?, ?, ?, 'write', ?)`,
      )
      .run(
        SEED_IDS.northstarFirm,
        TEST_MATTER_ID,
        SEED_IDS.ava,
        FIXED_NOW.toISOString(),
      );
    database
      .prepare(
        `INSERT INTO matters (
          id, firm_id, reference, title, client_name, matter_type, status,
          stage, risk_level, owner_user_id, opened_at, description, created_by,
          created_at, updated_at
        ) VALUES (?, ?, 'TEST-UNASSIGNED', 'Unassigned test matter', 'Test Client',
          'Housing conditions claim', 'open', 'Enquiry', 'low', ?, '2026-07-01',
          'Tenant-scope test fixture.', ?, ?, ?)`,
      )
      .run(
        UNASSIGNED_MATTER_ID,
        SEED_IDS.northstarFirm,
        SEED_IDS.partner,
        SEED_IDS.partner,
        FIXED_NOW.toISOString(),
        FIXED_NOW.toISOString(),
      );
    workflowStore = new WorkflowStore(database, () => FIXED_NOW);
    eligibleEvidenceControls = new Set();
    protocolEligible = false;
    protocolProgressionBlocked = true;
    quantumEligible = false;
    const evidenceReadiness: EvidenceReadinessProvider = {
      getEvidenceReadiness: () => ({
        controls: [
          {
            key: 'defect_schedule_recorded',
            eligible: eligibleEvidenceControls.has('defect_schedule_recorded'),
            explanation: 'Record at least one active defect.',
          },
          {
            key: 'notice_evidence_recorded',
            eligible: eligibleEvidenceControls.has('notice_evidence_recorded'),
            explanation: 'Record an explicit proof position for a notice.',
          },
          {
            key: 'photographs_recorded',
            eligible: eligibleEvidenceControls.has('photographs_recorded'),
            explanation: 'Link a preserved photograph to an active defect.',
          },
        ],
      }),
    };
    const protocolReadiness: ProtocolReadinessProvider = {
      getProtocolReadiness: (_firmId, _matterId, stageKey) => ({
        controls: [{
          key: stageKey === 'protocol' ? 'letter_of_claim_sent' : 'expert_instruction_confirmed',
          eligible: protocolEligible,
          explanation: 'The governed protocol fact is not supported.',
        }],
        progressionBlockers: protocolProgressionBlocked
          ? [{ key: 'objective_protocol_gap', label: 'An objective protocol gap remains.', severity: 'critical' }]
          : [],
      }),
    };
    const quantumReadiness: QuantumReadinessProvider = {
      getQuantumReadiness: () => ({
        controls: [
          {
            key: 'works_status_reviewed',
            eligible: quantumEligible,
            explanation: 'The approved work position requires review.',
          },
          {
            key: 'damages_schedule_reviewed',
            eligible: quantumEligible,
            explanation: 'The approved damages schedule requires review.',
          },
        ],
      }),
    };
    service = new WorkflowService(
      new MatterStore(database, () => FIXED_NOW),
      workflowStore,
      () => FIXED_NOW,
      evidenceReadiness,
      protocolReadiness,
      quantumReadiness,
    );
    workflowStore.instantiateMatterWorkflow(
      SEED_IDS.northstarFirm,
      TEST_MATTER_ID,
      SEED_IDS.ava,
    );
  });

  afterEach(() => {
    database.close();
  });

  function advanceToEvidence() {
    const transitions = [
      {
        toStageKey: 'assessment',
        expectedVersion: 1,
        completedChecklistKeys: [
          'initial_contact_recorded',
          'conflict_check_completed',
        ],
        reason: 'Initial enquiry is complete and suitable for assessment.',
      },
      {
        toStageKey: 'onboarding',
        expectedVersion: 2,
        completedChecklistKeys: [
          'tenancy_confirmed',
          'landlord_duty_screened',
          'limitation_reviewed',
          'merits_decision_recorded',
        ],
        reason: 'The legal assessment is complete and approved to proceed.',
      },
      {
        toStageKey: 'evidence',
        expectedVersion: 3,
        completedChecklistKeys: [
          'client_care_signed',
          'authority_signed',
          'id_checks_completed',
          'funding_recorded',
        ],
        reason: 'The client onboarding controls are complete and recorded.',
      },
    ];
    for (const transition of transitions) {
      service.transitionStage(
        ava,
        TEST_MATTER_ID,
        transition,
        AUDIT_CONTEXT,
      );
    }
  }

  function advanceToRepairsQuantum() {
    advanceToEvidence();
    eligibleEvidenceControls = new Set([
      'defect_schedule_recorded',
      'notice_evidence_recorded',
      'photographs_recorded',
    ]);
    service.transitionStage(
      ava,
      TEST_MATTER_ID,
      {
        toStageKey: 'protocol',
        expectedVersion: 4,
        completedChecklistKeys: [...eligibleEvidenceControls],
        reason: 'Evidence records are ready for the protocol stage.',
      },
      AUDIT_CONTEXT,
    );
    protocolEligible = true;
    protocolProgressionBlocked = false;
    service.transitionStage(
      ava,
      TEST_MATTER_ID,
      {
        toStageKey: 'expert',
        expectedVersion: 5,
        completedChecklistKeys: ['letter_of_claim_sent'],
        reason: 'The protocol position is ready for expert evidence.',
      },
      AUDIT_CONTEXT,
    );
    service.transitionStage(
      ava,
      TEST_MATTER_ID,
      {
        toStageKey: 'repairs_quantum',
        expectedVersion: 6,
        completedChecklistKeys: ['expert_instruction_confirmed'],
        reason: 'The expert evidence is reviewed for repairs and quantum.',
      },
      AUDIT_CONTEXT,
    );
  }

  it('blocks unsupported evidence readiness confirmations and accepts supported ones', () => {
    advanceToEvidence();
    eligibleEvidenceControls = new Set([
      'defect_schedule_recorded',
      'notice_evidence_recorded',
    ]);
    const command = {
      toStageKey: 'protocol',
      expectedVersion: 4,
      completedChecklistKeys: [
        'defect_schedule_recorded',
        'notice_evidence_recorded',
        'photographs_recorded',
      ],
      reason: 'The evidence investigation is complete for protocol review.',
    };

    expect(() =>
      service.transitionStage(ava, TEST_MATTER_ID, command, AUDIT_CONTEXT),
    ).toThrowError(
      expect.objectContaining<Partial<WorkflowError>>({
        code: 'READINESS_BLOCKED',
        details: {
          blockers: expect.arrayContaining([
            expect.objectContaining({ key: 'photographs_recorded' }),
          ]),
        },
      }),
    );

    eligibleEvidenceControls.add('photographs_recorded');
    expect(
      service.transitionStage(ava, TEST_MATTER_ID, command, AUDIT_CONTEXT)
        .workflow.currentStageKey,
    ).toBe('protocol');
  });

  it('retains a partner override for objective evidence readiness blockers', () => {
    advanceToEvidence();
    const result = service.transitionStage(
      partner,
      TEST_MATTER_ID,
      {
        toStageKey: 'protocol',
        expectedVersion: 4,
        completedChecklistKeys: [
          'defect_schedule_recorded',
          'notice_evidence_recorded',
          'photographs_recorded',
        ],
        reason: 'Urgent protocol progression has been reviewed by the supervisor.',
        overrideReason:
          'Supervisor approved progression while the missing records are obtained.',
      },
      AUDIT_CONTEXT,
    );

    expect(result.workflow.currentStageKey).toBe('protocol');
    const auditRow = database
      .prepare(
        `SELECT after_json AS afterJson FROM audit_events
         WHERE action = 'workflow.stage_changed' AND matter_id = ?
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(TEST_MATTER_ID) as { afterJson: string };
    expect(JSON.parse(auditRow.afterJson)).toMatchObject({
      overrideReason:
        'Supervisor approved progression while the missing records are obtained.',
      blockers: expect.arrayContaining([
        expect.objectContaining({ key: 'defect_schedule_recorded' }),
        expect.objectContaining({ key: 'notice_evidence_recorded' }),
        expect.objectContaining({ key: 'photographs_recorded' }),
      ]),
    });
  });

  it('filters unsupported protocol confirmations and keeps objective blockers live', () => {
    advanceToEvidence();
    eligibleEvidenceControls = new Set([
      'defect_schedule_recorded',
      'notice_evidence_recorded',
      'photographs_recorded',
    ]);
    service.transitionStage(ava, TEST_MATTER_ID, {
      toStageKey: 'protocol',
      expectedVersion: 4,
      completedChecklistKeys: [...eligibleEvidenceControls],
      reason: 'The evidence investigation is complete for protocol review.',
    }, AUDIT_CONTEXT);

    const command = {
      toStageKey: 'expert',
      expectedVersion: 5,
      completedChecklistKeys: ['letter_of_claim_sent'],
      reason: 'The protocol response position is ready for expert evidence.',
    };
    expect(() => service.transitionStage(ava, TEST_MATTER_ID, command, AUDIT_CONTEXT))
      .toThrowError(expect.objectContaining({
        code: 'READINESS_BLOCKED',
        details: { blockers: expect.arrayContaining([
          expect.objectContaining({ key: 'letter_of_claim_sent' }),
          expect.objectContaining({ key: 'objective_protocol_gap' }),
        ]) },
      }));

    protocolEligible = true;
    protocolProgressionBlocked = false;
    expect(service.transitionStage(ava, TEST_MATTER_ID, command, AUDIT_CONTEXT)
      .workflow.currentStageKey).toBe('expert');
  });

  it('blocks unsupported repairs and quantum confirmations without exposing protected offers', () => {
    advanceToRepairsQuantum();
    const command = {
      toStageKey: 'negotiation',
      expectedVersion: 7,
      completedChecklistKeys: [
        'works_status_reviewed',
        'damages_schedule_reviewed',
      ],
      reason: 'The current works and damages position is ready for negotiation.',
    };

    expect(() =>
      service.transitionStage(ava, TEST_MATTER_ID, command, AUDIT_CONTEXT),
    ).toThrowError(
      expect.objectContaining({
        code: 'READINESS_BLOCKED',
        details: {
          blockers: expect.arrayContaining([
            expect.objectContaining({ key: 'works_status_reviewed' }),
            expect.objectContaining({ key: 'damages_schedule_reviewed' }),
          ]),
        },
      }),
    );
    try {
      service.transitionStage(ava, TEST_MATTER_ID, command, AUDIT_CONTEXT);
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('offer');
    }

    quantumEligible = true;
    expect(
      service.transitionStage(ava, TEST_MATTER_ID, command, AUDIT_CONTEXT)
        .workflow.currentStageKey,
    ).toBe('negotiation');
  });

  it('returns stages, readiness blockers and explainable critical deadlines', () => {
    workflowStore.recordTriggerAndDeadline({
      firmId: SEED_IDS.northstarFirm,
      matterId: TEST_MATTER_ID,
      actorUserId: SEED_IDS.ava,
      triggerEventType: 'letter_of_claim.received',
      triggerDate: '2026-07-01',
      idempotencyKey: 'summary-loc-received',
      auditContext: AUDIT_CONTEXT,
    });

    const result = service.getMatter360(ava, TEST_MATTER_ID);

    expect(result.workflow.currentStageKey).toBe('enquiry');
    expect(result.workflow.stages).toHaveLength(11);
    expect(result.workflow.stages[0]?.state).toBe('current');
    expect(result.workflow.stages[1]?.state).toBe('upcoming');
    expect(result.workflow.blockers.map((blocker) => blocker.key)).toEqual([
      'initial_contact_recorded',
      'conflict_check_completed',
    ]);
    expect(result.deadlines[0]).toMatchObject({
      title: 'Landlord response to Letter of Claim',
      dueDate: '2026-07-29',
      status: 'pending',
      sourceUrl:
        'https://www.justice.gov.uk/courts/procedure-rules/civil/protocol/prot_hou',
    });
    expect(result.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'workflow.readiness', severity: 'warning' }),
      ]),
    );
    expect(result.permissions).toEqual({
      canWrite: true,
      canTransition: true,
      canOverrideWorkflow: false,
    });
  });

  it('moves to the next stage and records immutable operational history', () => {
    const result = service.transitionStage(
      ava,
      TEST_MATTER_ID,
      {
        toStageKey: 'assessment',
        expectedVersion: 1,
        completedChecklistKeys: [
          'initial_contact_recorded',
          'conflict_check_completed',
        ],
        reason: 'Initial enquiry is complete and suitable for assessment.',
      },
      AUDIT_CONTEXT,
    );

    expect(result.workflow.currentStageKey).toBe('assessment');
    expect(result.workflow.version).toBe(2);
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM matter_stage_history
           WHERE firm_id = ? AND matter_id = ?`,
        )
        .get(SEED_IDS.northstarFirm, TEST_MATTER_ID),
    ).toEqual({ count: 2 });
    expect(
      database
        .prepare('SELECT stage FROM matters WHERE id = ? AND firm_id = ?')
        .get(TEST_MATTER_ID, SEED_IDS.northstarFirm),
    ).toEqual({ stage: 'Assessment' });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM domain_events
           WHERE firm_id = ? AND matter_id = ? AND type = 'workflow.stage_changed'`,
        )
        .get(SEED_IDS.northstarFirm, TEST_MATTER_ID),
    ).toEqual({ count: 1 });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM timeline_events
           WHERE firm_id = ? AND matter_id = ? AND type = 'stage.changed'`,
        )
        .get(SEED_IDS.northstarFirm, TEST_MATTER_ID),
    ).toEqual({ count: 1 });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM audit_events
           WHERE firm_id = ? AND matter_id = ? AND action = 'workflow.stage_changed'`,
        )
        .get(SEED_IDS.northstarFirm, TEST_MATTER_ID),
    ).toEqual({ count: 1 });
    expect(() =>
      database
        .prepare(
          `UPDATE matter_stage_history SET reason = 'Rewritten'
           WHERE firm_id = ? AND matter_id = ? AND from_stage_key IS NOT NULL`,
        )
        .run(SEED_IDS.northstarFirm, TEST_MATTER_ID),
    ).toThrow('matter_stage_history is append-only');
  });

  it('blocks incomplete transitions unless an authorised override is recorded', () => {
    expect(() =>
      service.transitionStage(
        ava,
        TEST_MATTER_ID,
        {
          toStageKey: 'assessment',
          expectedVersion: 1,
          completedChecklistKeys: [],
          reason: 'Move the claim into detailed assessment.',
        },
        AUDIT_CONTEXT,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<WorkflowError>>({
        code: 'READINESS_BLOCKED',
      }),
    );

    expect(() =>
      service.transitionStage(
        ava,
        TEST_MATTER_ID,
        {
          toStageKey: 'assessment',
          expectedVersion: 1,
          completedChecklistKeys: [],
          reason: 'Move the urgent claim into detailed assessment.',
          overrideReason: 'Urgent progression approved while evidence is gathered.',
        },
        AUDIT_CONTEXT,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<WorkflowError>>({ code: 'FORBIDDEN' }),
    );

    const result = service.transitionStage(
      partner,
      TEST_MATTER_ID,
      {
        toStageKey: 'assessment',
        expectedVersion: 1,
        completedChecklistKeys: [],
        reason: 'Move the urgent claim into detailed assessment.',
        overrideReason:
          'Supervisor approved progression because urgent safety evidence is pending.',
      },
      AUDIT_CONTEXT,
    );

    expect(result.workflow.currentStageKey).toBe('assessment');
    const audit = database
      .prepare(
        `SELECT after_json AS afterJson FROM audit_events
         WHERE action = 'workflow.stage_changed' AND matter_id = ?`,
      )
      .get(TEST_MATTER_ID) as { afterJson: string };
    expect(JSON.parse(audit.afterJson)).toMatchObject({
      overrideReason:
        'Supervisor approved progression because urgent safety evidence is pending.',
      blockers: [
        expect.objectContaining({ key: 'initial_contact_recorded' }),
        expect.objectContaining({ key: 'conflict_check_completed' }),
      ],
    });
  });

  it('returns NOT_FOUND for another firm or an unassigned matter', () => {
    for (const matterId of [
      SEED_IDS.southbankMatter,
      UNASSIGNED_MATTER_ID,
    ]) {
      expect(() => service.getMatter360(ava, matterId)).toThrowError(
        expect.objectContaining<Partial<WorkflowError>>({ code: 'NOT_FOUND' }),
      );
    }
  });

  it('confirms a trigger once and returns its explainable deadline', () => {
    const input = {
      eventType: 'letter_of_claim.received',
      occurredOn: '2026-08-03',
      idempotencyKey: 'northstar-loc-received-2026-08-03',
    } as const;

    const first = service.confirmTrigger(
      ava,
      TEST_MATTER_ID,
      input,
      AUDIT_CONTEXT,
    );
    const replay = service.confirmTrigger(
      ava,
      TEST_MATTER_ID,
      input,
      AUDIT_CONTEXT,
    );

    expect(replay.deadline.id).toBe(first.deadline.id);
    expect(first.deadline.dueDate).toBe('2026-09-01');
    expect(first.deadline.explanation).toContain('20 working days');
  });

  it('returns CONFLICT when the expected workflow version is stale', () => {
    service.transitionStage(
      ava,
      TEST_MATTER_ID,
      {
        toStageKey: 'assessment',
        expectedVersion: 1,
        completedChecklistKeys: [
          'initial_contact_recorded',
          'conflict_check_completed',
        ],
        reason: 'Initial enquiry is complete and suitable for assessment.',
      },
      AUDIT_CONTEXT,
    );

    expect(() =>
      service.transitionStage(
        ava,
        TEST_MATTER_ID,
        {
          toStageKey: 'onboarding',
          expectedVersion: 1,
          completedChecklistKeys: [],
          reason: 'Assessment is complete and onboarding can now start.',
        },
        AUDIT_CONTEXT,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<WorkflowError>>({ code: 'CONFLICT' }),
    );
  });
  it('allows the explicit negotiation to settlement path but rejects unconfigured jumps', () => {
    database.prepare(
      `UPDATE matter_workflows SET current_stage_key = 'negotiation', version = 7
       WHERE firm_id = ? AND matter_id = ?`,
    ).run(SEED_IDS.northstarFirm, TEST_MATTER_ID);
    const negotiationReadiness: NegotiationReadinessProvider = {
      getNegotiationReadiness: () => ({
        controls: [{
          key: 'settlement_authority_recorded',
          eligible: true,
          explanation: 'Current settlement authority is recorded.',
        }],
        progressionBlockers: [],
      }),
    };
    const negotiationService = new WorkflowService(
      new MatterStore(database, () => FIXED_NOW),
      workflowStore,
      () => FIXED_NOW,
      undefined,
      undefined,
      undefined,
      negotiationReadiness,
    );

    expect(() => negotiationService.transitionStage(ava, TEST_MATTER_ID, {
      toStageKey: 'closure',
      expectedVersion: 7,
      completedChecklistKeys: ['settlement_authority_recorded'],
      reason: 'Attempting an unconfigured workflow stage jump for evaluation.',
    }, AUDIT_CONTEXT)).toThrowError(expect.objectContaining({ code: 'READINESS_BLOCKED' }));

    const result = negotiationService.transitionStage(ava, TEST_MATTER_ID, {
      toStageKey: 'settlement',
      expectedVersion: 7,
      completedChecklistKeys: ['settlement_authority_recorded'],
      reason: 'Exact settlement terms were agreed before proceedings were issued.',
    }, AUDIT_CONTEXT);
    expect(result.workflow.currentStageKey).toBe('settlement');
  });
});
