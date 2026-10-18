import { COMMON_SETTINGS } from './shared.js';
import type { Template } from './types.js';

// Fictional demo data only (no real client information).
export const warehouseTemplate: Template = {
  id: 'warehouse',
  label: 'Warehouse',
  settings: COMMON_SETTINGS,
  workspace: { id: 'northside-warehouse', name: 'Northside Operations', timezone: 'Asia/Kolkata' },
  board: {
    title: 'Northside Operations',
    metrics: [
      { label: 'Low stock', kind: 'low_stock' },
      { label: 'Equipment down', kind: 'equipment_unavailable' },
    ],
  },
  resources: [
    {
      id: 'item_air_filter',
      type: 'inventory_item',
      name: 'Air Filter',
      aliases: ['air filters'],
      attributes: { quantity: 35, unit: 'pieces', reorderLevel: 10 },
    },
    {
      id: 'item_oil_filter',
      type: 'inventory_item',
      name: 'Oil Filter',
      aliases: ['oil filters'],
      attributes: { quantity: 20, unit: 'pieces', reorderLevel: 8 },
    },
    {
      id: 'item_brake_pads',
      type: 'inventory_item',
      name: 'Brake Pads',
      aliases: ['brake pad set'],
      attributes: { quantity: 12, unit: 'pieces', reorderLevel: 5 },
    },
    {
      id: 'equipment_compressor_2',
      type: 'equipment',
      name: 'Compressor 2',
      aliases: ['air compressor 2'],
      attributes: { status: 'available' },
    },
  ],
};
