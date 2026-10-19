import { type DestinationStream, type Logger, pino } from 'pino';

import type { LogLevel } from './config.js';
import { SERVER_NAME } from './version.js';

export type { Logger };

const REDACTED_KEYS = [
  'password',
  'token',
  'apiKey',
  'authorization',
  'secret',
  'databaseUrl',
  'connectionString',
  'boardToken',
];

/** Synchronous stderr destination: stdout is reserved for MCP JSON-RPC traffic. */
export function createStderrDestination(): DestinationStream {
  return pino.destination({ dest: 2, sync: true });
}

export function createLogger(level: LogLevel, destination: DestinationStream): Logger {
  return pino(
    {
      level,
      name: SERVER_NAME,
      redact: {
        paths: REDACTED_KEYS.flatMap((key) => [key, `*.${key}`]),
        censor: '[redacted]',
      },
    },
    destination,
  );
}
