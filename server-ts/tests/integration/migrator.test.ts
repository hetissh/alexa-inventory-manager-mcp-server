import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { ensureDatabase } from '../../src/infra/db/admin.js';
import { MIGRATIONS } from '../../src/infra/db/migrations/index.js';
import { assertSchemaUpToDate, migrate, pendingMigrations } from '../../src/infra/db/migrator.js';
import { createTestPool, withTempDatabase } from '../helpers/db.js';

async function withFreshDatabase<T>(work: (pool: Pool) => Promise<T>): Promise<T> {
  return withTempDatabase(async (url) => {
    await ensureDatabase(url);
    const pool = createTestPool(url);
    try {
      return await work(pool);
    } finally {
      await pool.end();
    }
  });
}

describe('migrator', () => {
  it('reports every migration as pending on an empty database, then applies them once', async () => {
    await withFreshDatabase(async (pool) => {
      const all = MIGRATIONS.map((migration) => migration.id);
      expect(await pendingMigrations(pool)).toEqual(all);

      expect(await migrate(pool)).toEqual(all);
      expect(await pendingMigrations(pool)).toEqual([]);
      expect(await migrate(pool)).toEqual([]);

      const tables = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        'alerts',
        'collections',
        'commands',
        'events',
        'resources',
        'schema_migrations',
        'sync_jobs',
        'workspaces',
      ]);
    });
  });

  it('serialises concurrent migrators so exactly one applies each migration', async () => {
    await withFreshDatabase(async (pool) => {
      const [first, second] = await Promise.all([migrate(pool), migrate(pool)]);
      expect([first, second].map((applied) => applied.length).sort()).toEqual([0, MIGRATIONS.length]);
    });
  });

  it('fails fast with the fix in the message when the schema is behind', async () => {
    await withFreshDatabase(async (pool) => {
      await expect(assertSchemaUpToDate(pool)).rejects.toThrow(/out of date \(pending: 0001_init, 0002_confirmations_alerts, 0003_collections\).*db:setup/);
      await migrate(pool);
      await expect(assertSchemaUpToDate(pool)).resolves.toBeUndefined();
    });
  });

  it('rolls back a failing migration completely and does not record it', async () => {
    await withFreshDatabase(async (pool) => {
      const broken = [{ id: '0001_broken', sql: 'CREATE TABLE half_done (id int); SELECT * FROM does_not_exist;' }];

      await expect(migrate(pool, broken)).rejects.toThrow(/Migration 0001_broken failed: .*does_not_exist/);

      const table = await pool.query<{ present: boolean }>(`SELECT to_regclass('half_done') IS NOT NULL AS present`);
      expect(table.rows[0]?.present).toBe(false);
      expect(await pendingMigrations(pool, broken)).toEqual(['0001_broken']);
    });
  });
});
