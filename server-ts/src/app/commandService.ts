import { resolveResource } from '../domain/matcher.js';
import { getOperation } from '../domain/operations/registry.js';
import type { SecondaryReference } from '../domain/operations/types.js';
import type { Resource, ResourceType } from '../domain/schemas.js';
import type { CommandSource, EventRecord, OperationName, Workspace } from '../domain/types.js';
import { getTemplate } from '../templates/index.js';
import { ALREADY_UNDONE_MESSAGE, DUPLICATE_MESSAGE, type Prepared, replay, runCommand } from './commit.js';
import { generateToken, hashToken } from './confirmationCode.js';
import { AlreadyReversedError, DuplicateCommandError, WorkspaceNotFoundError } from './errors.js';
import { type CommandOutcome, conflict, rejected } from './outcomes.js';
import type { AppLogger, Store } from './ports.js';
import { spokenAmbiguous, spokenNotFound } from './spoken.js';

export type { AlertChanges, CommandOutcome, ConfirmationPrompt, SyncSummary } from './outcomes.js';

export interface CommandRequest {
  /** Idempotency key: a repeated identical request with the same ID is applied once. */
  readonly commandId: string;
  readonly workspaceId: string;
  readonly actorId: string;
  readonly source: CommandSource;
  readonly clientName: string | null;
  readonly operation: OperationName;
  /** Spoken or typed name (or ID) of the resource to change. Ignored by operations that undo the actor's last change. */
  readonly target: string;
  /** Operation-specific arguments, validated by the operation itself. */
  readonly arguments: unknown;
}

/** Says yes to, or declines, a change that is waiting for confirmation. */
export interface ConfirmationRequest {
  readonly workspaceId: string;
  /** Must be the actor who asked for the change. */
  readonly actorId: string;
  readonly token: string;
}

export interface CommandServiceOptions {
  /** How long a person has to say yes. Default 120 seconds. */
  readonly ttlSeconds?: number;
  readonly now?: () => Date;
  readonly generateToken?: () => string;
}

export interface CommandService {
  /** Applies a change, or parks it and returns `confirmation_required` if it needs a human yes. */
  execute(request: CommandRequest): Promise<CommandOutcome>;
  confirm(request: ConfirmationRequest): Promise<CommandOutcome>;
  cancel(request: ConfirmationRequest): Promise<CommandOutcome>;
}

const DEFAULT_TTL_SECONDS = 120;
const UNKNOWN_MESSAGE = 'That confirmation is not valid. Ask for the change again.';
const EXPIRED_MESSAGE = 'That confirmation expired. Ask for the change again.';

function ofTypes(resources: readonly Resource[], types: readonly ResourceType[]): Resource[] {
  return resources.filter((resource) => types.includes(resource.type));
}

/** Turns the database's "this key/event was already used" errors into a conflict result. */
async function guarded(work: () => Promise<CommandOutcome>): Promise<CommandOutcome> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DuplicateCommandError) {
      return conflict(DUPLICATE_MESSAGE);
    }
    if (error instanceof AlreadyReversedError) {
      return conflict(ALREADY_UNDONE_MESSAGE);
    }
    throw error;
  }
}

