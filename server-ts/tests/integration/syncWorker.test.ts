import { describe, expect, it, vi } from 'vitest';

import { SheetsError } from '../../src/app/errors.js';
import type { SyncQueue } from '../../src/app/syncPorts.js';
import {
  createSyncWorker,
  DEFAULT_SYNC_OPTIONS,
  NOT_CONFIGURED_MESSAGE,
  type SyncWorkerOptions,
  writeSnapshot,
} from '../../src/app/syncWorker.js';
import { createPgSyncQueue } from '../../src/infra/db/pgSyncQueue.js';
import { CAFE_ID, WORKSPACE_ID } from '../helpers/db.js';
import { adjust, type CommandHarness, setStatus, useCommandHarness } from '../helpers/service.js';
import { connectSheets, FakeSheetsGateway, jobs, queueJob, realClock, SPREADSHEET_ID } from '../helpers/sync.js';

const harness = useCommandHarness();

function build(options: Partial<SyncWorkerOptions> = {}, queueOverride?: (queue: SyncQueue) => SyncQueue) {
  const h = harness();
  const gateway = new FakeSheetsGateway();
  const clock = realClock();
  const queue = createPgSyncQueue(h.pool);
  const worker = createSyncWorker({
    store: h.store,
    queue: queueOverride ? queueOverride(queue) : queue,
    gateway,
    logger: h.logger,
    now: clock.now,
    options,
  });
  return { h, gateway, clock, queue, worker };
}

async function withSheets(): Promise<CommandHarness> {
  const h = harness();
  await connectSheets(h.pool);
  return h;
}

const retryable = (message: string): SheetsError => new SheetsError(message, true);
const permanent = (message: string): SheetsError => new SheetsError(message, false);

describe('copying changes to the spreadsheet', () => {
  it('writes the current state and the activity once for a whole burst of changes', async () => {
    const h = await withSheets();
    const { gateway, worker } = build();
    await adjust(h, 'air filters', 20);
    await adjust(h, 'brake pads', -10);

    expect(await worker.runOnce()).toBe('processed');

    expect(gateway.count('replaceResources')).toBe(1);
    expect(gateway.count('appendActivity')).toBe(1);
    const rows = Object.fromEntries(gateway.resources.map((row) => [String(row[0]), row]));
    expect(rows['item_air_filter']?.slice(2, 5)).toEqual(['Air Filter', 55, 'pieces']);
    expect(rows['item_brake_pads']?.slice(2, 5)).toEqual(['Brake Pads', 2, 'pieces']);
    expect(gateway.activity.map((row) => [row[3], row[4], row[5], row[6], row[7]])).toEqual([
      ['ADJUST_QUANTITY', 'Air Filter', '{"quantity":35}', '{"quantity":55}', 'synced'],
      ['ADJUST_QUANTITY', 'Brake Pads', '{"quantity":12}', '{"quantity":2}', 'synced'],
    ]);
    expect((await jobs(h.pool)).map((job) => [job.status, job.attempts, job.lastError])).toEqual([
      ['synced', 1, null],
      ['synced', 1, null],
    ]);
    expect(await worker.runOnce()).toBe('idle');
    expect(gateway.count('replaceResources')).toBe(1);
  });

  it('makes list-events and the board report the truth about each update', async () => {
    const h = await withSheets();
    const { worker } = build();
    await adjust(h, 'air filters', 5);

    const before = await h.store.listEvents(WORKSPACE_ID, { limit: 5 });
    expect(before.map((event) => [event.sync, event.syncError])).toEqual([['pending', null]]);

    await worker.runOnce();

    const after = await h.store.listEvents(WORKSPACE_ID, { limit: 5 });
    expect(after.map((event) => event.sync)).toEqual(['synced']);
  });

  it('syncs each workspace to its own spreadsheet, one workspace per run', async () => {
    const h = harness();
    await connectSheets(h.pool, WORKSPACE_ID, 'warehouse-sheet-1234567890abc');
    await connectSheets(h.pool, CAFE_ID, 'cafe-sheet-1234567890abcdef');
    const tokens = await setStatus(h, CAFE_ID, 'chicken biryani', 'sold out');
    expect(tokens.status).toBe('confirmation_required');
    await adjust(h, 'air filters', 1);
    const { gateway, worker } = build();

    expect(await worker.runOnce()).toBe('processed');
    expect(await worker.runOnce()).toBe('idle'); // the cafe change is still only waiting for a yes: no job yet

    expect(gateway.activity).toHaveLength(1);
    expect(gateway.activity[0]?.[4]).toBe('Air Filter');
  });

  it('does not repeat an activity row when a retry follows a lost acknowledgement', async () => {
    const h = await withSheets();
    const { gateway, clock, worker } = build();
    await adjust(h, 'air filters', 20);
    gateway.failAfterAppending = retryable('connection reset');

    expect(await worker.runOnce()).toBe('processed');
    expect(gateway.activity).toHaveLength(1);
    expect((await jobs(h.pool))[0]?.status).toBe('retrying');

    gateway.failAfterAppending = undefined;
    clock.advance(3);
    expect(await worker.runOnce()).toBe('processed');

    expect(gateway.activity).toHaveLength(1);
    expect((await jobs(h.pool))[0]).toMatchObject({ status: 'synced', attempts: 2, lastError: null });
  });
});

