import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { MATCH_KINDS } from '../../domain/matcher.js';
import { candidateViewSchema, resourceViewSchema, toCandidateView, toolResult, toResourceView } from '../views.js';
import { READ_ONLY_ANNOTATIONS, type ToolContext, workspaceFor, workspaceIdParam } from './context.js';

const inputSchema = {
  resource: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe('The resource as the user named it, for example "air filters", "compressor two" or "job 108".'),
  workspaceId: workspaceIdParam,
};

const outputSchema = {
  status: z.enum(['found', 'ambiguous', 'not_found']),
  spoken: z.string().describe('A sentence suitable for reading aloud.'),
  workspaceId: z.string(),
  query: z.string().optional().describe('The name that was looked up (ambiguous and not_found only).'),
  matchedBy: z.enum(MATCH_KINDS).optional(),
  resource: resourceViewSchema.optional(),
  candidates: z.array(candidateViewSchema).optional(),
};

export function registerGetResource(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'get-resource',
    {
      title: 'Get a resource',
      description:
        'Looks up one inventory item, piece of equipment, menu item, job or technician by the name the user used, and reports its current quantity, status or assignment (for example "how many air filters are there?"). If the status is "ambiguous" or "not_found", ask the user which one they meant instead of guessing. Changes nothing.',
      inputSchema,
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ resource, workspaceId }) => {
      const workspace = workspaceFor(context, workspaceId);
      const outcome = await context.reads.getResource(workspace, resource);
      const base = { status: outcome.status, spoken: outcome.spoken, workspaceId: workspace };
      switch (outcome.status) {
        case 'found':
          return toolResult({ ...base, matchedBy: outcome.matchedBy, resource: toResourceView(outcome.resource) });
        case 'ambiguous':
          return toolResult({ ...base, query: outcome.query, candidates: outcome.candidates.map(toCandidateView) });
        case 'not_found':
          return toolResult({ ...base, query: outcome.query });
      }
    },
  );
}
