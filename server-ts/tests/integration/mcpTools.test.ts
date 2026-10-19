import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SERVER_INSTRUCTIONS } from '../../src/mcp/server.js';
import { SERVER_NAME, SERVER_VERSION } from '../../src/version.js';
import {
  type ConnectedPair,
  connectInMemory,
  connectWithContext,
  TEST_ACTOR,
  TEST_CLIENT_INFO,
} from '../helpers/connect.js';
import { ALL_WORKSPACE_IDS, CAFE_ID, REPAIR_ID, WORKSPACE_ID } from '../helpers/db.js';

let pair: ConnectedPair | undefined;

afterEach(async () => {
  await pair?.close();
  pair = undefined;
});

interface ToolCall {
  readonly isError: boolean;
  readonly data: Record<string, unknown>;
  readonly text: string;
}

async function call(connected: ConnectedPair, name: string, args: Record<string, unknown> = {}): Promise<ToolCall> {
  const result = CallToolResultSchema.parse(await connected.client.callTool({ name, arguments: args }));
  const [first] = result.content;
  return {
    isError: result.isError === true,
    data: result.structuredContent ?? {},
    text: first?.type === 'text' ? first.text : '',
  };
}

async function connect(): Promise<ConnectedPair> {
  pair = await connectInMemory();
  return pair;
}

describe('server metadata', () => {
  it('reports its name, version and operating instructions on initialize', async () => {
    const { client } = await connect();
    expect(client.getServerVersion()).toMatchObject({ name: SERVER_NAME, version: SERVER_VERSION });
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    expect(SERVER_INSTRUCTIONS).toMatch(/ambiguous.*not_found.*ask the user/);
    expect(SERVER_INSTRUCTIONS).toMatch(/never claim a spreadsheet or board was updated unless "sync" says so/);
  });
});

describe('tool catalogue conventions (AGENTS.md)', () => {
  it('names every tool in verb-first kebab-case and declares all hints', async () => {
    const { client } = await connect();
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
      'retry-sync',
      'set-status',
      'undo-last-change',
    ]);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z]+(-[a-z0-9]+)+$/);
      expect(tool.annotations).toEqual(
        expect.objectContaining({
          readOnlyHint: expect.any(Boolean) as boolean,
          idempotentHint: expect.any(Boolean) as boolean,
          destructiveHint: expect.any(Boolean) as boolean,
        }),
      );
      expect(tool.description).toBeTruthy();
      expect(tool.outputSchema).toBeDefined();
    }
  });

  it('marks exactly the tools that can change something as not read-only', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const changing = tools.filter((tool) => tool.annotations?.readOnlyHint === false).map((tool) => tool.name);
    expect(changing.sort()).toEqual([
      'adjust-quantity',
      'assign-job',
      'cancel-command',
      'confirm-command',
      'retry-sync',
      'set-status',
      'undo-last-change',
    ]);
  });

  it('flags only confirm-command as destructive, so the client\'s own prompt is a second gate', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const destructive = tools.filter((tool) => tool.annotations?.destructiveHint === true).map((tool) => tool.name);
    expect(destructive).toEqual(['confirm-command']);
  });

  it('tells the model never to confirm without the user\'s yes', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    for (const name of ['adjust-quantity', 'set-status', 'assign-job', 'undo-last-change']) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool?.description).toMatch(/Never confirm on your own/);
    }
    expect(tools.find((tool) => tool.name === 'confirm-command')?.description).toMatch(/ONLY after the user has clearly said yes/);
  });
});

