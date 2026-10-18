import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { main, type MainDeps } from '../../src/main.js';
import { SERVER_NAME, SERVER_VERSION } from '../../src/version.js';
import { createTestPool, resetAll, TEST_DATABASE_URL, WORKSPACE_ID } from '../helpers/db.js';

class FakeProcess extends EventEmitter {
  readonly exit = vi.fn<(code: number) => void>();
  readonly version = 'v24.0.0-test';

  uptime(): number {
    return 7.2;
  }
}

interface Harness {
  readonly deps: MainDeps;
  readonly proc: FakeProcess;
  readonly stdin: PassThrough;
  readonly stdout: PassThrough;
  readonly logs: Record<string, unknown>[];
}

function createHarness(env: NodeJS.ProcessEnv = {}): Harness {
  const proc = new FakeProcess();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const logs: Record<string, unknown>[] = [];
  const deps: MainDeps = {
    env: { DATABASE_URL: TEST_DATABASE_URL, ...env },
    stdin,
    stdout,
    proc,
    logDestination: {
      write: (line: string) => {
        logs.push(JSON.parse(line) as Record<string, unknown>);
      },
    },
  };
  return { deps, proc, stdin, stdout, logs };
}

function nextMessage(stdout: PassThrough): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let buffer = '';
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline !== -1) {
        stdout.off('data', onData);
        resolve(JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>);
      }
    };
    stdout.on('data', onData);
  });
}

async function request(h: Harness, message: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = nextMessage(h.stdout);
  h.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  return response;
}

async function handshake(h: Harness): Promise<void> {
  await request(h, {
    id: 1,
    method: 'initialize',
    params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'stdio-test', version: '1.0.0' } },
  });
  h.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
}

beforeEach(async () => {
  const pool = createTestPool();
  try {
    await resetAll(pool);
  } finally {
    await pool.end();
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('main', () => {
  it('answers an MCP initialize request over the stdio streams and logs readiness', async () => {
    const h = createHarness();
    const running = await main(h.deps);

    const response = await request(h, {
      id: 1,
      method: 'initialize',
      params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'stdio-test', version: '1.0.0' } },
    });

    expect(response).toMatchObject({ id: 1, result: { serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } } });
    expect(h.logs).toContainEqual(
      expect.objectContaining({ msg: 'voiceops MCP server ready', transport: 'stdio', workspace: WORKSPACE_ID }),
    );
    await running.shutdown('test cleanup');
  });

  it('hands process facts and configuration through to the tools', async () => {
    const h = createHarness({ VOICEOPS_ACTOR_ID: 'staff-7' });
    const running = await main(h.deps);
    await handshake(h);

    const health = await request(h, { id: 2, method: 'tools/call', params: { name: 'check-health', arguments: {} } });
    expect(health).toMatchObject({
      result: {
        structuredContent: {
          status: 'ok',
          uptimeSeconds: 7,
          nodeVersion: 'v24.0.0-test',
          workspace: WORKSPACE_ID,
          database: 'ok',
          client: { name: 'stdio-test', version: '1.0.0' },
        },
      },
    });

    const change = await request(h, {
      id: 3,
      method: 'tools/call',
      params: { name: 'adjust-quantity', arguments: { resource: 'air filters', delta: 20 } },
    });
    expect(change).toMatchObject({ result: { structuredContent: { status: 'committed' } } });

    const pool = createTestPool();
    try {
      const events = await pool.query<{ actor: string; source: string; client_name: string }>(
        'SELECT actor, source, client_name FROM events',
      );
      expect(events.rows).toEqual([{ actor: 'staff-7', source: 'mcp', client_name: 'stdio-test' }]);
    } finally {
      await pool.end();
    }
    await running.shutdown('test cleanup');
  });

  it('rejects when the configuration is invalid', async () => {
    await expect(main(createHarness({ LOG_LEVEL: 'loud' }).deps)).rejects.toThrow(/Invalid configuration/);
  });

  it('rejects, with a clear message, when the database cannot be reached', async () => {
    const h = createHarness({ DATABASE_URL: 'postgresql://localhost:1/voiceops_test' });
    await expect(main(h.deps)).rejects.toThrow(/Cannot connect to the database at localhost:1\/voiceops_test/);
  });

  it('rejects when the configured workspace does not exist', async () => {
    const h = createHarness({ VOICEOPS_WORKSPACE: 'no-such-workspace' });
    await expect(main(h.deps)).rejects.toThrow(/Workspace "no-such-workspace" was not found/);
  });

  it.each(['SIGINT', 'SIGTERM'])('shuts down and exits 0 on %s', async (signal) => {
    const h = createHarness();
    await main(h.deps);

    h.proc.emit(signal);

    await vi.waitFor(() => {
      expect(h.proc.exit).toHaveBeenCalledExactlyOnceWith(0);
    });
    expect(h.logs).toContainEqual(expect.objectContaining({ msg: 'shutting down', reason: signal }));
    expect(h.proc.listenerCount('SIGINT')).toBe(0);
    expect(h.proc.listenerCount('SIGTERM')).toBe(0);
  });

  it('shuts down and exits 0 when the client closes stdin', async () => {
    const h = createHarness();
    await main(h.deps);

    h.stdin.end();

    await vi.waitFor(() => {
      expect(h.proc.exit).toHaveBeenCalledWith(0);
    });
    expect(h.logs).toContainEqual(expect.objectContaining({ msg: 'shutting down', reason: 'stdin closed' }));
  });

  it('shuts down and exits 0 when the transport closes', async () => {
    const h = createHarness();
    const running = await main(h.deps);

    await running.server.server.transport?.close();

    await vi.waitFor(() => {
      expect(h.proc.exit).toHaveBeenCalledWith(0);
    });
    expect(h.logs).toContainEqual(expect.objectContaining({ msg: 'shutting down', reason: 'transport closed' }));
  });

  it('is idempotent: concurrent shutdowns exit exactly once', async () => {
    const h = createHarness();
    const running = await main(h.deps);

    await Promise.all([running.shutdown('first'), running.shutdown('second')]);

    expect(h.proc.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('logs a failure to close the server, still closes the database, and still exits', async () => {
    vi.spyOn(McpServer.prototype, 'close').mockRejectedValueOnce(new Error('boom'));
    const h = createHarness();
    const running = await main(h.deps);

    await running.shutdown('test');

    expect(h.logs).toContainEqual(expect.objectContaining({ msg: 'error during shutdown' }));
    expect(h.proc.exit).toHaveBeenCalledExactlyOnceWith(0);
  });
});
