import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api.js')>();
  return { ...actual, request: vi.fn() };
});

import { request } from '../../api.js';
import { FinanceDialogs } from './FinanceDialogs.js';

describe('FinanceDialogs', () => {
  beforeEach(() => {
    vi.mocked(request).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reuses one idempotency key when a human retries the same command', async () => {
    const onSaved = vi.fn();
    const mockedRequest = vi.mocked(request);
    mockedRequest
      .mockRejectedValueOnce(new Error('The response was lost.'))
      .mockResolvedValueOnce(undefined);

    render(<FinanceDialogs
      command={{ kind: 'manual_time' }}
      matterId="matter-1"
      documentSources={[]}
      onClose={() => undefined}
      onSaved={onSaved}
    />);

    fireEvent.change(screen.getByLabelText('Narrative'), {
      target: { value: 'Reviewed attendance recorded by the fee earner.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & save' }));
    expect((await screen.findByRole('alert')).textContent).toContain('The response was lost.');

    fireEvent.click(screen.getByRole('button', { name: 'Confirm & save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

    const firstBody = JSON.parse(String(mockedRequest.mock.calls[0]?.[1]?.body)) as { idempotencyKey: string };
    const retryBody = JSON.parse(String(mockedRequest.mock.calls[1]?.[1]?.body)) as { idempotencyKey: string };
    expect(firstBody.idempotencyKey).toBe(retryBody.idempotencyKey);
  });

  it('freezes human approval timestamps across a lost-response retry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-19T09:25:00.000Z'));
    const onSaved = vi.fn();
    const mockedRequest = vi.mocked(request);
    mockedRequest
      .mockRejectedValueOnce(new Error('The response was lost.'))
      .mockResolvedValueOnce(undefined);

    render(<FinanceDialogs
      command={{
        kind: 'approve_time',
        timeEntry: {
          id: 'time-1', userId: 'user-2', workDate: '2026-07-19', minutes: 18,
          narrative: 'Reviewed telephone attendance.', activityCode: 'telephone_attendance',
          costsPhase: 'communications', chargeable: true, sourceKind: 'communication_call',
          sourceId: '81000000-0000-4000-8000-000000000001', currency: 'GBP',
          status: 'submitted', version: 1, createdBy: 'user-2',
          createdAt: '2026-07-19T09:00:00.000Z', events: [], approvalId: null,
          rateVersionId: null, rateEntryId: null, gradeSnapshot: null,
          hourlyRateMinor: null, chargeMinor: null, remainderNumerator: null,
          denominator: null, approvedBy: null, approvedAt: null, approvalNote: null,
        },
      }}
      matterId="matter-1"
      documentSources={[]}
      onClose={() => undefined}
      onSaved={onSaved}
    />);

    vi.setSystemTime(new Date('2026-07-19T09:30:00.000Z'));
    fireEvent.change(screen.getByLabelText('Independent approval note'), {
      target: { value: 'Independently checked against the exact time source.' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm & save' }));
      await Promise.resolve();
    });
    expect(screen.getByRole('alert').textContent).toContain('The response was lost.');

    vi.setSystemTime(new Date('2026-07-19T09:35:00.000Z'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm & save' }));
      await Promise.resolve();
    });

    const firstBody = JSON.parse(String(mockedRequest.mock.calls[0]?.[1]?.body)) as {
      idempotencyKey: string; approvedAt: string;
    };
    const retryBody = JSON.parse(String(mockedRequest.mock.calls[1]?.[1]?.body)) as {
      idempotencyKey: string; approvedAt: string;
    };
    expect(retryBody).toEqual(firstBody);
    expect(firstBody.approvedAt).toBe('2026-07-19T09:30:00.000Z');
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});
