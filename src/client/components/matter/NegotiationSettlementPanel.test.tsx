import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { NegotiationWorkspace } from '../../api.js';
import { NegotiationSettlementPanel } from './NegotiationSettlementPanel.js';

const ordinary: NegotiationWorkspace = {
  matterId: 'matter-1',
  reviews: [],
  instructions: [],
  actions: [],
  settlements: [],
  currentAuthority: null,
};

const protectedWorkspace: NegotiationWorkspace = {
  ...ordinary,
  reviews: [{
    id: 'review-1',
    reviewNumber: 1,
    confidentiality: 'protected_negotiation',
    reviewedOn: '2026-08-20',
    confirmedFacts: 'Protected facts.',
    optionsExplained: 'Protected options.',
    riskAnalysis: 'Protected settlement floor must remain in the explicit protected view.',
    costsFundingExplanation: 'Protected costs position.',
    humanRecommendation: 'Human recommendation.',
    adviceLimitations: 'No autonomous legal conclusion.',
    clientQuestions: '',
    sourceManifestDigest: 'a'.repeat(64),
    supersedesReviewId: null,
    createdAt: '2026-08-20T12:00:00.000Z',
  }],
  instructions: [],
  actions: [{
    id: 'action-1',
    actionReference: 'NA-001',
    recordVersion: 2,
    actionType: 'counteroffer',
    confidentiality: 'protected_negotiation',
    currentVersion: { id: 'action-v1', version: 1, totalMinor: 300_000, currency: 'GBP' },
    projection: {
      state: 'approval_required',
      instructionCurrent: true,
      approvalCurrent: false,
      canRecordExternalAction: false,
    },
  }],
  currentAuthority: {
    id: 'authority-1',
    version: 1,
    source: 'client_specific',
    scope: 'Exact authority for the synthetic counteroffer.',
    actionTypes: ['counteroffer'],
    minimumAmountMinor: 250_000,
    maximumAmountMinor: 350_000,
    requiresClientInstruction: true,
    requiresPartnerApproval: true,
    expiresAt: null,
    reviewOn: '2026-09-01',
    reviewNote: 'Human reviewed authority.',
  },
};

describe('NegotiationSettlementPanel', () => {
  it('does not render protected content until the explicit endpoint is opened', async () => {
    const loadProtected = vi.fn().mockResolvedValue(protectedWorkspace);
    render(<NegotiationSettlementPanel matterId="matter-1" workspace={ordinary} onRefresh={vi.fn()} loadProtected={loadProtected} />);

    expect(screen.queryByText(/Protected settlement floor/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open protected view' }));
    expect(await screen.findByText('Protected view active')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Advice & instructions' }));
    expect(screen.getByText(/Protected settlement floor/)).toBeInTheDocument();
    expect(loadProtected).toHaveBeenCalledOnce();
  });

  it('shows exact instruction and approval gates without claiming authorisation', async () => {
    render(<NegotiationSettlementPanel matterId="matter-1" workspace={protectedWorkspace} onRefresh={vi.fn()} loadProtected={vi.fn()} />);

    expect(screen.getByText('approval required')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.queryByText('Authorised')).not.toBeInTheDocument();
  });
});
