import { describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase, SEED_IDS } from '../database.js';
import { assertMatterMutable, MatterReadOnlyError } from './mutation-guard.js';

describe('assertMatterMutable', () => {
  it('allows active matters and rejects closed or archived matters', () => {
    const database = createDatabase(':memory:');
    seedDatabase(database);
    expect(() => assertMatterMutable(database, SEED_IDS.northstarFirm, SEED_IDS.northstarMatter)).not.toThrow();
    database.prepare("UPDATE matters SET status='closed' WHERE id=?").run(SEED_IDS.northstarMatter);
    expect(() => assertMatterMutable(database, SEED_IDS.northstarFirm, SEED_IDS.northstarMatter)).toThrowError(MatterReadOnlyError);
    database.close();
  });
});
