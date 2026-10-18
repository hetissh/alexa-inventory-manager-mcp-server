import type { Resource } from '../schemas.js';
import { evaluateLowStock, type RuleVerdict } from './lowStock.js';

export type { RuleVerdict } from './lowStock.js';

/** Runs every rule against a resource's state after a change. */
export function evaluateRules(resource: Resource): RuleVerdict[] {
  return [evaluateLowStock(resource)].filter((verdict): verdict is RuleVerdict => verdict !== undefined);
}
