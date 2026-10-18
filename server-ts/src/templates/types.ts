import type { MetricDefinition } from '../domain/board.js';
import type { ResourceSeed } from '../domain/schemas.js';
import type { TemplateId, WorkspaceSettings } from '../domain/types.js';

/** A workspace template is configuration plus seed data on top of the shared resource/event engine. */
export interface Template {
  readonly id: TemplateId;
  readonly label: string;
  readonly settings: WorkspaceSettings;
  readonly workspace: { readonly id: string; readonly name: string; readonly timezone: string };
  /** What the live board for this workspace shows. */
  readonly board: { readonly title: string; readonly metrics: readonly MetricDefinition[] };
  readonly resources: readonly ResourceSeed[];
}
