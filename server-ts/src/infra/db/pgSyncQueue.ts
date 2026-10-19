import type { Pool, PoolClient } from 'pg';

import type { ClaimedJob, LockedSyncQueue, SyncQueue } from '../../app/syncPorts.js';

// First half of the two-part advisory-lock key; the second half is a hash of the workspace id.
// (The migrator uses the one-argument form with a different constant, so the keys cannot collide.)
const SYNC_LOCK_NAMESPACE = 727_275;

/** A job is due when it is waiting and its time has come, or when a worker took it and then went quiet. */
const due = (nowParam: string, abandonedBeforeParam: string): string =>
  `((status IN ('pending', 'retrying') AND next_attempt_at <= ${nowParam})
    OR (status = 'in_progress' AND updated_at < ${abandonedBeforeParam}))`;

interface ClaimRow {
  id: string;
  workspace_id: string;
  event_id: string;
  attempts: number;
  spreadsheet_id: string | null;
}

function createLockedQueue(client: PoolClient, workspaceId: string): LockedSyncQueue {
  return {
    async claimDue(now, leaseMs) {
      const result = await client.query<ClaimRow>(
        `UPDATE sync_jobs
            SET status = 'in_progress', attempts = attempts + 1, updated_at = $2
          WHERE workspace_id = $1 AND destination = 'sheets' AND ${due('$2', '$3')}
          RETURNING id, workspace_id, event_id, attempts,
                    (SELECT integrations -> 'sheets' ->> 'spreadsheetId'
                       FROM workspaces w WHERE w.id = sync_jobs.workspace_id) AS spreadsheet_id`,
        // $2 is "now" and also the start of the new lease; $3 is the moment before which an in-progress job is abandoned
        [workspaceId, now, new Date(now.getTime() - leaseMs)],
      );
      const [first] = result.rows;
      if (!first) {
        return undefined;
      }
      const jobs: ClaimedJob[] = result.rows
        .map((row) => ({
          id: Number(row.id),
          workspaceId: row.workspace_id,
          eventId: row.event_id,
          attempts: row.attempts,
        }))
        .sort((a, b) => a.id - b.id);
      return { jobs, spreadsheetId: first.spreadsheet_id };
    },

    async markSynced(jobIds) {
      await client.query(
        `UPDATE sync_jobs SET status = 'synced', last_error = NULL, updated_at = now() WHERE id = ANY($1::bigint[])`,
        [jobIds],
      );
    },

    async markRetrying(jobIds, error, nextAttemptAt) {
      await client.query(
        `UPDATE sync_jobs
            SET status = 'retrying', last_error = $2, next_attempt_at = $3, updated_at = now()
          WHERE id = ANY($1::bigint[])`,
        [jobIds, error, nextAttemptAt],
      );
    },

    async markFailed(jobIds, error) {
      await client.query(
        `UPDATE sync_jobs SET status = 'failed', last_error = $2, updated_at = now() WHERE id = ANY($1::bigint[])`,
        [jobIds, error],
      );
    },
  };
}

export function createPgSyncQueue(pool: Pool): SyncQueue {
  return {
    async peekDueWorkspace(now, leaseMs) {
      const result = await pool.query<{ workspace_id: string }>(
        `SELECT workspace_id FROM sync_jobs
          WHERE destination = 'sheets' AND ${due('$1', '$2')}
          ORDER BY id
          LIMIT 1`,
        [now, new Date(now.getTime() - leaseMs)],
      );
      return result.rows[0]?.workspace_id;
    },

    async withWorkspaceLock(workspaceId, work) {
      const client = await pool.connect();
      try {
        // A session-level lock: held on this connection until released, and dropped by Postgres if the connection dies.
        const lock = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked', [
          SYNC_LOCK_NAMESPACE,
          workspaceId,
        ]);
        if (!lock.rows.some((row) => row.locked)) {
          return undefined;
        }
        try {
          return await work(createLockedQueue(client, workspaceId));
        } finally {
          await client.query('SELECT pg_advisory_unlock($1, hashtext($2))', [SYNC_LOCK_NAMESPACE, workspaceId]);
        }
      } finally {
        client.release();
      }
    },
  };
}
