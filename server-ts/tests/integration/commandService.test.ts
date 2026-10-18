import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type CommandOutcome,
  type CommandRequest,
  type CommandService,
  createCommandService,
} from '../../src/app/commandService.js';
import { WorkspaceNotFoundError } from '../../src/app/errors.js';
import type { AppLogger, Store } from '../../src/app/ports.js';
import { createPgStore } from '../../src/infra/db/pgStore.js';
import { createTestPool, resetWarehouse, WORKSPACE_ID } from '../helpers/db.js';
import { inventoryItem } from '../helpers/resources.js';

let pool: Pool;
let store: Store;
let service: CommandService;
const info = vi.fn<AppLogger['info']>();
const logger: AppLogger = { info, warn: vi.fn() };

beforeAll(() => {
  pool = createTestPool();
  store = createPgStore(pool);
  service = createCommandService(store, logger);
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  vi.clearAllMocks();
  await resetWarehouse(pool);
});

const request = (overrides: Partial<CommandRequest> = {}): CommandRequest => ({
  commandId: 'cmd-1',
  workspaceId: WORKSPACE_ID,
  actorId: 'manager-1',
  source: 'mcp',
  clientName: 'test-client',
  operation: 'ADJUST_QUANTITY',
  target: 'air filters',
  arguments: { delta: 20 },
  ...overrides,
});

async function quantityOf(resourceId: string): Promise<number> {
  const result = await pool.query<{ quantity: number }>(
    `SELECT (attributes->>'quantity')::int AS quantity FROM resources WHERE workspace_id = $1 AND id = $2`,
    [WORKSPACE_ID, resourceId],
  );
  return result.rows[0]?.quantity ?? Number.NaN;
}

async function countOf(table: 'events' | 'sync_jobs'): Promise<number> {
  const result = await pool.query<{ count: string }>(`SELECT count(*) FROM ${table}`);
  return Number(result.rows[0]?.count);
}

async function boardVersion(): Promise<number> {
  const result = await pool.query<{ board_version: string }>('SELECT board_version FROM workspaces WHERE id = $1', [
    WORKSPACE_ID,
  ]);
  return Number(result.rows[0]?.board_version);
}

async function configureSheets(): Promise<void> {
  await pool.query('UPDATE workspaces SET integrations = $1 WHERE id = $2', [
    JSON.stringify({ sheets: { spreadsheetId: 'sheet-123' } }),
    WORKSPACE_ID,
  ]);
}

function committed(outcome: CommandOutcome): Extract<CommandOutcome, { status: 'committed' }> {
  if (outcome.status !== 'committed') {
    throw new Error(`expected committed, got ${outcome.status}: ${outcome.spoken}`);
  }
  return outcome;
}

describe('add stock (the headline scenario)', () => {
  it('turns 35 into 55 with exactly one event and one board bump', async () => {
    const outcome = committed(await service.execute(request()));

    expect(outcome).toMatchObject({
      replayed: false,
      spoken: 'Added 20. Air Filter is now at 55 pieces.',
      sync: { sheets: 'not_configured' },
      resource: { id: 'item_air_filter', version: 2, attributes: { quantity: 55 } },
      event: {
        commandId: 'cmd-1',
        resourceId: 'item_air_filter',
        resourceName: 'Air Filter',
        operation: 'ADJUST_QUANTITY',
        arguments: { delta: 20 },
        before: { quantity: 35 },
        after: { quantity: 55 },
        summary: 'Added 20 pieces to Air Filter (35 to 55)',
        actor: 'manager-1',
        source: 'mcp',
        clientName: 'test-client',
      },
    });
    expect(await quantityOf('item_air_filter')).toBe(55);
    expect(await countOf('events')).toBe(1);
    expect(await boardVersion()).toBe(1);
  });

  it('removes stock and records the new level', async () => {
    const outcome = committed(await service.execute(request({ target: 'oil filter', arguments: { delta: -5 } })));
    expect(outcome.spoken).toBe('Removed 5. Oil Filter is now at 15 pieces.');
    expect(await quantityOf('item_oil_filter')).toBe(15);
  });

  it('logs every processed command with its identifiers', async () => {
    await service.execute(request());
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        commandId: 'cmd-1',
        operation: 'ADJUST_QUANTITY',
        actor: 'manager-1',
        source: 'mcp',
        status: 'committed',
        replayed: false,
      }),
      'command processed',
    );
  });
});

