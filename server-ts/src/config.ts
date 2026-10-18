import { z } from 'zod';

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const envSchema = z.object({
  LOG_LEVEL: z
    .enum(LOG_LEVELS)
    .default('info')
    .describe('Minimum log level. Logs are written to stderr only.'),
});

export interface Config {
  readonly logLevel: LogLevel;
}

/** Parses process environment into typed config; throws a readable error when invalid. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${z.prettifyError(parsed.error)}`);
  }
  return { logLevel: parsed.data.LOG_LEVEL };
}
