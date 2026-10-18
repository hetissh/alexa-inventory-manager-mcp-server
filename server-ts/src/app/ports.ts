import type { Resource, ResourceType } from '../domain/schemas.js';
import type {
  CommandSource,
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
}

/** An event plus the state of its outbound sync to the spreadsheet, if one is configured. */
export type ListedEvent = EventRecord & { readonly sync: SyncStatus | 'not_configured' };

/** Operations available inside one database transaction. Every method is scoped by workspace. */
export interface TransactionStore {
  /** Reads a resource and locks it until the transaction ends. */
  lockResource(workspaceId: string, resourceId: string): Promise<Resource | undefined>;
  findEventByCommandId(workspaceId: string, commandId: string): Promise<EventRecord | undefined>;
  /** Throws DuplicateCommandError if the command ID is already taken. */
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
}

export interface Store {
  getWorkspace(workspaceId: string): Promise<Workspace | undefined>;
  listResources(workspaceId: string, filter?: { readonly types?: readonly ResourceType[] }): Promise<Resource[]>;
  /** Newest first. */
  listEvents(workspaceId: string, options: { readonly limit: number; readonly resourceId?: string }): Promise<ListedEvent[]>;
  /** Throws if the database cannot be reached. */
  ping(): Promise<void>;
  /** Commits if `work` resolves, rolls back if it throws. */
  withTransaction<T>(work: (tx: TransactionStore) => Promise<T>): Promise<T>;
}
