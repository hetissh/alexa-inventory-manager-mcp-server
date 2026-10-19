import { describe, expect, it } from 'vitest';

import { METRIC_KINDS } from '../../src/domain/board.js';
import { resourceSeedSchema, workspaceIdSchema } from '../../src/domain/schemas.js';
import { TEMPLATE_IDS } from '../../src/domain/types.js';
import { getTemplate, listTemplates } from '../../src/templates/index.js';

describe('templates', () => {
  it('has a template for every template id', () => {
    for (const id of TEMPLATE_IDS) {
      expect(getTemplate(id).id).toBe(id);
    }
    expect(listTemplates().map((template) => template.id)).toEqual([...TEMPLATE_IDS]);
  });

  it.each(listTemplates().map((template) => [template.id, template] as const))(
    '%s: seed data is valid, consistent and uses fictional ids',
    (_id, template) => {
      expect(workspaceIdSchema.safeParse(template.workspace.id).success).toBe(true);
      const ids = template.resources.map((resource) => resource.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const resource of template.resources) {
        expect(resourceSeedSchema.safeParse(resource).success).toBe(true);
        if (resource.type === 'equipment') {
          expect(template.settings.equipmentStatuses).toContain(resource.attributes.status);
        }
        if (resource.type === 'menu_item') {
          expect(template.settings.menuItemStatuses).toContain(resource.attributes.status);
        }
        if (resource.type === 'dining_table') {
          expect(template.settings.tableStatuses).toContain(resource.attributes.status);
        }
        if (resource.type === 'job' && resource.attributes.assigneeId !== null) {
          const assignee = template.resources.find((candidate) => candidate.id === resource.attributes.assigneeId);
          expect(assignee?.type).toBe('technician');
        }
      }
      // Every resource lives in a collection the template defines, and that collection holds its kind.
      const keys = template.collections.map((collection) => collection.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const resource of template.resources) {
        const collection = template.collections.find((candidate) => candidate.key === resource.collection);
        expect(collection?.kind, `${resource.id} in ${resource.collection}`).toBe(resource.type);
      }
      for (const collection of template.collections) {
        expect(template.resources.some((resource) => resource.collection === collection.key), collection.key).toBe(true);
      }
      expect(template.settings.largeAdjustThreshold).toBeLessThan(template.settings.maxAdjustment);
      expect(template.board.metrics.length).toBeGreaterThan(0);
      for (const metric of template.board.metrics) {
        expect(METRIC_KINDS).toContain(metric.kind);
      }
    },
  );

  it('every status alias points at a status that exists somewhere', () => {
    const { settings } = getTemplate('warehouse');
    const all = [...settings.equipmentStatuses, ...settings.menuItemStatuses, ...settings.tableStatuses];
    for (const target of Object.values(settings.statusAliases)) {
      expect(all).toContain(target);
    }
    for (const alias of Object.keys(settings.statusAliases)) {
      expect(alias).toBe(alias.toLowerCase());
    }
  });

  it('has four different workspaces with four different ids', () => {
    const ids = listTemplates().map((template) => template.workspace.id);
    expect(ids).toEqual(['northside-warehouse', 'harbor-cafe', 'lakeview-restaurant', 'eastside-repairs']);
  });

  it('the warehouse fixture matches the demo script', () => {
    const warehouse = getTemplate('warehouse');
    const byId = new Map(warehouse.resources.map((resource) => [resource.id, resource]));
    expect(byId.get('item_air_filter')?.attributes).toMatchObject({ quantity: 35, reorderLevel: 10 });
    expect(byId.get('item_brake_pads')?.attributes).toMatchObject({ quantity: 12, reorderLevel: 5 });
    expect(byId.get('equipment_compressor_2')?.attributes).toEqual({ status: 'available' });
  });
});
