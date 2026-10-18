import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { SERVER_NAME, SERVER_VERSION } from '../../version.js';
import { toolResult } from '../views.js';
import { READ_ONLY_ANNOTATIONS, type ToolContext } from './context.js';

const outputSchema = {
  status: z.enum(['ok', 'degraded']).describe('"degraded" when the database is unreachable.'),
  server: z.string().describe('Server name.'),
  version: z.string().describe('Server version.'),
  nodeVersion: z.string().describe('Node.js runtime version.'),
  uptimeSeconds: z.number().nonnegative().describe('Seconds since the server process started.'),
  workspace: z.string().describe('The workspace this server reads and writes.'),
  database: z.enum(['ok', 'unavailable']),
  client: z
    .object({ name: z.string(), version: z.string() })
    .nullable()
    .describe('The MCP client that connected (name and version), if known.'),
};

export function registerCheckHealth(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'check-health',
    {
      title: 'Check server health',
      description:
        'Confirms the VoiceOps server is reachable and its database is connected. Reports the server version, uptime, the workspace it serves and the connected MCP client. Changes nothing.',
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => {
      const { database } = await context.reads.health();
      const info = context.getClientInfo();
      return toolResult({
        status: database === 'ok' ? 'ok' : 'degraded',
        server: SERVER_NAME,
        version: SERVER_VERSION,
        nodeVersion: context.nodeVersion,
        uptimeSeconds: Math.floor(context.uptimeSeconds()),
        workspace: context.workspaceId,
        database,
        client: info ? { name: info.name, version: info.version } : null,
      });
    },
  );
}