describe('idempotency', () => {
  it('applies a repeated command id once and replays the original result', async () => {
    const first = committed(await service.execute(request()));
    const second = committed(await service.execute(request()));

    expect(second.replayed).toBe(true);
    expect(second.event.eventId).toBe(first.event.eventId);
    expect(second.spoken).toBe('This request was already applied earlier: Added 20 pieces to Air Filter (35 to 55).');
    expect(await quantityOf('item_air_filter')).toBe(55);
    expect(await countOf('events')).toBe(1);
    expect(await boardVersion()).toBe(1);
  });

  it('replays the original event even after the resource has changed again', async () => {
    await service.execute(request());
    await service.execute(request({ commandId: 'cmd-2', arguments: { delta: 5 } }));

    const replay = committed(await service.execute(request()));

    expect(replay.replayed).toBe(true);
    expect(replay.event.after).toEqual({ quantity: 55 });
    expect(replay.resource.attributes).toMatchObject({ quantity: 60 });
    expect(await countOf('events')).toBe(2);
  });

  it('reports a conflict when a command id is reused for a different request', async () => {
    await service.execute(request());

    const differentAmount = await service.execute(request({ arguments: { delta: 21 } }));
    const differentItem = await service.execute(request({ target: 'oil filter' }));

    for (const outcome of [differentAmount, differentItem]) {
      expect(outcome).toMatchObject({ status: 'conflict', message: expect.stringContaining('already used') as string });
    }
    expect(await quantityOf('item_air_filter')).toBe(55);
    expect(await quantityOf('item_oil_filter')).toBe(20);
    expect(await countOf('events')).toBe(1);
  });

  it('applies two parallel identical requests exactly once', async () => {
    const [a, b] = await Promise.all([service.execute(request()), service.execute(request())]);

    expect([committed(a).replayed, committed(b).replayed].sort()).toEqual([false, true]);
    expect(await quantityOf('item_air_filter')).toBe(55);
    expect(await countOf('events')).toBe(1);
  });

  it('lets only one of two parallel requests that share a command id but target different items win', async () => {
    const outcomes = await Promise.all([
      service.execute(request({ target: 'air filter' })),
      service.execute(request({ target: 'oil filter' })),
    ]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['committed', 'conflict']);
    expect(await countOf('events')).toBe(1);
    expect((await quantityOf('item_air_filter')) + (await quantityOf('item_oil_filter'))).toBe(35 + 20 + 20);
  });
});

describe('concurrency', () => {
  it('serialises parallel changes to the same item so no update is lost', async () => {
    await Promise.all([
      service.execute(request({ commandId: 'a', arguments: { delta: 5 } })),
      service.execute(request({ commandId: 'b', arguments: { delta: 7 } })),
      service.execute(request({ commandId: 'c', arguments: { delta: -2 } })),
    ]);

    expect(await quantityOf('item_air_filter')).toBe(35 + 5 + 7 - 2);
    expect(await countOf('events')).toBe(3);
    expect(await boardVersion()).toBe(3);
  });
});

describe('atomicity', () => {
  it('leaves no event, no state change and no board bump when any step fails', async () => {
    const failing: Store = {
      ...store,
      withTransaction: (work) =>
        store.withTransaction((tx) => work({ ...tx, bumpBoardVersion: () => Promise.reject(new Error('boom')) })),
    };

    await expect(createCommandService(failing, logger).execute(request())).rejects.toThrow('boom');

    expect(await quantityOf('item_air_filter')).toBe(35);
    expect(await countOf('events')).toBe(0);
    expect(await boardVersion()).toBe(0);
  });
});

describe('spreadsheet outbox', () => {
  it('stays out of the way when no spreadsheet is configured', async () => {
    const outcome = committed(await service.execute(request()));
    expect(outcome.sync).toEqual({ sheets: 'not_configured' });
    expect(await countOf('sync_jobs')).toBe(0);
  });

  it('queues exactly one sync job in the same transaction, and says the update is pending', async () => {
    await configureSheets();

    const outcome = committed(await service.execute(request()));

    expect(outcome.sync).toEqual({ sheets: 'pending' });
    expect(outcome.spoken).toBe('Added 20. Air Filter is now at 55 pieces. The spreadsheet update is pending.');
    expect(await countOf('sync_jobs')).toBe(1);
    const job = await pool.query<{ event_id: string; destination: string; status: string }>(
      'SELECT event_id, destination, status FROM sync_jobs',
    );
    expect(job.rows).toEqual([{ event_id: outcome.event.eventId, destination: 'sheets', status: 'pending' }]);
  });

  it('does not queue a second job when a request is replayed, and reports the job’s current state', async () => {
    await configureSheets();
    await service.execute(request());
    await pool.query(`UPDATE sync_jobs SET status = 'synced'`);

    const replay = committed(await service.execute(request()));

    expect(replay.sync).toEqual({ sheets: 'synced' });
    expect(replay.spoken).toContain('The spreadsheet is up to date.');
    expect(await countOf('sync_jobs')).toBe(1);
  });

  it('rolls the event back if the job cannot be queued', async () => {
    await configureSheets();
    const failing: Store = {
      ...store,
      withTransaction: (work) =>
        store.withTransaction((tx) => work({ ...tx, enqueueSync: () => Promise.reject(new Error('queue down')) })),
    };

    await expect(createCommandService(failing, logger).execute(request())).rejects.toThrow('queue down');

    expect(await countOf('events')).toBe(0);
    expect(await quantityOf('item_air_filter')).toBe(35);
  });
});

