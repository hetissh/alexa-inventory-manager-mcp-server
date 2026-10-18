import type { Candidate } from '../domain/matcher.js';
import type { RejectionCode } from '../domain/operations/types.js';
import type { Resource } from '../domain/schemas.js';
import type { AlertRecord, EventRecord, SyncStatus } from '../domain/types.js';

export interface SyncSummary {
  readonly sheets: SyncStatus | 'not_configured';
}

/** Alerts this one command opened or cleared (not every alert that exists). */
export interface AlertChanges {
  readonly opened: readonly AlertRecord[];
  readonly resolved: readonly AlertRecord[];
}

/** What a person must be asked, and the token that carries their answer back. */
export interface ConfirmationPrompt {
  readonly token: string;
  /** The question to read back, e.g. "Mark Compressor 2 as under maintenance (currently available)?". */
  readonly readback: string;
  readonly reason: string;
  readonly expiresAt: Date;
}

export type CommandOutcome =
  | {
      readonly status: 'committed';
      /** True when this request had already been applied and nothing new was written. */
      readonly replayed: boolean;
      readonly event: EventRecord;
      readonly resource: Resource;
      readonly alerts: AlertChanges;
      readonly sync: SyncSummary;
      readonly spoken: string;
    }
  | {
      /** Nothing has changed yet: ask the user, then confirm or cancel with the token. */
      readonly status: 'confirmation_required';
      readonly confirmation: ConfirmationPrompt;
      readonly spoken: string;
    }
  | { readonly status: 'cancelled'; readonly spoken: string }
  | {
      readonly status: 'ambiguous';
      readonly query: string;
      /** Which name this was ("assignee"), when it is not the main target. */
      readonly role?: string;
      readonly candidates: readonly Candidate[];
      readonly spoken: string;
    }
  | { readonly status: 'not_found'; readonly query: string; readonly role?: string; readonly spoken: string }
  | { readonly status: 'rejected'; readonly code: RejectionCode; readonly message: string; readonly spoken: string }
  | { readonly status: 'conflict'; readonly message: string; readonly spoken: string };

export function rejected(code: RejectionCode, message: string): CommandOutcome {
  return { status: 'rejected', code, message, spoken: message };
}

export function conflict(message: string): CommandOutcome {
  return { status: 'conflict', message, spoken: message };
}
