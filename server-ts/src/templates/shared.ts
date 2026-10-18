import type { WorkspaceSettings } from '../domain/types.js';

/** Settings every template shares unless it overrides them. */
export const COMMON_SETTINGS: WorkspaceSettings = {
  largeAdjustThreshold: 100,
  maxAdjustment: 10_000,
  equipmentStatuses: ['available', 'maintenance', 'out_of_service'],
  menuItemStatuses: ['available', 'sold_out'],
  statusLabels: {
    maintenance: 'under maintenance',
    out_of_service: 'out of service',
    sold_out: 'sold out',
  },
  statusAliases: {
    broken: 'out_of_service',
    down: 'out_of_service',
    'out of order': 'out_of_service',
    'under repair': 'maintenance',
    repair: 'maintenance',
    repairs: 'maintenance',
    working: 'available',
    ready: 'available',
    'out of stock': 'sold_out',
    finished: 'sold_out',
    unavailable: 'sold_out',
  },
};
