import { Pool } from 'pg';

/**
 * Creates the connection pool. `onError` receives errors from idle clients (for example when
 * Postgres restarts); without a listener Node would crash on them.
 */
export function createPool(connectionString: string, onError: (error: Error) => void): Pool {
  const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5_000 });
  pool.on('error', onError);
  return pool;
}

/** An `onError` handler for createPool that prints through `write`. */
export function poolErrorReporter(write: (line: string) => void): (error: Error) => void {
  return (error) => {
    write(`Database connection error: ${error.message}`);
  };
}

/** "host:port/database" with no credentials, safe to show in messages and logs. */
export function describeDatabase(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const host = url.hostname === '' ? 'local socket' : url.hostname;
    return `${host}:${url.port === '' ? '5432' : url.port}/${decodeURIComponent(url.pathname.slice(1))}`;
  } catch {
    return 'an unparseable connection string';
  }
}

/** True for localhost, loopback and Unix-socket connections. Used to stop destructive CLI commands from hitting remote databases. */
export function isLocalDatabase(connectionString: string): boolean {
  try {
    const host = new URL(connectionString).hostname;
    return host === '' || host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch {
    return false;
  }
}