describe('refusals change nothing', () => {
  async function expectUntouched(): Promise<void> {
    expect(await countOf('events')).toBe(0);
    expect(await boardVersion()).toBe(0);
    expect(await quantityOf('item_air_filter')).toBe(35);
    expect(await quantityOf('item_brake_pads')).toBe(12);
  }

  it('rejects removing more than is in stock', async () => {
    const outcome = await service.execute(request({ target: 'brake pads', arguments: { delta: -20 } }));
    expect(outcome).toMatchObject({
      status: 'rejected',
      code: 'INSUFFICIENT_STOCK',
      message: 'Cannot remove 20 pieces of Brake Pads: only 12 in stock.',
      spoken: 'Cannot remove 20 pieces of Brake Pads: only 12 in stock.',
    });
    await expectUntouched();
  });

  it.each([
    ['a large addition', 'air filters', 100],
    ['removing everything', 'brake pads', -12],
  ])('refuses %s because confirmation is not available yet', async (_label, target, delta) => {
    const outcome = await service.execute(request({ target, arguments: { delta } }));
    expect(outcome).toMatchObject({
      status: 'rejected',
      code: 'CONFIRMATION_UNSUPPORTED',
      message: expect.stringContaining('nothing was changed') as string,
    });
    await expectUntouched();
  });

  it('rejects an implausible amount', async () => {
    expect(await service.execute(request({ arguments: { delta: 10_001 } }))).toMatchObject({
      status: 'rejected',
      code: 'LIMIT_EXCEEDED',
    });
    await expectUntouched();
  });

  it.each([
    ['zero', { delta: 0 }],
    ['a fraction', { delta: 1.5 }],
    ['nothing', {}],
    ['junk', 'twenty'],
  ])('rejects invalid arguments: %s', async (_label, args) => {
    expect(await service.execute(request({ arguments: args }))).toMatchObject({
      status: 'rejected',
      code: 'INVALID_ARGUMENT',
    });
    await expectUntouched();
  });

  it('rejects a target that vanished between lookup and commit', async () => {
    const ghost = inventoryItem('item_ghost', 'Ghost Item');
    const stale: Store = { ...store, listResources: async (ws, filter) => [...(await store.listResources(ws, filter)), ghost] };

    const outcome = await createCommandService(stale, logger).execute(request({ target: 'ghost item' }));

    expect(outcome).toMatchObject({ status: 'rejected', code: 'INVALID_TARGET' });
    await expectUntouched();
  });

  it('throws for a workspace that does not exist', async () => {
    await expect(service.execute(request({ workspaceId: 'no-such-workspace' }))).rejects.toBeInstanceOf(
      WorkspaceNotFoundError,
    );
  });
});

describe('matching never guesses', () => {
  async function expectNothingWritten(): Promise<void> {
    expect(await countOf('events')).toBe(0);
    expect(await quantityOf('item_air_filter')).toBe(35);
    expect(await quantityOf('item_oil_filter')).toBe(20);
  }

  it('asks which one when "filter" matches two items', async () => {
    const outcome = await service.execute(request({ target: 'filter' }));
    expect(outcome).toMatchObject({
      status: 'ambiguous',
      query: 'filter',
      spoken: 'I found several matches for "filter": Air Filter, Oil Filter. Which one do you mean?',
      candidates: [{ id: 'item_air_filter' }, { id: 'item_oil_filter' }],
    });
    await expectNothingWritten();
  });

  it('asks instead of silently fixing a likely typo', async () => {
    const outcome = await service.execute(request({ target: 'air filtr' }));
    expect(outcome).toMatchObject({
      status: 'ambiguous',
      spoken: 'I couldn\'t find an exact match for "air filtr". Did you mean Air Filter?',
    });
    await expectNothingWritten();
  });

  it('reports an unknown item', async () => {
    expect(await service.execute(request({ target: 'forklift' }))).toMatchObject({
      status: 'not_found',
      query: 'forklift',
      spoken: 'I couldn\'t find "forklift" in this workspace.',
    });
    await expectNothingWritten();
  });

  it('does not offer equipment as a target for adjusting quantity', async () => {
    expect(await service.execute(request({ target: 'compressor two' }))).toMatchObject({ status: 'not_found' });
    await expectNothingWritten();
  });
});
