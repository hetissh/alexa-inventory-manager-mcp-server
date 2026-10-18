import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { main, type MainDeps } from '../../src/main.js';
import { SERVER_NAME, SERVER_VERSION } from '../../src/version.js';

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
    env,
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('main', () => {
  it('answers an MCP initialize request over the stdio streams and logs readiness', async () => {
    const { deps, stdin, stdout, logs } = createHarness();
    const running = await main(deps);

    const response = nextMessage(stdout);
    stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'stdio-test', version: '1.0.0' },
        },
      })}\n`,
    );

    expect(await response).toMatchObject({
      id: 1,
      result: { serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } },
    });
    expect(logs).toContainEqual(expect.objectContaining({ msg: 'voiceops MCP server ready', transport: 'stdio' }));

    // The process facts handed to main() (uptime, node version) must reach the tools.
    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const toolResponse = nextMessage(stdout);
    stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'check-health', arguments: {} },
      })}\n`,
    );
    expect(await toolResponse).toMatchObject({
      id: 2,
      result: { structuredContent: { status: 'ok', uptimeSeconds: 7, nodeVersion: 'v24.0.0-test' } },
    });

    await running.shutdown('test cleanup');
  });

  it('rejects when the configuration is invalid', async () => {
    const { deps } = createHarness({ LOG_LEVEL: 'loud' });
    await expect(main(deps)).rejects.toThrow(/Invalid configuration/);
  });

  it.each(['SIGINT', 'SIGTERM'])('shuts down and exits 0 on %s', async (signal) => {
    const { deps, proc, logs } = createHarness();
    await main(deps);

    proc.emit(signal);

    await vi.waitFor(() => {
      expect(proc.exit).toHaveBeenCalledExactlyOnceWith(0);
    });
    expect(logs).toContainEqual(expect.objectContaining({ msg: 'shutting down', reason: signal }));
    expect(proc.listenerCount('SIGINT')).toBe(0);
    expect(proc.listenerCount('SIGTERM')).toBe(0);
  });

  it('shuts down and exits 0 when the client closes stdin', async () => {
    const { deps, proc, stdin, logs } = createHarness();
    await main(deps);

    stdin.end();

    await vi.waitFor(() => {
      expect(proc.exit).toHaveBeenCalledWith(0);
    });
    expect(logs).toContainEqual(expect.objectContaining({ msg: 'shutting down', reason: 'stdin closed' }));
  });

  it('shuts down and exits 0 when the transport closes', async () => {
    const { deps, proc, logs } = createHarness();
    const running = await main(deps);

    await running.server.server.transport?.close();

    await vi.waitFor(() => {
      expect(proc.exit).toHaveBeenCalledWith(0);
    });
    expect(logs).toContainEqual(expect.objectContaining({ msg: 'shutting down', reason: 'transport closed' }));
  });

  it('is idempotent: concurrent shutdowns exit exactly once', async () => {
    const { deps, proc } = createHarness();
    const running = await main(deps);

    await Promise.all([running.shutdown('first'), running.shutdown('second')]);

    expect(proc.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('logs a failure to close the server and still exits', async () => {
    vi.spyOn(McpServer.prototype, 'close').mockRejectedValueOnce(new Error('boom'));
    const { deps, proc, logs } = createHarness();
    const running = await main(deps);

    await running.shutdown('test');

    expect(logs).toContainEqual(expect.objectContaining({ msg: 'error while closing server' }));
    expect(proc.exit).toHaveBeenCalledExactlyOnceWith(0);
  });
});
