import '@testing-library/jest-dom/vitest';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CurrentUser } from '../api.js';
import { EnquiryPage } from './EnquiryPage.js';

const userFixture: CurrentUser = {
  id: 'user-ava',
  email: 'ava@northstar.test',
  name: 'Ava Morgan',
  role: 'solicitor',
  firm: { id: 'firm-1', name: 'Northstar Legal' },
  permissions: {
    canCreateMatter: false,
    canViewAdministration: false,
    canTransitionWorkflow: true,
    canOverrideWorkflow: false,
    canConfirmDeadline: true,
    canAccessIntake: true,
    canWriteIntake: true,
    canDecideIntake: true,
    canOverrideConflict: false,
    canConvertIntake: true,
  },
};

const enquiry = {
  id: 'enquiry-1',
  reference: 'HDR-E-2026-0001',
  status: 'new',
  version: 1,
  source: 'Website',
  referrerName: '',
  summary: 'Damp, mould and heating complaint requiring legal assessment.',
  defectSummary: 'Bedroom damp, black mould and intermittent heating.',
  desiredOutcome: 'Repairs and compensation.',
  firstComplainedOn: '2025-11-03',
  currentlyOccupied: true,
  urgency: 'priority',
  immediateSafetyConcerns: '',
  communicationRequirements: '',
  decisionReason: '',
  createdAt: '2026-07-13T12:00:00.000Z',
  updatedAt: '2026-07-13T12:00:00.000Z',
  client: {
    id: 'contact-1',
    displayName: 'Leah Benton',
    givenName: 'Leah',
    familyName: 'Benton',
    dateOfBirth: '1988-04-09',
    email: 'leah.benton@example.test',
    phone: '07000 000 101',
    preferredChannel: 'email',
  },
  property: {
    id: 'property-1',
    addressLine1: '42 Hazel Walk',
    addressLine2: '',
    city: 'Leeds',
    county: 'West Yorkshire',
    postcode: 'LS1 4AA',
    country: 'England',
    propertyType: 'flat',
  },
  landlord: { id: 'landlord-1', name: 'Civic North Homes', kind: 'landlord' },
  assignedTo: { id: 'user-ava', name: 'Ava Morgan', role: 'solicitor' },
};

const assessment = {
  id: 'assessment-1',
  enquiryId: enquiry.id,
  version: 1,
  jurisdictionConfirmed: true,
  claimantRelationship: 'tenant',
  noticeSummary: 'Repeated reports were made to the landlord from November 2025.',
  conditionsUnresolved: true,
  conditionStartDate: '2025-10-01',
  accessSummary: 'The client has offered access and no appointment is outstanding.',
  evidenceSummary: 'Photographs, complaint emails and repair references are available.',
  limitationReview: 'Limitation reviewed from the earliest actionable period and diarised.',
  legalIssues: ['section_11', 'fitness'],
  escalations: [],
  meritsRating: 'reasonable',
  proportionalityRating: 'reasonable',
  decision: 'proceed',
  decisionReason: 'The claim has reasonable merits and is proportionate to investigate.',
  reviewedBy: { id: 'user-ava', name: 'Ava Morgan', role: 'solicitor' },
  reviewedAt: '2026-07-13T12:00:00.000Z',
  updatedBy: { id: 'user-ava', name: 'Ava Morgan' },
  updatedAt: '2026-07-13T12:00:00.000Z',
};

const onboarding = {
  id: 'onboarding-1',
  enquiryId: enquiry.id,
  version: 1,
  identityStatus: 'complete',
  clientCareStatus: 'complete',
  authorityStatus: 'complete',
  privacyStatus: 'complete',
  fundingType: 'cfa',
  fundingStatus: 'complete',
  signatureStatus: 'complete',
  vulnerabilitySummary: 'Child in the household has asthma.',
  accessibilityNeeds: '',
  interpreterLanguage: null,
  safeContactInstructions: 'Email first; telephone after 4pm.',
  owner: { id: 'user-ava', name: 'Ava Morgan', role: 'solicitor' },
  supervisor: { id: 'user-partner', name: 'Marcus Reed', role: 'partner' },
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
  householdMembers: [
    {
      id: 'household-1',
      displayName: 'Noah Benton',
      relationship: 'Child',
      currentlyOccupies: true,
      claimParticipant: false,
      vulnerabilitySummary: 'Asthma aggravated by damp conditions.',
      accessibilityNeeds: '',
    },
  ],
  updatedBy: { id: 'user-ava', name: 'Ava Morgan' },
  updatedAt: '2026-07-13T12:00:00.000Z',
};

const blockers = [
  {
    key: 'conflict_decision',
    label: 'A human decision on the latest conflict check is required.',
    severity: 'critical',
  },
  {
    key: 'legal_assessment',
    label: 'A reviewed legal assessment is required.',
    severity: 'critical',
  },
];

