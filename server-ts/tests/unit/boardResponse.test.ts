import { describe, expect, it } from 'vitest';

import type { Board } from '../../src/app/readService.js';
import type { AlertRecord, EventRecord } from '../../src/domain/types.js';
import { toBoardResponse } from '../../src/http/boardResponse.js';
import { inventoryItem, warehouseResources } from '../helpers/resources.js';

const alert: AlertRecord = {
  alertId: '0b7c3f5e-6d0a-4f0e-9a52-1b2d3c4e5f60',
  workspaceId: 'northside-warehouse',
  resourceId: 'item_brake_pads',
  resourceName: 'Brake Pads',
  rule: 'low_stock',
  status: 'open',
  message: 'Brake Pads is low on stock: 2 pieces left (reorder level 5).',
  createdAt: new Date('2026-10-19T09:00:00.000Z'),
  resolvedAt: null,
};

const event: EventRecord & { sync: 'synced'; syncError: null } = {
  eventId: '0b7c3f5e-6d0a-4f0e-9a52-1b2d3c4e5f61',
  seq: 1,
  workspaceId: 'northside-warehouse',
  commandId: 'secret-command-id',
  resourceId: 'item_brake_pads',
  resourceName: 'Brake Pads',
  operation: 'ADJUST_QUANTITY',
  arguments: { delta: -10 },
  before: { quantity: 12 },
  after: { quantity: 2 },
  summary: 'Removed 10 pieces from Brake Pads (12 to 2)',
  actor: 'manager-1',
  source: 'mcp',
  clientName: 'secret-client',
  createdAt: new Date('2026-10-19T09:00:05.000Z'),
  reversalOf: null,
  sync: 'synced',
  syncError: null,
};

const board: Board = {
  workspaceId: 'northside-warehouse',
  title: 'Northside Operations',
  version: 7,
  generatedAt: new Date('2026-10-19T09:01:00.000Z'),
  metrics: [{ label: 'Low stock', value: 1 }],
  resources: [
    { resource: inventoryItem('item_brake_pads', 'Brake Pads', [], 2), hasAlert: true },
    ...warehouseResources().slice(1, 2).map((resource) => ({ resource, hasAlert: false })),
  ],
  alerts: [alert],
  recentActivity: [event],
  spoken: 'Northside Operations: Low stock 1.',
};

describe('toBoardResponse', () => {
  it('sends exactly what a screen draws, with ISO dates', () => {
    expect(toBoardResponse(board)).toEqual({
      workspaceId: 'northside-warehouse',
      title: 'Northside Operations',
      version: 7,
      generatedAt: '2026-10-19T09:01:00.000Z',
      metrics: [{ label: 'Low stock', value: 1 }],
      resources: [
        { id: 'item_brake_pads', type: 'inventory_item', name: 'Brake Pads', attributes: { quantity: 2, unit: 'pieces', reorderLevel: 5 }, hasAlert: true },
        { id: 'item_oil_filter', type: 'inventory_item', name: 'Oil Filter', attributes: { quantity: 20, unit: 'pieces', reorderLevel: 8 }, hasAlert: false },
      ],
      alerts: [
        {
          id: '0b7c3f5e-6d0a-4f0e-9a52-1b2d3c4e5f60',
          resourceId: 'item_brake_pads',
          resourceName: 'Brake Pads',
          message: 'Brake Pads is low on stock: 2 pieces left (reorder level 5).',
          createdAt: '2026-10-19T09:00:00.000Z',
        },
      ],
      recentActivity: [
        { summary: 'Removed 10 pieces from Brake Pads (12 to 2)', resourceName: 'Brake Pads', createdAt: '2026-10-19T09:00:05.000Z' },
      ],
    });
  });

  it('leaves out who did what and how: a board may be on a wall anyone can see', () => {
    const text = JSON.stringify(toBoardResponse(board));
    for (const secret of ['manager-1', 'secret-command-id', 'secret-client', 'ADJUST_QUANTITY', '"before"', '"after"', '"source"', '"actor"', '"commandId"']) {
      expect(text).not.toContain(secret);
    }
  });
});
