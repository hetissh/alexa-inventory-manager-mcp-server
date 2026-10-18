import { type Resource, resourceSchema, type ResourceSeed } from '../../src/domain/schemas.js';
import { warehouseTemplate } from '../../src/templates/warehouse.js';

const BASE = { workspaceId: 'northside-warehouse', version: 1, updatedAt: new Date('2026-10-18T10:00:00.000Z') };

export function makeResource(seed: ResourceSeed): Resource {
  return resourceSchema.parse({ ...BASE, ...seed });
}

/** The warehouse fixture as in-memory resources (no database). */
export function warehouseResources(): Resource[] {
  return warehouseTemplate.resources.map(makeResource);
}

export function inventoryItem(id: string, name: string, aliases: string[] = [], quantity = 10): Resource {
  return makeResource({
    id,
    type: 'inventory_item',
    name,
    aliases,
    attributes: { quantity, unit: 'pieces', reorderLevel: 5 },
  });
}
