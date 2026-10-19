import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { ensureDatabase } from '../../src/infra/db/admin.js';
import { startWorker, type WorkerDeps } from '../../src/worker/main.js';
import { TEST_DATABASE_URL, withTempDatabase } from '../helpers/db.js';
import { useCommandHarness } from '../helpers/service.js';
import { connectSheets, FakeSheetsGateway, jobs, queueJob } from '../helpers/sync.js';

const harness = useCommandHarness();

function setup(env: NodeJS.ProcessEnv = {}): { deps: WorkerDeps; proc: EventEmitter; gateway: FakeSheetsGateway; logs: Record<string, unknown>[] } {
  const proc = new EventEmitter();
  const gateway = new FakeSheetsGateway();
  const logs: Record<string, unknown>[] = [];
  return {
    proc,
    gateway,
    logs,
    deps: {
      env: { DATABASE_URL: TEST_DATABASE_URL, VOICEOPS_SYNC_POLL_MS: '100', ...env },
      logDestination: { write: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>) },
      proc,
      gateway,
    },
  };
}

describe('the sync worker process', () => {
  it('copies queued changes to the spreadsheet, and stops cleanly on SIGTERM', async () => {
    const h = harness();
    await connectSheets(h.pool);
    await queueJob(h.store);
    const { deps, proc, gateway, logs } = setup();

    const worker = await startWorker(deps);
    expect(logs).toContainEqual(expect.objectContaining({ msg: 'voiceops spreadsheet sync worker ready', pollMs: 100 }));
    await vi.waitFor(async () => {
      expect((await jobs(h.pool)).map((job) => job.status)).toEqual(['synced']);
    });
    proc.emit('SIGTERM');
    await worker.finished;

    expect(gateway.activity).toHaveLength(1);
    expect(logs).toContainEqual(expect.objectContaining({ msg: 'stopping the sync worker', reason: 'SIGTERM' }));
    expect(proc.listenerCount('SIGINT')).toBe(0);
    expect(proc.listenerCount('SIGTERM')).toBe(0);
  });

  it('can be asked to stop more than once, and says so once', async () => {
    const { deps, logs } = setup();
    const worker = await startWorker(deps);

    worker.stop('first');
    worker.stop('second');
    await worker.finished;

    expect(logs.filter((line) => line['msg'] === 'stopping the sync worker')).toEqual([
      expect.objectContaining({ reason: 'first' }),
    ]);
  });

  it('refuses an invalid configuration', async () => {
    await expect(startWorker(setup({ VOICEOPS_SYNC_POLL_MS: '5' }).deps)).rejects.toThrow(/Invalid configuration/);
  });

  it('says where it could not connect', async () => {
    await expect(startWorker(setup({ DATABASE_URL: 'postgresql://localhost:1/voiceops_test' }).deps)).rejects.toThrow(
      /Cannot connect to the database at localhost:1\/voiceops_test/,
    );
  });

  it('refuses a database whose schema is behind, and says how to fix it', async () => {
    await withTempDatabase(async (url) => {
      await ensureDatabase(url);
      await expect(startWorker(setup({ DATABASE_URL: url }).deps)).rejects.toThrow(/schema is out of date.*db:setup/);
    });
  });
});
