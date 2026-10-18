import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { toolResult } from '../views.js';
import { READ_ONLY_ANNOTATIONS, type ToolContext, workspaceFor, workspaceIdParam } from './context.js';

const inputSchema = { workspaceId: workspaceIdParam };

const outputSchema = {
  workspaceId: z.string(),
  name: z.string(),
  template: z.string(),
  templateLabel: z.string(),
  timezone: z.string(),
  boardVersion: z.number().int(),
  spoken: z.string(),
  workspaces: z.array(z.string()).describe('Every workspace tools may address.'),
  counts: z.record(z.string(), z.number()).describe('How many resources of each type exist.'),
  settings: z.object({
    largeAdjustThreshold: z.number().describe('Stock changes of at least this many units need the user\'s approval.'),
    maxAdjustment: z.number().describe('Stock changes larger than this are refused.'),
    equipmentStatuses: z.array(z.string()).optional().describe('Statuses equipment can have (only if this workspace has equipment).'),
    menuItemStatuses: z.array(z.string()).optional().describe('Statuses menu items can have (only if this workspace has a menu).'),
  }),
  spreadsheet: z.enum(['configured', 'not_configured']),
};

export function registerGetWorkspace(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'get-workspace',
    {
      title: 'Describe a workspace',
      description:
        'Describes a workspace: what kind of business it is, how many items, equipment, menu items, jobs and technicians it has, which statuses are allowed and the rules that apply (such as which stock changes need approval). Also lists every workspace you may use. Call it first when you need to know what you can do here. Changes nothing.',
      inputSchema,
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ workspaceId }) => {
      const workspace = workspaceFor(context, workspaceId);
      const info = await context.reads.getWorkspaceInfo(workspace);
      const { settings, counts } = info;
      return toolResult({
        workspaceId: workspace,
        name: info.workspace.name,
        template: info.workspace.template,
        templateLabel: info.templateLabel,
        timezone: info.workspace.timezone,
        boardVersion: info.workspace.boardVersion,
        spoken: info.spoken,
        workspaces: context.workspaceIds,
        counts,
        settings: {
          largeAdjustThreshold: settings.largeAdjustThreshold,
          maxAdjustment: settings.maxAdjustment,
          ...(counts.equipment ? { equipmentStatuses: settings.equipmentStatuses } : {}),
          ...(counts.menu_item ? { menuItemStatuses: settings.menuItemStatuses } : {}),
        },
        spreadsheet: info.workspace.integrations.sheets ? 'configured' : 'not_configured',
      });
    },
  );
}
