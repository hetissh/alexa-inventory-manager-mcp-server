import { describe, expect, it } from 'vitest';

import { createPgSyncQueue } from '../../src/infra/db/pgSyncQueue.js';
import { CAFE_ID, WORKSPACE_ID } from '../helpers/db.js';
import { useCommandHarness } from '../helpers/service.js';
import { connectSheets, jobs, queueJob, realClock } from '../helpers/sync.js';

const harness = useCommandHarness();
const LEASE = 60_000;

describe('the sync queue in PostgreSQL', () => {
  it('has nothing due when nothing is queued', async () => {
    const queue = createPgSyncQueue(harness().pool);
    expect(await queue.peekDueWorkspace(new Date(), LEASE)).toBeUndefined();
  });

  it('offers the workspace of the oldest due job, and claims all of that workspace\'s due jobs together', async () => {
    const h = harness();
    await connectSheets(h.pool);
    const queue = createPgSyncQueue(h.pool);
    const first = await queueJob(h.store);
    const second = await queueJob(h.store, 'item_oil_filter');
    const now = new Date(Date.now() + 1000);

    expect(await queue.peekDueWorkspace(now, LEASE)).toBe(WORKSPACE_ID);

    const claim = await queue.withWorkspaceLock(WORKSPACE_ID, (locked) => locked.claimDue(now, LEASE));

    expect(claim?.spreadsheetId).toBe('spreadsheet-id-1234567890abcdef');
    expect(claim?.jobs.map((job) => [job.eventId, job.attempts, job.workspaceId])).toEqual([
      [first, 1, WORKSPACE_ID],
      [second, 1, WORKSPACE_ID],
    ]);
    expect((await jobs(h.pool)).map((job) => [job.status, job.attempts])).toEqual([
      ['in_progress', 1],
      ['in_progress', 1],
    ]);
    // claimed work is no longer on offer
    expect(await queue.peekDueWorkspace(now, LEASE)).toBeUndefined();
  });

  it('reports no spreadsheet when the workspace is not connected', async () => {
    const h = harness();
    const queue = createPgSyncQueue(h.pool);
    await queueJob(h.store);

    const claim = await queue.withWorkspaceLock(WORKSPACE_ID, (locked) => locked.claimDue(new Date(Date.now() + 1000), LEASE));

    expect(claim?.spreadsheetId).toBeNull();
  });

  it('claims nothing when nothing is due', async () => {
    const queue = createPgSyncQueue(harness().pool);
    expect(await queue.withWorkspaceLock(WORKSPACE_ID, (locked) => locked.claimDue(new Date(), LEASE))).toBeUndefined();
  });

  it('does not offer a job waiting for its retry time until that time comes', async () => {
    const h = harness();
    const queue = createPgSyncQueue(h.pool);
    const clock = realClock();
    await queueJob(h.store);
    await queue.withWorkspaceLock(WORKSPACE_ID, async (locked) => {
      const claim = await locked.claimDue(new Date(Date.now() + 1000), LEASE);
      await locked.markRetrying(claim?.jobs.map((job) => job.id) ?? [], 'try later', new Date(clock.current.getTime() + 10_000));
    });

    expect(await queue.peekDueWorkspace(new Date(clock.current.getTime() + 5_000), LEASE)).toBeUndefined();
    expect(await queue.peekDueWorkspace(new Date(clock.current.getTime() + 10_001), LEASE)).toBe(WORKSPACE_ID);
  });

  it('records outcomes: synced clears the error, retrying and failed keep it', async () => {
    const h = harness();
    const queue = createPgSyncQueue(h.pool);
    await queueJob(h.store);
    await queueJob(h.store);
    await queueJob(h.store);
    const ids = (await h.pool.query<{ id: string }>('SELECT id FROM sync_jobs ORDER BY id')).rows.map((row) => Number(row.id));
    const [a, b, c] = ids;

    await queue.withWorkspaceLock(WORKSPACE_ID, async (locked) => {
      await locked.markFailed([a ?? 0], 'denied');
      await locked.markRetrying([b ?? 0], 'busy', new Date('2030-01-01T00:00:00Z'));
      await locked.markSynced([c ?? 0]);
    });

    expect((await jobs(h.pool)).map((job) => [job.status, job.lastError])).toEqual([
      ['failed', 'denied'],
      ['retrying', 'busy'],
      ['synced', null],
    ]);
  });

  it('gives one worker at a time a workspace, but different workspaces at once', async () => {
    const queue = createPgSyncQueue(harness().pool);

    const outcomes: (string | undefined)[] = [];
    await queue.withWorkspaceLock(WORKSPACE_ID, async () => {
      outcomes.push(await queue.withWorkspaceLock(WORKSPACE_ID, () => Promise.resolve('same workspace')));
      outcomes.push(await queue.withWorkspaceLock(CAFE_ID, () => Promise.resolve('other workspace')));
    });
    outcomes.push(await queue.withWorkspaceLock(WORKSPACE_ID, () => Promise.resolve('after release')));

    expect(outcomes).toEqual([undefined, 'other workspace', 'after release']);
  });

  it('releases the lock even when the work throws', async () => {
    const queue = createPgSyncQueue(harness().pool);

    await expect(queue.withWorkspaceLock(WORKSPACE_ID, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');

    expect(await queue.withWorkspaceLock(WORKSPACE_ID, () => Promise.resolve('free'))).toBe('free');
  });
});
