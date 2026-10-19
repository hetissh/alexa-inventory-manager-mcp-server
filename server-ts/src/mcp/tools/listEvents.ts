import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { candidateViewSchema, eventViewSchema, toCandidateView, toEventView, toolResult } from '../views.js';
import { READ_ONLY_ANNOTATIONS, type ToolContext, workspaceFor, workspaceIdParam } from './context.js';

const inputSchema = {
  limit: z.number().int().min(1).max(50).default(20).describe('How many recent changes to return, newest first.'),
  resource: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe('Only show changes to this resource, as the user named it. Omit for all changes.'),
  workspaceId: workspaceIdParam,
};

const outputSchema = {
  status: z.enum(['ok', 'ambiguous', 'not_found']),
  spoken: z.string(),
  workspaceId: z.string(),
  query: z.string().optional(),
  candidates: z.array(candidateViewSchema).optional(),
  events: z.array(eventViewSchema).optional().describe('Newest first.'),
};

export function registerListEvents(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'list-events',
    {
      title: 'List recent changes',
      description:
        'Shows the activity log: recent changes with who made them, when, the before and after values and the spreadsheet sync state. Optionally limited to one resource. Changes nothing.',
      inputSchema,
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ limit, resource, workspaceId }) => {
      const workspace = workspaceFor(context, workspaceId);
      const outcome = await context.reads.listEvents(workspace, { limit, resource });
      const base = { status: outcome.status, spoken: outcome.spoken, workspaceId: workspace };
      switch (outcome.status) {
        case 'ok':
          return toolResult({ ...base, events: outcome.events.map((event) => toEventView(event, event.sync, event.syncError)) });
        case 'ambiguous':
          return toolResult({ ...base, query: outcome.query, candidates: outcome.candidates.map(toCandidateView) });
        case 'not_found':
          return toolResult({ ...base, query: outcome.query });
      }
    },
  );
}
