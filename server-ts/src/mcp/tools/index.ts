import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerAdjustQuantity } from './adjustQuantity.js';
import { registerCheckHealth } from './checkHealth.js';
import type { ToolContext } from './context.js';
import { registerFindResources } from './findResources.js';
import { registerGetResource } from './getResource.js';
import { registerListEvents } from './listEvents.js';

/** Single place where every tool is registered; add new tools here. */
export function registerTools(server: McpServer, context: ToolContext): void {
  registerCheckHealth(server, context);
  registerFindResources(server, context);
  registerGetResource(server, context);
  registerAdjustQuantity(server, context);
  registerListEvents(server, context);
}
