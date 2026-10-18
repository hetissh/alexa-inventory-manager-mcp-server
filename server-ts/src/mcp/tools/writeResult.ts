import { randomUUID } from 'node:crypto';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { CommandOutcome } from '../../app/commandService.js';
import { REJECTION_CODES } from '../../domain/operations/types.js';
import type { OperationName } from '../../domain/types.js';
import {
  alertViewSchema,
  candidateViewSchema,
  eventViewSchema,
  resourceViewSchema,
  syncStateSchema,
  toAlertView,
  toCandidateView,
  toEventView,
  toolResult,
  toResourceView,
} from '../views.js';
import type { ToolContext } from './context.js';

/** The one result shape every tool that can change something returns. */
export const writeOutputSchema = {
  status: z.enum(['committed', 'confirmation_required', 'cancelled', 'ambiguous', 'not_found', 'rejected', 'conflict']),
  spoken: z.string().describe('A sentence suitable for reading aloud. Quote it; do not embellish.'),
  workspaceId: z.string(),
  replayed: z.boolean().optional().describe('True when this exact request had already been applied and nothing new was written.'),
  code: z.enum(REJECTION_CODES).optional().describe('Why the change was refused (rejected only).'),
  message: z.string().optional(),
  query: z.string().optional().describe('The name that was looked up (ambiguous and not_found only).'),
  role: z.string().optional().describe('Which name that was, when it is not the main target, for example "assignee".'),
  candidates: z.array(candidateViewSchema).optional(),
  confirmation: z
    .object({
      token: z.string().describe('Pass this to confirm-command (if the user says yes) or cancel-command (if no).'),
      readback: z.string().describe('The question to put to the user, word for word.'),
      reason: z.string(),
      expiresAt: z.string().describe('ISO 8601 time after which the token stops working.'),
    })
    .optional()
    .describe('Present when nothing has changed yet and the user must approve first.'),
  event: eventViewSchema.optional().describe('The recorded change, with before and after values.'),
  resource: resourceViewSchema.optional().describe('The resource as it is now.'),
  alerts: z
    .object({ opened: z.array(alertViewSchema), resolved: z.array(alertViewSchema) })
    .optional()
    .describe('Alerts this change opened or cleared (for example low stock).'),
  sync: z
    .object({ sheets: syncStateSchema })
    .optional()
    .describe('Whether the spreadsheet has been updated. Only claim a spreadsheet update if this says so.'),
};

export function toWriteResult(workspaceId: string, outcome: CommandOutcome): CallToolResult {
  const base = { status: outcome.status, spoken: outcome.spoken, workspaceId };
  switch (outcome.status) {
    case 'committed':
      return toolResult({
        ...base,
        replayed: outcome.replayed,
        event: toEventView(outcome.event, outcome.sync.sheets),
        resource: toResourceView(outcome.resource),
        alerts: { opened: outcome.alerts.opened.map(toAlertView), resolved: outcome.alerts.resolved.map(toAlertView) },
        sync: outcome.sync,
      });
    case 'confirmation_required':
      return toolResult({
        ...base,
        confirmation: { ...outcome.confirmation, expiresAt: outcome.confirmation.expiresAt.toISOString() },
      });
    case 'cancelled':
      return toolResult(base);
    case 'ambiguous':
      return toolResult({
        ...base,
        query: outcome.query,
        ...(outcome.role ? { role: outcome.role } : {}),
        candidates: outcome.candidates.map(toCandidateView),
      });
    case 'not_found':
      return toolResult({ ...base, query: outcome.query, ...(outcome.role ? { role: outcome.role } : {}) });
    case 'rejected':
      return toolResult({ ...base, code: outcome.code, message: outcome.message }, true);
    case 'conflict':
      return toolResult({ ...base, message: outcome.message }, true);
  }
}

/** Sends one change request through the command service and shapes the answer for MCP. */
export async function requestChange(
  context: ToolContext,
  workspaceId: string,
  request: {
    readonly operation: OperationName;
    readonly target: string;
    readonly arguments: unknown;
    readonly idempotencyKey: string | undefined;
  },
): Promise<CallToolResult> {
  const outcome = await context.commands.execute({
    commandId: request.idempotencyKey ?? `mcp-${randomUUID()}`,
    workspaceId,
    actorId: context.actorId,
    source: 'mcp',
    clientName: context.getClientInfo()?.name ?? null,
    operation: request.operation,
    target: request.target,
    arguments: request.arguments,
  });
  return toWriteResult(workspaceId, outcome);
}
