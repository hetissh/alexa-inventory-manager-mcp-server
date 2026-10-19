import { z } from 'zod';

import {
  ALERT_RULES,
  ALERT_STATUSES,
  COMMAND_SOURCES,
  COMMAND_STATUSES,
  JOB_STATUSES,
  type JsonValue,
  OPERATION_NAMES,
  TEMPLATE_IDS,
} from './types.js';

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
export const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

// Names and aliases end up in tool output that a model reads, so reject control/format
// characters (hidden text, bidi tricks) and angle brackets at the boundary.
const SAFE_TEXT = /^[^\p{Cc}\p{Cf}<>]+$/u;
const safeText = (max: number): z.ZodString =>
  z.string().trim().min(1).max(max).regex(SAFE_TEXT, 'must not contain control characters or < >');

export const workspaceIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'must be a lowercase slug (a-z, 0-9, -)');
export const actorIdSchema = z.string().regex(/^[A-Za-z0-9._:@-]{1,64}$/, 'must be 1-64 characters of A-Z a-z 0-9 . _ : @ -');
export const resourceIdSchema = z.string().regex(/^[a-z][a-z0-9_]{2,63}$/, 'must be a lowercase identifier (a-z, 0-9, _)');
export const resourceNameSchema = safeText(80);
export const aliasesSchema = z.array(resourceNameSchema).max(10);

export const RESOURCE_TYPES = ['inventory_item', 'equipment', 'menu_item', 'dining_table', 'job', 'technician'] as const;
export const resourceTypeSchema = z.enum(RESOURCE_TYPES);
export type ResourceType = z.infer<typeof resourceTypeSchema>;

const statusSchema = z.string().regex(/^[a-z][a-z_]{0,39}$/, 'must be a lowercase snake_case status');

export const inventoryAttributesSchema = z.object({
  quantity: z.number().int().nonnegative(),
  unit: safeText(20),
  reorderLevel: z.number().int().nonnegative(),
});

export const equipmentAttributesSchema = z.object({ status: statusSchema });

export const menuItemAttributesSchema = z.object({
  price: z.number().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/, 'must be a 3-letter currency code'),
  status: statusSchema,
});

export const diningTableAttributesSchema = z.object({
  status: statusSchema,
  seats: z.number().int().positive().max(100),
});

export const jobAttributesSchema = z.object({
  status: z.enum(JOB_STATUSES),
  assigneeId: resourceIdSchema.nullable(),
  description: safeText(80),
});

export const technicianAttributesSchema = z.object({ active: z.boolean() });

/**
 * A collection is a named list inside a workspace (the user's "data table": Dishes, Ingredients, Dining tables).
 * Its `kind` is one of the resource types and decides which operations apply to what is in it.
 */
export const collectionKeySchema = z.string().regex(/^[a-z][a-z0-9_]{2,39}$/, 'must be a lowercase identifier (a-z, 0-9, _)');
export const collectionSeedSchema = z.object({
  key: collectionKeySchema,
  label: safeText(60),
  kind: resourceTypeSchema,
  aliases: aliasesSchema,
});
export type CollectionSeed = z.infer<typeof collectionSeedSchema>;

export const collectionSchema = collectionSeedSchema.extend({
  workspaceId: workspaceIdSchema,
  position: z.number().int().nonnegative(),
});
export type Collection = z.infer<typeof collectionSchema>;

const seedBase = {
  id: resourceIdSchema,
  name: resourceNameSchema,
  aliases: aliasesSchema,
  /** The key of the collection this resource lives in. Its kind must equal the resource's type. */
  collection: collectionKeySchema,
};