describe('check-health', () => {
  it('reports server, workspace, database and client, as structured data and as JSON text', async () => {
    const result = await call(await connect(), 'check-health');
    expect(result.isError).toBe(false);
    expect(result.data).toEqual({
      status: 'ok',
      server: SERVER_NAME,
      version: SERVER_VERSION,
      nodeVersion: 'v24.0.0-test',
      uptimeSeconds: 42,
      workspace: WORKSPACE_ID,
      workspaces: ALL_WORKSPACE_IDS,
      database: 'ok',
      client: TEST_CLIENT_INFO,
    });
    expect(JSON.parse(result.text)).toEqual(result.data);
  });

  it('reports a degraded status, not an error, when the database is down', async () => {
    pair = await connectWithContext((services) => ({
      reads: { ...services.reads, health: () => Promise.resolve({ database: 'unavailable' }) },
    }));

    const result = await call(pair, 'check-health');

    expect(result.isError).toBe(false);
    expect(result.data).toMatchObject({ status: 'degraded', database: 'unavailable' });
  });

  it('reports a null client when the client is unknown', async () => {
    pair = await connectWithContext({ getClientInfo: () => undefined });
    expect((await call(pair, 'check-health')).data).toMatchObject({ client: null });
  });
});

describe('find-resources', () => {
  it('lists everything when there is no query', async () => {
    const result = await call(await connect(), 'find-resources');
    expect(result.data['total']).toBe(4);
    expect(result.data['items']).toEqual([
      expect.objectContaining({ id: 'equipment_compressor_2', type: 'equipment', matchedBy: null }),
      expect.objectContaining({ id: 'item_air_filter', attributes: { quantity: 35, unit: 'pieces', reorderLevel: 10 } }),
      expect.objectContaining({ id: 'item_brake_pads' }),
      expect.objectContaining({ id: 'item_oil_filter' }),
    ]);
  });

  it('ranks matches and honours type and limit', async () => {
    const connected = await connect();
    const filters = await call(connected, 'find-resources', { query: 'filter' });
    expect(filters.data['items']).toEqual([
      expect.objectContaining({ name: 'Air Filter', matchedBy: 'tokens' }),
      expect.objectContaining({ name: 'Oil Filter', matchedBy: 'tokens' }),
    ]);

    const limited = await call(connected, 'find-resources', { limit: 1 });
    expect(limited.data['total']).toBe(4);
    expect(limited.data['items']).toHaveLength(1);

    const equipment = await call(connected, 'find-resources', { type: 'equipment' });
    expect(equipment.data['total']).toBe(1);
  });

  it('returns an empty result, not an error, when nothing matches', async () => {
    const result = await call(await connect(), 'find-resources', { query: 'forklift' });
    expect(result).toMatchObject({ isError: false, data: { total: 0, items: [] } });
  });
});

describe('get-resource', () => {
  it('answers "how many" in a sentence plus structured data', async () => {
    const result = await call(await connect(), 'get-resource', { resource: 'air filters' });
    expect(result.data).toMatchObject({
      status: 'found',
      spoken: 'Air Filter: 35 pieces in stock (reorder at 10).',
      resource: { id: 'item_air_filter', attributes: { quantity: 35 } },
    });
  });

  it('asks which one when the name is ambiguous, without erroring', async () => {
    const result = await call(await connect(), 'get-resource', { resource: 'filter' });
    expect(result.isError).toBe(false);
    expect(result.data).toMatchObject({
      status: 'ambiguous',
      candidates: [{ id: 'item_air_filter' }, { id: 'item_oil_filter' }],
    });
  });

  it('says so when nothing matches', async () => {
    const result = await call(await connect(), 'get-resource', { resource: 'forklift' });
    expect(result.data).toMatchObject({ status: 'not_found', query: 'forklift' });
  });
});

