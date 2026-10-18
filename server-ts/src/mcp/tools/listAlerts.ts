import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { alertViewSchema, toAlertView, toolResult } from '../views.js';
import { READ_ONLY_ANNOTATIONS, type ToolContext, workspaceFor, workspaceIdParam } from './context.js';

const inputSchema = {
  status: z.enum(['open', 'resolved', 'all']).default('open').describe('Which alerts to list. Defaults to the ones still open.'),
  limit: z.number().int().min(1).max(50).default(20).describe('Maximum number of alerts, newest first.'),
  workspaceId: workspaceIdParam,
};

const outputSchema = {
  workspaceId: z.string(),
  spoken: z.string(),
  alerts: z.array(alertViewSchema).describe('Newest first.'),
};

export function registerListAlerts(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'list-alerts',
    {
      title: 'List alerts',
      description:
        'Lists alerts raised automatically by the rules, such as an item dropping below its reorder level. Open alerts need attention; they clear by themselves when the cause is fixed (for example stock is replenished). Changes nothing.',
      inputSchema,
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ status, limit, workspaceId }) => {
      const workspace = workspaceFor(context, workspaceId);
      const { alerts, spoken } = await context.reads.listAlerts(workspace, { status, limit });
      return toolResult({ workspaceId: workspace, spoken, alerts: alerts.map(toAlertView) });
    },
  );
}
