import type { Pool } from 'pg';

import { errorMessage } from '../../errorMessage.js';
import { MIGRATIONS } from './migrations/index.js';

export interface Migration {
  readonly id: string;
  readonly sql: string;
}

// Arbitrary constant: serialises concurrent migrators (two processes starting at once).
const MIGRATION_LOCK_KEY = 727_274;

const CREATE_TRACKING_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id          text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
  )`;

async function appliedIds(pool: Pick<Pool, 'query'>): Promise<Set<string>> {
  const tracking = await pool.query<{ present: boolean }>(
    `SELECT to_regclass('schema_migrations') IS NOT NULL AS present`,
  );
  if (!tracking.rows.some((row) => row.present)) {
    return new Set();
  }
  const applied = await pool.query<{ id: string }>('SELECT id FROM schema_migrations');
  return new Set(applied.rows.map((row) => row.id));
}

/** IDs of migrations that have not been applied yet, in order. */
export async function pendingMigrations(
  pool: Pick<Pool, 'query'>,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<string[]> {
  const applied = await appliedIds(pool);
  return migrations.filter((migration) => !applied.has(migration.id)).map((migration) => migration.id);
}

/** Applies pending migrations, each in its own transaction. Returns the IDs it applied. */
export async function migrate(pool: Pool, migrations: readonly Migration[] = MIGRATIONS): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(CREATE_TRACKING_TABLE);
    const done = await appliedIds(client);
    for (const migration of migrations) {
      if (done.has(migration.id)) {
        continue;
      }
      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.id} failed: ${errorMessage(error)}`, { cause: error });
      }
      applied.push(migration.id);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    client.release();
  }
}

/** Fails fast, with the fix in the message, when the database schema is behind the code. */
export async function assertSchemaUpToDate(
  pool: Pick<Pool, 'query'>,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<void> {
  const pending = await pendingMigrations(pool, migrations);
  if (pending.length > 0) {
    throw new Error(
      `The database schema is out of date (pending: ${pending.join(', ')}). Run "npm run db:setup" in server-ts to apply migrations.`,
    );
  }
}
