import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, vi } from 'vitest';

import {
  type CommandOutcome,
  type CommandRequest,
  type CommandService,
  type ConfirmationRequest,
  createCommandService,
} from '../../src/app/commandService.js';
import { hashToken } from '../../src/app/confirmationCode.js';
import type { AppLogger, Store } from '../../src/app/ports.js';
import type { JsonObject, OperationName } from '../../src/domain/types.js';
import { createPgStore } from '../../src/infra/db/pgStore.js';
import { CAFE_ID, createTestPool, REPAIR_ID, resetAll, WORKSPACE_ID } from './db.js';

export const ACTOR = 'manager-1';
export const TTL_SECONDS = 120;

export interface Clock {
  current: Date;
  advance(seconds: number): void;
}

export interface CommandHarness {
  readonly pool: Pool;
  readonly store: Store;
  readonly service: CommandService;
  readonly clock: Clock;
  readonly logger: AppLogger;
  /** Builds a service over the same store with different options (for example another clock). */
  serviceWith(store: Store): CommandService;
}

/**
 * Registers hooks that give each test a freshly reset database, a deterministic clock and
 * predictable confirmation tokens. Returns an accessor to call inside tests.
 */
export function useCommandHarness(): () => CommandHarness {
  let pool: Pool | undefined;
  let current: CommandHarness | undefined;

  beforeAll(() => {
    pool = createTestPool();
  });
  afterAll(async () => {
    await pool?.end();
  });
  beforeEach(async () => {
    if (!pool) {
      throw new Error('pool not ready');
    }
    await resetAll(pool);
    const clock: Clock = {
      current: new Date('2026-10-19T09:00:00.000Z'),
      advance(seconds) {
        this.current = new Date(this.current.getTime() + seconds * 1000);
      },
    };
    let counter = 0;
    const logger: AppLogger = { info: vi.fn(), warn: vi.fn() };
    const store = createPgStore(pool);
    const build = (forStore: Store): CommandService =>
      createCommandService(forStore, logger, {
        ttlSeconds: TTL_SECONDS,
        now: () => clock.current,
        generateToken: () => {
          counter += 1;
          return String(counter).padStart(22, 't');
        },
      });
    current = { pool, store, service: build(store), clock, logger, serviceWith: build };
  });

  return () => {
    if (!current) {
      throw new Error('harness used outside a test');
    }
    return current;
  };
}

let commandCounter = 0;

export function request(
  workspaceId: string,
  operation: OperationName,
  target: string,
  args: unknown,
  overrides: Partial<CommandRequest> = {},
): CommandRequest {
  commandCounter += 1;
  return {
    commandId: `cmd-${String(commandCounter)}`,
    workspaceId,
    actorId: ACTOR,
    source: 'mcp',
    clientName: 'test-client',
    operation,
    target,
    arguments: args,
    ...overrides,
  };
}

export const adjust = (
  h: CommandHarness,
  target: string,
  delta: number,
  overrides: Partial<CommandRequest> = {},
): Promise<CommandOutcome> => h.service.execute(request(WORKSPACE_ID, 'ADJUST_QUANTITY', target, { delta }, overrides));

export const setStatus = (
  h: CommandHarness,
  workspaceId: string,
  target: string,
  status: string,
  overrides: Partial<CommandRequest> = {},
): Promise<CommandOutcome> => h.service.execute(request(workspaceId, 'SET_STATUS', target, { status }, overrides));

export const assign = (
  h: CommandHarness,
  job: string,
  assignee: string,
  overrides: Partial<CommandRequest> = {},
): Promise<CommandOutcome> => h.service.execute(request(REPAIR_ID, 'ASSIGN_JOB', job, { assignee }, overrides));

export const undo = (
  h: CommandHarness,
  workspaceId: string = WORKSPACE_ID,
  overrides: Partial<CommandRequest> = {},
): Promise<CommandOutcome> => h.service.execute(request(workspaceId, 'REVERSE_EVENT', '', {}, overrides));

export function confirmation(workspaceId: string, token: string, actorId: string = ACTOR): ConfirmationRequest {
  return { workspaceId, actorId, token };
}

/** Asserts the outcome has the given status and narrows its type. */
export function expectStatus<S extends CommandOutcome['status']>(
  outcome: CommandOutcome,
  status: S,
): Extract<CommandOutcome, { status: S }> {
  if (outcome.status !== status) {
    throw new Error(`expected ${status}, got ${outcome.status}: ${outcome.spoken}`);
  }
  return outcome as Extract<CommandOutcome, { status: S }>;
}

/** The confirmation token from an outcome that must be `confirmation_required`. */
export function tokenOf(outcome: CommandOutcome): string {
  return expectStatus(outcome, 'confirmation_required').confirmation.token;
}

// ---- database probes

async function one<T>(pool: Pool, sql: string, params: unknown[]): Promise<T> {
  const result = await pool.query<{ value: T }>(sql, params);
  return result.rows[0]?.value as T;
}

export const eventCount = (h: CommandHarness, workspaceId: string = WORKSPACE_ID): Promise<number> =>
  one<string>(h.pool, 'SELECT count(*) AS value FROM events WHERE workspace_id = $1', [workspaceId]).then(Number);

export const attributesOf = (h: CommandHarness, workspaceId: string, resourceId: string): Promise<JsonObject> =>
  one<JsonObject>(h.pool, 'SELECT attributes AS value FROM resources WHERE workspace_id = $1 AND id = $2', [workspaceId, resourceId]);

export const quantityOf = async (h: CommandHarness, resourceId: string): Promise<number> =>
  Number((await attributesOf(h, WORKSPACE_ID, resourceId))['quantity']);

export const boardVersion = (h: CommandHarness, workspaceId: string = WORKSPACE_ID): Promise<number> =>
  one<string>(h.pool, 'SELECT board_version AS value FROM workspaces WHERE id = $1', [workspaceId]).then(Number);

export const commandStatus = (h: CommandHarness, token: string): Promise<string | undefined> =>
  one<string | undefined>(h.pool, 'SELECT status AS value FROM commands WHERE token_hash = $1', [hashToken(token)]);

export { CAFE_ID, REPAIR_ID, WORKSPACE_ID };
