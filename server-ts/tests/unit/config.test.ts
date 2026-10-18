import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('uses local-development defaults', () => {
    expect(loadConfig({})).toEqual({
      logLevel: 'info',
      databaseUrl: 'postgresql://localhost:5432/voiceops',
      workspaceId: 'northside-warehouse',
      actorId: 'manager-1',
    });
  });

  it('reads every setting from the environment', () => {
    expect(
      loadConfig({
        LOG_LEVEL: 'debug',
        DATABASE_URL: 'postgres://user:pw@db.internal:5433/ops',
        VOICEOPS_WORKSPACE: 'cafe-demo',
        VOICEOPS_ACTOR_ID: 'staff@example.com',
      }),
    ).toEqual({
      logLevel: 'debug',
      databaseUrl: 'postgres://user:pw@db.internal:5433/ops',
      workspaceId: 'cafe-demo',
      actorId: 'staff@example.com',
    });
  });

  it.each([
    ['an invalid log level', { LOG_LEVEL: 'loud' }, /LOG_LEVEL/],
    ['a non-postgres URL', { DATABASE_URL: 'mysql://localhost/x' }, /DATABASE_URL/],
    ['an invalid workspace id', { VOICEOPS_WORKSPACE: 'Not A Slug' }, /VOICEOPS_WORKSPACE/],
    ['an invalid actor id', { VOICEOPS_ACTOR_ID: 'has space' }, /VOICEOPS_ACTOR_ID/],
  ])('throws a readable error for %s', (_label, env, field) => {
    expect(() => loadConfig(env)).toThrow(field);
    expect(() => loadConfig(env)).toThrow(/Invalid configuration/);
  });

  it('never echoes a connection string (which may hold a password) in its error', () => {
    const secret = 'hunter2-super-secret';
    const attempt = (): unknown => loadConfig({ DATABASE_URL: `mysql://admin:${secret}@db.internal/x` });
    expect(attempt).toThrow(/DATABASE_URL/);
    expect(attempt).not.toThrow(new RegExp(secret));
  });
});
