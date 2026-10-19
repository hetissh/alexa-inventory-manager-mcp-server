import { setTimeout as pause } from 'node:timers/promises';

import { errorMessage } from '../errorMessage.js';
import { SheetsError } from './errors.js';
import type { AppLogger, Store } from './ports.js';
import { activityRow, resourceRows } from './sheetRows.js';
import type { SheetsGateway, SyncQueue } from './syncPorts.js';

export interface SyncWorkerOptions {
  /** How long a job may stay "in progress" before another worker may take it (the first worker probably died). */
  readonly leaseMs: number;
  /** After this many failed attempts a job is marked failed and stops retrying (until someone requeues it). */
  readonly maxAttempts: number;
  /** First retry waits this long; each further retry doubles it, up to `maxDelayMs`. */
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** How often to look for work when there is none. */
  readonly pollMs: number;
}

export const DEFAULT_SYNC_OPTIONS: SyncWorkerOptions = {
  leaseMs: 60_000,
  maxAttempts: 8,
  baseDelayMs: 2_000,
  maxDelayMs: 60_000,
  pollMs: 1_000,
};

export interface SyncWorkerDeps {
  readonly store: Store;
  readonly queue: SyncQueue;
  readonly gateway: SheetsGateway;
  readonly logger: AppLogger;
  readonly now?: () => Date;
  readonly options?: Partial<SyncWorkerOptions>;
}

export type RunResult =
  /** Nothing was due. */
  | 'idle'
  /** Work was due but another worker is already doing that workspace. */
  | 'busy'
  | 'processed';

export interface SyncWorker {
  /** Handles one workspace's worth of due jobs, if any. */
  runOnce(): Promise<RunResult>;
  /** Keeps calling runOnce until `signal` aborts. Never throws: a failed cycle is logged and tried again. */
  run(signal: AbortSignal): Promise<void>;
}

export const NOT_CONFIGURED_MESSAGE = 'No spreadsheet is configured for this workspace any more.';
const MAX_ERROR_LENGTH = 500;

/** Prepares the spreadsheet's tabs and makes the Resources tab match the workspace's current state. */
export async function writeSnapshot(
  store: Store,
  gateway: SheetsGateway,
  workspaceId: string,
  spreadsheetId: string,
): Promise<void> {
  await gateway.prepare(spreadsheetId);
  await gateway.replaceResources(spreadsheetId, resourceRows(await store.listResources(workspaceId)));
}

export function createSyncWorker(deps: SyncWorkerDeps): SyncWorker {
  const { store, queue, gateway, logger } = deps;
  const options = { ...DEFAULT_SYNC_OPTIONS, ...deps.options };
  const now = deps.now ?? ((): Date => new Date());

  const backoffMs = (attempts: number): number =>
    Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** (attempts - 1));

  const worker: SyncWorker = {
    async runOnce() {
      const workspaceId = await queue.peekDueWorkspace(now(), options.leaseMs);
      if (workspaceId === undefined) {
        return 'idle';
      }
      const result = await queue.withWorkspaceLock(workspaceId, async (locked) => {
        const claim = await locked.claimDue(now(), options.leaseMs);
        if (!claim) {
          return 'idle' as const; // another worker finished this workspace between our peek and our lock
        }
        const ids = claim.jobs.map((job) => job.id);
        try {
          if (claim.spreadsheetId === null) {
            await locked.markFailed(ids, NOT_CONFIGURED_MESSAGE);
            logger.warn({ workspaceId, jobs: ids.length }, 'spreadsheet sync failed: no spreadsheet configured');
            return 'processed' as const;
          }
          // Read the workspace's state only now that we hold the lock, so a later writer always writes later state.
          const events = await store.listEventsByIds(
            workspaceId,
            claim.jobs.map((job) => job.eventId),
          );
          await writeSnapshot(store, gateway, workspaceId, claim.spreadsheetId);
          const existing = await gateway.listActivityEventIds(claim.spreadsheetId);
          const fresh = events.filter((event) => !existing.has(event.eventId));
          if (fresh.length > 0) {
            await gateway.appendActivity(claim.spreadsheetId, fresh.map(activityRow));
          }
          await locked.markSynced(ids);
          logger.info({ workspaceId, jobs: ids.length, appended: fresh.length }, 'spreadsheet synced');
        } catch (error) {
          const attempts = Math.max(...claim.jobs.map((job) => job.attempts));
          const message = errorMessage(error).slice(0, MAX_ERROR_LENGTH);
          // Anything that is not a classified SheetsError (network trouble, a dropped connection) is worth retrying.
          const retryable = error instanceof SheetsError ? error.retryable : true;
          if (retryable && attempts < options.maxAttempts) {
            const delay = backoffMs(attempts);
            await locked.markRetrying(ids, message, new Date(now().getTime() + delay));
            logger.warn({ workspaceId, jobs: ids.length, attempts, retryInMs: delay, error: message }, 'spreadsheet sync failed, will retry');
          } else {
            await locked.markFailed(ids, message);
            logger.warn({ workspaceId, jobs: ids.length, attempts, error: message }, 'spreadsheet sync failed, giving up');
          }
        }
        return 'processed' as const;
      });
      return result ?? 'busy';
    },

    async run(signal) {
      while (!signal.aborted) {
        let result: RunResult | undefined;
        try {
          result = await worker.runOnce();
        } catch (error) {
          logger.warn({ err: error }, 'sync cycle failed; trying again shortly');
        }
        if (result !== 'processed') {
          // An aborted wait rejects: that just means it is time to stop.
          await pause(options.pollMs, undefined, { signal }).catch(() => undefined);
        }
      }
    },
  };
  return worker;
}
