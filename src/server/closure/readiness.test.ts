import { describe, expect, it } from 'vitest';

import { classifyClosureReadiness } from './readiness.js';
import type { ClosureBlocker } from './types.js';

const residual: ClosureBlocker = {
  key: 'task:1',
  category: 'task',
  label: 'Send archived papers to the client',
  severity: 'residual',
  transferable: true,
  sourceId: '1',
};

describe('classifyClosureReadiness', () => {
  it('never permits critical obligations to be transferred', () => {
    const result = classifyClosureReadiness({
      blockers: [{ ...residual, key: 'money:1', category: 'client_money', severity: 'critical', transferable: false }],
      transfers: [{ blockerKey: 'money:1', ownerUserId: crypto.randomUUID(), dueOn: '2026-08-01', reason: 'Monitor after closure.' }],
      asOfDate: '2026-07-22',
    });
    expect(result.closable).toBe(false);
    expect(result.unresolved.map(({ key }) => key)).toEqual(['money:1']);
  });

  it('requires complete ownership, date and reason for every residual transfer', () => {
    const result = classifyClosureReadiness({
      blockers: [residual],
      transfers: [{ blockerKey: residual.key, ownerUserId: '', dueOn: '2026-08-01', reason: 'short' }],
      asOfDate: '2026-07-22',
    });
    expect(result.closable).toBe(false);
    expect(result.invalidTransfers).toEqual([residual.key]);
  });

  it('accepts a clear review and a fully controlled residual obligation', () => {
    expect(classifyClosureReadiness({ blockers: [], transfers: [], asOfDate: '2026-07-22' }).closable).toBe(true);
    const controlled = classifyClosureReadiness({
      blockers: [residual],
      transfers: [{ blockerKey: residual.key, ownerUserId: crypto.randomUUID(), dueOn: '2026-08-01', reason: 'The client requested postal return after closure.' }],
      asOfDate: '2026-07-22',
    });
    expect(controlled).toMatchObject({ closable: true, unresolved: [], invalidTransfers: [] });
  });

  it('rejects invented and duplicate transfer keys', () => {
    const transfer = { blockerKey: residual.key, ownerUserId: crypto.randomUUID(), dueOn: '2026-08-01', reason: 'The named owner will return the papers after closure.' };
    expect(classifyClosureReadiness({ blockers: [residual], transfers: [transfer, transfer], asOfDate: '2026-07-22' }).closable).toBe(false);
    expect(classifyClosureReadiness({ blockers: [], transfers: [{ ...transfer, blockerKey: 'invented:1' }], asOfDate: '2026-07-22' }).closable).toBe(false);
  });

  it('rejects a transferred obligation that is already due', () => {
    const result = classifyClosureReadiness({
      blockers: [residual], asOfDate: '2026-07-22',
      transfers: [{ blockerKey: residual.key, ownerUserId: crypto.randomUUID(), dueOn: '2026-07-21', reason: 'The named owner will return the papers after closure.' }],
    });
    expect(result).toMatchObject({ closable: false, invalidTransfers: [residual.key] });
  });
});
