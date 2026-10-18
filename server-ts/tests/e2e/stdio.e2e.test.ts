import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

import { SERVER_NAME, SERVER_VERSION } from '../../src/version.js';

const SERVER_DIR = new URL('../..', import.meta.url).pathname;

let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
});

describe('stdio server process (end to end)', () => {
  it('completes the MCP handshake, serves tools, keeps stdout clean and logs to stderr', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'src/bin.ts'],
      cwd: SERVER_DIR,
      env: { ...getDefaultEnvironment(), LOG_LEVEL: 'info' },
      stderr: 'pipe',
    });
    let stderrOutput = '';
    transport.stderr?.on('data', (chunk: Buffer) => {
      stderrOutput += chunk.toString('utf8');
    });

    client = new Client({ name: 'e2e-client', version: '1.2.3' });
    await client.connect(transport);

    expect(client.getServerVersion()).toMatchObject({ name: SERVER_NAME, version: SERVER_VERSION });

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain('check-health');

    const health = await client.callTool({ name: 'check-health', arguments: {} });
    expect(health.structuredContent).toMatchObject({
      status: 'ok',
      server: SERVER_NAME,
      client: { name: 'e2e-client', version: '1.2.3' },
    });

    const echo = await client.callTool({ name: 'echo-message', arguments: { message: 'hello over stdio' } });
    expect(echo.structuredContent).toEqual({ message: 'hello over stdio', length: 16 });

    await client.close();
    client = undefined;

    // Logs belong on stderr; the fact that the handshake above worked proves stdout was clean.
    expect(stderrOutput).toContain('voiceops MCP server ready');
  }, 30_000);
});
