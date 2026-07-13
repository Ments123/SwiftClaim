import type { FirmRole } from '../shared/contracts.js';

export interface SessionUser {
  id: string;
  firmId: string;
  firmName: string;
  email: string;
  name: string;
  role: FirmRole;
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
