import type { Resource } from '../schemas.js';
import type { AlertRule } from '../types.js';

/** What a rule concluded about a resource's current state. */
export interface RuleVerdict {
  readonly rule: AlertRule;
  /** True when the resource is in the state the rule warns about. */
  readonly breached: boolean;
  readonly message: string;
}

/** Warns when stock is below the reorder level; clears when it is back at or above it. */
export function evaluateLowStock(resource: Resource): RuleVerdict | undefined {
  if (resource.type !== 'inventory_item') {
    return undefined;
  }
  const { quantity, unit, reorderLevel } = resource.attributes;
  return {
    rule: 'low_stock',
    breached: quantity < reorderLevel,
    message: `${resource.name} is low on stock: ${String(quantity)} ${unit} left (reorder level ${String(reorderLevel)}).`,
  };
}
