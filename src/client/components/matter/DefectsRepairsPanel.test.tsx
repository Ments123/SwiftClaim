import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DefectsRepairsPanel } from './DefectsRepairsPanel.js';
import { evidenceWorkspace } from './evidence-test-fixture.js';

describe('DefectsRepairsPanel', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('groups the defect schedule and exposes simultaneous risks, notice and access history', () => {
    render(<DefectsRepairsPanel matterId="matter-1" workspace={evidenceWorkspace} onRefresh={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Defects & repairs' })).toBeVisible();
    expect(screen.getByText('2 active defects')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Main bedroom' })).toBeVisible();
    expect(screen.getByText('Damp and black mould')).toBeVisible();
    expect(screen.getByText('Window leak')).toBeVisible();
    expect(screen.getByText('Serious unresolved defect')).toBeVisible();
    expect(screen.getByText('Access did not complete')).toBeVisible();
    expect(screen.getByText('Meridian Housing Association')).toBeVisible();
    expect(screen.getAllByText('Contractor did not attend.')).toHaveLength(2);
  });

  it('submits a structured defect command and refreshes the shared workspace', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ defect: { id: 'new-defect' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    render(<DefectsRepairsPanel matterId="matter-1" workspace={evidenceWorkspace} onRefresh={onRefresh} />);

    await user.click(screen.getByRole('button', { name: 'Add defect' }));
    expect(screen.getByRole('dialog', { name: 'Record a defect' })).toBeVisible();
    await user.type(screen.getByLabelText('Location'), 'Bathroom');
    await user.selectOptions(screen.getByLabelText('Category'), 'leak');
    await user.type(screen.getByLabelText('Title'), 'Leak beneath bath');
    await user.type(screen.getByLabelText('Description'), 'Water is escaping beneath the bath and damaging the floor.');
    await user.selectOptions(screen.getByLabelText('Severity'), 'moderate');
    await user.click(screen.getByRole('button', { name: 'Record defect' }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/matters/matter-1/defects',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Leak beneath bath'),
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      location: 'Bathroom',
      category: 'leak',
      severity: 'moderate',
      firstObservedOn: null,
    });
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('removes mutation controls for a read-only workspace', () => {
    render(
      <DefectsRepairsPanel
        matterId="matter-1"
        workspace={{ ...evidenceWorkspace, permissions: { canWrite: false } }}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Add defect' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record notice' })).not.toBeInTheDocument();
  });
});
