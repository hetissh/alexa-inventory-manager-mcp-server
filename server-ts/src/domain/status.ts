import type { WorkspaceSettings } from './types.js';

/** The kinds of resource whose state is a single status word, and so can be changed with SET_STATUS. */
export type StatusBearingType = 'equipment' | 'menu_item' | 'dining_table';

/** The statuses a resource of this kind may be in, according to the workspace's settings. */
export function allowedStatuses(type: StatusBearingType, settings: WorkspaceSettings): readonly string[] {
  switch (type) {
    case 'equipment':
      return settings.equipmentStatuses;
    case 'menu_item':
      return settings.menuItemStatuses;
    case 'dining_table':
      return settings.tableStatuses;
  }
}

type StatusSettings = Pick<WorkspaceSettings, 'statusLabels' | 'statusAliases'>;

/** How a status is said aloud: "out_of_service" -> "out of service", unless the workspace overrides it. */
export function statusLabel(status: string, settings: StatusSettings): string {
  return settings.statusLabels[status] ?? status.replaceAll('_', ' ');
}

/**
 * Maps whatever was said ("sold out", "under maintenance", "broken") to one of the allowed statuses,
 * or undefined if it means none of them.
 */
export function normalizeStatus(
  input: string,
  allowed: readonly string[],
  settings: StatusSettings,
): string | undefined {
  const spoken = input.trim().toLowerCase();
  const key = spoken.replace(/[\s-]+/g, '_');
  if (allowed.includes(key)) {
    return key;
  }
  const byLabel = allowed.find((status) => statusLabel(status, settings).toLowerCase() === spoken);
  if (byLabel !== undefined) {
    return byLabel;
  }
  const alias = settings.statusAliases[spoken];
  return alias !== undefined && allowed.includes(alias) ? alias : undefined;
}
