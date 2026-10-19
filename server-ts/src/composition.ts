import type { Pool } from 'pg';

import { type CommandService, createCommandService } from './app/commandService.js';
import type { DemoAdmin, Store } from './app/ports.js';
import { createReadService, type ReadService } from './app/readService.js';
import type { SyncQueue } from './app/syncPorts.js';
import { createSyncService, type SyncService } from './app/syncService.js';
import type { Config } from './config.js';
import { errorMessage } from './errorMessage.js';
import { assertSchemaUpToDate } from './infra/db/migrator.js';
import { createPgStore } from './infra/db/pgStore.js';
import { createPgSyncQueue } from './infra/db/pgSyncQueue.js';
import { createPool, describeDatabase, isLocalDatabase } from './infra/db/pool.js';
import { seedWorkspace } from './infra/db/seed.js';
import type { Logger } from './logger.js';
import { listTemplates } from './templates/index.js';

export interface Connection {
  readonly pool: Pool;
  readonly store: Store;
  readonly close: () => Promise<void>;
}

/**
 * Connects to PostgreSQL and checks the schema is up to date. Fails fast, with an actionable message,
 * if the database is unreachable or behind.
 */
async function connect(config: Config, logger: Logger): Promise<Connection> {
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
    return { pool, store, close: () => pool.end() };
  } catch (error) {
    await pool.end();
    throw error;
  }
}

export interface Services {
  readonly pool: Pool;
  readonly commands: CommandService;
  readonly reads: ReadService;
  readonly sync: SyncService;
  /** Present only when demo tools are enabled (local databases only). */
  readonly demo: DemoAdmin | undefined;
  close(): Promise<void>;
}

/** Restores a demo workspace to its fixture. Used by the demo-only reset tool. */
function createDemoAdmin(pool: Pool): DemoAdmin {
  return {
    async resetWorkspace(workspaceId) {
      const template = listTemplates().find((candidate) => candidate.workspace.id === workspaceId);
      if (!template) {
        throw new Error(`Workspace "${workspaceId}" is not a demo workspace, so it cannot be reset.`);
      }
      await seedWorkspace(pool, template, { reset: true });
    },
  };
}

/**
 * Builds the services the MCP server uses. Also fails fast if a configured workspace is missing,
 * or if demo tools are switched on against a database that is not local.
 */
export async function createServices(config: Config, logger: Logger): Promise<Services> {
  if (config.demoTools && !isLocalDatabase(config.databaseUrl)) {
    throw new Error('VOICEOPS_DEMO_TOOLS can only be used with a local database: it can delete data.');
  }
  const connection = await connect(config, logger);
  const { pool, store } = connection;
  try {
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
      sync: createSyncService(store),
      demo: config.demoTools ? createDemoAdmin(pool) : undefined,
      close: () => connection.close(),
    };
  } catch (error) {
    await connection.close();
    throw error;
  }
}

export interface WorkerServices {
  readonly store: Store;
  readonly queue: SyncQueue;
  close(): Promise<void>;
}

/** Builds what the spreadsheet sync worker needs: the store and the job queue. */
export async function createWorkerServices(config: Config, logger: Logger): Promise<WorkerServices> {
  const connection = await connect(config, logger);
  return { store: connection.store, queue: createPgSyncQueue(connection.pool), close: () => connection.close() };
}
