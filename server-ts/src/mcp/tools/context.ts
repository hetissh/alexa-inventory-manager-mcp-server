import { z } from 'zod';

import type { CommandService } from '../../app/commandService.js';
import type { ReadService } from '../../app/readService.js';
import { workspaceIdSchema } from '../../domain/schemas.js';
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
  /** Used when a tool call does not name a workspace. Always one of `workspaceIds`. */
  readonly defaultWorkspaceId: string;
  /** The only workspaces tools may address; anything else is refused. */
  readonly workspaceIds: readonly string[];
  /** Who changes made through this server are attributed to. */
  readonly actorId: string;
  readonly commands: CommandService;
  readonly reads: ReadService;
}

/** The optional `workspaceId` input every tool accepts. */
export const workspaceIdParam = workspaceIdSchema
  .optional()
  .describe(
    'Which workspace (business) to use. Omit to use the default one. check-health and get-workspace list the available workspaces.',
  );

/** The workspace a tool call should act on; refuses anything outside the server's allow-list. */
export function workspaceFor(context: ToolContext, requested: string | undefined): string {
  const workspaceId = requested ?? context.defaultWorkspaceId;
  if (!context.workspaceIds.includes(workspaceId)) {
    throw new Error(
      `Workspace "${workspaceId}" is not available to this server. Available workspaces: ${context.workspaceIds.join(', ')}.`,
    );
  }
  return workspaceId;
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
 * auditable event and can be undone. Not idempotent unless the caller supplies an idempotency key.
 */
export const RECORD_CHANGE_ANNOTATIONS = {
  readOnlyHint: false,
  idempotentHint: false,
  destructiveHint: false,
  openWorldHint: false,
} as const;

/**
 * confirm-command applies a change that was waiting for a yes. Flagged destructive so the client's
 * own permission prompt is a second human gate. Idempotent: repeating it returns the same result.
 */
export const CONFIRM_ANNOTATIONS = {
  readOnlyHint: false,
  idempotentHint: true,
  destructiveHint: true,
  openWorldHint: false,
} as const;

/** cancel-command only discards a waiting change; repeating it is harmless. */
export const CANCEL_ANNOTATIONS = {
  readOnlyHint: false,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

export const idempotencyKeyParam = z
  .string()
  .trim()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9._:-]+$/)
  .optional()
  .describe('Optional. Reuse the same key when retrying the identical request so it is applied only once.');

/** Shared guidance for every tool that may need the user's approval first. */
export const CONFIRMATION_GUIDANCE =
  'This change always needs the user\'s explicit approval. If the status is "confirmation_required", read the question in "confirmation.readback" to the user and wait for their answer. Only if they clearly say yes, call confirm-command with the token; if they say no, call cancel-command. Never confirm on your own, and never reuse a token for a different change.';
