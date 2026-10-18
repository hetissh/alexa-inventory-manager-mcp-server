import { setTimeout as delay } from 'node:timers/promises';

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  AlreadyReversedError,
  DuplicateCommandError,
  VersionConflictError,
  WorkspaceNotFoundError,
} from '../../src/app/errors.js';
import type { NewAlert, NewCommand, NewEvent, Store } from '../../src/app/ports.js';
import { createPgStore } from '../../src/infra/db/pgStore.js';
import { createTestPool, resetAll, WORKSPACE_ID } from '../helpers/db.js';

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
  await resetAll(pool);
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
  reversalOf: null,
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

describe('reversal uniqueness', () => {
  it('lets an event be undone only once', async () => {
    const original = await store.withTransaction((tx) => tx.insertEvent(newEvent({ commandId: 'orig' })));
    await store.withTransaction((tx) =>
      tx.insertEvent(newEvent({ commandId: 'undo-1', reversalOf: original.eventId, operation: 'REVERSE_EVENT' })),
    );

    await expect(
      store.withTransaction((tx) =>
        tx.insertEvent(newEvent({ commandId: 'undo-2', reversalOf: original.eventId, operation: 'REVERSE_EVENT' })),
      ),
    ).rejects.toBeInstanceOf(AlreadyReversedError);
  });

  it('finds the actor\'s newest event that is neither an undo nor already undone', async () => {
    const first = await store.withTransaction((tx) => tx.insertEvent(newEvent({ commandId: 'a' })));
    const second = await store.withTransaction((tx) => tx.insertEvent(newEvent({ commandId: 'b', summary: 'second' })));
    await store.withTransaction((tx) => tx.insertEvent(newEvent({ commandId: 'c', actor: 'someone-else' })));

    expect((await store.findLastReversibleEvent(WORKSPACE_ID, 'manager-1'))?.eventId).toBe(second.eventId);

    await store.withTransaction((tx) =>
      tx.insertEvent(newEvent({ commandId: 'undo-b', reversalOf: second.eventId, operation: 'REVERSE_EVENT' })),
    );
    expect((await store.findLastReversibleEvent(WORKSPACE_ID, 'manager-1'))?.eventId).toBe(first.eventId);

    await store.withTransaction((tx) =>
      tx.insertEvent(newEvent({ commandId: 'undo-a', reversalOf: first.eventId, operation: 'REVERSE_EVENT' })),
    );
    expect(await store.findLastReversibleEvent(WORKSPACE_ID, 'manager-1')).toBeUndefined();
    expect(await store.findLastReversibleEvent('no-such-workspace', 'manager-1')).toBeUndefined();
  });

  it('reads one event by id', async () => {
    const inserted = await store.withTransaction((tx) => tx.insertEvent(newEvent()));
    expect(await store.getEvent(WORKSPACE_ID, inserted.eventId)).toEqual(inserted);
    expect(await store.getEvent(WORKSPACE_ID, '0b7c3f5e-6d0a-4f0e-9a52-1b2d3c4e5f60')).toBeUndefined();
  });
});

describe('pending changes', () => {
  const pending = (overrides: Partial<NewCommand> = {}): NewCommand => ({
    workspaceId: WORKSPACE_ID,
    commandId: 'cmd-1',
    actor: 'manager-1',
    source: 'mcp',
    clientName: 'test-client',
    operation: 'SET_STATUS',
    resourceId: 'equipment_compressor_2',
    arguments: { status: 'maintenance' },
    secondaryResourceId: null,
    reversingEventId: null,
    expectedVersion: 1,
    reason: 'status_change',
    readback: 'Mark Compressor 2 as under maintenance?',
    tokenHash: 'a'.repeat(64),
    expiresAt: new Date('2026-10-19T09:02:00.000Z'),
    ...overrides,
  });

  it('stores a pending change, finds it by token hash only within its workspace, and locks it', async () => {
    await store.withTransaction((tx) => tx.insertCommand(pending()));

    const found = await store.findCommandByTokenHash(WORKSPACE_ID, 'a'.repeat(64));
    expect(found).toMatchObject({
      workspaceId: WORKSPACE_ID,
      commandId: 'cmd-1',
      actor: 'manager-1',
      operation: 'SET_STATUS',
      resourceId: 'equipment_compressor_2',
      arguments: { status: 'maintenance' },
      secondaryResourceId: null,
      reversingEventId: null,
      expectedVersion: 1,
      status: 'pending',
      eventId: null,
      expiresAt: new Date('2026-10-19T09:02:00.000Z'),
      resolvedAt: null,
    });
    expect(await store.findCommandByTokenHash('harbor-cafe', 'a'.repeat(64))).toBeUndefined();
    expect(await store.findCommandByTokenHash(WORKSPACE_ID, 'b'.repeat(64))).toBeUndefined();

    const locked = await store.withTransaction((tx) => tx.lockCommand(found?.id ?? ''));
    expect(locked.status).toBe('pending');
  });

  it('refuses to lock a pending change that does not exist', async () => {
    await expect(
      store.withTransaction((tx) => tx.lockCommand('0b7c3f5e-6d0a-4f0e-9a52-1b2d3c4e5f60')),
    ).rejects.toThrow(/does not exist/);
  });

  it('records how a pending change was settled', async () => {
    await store.withTransaction((tx) => tx.insertCommand(pending()));
    const found = await store.findCommandByTokenHash(WORKSPACE_ID, 'a'.repeat(64));

    const event = await store.withTransaction(async (tx) => {
      const inserted = await tx.insertEvent(newEvent());
      await tx.updateCommandStatus(found?.id ?? '', 'confirmed', inserted.eventId);
      return inserted;
    });

    expect(await store.findCommandByTokenHash(WORKSPACE_ID, 'a'.repeat(64))).toMatchObject({
      status: 'confirmed',
      eventId: event.eventId,
      resolvedAt: expect.any(Date) as Date,
    });
  });

  it('never stores two changes with the same token hash', async () => {
    await store.withTransaction((tx) => tx.insertCommand(pending()));
    await expect(store.withTransaction((tx) => tx.insertCommand(pending({ commandId: 'cmd-2' })))).rejects.toThrow(
      /duplicate key/,
    );
  });
});

