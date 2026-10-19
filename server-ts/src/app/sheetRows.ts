import type { Resource } from '../domain/schemas.js';
import type { EventRecord } from '../domain/types.js';
import type { SheetRow } from './syncPorts.js';

// The two tabs of the spreadsheet. The first eight Resources columns and all Activity columns follow the
// product plan (§9); "Details" is an extra last column for what does not fit the others (price, job description).
export const RESOURCES_HEADER = [
  'Resource ID',
  'Type',
  'Name',
  'Quantity',
  'Unit',
  'Status',
  'Assignee',
  'Updated at',
  'Details',
] as const;

export const ACTIVITY_HEADER = [
  'Event ID',
  'Time',
  'Actor',
  'Operation',
  'Resource',
  'Before',
  'After',
  'Sync status',
] as const;

const spaced = (status: string): string => status.replaceAll('_', ' ');

/** One row of the Resources tab. Rows are keyed by resource id, never by display name. */
export function resourceRow(resource: Resource, names: ReadonlyMap<string, string>): SheetRow {
  const head = [resource.id, resource.type, resource.name] as const;
  const updatedAt = resource.updatedAt.toISOString();
  switch (resource.type) {
    case 'inventory_item': {
      const { quantity, unit, reorderLevel } = resource.attributes;
      return [...head, quantity, unit, '', '', updatedAt, `reorder at ${String(reorderLevel)}`];
    }
    case 'equipment':
      return [...head, '', '', spaced(resource.attributes.status), '', updatedAt, ''];
    case 'menu_item': {
      const { price, currency, status } = resource.attributes;
      return [...head, '', '', spaced(status), '', updatedAt, `${String(price)} ${currency}`];
    }
    case 'dining_table': {
      const { status, seats } = resource.attributes;
      return [...head, '', '', spaced(status), '', updatedAt, `seats ${String(seats)}`];
    }
    case 'job': {
      const { status, assigneeId, description } = resource.attributes;
      const assignee = assigneeId === null ? '' : (names.get(assigneeId) ?? assigneeId);
      return [...head, '', '', spaced(status), assignee, updatedAt, description];
    }
    case 'technician':
      return [...head, '', '', resource.attributes.active ? 'on duty' : 'off duty', '', updatedAt, ''];
  }
}

export function resourceRows(resources: readonly Resource[]): SheetRow[] {
  const names = new Map(resources.map((resource) => [resource.id, resource.name]));
  return resources.map((resource) => resourceRow(resource, names));
}

/** One row of the Activity tab. The sheet only ever gets it once the update has gone through, hence "synced". */
export function activityRow(event: EventRecord): SheetRow {
  return [
    event.eventId,
    event.createdAt.toISOString(),
    event.actor,
    event.operation,
    event.resourceName,
    JSON.stringify(event.before),
    JSON.stringify(event.after),
    'synced',
  ];
}
