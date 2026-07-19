import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MatterSectionRail } from './MatterSectionRail.js';

describe('MatterSectionRail', () => {
  it('shows finance users only the safe overview and finance workspace', () => {
    render(<MatterSectionRail
      activeSection="time_finance"
      onSelect={vi.fn()}
      financeOnly
    />);

    expect(screen.getByRole('button', { name: 'Overview' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Time & finance' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Documents' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disclosure' })).toBeNull();
  });
});
