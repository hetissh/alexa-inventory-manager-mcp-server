import { describe, expect, it } from 'vitest';

import { computeMetrics, METRIC_KINDS,type MetricDefinition } from '../../src/domain/board.js';
import { evaluateRules } from '../../src/domain/rules/index.js';
import { evaluateLowStock } from '../../src/domain/rules/lowStock.js';
import type { AlertRecord } from '../../src/domain/types.js';
import { cafeTemplate } from '../../src/templates/cafe.js';
import { repairTemplate } from '../../src/templates/repair.js';
import { warehouseTemplate } from '../../src/templates/warehouse.js';
import { cafeResources, inventoryItem, makeResource, repairResources, warehouseResources } from '../helpers/resources.js';

describe('low-stock rule', () => {
  it('is breached only strictly below the reorder level', () => {
    const at = (quantity: number): boolean | undefined =>
      evaluateLowStock(inventoryItem('item_x', 'Widget', [], quantity))?.breached;
    expect(at(4)).toBe(true);
    expect(at(5)).toBe(false); // reorder level in the helper is 5: "at" the level is fine
    expect(at(6)).toBe(false);
    expect(at(0)).toBe(true);
  });

  it('says what is low and by how much', () => {
    expect(evaluateLowStock(inventoryItem('item_x', 'Widget', [], 2))).toEqual({
      rule: 'low_stock',
      breached: true,
      message: 'Widget is low on stock: 2 pieces left (reorder level 5).',
    });
  });

  it('only applies to inventory items', () => {
    const compressor = warehouseResources().find((resource) => resource.type === 'equipment');
    expect(compressor && evaluateLowStock(compressor)).toBeUndefined();
    expect(compressor && evaluateRules(compressor)).toEqual([]);
  });

  it('is part of the rule set', () => {
    expect(evaluateRules(inventoryItem('item_x', 'Widget', [], 2)).map((verdict) => verdict.rule)).toEqual(['low_stock']);
  });
});

const alert = (resourceId: string): AlertRecord => ({
  alertId: '0b7c3f5e-6d0a-4f0e-9a52-1b2d3c4e5f60',
  workspaceId: 'northside-warehouse',
  resourceId,
  resourceName: 'Brake Pads',
  rule: 'low_stock',
  status: 'open',
  message: 'Brake Pads is low on stock.',
  createdAt: new Date(),
  resolvedAt: null,
});

describe('board metrics', () => {
  it('counts low stock from the open alerts', () => {
    const metrics = computeMetrics(warehouseTemplate.board.metrics, warehouseResources(), [alert('item_brake_pads')]);
    expect(metrics).toEqual([
      { label: 'Low stock', value: 1 },
      { label: 'Equipment down', value: 0 },
    ]);
  });

  it('counts equipment that is not available', () => {
    const down = makeResource({
      id: 'equipment_compressor_2',
      type: 'equipment',
      name: 'Compressor 2',
      aliases: [],
      attributes: { status: 'maintenance' },
    });
    const metrics = computeMetrics(warehouseTemplate.board.metrics, [down], []);
    expect(metrics).toEqual([
      { label: 'Low stock', value: 0 },
      { label: 'Equipment down', value: 1 },
    ]);
  });

  it('counts the cafe menu', () => {
    const soldOut = makeResource({
      id: 'menu_lime_soda',
      type: 'menu_item',
      name: 'Lime Soda',
      aliases: [],
      attributes: { price: 80, currency: 'INR', status: 'sold_out' },
    });
    const others = cafeResources().filter((resource) => resource.id !== 'menu_lime_soda');
    expect(computeMetrics(cafeTemplate.board.metrics, [soldOut, ...others], [])).toEqual([
      { label: 'Available', value: 4 },
      { label: 'Sold out', value: 1 },
    ]);
  });

  it('counts open, unassigned jobs and technicians on duty in the repair shop', () => {
    expect(computeMetrics(repairTemplate.board.metrics, repairResources(), [])).toEqual([
      { label: 'Open jobs', value: 3 }, // 108, 109, 110 (107 is done)
      { label: 'Unassigned', value: 2 }, // 108, 110
      { label: 'Technicians on duty', value: 3 }, // Vikram is off
    ]);
  });

  it('can compute every metric kind', () => {
    const definitions: MetricDefinition[] = METRIC_KINDS.map((kind) => ({ label: kind, kind }));
    const metrics = computeMetrics(definitions, [], []);
    expect(metrics.map((metric) => metric.label)).toEqual([...METRIC_KINDS]);
    expect(metrics.every((metric) => metric.value === 0)).toBe(true);
  });
});
