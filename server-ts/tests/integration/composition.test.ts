import { pino } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createServices, createWorkerServices } from '../../src/composition.js';
import type { Config } from '../../src/config.js';
import { ensureDatabase } from '../../src/infra/db/admin.js';
import {
  ALL_WORKSPACE_IDS,
  createTestPool,
  resetAll,
  TEST_DATABASE_URL,
  withTempDatabase,
  WORKSPACE_ID,
} from '../helpers/db.js';

const config = (overrides: Partial<Config> = {}): Config => ({
  logLevel: 'silent',
  databaseUrl: TEST_DATABASE_URL,
  workspaceId: WORKSPACE_ID,
  workspaceIds: [WORKSPACE_ID],
  actorId: 'manager-1',
  syncPollMs: 1000,
  demoTools: false,
  ...overrides,
});

beforeEach(async () => {
  const pool = createTestPool();
  try {
    await resetAll(pool);
  } finally {
    await pool.end();
  }
});

describe('createServices', () => {
  it('connects, verifies the setup and returns working services', async () => {
    const services = await createServices(config(), pino({ level: 'silent' }));
    try {
      expect(await services.reads.health()).toEqual({ database: 'ok' });
      const found = await services.reads.getResource(WORKSPACE_ID, 'air filters');
      expect(found.status).toBe('found');
    } finally {
      await services.close();
    }
  });

  it('logs errors from idle database clients instead of crashing', async () => {
    const logger = pino({ level: 'silent' });
    const errorLog = vi.spyOn(logger, 'error');
    const services = await createServices(config(), logger);
    try {
      services.pool.emit('error', new Error('connection terminated unexpectedly'));
      expect(errorLog).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) as Error }), 'idle database client error');
    } finally {
      await services.close();
    }
  });

  it('says where it could not connect, without leaking credentials', async () => {
    const attempt = createServices(
      config({ databaseUrl: 'postgresql://someone:s3cret-pw@localhost:1/voiceops_test' }),
      pino({ level: 'silent' }),
    );
    await expect(attempt).rejects.toThrow(/Cannot connect to the database at localhost:1\/voiceops_test/);
    await expect(attempt).rejects.not.toThrow(/s3cret-pw/);
  });

  it('refuses a database whose schema has not been migrated, and says how to fix it', async () => {
    await withTempDatabase(async (url) => {
      await ensureDatabase(url);
      await expect(createServices(config({ databaseUrl: url }), pino({ level: 'silent' }))).rejects.toThrow(
        /schema is out of date.*db:setup/,
      );
    });
  });

  it('refuses a workspace that does not exist, and says how to fix it', async () => {
    await expect(
      createServices(
        config({ workspaceId: 'no-such-workspace', workspaceIds: ['no-such-workspace'] }),
        pino({ level: 'silent' }),
      ),
    ).rejects.toThrow(/Workspace "no-such-workspace" was not found.*db:setup/);
  });

  it('checks every workspace on the allow-list, not just the default', async () => {
    await expect(
      createServices(config({ workspaceIds: [WORKSPACE_ID, 'no-such-workspace'] }), pino({ level: 'silent' })),
    ).rejects.toThrow(/Workspace "no-such-workspace" was not found/);
  });

  it('accepts an allow-list of several workspaces that all exist', async () => {
    const services = await createServices(config({ workspaceIds: ALL_WORKSPACE_IDS }), pino({ level: 'silent' }));
    await services.close();
  });
});

describe('demo tools', () => {
  it('are off by default', async () => {
    const services = await createServices(config(), pino({ level: 'silent' }));
    try {
      expect(services.demo).toBeUndefined();
    } finally {
      await services.close();
    }
  });

  it('can reset a demo workspace to its starting data when switched on', async () => {
    const services = await createServices(config({ demoTools: true }), pino({ level: 'silent' }));
    try {
      await services.pool.query(
        `UPDATE resources SET attributes = jsonb_set(attributes, '{quantity}', '1') WHERE workspace_id = $1 AND id = 'item_air_filter'`,
        [WORKSPACE_ID],
      );

      await services.demo?.resetWorkspace(WORKSPACE_ID);

      const found = await services.reads.getResource(WORKSPACE_ID, 'air filters');
      expect(found).toMatchObject({ status: 'found', resource: { attributes: { quantity: 35 } } });
      await expect(services.demo?.resetWorkspace('no-such-workspace')).rejects.toThrow(/not a demo workspace/);
    } finally {
      await services.close();
    }
  });

  it('refuse to run against a database that is not local, before even connecting', async () => {
    await expect(
      createServices(config({ demoTools: true, databaseUrl: 'postgresql://db.example.invalid:5432/voiceops' }), pino({ level: 'silent' })),
    ).rejects.toThrow(/only be used with a local database/);
  });
});

describe('createWorkerServices', () => {
  it('gives the sync worker a store and a job queue, and releases the database when closed', async () => {
    const services = await createWorkerServices(config(), pino({ level: 'silent' }));
    try {
      await expect(services.store.ping()).resolves.toBeUndefined();
      expect(await services.queue.peekDueWorkspace(new Date(), 60_000)).toBeUndefined();
    } finally {
      await services.close();
    }
  });

  it('says where it could not connect', async () => {
    await expect(
      createWorkerServices(config({ databaseUrl: 'postgresql://localhost:1/voiceops_test' }), pino({ level: 'silent' })),
    ).rejects.toThrow(/Cannot connect to the database at localhost:1\/voiceops_test/);
  });

  it('refuses a schema that is behind', async () => {
    await withTempDatabase(async (url) => {
      await ensureDatabase(url);
      await expect(createWorkerServices(config({ databaseUrl: url }), pino({ level: 'silent' }))).rejects.toThrow(
        /schema is out of date/,
      );
    });
  });
});
