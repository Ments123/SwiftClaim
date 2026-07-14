import { createHash, randomUUID } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { rename } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface StoredFile {
  storageKey: string;
  sizeBytes: number;
  sha256: string;
}

export class UploadTooLargeError extends Error {
  constructor() {
    super('The uploaded file exceeds the 25 MiB limit.');
    this.name = 'UploadTooLargeError';
  }
}

function filePath(storagePath: string, storageKey: string): string {
  if (!/^[0-9a-f-]{36}$/.test(storageKey)) {
    throw new Error('Invalid storage key.');
  }
  return join(storagePath, `${storageKey}.blob`);
}

export async function storeUploadedFile(
  storagePath: string,
  input: Readable & { truncated?: boolean },
): Promise<StoredFile> {
  mkdirSync(storagePath, { recursive: true, mode: 0o700 });
  const storageKey = randomUUID();
  const destination = filePath(storagePath, storageKey);
  const temporary = join(storagePath, `.${storageKey}.upload`);
  const digest = createHash('sha256');
  let sizeBytes = 0;

  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sizeBytes += chunk.length;
      digest.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      input,
      meter,
      createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
    );
    if (input.truncated || sizeBytes > MAX_UPLOAD_BYTES) {
      throw new UploadTooLargeError();
    }
    await rename(temporary, destination);
    return {
      storageKey,
      sizeBytes,
      sha256: digest.digest('hex'),
    };
  } catch (error) {
    rmSync(temporary, { force: true });
    rmSync(destination, { force: true });
    throw error;
  }
}

export async function storeGeneratedFile(
  storagePath: string,
  bytes: Uint8Array,
): Promise<StoredFile> {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new UploadTooLargeError();
  mkdirSync(storagePath, { recursive: true, mode: 0o700 });
  const storageKey = randomUUID();
  const destination = filePath(storagePath, storageKey);
  const temporary = join(storagePath, `.${storageKey}.generated`);
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await rename(temporary, destination);
    return {
      storageKey,
      sizeBytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } catch (error) {
    rmSync(temporary, { force: true });
    rmSync(destination, { force: true });
    throw error;
  }
}

export function deleteStoredFile(storagePath: string, storageKey: string): void {
  rmSync(filePath(storagePath, storageKey), { force: true });
}

export function openStoredFile(storagePath: string, storageKey: string) {
  return createReadStream(filePath(storagePath, storageKey));
}