describe('when the spreadsheet cannot be written', () => {
  it('keeps the change, marks the update as retrying with the reason, and backs off', async () => {
    const h = await withSheets();
    const { gateway, clock, worker } = build();
    const event = await adjust(h, 'air filters', 20);
    expect(event.status).toBe('committed');
    gateway.failNext('replaceResources', retryable('Google is limiting requests'));

    expect(await worker.runOnce()).toBe('processed');

    const [job] = await jobs(h.pool);
    expect(job).toMatchObject({ status: 'retrying', attempts: 1, lastError: 'Google is limiting requests' });
    expect(job?.nextAttemptAt.getTime()).toBe(clock.current.getTime() + 2_000);
    const [listed] = await h.store.listEvents(WORKSPACE_ID, { limit: 1 });
    expect(listed).toMatchObject({ sync: 'retrying', syncError: 'Google is limiting requests' });
    expect(await h.store.getSyncBacklog(WORKSPACE_ID)).toEqual({ pending: 0, retrying: 1, failed: 0 });
    // the change itself is untouched
    expect((await h.store.listResources(WORKSPACE_ID)).find((r) => r.id === 'item_air_filter')?.attributes).toMatchObject({ quantity: 55 });
  });

  it('waits out the backoff, doubling it each time, then succeeds', async () => {
    const h = await withSheets();
    const { gateway, clock, worker } = build();
    await adjust(h, 'air filters', 20);
    gateway.failNext('appendActivity', retryable('first'), retryable('second'));

    await worker.runOnce();
    expect(await worker.runOnce()).toBe('idle'); // not due yet
    clock.advance(2);
    await worker.runOnce();
    const [second] = await jobs(h.pool);
    expect(second).toMatchObject({ status: 'retrying', attempts: 2, lastError: 'second' });
    expect(second?.nextAttemptAt.getTime()).toBe(clock.current.getTime() + 4_000);

    clock.advance(3);
    expect(await worker.runOnce()).toBe('idle'); // 3 s into a 4 s wait
    clock.advance(1);
    expect(await worker.runOnce()).toBe('processed');
    expect((await jobs(h.pool))[0]).toMatchObject({ status: 'synced', attempts: 3, lastError: null });
  });

  it('caps the backoff', async () => {
    const h = await withSheets();
    const { gateway, clock, worker } = build({ baseDelayMs: 10_000, maxDelayMs: 15_000, maxAttempts: 10 });
    await adjust(h, 'air filters', 20);
    gateway.failNext('prepare', retryable('x'), retryable('x'), retryable('x'));

    await worker.runOnce();
    clock.advance(10);
    await worker.runOnce();

    const [job] = await jobs(h.pool);
    expect(job?.nextAttemptAt.getTime()).toBe(clock.current.getTime() + 15_000);
  });

  it('gives up straight away on a problem a retry cannot fix', async () => {
    const h = await withSheets();
    const { gateway, worker } = build();
    await adjust(h, 'air filters', 20);
    gateway.failNext('prepare', permanent('Google denied access to the spreadsheet.'));

    await worker.runOnce();

    expect((await jobs(h.pool))[0]).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'Google denied access to the spreadsheet.',
    });
    expect(await worker.runOnce()).toBe('idle');
    expect(await h.store.getSyncBacklog(WORKSPACE_ID)).toEqual({ pending: 0, retrying: 0, failed: 1 });
  });

  it('gives up after the maximum number of attempts', async () => {
    const h = await withSheets();
    const { gateway, clock, worker } = build({ maxAttempts: 3 });
    await adjust(h, 'air filters', 20);
    gateway.failNext('prepare', retryable('down'), retryable('down'), retryable('down'));

    for (const expected of ['retrying', 'retrying', 'failed']) {
      await worker.runOnce();
      expect((await jobs(h.pool))[0]?.status).toBe(expected);
      clock.advance(60);
    }
    expect(await worker.runOnce()).toBe('idle');
  });

  it('treats an unclassified error (a dropped connection, say) as worth retrying', async () => {
    const h = await withSheets();
    const { gateway, worker } = build();
    await adjust(h, 'air filters', 20);
    gateway.failNext('listActivityEventIds', new Error('socket hang up'));

    await worker.runOnce();

    expect((await jobs(h.pool))[0]).toMatchObject({ status: 'retrying', lastError: 'socket hang up' });
  });

  it('stores only the start of a very long error message', async () => {
    const h = await withSheets();
    const { gateway, worker } = build();
    await adjust(h, 'air filters', 20);
    gateway.failNext('prepare', retryable('x'.repeat(2_000)));

    await worker.runOnce();

    expect((await jobs(h.pool))[0]?.lastError).toHaveLength(500);
  });

  it('fails the update if the workspace was disconnected from its spreadsheet in the meantime', async () => {
    const h = await withSheets();
    const { gateway, worker } = build();
    await adjust(h, 'air filters', 20);
    await h.pool.query(`UPDATE workspaces SET integrations = '{}'::jsonb WHERE id = $1`, [WORKSPACE_ID]);

    expect(await worker.runOnce()).toBe('processed');

    expect((await jobs(h.pool))[0]).toMatchObject({ status: 'failed', lastError: NOT_CONFIGURED_MESSAGE });
    expect(gateway.calls).toEqual([]);
  });

  it('can be put back in the queue after it failed, and then succeeds', async () => {
    const h = await withSheets();
    const { gateway, worker } = build();
    await adjust(h, 'air filters', 20);
    gateway.failNext('prepare', permanent('not shared yet'));
    await worker.runOnce();
    const [failed] = await jobs(h.pool);

    expect(await h.store.requeueSync(WORKSPACE_ID, failed?.eventId ?? '', 'sheets')).toEqual({ result: 'requeued' });
    expect(await worker.runOnce()).toBe('processed');

    expect((await jobs(h.pool))[0]).toMatchObject({ status: 'synced', attempts: 1, lastError: null });
    expect(gateway.activity).toHaveLength(1);
  });
});

