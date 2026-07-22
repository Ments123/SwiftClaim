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

  it('separates communication preparation, dispatch, approval and restricted access', () => {
    expect(hasCapability(user('partner'), 'communications.approve')).toBe(true);
    expect(hasCapability(user('partner'), 'communications.manage_provider')).toBe(true);
    expect(hasCapability(user('solicitor'), 'communications.send')).toBe(true);
    expect(hasCapability(user('solicitor'), 'communications.read_privileged')).toBe(true);
    expect(hasCapability(user('solicitor'), 'communications.approve')).toBe(false);
    expect(hasCapability(user('paralegal'), 'communications.write')).toBe(true);
    expect(hasCapability(user('paralegal'), 'communications.send')).toBe(false);
    expect(hasCapability(user('paralegal'), 'communications.read_protected')).toBe(false);
    expect(hasCapability(user('finance'), 'communications.read')).toBe(false);
    expect(hasCapability(user('readonly'), 'communications.read')).toBe(true);
    expect(hasCapability(user('readonly'), 'communications.write')).toBe(false);
  });

  it('separates negotiation preparation, protected access, approval and waiver', () => {
    expect(hasCapability(user('partner'), 'negotiation.approve')).toBe(true);
    expect(hasCapability(user('partner'), 'settlement.waive_obligation')).toBe(true);
    expect(hasCapability(user('solicitor'), 'negotiation.record_instruction')).toBe(true);
    expect(hasCapability(user('solicitor'), 'negotiation.read_protected')).toBe(true);
    expect(hasCapability(user('solicitor'), 'settlement.conclude')).toBe(true);
    expect(hasCapability(user('solicitor'), 'negotiation.approve')).toBe(false);
    expect(hasCapability(user('paralegal'), 'negotiation.prepare')).toBe(true);
    expect(hasCapability(user('paralegal'), 'negotiation.approve')).toBe(false);
    expect(hasCapability(user('paralegal'), 'negotiation.read_protected')).toBe(false);
    expect(hasCapability(user('finance'), 'negotiation.read')).toBe(false);
    expect(hasCapability(user('readonly'), 'negotiation.read')).toBe(false);
  });

  it('separates proceedings preparation, issue approval and external court acts', () => {
    expect(hasCapability(user('partner'), 'proceedings.approve_issue')).toBe(true);
    expect(hasCapability(user('partner'), 'proceedings.record_relief')).toBe(true);
    expect(hasCapability(user('solicitor'), 'proceedings.record_external')).toBe(true);
    expect(hasCapability(user('solicitor'), 'proceedings.record_order')).toBe(true);
    expect(hasCapability(user('paralegal'), 'proceedings.prepare')).toBe(true);
    expect(hasCapability(user('paralegal'), 'proceedings.manage_directions')).toBe(true);
    expect(hasCapability(user('paralegal'), 'proceedings.approve_issue')).toBe(false);
    expect(hasCapability(user('paralegal'), 'proceedings.record_external')).toBe(false);
    expect(hasCapability(user('finance'), 'proceedings.read')).toBe(false);
    expect(hasCapability(user('readonly'), 'proceedings.read')).toBe(false);
  });

  it('separates pleading preparation, claimant approval and default review', () => {
    expect(hasCapability(user('partner'), 'pleadings.record_amendment_authority')).toBe(true);
    expect(hasCapability(user('solicitor'), 'pleadings.review_default')).toBe(true);
    expect(hasCapability(user('solicitor'), 'pleadings.approve_claimant_statement')).toBe(true);
    expect(hasCapability(user('paralegal'), 'pleadings.read')).toBe(true);
    expect(hasCapability(user('paralegal'), 'pleadings.prepare')).toBe(true);
    expect(hasCapability(user('paralegal'), 'pleadings.record_external')).toBe(true);
    expect(hasCapability(user('paralegal'), 'pleadings.review_default')).toBe(false);
    expect(hasCapability(user('finance'), 'pleadings.read')).toBe(false);
    expect(hasCapability(user('readonly'), 'pleadings.read')).toBe(false);
  });

  it('separates disclosure preparation, review and privilege waiver', () => {
    expect(hasCapability(user('partner'), 'disclosure.waive_privilege')).toBe(true);
    expect(hasCapability(user('solicitor'), 'disclosure.review')).toBe(true);
    expect(hasCapability(user('solicitor'), 'disclosure.review_privilege')).toBe(true);
    expect(hasCapability(user('solicitor'), 'disclosure.waive_privilege')).toBe(false);
    expect(hasCapability(user('paralegal'), 'disclosure.read')).toBe(true);
    expect(hasCapability(user('paralegal'), 'disclosure.prepare')).toBe(true);
    expect(hasCapability(user('paralegal'), 'disclosure.record_external')).toBe(true);
    expect(hasCapability(user('paralegal'), 'disclosure.review')).toBe(false);
    expect(hasCapability(user('finance'), 'disclosure.read')).toBe(false);
    expect(hasCapability(user('readonly'), 'disclosure.read')).toBe(false);
  });

  it('separates finance visibility, time approval and journal duties', () => {
    expect(hasCapability(user('finance'), 'finance.read_firm')).toBe(true);
    expect(hasCapability(user('finance'), 'finance.manage_disbursements')).toBe(true);
    expect(hasCapability(user('finance'), 'finance.prepare_journal')).toBe(true);
    expect(hasCapability(user('partner'), 'finance.approve_journal')).toBe(true);
    expect(hasCapability(user('partner'), 'finance.post_journal')).toBe(false);
    expect(hasCapability(user('solicitor'), 'finance.record_time')).toBe(true);
    expect(hasCapability(user('solicitor'), 'finance.approve_time')).toBe(true);
    expect(hasCapability(user('paralegal'), 'finance.record_time')).toBe(true);
    expect(hasCapability(user('paralegal'), 'finance.approve_time')).toBe(false);
    expect(hasCapability(user('readonly'), 'finance.read_matter')).toBe(false);
  });

  it('separates bill, client-money and reconciliation duties', () => {
    expect(hasCapability(user('solicitor'), 'finance.prepare_bill')).toBe(true);
    expect(hasCapability(user('solicitor'), 'finance.approve_bill')).toBe(false);
    expect(hasCapability(user('partner'), 'finance.approve_bill')).toBe(true);
    expect(hasCapability(user('partner'), 'finance.issue_bill')).toBe(false);
    expect(hasCapability(user('finance'), 'finance.issue_bill')).toBe(true);
    expect(hasCapability(user('finance'), 'finance.prepare_client_payment')).toBe(true);
    expect(hasCapability(user('finance'), 'finance.approve_client_payment')).toBe(true);
    expect(hasCapability(user('finance'), 'finance.prepare_reconciliation')).toBe(true);
    expect(hasCapability(user('partner'), 'finance.signoff_reconciliation')).toBe(true);
    expect(hasCapability(user('readonly'), 'finance.export_accounts')).toBe(false);
  });
});
