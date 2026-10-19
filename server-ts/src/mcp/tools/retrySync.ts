import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { toolResult } from '../views.js';
import { CANCEL_ANNOTATIONS, type ToolContext, workspaceFor, workspaceIdParam } from './context.js';

const inputSchema = {
  eventId: z.uuid().describe('The eventId of the change whose spreadsheet update failed, from list-events.'),
  workspaceId: workspaceIdParam,
};

const outputSchema = {
  status: z.enum(['queued', 'already_synced', 'already_queued', 'not_found']),
  spoken: z.string().describe('A sentence suitable for reading aloud.'),
  workspaceId: z.string(),
};

export function registerRetrySync(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'retry-sync',
    {
      title: 'Retry a spreadsheet update',
      description:
        'Tries again to write one change to the spreadsheet, after list-events showed its sync as "failed" or "retrying". The change itself is already recorded; only the spreadsheet copy is retried. Safe to repeat: it does nothing if the update already went through or is already waiting.',
      inputSchema,
      outputSchema,
      // Repeating it is harmless and it deletes nothing, like cancel-command.
      annotations: CANCEL_ANNOTATIONS,
    },
    async ({ eventId, workspaceId }) => {
      const workspace = workspaceFor(context, workspaceId);
      const outcome = await context.sync.retry(workspace, eventId);
      return toolResult({ status: outcome.status, spoken: outcome.spoken, workspaceId: workspace });
    },
  );
}
