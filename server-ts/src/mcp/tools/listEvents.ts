import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { candidateViewSchema, eventViewSchema, toCandidateView, toEventView, toolResult } from '../views.js';
import { READ_ONLY_ANNOTATIONS, type ToolContext } from './context.js';

const inputSchema = {
  limit: z.number().int().min(1).max(50).default(20).describe('How many recent changes to return, newest first.'),
  resource: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe('Only show changes to this resource, as the user named it. Omit for all changes.'),
};

const outputSchema = {
  status: z.enum(['ok', 'ambiguous', 'not_found']),
  spoken: z.string(),
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
    async ({ limit, resource }) => {
      const outcome = await context.reads.listEvents(context.workspaceId, { limit, resource });
      switch (outcome.status) {
        case 'ok':
          return toolResult({
            status: outcome.status,
            spoken: outcome.spoken,
            events: outcome.events.map((event) => toEventView(event, event.sync)),
          });
        case 'ambiguous':
          return toolResult({
            status: outcome.status,
            spoken: outcome.spoken,
            query: outcome.query,
            candidates: outcome.candidates.map(toCandidateView),
          });
        case 'not_found':
          return toolResult({ status: outcome.status, spoken: outcome.spoken, query: outcome.query });
      }
    },
  );
}
