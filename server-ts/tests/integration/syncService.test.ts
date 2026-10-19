import { describe, expect, it } from 'vitest';

import { createSyncService } from '../../src/app/syncService.js';
import { createPgSyncQueue } from '../../src/infra/db/pgSyncQueue.js';
import { WORKSPACE_ID } from '../helpers/db.js';
import { useCommandHarness } from '../helpers/service.js';
import { connectSheets, jobs, queueJob } from '../helpers/sync.js';

const harness = useCommandHarness();

async function failJob(status: 'failed' | 'retrying'): Promise<string> {
  const h = harness();
  await connectSheets(h.pool);
  const eventId = await queueJob(h.store);
  await h.pool.query(`UPDATE sync_jobs SET status = $1, attempts = 5, last_error = 'denied', next_attempt_at = now() + interval '1 hour'`, [status]);
  return eventId;
}

describe('retrying a spreadsheet update', () => {
  it.each(['failed', 'retrying'] as const)('puts a %s update back in the queue, due now, with its history cleared', async (status) => {
    const eventId = await failJob(status);
    const service = createSyncService(harness().store);

    expect(await service.retry(WORKSPACE_ID, eventId)).toEqual({
      status: 'queued',
      spoken: 'Okay, that spreadsheet update will be tried again now.',
    });

    const [job] = await jobs(harness().pool);
    expect(job).toMatchObject({ status: 'pending', attempts: 0, lastError: null });
    expect(job?.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(await createPgSyncQueue(harness().pool).peekDueWorkspace(new Date(Date.now() + 1000), 60_000)).toBe(WORKSPACE_ID);
  });

  it('says so when the update already went through, or is already waiting', async () => {
    const h = harness();
    await connectSheets(h.pool);
    const eventId = await queueJob(h.store);
    const service = createSyncService(h.store);

    expect(await service.retry(WORKSPACE_ID, eventId)).toMatchObject({ status: 'already_queued' });
    await h.pool.query(`UPDATE sync_jobs SET status = 'synced'`);
    expect(await service.retry(WORKSPACE_ID, eventId)).toEqual({
      status: 'already_synced',
      spoken: 'That change is already in the spreadsheet.',
    });
    expect((await jobs(h.pool))[0]?.status).toBe('synced');
  });

  it('says so when there is no such update, in this workspace', async () => {
    const h = harness();
    await connectSheets(h.pool);
    const eventId = await queueJob(h.store);
    const service = createSyncService(h.store);

    expect(await service.retry(WORKSPACE_ID, '0b7c3f5e-6d0a-4f0e-9a52-1b2d3c4e5f60')).toMatchObject({ status: 'not_found' });
    expect(await service.retry('harbor-cafe', eventId)).toMatchObject({ status: 'not_found' });
  });
});
