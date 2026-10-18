import type { Candidate } from '../domain/matcher.js';
import type { Resource } from '../domain/schemas.js';
import type { SyncStatus } from '../domain/types.js';

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

export function spokenCommitted(sentence: string, sheets: SyncStatus | 'not_configured'): string {
  return `${sentence}${spokenSync(sheets)}`;
}

export function spokenReplayed(summary: string, sheets: SyncStatus | 'not_configured'): string {
  return `This request was already applied earlier: ${summary}.${spokenSync(sheets)}`;
}

export function spokenResource(resource: Resource): string {
  if (resource.type === 'inventory_item') {
    const { quantity, unit, reorderLevel } = resource.attributes;
    return `${resource.name}: ${String(quantity)} ${unit} in stock (reorder at ${String(reorderLevel)}).`;
  }
  return `${resource.name} is ${resource.attributes.status.replaceAll('_', ' ')}.`;
}

export function spokenEvents(count: number): string {
  if (count === 0) {
    return 'No changes have been recorded yet.';
  }
  return count === 1 ? 'Here is the most recent change.' : `Here are the ${String(count)} most recent changes.`;
}