describe('adjust-quantity', () => {
  it('"add twenty air filters": one change, 35 to 55, visible to every other tool', async () => {
    const connected = await connect();

    const added = await call(connected, 'adjust-quantity', { resource: 'air filters', delta: 20 });

    expect(added.isError).toBe(false);
    expect(added.data).toMatchObject({
      status: 'committed',
      replayed: false,
      spoken: 'Added 20. Air Filter is now at 55 pieces.',
      sync: { sheets: 'not_configured' },
      resource: { id: 'item_air_filter', attributes: { quantity: 55 } },
      event: {
        resourceId: 'item_air_filter',
        before: { quantity: 35 },
        after: { quantity: 55 },
        actor: TEST_ACTOR,
        source: 'mcp',
        clientName: 'test-client',
        sync: 'not_configured',
      },
    });
    expect((await call(connected, 'get-resource', { resource: 'air filters' })).data).toMatchObject({
      resource: { attributes: { quantity: 55 } },
    });
    const events = await call(connected, 'list-events');
    expect(events.data['events']).toEqual([
      expect.objectContaining({ summary: 'Added 20 pieces to Air Filter (35 to 55)', actor: TEST_ACTOR }),
    ]);
  });

  it('applies a retried request once when the same idempotency key is sent', async () => {
    const connected = await connect();
    const args = { resource: 'air filters', delta: 20, idempotencyKey: 'retry-key-0001' };

    const first = await call(connected, 'adjust-quantity', args);
    const second = await call(connected, 'adjust-quantity', args);

    expect(first.data).toMatchObject({ status: 'committed', replayed: false });
    expect(second.data).toMatchObject({ status: 'committed', replayed: true });
    expect((await call(connected, 'list-events')).data['events']).toHaveLength(1);
    expect((await call(connected, 'get-resource', { resource: 'air filters' })).data).toMatchObject({
      resource: { attributes: { quantity: 55 } },
    });
  });

  it('reports an error when an idempotency key is reused for a different request', async () => {
    const connected = await connect();
    await call(connected, 'adjust-quantity', { resource: 'air filters', delta: 20, idempotencyKey: 'retry-key-0001' });

    const result = await call(connected, 'adjust-quantity', { resource: 'air filters', delta: 21, idempotencyKey: 'retry-key-0001' });

    expect(result.isError).toBe(true);
    expect(result.data).toMatchObject({ status: 'conflict' });
  });

  it('asks which item when ambiguous, and changes nothing', async () => {
    const connected = await connect();

    const result = await call(connected, 'adjust-quantity', { resource: 'filter', delta: 5 });

    expect(result.isError).toBe(false);
    expect(result.data).toMatchObject({
      status: 'ambiguous',
      candidates: [{ id: 'item_air_filter' }, { id: 'item_oil_filter' }],
    });
    expect((await call(connected, 'list-events')).data['events']).toEqual([]);
  });

  it('reports an unknown item without erroring', async () => {
    const result = await call(await connect(), 'adjust-quantity', { resource: 'forklift', delta: 1 });
    expect(result).toMatchObject({ isError: false, data: { status: 'not_found', query: 'forklift' } });
  });

  it.each([
    ['more than is in stock', { resource: 'brake pads', delta: -20 }, 'INSUFFICIENT_STOCK'],
    ['zero', { resource: 'air filters', delta: 0 }, 'INVALID_ARGUMENT'],
    ['an implausible amount', { resource: 'air filters', delta: 10_001 }, 'LIMIT_EXCEEDED'],
  ])('refuses %s with an error result and a reason code', async (_label, args, code) => {
    const connected = await connect();

    const result = await call(connected, 'adjust-quantity', args);

    expect(result.isError).toBe(true);
    expect(result.data).toMatchObject({ status: 'rejected', code });
    expect((await call(connected, 'list-events')).data['events']).toEqual([]);
  });

  it.each([
    ['a fractional amount', { resource: 'air filters', delta: 1.5 }],
    ['an idempotency key that is too short', { resource: 'air filters', delta: 1, idempotencyKey: 'x' }],
    ['an idempotency key with unsafe characters', { resource: 'air filters', delta: 1, idempotencyKey: 'bad key; drop table' }],
    ['a missing resource', { delta: 1 }],
  ])('rejects malformed input at the boundary: %s', async (_label, args) => {
    const connected = await connect();
    const outcome = await connected.client
      .callTool({ name: 'adjust-quantity', arguments: args })
      .then((result) => result.isError === true)
      .catch(() => true);
    expect(outcome).toBe(true);
    expect((await call(connected, 'list-events')).data['events']).toEqual([]);
  });

  it('records no client name when the client is unknown', async () => {
    pair = await connectWithContext({ getClientInfo: () => undefined });
    await call(pair, 'adjust-quantity', { resource: 'air filters', delta: 1 });
    const events = await call(pair, 'list-events');
    expect(events.data['events']).toEqual([expect.objectContaining({ clientName: null })]);
  });
});

