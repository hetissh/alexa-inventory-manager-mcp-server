import { COMMON_SETTINGS } from './shared.js';
import type { Template } from './types.js';

// Fictional demo data only. Prices are in Indian rupees (INR).
export const cafeTemplate: Template = {
  id: 'cafe',
  label: 'Cafe / restaurant',
  settings: COMMON_SETTINGS,
  workspace: { id: 'harbor-cafe', name: 'Harbor Cafe', timezone: 'Asia/Kolkata' },
  board: {
    title: 'Harbor Cafe Menu',
    metrics: [
      { label: 'Available', kind: 'menu_available' },
      { label: 'Sold out', kind: 'menu_sold_out' },
    ],
  },
  resources: [
    {
      id: 'menu_chicken_biryani',
      type: 'menu_item',
      name: 'Chicken Biryani',
      aliases: [],
      attributes: { price: 260, currency: 'INR', status: 'available' },
    },
    {
      id: 'menu_veg_biryani',
      type: 'menu_item',
      name: 'Veg Biryani',
      aliases: [],
      attributes: { price: 220, currency: 'INR', status: 'available' },
    },
    {
      id: 'menu_lime_soda',
      type: 'menu_item',
      name: 'Lime Soda',
      aliases: ['fresh lime soda'],
      attributes: { price: 80, currency: 'INR', status: 'available' },
    },
    {
      id: 'menu_masala_dosa',
      type: 'menu_item',
      name: 'Masala Dosa',
      aliases: [],
      attributes: { price: 120, currency: 'INR', status: 'available' },
    },
    {
      id: 'menu_filter_coffee',
      type: 'menu_item',
      name: 'Filter Coffee',
      aliases: ['coffee'],
      attributes: { price: 60, currency: 'INR', status: 'available' },
    },
  ],
};
