import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { type Candidate, MATCH_KINDS } from '../domain/matcher.js';
import { type Resource, RESOURCE_TYPES } from '../domain/schemas.js';
import { type EventRecord, SYNC_STATUSES } from '../domain/types.js';

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
  sync: syncStateSchema.describe('Spreadsheet sync state for this event ("not_configured" if no spreadsheet is set up).'),
});

export type ResourceView = z.infer<typeof resourceViewSchema>;
export type EventView = z.infer<typeof eventViewSchema>;
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

export function toEventView(event: EventRecord, sync: SyncState): EventView {
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
    sync,
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
