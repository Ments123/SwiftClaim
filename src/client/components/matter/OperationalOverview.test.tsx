import '@testing-library/jest-dom/vitest';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, type Matter360Data } from '../../api.js';
import { MatterHeader } from './MatterHeader.js';
import { OperationalOverview } from './OperationalOverview.js';

const data: Matter360Data = {
  matter: {
    id: 'matter-1',
    reference: 'NCL-2026-0017',
    title: 'Clarke v Meridian Housing',
    clientName: 'Elaine Clarke',
    matterType: 'Housing conditions claim',
    status: 'open',
    stage: 'Pre-action protocol',
    riskLevel: 'high',
    openedAt: '2026-03-02',
    description:
      'Claim concerning persistent damp, mould and unresolved bathroom leaks.',
    externalSource: 'proclaim-demo',
    externalId: 'NCL-2026-0017',
    importBatchId: 'seed-2026-07',
    createdAt: '2026-03-02T09:15:00.000Z',
    updatedAt: '2026-07-13T08:30:00.000Z',
    owner: { id: 'user-1', name: 'Ava Morgan' },
    nextDeadline: '2026-08-03T12:00:00.000Z',
    openTaskCount: 3,
  },
  workflow: {
    id: 'workflow-1',
    version: 4,
    definitionVersion: 1,
    name: 'Housing Conditions — Claimant (England)',
    currentStageKey: 'protocol',
    currentStagePosition: 4,
    completedChecklistKeys: [],
    blockers: [
      {
        key: 'letter_of_claim_sent',
        label: 'Letter of claim sent',
        severity: 'critical',
      },
    ],
    stages: [
      {
        key: 'enquiry',
        name: 'Enquiry',
        position: 0,
        description: 'Capture the enquiry.',
        requiredChecklistKeys: [],
        state: 'completed',
      },
      {
        key: 'assessment',
        name: 'Assessment',
        position: 1,
        description: 'Assess the claim.',
        requiredChecklistKeys: [],
        state: 'completed',
      },
      {
        key: 'onboarding',
        name: 'Onboarding',
        position: 2,
        description: 'Onboard the client.',
        requiredChecklistKeys: [],
        state: 'completed',
      },
      {
        key: 'evidence',
        name: 'Evidence and notice',
        position: 3,
        description: 'Build evidence.',
        requiredChecklistKeys: [],
        state: 'completed',
      },
      {
        key: 'protocol',
        name: 'Pre-action protocol',
        position: 4,
        description: 'Send and monitor the Letter of Claim.',
        requiredChecklistKeys: ['letter_of_claim_sent'],
        state: 'current',
      },
      {
        key: 'expert',
        name: 'Expert evidence',
        position: 5,
        description: 'Control expert evidence.',
        requiredChecklistKeys: ['expert_instruction_confirmed'],
        state: 'upcoming',
      },
    ],
  },
  deadlines: [
    {
      id: 'deadline-1',
      title: 'Landlord response to Letter of Claim',
      triggerDate: '2026-07-06',
      dueDate: '2026-08-03',
      status: 'pending',
      explanation:
        '20 working days after 6 July 2026 is 3 August 2026; weekends and 0 configured holidays excluded.',
      sourceTitle:
        'Pre-Action Protocol for Housing Conditions Claims (England), paragraph 6.2',
      sourceUrl:
        'https://www.justice.gov.uk/courts/procedure-rules/civil/protocol/prot_hou',
      ruleKey: 'housing.protocol.landlord_response',
    },
  ],
  nextActions: [
    {
      id: 'task-1',
      title: 'Review landlord disclosure',
      notes: 'Check the repair records and complaint history.',
      dueAt: '2026-07-28T12:00:00.000Z',
      priority: 'high',
      status: 'open',
      completedAt: null,
      createdAt: '2026-07-13T12:00:00.000Z',
      updatedAt: '2026-07-13T12:00:00.000Z',
      assignee: { id: 'user-1', name: 'Ava Morgan' },
    },
  ],
  alerts: [
    {
      key: 'workflow.readiness',
      severity: 'warning',
      title: '1 stage readiness check outstanding',
      detail: 'Complete the required control before moving forward.',
    },
  ],
  permissions: {
    canWrite: true,
    canTransition: true,
    canOverrideWorkflow: false,
  },
};

describe('OperationalOverview', () => {
  it('puts the matter position, workflow and legal source in view', () => {
    render(
      <>
        <MatterHeader data={data} />
        <OperationalOverview data={data} onTransition={vi.fn()} />
      </>,
    );

    expect(
      screen.getByRole('heading', { name: 'Clarke v Meridian Housing' }),
    ).toBeVisible();
    expect(screen.getAllByText('Pre-action protocol')[0]).toBeVisible();
    expect(
      screen.getByText('Landlord response to Letter of Claim'),
    ).toBeVisible();
    expect(screen.getByText(/20 working days after/i)).toBeVisible();
    expect(
      screen.getByRole('link', { name: /official source/i }),
    ).toHaveAttribute('href', expect.stringContaining('justice.gov.uk'));
    expect(screen.getByText('1 readiness blocker')).toBeVisible();
  });

  it('requires confirmation and sends the current workflow version', async () => {
    const onTransition = vi.fn().mockResolvedValue(undefined);
    render(<OperationalOverview data={data} onTransition={onTransition} />);

    await userEvent.click(
      screen.getByRole('button', { name: /move to expert evidence/i }),
    );
    const confirm = screen.getByRole('button', { name: /confirm transition/i });
    expect(confirm).toBeDisabled();

    await userEvent.click(screen.getByLabelText('Letter of claim sent'));
    await userEvent.type(
      screen.getByLabelText(/reason for transition/i),
      'Protocol work is complete and expert evidence can now proceed.',
    );
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    await waitFor(() =>
      expect(onTransition).toHaveBeenCalledWith({
        toStageKey: 'expert',
        expectedVersion: 4,
        completedChecklistKeys: ['letter_of_claim_sent'],
        reason: 'Protocol work is complete and expert evidence can now proceed.',
      }),
    );
  });

  it('shows actionable copy when another user changed the workflow', async () => {
    const onTransition = vi
      .fn()
      .mockRejectedValue(
        new ApiError(409, 'CONFLICT', 'The workflow was changed.'),
      );
    render(<OperationalOverview data={data} onTransition={onTransition} />);

    await userEvent.click(
      screen.getByRole('button', { name: /move to expert evidence/i }),
    );
    await userEvent.click(screen.getByLabelText('Letter of claim sent'));
    await userEvent.type(
      screen.getByLabelText(/reason for transition/i),
      'Protocol work is complete and expert evidence can now proceed.',
    );
    await userEvent.click(
      screen.getByRole('button', { name: /confirm transition/i }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This matter changed in another window',
    );
  });
});
