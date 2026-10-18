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
    .describe('The inventory item as the user named it, for example "air filters". The server matches the name; never invent an ID.'),
  delta: z
    .number()
    .int()
    .describe('Units to add (positive) or remove (negative). "Add twenty air filters" is 20; "remove ten brake pads" is -10.'),
  idempotencyKey: idempotencyKeyParam,
  workspaceId: workspaceIdParam,
};

export function registerAdjustQuantity(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'adjust-quantity',
    {
      title: 'Add or remove stock',
      description: [
        'Records stock received (positive delta) or used (negative delta) for an inventory item, for example "add twenty air filters" is delta 20.',
        'Pass the item name exactly as the user said it; the server matches it.',
        'If the status is "ambiguous" or "not_found", ask the user which item they meant and wait: do not retry with a guess.',
        'A "rejected" result means nothing changed: tell the user why.',
        'Small changes are applied immediately. Changes of 100 or more units, or that would leave zero stock, need the user\'s approval first: the status is then "confirmation_required" and nothing has changed yet. ' +
          CONFIRMATION_GUIDANCE,
        'If the change drops stock below its reorder level, "alerts.opened" says so: tell the user.',
        'Report only what the result says (quote "spoken"). Never claim a spreadsheet or board was updated unless "sync" says so.',
        'When retrying the identical request, pass the same idempotencyKey so it is applied only once.',
      ].join(' '),
      inputSchema,
      outputSchema: writeOutputSchema,
      annotations: RECORD_CHANGE_ANNOTATIONS,
    },
    async ({ resource, delta, idempotencyKey, workspaceId }) =>
      requestChange(context, workspaceFor(context, workspaceId), {
        operation: 'ADJUST_QUANTITY',
        target: resource,
        arguments: { delta },
        idempotencyKey,
      }),
  );
}
