import { pino } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createServices } from '../../src/composition.js';
import type { Config } from '../../src/config.js';
import { ensureDatabase } from '../../src/infra/db/admin.js';
import { createTestPool, resetWarehouse, TEST_DATABASE_URL, withTempDatabase,WORKSPACE_ID } from '../helpers/db.js';

const config = (overrides: Partial<Config> = {}): Config => ({
  logLevel: 'silent',
  databaseUrl: TEST_DATABASE_URL,
  workspaceId: WORKSPACE_ID,
  actorId: 'manager-1',
  ...overrides,
});

beforeEach(async () => {
  const pool = createTestPool();
  try {
    await resetWarehouse(pool);
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
      createServices(config({ workspaceId: 'no-such-workspace' }), pino({ level: 'silent' })),
    ).rejects.toThrow(/Workspace "no-such-workspace" was not found.*db:setup/);
  });
});
