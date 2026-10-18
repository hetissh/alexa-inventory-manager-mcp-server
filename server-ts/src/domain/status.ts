import type { WorkspaceSettings } from './types.js';

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
