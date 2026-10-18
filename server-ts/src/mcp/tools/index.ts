import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerCheckHealth } from './checkHealth.js';
import type { ToolContext } from './context.js';
import { registerEchoMessage } from './echoMessage.js';

/** Single place where every tool is registered; add new tools here. */
export function registerTools(server: McpServer, context: ToolContext): void {
  registerCheckHealth(server, context);
  registerEchoMessage(server, context);
}
