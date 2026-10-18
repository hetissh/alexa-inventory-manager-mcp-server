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
}

/** AGENTS.md §1: every tool must declare all three hints explicitly. */
export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;
