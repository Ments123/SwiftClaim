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

  it('separates protocol preparation, approval and privileged conflict decisions', () => {
    expect(hasCapability(user('paralegal'), 'protocol.prepare')).toBe(true);
    expect(hasCapability(user('paralegal'), 'protocol.approve')).toBe(false);
    expect(hasCapability(user('solicitor'), 'protocol.prepare')).toBe(true);
    expect(hasCapability(user('solicitor'), 'protocol.approve')).toBe(true);
    expect(hasCapability(user('solicitor'), 'protocol.review_report')).toBe(true);
    expect(hasCapability(user('solicitor'), 'protocol.override_conflict')).toBe(false);
    expect(hasCapability(user('partner'), 'protocol.override_conflict')).toBe(true);
    expect(hasCapability(user('finance'), 'protocol.prepare')).toBe(false);
    expect(hasCapability(user('readonly'), 'protocol.review_report')).toBe(false);
  });

  it('separates quantum preparation, approval and protected negotiations', () => {
    expect(hasCapability(user('partner'), 'quantum.approve')).toBe(true);
    expect(hasCapability(user('partner'), 'offers.read_protected')).toBe(true);
    expect(hasCapability(user('solicitor'), 'quantum.write')).toBe(true);
    expect(hasCapability(user('solicitor'), 'offers.write')).toBe(true);
    expect(hasCapability(user('solicitor'), 'offers.record_outcome')).toBe(true);
    expect(hasCapability(user('solicitor'), 'offers.read_protected')).toBe(true);
    expect(hasCapability(user('paralegal'), 'quantum.write')).toBe(true);
    expect(hasCapability(user('paralegal'), 'quantum.approve')).toBe(false);
    expect(hasCapability(user('paralegal'), 'offers.read_protected')).toBe(false);
    expect(hasCapability(user('finance'), 'quantum.read')).toBe(false);
    expect(hasCapability(user('readonly'), 'offers.read_open')).toBe(false);
  });
});
