import type { FirmRole } from '../shared/contracts.js';

export interface SessionUser {
  id: string;
  firmId: string;
  firmName: string;
  email: string;
  name: string;
  role: FirmRole;
}

export type Capability =
  | 'matter.read'
  | 'matter.write'
  | 'matter.create'
  | 'workflow.transition'
  | 'workflow.override'
  | 'deadline.confirm'
  | 'intake.read'
  | 'intake.write'
  | 'intake.decide'
  | 'intake.override_conflict'
  | 'intake.convert'
  | 'protocol.prepare'
  | 'protocol.approve'
  | 'protocol.override_conflict'
  | 'protocol.review_report'
  | 'quantum.read'
  | 'quantum.write'
  | 'quantum.approve'
  | 'offers.read_open'
  | 'offers.read_protected'
  | 'offers.write'
  | 'offers.record_outcome'
  | 'communications.read'
  | 'communications.write'
  | 'communications.approve'
  | 'communications.send'
  | 'communications.read_privileged'
  | 'communications.read_protected'
  | 'communications.manage_provider'
  | 'negotiation.read'
  | 'negotiation.read_protected'
  | 'negotiation.prepare'
  | 'negotiation.record_instruction'
  | 'negotiation.approve'
  | 'negotiation.record_external_action'
  | 'settlement.manage'
  | 'settlement.conclude'
  | 'settlement.waive_obligation'
  | 'proceedings.read'
  | 'proceedings.prepare'
  | 'proceedings.approve_issue'
  | 'proceedings.record_external'
  | 'proceedings.manage_directions'
  | 'proceedings.manage_hearings'
  | 'proceedings.record_order'
  | 'proceedings.record_relief'
  | 'pleadings.read'
  | 'pleadings.prepare'
  | 'pleadings.record_external'
  | 'pleadings.approve_claimant_statement'
  | 'pleadings.review_default'
  | 'pleadings.record_amendment_authority'
  | 'disclosure.read'
  | 'disclosure.prepare'
  | 'disclosure.review'
  | 'disclosure.review_privilege'
  | 'disclosure.waive_privilege'
  | 'disclosure.approve_redaction'
  | 'disclosure.generate_list'
  | 'disclosure.record_external'
  | 'finance.read_matter'
  | 'finance.read_firm'
  | 'finance.record_time'
  | 'finance.approve_time'
  | 'finance.manage_rates'
  | 'finance.manage_estimates'
  | 'finance.manage_disbursements'
  | 'finance.prepare_journal'
  | 'finance.approve_journal'
  | 'finance.post_journal'
  | 'administration.view';

