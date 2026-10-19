import type { Store } from './ports.js';

export type RetryOutcome =
  | { readonly status: 'queued'; readonly spoken: string }
  | { readonly status: 'already_synced'; readonly spoken: string }
  | { readonly status: 'already_queued'; readonly spoken: string }
  | { readonly status: 'not_found'; readonly spoken: string };

export interface SyncService {
  /** Puts the spreadsheet update for one change back in the queue (only if it failed or is being retried). */
  retry(workspaceId: string, eventId: string): Promise<RetryOutcome>;
}

export function createSyncService(store: Store): SyncService {
  return {
    async retry(workspaceId, eventId) {
      const outcome = await store.requeueSync(workspaceId, eventId, 'sheets');
      if (outcome.result === 'requeued') {
        return { status: 'queued', spoken: 'Okay, that spreadsheet update will be tried again now.' };
      }
      if (outcome.result === 'missing') {
        return {
          status: 'not_found',
          spoken: 'There is no spreadsheet update for that change (no spreadsheet was connected when it was made).',
        };
      }
      return outcome.status === 'synced'
        ? { status: 'already_synced', spoken: 'That change is already in the spreadsheet.' }
        : { status: 'already_queued', spoken: 'That spreadsheet update is already waiting to run.' };
    },
  };
}
