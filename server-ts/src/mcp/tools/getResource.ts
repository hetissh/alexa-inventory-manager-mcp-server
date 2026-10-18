import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { MATCH_KINDS } from '../../domain/matcher.js';
import { candidateViewSchema, resourceViewSchema, toCandidateView, toolResult, toResourceView } from '../views.js';
import { READ_ONLY_ANNOTATIONS, type ToolContext } from './context.js';

const inputSchema = {
  resource: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe('The resource as the user named it, for example "air filters" or "compressor two".'),
};

const outputSchema = {
  status: z.enum(['found', 'ambiguous', 'not_found']),
  spoken: z.string().describe('A sentence suitable for reading aloud.'),
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
        'Looks up one inventory item or piece of equipment by the name the user used, and reports its current quantity or status (for example "how many air filters are there?"). If the status is "ambiguous" or "not_found", ask the user which one they meant instead of guessing. Changes nothing.',
      inputSchema,
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ resource }) => {
      const outcome = await context.reads.getResource(context.workspaceId, resource);
      switch (outcome.status) {
        case 'found':
          return toolResult({
            status: outcome.status,
            spoken: outcome.spoken,
            matchedBy: outcome.matchedBy,
            resource: toResourceView(outcome.resource),
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
