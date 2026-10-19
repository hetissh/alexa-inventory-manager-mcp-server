import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { type BoardDeps,startBoardServer } from '../../src/http/main.js';
import { ensureDatabase } from '../../src/infra/db/admin.js';
import { ALL_WORKSPACE_IDS, TEST_DATABASE_URL, withTempDatabase,WORKSPACE_ID } from '../helpers/db.js';
import { httpRequest, jsonBody } from '../helpers/http.js';
import { useCommandHarness } from '../helpers/service.js';

const harness = useCommandHarness();
const TOKEN = 'a-long-enough-board-token-1234';

function setup(env: NodeJS.ProcessEnv = {}): { deps: BoardDeps; proc: EventEmitter; logs: Record<string, unknown>[] } {
  const proc = new EventEmitter();
  const logs: Record<string, unknown>[] = [];
  return {
    proc,
    logs,
    deps: {
      env: {
        DATABASE_URL: TEST_DATABASE_URL,
        VOICEOPS_WORKSPACES: ALL_WORKSPACE_IDS.join(','),
        VOICEOPS_BOARD_PORT: '0',
        ...env,
      },
      logDestination: { write: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>) },
      proc,
    },
  };
}

describe('the board server process', () => {
  it('serves the live board, and stops cleanly on SIGTERM', async () => {
    harness();
    const { deps, proc, logs } = setup();

    const board = await startBoardServer(deps);
    const reply = await httpRequest(board.port, `/workspaces/${WORKSPACE_ID}/board`);
    proc.emit('SIGTERM');
    await board.finished;

    expect(board.port).toBeGreaterThan(0);
    expect(reply.status).toBe(200);
    expect(jsonBody(reply)).toMatchObject({ workspaceId: WORKSPACE_ID });
    expect(logs).toContainEqual(
      expect.objectContaining({ msg: 'voiceops board server ready', host: '127.0.0.1', port: board.port, authRequired: false }),
    );
    expect(logs).toContainEqual(expect.objectContaining({ msg: 'stopping the board server', reason: 'SIGTERM' }));
    expect(proc.listenerCount('SIGINT')).toBe(0);
    expect(proc.listenerCount('SIGTERM')).toBe(0);
    await expect(httpRequest(board.port, '/health')).rejects.toThrow(/ECONNREFUSED/);
  });

  it('only answers to loopback names when it listens on loopback, and says so in its log', async () => {
    harness();
    const { deps, proc } = setup();
    const board = await startBoardServer(deps);

    const refused = await httpRequest(board.port, '/health', { headers: { Host: 'evil.example.com' } });
    const allowed = await httpRequest(board.port, '/health', { headers: { Host: `localhost:${String(board.port)}` } });
    proc.emit('SIGINT');
    await board.finished;

    expect(refused.status).toBe(403);
    expect(allowed.status).toBe(200);
  });

  it('requires the token when one is configured, and never logs it', async () => {
    harness();
    const { deps, proc, logs } = setup({ VOICEOPS_BOARD_TOKEN: TOKEN });
    const board = await startBoardServer(deps);

    const without = await httpRequest(board.port, `/workspaces/${WORKSPACE_ID}/board`);
    const withToken = await httpRequest(board.port, `/workspaces/${WORKSPACE_ID}/board`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    proc.emit('SIGTERM');
    await board.finished;

    expect(without.status).toBe(401);
    expect(withToken.status).toBe(200);
    expect(logs).toContainEqual(expect.objectContaining({ msg: 'voiceops board server ready', authRequired: true }));
    expect(JSON.stringify(logs)).not.toContain(TOKEN);
  });

  it('only serves the workspaces on the allow-list', async () => {
    harness();
    const { deps, proc } = setup({ VOICEOPS_WORKSPACES: WORKSPACE_ID });
    const board = await startBoardServer(deps);

    const other = await httpRequest(board.port, '/workspaces/harbor-cafe/board');
    const root = await httpRequest(board.port, '/');
    proc.emit('SIGTERM');
    await board.finished;

    expect(other.status).toBe(404);
    expect(root.headers['location']).toBe(`/board/${WORKSPACE_ID}`);
  });

  it('can be asked to stop more than once, and says so once', async () => {
    harness();
    const { deps, logs } = setup();
    const board = await startBoardServer(deps);

    board.stop('first');
    board.stop('second');
    await board.finished;

    expect(logs.filter((line) => line['msg'] === 'stopping the board server')).toEqual([expect.objectContaining({ reason: 'first' })]);
  });

  it('refuses to start when the port is taken', async () => {
    harness();
    const first = setup();
    const running = await startBoardServer(first.deps);

    await expect(startBoardServer(setup({ VOICEOPS_BOARD_PORT: String(running.port) }).deps)).rejects.toThrow(/EADDRINUSE/);

    running.stop('test over');
    await running.finished;
  });

  it('refuses an invalid configuration', async () => {
    await expect(startBoardServer(setup({ VOICEOPS_BOARD_PORT: 'http' }).deps)).rejects.toThrow(/Invalid configuration[\s\S]*VOICEOPS_BOARD_PORT/);
  });

  it('refuses to be open to the network without a token', async () => {
    await expect(startBoardServer(setup({ VOICEOPS_BOARD_HOST: '0.0.0.0' }).deps)).rejects.toThrow(/VOICEOPS_BOARD_TOKEN/);
  });

  it('says where it could not connect', async () => {
    await expect(startBoardServer(setup({ DATABASE_URL: 'postgresql://localhost:1/voiceops_test' }).deps)).rejects.toThrow(
      /Cannot connect to the database at localhost:1\/voiceops_test/,
    );
  });

  it('refuses a database whose schema is behind, and says how to fix it', async () => {
    await withTempDatabase(async (url) => {
      await ensureDatabase(url);
      await expect(startBoardServer(setup({ DATABASE_URL: url }).deps)).rejects.toThrow(/schema is out of date.*db:setup/);
    });
  });
});
