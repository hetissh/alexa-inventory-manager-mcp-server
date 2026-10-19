import type { Resource, ResourceType } from '../domain/schemas.js';
import type {
  AlertRecord,
  AlertRule,
  AlertStatus,
  CommandRecord,
  CommandSource,
  CommandStatus,
  EventRecord,
  JsonObject,
  OperationName,
  SyncDestination,
  SyncStatus,
  Workspace,
} from '../domain/types.js';

/** The slice of a logger the application layer needs (a pino Logger satisfies it). */
export interface AppLogger {
  info(fields: object, message: string): void;
  warn(fields: object, message: string): void;
}

export interface NewEvent {
  readonly workspaceId: string;
  readonly commandId: string;
  readonly resourceId: string;
  readonly operation: OperationName;
  readonly arguments: JsonObject;
  readonly before: JsonObject;
  readonly after: JsonObject;
  readonly summary: string;
  readonly actor: string;
  readonly source: CommandSource;
  readonly clientName: string | null;
  /** The event this one undoes, if any. */
  readonly reversalOf: string | null;
}

export interface NewCommand {
  readonly workspaceId: string;
  readonly commandId: string;
  readonly actor: string;
  readonly source: CommandSource;
  readonly clientName: string | null;
  readonly operation: OperationName;
  readonly resourceId: string;
  readonly arguments: JsonObject;
  readonly secondaryResourceId: string | null;
  readonly reversingEventId: string | null;
  readonly expectedVersion: number;
  readonly reason: string;
  readonly readback: string;
  /** SHA-256 of the confirmation token; the token itself is never stored. */
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export interface NewAlert {
  readonly workspaceId: string;
  readonly resourceId: string;
  readonly rule: AlertRule;
  readonly message: string;
  readonly eventId: string;
}

/** An event plus the state of its outbound sync to the spreadsheet, if one is configured. */
export type ListedEvent = EventRecord & {
  readonly sync: SyncStatus | 'not_configured';
  /** Why the last sync attempt failed, if it did. */
  readonly syncError: string | null;
};

/** How many spreadsheet updates are waiting, being retried, or gave up, for one workspace. */
export interface SyncBacklog {
  /** Waiting, or being processed right now. */
  readonly pending: number;
  readonly retrying: number;
  readonly failed: number;
}

export type RequeueResult =
  | { readonly result: 'requeued' }
  /** Nothing to do: the job is already synced or already waiting. */
  | { readonly result: 'unchanged'; readonly status: SyncStatus }
  | { readonly result: 'missing' };

/** A consistent read of everything a live board shows, taken in one snapshot. */
export interface BoardSnapshot {
  readonly workspace: Workspace;
  readonly resources: readonly Resource[];
  readonly openAlerts: readonly AlertRecord[];
  readonly recentEvents: readonly ListedEvent[];
}

/** Operations available inside one database transaction. Every method is scoped by workspace. */
export interface TransactionStore {
  /** Reads a resource and locks it until the transaction ends. */
  lockResource(workspaceId: string, resourceId: string): Promise<Resource | undefined>;
  findEventByCommandId(workspaceId: string, commandId: string): Promise<EventRecord | undefined>;
  /** Throws DuplicateCommandError if the command ID is taken, AlreadyReversedError if the event was already undone. */
  insertEvent(event: NewEvent): Promise<EventRecord>;
  /** Throws VersionConflictError unless the resource is still at `expectedVersion`. */
  updateResourceAttributes(
    workspaceId: string,
    resourceId: string,
    attributes: JsonObject,
    expectedVersion: number,
  ): Promise<Resource>;
  bumpBoardVersion(workspaceId: string): Promise<number>;
  enqueueSync(workspaceId: string, eventId: string, destination: SyncDestination): Promise<void>;
  getSyncStatus(eventId: string, destination: SyncDestination): Promise<SyncStatus | undefined>;
  insertCommand(command: NewCommand): Promise<void>;
  /** Reads a pending-change record and locks it until the transaction ends. Throws if it does not exist. */
  lockCommand(id: string): Promise<CommandRecord>;
  updateCommandStatus(id: string, status: Exclude<CommandStatus, 'pending'>, eventId: string | null): Promise<void>;
  /** Opens an alert unless one is already open for the same resource and rule; returns it only if newly opened. */
  openAlert(alert: NewAlert): Promise<AlertRecord | undefined>;
  /** Resolves every open alert for the resource and rule; returns the ones it resolved. */
  resolveAlerts(workspaceId: string, resourceId: string, rule: AlertRule, eventId: string): Promise<AlertRecord[]>;
}

export interface Store {
  getWorkspace(workspaceId: string): Promise<Workspace | undefined>;
  listResources(workspaceId: string, filter?: { readonly types?: readonly ResourceType[] }): Promise<Resource[]>;
  /** Newest first. */
  listEvents(workspaceId: string, options: { readonly limit: number; readonly resourceId?: string }): Promise<ListedEvent[]>;
  getEvent(workspaceId: string, eventId: string): Promise<EventRecord | undefined>;
  /** The events that exist among `eventIds`, oldest first. */
  listEventsByIds(workspaceId: string, eventIds: readonly string[]): Promise<EventRecord[]>;
  /** Puts a failed or retrying sync job back in the queue, to be tried again straight away. */
  requeueSync(workspaceId: string, eventId: string, destination: SyncDestination): Promise<RequeueResult>;
  getSyncBacklog(workspaceId: string): Promise<SyncBacklog>;
  /** The actor's newest event that is not itself an undo and has not been undone. */
  findLastReversibleEvent(workspaceId: string, actor: string): Promise<EventRecord | undefined>;
  findCommandByTokenHash(workspaceId: string, tokenHash: string): Promise<CommandRecord | undefined>;
  /** Newest first. */
  listAlerts(workspaceId: string, options: { readonly status: AlertStatus | 'all'; readonly limit: number }): Promise<AlertRecord[]>;
  getBoardSnapshot(workspaceId: string, eventLimit: number): Promise<BoardSnapshot | undefined>;
  /** Throws if the database cannot be reached. */
  ping(): Promise<void>;
  /** Commits if `work` resolves, rolls back if it throws. */
  withTransaction<T>(work: (tx: TransactionStore) => Promise<T>): Promise<T>;
}

/** Operations that only make sense for demos and rehearsals; never available unless explicitly enabled. */
export interface DemoAdmin {
  /** Deletes the workspace's events, pending changes and alerts and restores its starting data. */
  resetWorkspace(workspaceId: string): Promise<void>;
}
