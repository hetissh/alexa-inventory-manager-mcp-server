import type { Pool } from 'pg';

import type { Store } from '../../src/app/ports.js';
import type { SheetRow, SheetsGateway } from '../../src/app/syncPorts.js';
import type { SyncStatus } from '../../src/domain/types.js';
import { WORKSPACE_ID } from './db.js';

export const SPREADSHEET_ID = 'spreadsheet-id-1234567890abcdef';

/** Connects a workspace to a (fake) spreadsheet, as `sheets connect` would. */
export async function connectSheets(pool: Pool, workspaceId: string = WORKSPACE_ID, spreadsheetId = SPREADSHEET_ID): Promise<void> {
  await pool.query(`UPDATE workspaces SET integrations = jsonb_build_object('sheets', jsonb_build_object('spreadsheetId', $2::text)) WHERE id = $1`, [
    workspaceId,
    spreadsheetId,
  ]);
}

let counter = 0;

/** Records an event and queues its spreadsheet job in one transaction, without going through a command. */
export async function queueJob(
  store: Store,
  resourceId = 'item_air_filter',
  workspaceId: string = WORKSPACE_ID,
): Promise<string> {
  counter += 1;
  return store.withTransaction(async (tx) => {
    const event = await tx.insertEvent({
      workspaceId,
      commandId: `queued-${String(counter)}`,
      resourceId,
      operation: 'ADJUST_QUANTITY',
      arguments: { delta: 1 },
      before: { quantity: 1 },
      after: { quantity: 2 },
      summary: `Queued change ${String(counter)}`,
      actor: 'manager-1',
      source: 'mcp',
      clientName: null,
      reversalOf: null,
    });
    await tx.enqueueSync(workspaceId, event.eventId, 'sheets');
    return event.eventId;
  });
}

export interface JobRow {
  readonly eventId: string;
  readonly status: SyncStatus;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly nextAttemptAt: Date;
}

export async function jobs(pool: Pool): Promise<JobRow[]> {
  const result = await pool.query<{
    event_id: string;
    status: SyncStatus;
    attempts: number;
    last_error: string | null;
    next_attempt_at: Date;
  }>('SELECT event_id, status, attempts, last_error, next_attempt_at FROM sync_jobs ORDER BY id');
  return result.rows.map((row) => ({
    eventId: row.event_id,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    nextAttemptAt: row.next_attempt_at,
  }));
}

type GatewayMethod = 'prepare' | 'replaceResources' | 'listActivityEventIds' | 'appendActivity';

/** An in-memory spreadsheet that can be told to fail, so sync behaviour can be tested without Google. */
export class FakeSheetsGateway implements SheetsGateway {
  readonly calls: string[] = [];
  resources: readonly SheetRow[] = [];
  activity: SheetRow[] = [];
  private readonly failures = new Map<GatewayMethod, Error[]>();
  /** When set, appendActivity stores the rows and then fails (the acknowledgement was lost). */
  failAfterAppending: Error | undefined;

  /** The next calls to `method` throw these errors, one each, in order. */
  failNext(method: GatewayMethod, ...errors: Error[]): void {
    this.failures.set(method, [...(this.failures.get(method) ?? []), ...errors]);
  }

  private enter(method: GatewayMethod): void {
    this.calls.push(method);
    const error = this.failures.get(method)?.shift();
    if (error) {
      throw error;
    }
  }

  prepare(): Promise<void> {
    this.enter('prepare');
    return Promise.resolve();
  }

  replaceResources(_spreadsheetId: string, rows: readonly SheetRow[]): Promise<void> {
    this.enter('replaceResources');
    this.resources = rows;
    return Promise.resolve();
  }

  listActivityEventIds(): Promise<ReadonlySet<string>> {
    this.enter('listActivityEventIds');
    return Promise.resolve(new Set(this.activity.map((row) => String(row[0]))));
  }

  appendActivity(_spreadsheetId: string, rows: readonly SheetRow[]): Promise<void> {
    this.enter('appendActivity');
    this.activity.push(...rows);
    if (this.failAfterAppending) {
      return Promise.reject(this.failAfterAppending);
    }
    return Promise.resolve();
  }

  count(method: GatewayMethod): number {
    return this.calls.filter((call) => call === method).length;
  }
}

/**
 * A clock for worker tests. The database stamps jobs with its own real clock, so this one starts a minute ahead of it
 * (jobs created during a test are already due) and then moves only when told.
 */
export function realClock(): { current: Date; advance(seconds: number): void; now: () => Date } {
  const clock = {
    current: new Date(Date.now() + 60_000),
    advance(seconds: number): void {
      clock.current = new Date(clock.current.getTime() + seconds * 1000);
    },
    now: (): Date => clock.current,
  };
  return clock;
}
