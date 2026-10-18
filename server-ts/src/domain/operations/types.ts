import type { z } from 'zod';

import type { Resource, ResourceType } from '../schemas.js';
import type { EventRecord, JsonObject, OperationName, WorkspaceSettings } from '../types.js';

export const REJECTION_CODES = [
  'INVALID_ARGUMENT',
  'INVALID_TARGET',
  'INVALID_STATUS',
  'INVALID_ASSIGNEE',
  'LIMIT_EXCEEDED',
  'INSUFFICIENT_STOCK',
  'NO_CHANGE',
  'JOB_CLOSED',
  'NOTHING_TO_UNDO',
  'STATE_CHANGED',
  'UNKNOWN_CONFIRMATION',
  'CONFIRMATION_EXPIRED',
  'CONFIRMATION_CANCELLED',
  'ALREADY_CONFIRMED',
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

/** A change a human must approve before it is applied. */
export interface Confirmation {
  /** Machine-readable reason, e.g. "large_adjustment" or "status_change". */
  readonly reason: string;
  /** The question to read back to the user, e.g. "Mark Compressor 2 as under maintenance?". */
  readonly readback: string;
}

/** What an operation decided to do with a resource in its current state. */
export type OperationPlan =
  | { readonly kind: 'rejected'; readonly code: RejectionCode; readonly message: string }
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
      /** Present when a human must say yes before the change is applied. */
      readonly confirmation?: Confirmation;
      /** Set when this change undoes an earlier event. */
      readonly reversesEventId?: string;
    };

/** Everything besides the target resource that an operation may need to plan. */
export interface PlanContext {
  readonly settings: WorkspaceSettings;
  /** The second resource the operation refers to (the technician for ASSIGN_JOB), already resolved. */
  readonly secondary: Resource | undefined;
  /** Name of every resource in the workspace by id, for readable messages. */
  readonly names: ReadonlyMap<string, string>;
  /** The event being undone (REVERSE_EVENT only). */
  readonly reversing: EventRecord | undefined;
}

/** A second resource named in the arguments, such as the technician in "assign job 108 to Rahul". */
export interface SecondaryReference {
  /** What it is for, e.g. "assignee". */
  readonly role: string;
  /** Which kinds of resource it may be. */
  readonly types: readonly ResourceType[];
}

/** An operation whose arguments have already been validated; only needs a resource to plan against. */
export interface BoundOperation {
  readonly arguments: JsonObject;
  /** The second resource the user named (and what they called it), if the operation has one. */
  readonly secondary: (SecondaryReference & { readonly query: string }) | undefined;
  plan(resource: Resource, context: PlanContext): OperationPlan;
}

export type BindResult =
  | { readonly ok: true; readonly bound: BoundOperation }
  | { readonly ok: false; readonly message: string };

/** The erased, registry-friendly view of an operation. */
export interface Operation {
  readonly name: OperationName;
  /** Only resources of these types can be targeted. */
  readonly targetTypes: readonly ResourceType[];
  /** True when the target is not named by the user but is the resource of the actor's last change. */
  readonly targetsLastEvent: boolean;
  bind(rawArguments: unknown): BindResult;
}

export interface OperationDefinition<Args extends JsonObject> {
  readonly name: OperationName;
  readonly targetTypes: readonly ResourceType[];
  readonly targetsLastEvent?: boolean;
  readonly secondary?: SecondaryReference & { query(args: Args): string };
  readonly argsSchema: z.ZodType<Args>;
  plan(args: Args, resource: Resource, context: PlanContext): OperationPlan;
}

/** Keeps each operation's arguments strongly typed while exposing a uniform interface to the registry. */
export function defineOperation<Args extends JsonObject>(definition: OperationDefinition<Args>): Operation {
  const { secondary } = definition;
  return {
    name: definition.name,
    targetTypes: definition.targetTypes,
    targetsLastEvent: definition.targetsLastEvent === true,
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
        bound: {
          arguments: args,
          secondary: secondary ? { role: secondary.role, types: secondary.types, query: secondary.query(args) } : undefined,
          plan: (resource, context) => definition.plan(args, resource, context),
        },
      };
    },
  };
}
