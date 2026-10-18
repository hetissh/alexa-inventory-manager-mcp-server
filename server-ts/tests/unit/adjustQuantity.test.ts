import { describe, expect, it } from 'vitest';

import { adjustQuantity } from '../../src/domain/operations/adjustQuantity.js';
import type { Resource } from '../../src/domain/schemas.js';
import { COMMON_SETTINGS } from '../../src/templates/shared.js';
import { planFor } from '../helpers/plan.js';
import { inventoryItem, warehouseResources } from '../helpers/resources.js';

const { settings } = { settings: COMMON_SETTINGS };

const airFilter = (): Resource => inventoryItem('item_air_filter', 'Air Filter', [], 35);
const brakePads = (): Resource => inventoryItem('item_brake_pads', 'Brake Pads', [], 12);

describe('adjustQuantity.bind', () => {
  it('targets inventory items only, by name', () => {
    expect(adjustQuantity.name).toBe('ADJUST_QUANTITY');
    expect(adjustQuantity.targetTypes).toEqual(['inventory_item']);
    expect(adjustQuantity.targetsLastEvent).toBe(false);
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

  it('exposes the validated arguments and has no second resource', () => {
    const binding = adjustQuantity.bind({ delta: 20, ignored: true });
    expect(binding.ok && binding.bound.arguments).toEqual({ delta: 20 });
    expect(binding.ok && binding.bound.secondary).toBeUndefined();
  });
});

describe('adjustQuantity plan', () => {
  it('adds stock and describes the change, with no confirmation needed', () => {
    expect(planFor(adjustQuantity, airFilter(), { delta: 20 })).toEqual({
      kind: 'ready',
      attributes: { quantity: 55, unit: 'pieces', reorderLevel: 5 },
      before: { quantity: 35 },
      after: { quantity: 55 },
      summary: 'Added 20 pieces to Air Filter (35 to 55)',
      spoken: 'Added 20. Air Filter is now at 55 pieces.',
    });
  });

  it('removes stock', () => {
    expect(planFor(adjustQuantity, airFilter(), { delta: -10 })).toMatchObject({
      kind: 'ready',
      after: { quantity: 25 },
      summary: 'Removed 10 pieces from Air Filter (35 to 25)',
      spoken: 'Removed 10. Air Filter is now at 25 pieces.',
    });
  });

  it('refuses to go below zero and says how much is in stock', () => {
    expect(planFor(adjustQuantity, brakePads(), { delta: -20 })).toEqual({
      kind: 'rejected',
      code: 'INSUFFICIENT_STOCK',
      message: 'Cannot remove 20 pieces of Brake Pads: only 12 in stock.',
    });
  });

  it('refuses an implausibly large number outright', () => {
    expect(planFor(adjustQuantity, airFilter(), { delta: settings.maxAdjustment + 1 })).toMatchObject({
      kind: 'rejected',
      code: 'LIMIT_EXCEEDED',
    });
  });

  it('is still ready, but needs confirmation, for a large addition', () => {
    expect(planFor(adjustQuantity, airFilter(), { delta: settings.largeAdjustThreshold })).toMatchObject({
      kind: 'ready',
      after: { quantity: 135 },
      confirmation: { reason: 'large_adjustment', readback: 'Added 100 pieces to Air Filter (35 to 135)?' },
    });
  });

  it('needs confirmation for a large removal', () => {
    const plan = planFor(adjustQuantity, inventoryItem('item_air_filter', 'Air Filter', [], 500), { delta: -100 });
    expect(plan).toMatchObject({ kind: 'ready', confirmation: { reason: 'large_adjustment' } });
  });

  it('needs confirmation when the change would leave nothing', () => {
    expect(planFor(adjustQuantity, brakePads(), { delta: -12 })).toMatchObject({
      kind: 'ready',
      after: { quantity: 0 },
      confirmation: { reason: 'reaches_zero', readback: 'Removed 12 pieces from Brake Pads, leaving none in stock?' },
    });
  });

  it('rejects a resource that is not an inventory item', () => {
    const compressor = warehouseResources().find((resource) => resource.type === 'equipment');
    if (!compressor) {
      throw new Error('the warehouse fixture should include equipment');
    }
    expect(planFor(adjustQuantity, compressor, { delta: 1 })).toEqual({
      kind: 'rejected',
      code: 'INVALID_TARGET',
      message: 'Compressor 2 is not an inventory item.',
    });
  });
});
