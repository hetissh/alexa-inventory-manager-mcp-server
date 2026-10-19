import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerAdjustQuantity } from './adjustQuantity.js';
import { registerAssignJob } from './assignJob.js';
import { registerCheckHealth } from './checkHealth.js';
import { registerCancelCommand, registerConfirmCommand } from './confirmCommand.js';
import type { ToolContext } from './context.js';
import { registerFindResources } from './findResources.js';
import { registerGetBoard } from './getBoard.js';
import { registerGetResource } from './getResource.js';
import { registerGetWorkspace } from './getWorkspace.js';
import { registerListAlerts } from './listAlerts.js';
import { registerListEvents } from './listEvents.js';
import { registerResetWorkspace } from './resetWorkspace.js';
import { registerRetrySync } from './retrySync.js';
import { registerSetStatus } from './setStatus.js';
import { registerUndoLastChange } from './undoLastChange.js';

/** Single place where every tool is registered; add new tools here. */
export function registerTools(server: McpServer, context: ToolContext): void {
  registerCheckHealth(server, context);
  registerGetWorkspace(server, context);
  registerFindResources(server, context);
  registerGetResource(server, context);
  registerGetBoard(server, context);
  registerListEvents(server, context);
  registerListAlerts(server, context);
  registerAdjustQuantity(server, context);
  registerSetStatus(server, context);
  registerAssignJob(server, context);
  registerUndoLastChange(server, context);
  registerConfirmCommand(server, context);
  registerCancelCommand(server, context);
  registerRetrySync(server, context);
  if (context.demo) {
    registerResetWorkspace(server, context, context.demo);
  }
}
