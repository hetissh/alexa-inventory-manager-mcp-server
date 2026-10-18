import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';

import { SERVER_INSTRUCTIONS } from '../../src/mcp/server.js';
import { SERVER_NAME, SERVER_VERSION } from '../../src/version.js';
import {
  type ConnectedPair,
  connectInMemory,
  connectWithContext,
  TEST_ACTOR,
  TEST_CLIENT_INFO,
} from '../helpers/connect.js';
import { WORKSPACE_ID } from '../helpers/db.js';

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
      'check-health',
      'find-resources',
      'get-resource',
      'list-events',
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

  it('marks only adjust-quantity as a change', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const changing = tools.filter((tool) => tool.annotations?.readOnlyHint === false).map((tool) => tool.name);
    expect(changing).toEqual(['adjust-quantity']);
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
    ['a large change that needs confirmation', { resource: 'air filters', delta: 100 }, 'CONFIRMATION_UNSUPPORTED'],
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
