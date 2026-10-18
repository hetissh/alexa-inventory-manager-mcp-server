import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { TOKEN_PATTERN } from '../../app/confirmationCode.js';
import {
  CANCEL_ANNOTATIONS,
  CONFIRM_ANNOTATIONS,
  type ToolContext,
  workspaceFor,
  workspaceIdParam,
} from './context.js';
import { toWriteResult, writeOutputSchema } from './writeResult.js';

const inputSchema = {
  token: z
    .string()
    .trim()
    .regex(TOKEN_PATTERN, 'must be the confirmation token returned by the change that is waiting')
    .describe('The token from the "confirmation_required" result.'),
  workspaceId: workspaceIdParam,
};

export function registerConfirmCommand(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'confirm-command',
    {
      title: 'Confirm a waiting change',
      description:
        'Applies a change that is waiting for approval. Call this ONLY after the user has clearly said yes to the question in "confirmation.readback"; never confirm on your own initiative. The token is single-use, expires after about two minutes and only works for the user who asked. If the item changed in the meantime nothing is applied and the result says so. Repeating the call returns the original result. Report only what the result says.',
      inputSchema,
      outputSchema: writeOutputSchema,
      annotations: CONFIRM_ANNOTATIONS,
    },
    async ({ token, workspaceId }) => {
      const workspace = workspaceFor(context, workspaceId);
      return toWriteResult(workspace, await context.commands.confirm({ workspaceId: workspace, actorId: context.actorId, token }));
    },
  );
}

export function registerCancelCommand(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'cancel-command',
    {
      title: 'Cancel a waiting change',
      description:
        'Discards a change that is waiting for approval, when the user says no or changes their mind. Nothing is applied. Repeating the call is harmless.',
      inputSchema,
      outputSchema: writeOutputSchema,
      annotations: CANCEL_ANNOTATIONS,
    },
    async ({ token, workspaceId }) => {
      const workspace = workspaceFor(context, workspaceId);
      return toWriteResult(workspace, await context.commands.cancel({ workspaceId: workspace, actorId: context.actorId, token }));
    },
  );
}
