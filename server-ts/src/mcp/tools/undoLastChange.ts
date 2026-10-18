import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  CONFIRMATION_GUIDANCE,
  idempotencyKeyParam,
  RECORD_CHANGE_ANNOTATIONS,
  type ToolContext,
  workspaceFor,
  workspaceIdParam,
} from './context.js';
import { requestChange, writeOutputSchema } from './writeResult.js';

const inputSchema = { idempotencyKey: idempotencyKeyParam, workspaceId: workspaceIdParam };

export function registerUndoLastChange(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'undo-last-change',
    {
      title: 'Undo my last change',
      description: [
        'Reverses the most recent change made by this user, by recording a new compensating change (the original stays in the activity log). Changes that were themselves undos cannot be undone again; asking twice undoes the one before.',
        'A "rejected" result means nothing changed: tell the user why (for example there is nothing to undo, or the item has been changed since).',
        CONFIRMATION_GUIDANCE,
        'Report only what the result says (quote "spoken"). Never claim a spreadsheet or board was updated unless "sync" says so.',
      ].join(' '),
      inputSchema,
      outputSchema: writeOutputSchema,
      annotations: RECORD_CHANGE_ANNOTATIONS,
    },
    async ({ idempotencyKey, workspaceId }) =>
      requestChange(context, workspaceFor(context, workspaceId), {
        operation: 'REVERSE_EVENT',
        target: '',
        arguments: {},
        idempotencyKey,
      }),
  );
}
