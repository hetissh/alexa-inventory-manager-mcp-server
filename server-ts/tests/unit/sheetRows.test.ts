import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_HEADER,
  activityRow,
  resourceRow,
  resourceRows,
  RESOURCES_HEADER,
} from '../../src/app/sheetRows.js';
import type { EventRecord } from '../../src/domain/types.js';
import { cafeResources, inventoryItem, makeResource, repairResources, warehouseResources } from '../helpers/resources.js';

const UPDATED = '2026-10-18T10:00:00.000Z';
const NONE = new Map<string, string>();

describe('Resources tab rows', () => {
  it('has a header that matches the width of every row', () => {
    expect(RESOURCES_HEADER).toHaveLength(9);
    for (const resource of [...warehouseResources(), ...cafeResources(), ...repairResources()]) {
      expect(resourceRow(resource, NONE)).toHaveLength(RESOURCES_HEADER.length);
    }
  });

  it('describes stock with quantity, unit and the reorder level', () => {
    expect(resourceRow(inventoryItem('item_air_filter', 'Air Filter', [], 35), NONE)).toEqual([
      'item_air_filter', 'inventory_item', 'Air Filter', 35, 'pieces', '', '', UPDATED, 'reorder at 5',
    ]);
  });

  it('describes equipment by status, with underscores turned into spaces', () => {
    const broken = makeResource({ id: 'equipment_lift_1', type: 'equipment', name: 'Lift 1', aliases: [], attributes: { status: 'out_of_service' } });
    expect(resourceRow(broken, NONE)).toEqual(['equipment_lift_1', 'equipment', 'Lift 1', '', '', 'out of service', '', UPDATED, '']);
  });

  it('describes a menu item with its status and price', () => {
    const [biryani] = cafeResources();
    expect(biryani && resourceRow(biryani, NONE)).toEqual([
      'menu_chicken_biryani', 'menu_item', 'Chicken Biryani', '', '', 'available', '', UPDATED, '260 INR',
    ]);
  });

  it('describes a job with its assignee by name, or by id when the name is unknown, or blank when unassigned', () => {
    const jobs = repairResources();
    const names = new Map(jobs.map((resource) => [resource.id, resource.name]));
    const job = (id: string) => jobs.find((resource) => resource.id === id);
    const assigned = job('job_109');
    const unassigned = job('job_108');
    expect(assigned && resourceRow(assigned, names)).toEqual([
      'job_109', 'job', 'Job 109', '', '', 'in progress', 'Priya', UPDATED, 'AC compressor replacement',
    ]);
    expect(assigned && resourceRow(assigned, NONE)[6]).toBe('tech_priya');
    expect(unassigned && resourceRow(unassigned, names)[6]).toBe('');
  });

  it('describes a technician as on or off duty', () => {
    const technicians = repairResources().filter((resource) => resource.type === 'technician');
    expect(technicians.map((technician) => resourceRow(technician, NONE)[5])).toEqual(['on duty', 'on duty', 'on duty', 'off duty']);
  });

  it('builds the whole tab, resolving assignee names from the same workspace', () => {
    const rows = resourceRows(repairResources());
    expect(rows).toHaveLength(8);
    expect(rows.find((row) => row[0] === 'job_109')?.[6]).toBe('Priya');
  });

  it('keeps a hostile-looking name as plain text in the row (the gateway writes it unparsed)', () => {
    const tricky = inventoryItem('item_formula', '=HYPERLINK("http://example.invalid")');
    expect(resourceRow(tricky, NONE)[2]).toBe('=HYPERLINK("http://example.invalid")');
  });
});

describe('Activity tab rows', () => {
  const event: EventRecord = {
    eventId: '0b7c3f5e-6d0a-4f0e-9a52-1b2d3c4e5f60',
    seq: 1,
    workspaceId: 'northside-warehouse',
    commandId: 'cmd-1',
    resourceId: 'item_air_filter',
    resourceName: 'Air Filter',
    operation: 'ADJUST_QUANTITY',
    arguments: { delta: 20 },
    before: { quantity: 35 },
    after: { quantity: 55 },
    summary: 'Added 20 pieces to Air Filter (35 to 55)',
    actor: 'manager-1',
    source: 'mcp',
    clientName: null,
    createdAt: new Date('2026-10-19T09:00:00.000Z'),
    reversalOf: null,
  };

  it('has one column per header and records who, what and before/after', () => {
    expect(ACTIVITY_HEADER).toHaveLength(8);
    expect(activityRow(event)).toEqual([
      '0b7c3f5e-6d0a-4f0e-9a52-1b2d3c4e5f60',
      '2026-10-19T09:00:00.000Z',
      'manager-1',
      'ADJUST_QUANTITY',
      'Air Filter',
      '{"quantity":35}',
      '{"quantity":55}',
      'synced',
    ]);
  });
});
