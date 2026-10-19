import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { DemoAdmin } from '../../app/ports.js';
import { toolResult } from '../views.js';
import { type ToolContext, workspaceFor, workspaceIdParam } from './context.js';

const inputSchema = {
  confirm: z
    .literal(true)
    .describe('Must be true. Set it only after the user has explicitly asked to reset this demo workspace.'),
  workspaceId: workspaceIdParam,
};

const outputSchema = {
  status: z.literal('reset'),
  spoken: z.string().describe('A sentence suitable for reading aloud.'),
  workspaceId: z.string(),
};

/** Demo-only: registered solely when VOICEOPS_DEMO_TOOLS is on and the database is local. */
export function registerResetWorkspace(server: McpServer, context: ToolContext, demo: DemoAdmin): void {
  server.registerTool(
    'reset-workspace',
    {
      title: 'Reset a demo workspace',
      description:
        'DEMO ONLY. Deletes a demo workspace\'s activity log, waiting confirmations and alerts and restores its starting data, so a demo can be rehearsed again. Everything changed since the workspace was set up is lost. Use it only when the user explicitly asks to reset the demo data.',
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: false },
    },
    async ({ workspaceId }) => {
      const workspace = workspaceFor(context, workspaceId);
      await demo.resetWorkspace(workspace);
      return toolResult({
        status: 'reset',
        spoken: `${workspace} was reset to its starting data. Its history and waiting confirmations are gone.`,
        workspaceId: workspace,
      });
    },
  );
}
