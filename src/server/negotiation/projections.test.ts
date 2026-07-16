import { describe, expect, it } from 'vitest';

import {
  projectAction,
  projectObligation,
  projectSettlement,
  type NegotiationApprovalProjectionEvent,
  type NegotiationInstructionProjectionEvent,
  type ObligationProjectionEvent,
} from './projections.js';

const instruction = (
  actionVersion: number,
  occurredAt = '2026-08-20T09:00:00.000Z',
): NegotiationInstructionProjectionEvent => ({
  id: `instruction-${actionVersion}`,
  actionVersion,
  occurredAt,
  supersedesInstructionId: null,
});

const approval = (
  actionVersion: number,
  decision: NegotiationApprovalProjectionEvent['decision'] = 'approved',
  occurredAt = '2026-08-20T09:05:00.000Z',
): NegotiationApprovalProjectionEvent => ({
  id: `approval-${actionVersion}-${decision}`,
  actionVersion,
  decision,
  occurredAt,
});

const obligationEvent = (
  id: string,
  eventType: ObligationProjectionEvent['eventType'],
  occurredAt: string,
  overrides: Partial<ObligationProjectionEvent> = {},
): ObligationProjectionEvent => ({
  id,
  eventType,
  occurredAt,
  recordedAt: occurredAt,
  supersedesEventId: null,
  ...overrides,
});

describe('negotiation projections', () => {
  it('invalidates instruction and approval when a newer exact action version exists', () => {
    expect(projectAction({
      currentVersion: 2,
      cancelled: false,
      superseded: false,
      instructions: [instruction(1)],
      approvals: [approval(1)],
      externalActs: [],
    })).toEqual({
      state: 'instruction_required',
      instructionCurrent: false,
      approvalCurrent: false,
      canRecordExternalAction: false,
      producingExternalActId: null,
    });
  });

  it('requires the latest exact-version decision to approve the action', () => {
    expect(projectAction({
      currentVersion: 2,
      cancelled: false,
      superseded: false,
      instructions: [instruction(2)],
      approvals: [
        approval(2, 'approved', '2026-08-20T09:05:00.000Z'),
        approval(2, 'rejected', '2026-08-20T09:06:00.000Z'),
      ],
      externalActs: [],
    })).toMatchObject({
      state: 'approval_required',
      instructionCurrent: true,
      approvalCurrent: false,
      canRecordExternalAction: false,
    });
  });

  it('projects an exact authorised action without claiming it was external', () => {
    expect(projectAction({
      currentVersion: 3,
      cancelled: false,
      superseded: false,
      instructions: [instruction(3)],
      approvals: [approval(3)],
      externalActs: [],
    })).toMatchObject({
      state: 'authorised',
      canRecordExternalAction: true,
      producingExternalActId: null,
    });
  });

  it('keeps asserted performance separate from satisfaction', () => {
    expect(projectObligation([
      obligationEvent(
        'event-asserted',
        'performance_asserted',
        '2026-09-01T09:00:00.000Z',
      ),
    ], '2026-09-02T09:00:00.000Z', '2026-09-01T12:00:00.000Z')).toEqual({
      state: 'performance_asserted',
      satisfiedAt: null,
      waivedAt: null,
      disputedAt: null,
      overdue: true,
      producingEventId: 'event-asserted',
    });
  });

  it('uses explicit correction without deleting the historical obligation event', () => {
    expect(projectObligation([
      obligationEvent('event-satisfied', 'satisfied', '2026-09-01T09:00:00.000Z'),
      obligationEvent('event-correction', 'corrected', '2026-09-01T10:00:00.000Z', {
        supersedesEventId: 'event-satisfied',
      }),
      obligationEvent('event-disputed', 'disputed', '2026-09-01T11:00:00.000Z'),
    ], '2026-09-01T12:00:00.000Z', null)).toMatchObject({
      state: 'disputed',
      satisfiedAt: null,
      disputedAt: '2026-09-01T11:00:00.000Z',
      producingEventId: 'event-disputed',
    });
  });

  it('does not project settlement conclusion without exact terms and approval evidence', () => {
    expect(projectSettlement({
      currentTermsVersion: 2,
      instructionTermsVersion: 1,
      approvalTermsVersion: 1,
      instrumentRecorded: true,
      courtApprovalPosition: 'not_required_reviewed',
      concludedAt: '2026-09-02T09:00:00.000Z',
    })).toEqual({
      state: 'authority_required',
      instructionCurrent: false,
      approvalCurrent: false,
      courtApprovalReviewed: true,
      canConclude: false,
    });
  });
});
