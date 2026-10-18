import { describe, expect, it } from 'vitest';

import { dropDatabase, ensureDatabase } from '../../src/infra/db/admin.js';
import { createTestPool, TEST_DATABASE_URL, urlForDatabase, withTempDatabase } from '../helpers/db.js';

async function databaseExists(url: string): Promise<boolean> {
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  const pool = createTestPool(urlForDatabase(TEST_DATABASE_URL, 'postgres'));
  try {
    const result = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    return result.rowCount === 1;
  } finally {
    await pool.end();
  }
}

describe('database admin', () => {
  it('creates a missing database once and then reports that it exists', async () => {
    await withTempDatabase(async (url) => {
      expect(await databaseExists(url)).toBe(false);
      expect(await ensureDatabase(url)).toBe('created');
      expect(await databaseExists(url)).toBe(true);
      expect(await ensureDatabase(url)).toBe('exists');
    });
  });

  it('drops a database, and does not mind if it is already gone', async () => {
    await withTempDatabase(async (url) => {
      await ensureDatabase(url);
      await dropDatabase(url);
      expect(await databaseExists(url)).toBe(false);
      await expect(dropDatabase(url)).resolves.toBeUndefined();
    });
  });

  it.each(['bad%20name', 'drop%3Btable', 'a-b'])('refuses the database name %s', async (name) => {
    const url = `postgresql://localhost:5432/${name}`;
    await expect(ensureDatabase(url)).rejects.toThrow(/database name must be/);
    await expect(dropDatabase(url)).rejects.toThrow(/database name must be/);
  });
});
