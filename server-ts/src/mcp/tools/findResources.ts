import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { MATCH_KINDS } from '../../domain/matcher.js';
import { RESOURCE_TYPES } from '../../domain/schemas.js';
import { resourceViewSchema, toolResult, toResourceView } from '../views.js';
import { READ_ONLY_ANNOTATIONS, type ToolContext, workspaceFor, workspaceIdParam } from './context.js';

const inputSchema = {
  query: z
    .string()
    .trim()
    .max(100)
    .optional()
    .describe('Words to match against resource names and aliases, for example "air filters". Omit to list everything.'),
  type: z.enum(RESOURCE_TYPES).optional().describe('Only return resources of this type.'),
  limit: z.number().int().min(1).max(50).default(20).describe('Maximum number of results.'),
  workspaceId: workspaceIdParam,
};

const outputSchema = {
  workspaceId: z.string(),
  total: z.number().int().describe('How many resources matched before the limit was applied.'),
  items: z.array(
    resourceViewSchema.extend({
      matchedBy: z.enum(MATCH_KINDS).nullable().describe('How the query matched; null when everything was listed.'),
      score: z.number().nullable().describe('Match quality from 0 to 1; null when everything was listed.'),
    }),
  ),
};

export function registerFindResources(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'find-resources',
    {
      title: 'Find resources',
      description:
        'Searches a workspace for inventory items, equipment, menu items, jobs and technicians by name or alias, best match first, with current quantities, statuses and assignments. With no query it lists everything: use that to see what exists. Changes nothing.',
      inputSchema,
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ query, type, limit, workspaceId }) => {
      const workspace = workspaceFor(context, workspaceId);
      const result = await context.reads.findResources(workspace, { query, type, limit });
      return toolResult({
        workspaceId: workspace,
        total: result.total,
        items: result.items.map((item) => ({
          ...toResourceView(item.resource),
          matchedBy: item.matchedBy,
          score: item.score,
        })),
      });
    },
  );
}
