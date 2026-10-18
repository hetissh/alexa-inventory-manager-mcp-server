import { canonicalJson } from '../domain/json.js';
import type { BoundOperation, Operation } from '../domain/operations/types.js';
import { evaluateRules } from '../domain/rules/index.js';
import type { Resource } from '../domain/schemas.js';
import type {
  AlertRecord,
  CommandRecord,
  CommandSource,
  EventRecord,
  Workspace,
  WorkspaceSettings,
} from '../domain/types.js';
import {
  type AlertChanges,
  type CommandOutcome,
  conflict,
  rejected,
  type SyncSummary,
} from './outcomes.js';
import type { TransactionStore } from './ports.js';
import { spokenCommitted, spokenReplayed } from './spoken.js';

/** Everything needed to plan and, if allowed, apply one change. Built the same way for a new request and for a confirmation. */
export interface Prepared {
  readonly workspace: Workspace;
  readonly settings: WorkspaceSettings;
  readonly operation: Operation;
  readonly bound: BoundOperation;
  readonly commandId: string;
  readonly actor: string;
  readonly source: CommandSource;
  readonly clientName: string | null;
  readonly resourceId: string;
  readonly secondary: Resource | undefined;
  readonly names: ReadonlyMap<string, string>;
  readonly reversing: EventRecord | undefined;
}

export type Mode =
  /** A new request: apply it, or, if the operation wants a human "yes", park it and return a prompt. */
  | {
      readonly kind: 'propose';
      /** The token to hand back if a yes is needed, its stored hash, and when it stops working. */
      readonly prompt: { readonly token: string; readonly tokenHash: string; readonly expiresAt: Date };
    }
  /** The human said yes: apply the parked change if nothing has moved underneath it. */
  | { readonly kind: 'confirm'; readonly command: CommandRecord };

export const DUPLICATE_MESSAGE =
  'That idempotency key was already used for a different request. Use a new key for a new request, or repeat the original request exactly.';
export const STALE_MESSAGE = 'That item changed after I asked, so nothing was done. Please ask for the change again.';
export const ALREADY_UNDONE_MESSAGE = 'That change has already been undone.';

const NO_ALERT_CHANGES: AlertChanges = { opened: [], resolved: [] };

async function settle(
  tx: TransactionStore,
  mode: Mode,
  status: 'confirmed' | 'cancelled' | 'expired',
  eventId: string | null,
): Promise<void> {
  if (mode.kind === 'confirm') {
    await tx.updateCommandStatus(mode.command.id, status, eventId);
  }
}

/** The result for a request whose event already exists: the same request again, or a conflict. */
export async function replay(
  tx: TransactionStore,
  prepared: Prepared,
  existing: EventRecord,
  resource: Resource,
): Promise<CommandOutcome> {
  const sameRequest =
    existing.resourceId === resource.id &&
    // OPERATION_NAMES grows with each milestone; the check matters as soon as there is more than one.
    existing.operation === prepared.operation.name &&
    canonicalJson(existing.arguments) === canonicalJson(prepared.bound.arguments);
  if (!sameRequest) {
    return conflict(DUPLICATE_MESSAGE);
  }
  const sheets = (await tx.getSyncStatus(existing.eventId, 'sheets')) ?? 'not_configured';
  return {
    status: 'committed',
    replayed: true,
    event: existing,
    resource,
    alerts: NO_ALERT_CHANGES,
    sync: { sheets },
    spoken: spokenReplayed(existing.summary, sheets),
  };
}

/** Evaluates every rule on the resource's new state, opening or clearing alerts inside the same transaction. */
async function applyRules(
  tx: TransactionStore,
  workspaceId: string,
  resource: Resource,
  eventId: string,
): Promise<AlertChanges> {
  const opened: AlertRecord[] = [];
  const resolved: AlertRecord[] = [];
  for (const verdict of evaluateRules(resource)) {
    if (verdict.breached) {
      const alert = await tx.openAlert({
        workspaceId,
        resourceId: resource.id,
        rule: verdict.rule,
        message: verdict.message,
        eventId,
      });
      if (alert) {
        opened.push(alert);
      }
    } else {
      resolved.push(...(await tx.resolveAlerts(workspaceId, resource.id, verdict.rule, eventId)));
    }
  }
  return { opened, resolved };
}

