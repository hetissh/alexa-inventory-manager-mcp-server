import { z } from 'zod';

import { normalizeStatus, statusLabel } from '../status.js';
import { defineOperation } from './types.js';

const argsSchema = z.object({
  status: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .describe('The new status, as the user said it, for example "maintenance" or "sold out".'),
});

/** SET_STATUS: change the status of a piece of equipment or a menu item. Always needs confirmation. */
export const setStatus = defineOperation({
  name: 'SET_STATUS',
  targetTypes: ['equipment', 'menu_item'],
  argsSchema,
  plan({ status }, resource, { settings }) {
    if (resource.type !== 'equipment' && resource.type !== 'menu_item') {
      return { kind: 'rejected', code: 'INVALID_TARGET', message: `${resource.name} does not have a status.` };
    }
    const allowed = resource.type === 'equipment' ? settings.equipmentStatuses : settings.menuItemStatuses;
    const next = normalizeStatus(status, allowed, settings);
    if (next === undefined) {
      return {
        kind: 'rejected',
        code: 'INVALID_STATUS',
        message: `"${status}" is not a valid status for ${resource.name}. Choose one of: ${allowed.map((option) => statusLabel(option, settings)).join(', ')}.`,
      };
    }
    const current = resource.attributes.status;
    if (next === current) {
      return {
        kind: 'rejected',
        code: 'NO_CHANGE',
        message: `${resource.name} is already ${statusLabel(current, settings)}.`,
      };
    }
    const from = statusLabel(current, settings);
    const to = statusLabel(next, settings);
    return {
      kind: 'ready',
      attributes: { ...resource.attributes, status: next },
      before: { status: current },
      after: { status: next },
      summary: `Changed ${resource.name} from ${from} to ${to}`,
      spoken: `${resource.name} is now ${to}.`,
      confirmation: { reason: 'status_change', readback: `Mark ${resource.name} as ${to} (currently ${from})?` },
    };
  },
});
