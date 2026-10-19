import type { TemplateId } from '../domain/types.js';
import { cafeTemplate } from './cafe.js';
import { repairTemplate } from './repair.js';
import { restaurantTemplate } from './restaurant.js';
import type { Template } from './types.js';
import { warehouseTemplate } from './warehouse.js';

const TEMPLATES: Readonly<Record<TemplateId, Template>> = {
  warehouse: warehouseTemplate,
  cafe: cafeTemplate,
  restaurant: restaurantTemplate,
  repair: repairTemplate,
};

export function getTemplate(id: TemplateId): Template {
  return TEMPLATES[id];
}

export function listTemplates(): readonly Template[] {
  return Object.values(TEMPLATES);
}
