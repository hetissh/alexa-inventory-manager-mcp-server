import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { type Candidate, MATCH_KINDS } from '../domain/matcher.js';
import { type Resource, RESOURCE_TYPES } from '../domain/schemas.js';
import { ALERT_RULES, ALERT_STATUSES, type AlertRecord, type EventRecord, SYNC_STATUSES } from '../domain/types.js';

// JSON-friendly shapes (ISO dates, no internal fields) shared by the tools' output schemas.

export const resourceViewSchema = z.object({
  id: z.string(),
  type: z.enum(RESOURCE_TYPES),
  name: z.string(),
  aliases: z.array(z.string()),
  attributes: z.record(z.string(), z.unknown()),
  version: z.number(),
  updatedAt: z.string().describe('ISO 8601 timestamp of the last change.'),
});

export const candidateViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(RESOURCE_TYPES),
  matchedBy: z.enum(MATCH_KINDS),
  score: z.number().describe('Match quality from 0 to 1.'),
});

export const syncStateSchema = z.enum([...SYNC_STATUSES, 'not_configured']);

export const eventViewSchema = z.object({
  eventId: z.string(),
  commandId: z.string(),
  resourceId: z.string(),
  resourceName: z.string(),
  operation: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  before: z.record(z.string(), z.unknown()),
  after: z.record(z.string(), z.unknown()),
  summary: z.string(),
  actor: z.string(),
  source: z.string(),
  clientName: z.string().nullable(),
  createdAt: z.string().describe('ISO 8601 timestamp.'),
  reversalOf: z.string().nullable().describe('The event this one undid, if it was an undo.'),
  sync: syncStateSchema.describe('Spreadsheet sync state for this event ("not_configured" if no spreadsheet is set up).'),
  syncError: z
    .string()
    .nullable()
    .describe('Why the spreadsheet update failed or is being retried, if it did. Tell the user; retry-sync tries again.'),
});

export const alertViewSchema = z.object({
  id: z.string(),
  resourceId: z.string(),
  resourceName: z.string(),
  rule: z.enum(ALERT_RULES),
  status: z.enum(ALERT_STATUSES),
  message: z.string(),
  createdAt: z.string().describe('ISO 8601 timestamp.'),
  resolvedAt: z.string().nullable(),
});

export type ResourceView = z.infer<typeof resourceViewSchema>;
export type EventView = z.infer<typeof eventViewSchema>;
export type AlertView = z.infer<typeof alertViewSchema>;
export type SyncState = z.infer<typeof syncStateSchema>;

export function toResourceView(resource: Resource): ResourceView {
  return {
    id: resource.id,
    type: resource.type,
    name: resource.name,
    aliases: resource.aliases,
    attributes: resource.attributes,
    version: resource.version,
    updatedAt: resource.updatedAt.toISOString(),
  };
}

export function toCandidateView(candidate: Candidate): z.infer<typeof candidateViewSchema> {
  return { ...candidate };
}

export function toEventView(event: EventRecord, sync: SyncState, syncError: string | null = null): EventView {
  return {
    eventId: event.eventId,
    commandId: event.commandId,
    resourceId: event.resourceId,
    resourceName: event.resourceName,
    operation: event.operation,
    arguments: event.arguments,
    before: event.before,
    after: event.after,
    summary: event.summary,
    actor: event.actor,
    source: event.source,
    clientName: event.clientName,
    createdAt: event.createdAt.toISOString(),
    reversalOf: event.reversalOf,
    sync,
    syncError,
  };
}

export function toAlertView(alert: AlertRecord): AlertView {
  return {
    id: alert.alertId,
    resourceId: alert.resourceId,
    resourceName: alert.resourceName,
    rule: alert.rule,
    status: alert.status,
    message: alert.message,
    createdAt: alert.createdAt.toISOString(),
    resolvedAt: alert.resolvedAt?.toISOString() ?? null,
  };
}

/**
 * Wraps a structured result for MCP. The same data goes in `structuredContent` and, serialised, in a
 * text block, because not every client surfaces structured content to the model.
 */
export function toolResult(structured: Record<string, unknown>, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(structured) }],
    structuredContent: structured,
    ...(isError ? { isError: true } : {}),
  };
}
