import { describe, expect, it } from 'vitest';

import { resourceRow } from '../../src/app/sheetRows.js';
import { spokenResource } from '../../src/app/spoken.js';
import { computeMetrics } from '../../src/domain/board.js';
import { resolveResource } from '../../src/domain/matcher.js';
import { setStatus } from '../../src/domain/operations/setStatus.js';
import {
  collectionSchema,
  collectionSeedSchema,
  diningTableAttributesSchema,
  type Resource,
  resourceSchema,
  resourceSeedSchema,
  type ResourceType,
} from '../../src/domain/schemas.js';
import { restaurantTemplate } from '../../src/templates/restaurant.js';
import { planFor } from '../helpers/plan.js';
import { restaurantResources } from '../helpers/resources.js';

function find(id: string): Resource {
  const resource = restaurantResources().find((candidate) => candidate.id === id);
  if (!resource) {
    throw new Error(`fixture has no ${id}`);
  }
  return resource;
}

const ofType = (type: ResourceType): Resource[] => restaurantResources().filter((resource) => resource.type === type);

describe('the dining table kind', () => {
  it('needs a snake_case status and a sensible number of seats', () => {
    expect(diningTableAttributesSchema.safeParse({ status: 'free', seats: 4 }).success).toBe(true);
    for (const bad of [{ status: 'Free', seats: 4 }, { status: 'free', seats: 0 }, { status: 'free', seats: 101 }, { status: 'free', seats: 2.5 }, { status: 'free' }]) {
      expect(diningTableAttributesSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('parses as a seed and as a persisted resource', () => {
    const seed = { id: 'table_9', collection: 'dining_tables', type: 'dining_table', name: 'Table 9', aliases: [], attributes: { status: 'free', seats: 2 } };
    expect(resourceSeedSchema.safeParse(seed).success).toBe(true);
    expect(resourceSchema.safeParse({ ...seed, workspaceId: 'lakeview-restaurant', version: 1, updatedAt: new Date() }).success).toBe(true);
    expect(resourceSeedSchema.safeParse({ ...seed, attributes: { status: 'free' } }).success).toBe(false);
  });

  it('is said aloud with its seats and state', () => {
    expect(spokenResource(find('table_5'))).toBe('Table 5 (seats 4) is free.');
    expect(spokenResource(find('table_3'))).toBe('Table 3 (seats 4) is occupied.');
  });

  it('is one row of the spreadsheet with its state and seats', () => {
    const table = find('table_6');
    expect(resourceRow(table, new Map())).toEqual([
      'table_6',
      'dining_table',
      'Table 6',
      '',
      '',
      'reserved',
      '',
      table.updatedAt.toISOString(),
      'seats 8',
    ]);
  });

  it('is counted on the board by state', () => {
    const metrics = computeMetrics(restaurantTemplate.board.metrics, restaurantResources(), []);
    expect(metrics).toEqual([
      { label: 'Tables free', value: 4 },
      { label: 'Tables occupied', value: 1 },
      { label: 'Dishes sold out', value: 0 },
      { label: 'Low stock', value: 0 },
    ]);
    expect(computeMetrics([{ label: 'Held', kind: 'tables_reserved' }], restaurantResources(), [])).toEqual([{ label: 'Held', value: 1 }]);
  });

  it('is found the way people say it', () => {
    const tables = ofType('dining_table');
    for (const spoken of ['table five', 'table 5', 'Table 5']) {
      const resolution = resolveResource(spoken, tables, { autoResolveFuzzy: false });
      expect(resolution.kind, spoken).toBe('resolved');
      if (resolution.kind === 'resolved') {
        expect(resolution.match.resource.name).toBe('Table 5');
      }
    }
    expect(resolveResource('table', tables, { autoResolveFuzzy: false }).kind).toBe('ambiguous');
    expect(resolveResource('table nine', tables, { autoResolveFuzzy: false }).kind).toBe('not_found');
  });
});

describe('changing the status of a table', () => {
  it('asks before reserving a free table, and keeps its seats', () => {
    expect(planFor(setStatus, find('table_5'), { status: 'reserved' })).toEqual({
      kind: 'ready',
      attributes: { status: 'reserved', seats: 4 },
      before: { status: 'free' },
      after: { status: 'reserved' },
      summary: 'Changed Table 5 from free to reserved',
      spoken: 'Table 5 is now reserved.',
      confirmation: { reason: 'status_change', readback: 'Mark Table 5 as reserved (currently free)?' },
    });
  });

  it.each([
    ['table_5', 'booked', 'reserved'],
    ['table_5', 'seated', 'occupied'],
    ['table_3', 'vacant', 'free'],
    ['table_3', 'empty', 'free'],
    ['table_6', 'available', 'free'],
    ['table_3', 'dirty', 'cleaning'],
    ['table_3', 'being cleaned', 'cleaning'],
    ['table_3', 'Cleaning', 'cleaning'],
  ])('understands "%s" and "%s" as %s', (id, said, expected) => {
    const plan = planFor(setStatus, find(id), { status: said });
    expect(plan).toMatchObject({ kind: 'ready', after: { status: expected } });
  });

  it('says what the valid statuses are when asked for one a table cannot have', () => {
    for (const said of ['out of service', 'sold out', 'maintenance']) {
      expect(planFor(setStatus, find('table_5'), { status: said })).toEqual({
        kind: 'rejected',
        code: 'INVALID_STATUS',
        message: `"${said}" is not a valid status for Table 5. Choose one of: free, occupied, reserved, cleaning.`,
      });
    }
  });

  it('says so when the table is already in that state', () => {
    expect(planFor(setStatus, find('table_3'), { status: 'occupied' })).toEqual({
      kind: 'rejected',
      code: 'NO_CHANGE',
      message: 'Table 3 is already occupied.',
    });
  });

  it('does not let a dish be "reserved" or a table be "sold out"', () => {
    expect(planFor(setStatus, find('dish_garlic_naan'), { status: 'reserved' })).toMatchObject({ kind: 'rejected', code: 'INVALID_STATUS' });
    expect(planFor(setStatus, find('table_1'), { status: 'sold out' })).toMatchObject({ kind: 'rejected', code: 'INVALID_STATUS' });
  });

  it('refuses a thing that has no status', () => {
    expect(planFor(setStatus, find('item_paneer'), { status: 'free' })).toEqual({
      kind: 'rejected',
      code: 'INVALID_TARGET',
      message: 'Paneer does not have a status.',
    });
  });
});

describe('collections', () => {
  const seed = { key: 'dining_tables', label: 'Dining tables', kind: 'dining_table', aliases: ['tables'] };

  it('need a lowercase key, a safe label and a kind the engine knows', () => {
    expect(collectionSeedSchema.safeParse(seed).success).toBe(true);
    for (const bad of [
      { ...seed, key: 'Dining Tables' },
      { ...seed, key: 'ab' },
      { ...seed, key: 'a'.repeat(41) },
      { ...seed, label: '<b>Tables</b>' },
      { ...seed, label: '' },
      { ...seed, kind: 'bakery' },
      { ...seed, aliases: Array.from({ length: 11 }, (_, index) => `list ${String(index)}`) },
    ]) {
      expect(collectionSeedSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('are positioned inside a workspace once stored', () => {
    expect(collectionSchema.safeParse({ ...seed, workspaceId: 'lakeview-restaurant', position: 3 }).success).toBe(true);
    expect(collectionSchema.safeParse({ ...seed, workspaceId: 'lakeview-restaurant', position: -1 }).success).toBe(false);
    expect(collectionSchema.safeParse(seed).success).toBe(false);
  });
});

describe('the restaurant preset', () => {
  it('has four lists, one of each kind a restaurant keeps', () => {
    expect(restaurantTemplate.collections.map((collection) => [collection.key, collection.kind])).toEqual([
      ['dishes', 'menu_item'],
      ['ingredients', 'inventory_item'],
      ['kitchen_equipment', 'equipment'],
      ['dining_tables', 'dining_table'],
    ]);
  });

  it('lets "paneer" mean the dish when a status is set and the ingredient when stock changes', () => {
    const asStatusTarget = resolveResource('paneer', [...ofType('menu_item'), ...ofType('equipment'), ...ofType('dining_table')], {
      autoResolveFuzzy: false,
    });
    const asStockTarget = resolveResource('paneer', ofType('inventory_item'), { autoResolveFuzzy: false });

    expect(asStatusTarget.kind === 'resolved' && asStatusTarget.match.resource.name).toBe('Paneer Tikka');
    expect(asStockTarget.kind === 'resolved' && asStockTarget.match.resource.name).toBe('Paneer');
  });
});
