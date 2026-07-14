import '@testing-library/jest-dom/vitest';

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  Matter360Data,
  MatterAggregate,
  MatterIntakeProfile,
} from '../../api.js';
import { MatterPage } from '../../pages/MatterPage.js';
import { ClientHouseholdPanel } from './ClientHouseholdPanel.js';
import { PropertyTenancyPanel } from './PropertyTenancyPanel.js';

const profile: MatterIntakeProfile = {
  matterId: 'matter-1',
  enquiryId: 'enquiry-1',
  enquiryReference: 'HDR-E-2026-0001',
  client: {
    id: 'contact-1',
    displayName: 'Leah Benton',
    givenName: 'Leah',
    familyName: 'Benton',
    dateOfBirth: '1988-04-09',
    email: 'leah.benton@example.test',
    phone: '07000 000 101',
    preferredChannel: 'email',
    safeContactInstructions: 'Email first; telephone only after 4pm.',
    accessibilityNeeds: 'Large-print correspondence.',
    interpreterLanguage: 'Polish',
  },
  householdMembers: [
    {
      id: 'household-1',
      displayName: 'Noah Benton',
      relationship: 'Child',
      currentlyOccupies: true,
      claimParticipant: false,
      vulnerabilitySummary: 'Asthma aggravated by damp conditions.',
      accessibilityNeeds: 'Avoid morning appointments.',
    },
  ],
  property: {
    id: 'property-1',
    addressLine1: '42 Hazel Walk',
    addressLine2: 'Flat 6',
    city: 'Leeds',
    county: 'West Yorkshire',
    postcode: 'LS1 4AA',
    country: 'England',
    propertyType: 'flat',
  },
  landlord: { id: 'landlord-1', name: 'Civic North Homes', kind: 'landlord' },
  tenancy: {
    id: 'tenancy-1',
    tenancyType: 'assured',
    startedOn: '2021-06-01',
    endedOn: null,
    rentMinor: 62_500,
    currency: 'GBP',
    rentFrequency: 'monthly',
    occupancyStartedOn: '2021-06-01',
    occupancyEndedOn: null,
  },
  assessment: {
    id: 'assessment-1',
    enquiryId: 'enquiry-1',
    version: 1,
    jurisdictionConfirmed: true,
    claimantRelationship: 'tenant',
    noticeSummary: 'Reports made since November 2025.',
    conditionsUnresolved: true,
    conditionStartDate: '2025-10-01',
    accessSummary: 'Access offered.',
    evidenceSummary: 'Photographs and complaint emails available.',
    limitationReview: 'Reviewed and diarised.',
    legalIssues: ['section_11', 'fitness'],
    escalations: [],
    meritsRating: 'reasonable',
    proportionalityRating: 'reasonable',
    decision: 'proceed',
    decisionReason: 'Reasonable merits and proportionate to investigate.',
    reviewedBy: { id: 'user-ava', name: 'Ava Morgan', role: 'solicitor' },
    reviewedAt: '2026-07-13T12:00:00.000Z',
    updatedBy: { id: 'user-ava', name: 'Ava Morgan' },
    updatedAt: '2026-07-13T12:00:00.000Z',
  },
  onboarding: {
    id: 'onboarding-1',
    enquiryId: 'enquiry-1',
    version: 1,
    identityStatus: 'complete',
    clientCareStatus: 'complete',
    authorityStatus: 'complete',
    privacyStatus: 'complete',
    fundingType: 'cfa',
    fundingStatus: 'complete',
    signatureStatus: 'complete',
    vulnerabilitySummary: 'Child in the household has asthma.',
    accessibilityNeeds: 'Large-print correspondence.',
    interpreterLanguage: 'Polish',
    safeContactInstructions: 'Email first; telephone only after 4pm.',
    owner: { id: 'user-ava', name: 'Ava Morgan', role: 'solicitor' },
    supervisor: { id: 'user-partner', name: 'Marcus Reed', role: 'partner' },
    tenancy: null,
    householdMembers: [],
    updatedBy: { id: 'user-ava', name: 'Ava Morgan' },
    updatedAt: '2026-07-13T12:00:00.000Z',
  },
};

const party = {
  id: 'party-1',
  kind: 'client',
  name: 'Leah Benton',
  organisation: '',
  email: 'leah.benton@example.test',
  phone: '07000 000 101',
  address: '42 Hazel Walk, Leeds, LS1 4AA',
  externalSource: null,
  externalId: null,
  createdAt: '2026-07-13T12:00:00.000Z',
};

