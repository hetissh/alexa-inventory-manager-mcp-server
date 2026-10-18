import type { CommandService } from '../../app/commandService.js';
import type { ReadService } from '../../app/readService.js';
import type { Logger } from '../../logger.js';

export interface ClientInfo {
  readonly name: string;
  readonly version: string;
}

/** Everything a tool handler may depend on; injected so tools stay testable. */
export interface ToolContext {
  readonly logger: Logger;
  readonly uptimeSeconds: () => number;
  readonly nodeVersion: string;
  readonly getClientInfo: () => ClientInfo | undefined;
  /** The one workspace this server instance serves. Tools never accept a workspace from the model. */
  readonly workspaceId: string;
  /** Who changes made through this server are attributed to. */
  readonly actorId: string;
  readonly commands: CommandService;
  readonly reads: ReadService;
}

/** AGENTS.md §1: every tool must declare all three hints explicitly. */
export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

/**
 * For tools that record a change. Not "destructive": nothing is deleted, every change is an
 * auditable event. Not idempotent unless the caller supplies an idempotency key.
 */
export const RECORD_CHANGE_ANNOTATIONS = {
  readOnlyHint: false,
  idempotentHint: false,
  destructiveHint: false,
  openWorldHint: false,
} as const;
