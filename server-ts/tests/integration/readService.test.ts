import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCommandService } from '../../src/app/commandService.js';
import type { AppLogger, Store } from '../../src/app/ports.js';
import { createReadService, type ReadService } from '../../src/app/readService.js';
import { createPgStore } from '../../src/infra/db/pgStore.js';
import { createTestPool, resetWarehouse, WORKSPACE_ID } from '../helpers/db.js';

let pool: Pool;
let store: Store;
let reads: ReadService;
const warn = vi.fn<AppLogger['warn']>();
const logger: AppLogger = { info: vi.fn(), warn };

beforeAll(() => {
  pool = createTestPool();
  store = createPgStore(pool);
  reads = createReadService(store, logger);
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  vi.clearAllMocks();
  await resetWarehouse(pool);
});

async function addStock(commandId: string, target: string, delta: number): Promise<void> {
  await createCommandService(store, logger).execute({
    commandId,
    workspaceId: WORKSPACE_ID,
    actorId: 'manager-1',
    source: 'mcp',
    clientName: null,
    operation: 'ADJUST_QUANTITY',
    target,
    arguments: { delta },
  });
}

describe('health', () => {
  it('reports the database as ok', async () => {
    expect(await reads.health()).toEqual({ database: 'ok' });
  });

  it('reports the database as unavailable, and logs it, instead of throwing', async () => {
    const broken: Store = { ...store, ping: () => Promise.reject(new Error('connection refused')) };

    expect(await createReadService(broken, logger).health()).toEqual({ database: 'unavailable' });
    expect(warn).toHaveBeenCalledWith(expect.anything(), 'database health check failed');
  });
});

describe('findResources', () => {
  it('lists everything, equipment first then inventory, when there is no query', async () => {
    for (const query of [undefined, '', '   ']) {
      const result = await reads.findResources(WORKSPACE_ID, { query, limit: 20 });
      expect(result.total).toBe(4);
      expect(result.items.map((item) => item.resource.id)).toEqual([
        'equipment_compressor_2',
        'item_air_filter',
        'item_brake_pads',
        'item_oil_filter',
      ]);
      expect(result.items.every((item) => item.matchedBy === null && item.score === null)).toBe(true);
    }
  });

  it('ranks matches for a query', async () => {
    const result = await reads.findResources(WORKSPACE_ID, { query: 'filter', limit: 20 });
    expect(result.total).toBe(2);
    expect(result.items.map((item) => [item.resource.name, item.matchedBy])).toEqual([
      ['Air Filter', 'tokens'],
      ['Oil Filter', 'tokens'],
    ]);
  });

  it('filters by type, applies the limit but still reports the total', async () => {
    const equipment = await reads.findResources(WORKSPACE_ID, { type: 'equipment', limit: 20 });
    expect(equipment.items.map((item) => item.resource.id)).toEqual(['equipment_compressor_2']);

    const limited = await reads.findResources(WORKSPACE_ID, { limit: 1 });
    expect(limited.total).toBe(4);
    expect(limited.items).toHaveLength(1);
  });

  it('returns nothing for a query that matches nothing', async () => {
    expect(await reads.findResources(WORKSPACE_ID, { query: 'forklift', limit: 20 })).toEqual({ total: 0, items: [] });
  });
});

describe('getResource', () => {
  it('finds a resource by the way people say it', async () => {
    const outcome = await reads.getResource(WORKSPACE_ID, 'how many air filters');
    // extra words are not allowed to match: ask rather than guess
    expect(outcome.status).not.toBe('found');

    expect(await reads.getResource(WORKSPACE_ID, 'air filters')).toMatchObject({
      status: 'found',
      matchedBy: 'name',
      spoken: 'Air Filter: 35 pieces in stock (reorder at 10).',
      resource: { id: 'item_air_filter' },
    });
    expect(await reads.getResource(WORKSPACE_ID, 'compressor two')).toMatchObject({
      status: 'found',
      spoken: 'Compressor 2 is available.',
    });
  });

  it('lets a read resolve a clear typo, and says so', async () => {
    expect(await reads.getResource(WORKSPACE_ID, 'air filtr')).toMatchObject({
      status: 'found',
      matchedBy: 'fuzzy',
      resource: { id: 'item_air_filter' },
    });
  });

  it('asks which one when the name is ambiguous', async () => {
    expect(await reads.getResource(WORKSPACE_ID, 'filter')).toMatchObject({
      status: 'ambiguous',
      query: 'filter',
      candidates: [{ id: 'item_air_filter' }, { id: 'item_oil_filter' }],
    });
  });

  it('says so when nothing matches', async () => {
    expect(await reads.getResource(WORKSPACE_ID, 'forklift')).toEqual({
      status: 'not_found',
      query: 'forklift',
      spoken: 'I couldn\'t find "forklift" in this workspace.',
    });
  });
});

describe('listEvents', () => {
  it('is empty before anything has happened', async () => {
    expect(await reads.listEvents(WORKSPACE_ID, { limit: 10 })).toEqual({
      status: 'ok',
      events: [],
      spoken: 'No changes have been recorded yet.',
    });
  });

  it('lists changes newest first and can be limited to one resource', async () => {
    await addStock('a', 'air filters', 5);
    await addStock('b', 'oil filters', 3);
    await addStock('c', 'air filters', -1);

    const all = await reads.listEvents(WORKSPACE_ID, { limit: 10 });
    expect(all.status === 'ok' && all.events.map((event) => event.commandId)).toEqual(['c', 'b', 'a']);
    expect(all.spoken).toBe('Here are the 3 most recent changes.');

    const airFilter = await reads.listEvents(WORKSPACE_ID, { limit: 10, resource: 'air filter' });
    expect(airFilter.status === 'ok' && airFilter.events.map((event) => event.commandId)).toEqual(['c', 'a']);

    const one = await reads.listEvents(WORKSPACE_ID, { limit: 1, resource: 'oil filter' });
    expect(one).toMatchObject({ status: 'ok', spoken: 'Here is the most recent change.' });
  });

  it('reports an unknown or ambiguous resource instead of listing everything', async () => {
    expect(await reads.listEvents(WORKSPACE_ID, { limit: 10, resource: 'forklift' })).toMatchObject({
      status: 'not_found',
      query: 'forklift',
    });
    expect(await reads.listEvents(WORKSPACE_ID, { limit: 10, resource: 'filter' })).toMatchObject({
      status: 'ambiguous',
      candidates: [{ id: 'item_air_filter' }, { id: 'item_oil_filter' }],
    });
  });
});
