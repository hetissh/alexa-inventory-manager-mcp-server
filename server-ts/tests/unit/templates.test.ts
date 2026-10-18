import { describe, expect, it } from 'vitest';

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
          expect(template.equipmentStatuses).toContain(resource.attributes.status);
        }
      }
      expect(template.settings.largeAdjustThreshold).toBeLessThan(template.settings.maxAdjustment);
    },
  );

  it('the warehouse fixture matches the demo script', () => {
    const warehouse = getTemplate('warehouse');
    const byId = new Map(warehouse.resources.map((resource) => [resource.id, resource]));
    expect(byId.get('item_air_filter')?.attributes).toMatchObject({ quantity: 35, reorderLevel: 10 });
    expect(byId.get('item_brake_pads')?.attributes).toMatchObject({ quantity: 12, reorderLevel: 5 });
    expect(byId.get('equipment_compressor_2')?.attributes).toEqual({ status: 'available' });
  });
});