describe('alerts', () => {
  const alert = (eventId: string): NewAlert => ({
    workspaceId: WORKSPACE_ID,
    resourceId: 'item_brake_pads',
    rule: 'low_stock',
    message: 'Brake Pads is low on stock.',
    eventId,
  });

  it('opens an alert once per resource and rule, resolves it, and can open a new one afterwards', async () => {
    const eventId = (await store.withTransaction((tx) => tx.insertEvent(newEvent({ resourceId: 'item_brake_pads' })))).eventId;

    const opened = await store.withTransaction((tx) => tx.openAlert(alert(eventId)));
    expect(opened).toMatchObject({ resourceId: 'item_brake_pads', resourceName: 'Brake Pads', rule: 'low_stock', status: 'open', resolvedAt: null });
    expect(await store.withTransaction((tx) => tx.openAlert(alert(eventId)))).toBeUndefined();

    const resolved = await store.withTransaction((tx) =>
      tx.resolveAlerts(WORKSPACE_ID, 'item_brake_pads', 'low_stock', eventId),
    );
    expect(resolved).toMatchObject([{ status: 'resolved', resolvedAt: expect.any(Date) as Date }]);
    expect(await store.withTransaction((tx) => tx.resolveAlerts(WORKSPACE_ID, 'item_brake_pads', 'low_stock', eventId))).toEqual([]);

    expect(await store.withTransaction((tx) => tx.openAlert(alert(eventId)))).toBeDefined();
  });

  it('lists alerts by status, newest first, within the limit', async () => {
    const eventId = (await store.withTransaction((tx) => tx.insertEvent(newEvent({ resourceId: 'item_brake_pads' })))).eventId;
    await store.withTransaction((tx) => tx.openAlert(alert(eventId)));
    await store.withTransaction((tx) => tx.resolveAlerts(WORKSPACE_ID, 'item_brake_pads', 'low_stock', eventId));
    await store.withTransaction((tx) => tx.openAlert(alert(eventId)));

    expect((await store.listAlerts(WORKSPACE_ID, { status: 'all', limit: 10 })).map((a) => a.status)).toEqual(['open', 'resolved']);
    expect((await store.listAlerts(WORKSPACE_ID, { status: 'open', limit: 10 })).map((a) => a.status)).toEqual(['open']);
    expect((await store.listAlerts(WORKSPACE_ID, { status: 'resolved', limit: 10 })).map((a) => a.status)).toEqual(['resolved']);
    expect(await store.listAlerts(WORKSPACE_ID, { status: 'all', limit: 1 })).toHaveLength(1);
    expect(await store.listAlerts('harbor-cafe', { status: 'all', limit: 10 })).toEqual([]);
  });
});

describe('board snapshot', () => {
  it('returns the workspace, its resources, open alerts and recent events together', async () => {
    const eventId = (await store.withTransaction((tx) => tx.insertEvent(newEvent({ resourceId: 'item_brake_pads' })))).eventId;
    await store.withTransaction(async (tx) => {
      await tx.openAlert({ workspaceId: WORKSPACE_ID, resourceId: 'item_brake_pads', rule: 'low_stock', message: 'low', eventId });
      await tx.bumpBoardVersion(WORKSPACE_ID);
    });

    const snapshot = await store.getBoardSnapshot(WORKSPACE_ID, 5);

    expect(snapshot?.workspace.boardVersion).toBe(1);
    expect(snapshot?.resources).toHaveLength(4);
    expect(snapshot?.openAlerts.map((a) => a.resourceId)).toEqual(['item_brake_pads']);
    expect(snapshot?.recentEvents.map((e) => e.eventId)).toEqual([eventId]);
  });

  it('is undefined for an unknown workspace', async () => {
    expect(await store.getBoardSnapshot('no-such-workspace', 5)).toBeUndefined();
  });
});
