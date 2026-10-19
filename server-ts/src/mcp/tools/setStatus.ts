import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  CONFIRMATION_GUIDANCE,
  idempotencyKeyParam,
  RECORD_CHANGE_ANNOTATIONS,
  type ToolContext,
  workspaceFor,
  workspaceIdParam,
} from './context.js';
import { requestChange, writeOutputSchema } from './writeResult.js';

const inputSchema = {
  resource: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe('The equipment, menu item or dining table as the user named it, for example "compressor two", "chicken biryani" or "table five".'),
  status: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .describe('The new status as the user said it, for example "under maintenance", "out of service", "available", "sold out", "reserved" or "cleaning".'),
  idempotencyKey: idempotencyKeyParam,
  workspaceId: workspaceIdParam,
};

export function registerSetStatus(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'set-status',
    {
      title: 'Change a status',
      description: [
        'Changes the status of a piece of equipment (available, under maintenance, out of service), a menu item (available, sold out) or a dining table (free, occupied, reserved, cleaning), for example "mark compressor two under maintenance", "mark chicken biryani sold out" or "mark table five reserved".',
        'Pass the name and status as the user said them; the server matches them. If the status is "ambiguous" or "not_found", ask the user which one they meant and wait: do not retry with a guess.',
        'A "rejected" result means nothing changed: tell the user why (for example the status is not valid for that item, or it already has that status).',
        CONFIRMATION_GUIDANCE,
        'Report only what the result says (quote "spoken"). Never claim a spreadsheet or board was updated unless "sync" says so.',
      ].join(' '),
      inputSchema,
      outputSchema: writeOutputSchema,
      annotations: RECORD_CHANGE_ANNOTATIONS,
    },
    async ({ resource, status, idempotencyKey, workspaceId }) =>
      requestChange(context, workspaceFor(context, workspaceId), {
        operation: 'SET_STATUS',
        target: resource,
        arguments: { status },
        idempotencyKey,
      }),
  );
}
