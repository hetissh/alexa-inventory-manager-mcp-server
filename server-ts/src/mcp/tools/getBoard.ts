import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { RESOURCE_TYPES } from '../../domain/schemas.js';
import { alertViewSchema, eventViewSchema, toAlertView, toEventView, toolResult } from '../views.js';
import { READ_ONLY_ANNOTATIONS, type ToolContext, workspaceFor, workspaceIdParam } from './context.js';

const inputSchema = { workspaceId: workspaceIdParam };

const outputSchema = {
  workspaceId: z.string(),
  title: z.string(),
  version: z
    .number()
    .int()
    .describe('Changes whenever the board may have changed; a screen refreshes when it differs from the one it shows.'),
  generatedAt: z.string().describe('ISO 8601 timestamp.'),
  spoken: z.string().describe('The headline numbers as a sentence.'),
  metrics: z.array(z.object({ label: z.string(), value: z.number() })),
  resources: z.array(
    z.object({
      id: z.string(),
      type: z.enum(RESOURCE_TYPES),
      name: z.string(),
      attributes: z.record(z.string(), z.unknown()),
      hasAlert: z.boolean().describe('True when this resource has an open alert, so a screen can highlight it.'),
    }),
  ),
  alerts: z.array(alertViewSchema).describe('Open alerts.'),
  recentActivity: z.array(eventViewSchema).describe('The latest changes, newest first.'),
};

export function registerGetBoard(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'get-board',
    {
      title: 'Get the live board',
      description:
        'Returns what the workspace\'s live display shows: headline numbers, every resource with its current state, open alerts and the latest changes, all from one consistent snapshot with a version number. Use it for "how are we doing?" or "what is on the board?". Changes nothing.',
      inputSchema,
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ workspaceId }) => {
      const workspace = workspaceFor(context, workspaceId);
      const board = await context.reads.getBoard(workspace);
      return toolResult({
        workspaceId: workspace,
        title: board.title,
        version: board.version,
        generatedAt: board.generatedAt.toISOString(),
        spoken: board.spoken,
        metrics: board.metrics,
        resources: board.resources.map(({ resource, hasAlert }) => ({
          id: resource.id,
          type: resource.type,
          name: resource.name,
          attributes: resource.attributes,
          hasAlert,
        })),
        alerts: board.alerts.map(toAlertView),
        recentActivity: board.recentActivity.map((event) => toEventView(event, event.sync)),
      });
    },
  );
}
