import type { ResourceSeed } from '../domain/schemas.js';
import type { TemplateId, WorkspaceSettings } from '../domain/types.js';

/** A workspace template is configuration plus seed data on top of the shared resource/event engine. */
export interface Template {
  readonly id: TemplateId;
  readonly label: string;
  readonly settings: WorkspaceSettings;
  /** Statuses a piece of equipment may be in (used from M2 by set-status). */
  readonly equipmentStatuses: readonly string[];
  readonly workspace: { readonly id: string; readonly name: string; readonly timezone: string };
  readonly resources: readonly ResourceSeed[];
}
