import { z } from 'zod';

import { actorIdSchema, workspaceIdSchema } from './domain/schemas.js';
import { isLoopbackHost } from './loopback.js';

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
    VOICEOPS_SYNC_POLL_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(60_000)
      .default(1_000)
      .describe('How often the spreadsheet sync worker looks for work when idle, in milliseconds.'),
    VOICEOPS_DEMO_TOOLS: z
      .stringbool()
      .default(false)
      .describe('Register the demo-only reset-workspace tool (local databases only).'),
    VOICEOPS_BOARD_HOST: z
      .string()
      .min(1)
      .max(253)
      .default('127.0.0.1')
      .describe('Address the live-board web server listens on. The default is reachable from this computer only.'),
    VOICEOPS_BOARD_PORT: z.coerce
      .number()
      .int()
      .min(0)
      .max(65_535)
      .default(8_787)
      .describe('Port the live-board web server listens on (0 picks a free one).'),
    VOICEOPS_BOARD_TOKEN: z
      .string()
      .min(24)
      .max(200)
      .optional()
      .describe('Bearer token the board API requires. A secret: never log it. Required unless the host is loopback.'),
    VOICEOPS_BOARD_POLL_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(60_000)
      .default(3_000)
      .describe('How often a board page asks for updates, in milliseconds.'),
  })
  .superRefine((env, context) => {
    if (!isLoopbackHost(env.VOICEOPS_BOARD_HOST) && env.VOICEOPS_BOARD_TOKEN === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['VOICEOPS_BOARD_TOKEN'],
        message: 'is required when VOICEOPS_BOARD_HOST is not a loopback address (the board would be open to the network)',
      });
    }
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
  /** How often the sync worker polls for work when idle. */
  readonly syncPollMs: number;
  /** Whether the demo-only reset tool is registered. */
  readonly demoTools: boolean;
  /** The live-board web server. */
  readonly board: {
    readonly host: string;
    readonly port: number;
    /** A secret: never log it. Undefined means no token is required (only allowed on loopback). */
    readonly token: string | undefined;
    readonly pollMs: number;
  };
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
    syncPollMs: parsed.data.VOICEOPS_SYNC_POLL_MS,
    demoTools: parsed.data.VOICEOPS_DEMO_TOOLS,
    board: {
      host: parsed.data.VOICEOPS_BOARD_HOST,
      port: parsed.data.VOICEOPS_BOARD_PORT,
      token: parsed.data.VOICEOPS_BOARD_TOKEN,
      pollMs: parsed.data.VOICEOPS_BOARD_POLL_MS,
    },
  };
}