describe('list-events', () => {
  it('is empty before anything has happened', async () => {
    const result = await call(await connect(), 'list-events');
    expect(result.data).toMatchObject({ status: 'ok', events: [], spoken: 'No changes have been recorded yet.' });
  });

  it('lists changes newest first, can be limited and filtered by resource', async () => {
    const connected = await connect();
    await call(connected, 'adjust-quantity', { resource: 'air filters', delta: 5 });
    await call(connected, 'adjust-quantity', { resource: 'oil filters', delta: 3 });
    await call(connected, 'adjust-quantity', { resource: 'air filters', delta: -1 });

    const all = await call(connected, 'list-events');
    expect((all.data['events'] as { resourceName: string }[]).map((event) => event.resourceName)).toEqual([
      'Air Filter',
      'Oil Filter',
      'Air Filter',
    ]);
    expect((await call(connected, 'list-events', { limit: 1 })).data['events']).toHaveLength(1);
    expect((await call(connected, 'list-events', { resource: 'oil filter' })).data['events']).toHaveLength(1);
  });

  it('reports an unknown or ambiguous resource filter', async () => {
    const connected = await connect();
    expect((await call(connected, 'list-events', { resource: 'forklift' })).data).toMatchObject({ status: 'not_found' });
    expect((await call(connected, 'list-events', { resource: 'filter' })).data).toMatchObject({
      status: 'ambiguous',
      candidates: [{ id: 'item_air_filter' }, { id: 'item_oil_filter' }],
    });
  });
});

function tokenFrom(data: Record<string, unknown>): string {
  const confirmation = data['confirmation'];
  if (typeof confirmation === 'object' && confirmation !== null && 'token' in confirmation && typeof confirmation.token === 'string') {
    return confirmation.token;
  }
  throw new Error('no confirmation token in the result');
}