describe('several workers, and workers that die', () => {
  it('lets only one worker write a workspace at a time', async () => {
    const h = await withSheets();
    const { gateway, queue, worker } = build();
    await queueJob(h.store);

    const results: string[] = [];
    await queue.withWorkspaceLock(WORKSPACE_ID, async () => {
      results.push(await worker.runOnce()); // someone else holds the workspace
    });
    results.push(await worker.runOnce());

    expect(results).toEqual(['busy', 'processed']);
    expect(gateway.activity).toHaveLength(1);
  });

  it('writes every change exactly once and ends on the latest state when two workers race', async () => {
    const h = await withSheets();
    const a = build();
    const b = build();
    await adjust(h, 'air filters', 1);
    await adjust(h, 'air filters', 1);
    await adjust(h, 'air filters', 1);

    const results = await Promise.all([a.worker.runOnce(), b.worker.runOnce()]);

    expect(results).toContain('processed');
    const rows = [...a.gateway.activity, ...b.gateway.activity];
    expect(new Set(rows.map((row) => row[0])).size).toBe(3);
    expect(rows).toHaveLength(3);
    expect((await jobs(h.pool)).map((job) => job.status)).toEqual(['synced', 'synced', 'synced']);
  });

  it('takes over a job whose worker died mid-way, once its lease has run out', async () => {
    const h = await withSheets();
    const { gateway, clock, worker } = build({ leaseMs: 30_000 });
    await queueJob(h.store);
    await h.pool.query(`UPDATE sync_jobs SET status = 'in_progress', attempts = 1, updated_at = $1`, [clock.current]);

    expect(await worker.runOnce()).toBe('idle'); // lease still running: the first worker may be alive
    clock.advance(31);
    expect(await worker.runOnce()).toBe('processed');

    expect((await jobs(h.pool))[0]).toMatchObject({ status: 'synced', attempts: 2 });
    expect(gateway.activity).toHaveLength(1);
  });

  it('carries on when another worker finished the workspace between looking and locking', async () => {
    const h = await withSheets();
    const { worker } = build({}, (queue) => ({ ...queue, peekDueWorkspace: () => Promise.resolve(WORKSPACE_ID) }));
    expect(h).toBeDefined();

    expect(await worker.runOnce()).toBe('idle');
  });
});

