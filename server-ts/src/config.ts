import { z } from 'zod';

import { actorIdSchema, workspaceIdSchema } from './domain/schemas.js';

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

// Local-development defaults. Production deployments must set these explicitly.
export const DEFAULT_DATABASE_URL = 'postgresql://localhost:5432/voiceops';
export const DEFAULT_WORKSPACE_ID = 'northside-warehouse';
export const DEFAULT_ACTOR_ID = 'manager-1';

const workspaceListSchema = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== ''),
  )
  .pipe(z.array(workspaceIdSchema).min(1).max(10));

const envSchema = z
  .object({
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
      .describe('The workspace used when a tool call does not name one.'),
    VOICEOPS_WORKSPACES: workspaceListSchema
      .optional()
      .describe('Comma-separated allow-list of workspaces tools may address. Defaults to just VOICEOPS_WORKSPACE.'),
    VOICEOPS_ACTOR_ID: actorIdSchema
      .default(DEFAULT_ACTOR_ID)
      .describe('Who changes made through this server are attributed to in the activity log.'),
  })
  .superRefine((env, context) => {
    if (env.VOICEOPS_WORKSPACES && !env.VOICEOPS_WORKSPACES.includes(env.VOICEOPS_WORKSPACE)) {
      context.addIssue({
        code: 'custom',
        path: ['VOICEOPS_WORKSPACE'],
        message: 'must be one of the workspaces listed in VOICEOPS_WORKSPACES',
      });
    }
  });

export interface Config {
  readonly logLevel: LogLevel;
  /** May contain credentials: never log it. */
  readonly databaseUrl: string;
  /** Used when a tool call does not name a workspace. Always one of `workspaceIds`. */
  readonly workspaceId: string;
  /** Every workspace tools may address; anything else is refused. */
  readonly workspaceIds: readonly string[];
  readonly actorId: string;
}

/** Parses process environment into typed config; throws a readable error when invalid. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // prettifyError reports field names and rules, never the offending values (DATABASE_URL may hold a password).
    throw new Error(`Invalid configuration: ${z.prettifyError(parsed.error)}`);
  }
  const { VOICEOPS_WORKSPACE: workspaceId, VOICEOPS_WORKSPACES: listed } = parsed.data;
  return {
    logLevel: parsed.data.LOG_LEVEL,
    databaseUrl: parsed.data.DATABASE_URL,
    workspaceId,
    workspaceIds: [...new Set(listed ?? [workspaceId])],
    actorId: parsed.data.VOICEOPS_ACTOR_ID,
  };
}