describe('the approval flow, through MCP', () => {
  it('set-status asks first; nothing changes until confirm-command', async () => {
    const connected = await connect();

    const asked = await call(connected, 'set-status', { resource: 'compressor two', status: 'under maintenance' });

    expect(asked.isError).toBe(false);
    expect(asked.data).toMatchObject({
      status: 'confirmation_required',
      workspaceId: WORKSPACE_ID,
      spoken: 'Mark Compressor 2 as under maintenance (currently available)?',
      confirmation: { reason: 'status_change', readback: 'Mark Compressor 2 as under maintenance (currently available)?' },
    });
    expect(tokenFrom(asked.data)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect((await call(connected, 'get-resource', { resource: 'compressor two' })).data).toMatchObject({
      resource: { attributes: { status: 'available' } },
    });
    expect((await call(connected, 'list-events')).data['events']).toEqual([]);

    const done = await call(connected, 'confirm-command', { token: tokenFrom(asked.data) });

    expect(done.isError).toBe(false);
    expect(done.data).toMatchObject({
      status: 'committed',
      replayed: false,
      spoken: 'Compressor 2 is now under maintenance.',
      resource: { attributes: { status: 'maintenance' } },
      event: { operation: 'SET_STATUS', before: { status: 'available' }, after: { status: 'maintenance' }, actor: TEST_ACTOR },
      alerts: { opened: [], resolved: [] },
    });
  });

  it('cancel-command discards the waiting change', async () => {
    const connected = await connect();
    const asked = await call(connected, 'set-status', { resource: 'compressor two', status: 'maintenance' });

    const cancelled = await call(connected, 'cancel-command', { token: tokenFrom(asked.data) });

    expect(cancelled).toMatchObject({ isError: false, data: { status: 'cancelled', workspaceId: WORKSPACE_ID } });
    const late = await call(connected, 'confirm-command', { token: tokenFrom(asked.data) });
    expect(late.isError).toBe(true);
    expect(late.data).toMatchObject({ status: 'rejected', code: 'CONFIRMATION_CANCELLED' });
  });

  it('a large stock change waits for approval too', async () => {
    const connected = await connect();
    const asked = await call(connected, 'adjust-quantity', { resource: 'air filters', delta: 100 });
    expect(asked.data).toMatchObject({ status: 'confirmation_required', confirmation: { reason: 'large_adjustment' } });

    const done = await call(connected, 'confirm-command', { token: tokenFrom(asked.data) });
    expect(done.data).toMatchObject({ status: 'committed', resource: { attributes: { quantity: 135 } } });
  });

  it('refuses an unknown token with an error result, and a malformed token at the boundary', async () => {
    const connected = await connect();

    const unknown = await call(connected, 'confirm-command', { token: 'z'.repeat(22) });
    expect(unknown.isError).toBe(true);
    expect(unknown.data).toMatchObject({ status: 'rejected', code: 'UNKNOWN_CONFIRMATION' });

    const malformed = await connected.client
      .callTool({ name: 'confirm-command', arguments: { token: 'not-a-token' } })
      .then((result) => result.isError === true)
      .catch(() => true);
    expect(malformed).toBe(true);
  });

  it('undo-last-change asks first, then restores the earlier value', async () => {
    const connected = await connect();
    await call(connected, 'adjust-quantity', { resource: 'air filters', delta: 20 });

    const asked = await call(connected, 'undo-last-change');
    expect(asked.data).toMatchObject({
      status: 'confirmation_required',
      confirmation: { reason: 'undo', readback: 'Undo "Added 20 pieces to Air Filter (35 to 55)"?' },
    });
    const done = await call(connected, 'confirm-command', { token: tokenFrom(asked.data) });

    expect(done.data).toMatchObject({
      status: 'committed',
      resource: { attributes: { quantity: 35 } },
      event: { operation: 'REVERSE_EVENT', reversalOf: expect.any(String) as string },
    });
  });

  it('undo-last-change has nothing to undo at first', async () => {
    const result = await call(await connect(), 'undo-last-change');
    expect(result).toMatchObject({ isError: true, data: { status: 'rejected', code: 'NOTHING_TO_UNDO' } });
  });

  it('assign-job works in the repair workspace, and says which name it could not find', async () => {
    const connected = await connect();
    const asked = await call(connected, 'assign-job', { job: 'job one oh eight', assignee: 'Rahul', workspaceId: REPAIR_ID });
    expect(asked.data).toMatchObject({
      status: 'confirmation_required',
      workspaceId: REPAIR_ID,
      spoken: 'Assign Job 108 to Rahul?',
    });
    const done = await call(connected, 'confirm-command', { token: tokenFrom(asked.data), workspaceId: REPAIR_ID });
    expect(done.data).toMatchObject({ status: 'committed', resource: { attributes: { status: 'assigned', assigneeId: 'tech_rahul' } } });

    const missing = await call(connected, 'assign-job', { job: 'job 110', assignee: 'Zed', workspaceId: REPAIR_ID });
    expect(missing.data).toMatchObject({ status: 'not_found', query: 'Zed', role: 'assignee' });
    const unclear = await call(connected, 'assign-job', { job: 'job 110', assignee: 'rahulx', workspaceId: REPAIR_ID });
    expect(unclear.data).toMatchObject({ status: 'ambiguous', role: 'assignee', candidates: [{ name: 'Rahul' }] });
  });
});

describe('alerts, through MCP', () => {
  it('a drop below the reorder level shows up in the result, list-alerts and get-board, and clears on restock', async () => {
    const connected = await connect();

    const removed = await call(connected, 'adjust-quantity', { resource: 'brake pads', delta: -10 });
    expect(removed.data).toMatchObject({
      status: 'committed',
      alerts: { opened: [{ resourceId: 'item_brake_pads', rule: 'low_stock', status: 'open' }], resolved: [] },
    });
    expect(removed.data['spoken']).toContain('Alert: Brake Pads is low on stock');

    const alerts = await call(connected, 'list-alerts');
    expect(alerts.data).toMatchObject({ spoken: 'There is 1 open alert.', alerts: [{ resourceName: 'Brake Pads' }] });

    const board = await call(connected, 'get-board');
    expect(board.data).toMatchObject({
      metrics: [{ label: 'Low stock', value: 1 }, { label: 'Equipment down', value: 0 }],
      resources: expect.arrayContaining([expect.objectContaining({ id: 'item_brake_pads', hasAlert: true })]) as unknown[],
    });

    const restocked = await call(connected, 'adjust-quantity', { resource: 'brake pads', delta: 10 });
    expect(restocked.data).toMatchObject({ alerts: { opened: [], resolved: [{ resourceId: 'item_brake_pads', status: 'resolved' }] } });
    expect((await call(connected, 'list-alerts')).data['alerts']).toEqual([]);
    expect((await call(connected, 'list-alerts', { status: 'all' })).data['alerts']).toHaveLength(1);
  });
});

describe('get-board', () => {
  it('returns headline numbers, every resource and the latest changes in one versioned snapshot', async () => {
    const connected = await connect();
    const before = await call(connected, 'get-board');
    expect(before.data).toMatchObject({
      workspaceId: WORKSPACE_ID,
      title: 'Northside Operations',
      version: 0,
      spoken: 'Northside Operations: Low stock 0, Equipment down 0.',
      recentActivity: [],
    });
    expect(before.data['resources']).toHaveLength(4);
    expect(new Date(String(before.data['generatedAt'])).getTime()).not.toBeNaN();

    await call(connected, 'adjust-quantity', { resource: 'air filters', delta: 1 });
    const after = await call(connected, 'get-board');

    expect(after.data['version']).toBe(1);
    expect(after.data['recentActivity']).toHaveLength(1);
  });

  it('shows the cafe menu and the repair board for their workspaces', async () => {
    const connected = await connect();
    expect((await call(connected, 'get-board', { workspaceId: CAFE_ID })).data).toMatchObject({
      title: 'Harbor Cafe Menu',
      metrics: [{ label: 'Available', value: 5 }, { label: 'Sold out', value: 0 }],
    });
    expect((await call(connected, 'get-board', { workspaceId: REPAIR_ID })).data).toMatchObject({
      title: 'Eastside Repair Board',
      metrics: [
        { label: 'Open jobs', value: 3 },
        { label: 'Unassigned', value: 2 },
        { label: 'Technicians on duty', value: 3 },
      ],
    });
  });
});

describe('workspaces', () => {
  it('get-workspace describes what the workspace contains and which statuses are allowed', async () => {
    const connected = await connect();

    const warehouse = await call(connected, 'get-workspace');
    expect(warehouse.data).toMatchObject({
      workspaceId: WORKSPACE_ID,
      name: 'Northside Operations',
      template: 'warehouse',
      workspaces: ALL_WORKSPACE_IDS,
      counts: { inventory_item: 3, equipment: 1 },
      settings: { largeAdjustThreshold: 100, maxAdjustment: 10_000, equipmentStatuses: ['available', 'maintenance', 'out_of_service'] },
      spreadsheet: 'not_configured',
    });
    expect(warehouse.data['settings']).not.toHaveProperty('menuItemStatuses');

    const cafe = await call(connected, 'get-workspace', { workspaceId: CAFE_ID });
    expect(cafe.data).toMatchObject({ counts: { menu_item: 5 }, settings: { menuItemStatuses: ['available', 'sold_out'] } });
    expect(cafe.data['settings']).not.toHaveProperty('equipmentStatuses');
  });

  it('get-workspace says when a spreadsheet is configured', async () => {
    const connected = await connect();
    await connected.services.pool.query(`UPDATE workspaces SET integrations = '{"sheets":{"spreadsheetId":"abc"}}' WHERE id = $1`, [WORKSPACE_ID]);

    expect((await call(connected, 'get-workspace')).data).toMatchObject({ spreadsheet: 'configured' });
    const added = await call(connected, 'adjust-quantity', { resource: 'air filters', delta: 1 });
    expect(added.data).toMatchObject({ sync: { sheets: 'pending' } });
  });

  it('the same tools work in every workspace: reads and changes follow workspaceId', async () => {
    const connected = await connect();

    const menu = await call(connected, 'find-resources', { workspaceId: CAFE_ID });
    expect(menu.data).toMatchObject({ workspaceId: CAFE_ID, total: 5 });
    const jobs = await call(connected, 'find-resources', { workspaceId: REPAIR_ID, type: 'job' });
    expect(jobs.data['total']).toBe(4);
    expect((await call(connected, 'get-resource', { resource: 'job one oh eight', workspaceId: REPAIR_ID })).data).toMatchObject({
      spoken: 'Job 108 (Brake overhaul) is waiting.',
    });
    expect((await call(connected, 'list-events', { workspaceId: CAFE_ID })).data).toMatchObject({ workspaceId: CAFE_ID, events: [] });
  });

  it('a name from another workspace is not found here', async () => {
    const result = await call(await connect(), 'get-resource', { resource: 'chicken biryani' });
    expect(result.data).toMatchObject({ status: 'not_found' });
  });

  it('refuses a workspace that is not on the allow-list, for reads and changes alike', async () => {
    pair = await connectWithContext({ workspaceIds: [WORKSPACE_ID] });
    for (const [name, args] of [
      ['find-resources', {}],
      ['get-board', {}],
      ['adjust-quantity', { resource: 'chicken biryani', delta: 1 }],
      ['confirm-command', { token: 'z'.repeat(22) }],
    ] as const) {
      const result = await call(pair, name, { ...args, workspaceId: CAFE_ID });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('is not available to this server');
    }
  });

  it('refuses a malformed workspace id at the boundary', async () => {
    const connected = await connect();
    const refused = await connected.client
      .callTool({ name: 'find-resources', arguments: { workspaceId: '../../etc' } })
      .then((result) => result.isError === true)
      .catch(() => true);
    expect(refused).toBe(true);
  });
});

describe('spreadsheet sync, through MCP', () => {
  async function failedEventId(connected: ConnectedPair): Promise<string> {
    await connected.services.pool.query(
      `UPDATE workspaces SET integrations = '{"sheets":{"spreadsheetId":"spreadsheet-id-1234567890abcdef"}}' WHERE id = $1`,
      [WORKSPACE_ID],
    );
    const added = await call(connected, 'adjust-quantity', { resource: 'air filters', delta: 1 });
    expect(added.data).toMatchObject({ sync: { sheets: 'pending' } });
    await connected.services.pool.query(`UPDATE sync_jobs SET status = 'failed', attempts = 8, last_error = 'Google denied access to the spreadsheet.'`);
    return (added.data['event'] as { eventId: string }).eventId;
  }

  it('list-events shows each update\'s state and, when it failed, why', async () => {
    const connected = await connect();
    await failedEventId(connected);

    const events = await call(connected, 'list-events');

    expect(events.data['events']).toEqual([
      expect.objectContaining({ sync: 'failed', syncError: 'Google denied access to the spreadsheet.' }),
    ]);
    expect((await call(connected, 'get-board')).data['recentActivity']).toEqual([
      expect.objectContaining({ sync: 'failed', syncError: 'Google denied access to the spreadsheet.' }),
    ]);
  });

  it('get-workspace reports the sync backlog, so a worker that is not running shows up', async () => {
    const connected = await connect();
    expect((await call(connected, 'get-workspace')).data).toMatchObject({
      spreadsheet: 'not_configured',
      spreadsheetSync: { pending: 0, retrying: 0, failed: 0 },
    });

    await failedEventId(connected);
    await call(connected, 'adjust-quantity', { resource: 'air filters', delta: 1 });

    expect((await call(connected, 'get-workspace')).data).toMatchObject({
      spreadsheet: 'configured',
      spreadsheetSync: { pending: 1, retrying: 0, failed: 1 },
    });
  });

  it('retry-sync puts a failed update back in the queue, and is safe to repeat', async () => {
    const connected = await connect();
    const eventId = await failedEventId(connected);

    const first = await call(connected, 'retry-sync', { eventId });
    expect(first).toMatchObject({ isError: false, data: { status: 'queued', workspaceId: WORKSPACE_ID } });
    expect((await call(connected, 'list-events')).data['events']).toEqual([expect.objectContaining({ sync: 'pending', syncError: null })]);

    expect((await call(connected, 'retry-sync', { eventId })).data).toMatchObject({ status: 'already_queued' });
    await connected.services.pool.query(`UPDATE sync_jobs SET status = 'synced'`);
    expect((await call(connected, 'retry-sync', { eventId })).data).toMatchObject({ status: 'already_synced' });
  });

  it('retry-sync says when there is no such update, and refuses a malformed id', async () => {
    const connected = await connect();
    expect((await call(connected, 'retry-sync', { eventId: '0b7c3f5e-6d0a-4f0e-9a52-1b2d3c4e5f60' })).data).toMatchObject({
      status: 'not_found',
    });
    const refused = await connected.client
      .callTool({ name: 'retry-sync', arguments: { eventId: 'not-a-uuid' } })
      .then((result) => result.isError === true)
      .catch(() => true);
    expect(refused).toBe(true);
  });

  it('is described honestly to the model: pending turns into synced later, failures can be retried', async () => {
    const { client } = await connect();
    expect(client.getInstructions()).toMatch(/"pending" turns into "synced".*retry-sync/);
  });
});

describe('the demo-only reset tool', () => {
  it('does not exist unless demo tools are on', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).not.toContain('reset-workspace');
  });

  it('is registered, flagged destructive, and resets the chosen workspace when the user\'s request is explicit', async () => {
    const resetWorkspace = vi.fn(() => Promise.resolve());
    pair = await connectWithContext({ demo: { resetWorkspace } });

    const { tools } = await pair.client.listTools();
    expect(tools.find((tool) => tool.name === 'reset-workspace')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    const result = await call(pair, 'reset-workspace', { confirm: true, workspaceId: CAFE_ID });

    expect(result).toMatchObject({ isError: false, data: { status: 'reset', workspaceId: CAFE_ID } });
    expect(resetWorkspace).toHaveBeenCalledExactlyOnceWith(CAFE_ID);
  });

  it('defaults to the default workspace, and refuses without an explicit confirm or for a workspace outside the allow-list', async () => {
    const resetWorkspace = vi.fn(() => Promise.resolve());
    pair = await connectWithContext({ demo: { resetWorkspace }, workspaceIds: [WORKSPACE_ID] });

    expect((await call(pair, 'reset-workspace', { confirm: true })).data).toMatchObject({ workspaceId: WORKSPACE_ID });
    for (const args of [{}, { confirm: false }, { confirm: 'yes' }]) {
      const refused = await pair.client
        .callTool({ name: 'reset-workspace', arguments: args })
        .then((result) => result.isError === true)
        .catch(() => true);
      expect(refused).toBe(true);
    }
    expect((await call(pair, 'reset-workspace', { confirm: true, workspaceId: CAFE_ID })).isError).toBe(true);
    expect(resetWorkspace).toHaveBeenCalledTimes(1);
  });
});
