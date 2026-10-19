import { describe, expect, it } from 'vitest';

import { setStatus } from '../../src/domain/operations/setStatus.js';
import type { Resource } from '../../src/domain/schemas.js';
import { planFor } from '../helpers/plan.js';
import { cafeResources, inventoryItem, warehouseResources } from '../helpers/resources.js';

function find(resources: Resource[], id: string): Resource {
  const resource = resources.find((candidate) => candidate.id === id);
  if (!resource) {
    throw new Error(`fixture has no ${id}`);
  }
  return resource;
}

const compressor = (): Resource => find(warehouseResources(), 'equipment_compressor_2');
const biryani = (): Resource => find(cafeResources(), 'menu_chicken_biryani');

describe('setStatus.bind', () => {
  it('targets equipment, menu items and dining tables', () => {
    expect(setStatus.name).toBe('SET_STATUS');
    expect(setStatus.targetTypes).toEqual(['equipment', 'menu_item', 'dining_table']);
  });

  it.each([
    ['missing status', {}],
    ['empty status', { status: '   ' }],
    ['non-string status', { status: 4 }],
    ['over-long status', { status: 'x'.repeat(41) }],
  ])('rejects %s', (_label, args) => {
    expect(setStatus.bind(args).ok).toBe(false);
  });
});

describe('setStatus plan', () => {
  it('moves equipment to maintenance and always asks for confirmation', () => {
    expect(planFor(setStatus, compressor(), { status: 'under maintenance' })).toEqual({
      kind: 'ready',
      attributes: { status: 'maintenance' },
      before: { status: 'available' },
      after: { status: 'maintenance' },
      summary: 'Changed Compressor 2 from available to under maintenance',
      spoken: 'Compressor 2 is now under maintenance.',
      confirmation: {
        reason: 'status_change',
        readback: 'Mark Compressor 2 as under maintenance (currently available)?',
      },
    });
  });

  it('marks a menu item sold out, keeping its price', () => {
    expect(planFor(setStatus, biryani(), { status: 'sold out' })).toMatchObject({
      kind: 'ready',
      attributes: { price: 260, currency: 'INR', status: 'sold_out' },
      spoken: 'Chicken Biryani is now sold out.',
      confirmation: { readback: 'Mark Chicken Biryani as sold out (currently available)?' },
    });
  });

  it('accepts everyday words for a status', () => {
    expect(planFor(setStatus, compressor(), { status: 'broken' })).toMatchObject({ after: { status: 'out_of_service' } });
  });

  it('lists the valid statuses when the word means none of them', () => {
    expect(planFor(setStatus, compressor(), { status: 'sold out' })).toEqual({
      kind: 'rejected',
      code: 'INVALID_STATUS',
      message:
        '"sold out" is not a valid status for Compressor 2. Choose one of: available, under maintenance, out of service.',
    });
    expect(planFor(setStatus, biryani(), { status: 'maintenance' })).toMatchObject({
      code: 'INVALID_STATUS',
      message: expect.stringContaining('Choose one of: available, sold out.') as string,
    });
  });

  it('does not create a change when the status is already that', () => {
    expect(planFor(setStatus, compressor(), { status: 'available' })).toEqual({
      kind: 'rejected',
      code: 'NO_CHANGE',
      message: 'Compressor 2 is already available.',
    });
  });

  it('rejects a resource that has no status', () => {
    expect(planFor(setStatus, inventoryItem('item_air_filter', 'Air Filter'), { status: 'available' })).toEqual({
      kind: 'rejected',
      code: 'INVALID_TARGET',
      message: 'Air Filter does not have a status.',
    });
  });
});
