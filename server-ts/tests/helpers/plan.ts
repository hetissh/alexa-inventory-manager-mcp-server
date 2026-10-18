import type { Operation, OperationPlan, PlanContext } from '../../src/domain/operations/types.js';
import type { Resource } from '../../src/domain/schemas.js';
import { COMMON_SETTINGS } from '../../src/templates/shared.js';

export function planContext(overrides: Partial<PlanContext> = {}): PlanContext {
  return { settings: COMMON_SETTINGS, secondary: undefined, names: new Map(), reversing: undefined, ...overrides };
}

/** Binds `args` to the operation and plans it against `resource`; fails the test if the arguments are invalid. */
export function planFor(
  operation: Operation,
  resource: Resource,
  args: unknown,
  context: Partial<PlanContext> = {},
): OperationPlan {
  const binding = operation.bind(args);
  if (!binding.ok) {
    throw new Error(`unexpected bind failure: ${binding.message}`);
  }
  return binding.bound.plan(resource, planContext(context));
}