const ROLE_CAPABILITIES: Record<FirmRole, readonly Capability[]> = {
  admin: [
    'matter.read',
    'matter.write',
    'matter.create',
    'workflow.transition',
    'workflow.override',
    'deadline.confirm',
    'intake.read',
    'intake.write',
    'intake.decide',
    'intake.override_conflict',
    'intake.convert',
    'protocol.prepare',
    'protocol.approve',
    'protocol.override_conflict',
    'protocol.review_report',
    'quantum.read',
    'quantum.write',
    'quantum.approve',
    'offers.read_open',
    'offers.read_protected',
    'offers.write',
    'offers.record_outcome',
    'communications.read',
    'communications.write',
    'communications.approve',
    'communications.send',
    'communications.read_privileged',
    'communications.read_protected',
    'communications.manage_provider',
    'negotiation.read',
    'negotiation.read_protected',
    'negotiation.prepare',
    'negotiation.record_instruction',
    'negotiation.approve',
    'negotiation.record_external_action',
    'settlement.manage',
    'settlement.conclude',
    'settlement.waive_obligation',
    'proceedings.read',
    'proceedings.prepare',
    'proceedings.approve_issue',
    'proceedings.record_external',
    'proceedings.manage_directions',
    'proceedings.manage_hearings',
    'proceedings.record_order',
    'proceedings.record_relief',
    'pleadings.read',
    'pleadings.prepare',
    'pleadings.record_external',
    'pleadings.approve_claimant_statement',
    'pleadings.review_default',
    'pleadings.record_amendment_authority',
    'disclosure.read', 'disclosure.prepare', 'disclosure.review',
    'disclosure.review_privilege', 'disclosure.waive_privilege',
    'disclosure.approve_redaction', 'disclosure.generate_list',
    'disclosure.record_external',
    'finance.read_matter', 'finance.read_firm', 'finance.record_time',
    'finance.approve_time', 'finance.manage_rates', 'finance.manage_estimates',
    'finance.manage_disbursements', 'finance.prepare_journal',
    'finance.approve_journal', 'finance.post_journal',
    'administration.view',
  ],
  partner: [
    'matter.read',
    'matter.write',
    'matter.create',
    'workflow.transition',
    'workflow.override',
    'deadline.confirm',
    'intake.read',
    'intake.write',
    'intake.decide',
    'intake.override_conflict',
    'intake.convert',
    'protocol.prepare',
    'protocol.approve',
    'protocol.override_conflict',
    'protocol.review_report',
    'quantum.read',
    'quantum.write',
    'quantum.approve',
    'offers.read_open',
    'offers.read_protected',
    'offers.write',
    'offers.record_outcome',
    'communications.read',
    'communications.write',
    'communications.approve',
    'communications.send',
    'communications.read_privileged',
    'communications.read_protected',
    'communications.manage_provider',
    'negotiation.read',
    'negotiation.read_protected',
    'negotiation.prepare',
    'negotiation.record_instruction',
    'negotiation.approve',
    'negotiation.record_external_action',
    'settlement.manage',
    'settlement.conclude',
    'settlement.waive_obligation',
    'proceedings.read',
    'proceedings.prepare',
    'proceedings.approve_issue',
    'proceedings.record_external',
    'proceedings.manage_directions',
    'proceedings.manage_hearings',
    'proceedings.record_order',
    'proceedings.record_relief',
    'pleadings.read',
    'pleadings.prepare',
    'pleadings.record_external',
    'pleadings.approve_claimant_statement',
    'pleadings.review_default',
    'pleadings.record_amendment_authority',
    'disclosure.read', 'disclosure.prepare', 'disclosure.review',
    'disclosure.review_privilege', 'disclosure.waive_privilege',
    'disclosure.approve_redaction', 'disclosure.generate_list',
    'disclosure.record_external',
    'finance.read_matter', 'finance.read_firm', 'finance.record_time',
    'finance.approve_time', 'finance.manage_rates', 'finance.manage_estimates',
    'finance.manage_disbursements', 'finance.prepare_journal', 'finance.approve_journal',
    'administration.view',
  ],
  solicitor: [
    'matter.read',
    'matter.write',
    'workflow.transition',
    'deadline.confirm',
    'intake.read',
    'intake.write',
    'intake.decide',
    'intake.convert',
    'protocol.prepare',
    'protocol.approve',
    'protocol.review_report',
    'quantum.read',
    'quantum.write',
    'offers.read_open',
    'offers.read_protected',
    'offers.write',
    'offers.record_outcome',
    'communications.read',
    'communications.write',
    'communications.send',
    'communications.read_privileged',
    'communications.read_protected',
    'negotiation.read',
    'negotiation.read_protected',
    'negotiation.prepare',
    'negotiation.record_instruction',
    'negotiation.record_external_action',
    'settlement.manage',
    'settlement.conclude',
    'proceedings.read',
    'proceedings.prepare',
    'proceedings.record_external',
    'proceedings.manage_directions',
    'proceedings.manage_hearings',
    'proceedings.record_order',
    'proceedings.record_relief',
    'pleadings.read',
    'pleadings.prepare',
    'pleadings.record_external',
    'pleadings.approve_claimant_statement',
    'pleadings.review_default',
    'pleadings.record_amendment_authority',
    'disclosure.read', 'disclosure.prepare', 'disclosure.review',
    'disclosure.review_privilege', 'disclosure.approve_redaction',
    'disclosure.generate_list', 'disclosure.record_external',
    'finance.read_matter', 'finance.record_time', 'finance.approve_time',
    'finance.manage_estimates',
  ],
  paralegal: [
    'matter.read',
    'matter.write',
    'workflow.transition',
    'deadline.confirm',
    'intake.read',
    'intake.write',
    'protocol.prepare',
    'quantum.read',
    'quantum.write',
    'offers.read_open',
    'offers.write',
    'communications.read',
    'communications.write',
    'negotiation.read',
    'negotiation.prepare',
    'proceedings.read',
    'proceedings.prepare',
    'proceedings.manage_directions',
    'proceedings.manage_hearings',
    'pleadings.read',
    'pleadings.prepare',
    'pleadings.record_external',
    'disclosure.read', 'disclosure.prepare', 'disclosure.record_external',
    'finance.read_matter', 'finance.record_time',
  ],
  finance: [
    'matter.read', 'finance.read_matter', 'finance.read_firm',
    'finance.manage_rates', 'finance.manage_estimates', 'finance.manage_disbursements',
    'finance.prepare_journal', 'finance.approve_journal', 'finance.post_journal',
  ],
  readonly: ['matter.read', 'communications.read'],
};

export function hasCapability(
  user: SessionUser,
  capability: Capability,
): boolean {
  return ROLE_CAPABILITIES[user.role].includes(capability);
}

const firmWideReadRoles = new Set<FirmRole>([
  'admin',
  'partner',
  'finance',
  'readonly',
]);

const firmWideWriteRoles = new Set<FirmRole>(['admin', 'partner']);

export function canReadAllFirmMatters(user: SessionUser): boolean {
  return firmWideReadRoles.has(user.role);
}

export function canWriteAllFirmMatters(user: SessionUser): boolean {
  return firmWideWriteRoles.has(user.role);
}

export function canCreateMatter(user: SessionUser): boolean {
  return firmWideWriteRoles.has(user.role);
}

export function canWorkAssignedMatters(user: SessionUser): boolean {
  return user.role === 'solicitor' || user.role === 'paralegal';
}
