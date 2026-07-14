import { describe, expect, it } from 'vitest';

import { SEED_IDS } from './database.js';
import { hasCapability, type SessionUser } from './policy.js';

function user(role: SessionUser['role']): SessionUser {
  return {
    id: SEED_IDS.ava,
    firmId: SEED_IDS.northstarFirm,
    firmName: 'Northstar Legal',
    email: `${role}@northstar.test`,
    name: role,
    role,
  };
}

describe('role capabilities', () => {
  it('keeps workflow override and transition authority explicit', () => {
    expect(hasCapability(user('partner'), 'workflow.override')).toBe(true);
    expect(hasCapability(user('solicitor'), 'workflow.transition')).toBe(true);
    expect(hasCapability(user('paralegal'), 'workflow.override')).toBe(false);
    expect(hasCapability(user('finance'), 'workflow.transition')).toBe(false);
  });

  it('keeps prospective-client intake access narrower than matter access', () => {
    expect(hasCapability(user('partner'), 'intake.read')).toBe(true);
    expect(hasCapability(user('partner'), 'intake.override_conflict')).toBe(true);
    expect(hasCapability(user('solicitor'), 'intake.write')).toBe(true);
    expect(hasCapability(user('solicitor'), 'intake.decide')).toBe(true);
    expect(hasCapability(user('solicitor'), 'intake.convert')).toBe(true);
    expect(hasCapability(user('solicitor'), 'intake.override_conflict')).toBe(false);
    expect(hasCapability(user('paralegal'), 'intake.write')).toBe(true);
    expect(hasCapability(user('paralegal'), 'intake.decide')).toBe(false);
    expect(hasCapability(user('finance'), 'intake.read')).toBe(false);
    expect(hasCapability(user('readonly'), 'intake.read')).toBe(false);
  });
});
