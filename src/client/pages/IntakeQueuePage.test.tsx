import '@testing-library/jest-dom/vitest';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CurrentUser } from '../api.js';
import { IntakeQueuePage } from './IntakeQueuePage.js';

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
    canPrepareProtocol: true,
    canApproveProtocol: true,
    canOverrideExpertConflict: false,
    canReviewExpertReport: true,
  },
};

const enquiryFixture = {
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
  urgency: 'urgent',
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

const team = [
  { id: 'user-ava', name: 'Ava Morgan', email: 'ava@northstar.test', role: 'solicitor' },
  { id: 'user-ben', name: 'Ben Foster', email: 'ben@northstar.test', role: 'paralegal' },
];

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('IntakeQueuePage', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('shows operational counts and filters the dense enquiry queue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/enquiries') {
          return json({
            enquiries: [
              enquiryFixture,
              {
                ...enquiryFixture,
                id: 'enquiry-2',
                reference: 'HDR-E-2026-0002',
                status: 'assessment',
                urgency: 'routine',
                client: { ...enquiryFixture.client, displayName: 'Imani Cole' },
                landlord: { ...enquiryFixture.landlord, name: 'West Borough Housing' },
              },
            ],
          });
        }
        if (url === '/api/users') return json({ users: team });
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(
      <IntakeQueuePage
        user={userFixture}
        onOpenEnquiry={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: 'Housing Conditions enquiries' }),
    ).toBeVisible();
    expect(screen.getByText('HDR-E-2026-0001')).toBeVisible();
    expect(screen.getByText('1 urgent')).toBeVisible();
    await userEvent.type(screen.getByLabelText('Search enquiries'), 'Imani');
    expect(screen.queryByText('Leah Benton')).not.toBeInTheDocument();
    expect(screen.getByText('Imani Cole')).toBeVisible();
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'new');
    expect(screen.getByText('No enquiries match these filters')).toBeVisible();
  });

  it('creates a properly assigned enquiry and opens its workspace', async () => {
    const onOpenEnquiry = vi.fn();
    let submitted: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/enquiries' && init?.method === 'POST') {
          submitted = JSON.parse(String(init.body)) as Record<string, unknown>;
          return json({ enquiry: enquiryFixture }, { status: 201 });
        }
        if (url === '/api/enquiries') return json({ enquiries: [] });
        if (url === '/api/users') return json({ users: team });
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(
      <IntakeQueuePage
        user={userFixture}
        onOpenEnquiry={onOpenEnquiry}
      />,
    );
    await screen.findByRole('heading', { name: 'Housing Conditions enquiries' });
    await userEvent.click(screen.getByRole('button', { name: 'New enquiry' }));
    await userEvent.type(screen.getByLabelText('First name'), 'Leah');
    await userEvent.type(screen.getByLabelText('Last name'), 'Benton');
    await userEvent.type(screen.getByLabelText('Email'), 'leah@example.test');
    await userEvent.type(screen.getByLabelText('Phone'), '07000 000 101');
    await userEvent.type(screen.getByLabelText('Address line 1'), '42 Hazel Walk');
    await userEvent.type(screen.getByLabelText('City'), 'Leeds');
    await userEvent.type(screen.getByLabelText('Postcode'), 'LS1 4AA');
    await userEvent.type(screen.getByLabelText('Landlord'), 'Civic North Homes');
    await userEvent.type(
      screen.getByLabelText('Initial summary'),
      'Damp and mould complaint requiring legal assessment.',
    );
    await userEvent.type(
      screen.getByLabelText('Reported defects'),
      'Bedroom damp and black mould.',
    );
    await userEvent.selectOptions(screen.getByLabelText('Assigned to'), 'user-ben');
    await userEvent.click(screen.getByRole('button', { name: 'Create enquiry' }));

    await waitFor(() => {
      expect(submitted).toMatchObject({
        source: 'Direct',
        assignedUserId: 'user-ben',
        client: { givenName: 'Leah', familyName: 'Benton' },
        property: { country: 'England' },
      });
      expect(onOpenEnquiry).toHaveBeenCalledWith('enquiry-1');
    });
  });

  it('shows a recoverable load failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === '/api/users') return json({ users: team });
        return json(
          { error: { code: 'INTERNAL_ERROR', message: 'Queue temporarily unavailable.' } },
          { status: 500 },
        );
      }),
    );
    render(<IntakeQueuePage user={userFixture} onOpenEnquiry={vi.fn()} />);
    expect(
      await screen.findByRole('heading', { name: 'We could not load enquiries' }),
    ).toBeVisible();
    expect(screen.getByText('Queue temporarily unavailable.')).toBeVisible();
  });

  it('aborts outstanding queue reads when it unmounts', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.signal) signals.push(init.signal);
        return new Promise<Response>(() => undefined);
      }),
    );
    const view = render(
      <IntakeQueuePage user={userFixture} onOpenEnquiry={vi.fn()} />,
    );
    await waitFor(() => expect(signals.length).toBe(2));
    view.unmount();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
