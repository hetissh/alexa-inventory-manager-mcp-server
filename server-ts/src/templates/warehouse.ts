import type { Template } from './types.js';

// Fictional demo data only (no real client information).
export const warehouseTemplate: Template = {
  id: 'warehouse',
  label: 'Warehouse',
  settings: { largeAdjustThreshold: 100, maxAdjustment: 10_000 },
  equipmentStatuses: ['available', 'maintenance', 'out_of_service'],
  workspace: { id: 'northside-warehouse', name: 'Northside Operations', timezone: 'Asia/Kolkata' },
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
