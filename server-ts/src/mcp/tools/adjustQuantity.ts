import { randomUUID } from 'node:crypto';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { CommandOutcome } from '../../app/commandService.js';
import { REJECTION_CODES } from '../../domain/operations/types.js';
import {
  candidateViewSchema,
  eventViewSchema,
  resourceViewSchema,
  syncStateSchema,
  toCandidateView,
  toEventView,
  toolResult,
  toResourceView,
} from '../views.js';
import { RECORD_CHANGE_ANNOTATIONS, type ToolContext } from './context.js';

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
  idempotencyKey: z
    .string()
    .trim()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9._:-]+$/)
    .optional()
    .describe('Optional. Reuse the same key when retrying the identical request so it is applied only once.'),
};

const outputSchema = {
  status: z.enum(['committed', 'ambiguous', 'not_found', 'rejected', 'conflict']),
  spoken: z.string().describe('A sentence suitable for reading aloud. Quote it; do not embellish.'),
  replayed: z.boolean().optional().describe('True when this exact request had already been applied and nothing new was written.'),
  code: z.enum(REJECTION_CODES).optional().describe('Why the change was refused (rejected only).'),
  message: z.string().optional(),
  query: z.string().optional().describe('The name that was looked up (ambiguous and not_found only).'),
  candidates: z.array(candidateViewSchema).optional(),
  event: eventViewSchema.optional().describe('The recorded change, with before and after values.'),
  resource: resourceViewSchema.optional().describe('The resource as it is now.'),
  sync: z.object({ sheets: syncStateSchema }).optional().describe('Whether the spreadsheet has been updated. Only claim a spreadsheet update if this says so.'),
};

export function toAdjustResult(outcome: CommandOutcome): CallToolResult {
  switch (outcome.status) {
    case 'committed':
      return toolResult({
        status: outcome.status,
        spoken: outcome.spoken,
        replayed: outcome.replayed,
        event: toEventView(outcome.event, outcome.sync.sheets),
        resource: toResourceView(outcome.resource),
        sync: outcome.sync,
      });
    case 'ambiguous':
      return toolResult({
        status: outcome.status,
        spoken: outcome.spoken,
        query: outcome.query,
        candidates: outcome.candidates.map(toCandidateView),
      });
    case 'not_found':
      return toolResult({ status: outcome.status, spoken: outcome.spoken, query: outcome.query });
    case 'rejected':
      return toolResult({ status: outcome.status, spoken: outcome.spoken, code: outcome.code, message: outcome.message }, true);
    case 'conflict':
      return toolResult({ status: outcome.status, spoken: outcome.spoken, message: outcome.message }, true);
  }
}

export function registerAdjustQuantity(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'adjust-quantity',
    {
      title: 'Add or remove stock',
      description: [
        'Records stock received (positive delta) or used (negative delta) for an inventory item, for example "add twenty air filters" is delta 20.',
        'Pass the item name exactly as the user said it; the server matches it.',
        'If the status is "ambiguous" or "not_found", ask the user which item they meant and wait: do not retry with a guess.',
        'A "rejected" result means nothing changed: tell the user why. Changes of 100 or more units, or that would leave zero stock, are currently refused with code CONFIRMATION_UNSUPPORTED because confirmation is not available yet.',
        'Report only what the result says (quote "spoken"). Never claim a spreadsheet or board was updated unless "sync" says so.',
        'When retrying the identical request, pass the same idempotencyKey so it is applied only once.',
      ].join(' '),
      inputSchema,
      outputSchema,
      annotations: RECORD_CHANGE_ANNOTATIONS,
    },
    async ({ resource, delta, idempotencyKey }) => {
      const outcome = await context.commands.execute({
        commandId: idempotencyKey ?? `mcp-${randomUUID()}`,
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        source: 'mcp',
        clientName: context.getClientInfo()?.name ?? null,
        operation: 'ADJUST_QUANTITY',
        target: resource,
        arguments: { delta },
      });
      return toAdjustResult(outcome);
    },
  );
}
