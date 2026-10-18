export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Where a command came from. Recorded on every event. */
export const COMMAND_SOURCES = ['mcp', 'alexa', 'dashboard'] as const;
export type CommandSource = (typeof COMMAND_SOURCES)[number];

export const OPERATION_NAMES = ['ADJUST_QUANTITY'] as const;
export type OperationName = (typeof OPERATION_NAMES)[number];

export const TEMPLATE_IDS = ['warehouse'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const SYNC_STATUSES = ['pending', 'in_progress', 'synced', 'retrying', 'failed'] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const SYNC_DESTINATIONS = ['sheets'] as const;
export type SyncDestination = (typeof SYNC_DESTINATIONS)[number];

/** Per-workspace tunables that operations consult when validating a change. */
export interface WorkspaceSettings {
  /** Adjustments of at least this many units need confirmation. */
  readonly largeAdjustThreshold: number;
  /** Adjustments larger than this are rejected outright (guards against mis-heard numbers). */
  readonly maxAdjustment: number;
}

export interface Integrations {
  readonly sheets?: { readonly spreadsheetId: string };
}

export interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly template: TemplateId;
  readonly timezone: string;
  readonly boardVersion: number;
  readonly integrations: Integrations;
}

/** An immutable record of one committed change, with before/after values of the attributes it touched. */
export interface EventRecord {
  readonly eventId: string;
  readonly seq: number;
  readonly workspaceId: string;
  readonly commandId: string;
  readonly resourceId: string;
  readonly resourceName: string;
  readonly operation: OperationName;
  readonly arguments: JsonObject;
  readonly before: JsonObject;
  readonly after: JsonObject;
  readonly summary: string;
  readonly actor: string;
  readonly source: CommandSource;
  readonly clientName: string | null;
  readonly createdAt: Date;
  readonly reversalOf: string | null;
}
