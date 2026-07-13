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
  permissions: { canCreateMatter: false, canViewAdministration: false },
};

const matterFixture = {
  id: '30000000-0000-4000-8000-000000000001',
  reference: 'NCL-2026-0017',
  title: 'Clarke v Meridian Insurance',
  clientName: 'Elaine Clarke',
  matterType: 'Personal injury litigation',
  status: 'open',
  stage: 'Disclosure',
  riskLevel: 'high',
  openedAt: '2026-03-02',
  description: 'High-value claim concerning disputed causation and future loss.',
  externalSource: 'proclaim-demo',
  externalId: 'NCL-2026-0017',
  importBatchId: 'seed-2026-07',
  createdAt: '2026-03-02T09:15:00.000Z',
  updatedAt: '2026-07-13T08:30:00.000Z',
  owner: { id: userFixture.id, name: 'Ava Morgan' },
  nextDeadline: '2026-07-11T15:00:00.000Z',
  openTaskCount: 3,
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
      title: 'Review defendant disclosure',
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
      name: 'Elaine Clarke',
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
      title: 'Review defendant disclosure',
      notes: 'Flag gaps.',
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
      title: 'Moved to disclosure',
      detail: 'Pleadings closed.',
      occurredAt: '2026-07-07T14:20:00.000Z',
      actorName: 'Ava Morgan',
      metadata: {},
    },
  ],
  audit: [],
  permissions: { canWrite: true, canCreateMatter: false },
  team: dashboardFixture.team,
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
    expect(screen.getByText('Review defendant disclosure')).toBeVisible();
    expect(screen.getByText('1 overdue')).toBeVisible();
    expect(screen.getByText(matterFixture.reference)).toBeVisible();
  });

  it('opens an accessible matter workspace from the dashboard', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/me') return json({ user: userFixture });
        if (url === '/api/dashboard') return json(dashboardFixture);
        if (url === `/api/matters/${matterFixture.id}`) return json(aggregateFixture);
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<App />);
    await userEvent.click(await screen.findByText(matterFixture.reference));

    expect(
      await screen.findByRole('heading', { name: 'Clarke v Meridian Insurance' }),
    ).toBeVisible();
    expect(screen.getByText('Disclosure')).toBeVisible();
    expect(screen.getByText('Elaine Clarke')).toBeVisible();
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
});
