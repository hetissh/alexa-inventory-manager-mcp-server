import { Client } from 'pg';

const DATABASE_NAME = /^[A-Za-z0-9_]{1,63}$/;

/** Splits a connection string into the target database name and a URL for the server's maintenance database. */
function parseTarget(connectionString: string): { database: string; maintenanceUrl: string } {
  const url = new URL(connectionString);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!DATABASE_NAME.test(database)) {
    throw new Error('The database name must be 1-63 characters of A-Z a-z 0-9 _.');
  }
  url.pathname = '/postgres';
  return { database, maintenanceUrl: url.toString() };
}

/** Creates the database named in the connection string if it does not exist yet. */
export async function ensureDatabase(connectionString: string): Promise<'created' | 'exists'> {
  const { database, maintenanceUrl } = parseTarget(connectionString);
  const client = new Client({ connectionString: maintenanceUrl, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (existing.rowCount === 1) {
      return 'exists';
    }
    // The name is validated against DATABASE_NAME above, so quoting it here is safe.
    await client.query(`CREATE DATABASE "${database}"`);
    return 'created';
  } finally {
    await client.end();
  }
}

/** Drops a database if it exists. Intended for tests and local tooling only. */
export async function dropDatabase(connectionString: string): Promise<void> {
  const { database, maintenanceUrl } = parseTarget(connectionString);
  const client = new Client({ connectionString: maintenanceUrl, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}
