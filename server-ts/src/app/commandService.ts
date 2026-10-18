import { canonicalJson } from '../domain/json.js';
import { type Candidate, resolveResource } from '../domain/matcher.js';
import { getOperation } from '../domain/operations/registry.js';
import type { BoundOperation, Operation, RejectionCode } from '../domain/operations/types.js';
import type { Resource } from '../domain/schemas.js';
import type {
  CommandSource,
  EventRecord,
  OperationName,
  SyncStatus,
  Workspace,
  WorkspaceSettings,
} from '../domain/types.js';
import { getTemplate } from '../templates/index.js';
import { DuplicateCommandError, WorkspaceNotFoundError } from './errors.js';
import type { AppLogger, Store, TransactionStore } from './ports.js';
import { spokenAmbiguous, spokenCommitted, spokenNotFound, spokenReplayed } from './spoken.js';

export interface CommandRequest {
  /** Idempotency key: a repeated identical request with the same ID is applied once. */
  readonly commandId: string;
  readonly workspaceId: string;
  readonly actorId: string;
  readonly source: CommandSource;
  readonly clientName: string | null;
  readonly operation: OperationName;
  /** Spoken or typed name (or ID) of the resource to change. */
  readonly target: string;
  /** Operation-specific arguments, validated by the operation itself. */
  readonly arguments: unknown;
}

export interface SyncSummary {
  readonly sheets: SyncStatus | 'not_configured';
}

export type CommandOutcome =
  | {
      readonly status: 'committed';
      /** True when this request had already been applied and nothing new was written. */
      readonly replayed: boolean;
      readonly event: EventRecord;
      readonly resource: Resource;
      readonly sync: SyncSummary;
      readonly spoken: string;
    }
  | {
      readonly status: 'ambiguous';
      readonly query: string;
      readonly candidates: readonly Candidate[];
      readonly spoken: string;
    }
  | { readonly status: 'not_found'; readonly query: string; readonly spoken: string }
  | { readonly status: 'rejected'; readonly code: RejectionCode; readonly message: string; readonly spoken: string }
  | { readonly status: 'conflict'; readonly message: string; readonly spoken: string };

export interface CommandService {
  execute(request: CommandRequest): Promise<CommandOutcome>;
}

interface CommitContext {
  readonly request: CommandRequest;
  readonly workspace: Workspace;
  readonly settings: WorkspaceSettings;
  readonly operation: Operation;
  readonly bound: BoundOperation;
  readonly resourceId: string;
}

function rejected(code: RejectionCode, message: string): CommandOutcome {
  return { status: 'rejected', code, message, spoken: message };
}

function conflict(message: string): CommandOutcome {
  return { status: 'conflict', message, spoken: message };
}

const DUPLICATE_MESSAGE =
  'That idempotency key was already used for a different request. Use a new key for a new request, or repeat the original request exactly.';

async function replay(
  tx: TransactionStore,
  context: CommitContext,
  existing: EventRecord,
  resource: Resource,
): Promise<CommandOutcome> {
  const sameRequest =
    existing.resourceId === resource.id &&
    // OPERATION_NAMES has one member today, so the types see this as always true; it matters once there are more.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    existing.operation === context.operation.name &&
    canonicalJson(existing.arguments) === canonicalJson(context.bound.arguments);
  if (!sameRequest) {
    return conflict(DUPLICATE_MESSAGE);
  }
  const sheets = (await tx.getSyncStatus(existing.eventId, 'sheets')) ?? 'not_configured';
  return {
    status: 'committed',
    replayed: true,
    event: existing,
    resource,
    sync: { sheets },
    spoken: spokenReplayed(existing.summary, sheets),
  };
}

/** Runs inside one transaction: lock, re-validate against fresh state, then write event + state + outbox together. */
async function commit(tx: TransactionStore, context: CommitContext): Promise<CommandOutcome> {
  const { request, workspace, bound, operation } = context;
  const locked = await tx.lockResource(workspace.id, context.resourceId);
  if (!locked) {
    return rejected('INVALID_TARGET', 'That resource no longer exists.');
  }

  const existing = await tx.findEventByCommandId(workspace.id, request.commandId);
  if (existing) {
    return replay(tx, context, existing, locked);
  }

  const plan = bound.plan(locked, context.settings);
  if (plan.kind === 'rejected') {
    return rejected(plan.code, plan.message);
  }
  if (plan.kind === 'needs_confirmation') {
    return rejected(
      'CONFIRMATION_UNSUPPORTED',
      `${plan.readback} This change needs explicit confirmation, which this version of VoiceOps cannot collect yet, so nothing was changed.`,
    );
  }

  const event = await tx.insertEvent({
    workspaceId: workspace.id,
    commandId: request.commandId,
    resourceId: locked.id,
    operation: operation.name,
    arguments: bound.arguments,
    before: plan.before,
    after: plan.after,
    summary: plan.summary,
    actor: request.actorId,
    source: request.source,
    clientName: request.clientName,
  });
  const resource = await tx.updateResourceAttributes(workspace.id, locked.id, plan.attributes, locked.version);
  await tx.bumpBoardVersion(workspace.id);

  let sheets: SyncSummary['sheets'] = 'not_configured';
  if (workspace.integrations.sheets) {
    await tx.enqueueSync(workspace.id, event.eventId, 'sheets');
    sheets = 'pending';
  }
  return {
    status: 'committed',
    replayed: false,
    event,
    resource,
    sync: { sheets },
    spoken: spokenCommitted(plan.spoken, sheets),
  };
}

export function createCommandService(store: Store, logger: AppLogger): CommandService {
  return {
    async execute(request) {
      const operation = getOperation(request.operation);
      const binding = operation.bind(request.arguments);
      if (!binding.ok) {
        return rejected('INVALID_ARGUMENT', binding.message);
      }

      const workspace = await store.getWorkspace(request.workspaceId);
      if (!workspace) {
        throw new WorkspaceNotFoundError(request.workspaceId);
      }

      // Writes never auto-resolve typo-level matches: ask rather than change the wrong record.
      const resources = await store.listResources(workspace.id, { types: operation.targetTypes });
      const resolution = resolveResource(request.target, resources, { autoResolveFuzzy: false });
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

      const context: CommitContext = {
        request,
        workspace,
        settings: getTemplate(workspace.template).settings,
        operation,
        bound: binding.bound,
        resourceId: resolution.match.resource.id,
      };
      let outcome: CommandOutcome;
      try {
        outcome = await store.withTransaction((tx) => commit(tx, context));
      } catch (error) {
        if (!(error instanceof DuplicateCommandError)) {
          throw error;
        }
        outcome = conflict(DUPLICATE_MESSAGE);
      }

      logger.info(
        {
          workspaceId: workspace.id,
          commandId: request.commandId,
          operation: request.operation,
          actor: request.actorId,
          source: request.source,
          status: outcome.status,
          replayed: outcome.status === 'committed' ? outcome.replayed : undefined,
          eventId: outcome.status === 'committed' ? outcome.event.eventId : undefined,
        },
        'command processed',
      );
      return outcome;
    },
  };
}
