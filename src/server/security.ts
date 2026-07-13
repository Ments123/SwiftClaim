import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_PREFIX = 'scrypt';

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derivedKey = scryptSync(password, salt, PASSWORD_KEY_LENGTH);

  return `${PASSWORD_PREFIX}$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [prefix, saltHex, hashHex, extra] = encoded.split('$');

  if (
    prefix !== PASSWORD_PREFIX ||
    extra !== undefined ||
    !saltHex ||
    !hashHex ||
    !/^[a-f0-9]{32}$/.test(saltHex) ||
    !/^[a-f0-9]{128}$/.test(hashHex)
  ) {
    return false;
  }

  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(
    password,
    Buffer.from(saltHex, 'hex'),
    PASSWORD_KEY_LENGTH,
  );

  return timingSafeEqual(actual, expected);
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
