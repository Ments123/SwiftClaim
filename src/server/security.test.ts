import { describe, expect, it } from 'vitest';

import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from './security.js';

describe('security primitives', () => {
  it('verifies the right password and rejects a wrong password', () => {
    const encoded = hashPassword('SwiftClaim!2026');

    expect(encoded).toMatch(/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
    expect(verifyPassword('SwiftClaim!2026', encoded)).toBe(true);
    expect(verifyPassword('not-the-password', encoded)).toBe(false);
  });

  it('stores a one-way hash instead of the raw session token', () => {
    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash).not.toContain(token);
  });
});
