import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { SERVER_NAME, SERVER_VERSION } from '../../version.js';
import { READ_ONLY_ANNOTATIONS, type ToolContext } from './context.js';

const outputSchema = {
  status: z.literal('ok'),
  server: z.string().describe('Server name.'),
  version: z.string().describe('Server version.'),
  nodeVersion: z.string().describe('Node.js runtime version.'),
  uptimeSeconds: z.number().nonnegative().describe('Seconds since the server process started.'),
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
        'Diagnostic: confirms the VoiceOps server is reachable and reports its version, uptime and the connected MCP client. Changes nothing.',
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    () => {
      const info = context.getClientInfo();
      const result = {
        status: 'ok' as const,
        server: SERVER_NAME,
        version: SERVER_VERSION,
        nodeVersion: context.nodeVersion,
        uptimeSeconds: Math.floor(context.uptimeSeconds()),
        client: info ? { name: info.name, version: info.version } : null,
      };
      context.logger.debug({ tool: 'check-health' }, 'tool called');
      const clientLabel = info ? `${info.name} ${info.version}` : 'unknown client';
      return {
        content: [
          {
            type: 'text' as const,
            text: `VoiceOps server ok: ${result.server} ${result.version}, uptime ${String(result.uptimeSeconds)}s, client ${clientLabel}.`,
          },
        ],
        structuredContent: result,
      };
    },
  );
}