const summary = {
  matter: {
    id: 'matter-1',
    reference: 'HDR-2026-0001',
    title: 'Benton v Civic North Homes',
    clientName: 'Leah Benton',
    matterType: 'housing_conditions',
    status: 'open',
    stage: 'Evidence and notice',
    riskLevel: 'medium',
    openedAt: '2026-07-13T12:00:00.000Z',
    description: 'Housing Conditions claim.',
    externalSource: null,
    externalId: null,
    importBatchId: null,
    createdAt: '2026-07-13T12:00:00.000Z',
    updatedAt: '2026-07-13T12:00:00.000Z',
    owner: { id: 'user-ava', name: 'Ava Morgan' },
    nextDeadline: null,
    openTaskCount: 0,
  },
  workflow: {
    id: 'workflow-1',
    version: 4,
    definitionVersion: 1,
    name: 'Housing Conditions Claimant Workflow',
    currentStageKey: 'evidence_notice',
    currentStagePosition: 1,
    stages: [],
    completedChecklistKeys: [],
    blockers: [],
  },
  deadlines: [],
  nextActions: [],
  alerts: [],
  permissions: {
    canWrite: true,
    canTransition: true,
    canOverrideWorkflow: false,
  },
} satisfies Matter360Data;

const aggregate = {
  matter: summary.matter,
  parties: [party],
  tasks: [],
  documents: [],
  timeline: [],
  audit: [],
  permissions: { canWrite: true, canCreateMatter: false },
  team: [],
} satisfies MatterAggregate;

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('Matter intake profile panels', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('shows converted client controls and household vulnerabilities', () => {
    render(
      <ClientHouseholdPanel
        profile={profile}
        loading={false}
        error=""
        parties={[party]}
        canWrite
        onAddParty={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Leah Benton' })).toBeVisible();
    expect(screen.getByText('Identity complete')).toBeVisible();
    expect(screen.getByText('Email first; telephone only after 4pm.')).toBeVisible();
    expect(screen.getByText('Polish')).toBeVisible();
    expect(screen.getByText('Large-print correspondence.')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Noah Benton' })).toBeVisible();
    expect(screen.getByText('Asthma aggravated by damp conditions.')).toBeVisible();
  });

  it('shows property, landlord and date-only tenancy facts with rent from minor units', () => {
    render(
      <PropertyTenancyPanel
        profile={profile}
        loading={false}
        error=""
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: '42 Hazel Walk' })).toBeVisible();
    expect(screen.getByText('Civic North Homes')).toBeVisible();
    expect(screen.getByText('£625.00')).toBeVisible();
    expect(screen.getAllByText('1 Jun 2021')).toHaveLength(2);
    expect(screen.getByText('Assured')).toBeVisible();
  });

  it('keeps legacy parties usable when no converted intake profile exists', () => {
    render(
      <ClientHouseholdPanel
        profile={null}
        loading={false}
        error=""
        parties={[party]}
        canWrite
        onAddParty={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText('Legacy matter profile')).toBeVisible();
    expect(screen.getByText('leah.benton@example.test')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add party' })).toBeEnabled();
  });

  it('shows a generic independently retryable profile error', async () => {
    const onRetry = vi.fn();
    render(
      <PropertyTenancyPanel
        profile={undefined}
        loading={false}
        error="The converted intake profile is unavailable."
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The converted intake profile is unavailable.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Retry profile' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('loads the profile only for active profile sections without reloading the aggregate', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/matters/matter-1/summary') return json(summary);
      if (url === '/api/matters/matter-1') return json(aggregate);
      if (url === '/api/matters/matter-1/intake-profile') return json({ profile });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MatterPage matterId="matter-1" onBack={vi.fn()} />);
    await screen.findByText('Benton v Civic North Homes');
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/matters/matter-1/intake-profile',
      expect.anything(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Property & tenancy' }));
    expect(await screen.findByText('£625.00')).toBeVisible();
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input) === '/api/matters/matter-1'),
    ).toHaveLength(1);
  });

  it('aborts an outstanding profile request when the matter changes', async () => {
    let profileSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/summary')) return Promise.resolve(json(summary));
      if (url === '/api/matters/matter-1' || url === '/api/matters/matter-2') {
        return Promise.resolve(json(aggregate));
      }
      if (url.endsWith('/intake-profile')) {
        profileSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<MatterPage matterId="matter-1" onBack={vi.fn()} />);
    await screen.findByText('Benton v Civic North Homes');
    await userEvent.click(screen.getByRole('button', { name: 'Property & tenancy' }));
    await waitFor(() => expect(profileSignal).toBeDefined());

    await act(async () => {
      view.rerender(<MatterPage matterId="matter-2" onBack={vi.fn()} />);
    });

    expect(profileSignal?.aborted).toBe(true);
  });
});