/** A resource as written in a template/fixture, before it has a workspace, version or timestamps. */
export const resourceSeedSchema = z.discriminatedUnion('type', [
  z.object({ ...seedBase, type: z.literal('inventory_item'), attributes: inventoryAttributesSchema }),
  z.object({ ...seedBase, type: z.literal('equipment'), attributes: equipmentAttributesSchema }),
  z.object({ ...seedBase, type: z.literal('menu_item'), attributes: menuItemAttributesSchema }),
  z.object({ ...seedBase, type: z.literal('dining_table'), attributes: diningTableAttributesSchema }),
  z.object({ ...seedBase, type: z.literal('job'), attributes: jobAttributesSchema }),
  z.object({ ...seedBase, type: z.literal('technician'), attributes: technicianAttributesSchema }),
]);
export type ResourceSeed = z.infer<typeof resourceSeedSchema>;

const persistedBase = { workspaceId: workspaceIdSchema, version: z.number().int().positive(), updatedAt: z.date() };

export const resourceSchema = z.discriminatedUnion('type', [
  z.object({ ...seedBase, ...persistedBase, type: z.literal('inventory_item'), attributes: inventoryAttributesSchema }),
  z.object({ ...seedBase, ...persistedBase, type: z.literal('equipment'), attributes: equipmentAttributesSchema }),
  z.object({ ...seedBase, ...persistedBase, type: z.literal('menu_item'), attributes: menuItemAttributesSchema }),
  z.object({ ...seedBase, ...persistedBase, type: z.literal('dining_table'), attributes: diningTableAttributesSchema }),
  z.object({ ...seedBase, ...persistedBase, type: z.literal('job'), attributes: jobAttributesSchema }),
  z.object({ ...seedBase, ...persistedBase, type: z.literal('technician'), attributes: technicianAttributesSchema }),
]);
export type Resource = z.infer<typeof resourceSchema>;
export type InventoryItem = Extract<Resource, { type: 'inventory_item' }>;

export const workspaceSchema = z.object({
  id: workspaceIdSchema,
  name: safeText(80),
  template: z.enum(TEMPLATE_IDS),
  timezone: z.string().min(1).max(64),
  boardVersion: z.number().int().nonnegative(),
  integrations: z.object({ sheets: z.object({ spreadsheetId: z.string().min(1) }).optional() }),
});

export const eventRecordSchema = z.object({
  eventId: z.uuid(),
  seq: z.number().int().positive(),
  workspaceId: workspaceIdSchema,
  commandId: z.string().min(1),
  resourceId: resourceIdSchema,
  resourceName: z.string().min(1),
  operation: z.enum(OPERATION_NAMES),
  arguments: jsonObjectSchema,
  before: jsonObjectSchema,
  after: jsonObjectSchema,
  summary: z.string().min(1),
  actor: z.string().min(1),
  source: z.enum(COMMAND_SOURCES),
  clientName: z.string().nullable(),
  createdAt: z.date(),
  reversalOf: z.uuid().nullable(),
});

export const alertRecordSchema = z.object({
  alertId: z.uuid(),
  workspaceId: workspaceIdSchema,
  resourceId: resourceIdSchema,
  resourceName: z.string().min(1),
  rule: z.enum(ALERT_RULES),
  status: z.enum(ALERT_STATUSES),
  message: z.string().min(1),
  createdAt: z.date(),
  resolvedAt: z.date().nullable(),
});

export const commandRecordSchema = z.object({
  id: z.uuid(),
  workspaceId: workspaceIdSchema,
  commandId: z.string().min(1),
  actor: z.string().min(1),
  source: z.enum(COMMAND_SOURCES),
  clientName: z.string().nullable(),
  operation: z.enum(OPERATION_NAMES),
  resourceId: resourceIdSchema,
  arguments: jsonObjectSchema,
  secondaryResourceId: resourceIdSchema.nullable(),
  reversingEventId: z.uuid().nullable(),
  expectedVersion: z.number().int().positive(),
  reason: z.string().min(1),
  readback: z.string().min(1),
  status: z.enum(COMMAND_STATUSES),
  eventId: z.uuid().nullable(),
  expiresAt: z.date(),
  createdAt: z.date(),
  resolvedAt: z.date().nullable(),
});
