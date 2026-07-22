import type { DatabaseSync } from 'node:sqlite';

export class MatterReadOnlyError extends Error {
  constructor() {
    super('Closed and archived matters are read-only. Reopen the matter through the governed closure workflow before changing it.');
    this.name = 'MatterReadOnlyError';
  }
}

export function assertMatterMutable(database: DatabaseSync, firmId: string, matterId: string): void {
  const row = database.prepare('SELECT status FROM matters WHERE id=? AND firm_id=?').get(matterId, firmId) as
    | { status: string }
    | undefined;
  if (row && (row.status === 'closed' || row.status === 'archived')) throw new MatterReadOnlyError();
}
