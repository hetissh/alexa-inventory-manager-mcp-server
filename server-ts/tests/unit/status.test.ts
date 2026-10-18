import { describe, expect, it } from 'vitest';

import { normalizeStatus, statusLabel } from '../../src/domain/status.js';
import { COMMON_SETTINGS } from '../../src/templates/shared.js';

const equipment = COMMON_SETTINGS.equipmentStatuses;
const menu = COMMON_SETTINGS.menuItemStatuses;

describe('statusLabel', () => {
  it('uses the workspace label when there is one, otherwise spaces out the status', () => {
    expect(statusLabel('maintenance', COMMON_SETTINGS)).toBe('under maintenance');
    expect(statusLabel('sold_out', COMMON_SETTINGS)).toBe('sold out');
    expect(statusLabel('available', COMMON_SETTINGS)).toBe('available');
    expect(statusLabel('on_hold', COMMON_SETTINGS)).toBe('on hold');
  });
});

describe('normalizeStatus', () => {
  it.each([
    ['maintenance', equipment, 'maintenance'],
    ['Maintenance', equipment, 'maintenance'],
    ['out_of_service', equipment, 'out_of_service'],
    ['out of service', equipment, 'out_of_service'],
    ['out-of-service', equipment, 'out_of_service'],
    ['under maintenance', equipment, 'maintenance'],
    ['  Under Maintenance  ', equipment, 'maintenance'],
    ['sold out', menu, 'sold_out'],
    ['sold_out', menu, 'sold_out'],
    ['broken', equipment, 'out_of_service'],
    ['out of order', equipment, 'out_of_service'],
    ['under repair', equipment, 'maintenance'],
    ['working', equipment, 'available'],
    ['out of stock', menu, 'sold_out'],
    ['unavailable', menu, 'sold_out'],
  ])('%s -> %s', (spoken, allowed, expected) => {
    expect(normalizeStatus(spoken, allowed, COMMON_SETTINGS)).toBe(expected);
  });

  it.each([
    ['sold out', equipment],
    ['unavailable', equipment],
    ['broken', menu],
    ['on fire', equipment],
    ['', equipment],
  ])('%j is not a valid status here', (spoken, allowed) => {
    expect(normalizeStatus(spoken, allowed, COMMON_SETTINGS)).toBeUndefined();
  });
});
