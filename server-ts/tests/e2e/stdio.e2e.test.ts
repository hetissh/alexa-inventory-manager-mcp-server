import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SERVER_NAME, SERVER_VERSION } from '../../src/version.js';
import {
  ALL_WORKSPACE_IDS,
  createTestPool,
  REPAIR_ID,
  resetAll,
  TEST_DATABASE_URL,
  WORKSPACE_ID,
} from '../helpers/db.js';

const SERVER_DIR = new URL('../..', import.meta.url).pathname;

let client: Client | undefined;

beforeEach(async () => {
  const pool = createTestPool();
  try {
    await resetAll(pool);
  } finally {
    await pool.end();
  }
});

afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function call(connected: Client, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const result = CallToolResultSchema.parse(await connected.callTool({ name, arguments: args }));
  return result.structuredContent ?? {};
}

function tokenFrom(data: Record<string, unknown>): string {
  const confirmation = data['confirmation'];
  if (typeof confirmation === 'object' && confirmation !== null && 'token' in confirmation && typeof confirmation.token === 'string') {
    return confirmation.token;
  }
  throw new Error('no confirmation token in the result');
}

describe('stdio server process (end to end)', () => {
  it('serves the demo scenarios over real stdio: stock, approval, assignment, alerts and undo', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'src/bin.ts'],
      cwd: SERVER_DIR,
      env: {
        ...getDefaultEnvironment(),
        LOG_LEVEL: 'info',
        DATABASE_URL: TEST_DATABASE_URL,
        VOICEOPS_WORKSPACE: WORKSPACE_ID,
        VOICEOPS_WORKSPACES: ALL_WORKSPACE_IDS.join(','),
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
      'assign-job',
      'cancel-command',
      'check-health',
      'confirm-command',
      'find-resources',
      'get-board',
      'get-resource',
      'get-workspace',
      'list-alerts',
      'list-events',
      'set-status',
      'undo-last-change',
    ]);

    expect(await call(client, 'check-health')).toMatchObject({
      status: 'ok',
      database: 'ok',
      workspace: WORKSPACE_ID,
      workspaces: ALL_WORKSPACE_IDS,
      client: { name: 'e2e-client', version: '1.2.3' },
    });

    // 1. "Add twenty air filters": applied at once, and a retry with the same key does not apply it twice.
    const args = { resource: 'air filters', delta: 20, idempotencyKey: 'e2e-add-20-filters' };
    expect(await call(client, 'adjust-quantity', args)).toMatchObject({
      status: 'committed',
      replayed: false,
      spoken: 'Added 20. Air Filter is now at 55 pieces.',
      event: { before: { quantity: 35 }, after: { quantity: 55 }, actor: 'e2e-manager', clientName: 'e2e-client' },
    });
    expect(await call(client, 'adjust-quantity', args)).toMatchObject({ status: 'committed', replayed: true });

    // 2. "Remove ten brake pads": drops below the reorder level and raises an alert.
    const removed = await call(client, 'adjust-quantity', { resource: 'brake pads', delta: -10 });
    expect(removed).toMatchObject({ status: 'committed', alerts: { opened: [{ resourceId: 'item_brake_pads' }] } });
    expect(await call(client, 'get-board')).toMatchObject({ metrics: [{ label: 'Low stock', value: 1 }, { label: 'Equipment down', value: 0 }] });

    // 3. "Mark compressor two under maintenance": nothing changes until the user says yes.
    const asked = await call(client, 'set-status', { resource: 'compressor two', status: 'under maintenance' });
    expect(asked).toMatchObject({ status: 'confirmation_required', spoken: 'Mark Compressor 2 as under maintenance (currently available)?' });
    expect(await call(client, 'get-resource', { resource: 'compressor two' })).toMatchObject({
      resource: { attributes: { status: 'available' } },
    });
    expect(await call(client, 'confirm-command', { token: tokenFrom(asked) })).toMatchObject({
      status: 'committed',
      resource: { attributes: { status: 'maintenance' } },
    });

    // 4. "Assign job one oh eight to Rahul" in the repair shop.
    const assignment = await call(client, 'assign-job', { job: 'job one oh eight', assignee: 'Rahul', workspaceId: REPAIR_ID });
    expect(assignment).toMatchObject({ status: 'confirmation_required', spoken: 'Assign Job 108 to Rahul?' });
    expect(await call(client, 'confirm-command', { token: tokenFrom(assignment), workspaceId: REPAIR_ID })).toMatchObject({
      status: 'committed',
      resource: { attributes: { status: 'assigned', assigneeId: 'tech_rahul' } },
    });

    // 5. "Undo": puts the compressor back (the last change by this user was the maintenance one in the warehouse).
    const undoAsk = await call(client, 'undo-last-change', { workspaceId: WORKSPACE_ID });
    expect(undoAsk).toMatchObject({ status: 'confirmation_required' });
    expect(await call(client, 'confirm-command', { token: tokenFrom(undoAsk) })).toMatchObject({
      status: 'committed',
      event: { operation: 'REVERSE_EVENT' },
    });
    expect(await call(client, 'get-resource', { resource: 'compressor two' })).toMatchObject({
      resource: { attributes: { status: 'available' } },
    });

    const events = await call(client, 'list-events');
    expect(events['events']).toHaveLength(4); // +20, -10, maintenance, undo

    await client.close();
    client = undefined;

    // Logs belong on stderr; the fact that every call above worked proves stdout carried only JSON-RPC.
    expect(stderrOutput).toContain('voiceops MCP server ready');
    expect(stderrOutput).toContain('command processed');
    expect(stderrOutput).toContain('confirmation processed');
    expect(stderrOutput).not.toContain(tokenFrom(asked)); // confirmation tokens are never logged
  }, 60_000);
});
