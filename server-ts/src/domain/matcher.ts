import { normalize, normalizeTokens } from './normalize.js';
import type { Resource, ResourceType } from './schemas.js';

export const MATCH_KINDS = ['id', 'name', 'alias', 'tokens', 'fuzzy'] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];

export interface RankedResource {
  readonly resource: Resource;
  readonly matchedBy: MatchKind;
  /** 0..1, higher is better. */
  readonly score: number;
}

/** A lightweight description of a possible match, safe to show to a user. */
export interface Candidate {
  readonly id: string;
  readonly name: string;
  readonly type: ResourceType;
  readonly matchedBy: MatchKind;
  readonly score: number;
}

export type Resolution =
  | { readonly kind: 'resolved'; readonly match: RankedResource }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly Candidate[] }
  | { readonly kind: 'not_found' };

export interface ResolveOptions {
  /**
   * Whether a unique, high-confidence fuzzy (typo-tolerant) match may be resolved without asking.
   * Reads may allow it; writes must not, so a mis-heard name never changes the wrong record.
   */
  readonly autoResolveFuzzy: boolean;
}

const FUZZY_SUGGEST_MIN = 0.5;
const FUZZY_AUTO_MIN = 0.8;
const FUZZY_AUTO_MARGIN = 0.15;
const MAX_CANDIDATES = 5;

// name and alias are the same tier: a name match on one resource and an alias match on another is ambiguous.
const TIER: Record<MatchKind, number> = { id: 0, name: 1, alias: 1, tokens: 2, fuzzy: 3 };

interface PreparedQuery {
  readonly lower: string;
  readonly text: string;
  readonly tokens: readonly string[];
}

function prepare(rawQuery: string): PreparedQuery {
  return { lower: rawQuery.trim().toLowerCase(), text: normalize(rawQuery), tokens: normalizeTokens(rawQuery) };
}

function isNumeric(token: string): boolean {
  return /\d/.test(token);
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function bigrams(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let index = 0; index < text.length - 1; index += 1) {
    const pair = text.slice(index, index + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return counts;
}

/** Sørensen–Dice coefficient over character bigrams: 1 = identical, 0 = nothing in common. */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) {
    return 1;
  }
  if (a.length < 2 || b.length < 2) {
    return 0;
  }
  const bCounts = bigrams(b);
  let shared = 0;
  for (const [pair, count] of bigrams(a)) {
    shared += Math.min(count, bCounts.get(pair) ?? 0);
  }
  return (2 * shared) / (a.length - 1 + (b.length - 1));
}

function scoreResource(resource: Resource, query: PreparedQuery): RankedResource | undefined {
  if (resource.id.toLowerCase() === query.lower) {
    return { resource, matchedBy: 'id', score: 1 };
  }
  const names = [resource.name, ...resource.aliases].map((text, index) => ({
    kind: index === 0 ? ('name' as const) : ('alias' as const),
    text: normalize(text),
    tokens: normalizeTokens(text),
  }));

  const exact = names.find((entry) => entry.text === query.text);
  if (exact) {
    return { resource, matchedBy: exact.kind, score: 1 };
  }

  let bestTokenScore = 0;
  for (const entry of names) {
    if (query.tokens.every((token) => entry.tokens.includes(token))) {
      bestTokenScore = Math.max(bestTokenScore, query.tokens.length / entry.tokens.length);
    }
  }
  if (bestTokenScore > 0) {
    return { resource, matchedBy: 'tokens', score: round(bestTokenScore) };
  }

  // Numbers identify things ("Compressor 2" is not "Compressor 3"), so a typo-tolerant match is
  // only allowed between names whose numbers agree.
  const queryNumbers = query.tokens.filter(isNumeric);
  const fuzzy = Math.max(
    0,
    ...names
      .filter((entry) => sameMembers(queryNumbers, entry.tokens.filter(isNumeric)))
      .map((entry) => diceCoefficient(query.text, entry.text)),
  );
  return fuzzy >= FUZZY_SUGGEST_MIN ? { resource, matchedBy: 'fuzzy', score: round(fuzzy) } : undefined;
}

function compare(a: RankedResource, b: RankedResource): number {
  return (
    TIER[a.matchedBy] - TIER[b.matchedBy] ||
    b.score - a.score ||
    a.resource.name.localeCompare(b.resource.name)
  );
}

export function toCandidate(ranked: RankedResource): Candidate {
  const { resource, matchedBy, score } = ranked;
  return { id: resource.id, name: resource.name, type: resource.type, matchedBy, score };
}

/** Every resource that matches the query at all, best match first. */
export function rankResources(rawQuery: string, resources: readonly Resource[]): RankedResource[] {
  const query = prepare(rawQuery);
  if (query.tokens.length === 0) {
    return [];
  }
  return resources
    .map((resource) => scoreResource(resource, query))
    .filter((ranked): ranked is RankedResource => ranked !== undefined)
    .sort(compare);
}

/**
 * Resolves a spoken/typed name to exactly one resource, or says why it can't.
 * Never guesses: several equally good matches, or a typo-level match that isn't allowed to
 * auto-resolve, come back as `ambiguous` with candidates for the user to choose from.
 */
export function resolveResource(
  rawQuery: string,
  resources: readonly Resource[],
  options: ResolveOptions,
): Resolution {
  const ranked = rankResources(rawQuery, resources);
  const [best, second] = ranked;
  if (best === undefined) {
    return { kind: 'not_found' };
  }

  if (best.matchedBy !== 'fuzzy') {
    const topTier = ranked.filter((entry) => TIER[entry.matchedBy] === TIER[best.matchedBy]);
    return topTier.length === 1
      ? { kind: 'resolved', match: best }
      : { kind: 'ambiguous', candidates: topTier.slice(0, MAX_CANDIDATES).map(toCandidate) };
  }

  const clearWinner = second === undefined || best.score - second.score >= FUZZY_AUTO_MARGIN;
  if (options.autoResolveFuzzy && best.score >= FUZZY_AUTO_MIN && clearWinner) {
    return { kind: 'resolved', match: best };
  }
  return { kind: 'ambiguous', candidates: ranked.slice(0, MAX_CANDIDATES).map(toCandidate) };
}
