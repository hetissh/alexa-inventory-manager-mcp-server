import { type Resource, resourceSchema, type ResourceSeed, type ResourceType } from '../../src/domain/schemas.js';
import { cafeTemplate } from '../../src/templates/cafe.js';
import { repairTemplate } from '../../src/templates/repair.js';
import { restaurantTemplate } from '../../src/templates/restaurant.js';
import { warehouseTemplate } from '../../src/templates/warehouse.js';

const BASE = { workspaceId: 'northside-warehouse', version: 1, updatedAt: new Date('2026-10-18T10:00:00.000Z') };

/** Where a resource lives when a test does not say, matching the collections the migration creates. */
const DEFAULT_COLLECTION: Readonly<Record<ResourceType, string>> = {
  inventory_item: 'stock',
  equipment: 'equipment',
  menu_item: 'menu',
  dining_table: 'tables',
  job: 'jobs',
  technician: 'technicians',
};

type WithOptionalCollection<T> = T extends unknown ? Omit<T, 'collection'> & { collection?: string } : never;

export function makeResource(seed: WithOptionalCollection<ResourceSeed>): Resource {
  return resourceSchema.parse({ ...BASE, collection: DEFAULT_COLLECTION[seed.type], ...seed });
}

/** The warehouse fixture as in-memory resources (no database). */
export function warehouseResources(): Resource[] {
  return warehouseTemplate.resources.map(makeResource);
}

export function cafeResources(): Resource[] {
  return cafeTemplate.resources.map(makeResource);
}

export function restaurantResources(): Resource[] {
  return restaurantTemplate.resources.map(makeResource);
}

export function repairResources(): Resource[] {
  return repairTemplate.resources.map(makeResource);
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
