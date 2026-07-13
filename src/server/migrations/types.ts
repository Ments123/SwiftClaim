import { createHash } from 'node:crypto';

export interface Migration {
  version: number;
  name: string;
  checksum: string;
  sql: string;
}

export function migrationChecksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export function defineMigration(input: Omit<Migration, 'checksum'>): Migration {
  return { ...input, checksum: migrationChecksum(input.sql) };
}
