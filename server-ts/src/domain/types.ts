export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Where a command came from. Recorded on every event. */
export const COMMAND_SOURCES = ['mcp', 'alexa', 'dashboard'] as const;
export type CommandSource = (typeof COMMAND_SOURCES)[number];

export const OPERATION_NAMES = ['ADJUST_QUANTITY', 'SET_STATUS', 'ASSIGN_JOB', 'REVERSE_EVENT'] as const;
export type OperationName = (typeof OPERATION_NAMES)[number];

export const TEMPLATE_IDS = ['warehouse', 'cafe', 'restaurant', 'repair'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const JOB_STATUSES = ['waiting', 'assigned', 'in_progress', 'done'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const SYNC_STATUSES = ['pending', 'in_progress', 'synced', 'retrying', 'failed'] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const SYNC_DESTINATIONS = ['sheets'] as const;
export type SyncDestination = (typeof SYNC_DESTINATIONS)[number];

export const ALERT_RULES = ['low_stock'] as const;
export type AlertRule = (typeof ALERT_RULES)[number];

export const ALERT_STATUSES = ['open', 'resolved'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const COMMAND_STATUSES = ['pending', 'confirmed', 'cancelled', 'expired'] as const;
export type CommandStatus = (typeof COMMAND_STATUSES)[number];

/** Per-workspace tunables that operations consult when validating a change. */
export interface WorkspaceSettings {
  /** Adjustments of at least this many units need confirmation. */
  readonly largeAdjustThreshold: number;
  /** Adjustments larger than this are rejected outright (guards against mis-heard numbers). */
  readonly maxAdjustment: number;
  /** Statuses a piece of equipment may be in. */
  readonly equipmentStatuses: readonly string[];
  /** Statuses a menu item may be in. */
  readonly menuItemStatuses: readonly string[];
  /** Statuses a dining table may be in. */
  readonly tableStatuses: readonly string[];
  /** How a status is said aloud, when it differs from the status with underscores replaced by spaces. */
  readonly statusLabels: Readonly<Record<string, string>>;
  /** Other ways people say a status ("broken" for out_of_service). Keys are lowercase. */
  readonly statusAliases: Readonly<Record<string, string>>;
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

export interface AlertRecord {
  readonly alertId: string;
  readonly workspaceId: string;
  readonly resourceId: string;
  readonly resourceName: string;
  readonly rule: AlertRule;
  readonly status: AlertStatus;
  readonly message: string;
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
}

/**
 * A change that is waiting for a human "yes". It is applied only when its single-use token is
 * confirmed by the same actor, before it expires, and while the resource is still at `expectedVersion`.
 */
export interface CommandRecord {
  readonly id: string;
  readonly workspaceId: string;
  /** Idempotency key the eventual event will carry. */
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
  readonly status: CommandStatus;
  readonly eventId: string | null;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
}
