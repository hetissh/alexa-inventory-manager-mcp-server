import { ensureDatabase } from '../src/infra/db/admin.js';
import { migrate } from '../src/infra/db/migrator.js';
import { describeDatabase } from '../src/infra/db/pool.js';
import { createTestPool, TEST_DATABASE_URL } from './helpers/db.js';

/** Makes sure the PostgreSQL test database exists and is migrated before any test runs. */
export default async function setup(): Promise<void> {
  // Tests wipe workspace data, so refuse anything that doesn't look like a test database.
  if (!/test/i.test(new URL(TEST_DATABASE_URL).pathname)) {
    throw new Error('TEST_DATABASE_URL must point at a database whose name contains "test": the tests delete data.');
  }
  try {
    await ensureDatabase(TEST_DATABASE_URL);
  } catch (error) {
    throw new Error(
      `Cannot reach PostgreSQL for the tests (${describeDatabase(TEST_DATABASE_URL)}). Start it (for example "brew services start postgresql@14") or set TEST_DATABASE_URL.`,
      { cause: error },
    );
  }
  const pool = createTestPool();
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
