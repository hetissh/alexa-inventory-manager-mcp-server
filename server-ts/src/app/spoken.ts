import type { BoardMetric } from '../domain/board.js';
import type { Candidate } from '../domain/matcher.js';
import type { Resource } from '../domain/schemas.js';
import { type SyncStatus } from '../domain/types.js';
import type { AlertChanges } from './outcomes.js';

// Sentences meant to be read aloud. They live here (not in the MCP layer) so a future Alexa
// adapter says exactly the same thing.

export function spokenNotFound(query: string): string {
  return `I couldn't find "${query}" in this workspace.`;
}

export function spokenAmbiguous(query: string, candidates: readonly Candidate[]): string {
  const [only] = candidates;
  if (candidates.length === 1 && only) {
    return `I couldn't find an exact match for "${query}". Did you mean ${only.name}?`;
  }
  return `I found several matches for "${query}": ${candidates.map((candidate) => candidate.name).join(', ')}. Which one do you mean?`;
}

function spokenSync(sheets: SyncStatus | 'not_configured'): string {
  switch (sheets) {
    case 'not_configured':
      return '';
    case 'pending':
    case 'in_progress':
      return ' The spreadsheet update is pending.';
    case 'retrying':
      return ' The spreadsheet update is being retried.';
    case 'failed':
      return ' The spreadsheet update failed.';
    case 'synced':
      return ' The spreadsheet is up to date.';
  }
}

function spokenAlertChanges({ opened, resolved }: AlertChanges): string {
  return [
    ...opened.map((alert) => `Alert: ${alert.message}`),
    ...resolved.map((alert) => `Alert cleared for ${alert.resourceName}.`),
  ]
    .map((sentence) => ` ${sentence}`)
    .join('');
}

export function spokenCommitted(
  sentence: string,
  sheets: SyncStatus | 'not_configured',
  alerts: AlertChanges,
): string {
  return `${sentence}${spokenAlertChanges(alerts)}${spokenSync(sheets)}`;
}

export function spokenReplayed(summary: string, sheets: SyncStatus | 'not_configured'): string {
  return `This request was already applied earlier: ${summary}.${spokenSync(sheets)}`;
}

export function spokenResource(resource: Resource): string {
  switch (resource.type) {
    case 'inventory_item': {
      const { quantity, unit, reorderLevel } = resource.attributes;
      return `${resource.name}: ${String(quantity)} ${unit} in stock (reorder at ${String(reorderLevel)}).`;
    }
    case 'equipment':
      return `${resource.name} is ${resource.attributes.status.replaceAll('_', ' ')}.`;
    case 'menu_item': {
      const { price, currency, status } = resource.attributes;
      return `${resource.name} (${String(price)} ${currency}) is ${status.replaceAll('_', ' ')}.`;
    }
    case 'dining_table': {
      const { seats, status } = resource.attributes;
      return `${resource.name} (seats ${String(seats)}) is ${status.replaceAll('_', ' ')}.`;
    }
    case 'job': {
      const { status, description } = resource.attributes;
      return `${resource.name} (${description}) is ${status.replaceAll('_', ' ')}.`;
    }
    case 'technician':
      return `${resource.name} is ${resource.attributes.active ? 'on duty' : 'not on duty'}.`;
  }
}

export function spokenEvents(count: number): string {
  if (count === 0) {
    return 'No changes have been recorded yet.';
  }
  return count === 1 ? 'Here is the most recent change.' : `Here are the ${String(count)} most recent changes.`;
}

export function spokenAlertList(count: number, status: 'open' | 'resolved' | 'all'): string {
  const kind = status === 'all' ? '' : `${status} `;
  if (count === 0) {
    return `There are no ${kind}alerts.`;
  }
  return count === 1 ? `There is 1 ${kind}alert.` : `There are ${String(count)} ${kind}alerts.`;
}

export function spokenBoard(title: string, metrics: readonly BoardMetric[]): string {
  return `${title}: ${metrics.map((metric) => `${metric.label} ${String(metric.value)}`).join(', ')}.`;
}

export function spokenWorkspace(name: string, label: string, resourceCount: number): string {
  return `${name} is a ${label.toLowerCase()} workspace with ${String(resourceCount)} resources.`;
}
