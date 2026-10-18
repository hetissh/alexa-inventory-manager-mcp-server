import { setTimeout as delay } from 'node:timers/promises';

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DuplicateCommandError, VersionConflictError, WorkspaceNotFoundError } from '../../src/app/errors.js';
import type { NewEvent, Store } from '../../src/app/ports.js';
import { createPgStore } from '../../src/infra/db/pgStore.js';
import { createTestPool, resetWarehouse, WORKSPACE_ID } from '../helpers/db.js';

let pool: Pool;
let store: Store;

beforeAll(() => {
  pool = createTestPool();
  store = createPgStore(pool);
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await resetWarehouse(pool);
});

const newEvent = (overrides: Partial<NewEvent> = {}): NewEvent => ({
  workspaceId: WORKSPACE_ID,
  commandId: 'cmd-1',
  resourceId: 'item_air_filter',
  operation: 'ADJUST_QUANTITY',
  arguments: { delta: 20 },
  before: { quantity: 35 },
  after: { quantity: 55 },
  summary: 'Added 20 pieces to Air Filter (35 to 55)',
  actor: 'manager-1',
  source: 'mcp',
  clientName: 'test-client',
  ...overrides,
});

describe('reads', () => {
  it('returns a workspace, or undefined for an unknown one', async () => {
    expect(await store.getWorkspace(WORKSPACE_ID)).toEqual({
      id: WORKSPACE_ID,
      name: 'Northside Operations',
      template: 'warehouse',
      timezone: 'Asia/Kolkata',
      boardVersion: 0,
      integrations: {},
    });
    expect(await store.getWorkspace('no-such-workspace')).toBeUndefined();
  });

  it('lists resources ordered by type then name, optionally filtered by type', async () => {
    expect((await store.listResources(WORKSPACE_ID)).map((resource) => resource.id)).toEqual([
      'equipment_compressor_2',
      'item_air_filter',
      'item_brake_pads',
      'item_oil_filter',
    ]);
    expect((await store.listResources(WORKSPACE_ID, { types: ['equipment'] })).map((r) => r.id)).toEqual([
      'equipment_compressor_2',
    ]);
    expect(await store.listResources(WORKSPACE_ID, {})).toHaveLength(4);
    expect(await store.listResources('no-such-workspace')).toEqual([]);
  });

  it('answers a ping', async () => {
    await expect(store.ping()).resolves.toBeUndefined();
  });
});

describe('withTransaction', () => {
  it('returns the value of the work and commits it', async () => {
    const version = await store.withTransaction(async (tx) => {
      const updated = await tx.updateResourceAttributes(
        WORKSPACE_ID,
        'item_air_filter',
        { quantity: 40, unit: 'pieces', reorderLevel: 10 },
        1,
      );
      return updated.version;
    });
    expect(version).toBe(2);
    const [airFilter] = (await store.listResources(WORKSPACE_ID)).filter((r) => r.id === 'item_air_filter');
    expect(airFilter?.attributes).toMatchObject({ quantity: 40 });
  });

  it('rolls everything back when the work throws', async () => {
    await expect(
      store.withTransaction(async (tx) => {
        await tx.insertEvent(newEvent());
        await tx.bumpBoardVersion(WORKSPACE_ID);
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await store.listEvents(WORKSPACE_ID, { limit: 10 })).toEqual([]);
    expect((await store.getWorkspace(WORKSPACE_ID))?.boardVersion).toBe(0);
  });

  it('lockResource blocks a concurrent locker until the first transaction ends', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signalLocked: () => void = () => undefined;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });

    const holder = store.withTransaction(async (tx) => {
      await tx.lockResource(WORKSPACE_ID, 'item_air_filter');
      signalLocked();
      await gate;
      return 'held';
    });
    await locked;

    let waiterGotLock = false;
    const waiter = store.withTransaction(async (tx) => {
      const resource = await tx.lockResource(WORKSPACE_ID, 'item_air_filter');
      waiterGotLock = true;
      return resource?.id;
    });
    await delay(150);
    expect(waiterGotLock).toBe(false);

    release();
    expect(await holder).toBe('held');
    expect(await waiter).toBe('item_air_filter');
  });
});

