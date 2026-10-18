import { z } from 'zod';

import { defineOperation } from './types.js';

const argsSchema = z.object({
  delta: z
    .number()
    .int()
    .refine((delta) => delta !== 0, 'must not be zero')
    .describe('Units to add (positive) or remove (negative).'),
});

/** ADJUST_QUANTITY: add or remove units of an inventory item. */
export const adjustQuantity = defineOperation({
  name: 'ADJUST_QUANTITY',
  targetTypes: ['inventory_item'],
  argsSchema,
  plan({ delta }, resource, { settings }) {
    if (resource.type !== 'inventory_item') {
      return { kind: 'rejected', code: 'INVALID_TARGET', message: `${resource.name} is not an inventory item.` };
    }
    const { quantity, unit } = resource.attributes;
    const amount = Math.abs(delta);
    const verb = delta > 0 ? 'Added' : 'Removed';
    const preposition = delta > 0 ? 'to' : 'from';

    if (amount > settings.maxAdjustment) {
      return {
        kind: 'rejected',
        code: 'LIMIT_EXCEEDED',
        message: `${String(amount)} ${unit} is more than the ${String(settings.maxAdjustment)} allowed in one change; please check the number.`,
      };
    }
    const newQuantity = quantity + delta;
    if (newQuantity < 0) {
      return {
        kind: 'rejected',
        code: 'INSUFFICIENT_STOCK',
        message: `Cannot remove ${String(amount)} ${unit} of ${resource.name}: only ${String(quantity)} in stock.`,
      };
    }

    let confirmation: { reason: string; readback: string } | undefined;
    if (amount >= settings.largeAdjustThreshold) {
      confirmation = {
        reason: 'large_adjustment',
        readback: `${verb} ${String(amount)} ${unit} ${preposition} ${resource.name} (${String(quantity)} to ${String(newQuantity)})?`,
      };
    } else if (newQuantity === 0) {
      confirmation = {
        reason: 'reaches_zero',
        readback: `${verb} ${String(amount)} ${unit} ${preposition} ${resource.name}, leaving none in stock?`,
      };
    }

    return {
      kind: 'ready',
      attributes: { ...resource.attributes, quantity: newQuantity },
      before: { quantity },
      after: { quantity: newQuantity },
      summary: `${verb} ${String(amount)} ${unit} ${preposition} ${resource.name} (${String(quantity)} to ${String(newQuantity)})`,
      spoken: `${verb} ${String(amount)}. ${resource.name} is now at ${String(newQuantity)} ${unit}.`,
      ...(confirmation ? { confirmation } : {}),
    };
  },
});
