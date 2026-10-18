import { describe, expect, it, vi } from 'vitest';

import { errorMessage } from '../../src/errorMessage.js';
import { createPool, describeDatabase, isLocalDatabase, poolErrorReporter } from '../../src/infra/db/pool.js';

describe('describeDatabase', () => {
  it('shows host, port and database without credentials', () => {
    const described = describeDatabase('postgresql://admin:hunter2@db.internal:6543/ops');
    expect(described).toBe('db.internal:6543/ops');
    expect(described).not.toContain('hunter2');
    expect(described).not.toContain('admin');
  });

  it('defaults the port and handles Unix-socket style URLs', () => {
    expect(describeDatabase('postgresql://localhost/voiceops')).toBe('localhost:5432/voiceops');
    expect(describeDatabase('postgresql:///voiceops')).toBe('local socket:5432/voiceops');
  });

  it('copes with an unparseable string', () => {
    expect(describeDatabase('not a url')).toBe('an unparseable connection string');
  });
});

describe('isLocalDatabase', () => {
  it.each(['postgresql://localhost/x', 'postgresql://127.0.0.1:5432/x', 'postgresql://[::1]/x', 'postgresql:///x'])(
    '%s is local',
    (url) => {
      expect(isLocalDatabase(url)).toBe(true);
    },
  );

  it.each(['postgresql://db.example.com/x', 'postgresql://10.0.0.5/x', 'garbage'])('%s is not local', (url) => {
    expect(isLocalDatabase(url)).toBe(false);
  });
});

describe('createPool', () => {
  it('routes idle-client errors to the supplied handler instead of crashing', async () => {
    const onError = vi.fn<(error: Error) => void>();
    const pool = createPool('postgresql://localhost:5432/never_connected', onError);
    const failure = new Error('connection terminated');
    pool.emit('error', failure);
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    await pool.end();
  });
});

describe('poolErrorReporter', () => {
  it('prints idle-client errors through the supplied writer', () => {
    const write = vi.fn<(line: string) => void>();
    poolErrorReporter(write)(new Error('terminated'));
    expect(write).toHaveBeenCalledExactlyOnceWith('Database connection error: terminated');
  });
});

describe('errorMessage', () => {
  it('uses the message of an Error and stringifies anything else', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(42)).toBe('42');
  });
});