describe('the polling loop', () => {
  it('syncs what arrives, waits when idle, and stops when asked', async () => {
    const h = await withSheets();
    const { worker } = build({ pollMs: 20 });
    const controller = new AbortController();
    const running = worker.run(controller.signal);

    await adjust(h, 'air filters', 20);
    await vi.waitFor(async () => {
      expect((await jobs(h.pool)).map((job) => job.status)).toEqual(['synced']);
    });
    controller.abort();
    await running;
  });

  it('survives a failing cycle and tries again', async () => {
    const h = harness();
    const warn = vi.fn();
    const failing = vi.fn<SyncQueue['peekDueWorkspace']>().mockRejectedValue(new Error('database restarting'));
    const worker = createSyncWorker({
      store: h.store,
      queue: { ...createPgSyncQueue(h.pool), peekDueWorkspace: failing },
      gateway: new FakeSheetsGateway(),
      logger: { info: vi.fn(), warn },
      options: { pollMs: 10 },
    });
    const controller = new AbortController();
    const running = worker.run(controller.signal);

    await vi.waitFor(() => {
      expect(failing.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    controller.abort();
    await running;
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) as Error }), 'sync cycle failed; trying again shortly');
  });

  it('does not start when already told to stop', async () => {
    const { worker, gateway } = build();
    await worker.run(AbortSignal.abort());
    expect(gateway.calls).toEqual([]);
  });

  it('has sensible defaults', () => {
    expect(DEFAULT_SYNC_OPTIONS).toEqual({ leaseMs: 60_000, maxAttempts: 8, baseDelayMs: 2_000, maxDelayMs: 60_000, pollMs: 1_000 });
  });
});

describe('writeSnapshot', () => {
  it('prepares the sheet and writes every resource of the workspace', async () => {
    const h = harness();
    const gateway = new FakeSheetsGateway();

    await writeSnapshot(h.store, gateway, WORKSPACE_ID, SPREADSHEET_ID);

    expect(gateway.calls).toEqual(['prepare', 'replaceResources']);
    expect(gateway.resources.map((row) => row[0])).toEqual([
      'equipment_compressor_2',
      'item_air_filter',
      'item_brake_pads',
      'item_oil_filter',
    ]);
  });
});
