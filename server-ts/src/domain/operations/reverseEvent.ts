import { z } from 'zod';

import { canonicalJson } from '../json.js';
import type { JsonObject } from '../types.js';
import { defineOperation } from './types.js';

/** REVERSE_EVENT: undo the actor's most recent change by recording a compensating event. Always needs confirmation. */
export const reverseEvent = defineOperation({
  name: 'REVERSE_EVENT',
  targetTypes: ['inventory_item', 'equipment', 'menu_item', 'job', 'technician'],
  targetsLastEvent: true,
  argsSchema: z.object({}),
  plan(_args, resource, { reversing: event }) {
    if (!event) {
      return { kind: 'rejected', code: 'NOTHING_TO_UNDO', message: 'There is nothing to undo.' };
    }
    // Only undo if the resource still holds exactly what the event left behind; otherwise a
    // later change would be silently overwritten.
    const current: JsonObject = resource.attributes;
    const drifted = Object.entries(event.after).some(
      ([key, value]) => canonicalJson(current[key] ?? null) !== canonicalJson(value),
    );
    if (drifted) {
      return {
        kind: 'rejected',
        code: 'STATE_CHANGED',
        message: `${resource.name} has changed since "${event.summary}", so it cannot be undone safely.`,
      };
    }
    return {
      kind: 'ready',
      attributes: { ...current, ...event.before },
      before: event.after,
      after: event.before,
      summary: `Undid: ${event.summary}`,
      spoken: `Undone: ${event.summary}.`,
      confirmation: { reason: 'undo', readback: `Undo "${event.summary}"?` },
      reversesEventId: event.eventId,
    };
  },
});
