import type { Pool } from 'pg';

import { type CommandService, createCommandService } from './app/commandService.js';
import { createReadService, type ReadService } from './app/readService.js';
import type { Config } from './config.js';
import { errorMessage } from './errorMessage.js';
import { assertSchemaUpToDate } from './infra/db/migrator.js';
import { createPgStore } from './infra/db/pgStore.js';
import { createPool, describeDatabase } from './infra/db/pool.js';
import type { Logger } from './logger.js';

export interface Services {
  readonly pool: Pool;
  readonly commands: CommandService;
  readonly reads: ReadService;
  close(): Promise<void>;
}

/**
 * Connects to the database and builds the application services. Fails fast, with an actionable
 * message, if Postgres is unreachable, the schema is behind, or the configured workspace is missing.
 */
export async function createServices(config: Config, logger: Logger): Promise<Services> {
  const pool = createPool(config.databaseUrl, (error) => {
    logger.error({ err: error }, 'idle database client error');
  });
  try {
    const store = createPgStore(pool);
    try {
      await store.ping();
    } catch (error) {
      throw new Error(
        `Cannot connect to the database at ${describeDatabase(config.databaseUrl)}: ${errorMessage(error)}`,
        { cause: error },
      );
    }
    await assertSchemaUpToDate(pool);
    for (const workspaceId of config.workspaceIds) {
      if (!(await store.getWorkspace(workspaceId))) {
        throw new Error(
          `Workspace "${workspaceId}" was not found. Run "npm run db:setup" in server-ts to create the demo workspaces, or fix VOICEOPS_WORKSPACE / VOICEOPS_WORKSPACES.`,
        );
      }
    }
    return {
      pool,
      commands: createCommandService(store, logger),
      reads: createReadService(store, logger),
      close: () => pool.end(),
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