describe('transaction operations', () => {
  it('locks and returns a resource, or undefined if it does not exist', async () => {
    const found = await store.withTransaction((tx) => tx.lockResource(WORKSPACE_ID, 'item_brake_pads'));
    expect(found).toMatchObject({ id: 'item_brake_pads', name: 'Brake Pads', version: 1 });
    expect(await store.withTransaction((tx) => tx.lockResource(WORKSPACE_ID, 'item_nope'))).toBeUndefined();
  });

  it('records an event and finds it again by command id', async () => {
    const inserted = await store.withTransaction((tx) => tx.insertEvent(newEvent()));
    expect(inserted).toMatchObject({
      commandId: 'cmd-1',
      resourceId: 'item_air_filter',
      resourceName: 'Air Filter',
      operation: 'ADJUST_QUANTITY',
      arguments: { delta: 20 },
      before: { quantity: 35 },
      after: { quantity: 55 },
      actor: 'manager-1',
      source: 'mcp',
      clientName: 'test-client',
      reversalOf: null,
    });
    expect(inserted.seq).toBeGreaterThan(0);

    const found = await store.withTransaction((tx) => tx.findEventByCommandId(WORKSPACE_ID, 'cmd-1'));
    expect(found).toEqual(inserted);
    expect(await store.withTransaction((tx) => tx.findEventByCommandId(WORKSPACE_ID, 'other'))).toBeUndefined();
  });

  it('refuses a second event with the same command id', async () => {
    await store.withTransaction((tx) => tx.insertEvent(newEvent()));
    await expect(store.withTransaction((tx) => tx.insertEvent(newEvent({ resourceId: 'item_oil_filter' })))).rejects.toBeInstanceOf(
      DuplicateCommandError,
    );
  });

  it('lets other database errors through untouched', async () => {
    await expect(store.withTransaction((tx) => tx.insertEvent(newEvent({ resourceId: 'item_nope' })))).rejects.toThrow(
      /foreign key/,
    );
  });

  it('updates attributes, bumping the version, but only from the expected version', async () => {
    const attributes = { quantity: 1, unit: 'pieces', reorderLevel: 10 };
    const updated = await store.withTransaction((tx) =>
      tx.updateResourceAttributes(WORKSPACE_ID, 'item_air_filter', attributes, 1),
    );
    expect(updated).toMatchObject({ version: 2, attributes });

    await expect(
      store.withTransaction((tx) => tx.updateResourceAttributes(WORKSPACE_ID, 'item_air_filter', attributes, 1)),
    ).rejects.toBeInstanceOf(VersionConflictError);
    await expect(
      store.withTransaction((tx) => tx.updateResourceAttributes(WORKSPACE_ID, 'item_nope', attributes, 1)),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('bumps the board version on every call and refuses an unknown workspace', async () => {
    expect(await store.withTransaction((tx) => tx.bumpBoardVersion(WORKSPACE_ID))).toBe(1);
    expect(await store.withTransaction((tx) => tx.bumpBoardVersion(WORKSPACE_ID))).toBe(2);
    await expect(store.withTransaction((tx) => tx.bumpBoardVersion('no-such-workspace'))).rejects.toBeInstanceOf(
      WorkspaceNotFoundError,
    );
  });

  it('queues a sync job and reports its status', async () => {
    const status = await store.withTransaction(async (tx) => {
      const event = await tx.insertEvent(newEvent());
      expect(await tx.getSyncStatus(event.eventId, 'sheets')).toBeUndefined();
      await tx.enqueueSync(WORKSPACE_ID, event.eventId, 'sheets');
      return tx.getSyncStatus(event.eventId, 'sheets');
    });
    expect(status).toBe('pending');
  });

  it('allows only one sync job per event and destination', async () => {
    await expect(
      store.withTransaction(async (tx) => {
        const event = await tx.insertEvent(newEvent());
        await tx.enqueueSync(WORKSPACE_ID, event.eventId, 'sheets');
        await tx.enqueueSync(WORKSPACE_ID, event.eventId, 'sheets');
      }),
    ).rejects.toThrow(/duplicate key/);
  });
});

describe('listEvents', () => {
  it('returns events newest first, honouring limit and resource filter, with sync state', async () => {
    await store.withTransaction(async (tx) => {
      await tx.insertEvent(newEvent({ commandId: 'a' }));
      const second = await tx.insertEvent(newEvent({ commandId: 'b', resourceId: 'item_oil_filter', summary: 'second' }));
      await tx.insertEvent(newEvent({ commandId: 'c', summary: 'third' }));
      await tx.enqueueSync(WORKSPACE_ID, second.eventId, 'sheets');
    });

    const all = await store.listEvents(WORKSPACE_ID, { limit: 10 });
    expect(all.map((event) => event.commandId)).toEqual(['c', 'b', 'a']);
    expect(all.map((event) => event.sync)).toEqual(['not_configured', 'pending', 'not_configured']);

    expect((await store.listEvents(WORKSPACE_ID, { limit: 2 })).map((event) => event.commandId)).toEqual(['c', 'b']);
    expect(
      (await store.listEvents(WORKSPACE_ID, { limit: 10, resourceId: 'item_oil_filter' })).map((e) => e.commandId),
    ).toEqual(['b']);
    expect(await store.listEvents('no-such-workspace', { limit: 10 })).toEqual([]);
  });
});
