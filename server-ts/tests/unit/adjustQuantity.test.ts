import { describe, expect, it } from 'vitest';

import { adjustQuantity } from '../../src/domain/operations/adjustQuantity.js';
import type { OperationPlan } from '../../src/domain/operations/types.js';
import type { Resource } from '../../src/domain/schemas.js';
import { warehouseTemplate } from '../../src/templates/warehouse.js';
import { inventoryItem, warehouseResources } from '../helpers/resources.js';

const { settings } = warehouseTemplate;

function planFor(resource: Resource, args: unknown): OperationPlan {
  const binding = adjustQuantity.bind(args);
  if (!binding.ok) {
    throw new Error(`unexpected bind failure: ${binding.message}`);
  }
  return binding.bound.plan(resource, settings);
}

const airFilter = (): Resource => inventoryItem('item_air_filter', 'Air Filter', [], 35);
const brakePads = (): Resource => inventoryItem('item_brake_pads', 'Brake Pads', [], 12);

describe('adjustQuantity.bind', () => {
  it('targets inventory items only', () => {
    expect(adjustQuantity.name).toBe('ADJUST_QUANTITY');
    expect(adjustQuantity.targetTypes).toEqual(['inventory_item']);
  });

  it.each([
    ['missing delta', {}, /delta/],
    ['zero', { delta: 0 }, /must not be zero/],
    ['fractional', { delta: 1.5 }, /delta/],
    ['a string', { delta: '20' }, /delta/],
    ['not an object', 'twenty', /arguments/],
  ])('rejects %s', (_label, args, message) => {
    const binding = adjustQuantity.bind(args);
    expect(binding.ok).toBe(false);
    expect(!binding.ok && binding.message).toMatch(message);
  });

  it('exposes the validated arguments', () => {
    const binding = adjustQuantity.bind({ delta: 20, ignored: true });
    expect(binding.ok && binding.bound.arguments).toEqual({ delta: 20 });
  });
});

describe('adjustQuantity plan', () => {
  it('adds stock and describes the change', () => {
    expect(planFor(airFilter(), { delta: 20 })).toEqual({
      kind: 'ready',
      attributes: { quantity: 55, unit: 'pieces', reorderLevel: 5 },
      before: { quantity: 35 },
      after: { quantity: 55 },
      summary: 'Added 20 pieces to Air Filter (35 to 55)',
      spoken: 'Added 20. Air Filter is now at 55 pieces.',
    });
  });

  it('removes stock', () => {
    expect(planFor(airFilter(), { delta: -10 })).toMatchObject({
      kind: 'ready',
      after: { quantity: 25 },
      summary: 'Removed 10 pieces from Air Filter (35 to 25)',
      spoken: 'Removed 10. Air Filter is now at 25 pieces.',
    });
  });

  it('refuses to go below zero and says how much is in stock', () => {
    expect(planFor(brakePads(), { delta: -20 })).toEqual({
      kind: 'rejected',
      code: 'INSUFFICIENT_STOCK',
      message: 'Cannot remove 20 pieces of Brake Pads: only 12 in stock.',
    });
  });

  it('refuses an implausibly large number outright', () => {
    expect(planFor(airFilter(), { delta: settings.maxAdjustment + 1 })).toMatchObject({
      kind: 'rejected',
      code: 'LIMIT_EXCEEDED',
    });
  });

  it('asks for confirmation on a large adjustment', () => {
    expect(planFor(airFilter(), { delta: settings.largeAdjustThreshold })).toEqual({
      kind: 'needs_confirmation',
      reason: 'large_adjustment',
      readback: 'Added 100 pieces to Air Filter (35 to 135)?',
    });
  });

  it('asks for confirmation on a large removal', () => {
    const plan = planFor(inventoryItem('item_air_filter', 'Air Filter', [], 500), { delta: -100 });
    expect(plan).toMatchObject({ kind: 'needs_confirmation', reason: 'large_adjustment' });
  });

  it('asks for confirmation when the change would leave nothing', () => {
    expect(planFor(brakePads(), { delta: -12 })).toEqual({
      kind: 'needs_confirmation',
      reason: 'reaches_zero',
      readback: 'Removed 12 pieces from Brake Pads, leaving none in stock?',
    });
  });

  it('rejects a resource that is not an inventory item', () => {
    const compressor = warehouseResources().find((resource) => resource.type === 'equipment');
    if (!compressor) {
      throw new Error('the warehouse fixture should include equipment');
    }
    expect(planFor(compressor, { delta: 1 })).toEqual({
      kind: 'rejected',
      code: 'INVALID_TARGET',
      message: 'Compressor 2 is not an inventory item.',
    });
  });
});
