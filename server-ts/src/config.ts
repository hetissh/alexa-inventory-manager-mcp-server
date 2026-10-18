import { z } from 'zod';

import { actorIdSchema, workspaceIdSchema } from './domain/schemas.js';

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

// Local-development defaults. Production deployments must set these explicitly.
export const DEFAULT_DATABASE_URL = 'postgresql://localhost:5432/voiceops';
export const DEFAULT_WORKSPACE_ID = 'northside-warehouse';
export const DEFAULT_ACTOR_ID = 'manager-1';

const envSchema = z.object({
  LOG_LEVEL: z
    .enum(LOG_LEVELS)
    .default('info')
    .describe('Minimum log level. Logs are written to stderr only.'),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// or postgresql:// URL')
    .default(DEFAULT_DATABASE_URL)
    .describe('PostgreSQL connection string. May contain credentials: never log it.'),
  VOICEOPS_WORKSPACE: workspaceIdSchema
    .default(DEFAULT_WORKSPACE_ID)
    .describe('The one workspace this server instance reads and writes.'),
  VOICEOPS_ACTOR_ID: actorIdSchema
    .default(DEFAULT_ACTOR_ID)
    .describe('Who changes made through this server are attributed to in the activity log.'),
});

export interface Config {
  readonly logLevel: LogLevel;
  /** May contain credentials: never log it. */
  readonly databaseUrl: string;
  readonly workspaceId: string;
  readonly actorId: string;
}

/** Parses process environment into typed config; throws a readable error when invalid. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // prettifyError reports field names and rules, never the offending values (DATABASE_URL may hold a password).
    throw new Error(`Invalid configuration: ${z.prettifyError(parsed.error)}`);
  }
  return {
    logLevel: parsed.data.LOG_LEVEL,
    databaseUrl: parsed.data.DATABASE_URL,
    workspaceId: parsed.data.VOICEOPS_WORKSPACE,
    actorId: parsed.data.VOICEOPS_ACTOR_ID,
  };
}
