import type { TemplateId } from '../domain/types.js';
import type { Template } from './types.js';
import { warehouseTemplate } from './warehouse.js';

const TEMPLATES: Readonly<Record<TemplateId, Template>> = {
  warehouse: warehouseTemplate,
};

export function getTemplate(id: TemplateId): Template {
  return TEMPLATES[id];
}

export function listTemplates(): readonly Template[] {
  return Object.values(TEMPLATES);
}
