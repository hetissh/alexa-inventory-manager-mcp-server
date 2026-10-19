// What the spreadsheet sync needs from the outside world: somewhere to write rows, and a queue of jobs.

export type SheetCell = string | number | boolean;
export type SheetRow = readonly SheetCell[];

/** Writes to a Google Sheet laid out as a "Resources" tab (current state) and an "Activity" tab (append-only). */
export interface SheetsGateway {
  /** Creates the Resources and Activity tabs, with headers, if they are missing. Throws SheetsError. */
  prepare(spreadsheetId: string): Promise<void>;
  /** Makes the Resources tab show exactly these rows under its header. Throws SheetsError. */
  replaceResources(spreadsheetId: string, rows: readonly SheetRow[]): Promise<void>;
  /** The event ids already in the Activity tab. Throws SheetsError. */
  listActivityEventIds(spreadsheetId: string): Promise<ReadonlySet<string>>;
  /** Adds rows to the end of the Activity tab. Throws SheetsError. */
  appendActivity(spreadsheetId: string, rows: readonly SheetRow[]): Promise<void>;
}

export interface ClaimedJob {
  readonly id: number;
  readonly workspaceId: string;
  readonly eventId: string;
  /** How many times this job has now been tried, including this attempt. */
  readonly attempts: number;
}

/** The due jobs of one workspace, claimed together so the spreadsheet is written once for all of them. */
export interface SyncClaim {
  readonly jobs: readonly ClaimedJob[];
  /** The spreadsheet the workspace is connected to now, or null if it has been disconnected. */
  readonly spreadsheetId: string | null;
}

/** Queue operations available while holding the exclusive per-workspace sync lock. */
export interface LockedSyncQueue {
  /**
   * Takes every due job for the workspace (including ones a crashed worker abandoned), marking them in progress
   * and counting an attempt. Undefined if there are none.
   */
  claimDue(now: Date, leaseMs: number): Promise<SyncClaim | undefined>;
  markSynced(jobIds: readonly number[]): Promise<void>;
  markRetrying(jobIds: readonly number[], error: string, nextAttemptAt: Date): Promise<void>;
  markFailed(jobIds: readonly number[], error: string): Promise<void>;
}

export interface SyncQueue {
  /** A workspace that has due jobs, if any. Does not lock anything. */
  peekDueWorkspace(now: Date, leaseMs: number): Promise<string | undefined>;
  /**
   * Runs `work` while holding the exclusive sync lock for the workspace, so two workers never write the
   * same spreadsheet at once. Returns undefined without running `work` if another worker holds the lock.
   * The lock is released when `work` ends, or automatically if the worker dies.
   */
  withWorkspaceLock<T>(workspaceId: string, work: (queue: LockedSyncQueue) => Promise<T>): Promise<T | undefined>;
}