/**
 * Runs inside one transaction: lock the resource, re-validate against its fresh state, then either
 * write event + state + board version + alerts + outbox together, or park the change for confirmation.
 */
export async function runCommand(tx: TransactionStore, prepared: Prepared, mode: Mode): Promise<CommandOutcome> {
  const { workspace, bound } = prepared;
  const locked = await tx.lockResource(workspace.id, prepared.resourceId);
  if (!locked) {
    await settle(tx, mode, 'cancelled', null);
    return rejected('INVALID_TARGET', 'That resource no longer exists.');
  }

  const existing = await tx.findEventByCommandId(workspace.id, prepared.commandId);
  if (existing) {
    const outcome = await replay(tx, prepared, existing, locked);
    if (outcome.status === 'committed') {
      await settle(tx, mode, 'confirmed', existing.eventId);
    } else {
      await settle(tx, mode, 'cancelled', null);
    }
    return outcome;
  }

  if (mode.kind === 'confirm' && locked.version !== mode.command.expectedVersion) {
    await tx.updateCommandStatus(mode.command.id, 'expired', null);
    return conflict(STALE_MESSAGE);
  }

  const plan = bound.plan(locked, {
    settings: prepared.settings,
    secondary: prepared.secondary,
    names: prepared.names,
    reversing: prepared.reversing,
  });
  if (plan.kind === 'rejected') {
    await settle(tx, mode, 'cancelled', null);
    return rejected(plan.code, plan.message);
  }

  if (mode.kind === 'propose' && plan.confirmation) {
    const { token, tokenHash, expiresAt } = mode.prompt;
    await tx.insertCommand({
      workspaceId: workspace.id,
      commandId: prepared.commandId,
      actor: prepared.actor,
      source: prepared.source,
      clientName: prepared.clientName,
      operation: prepared.operation.name,
      resourceId: locked.id,
      arguments: bound.arguments,
      secondaryResourceId: prepared.secondary?.id ?? null,
      reversingEventId: prepared.reversing?.eventId ?? null,
      expectedVersion: locked.version,
      reason: plan.confirmation.reason,
      readback: plan.confirmation.readback,
      tokenHash,
      expiresAt,
    });
    return {
      status: 'confirmation_required',
      confirmation: { token, readback: plan.confirmation.readback, reason: plan.confirmation.reason, expiresAt },
      spoken: plan.confirmation.readback,
    };
  }

  const event = await tx.insertEvent({
    workspaceId: workspace.id,
    commandId: prepared.commandId,
    resourceId: locked.id,
    operation: prepared.operation.name,
    arguments: bound.arguments,
    before: plan.before,
    after: plan.after,
    summary: plan.summary,
    actor: prepared.actor,
    source: prepared.source,
    clientName: prepared.clientName,
    reversalOf: plan.reversesEventId ?? null,
  });
  const resource = await tx.updateResourceAttributes(workspace.id, locked.id, plan.attributes, locked.version);
  await tx.bumpBoardVersion(workspace.id);
  const alerts = await applyRules(tx, workspace.id, resource, event.eventId);

  let sheets: SyncSummary['sheets'] = 'not_configured';
  if (workspace.integrations.sheets) {
    await tx.enqueueSync(workspace.id, event.eventId, 'sheets');
    sheets = 'pending';
  }
  await settle(tx, mode, 'confirmed', event.eventId);
  return {
    status: 'committed',
    replayed: false,
    event,
    resource,
    alerts,
    sync: { sheets },
    spoken: spokenCommitted(plan.spoken, sheets, alerts),
  };
}
