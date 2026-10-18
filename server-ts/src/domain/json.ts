import type { JsonValue } from './types.js';

/** Serialises JSON with object keys sorted, so equal values always produce equal strings. */
export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : 1)) // keys are unique, so never equal
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}
