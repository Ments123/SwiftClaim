import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildApp } from './app.js';
import {
  createDatabase,
  seedCommunicationsEvaluation,
  seedDatabase,
  seedProtocolExpertsEvaluation,
  seedRepairsQuantumEvaluation,
} from './database.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '4100', 10);
const environment = process.env.NODE_ENV ?? 'development';
const isProduction = environment === 'production';
const communicationProvider = process.env.COMMUNICATION_PROVIDER ?? 'evaluation';
const dataDirectory = resolve(process.env.DATA_DIR ?? './data');
const databasePath = resolve(
  process.env.DATABASE_PATH ?? `${dataDirectory}/swiftclaim.sqlite`,
);
const storagePath = resolve(
  process.env.STORAGE_PATH ?? `${dataDirectory}/uploads`,
);
const clientPath = resolve('./dist/client');

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}
if (communicationProvider !== 'evaluation') {
  throw new Error('COMMUNICATION_PROVIDER must be evaluation in this build.');
}

mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
mkdirSync(storagePath, { recursive: true, mode: 0o700 });

const database = createDatabase(databasePath);
const shouldSeed = process.env.SEED_DEMO_DATA
  ? process.env.SEED_DEMO_DATA === 'true'
  : !isProduction;
if (shouldSeed) {
  seedDatabase(database);
  await seedProtocolExpertsEvaluation(database, storagePath);
  seedRepairsQuantumEvaluation(database);
  await seedCommunicationsEvaluation(database);
}

const app = await buildApp({
  database,
  storagePath,
  staticPath: existsSync(clientPath) ? clientPath : undefined,
  isProduction,
  logger: {
    level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'warn'),
  },
});

let stopping = false;
const stop = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  app.log.info({ signal }, 'Stopping SwiftClaim');
  await app.close();
  database.close();
};

process.once('SIGINT', () => void stop('SIGINT'));
process.once('SIGTERM', () => void stop('SIGTERM'));

try {
  await app.listen({ host, port });
  app.log.info({ host, port, environment }, 'SwiftClaim Litigation is ready');
} catch (error) {
  app.log.error(error);
  database.close();
  process.exitCode = 1;
}
