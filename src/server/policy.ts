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
  ],
  finance: ['matter.read'],
  readonly: ['matter.read'],
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