export function createCommandService(
  store: Store,
  logger: AppLogger,
  options: CommandServiceOptions = {},
): CommandService {
  const ttlMs = (options.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000;
  const now = options.now ?? ((): Date => new Date());
  const newToken = options.generateToken ?? generateToken;

  async function load(workspaceId: string): Promise<{ workspace: Workspace; resources: Resource[]; names: Map<string, string> }> {
    const workspace = await store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
    const resources = await store.listResources(workspace.id);
    return { workspace, resources, names: new Map(resources.map((resource) => [resource.id, resource.name])) };
  }

  function log(fields: Record<string, unknown>, outcome: CommandOutcome, message: string): void {
    logger.info(
      {
        ...fields,
        status: outcome.status,
        replayed: outcome.status === 'committed' ? outcome.replayed : undefined,
        eventId: outcome.status === 'committed' ? outcome.event.eventId : undefined,
      },
      message,
    );
  }

  /** Resolves the user's words for the second resource (the technician), or says why it can't. */
  function resolveSecondary(
    reference: SecondaryReference & { readonly query: string },
    resources: readonly Resource[],
  ): { outcome: CommandOutcome } | { resource: Resource } {
    const { query, role } = reference;
    const resolution = resolveResource(query, ofTypes(resources, reference.types), { autoResolveFuzzy: false });
    if (resolution.kind === 'resolved') {
      return { resource: resolution.match.resource };
    }
    if (resolution.kind === 'not_found') {
      return { outcome: { status: 'not_found', query, role, spoken: spokenNotFound(query) } };
    }
    return {
      outcome: {
        status: 'ambiguous',
        query,
        role,
        candidates: resolution.candidates,
        spoken: spokenAmbiguous(query, resolution.candidates),
      },
    };
  }

  return {
    async execute(request) {
      const operation = getOperation(request.operation);
      const binding = operation.bind(request.arguments);
      if (!binding.ok) {
        return rejected('INVALID_ARGUMENT', binding.message);
      }
      const { workspace, resources, names } = await load(request.workspaceId);

      let target: Resource | undefined;
      let reversing: EventRecord | undefined;
      if (operation.targetsLastEvent) {
        reversing = await store.findLastReversibleEvent(workspace.id, request.actorId);
        if (!reversing) {
          return rejected('NOTHING_TO_UNDO', 'There is nothing to undo.');
        }
        const resourceId = reversing.resourceId;
        target = resources.find((resource) => resource.id === resourceId);
        if (!target) {
          return rejected('INVALID_TARGET', 'The resource that change affected no longer exists.');
        }
      } else {
        // Writes never auto-resolve typo-level matches: ask rather than change the wrong record.
        const resolution = resolveResource(request.target, ofTypes(resources, operation.targetTypes), {
          autoResolveFuzzy: false,
        });
        if (resolution.kind === 'not_found') {
          return { status: 'not_found', query: request.target, spoken: spokenNotFound(request.target) };
        }
        if (resolution.kind === 'ambiguous') {
          return {
            status: 'ambiguous',
            query: request.target,
            candidates: resolution.candidates,
            spoken: spokenAmbiguous(request.target, resolution.candidates),
          };
        }
        target = resolution.match.resource;
      }

      let secondary: Resource | undefined;
      if (binding.bound.secondary) {
        const resolved = resolveSecondary(binding.bound.secondary, resources);
        if ('outcome' in resolved) {
          return resolved.outcome;
        }
        secondary = resolved.resource;
      }

      const prepared: Prepared = {
        workspace,
        settings: getTemplate(workspace.template).settings,
        operation,
        bound: binding.bound,
        commandId: request.commandId,
        actor: request.actorId,
        source: request.source,
        clientName: request.clientName,
        resourceId: target.id,
        secondary,
        names,
        reversing,
      };
      const token = newToken();
      const prompt = { token, tokenHash: hashToken(token), expiresAt: new Date(now().getTime() + ttlMs) };
      const outcome = await guarded(() =>
        store.withTransaction((tx) => runCommand(tx, prepared, { kind: 'propose', prompt })),
      );
      log(
        {
          workspaceId: workspace.id,
          commandId: request.commandId,
          operation: request.operation,
          actor: request.actorId,
          source: request.source,
        },
        outcome,
        'command processed',
      );
      return outcome;
    },

    async confirm(request) {
      const { workspace, resources, names } = await load(request.workspaceId);
      const found = await store.findCommandByTokenHash(workspace.id, hashToken(request.token));
      if (found?.actor !== request.actorId) {
        return rejected('UNKNOWN_CONFIRMATION', UNKNOWN_MESSAGE);
      }
      const operation = getOperation(found.operation);
      const binding = operation.bind(found.arguments);
      const secondary = resources.find((resource) => resource.id === found.secondaryResourceId);
      const reversing = found.reversingEventId ? await store.getEvent(workspace.id, found.reversingEventId) : undefined;

      const outcome = await guarded(() =>
        store.withTransaction(async (tx) => {
          // Re-read under a lock: two confirmations arriving together must not both apply the change.
          const command = await tx.lockCommand(found.id);
          if (command.status === 'cancelled') {
            return rejected('CONFIRMATION_CANCELLED', 'That change was cancelled, so nothing was done.');
          }
          if (command.status === 'expired') {
            return rejected('CONFIRMATION_EXPIRED', EXPIRED_MESSAGE);
          }
          if (command.status === 'pending' && command.expiresAt.getTime() <= now().getTime()) {
            await tx.updateCommandStatus(command.id, 'expired', null);
            return rejected('CONFIRMATION_EXPIRED', EXPIRED_MESSAGE);
          }
          if (!binding.ok) {
            await tx.updateCommandStatus(found.id, 'cancelled', null);
            return rejected('INVALID_ARGUMENT', binding.message);
          }
          const prepared: Prepared = {
            workspace,
            settings: getTemplate(workspace.template).settings,
            operation,
            bound: binding.bound,
            commandId: found.commandId,
            actor: found.actor,
            source: found.source,
            clientName: found.clientName,
            resourceId: found.resourceId,
            secondary,
            names,
            reversing,
          };
          if (command.status === 'confirmed') {
            // Already applied (a retry, or a second confirmation racing the first): return the original result.
            const event = await tx.findEventByCommandId(workspace.id, found.commandId);
            const resource = await tx.lockResource(workspace.id, found.resourceId);
            if (event && resource) {
              return replay(tx, prepared, event, resource);
            }
            return rejected('ALREADY_CONFIRMED', 'That change was already applied.');
          }
          return runCommand(tx, prepared, { kind: 'confirm', command });
        }),
      );
      log(
        { workspaceId: workspace.id, commandId: found.commandId, operation: found.operation, actor: request.actorId },
        outcome,
        'confirmation processed',
      );
      return outcome;
    },

    async cancel(request) {
      const workspace = await store.getWorkspace(request.workspaceId);
      if (!workspace) {
        throw new WorkspaceNotFoundError(request.workspaceId);
      }
      const found = await store.findCommandByTokenHash(workspace.id, hashToken(request.token));
      if (found?.actor !== request.actorId) {
        return rejected('UNKNOWN_CONFIRMATION', UNKNOWN_MESSAGE);
      }
      const outcome = await store.withTransaction(async (tx): Promise<CommandOutcome> => {
        const command = await tx.lockCommand(found.id);
        if (command.status === 'confirmed') {
          return rejected('ALREADY_CONFIRMED', 'That change was already applied. Use undo-last-change to reverse it.');
        }
        if (command.status === 'pending') {
          await tx.updateCommandStatus(command.id, 'cancelled', null);
        }
        return { status: 'cancelled', spoken: 'Okay, cancelled. Nothing was changed.' };
      });
      log(
        { workspaceId: workspace.id, commandId: found.commandId, operation: found.operation, actor: request.actorId },
        outcome,
        'cancellation processed',
      );
      return outcome;
    },
  };
}