const baseWorkspace = {
  enquiry,
  conflict: { latestCheck: null, latestDecision: null },
  assessment: null,
  onboarding: null,
  readiness: {
    assessment: { ready: false, blockers },
    onboarding: { ready: false, blockers: [] },
    conversion: {
      ready: false,
      blockers: [
        { key: 'enquiry_accepted', label: 'The enquiry must be accepted.', severity: 'critical' },
        ...blockers,
      ],
    },
  },
  conversion: null,
};

const team = [
  { id: 'user-ava', name: 'Ava Morgan', email: 'ava@northstar.test', role: 'solicitor' },
  { id: 'user-partner', name: 'Marcus Reed', email: 'partner@northstar.test', role: 'partner' },
];

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function renderPage(onConverted = vi.fn()) {
  return {
    onConverted,
    ...render(
      <EnquiryPage
        enquiryId="enquiry-1"
        user={userFixture}
        onBack={vi.fn()}
        onConverted={onConverted}
      />,
    ),
  };
}

describe('EnquiryPage', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('loads the workspace and makes every controlled section keyboard-addressable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/enquiries/enquiry-1') return json(baseWorkspace);
        if (url === '/api/users') return json({ users: team });
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Leah Benton' })).toBeVisible();
    expect(screen.getByText('HDR-E-2026-0001')).toBeVisible();
    for (const section of ['Enquiry', 'Conflicts', 'Assessment', 'Onboarding', 'Decision']) {
      expect(screen.getByRole('button', { name: section })).toBeEnabled();
    }
    await userEvent.click(screen.getByRole('button', { name: 'Decision' }));
    expect(screen.getAllByText('A reviewed legal assessment is required.')[0]).toBeVisible();
    expect(screen.getByRole('button', { name: 'Convert to matter' })).toBeDisabled();
  });

  it('runs a conflict search and shows that a human decision is still required', async () => {
    let checked = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/users') return json({ users: team });
      if (url === '/api/enquiries/enquiry-1' && !init?.method) {
        return json(
          checked
            ? {
                ...baseWorkspace,
                conflict: {
                  latestCheck: {
                    id: 'check-1',
                    enquiryId: enquiry.id,
                    matchCount: 0,
                    matches: [],
                    runAt: '2026-07-13T12:00:00.000Z',
                    runBy: { id: 'user-ava', name: 'Ava Morgan' },
                  },
                  latestDecision: null,
                },
              }
            : baseWorkspace,
        );
      }
      if (
        url === '/api/enquiries/enquiry-1/conflict-checks' &&
        init?.method === 'POST'
      ) {
        checked = true;
        return json({ check: { id: 'check-1', matchCount: 0, matches: [] } }, { status: 201 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByRole('heading', { name: 'Leah Benton' });
    await userEvent.click(screen.getByRole('button', { name: 'Conflicts' }));
    await userEvent.click(screen.getByRole('button', { name: 'Run conflict check' }));
    expect(await screen.findByText('Human decision required')).toBeVisible();
    expect(screen.getByText('No potential matches found')).toBeVisible();
  });

  it('defaults a replacement conflict check with matches to blocked', async () => {
    let checkNumber = 1;
    const conflictCheck = () => ({
      id: `check-${checkNumber}`,
      enquiryId: enquiry.id,
      matchCount: checkNumber === 1 ? 0 : 1,
      matches:
        checkNumber === 1
          ? []
          : [
              {
                source: 'matter',
                sourceId: 'matter-existing',
                display: 'Civic North Homes · HDR-2025-0042',
                matchedOn: ['landlord'],
              },
            ],
      runAt: '2026-07-13T12:00:00.000Z',
      runBy: { id: 'user-ava', name: 'Ava Morgan' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/users') return json({ users: team });
        if (url === '/api/enquiries/enquiry-1' && !init?.method) {
          return json({
            ...baseWorkspace,
            conflict: { latestCheck: conflictCheck(), latestDecision: null },
          });
        }
        if (
          url === '/api/enquiries/enquiry-1/conflict-checks' &&
          init?.method === 'POST'
        ) {
          checkNumber = 2;
          return json({ check: conflictCheck() }, { status: 201 });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    renderPage();
    await screen.findByRole('heading', { name: 'Leah Benton' });
    await userEvent.click(screen.getByRole('button', { name: 'Conflicts' }));
    expect(screen.getByRole('radio', { name: /ClearOnly available/ })).toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'Run conflict check' }));

    expect(await screen.findByText('1 potential match')).toBeVisible();
    expect(screen.getByRole('radio', { name: /BlockedDo not proceed/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /ClearOnly available/ })).not.toBeChecked();
  });

  it('sends the visible enquiry version when saving the legal assessment', async () => {
    const workspace = {
      ...baseWorkspace,
      enquiry: { ...enquiry, status: 'assessment', version: 2 },
      assessment,
    };
    let body: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/users') return json({ users: team });
      if (url === '/api/enquiries/enquiry-1' && !init?.method) return json(workspace);
      if (url === '/api/enquiries/enquiry-1/assessment' && init?.method === 'PUT') {
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json({ enquiry: workspace.enquiry, assessment, readiness: workspace.readiness });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByRole('heading', { name: 'Leah Benton' });
    await userEvent.click(screen.getByRole('button', { name: 'Assessment' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save legal assessment' }));
    await waitFor(() => {
      expect(body).toMatchObject({
        expectedVersion: 2,
        jurisdictionConfirmed: true,
        decision: 'proceed',
        legalIssues: ['section_11', 'fitness'],
      });
    });
  });

  it('records an authorised acceptance decision with an audit-safe reason', async () => {
    const workspace = {
      ...baseWorkspace,
      enquiry: { ...enquiry, status: 'assessment', version: 2 },
      assessment,
      readiness: {
        ...baseWorkspace.readiness,
        assessment: { ready: true, blockers: [] },
      },
    };
    let body: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/users') return json({ users: team });
        if (url === '/api/enquiries/enquiry-1' && !init?.method) return json(workspace);
        if (url === '/api/enquiries/enquiry-1/decisions' && init?.method === 'POST') {
          body = JSON.parse(String(init.body)) as Record<string, unknown>;
          return json({ enquiry: { ...workspace.enquiry, status: 'accepted', version: 3 } });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    renderPage();
    await screen.findByRole('heading', { name: 'Leah Benton' });
    await userEvent.click(screen.getByRole('button', { name: 'Decision' }));
    await userEvent.selectOptions(screen.getByLabelText('Outcome'), 'accepted');
    await userEvent.type(
      screen.getByLabelText('Decision reason'),
      'Approved criteria are satisfied following a reviewed legal assessment.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    await waitFor(() =>
      expect(body).toEqual({
        expectedVersion: 2,
        outcome: 'accepted',
        reason: 'Approved criteria are satisfied following a reviewed legal assessment.',
      }),
    );
  });

  it('captures every household member in the onboarding command', async () => {
    const workspace = {
      ...baseWorkspace,
      enquiry: { ...enquiry, status: 'accepted', version: 4 },
      assessment,
      onboarding,
    };
    let body: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/users') return json({ users: team });
        if (url === '/api/enquiries/enquiry-1' && !init?.method) return json(workspace);
        if (url === '/api/enquiries/enquiry-1/onboarding' && init?.method === 'PUT') {
          body = JSON.parse(String(init.body)) as Record<string, unknown>;
          return json({ enquiry: workspace.enquiry, onboarding, readiness: workspace.readiness });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    renderPage();
    await screen.findByRole('heading', { name: 'Leah Benton' });
    await userEvent.click(screen.getByRole('button', { name: 'Onboarding' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add household member' }));
    await userEvent.type(screen.getByLabelText('Household member 2 name'), 'Mia Benton');
    await userEvent.type(screen.getByLabelText('Household member 2 relationship'), 'Child');
    await userEvent.click(screen.getByLabelText('Household member 2 claim participant'));
    await userEvent.type(
      screen.getByLabelText('Household member 2 vulnerability'),
      'Respiratory symptoms require priority repairs.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save onboarding' }));

    await waitFor(() =>
      expect(body).toMatchObject({
        expectedVersion: 4,
        householdMembers: [
          {
            displayName: 'Noah Benton',
            relationship: 'Child',
            currentlyOccupies: true,
            claimParticipant: false,
          },
          {
            displayName: 'Mia Benton',
            relationship: 'Child',
            currentlyOccupies: true,
            claimParticipant: true,
            vulnerabilitySummary: 'Respiratory symptoms require priority repairs.',
          },
        ],
      }),
    );
  });

  it('converts only when server readiness is clear and opens the resulting matter', async () => {
    const onConverted = vi.fn();
    const workspace = {
      ...baseWorkspace,
      enquiry: { ...enquiry, status: 'accepted', version: 4 },
      assessment,
      onboarding,
      readiness: {
        assessment: { ready: true, blockers: [] },
        onboarding: { ready: true, blockers: [] },
        conversion: { ready: true, blockers: [] },
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/users') return json({ users: team });
        if (url === '/api/enquiries/enquiry-1' && !init?.method) return json(workspace);
        if (url === '/api/enquiries/enquiry-1/convert' && init?.method === 'POST') {
          return json(
            {
              replayed: false,
              matter: { id: 'matter-1', reference: 'HDR-2026-0001' },
            },
            { status: 201 },
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    renderPage(onConverted);
    await screen.findByRole('heading', { name: 'Leah Benton' });
    await userEvent.click(screen.getByRole('button', { name: 'Decision' }));
    await userEvent.click(screen.getByRole('button', { name: 'Convert to matter' }));
    await waitFor(() => expect(onConverted).toHaveBeenCalledWith('matter-1'));
  });

  it('aborts outstanding workspace reads when the enquiry changes or unmounts', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.signal) signals.push(init.signal);
        return new Promise<Response>(() => undefined);
      }),
    );
    const view = renderPage();
    await waitFor(() => expect(signals.length).toBe(2));
    view.unmount();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
