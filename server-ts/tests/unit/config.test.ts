import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('uses local-development defaults', () => {
    expect(loadConfig({})).toEqual({
      logLevel: 'info',
      databaseUrl: 'postgresql://localhost:5432/voiceops',
      workspaceId: 'northside-warehouse',
      workspaceIds: ['northside-warehouse'],
      actorId: 'manager-1',
      syncPollMs: 1000,
      demoTools: false,
    });
  });

  it('reads every setting from the environment', () => {
    expect(
      loadConfig({
        LOG_LEVEL: 'debug',
        DATABASE_URL: 'postgres://user:pw@db.internal:5433/ops',
        VOICEOPS_WORKSPACE: 'cafe-demo',
        VOICEOPS_ACTOR_ID: 'staff@example.com',
        VOICEOPS_SYNC_POLL_MS: '250',
        VOICEOPS_DEMO_TOOLS: 'true',
      }),
    ).toEqual({
      logLevel: 'debug',
      databaseUrl: 'postgres://user:pw@db.internal:5433/ops',
      workspaceId: 'cafe-demo',
      workspaceIds: ['cafe-demo'],
      actorId: 'staff@example.com',
      syncPollMs: 250,
      demoTools: true,
    });
  });

  it.each([
    ['1', true],
    ['true', true],
    ['false', false],
    ['0', false],
  ])('reads VOICEOPS_DEMO_TOOLS=%s as %s', (value, expected) => {
    expect(loadConfig({ VOICEOPS_DEMO_TOOLS: value }).demoTools).toBe(expected);
  });

  it('reads an allow-list of workspaces, trimming and de-duplicating it', () => {
    const config = loadConfig({
      VOICEOPS_WORKSPACE: 'harbor-cafe',
      VOICEOPS_WORKSPACES: ' northside-warehouse, harbor-cafe ,eastside-repairs,harbor-cafe,',
    });
    expect(config.workspaceId).toBe('harbor-cafe');
    expect(config.workspaceIds).toEqual(['northside-warehouse', 'harbor-cafe', 'eastside-repairs']);
  });

  it.each([
    ['a default that is not in the allow-list', { VOICEOPS_WORKSPACES: 'harbor-cafe,eastside-repairs' }, /must be one of the workspaces[\s\S]*VOICEOPS_WORKSPACE/],
    ['an invalid id in the list', { VOICEOPS_WORKSPACES: 'northside-warehouse,Not A Slug' }, /VOICEOPS_WORKSPACES/],
    ['an empty list', { VOICEOPS_WORKSPACES: ' , ' }, /VOICEOPS_WORKSPACES/],
    ['too many workspaces', { VOICEOPS_WORKSPACES: Array.from({ length: 11 }, (_, i) => `ws-${String(i)}x`).join(',') }, /VOICEOPS_WORKSPACES/],
  ])('rejects %s', (_label, env, message) => {
    expect(() => loadConfig(env)).toThrow(message);
  });

  it.each([
    ['an invalid log level', { LOG_LEVEL: 'loud' }, /LOG_LEVEL/],
    ['a non-postgres URL', { DATABASE_URL: 'mysql://localhost/x' }, /DATABASE_URL/],
    ['an invalid workspace id', { VOICEOPS_WORKSPACE: 'Not A Slug' }, /VOICEOPS_WORKSPACE/],
    ['an invalid actor id', { VOICEOPS_ACTOR_ID: 'has space' }, /VOICEOPS_ACTOR_ID/],
    ['a poll interval that is too short', { VOICEOPS_SYNC_POLL_MS: '10' }, /VOICEOPS_SYNC_POLL_MS/],
    ['a poll interval that is not a number', { VOICEOPS_SYNC_POLL_MS: 'soon' }, /VOICEOPS_SYNC_POLL_MS/],
    ['a demo flag that is not a boolean', { VOICEOPS_DEMO_TOOLS: 'maybe' }, /VOICEOPS_DEMO_TOOLS/],
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
