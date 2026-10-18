import type { z } from 'zod';

import type { Resource, ResourceType } from '../schemas.js';
import type { JsonObject, OperationName, WorkspaceSettings } from '../types.js';

export const REJECTION_CODES = [
  'INVALID_ARGUMENT',
  'INVALID_TARGET',
  'LIMIT_EXCEEDED',
  'INSUFFICIENT_STOCK',
  'CONFIRMATION_UNSUPPORTED',
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

/** What an operation decided to do with a resource in its current state. */
export type OperationPlan =
  | { readonly kind: 'rejected'; readonly code: RejectionCode; readonly message: string }
  | { readonly kind: 'needs_confirmation'; readonly reason: string; readonly readback: string }
  | {
      readonly kind: 'ready';
      /** The resource's complete attribute set after the change. */
      readonly attributes: JsonObject;
      /** Only the attributes this change touched, as they were. */
      readonly before: JsonObject;
      /** Only the attributes this change touched, as they now are. */
      readonly after: JsonObject;
      /** One line for the activity log. */
      readonly summary: string;
      /** A sentence suitable for reading aloud. */
      readonly spoken: string;
    };

/** An operation whose arguments have already been validated; only needs a resource to plan against. */
export interface BoundOperation {
  readonly arguments: JsonObject;
  plan(resource: Resource, settings: WorkspaceSettings): OperationPlan;
}

export type BindResult =
  | { readonly ok: true; readonly bound: BoundOperation }
  | { readonly ok: false; readonly message: string };

/** The erased, registry-friendly view of an operation. */
export interface Operation {
  readonly name: OperationName;
  /** Only resources of these types can be targeted. */
  readonly targetTypes: readonly ResourceType[];
  bind(rawArguments: unknown): BindResult;
}

export interface OperationDefinition<Args extends JsonObject> {
  readonly name: OperationName;
  readonly targetTypes: readonly ResourceType[];
  readonly argsSchema: z.ZodType<Args>;
  plan(args: Args, resource: Resource, settings: WorkspaceSettings): OperationPlan;
}

/** Keeps each operation's arguments strongly typed while exposing a uniform interface to the registry. */
export function defineOperation<Args extends JsonObject>(definition: OperationDefinition<Args>): Operation {
  return {
    name: definition.name,
    targetTypes: definition.targetTypes,
    bind(rawArguments) {
      const parsed = definition.argsSchema.safeParse(rawArguments);
      if (!parsed.success) {
        const message = parsed.error.issues
          .map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`)
          .join('; ');
        return { ok: false, message };
      }
      const args = parsed.data;
      return {
        ok: true,
        bound: { arguments: args, plan: (resource, settings) => definition.plan(args, resource, settings) },
      };
    },
  };
}
