import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SERVER_NAME, SERVER_VERSION } from '../../src/version.js';
import { createTestPool, resetWarehouse, TEST_DATABASE_URL, WORKSPACE_ID } from '../helpers/db.js';

const SERVER_DIR = new URL('../..', import.meta.url).pathname;

let client: Client | undefined;

beforeEach(async () => {
  const pool = createTestPool();
  try {
    await resetWarehouse(pool);
  } finally {
    await pool.end();
  }
});

afterEach(async () => {
  await client?.close();
  client = undefined;
});

describe('stdio server process (end to end)', () => {
  it('serves the headline scenario over real stdio: add 20 air filters, 35 to 55, once', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'src/bin.ts'],
      cwd: SERVER_DIR,
      env: {
        ...getDefaultEnvironment(),
        LOG_LEVEL: 'info',
        DATABASE_URL: TEST_DATABASE_URL,
        VOICEOPS_WORKSPACE: WORKSPACE_ID,
        VOICEOPS_ACTOR_ID: 'e2e-manager',
      },
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
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'adjust-quantity',
      'check-health',
      'find-resources',
      'get-resource',
      'list-events',
    ]);

    const health = await client.callTool({ name: 'check-health', arguments: {} });
    expect(health.structuredContent).toMatchObject({
      status: 'ok',
      database: 'ok',
      workspace: WORKSPACE_ID,
      client: { name: 'e2e-client', version: '1.2.3' },
    });

    const args = { resource: 'air filters', delta: 20, idempotencyKey: 'e2e-add-20-filters' };
    const added = await client.callTool({ name: 'adjust-quantity', arguments: args });
    expect(added.structuredContent).toMatchObject({
      status: 'committed',
      replayed: false,
      spoken: 'Added 20. Air Filter is now at 55 pieces.',
      event: { before: { quantity: 35 }, after: { quantity: 55 }, actor: 'e2e-manager', clientName: 'e2e-client' },
    });

    const replayed = await client.callTool({ name: 'adjust-quantity', arguments: args });
    expect(replayed.structuredContent).toMatchObject({ status: 'committed', replayed: true });

    const events = await client.callTool({ name: 'list-events', arguments: {} });
    expect(events.structuredContent).toMatchObject({ status: 'ok', events: [{ resourceName: 'Air Filter' }] });
    expect((events.structuredContent as { events: unknown[] }).events).toHaveLength(1);

    await client.close();
    client = undefined;

    // Logs belong on stderr; the fact that every call above worked proves stdout carried only JSON-RPC.
    expect(stderrOutput).toContain('voiceops MCP server ready');
    expect(stderrOutput).toContain('command processed');
  }, 30_000);
});
