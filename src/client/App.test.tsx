import '@testing-library/jest-dom/vitest';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';

const userFixture = {
  id: '20000000-0000-4000-8000-000000000002',
  email: 'ava@northstar.test',
  name: 'Ava Morgan',
  role: 'solicitor',
  firm: { id: '10000000-0000-4000-8000-000000000001', name: 'Northstar Legal' },
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

const matterFixture = {
  id: '30000000-0000-4000-8000-000000000001',
  reference: 'NCL-2026-0017',
  title: 'Clarke v Meridian Housing',
  clientName: 'Maya Clarke',
  matterType: 'Housing conditions claim',
  status: 'open',
  stage: 'Pre-Action Protocol',
  riskLevel: 'high',
  openedAt: '2026-03-02',
  description:
    'Synthetic claim concerning persistent damp, mould and unresolved repairs.',
  externalSource: 'proclaim-demo',
  externalId: 'NCL-2026-0017',
  importBatchId: 'seed-2026-07',
  createdAt: '2026-03-02T09:15:00.000Z',
  updatedAt: '2026-07-13T08:30:00.000Z',
  owner: { id: userFixture.id, name: 'Ava Morgan' },
  nextDeadline: '2026-07-14T11:00:00.000Z',
  openTaskCount: 4,
};

const dashboardFixture = {
  summary: {
    activeMatters: 1,
    overdueTasks: 1,
    dueThisWeek: 2,
    highRiskMatters: 1,
  },
  urgentTasks: [
    {
      id: 'task-1',
      matterId: matterFixture.id,
      title: 'Review landlord repair disclosure',
      dueAt: '2026-07-11T15:00:00.000Z',
      priority: 'high',
      status: 'open',
      assignee: { id: userFixture.id, name: 'Ava Morgan' },
      matter: {
        reference: matterFixture.reference,
        title: matterFixture.title,
      },
    },
  ],
  recentMatters: [matterFixture],
  team: [
    { id: userFixture.id, name: 'Ava Morgan', email: userFixture.email, role: 'solicitor' },
  ],
};

const aggregateFixture = {
  matter: matterFixture,
  parties: [
    {
      id: 'party-1',
      kind: 'client',
      name: 'Maya Clarke',
      organisation: '',
      email: 'elaine@example.test',
      phone: '+44 7700 900123',
      address: 'Leeds',
      externalSource: null,
      externalId: null,
      createdAt: '2026-03-02T09:15:00.000Z',
    },
  ],
  tasks: [
    {
      id: 'task-1',
      title: 'Review landlord repair disclosure',
      notes: 'Flag missing repair and complaint records.',
      dueAt: '2026-07-11T15:00:00.000Z',
      priority: 'high',
      status: 'open',
      completedAt: null,
      createdAt: '2026-07-01T09:00:00.000Z',
      updatedAt: '2026-07-01T09:00:00.000Z',
      assignee: { id: userFixture.id, name: 'Ava Morgan' },
    },
  ],
  documents: [],
  timeline: [
    {
      id: 'event-1',
      type: 'stage.changed',
      title: 'Moved to Pre-Action Protocol',
      detail: 'Evidence reviewed and Letter of Claim sent.',
      occurredAt: '2026-07-07T14:20:00.000Z',
      actorName: 'Ava Morgan',
      metadata: {},
    },
  ],
  audit: [],
  permissions: { canWrite: true, canCreateMatter: false },
  team: dashboardFixture.team,
};

const summaryFixture = {
  matter: matterFixture,
  workflow: {
    id: 'workflow-1',
    version: 5,
    definitionVersion: 1,
    name: 'Housing Conditions — Claimant (England)',
    currentStageKey: 'protocol',
    currentStagePosition: 4,
    completedChecklistKeys: [],
    blockers: [],
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
        description: 'Complete client onboarding.',
        requiredChecklistKeys: [],
        state: 'completed',
      },
      {
        key: 'evidence',
        name: 'Evidence and notice',
        position: 3,
        description: 'Build the evidence and notice chronology.',
        requiredChecklistKeys: [],
        state: 'completed',
      },
      {
        key: 'protocol',
        name: 'Pre-Action Protocol',
        position: 4,
        description: 'Control the Letter of Claim and landlord response.',
        requiredChecklistKeys: ['letter_of_claim_sent'],
        state: 'current',
      },
      {
        key: 'expert',
        name: 'Expert evidence',
        position: 5,
        description: 'Control expert evidence.',
        requiredChecklistKeys: [],
        state: 'upcoming',
      },
    ],
  },
  deadlines: [
    {
      id: 'deadline-1',
      title: 'Landlord response to Letter of Claim',
      triggerDate: '2026-07-14',
      dueDate: '2026-08-11',
      status: 'pending',
      explanation:
        '20 working days after 14 July 2026 is 11 August 2026; weekends and 0 configured holidays excluded.',
      sourceTitle:
        'Pre-Action Protocol for Housing Conditions Claims (England), paragraph 6.2',
      sourceUrl:
        'https://www.justice.gov.uk/courts/procedure-rules/civil/protocol/prot_hou',
      ruleKey: 'housing.protocol.landlord_response',
    },
  ],
  nextActions: aggregateFixture.tasks,
  alerts: [],
  permissions: {
    canWrite: true,
    canTransition: true,
    canOverrideWorkflow: false,
  },
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('SwiftClaim client', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('shows the sign-in experience when there is no live session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(
          { error: { code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' } },
          { status: 401 },
        ),
      ),
    );

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: /your litigation work, in one place/i }),
    ).toBeVisible();
    expect(screen.getByLabelText(/work email/i)).toBeVisible();
    expect(screen.getByRole('button', { name: /sign in securely/i })).toBeEnabled();
  });

  it('renders urgent work from the authenticated firm dashboard', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/me') return json({ user: userFixture });
        if (url === '/api/dashboard') return json(dashboardFixture);
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<App />);

    expect(await screen.findByRole('heading', { name: /good afternoon, ava/i })).toBeVisible();
    expect(screen.getByText('Review landlord repair disclosure')).toBeVisible();
    expect(screen.getByText('1 overdue')).toBeVisible();
    expect(screen.getByText(matterFixture.reference)).toBeVisible();
  });

  it('routes claimant users into the enquiry queue from primary navigation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/me') return json({ user: userFixture });
        if (url === '/api/dashboard') return json(dashboardFixture);
        if (url === '/api/enquiries') return json({ enquiries: [] });
        if (url === '/api/users') return json({ users: dashboardFixture.team });
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<App />);
    await screen.findByRole('heading', { name: /good afternoon, ava/i });
    await userEvent.click(screen.getByRole('button', { name: 'Enquiries' }));

    expect(
      await screen.findByRole('heading', { name: 'Housing Conditions enquiries' }),
    ).toBeVisible();
    expect(window.location.pathname).toBe('/intake');
  });

  it('opens an accessible matter workspace from the dashboard', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/me') return json({ user: userFixture });
        if (url === '/api/dashboard') return json(dashboardFixture);
        if (url === `/api/matters/${matterFixture.id}/summary`)
          return json(summaryFixture);
        if (url === `/api/matters/${matterFixture.id}`) return json(aggregateFixture);
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<App />);
    await userEvent.click(await screen.findByText(matterFixture.reference));

    expect(
      await screen.findByRole('heading', { name: 'Clarke v Meridian Housing' }),
    ).toBeVisible();
    expect(screen.getAllByText('Pre-Action Protocol')[0]).toBeVisible();
    expect(screen.getAllByText('Maya Clarke')[0]).toBeVisible();
    expect(window.location.pathname).toBe(`/matters/${matterFixture.id}`);
  });

  it('surfaces a generic failed-login response without clearing the email', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/me') {
        return json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in.' } }, { status: 401 });
      }
      if (url === '/api/auth/login') {
        return json(
          {
            error: {
              code: 'INVALID_CREDENTIALS',
              message: 'Email or password is incorrect.',
            },
          },
          { status: 401 },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    const email = await screen.findByLabelText(/work email/i);
    await userEvent.clear(email);
    await userEvent.type(email, 'ava@northstar.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: /sign in securely/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Email or password is incorrect.',
    );
    expect(email).toHaveValue('ava@northstar.test');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('sends the visible workflow version and reloads Matter 360 after transition', async () => {
    let transitioned = false;
    let transitionBody: Record<string, unknown> | undefined;
    let summaryReads = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/me') return json({ user: userFixture });
        if (url === '/api/dashboard') return json(dashboardFixture);
        if (url === `/api/matters/${matterFixture.id}`)
          return json(aggregateFixture);
        if (url === `/api/matters/${matterFixture.id}/summary`) {
          summaryReads += 1;
          return json(
            transitioned
              ? {
                  ...summaryFixture,
                  workflow: {
                    ...summaryFixture.workflow,
                    version: 6,
                    currentStageKey: 'expert',
                    currentStagePosition: 5,
                    stages: summaryFixture.workflow.stages.map((stage) => ({
                      ...stage,
                      state:
                        stage.key === 'expert'
                          ? 'current'
                          : ('completed' as const),
                    })),
                  },
                }
              : summaryFixture,
          );
        }
        if (
          url ===
            `/api/matters/${matterFixture.id}/workflow/transitions` &&
          init?.method === 'POST'
        ) {
          transitionBody = JSON.parse(String(init.body)) as Record<
            string,
            unknown
          >;
          transitioned = true;
          return json(summaryFixture);
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await userEvent.click(await screen.findByText(matterFixture.reference));
    await userEvent.click(
      await screen.findByRole('button', { name: /move to expert evidence/i }),
    );
    await userEvent.type(
      screen.getByLabelText(/reason for transition/i),
      'Protocol work is complete and expert evidence can now proceed.',
    );
    await userEvent.click(
      screen.getByRole('button', { name: /confirm transition/i }),
    );

    await waitFor(() => {
      expect(transitionBody).toEqual({
        toStageKey: 'expert',
        expectedVersion: 5,
        completedChecklistKeys: [],
        reason: 'Protocol work is complete and expert evidence can now proceed.',
      });
      expect(summaryReads).toBe(2);
      expect(screen.getByText(/matter state v6/i)).toBeVisible();
    });
  });
});
