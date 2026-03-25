/**
 * Module-level LRU cache for session messages, scroll position, and pagination state.
 * Used to make session switching feel instant by hydrating from cached state
 * instead of doing a full API load on every mount.
 *
 * No React dependencies — pure TypeScript module.
 */

import type { AccumulatedMessage } from "@/lib/api-types";
import type { PrReference } from "@/lib/pr-utils";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum number of session entries to hold in memory. LRU eviction applies. */
export const MAX_CACHE_ENTRIES = 10;

/** Entries older than this are treated as a cache miss and deleted on access. */
export const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PaginationSnapshot {
  hasMore: boolean;
  oldestMessageId: string | null;
  totalCount: number | null;
}

export interface CacheEntry {
  /** The accumulated messages for this session. */
  messages: AccumulatedMessage[];
  /** viewport.scrollTop at the time of save. */
  scrollPosition: number;
  /** viewport.scrollHeight at the time of save — used to compute relative restore position. */
  scrollHeight: number;
  /** Last known session activity status. */
  sessionStatus: "idle" | "busy";
  /** The last known message ID — used for gap-fill via loadMessagesSince on hydration. */
  lastMessageId: string | null;
  /** Unix timestamp (ms) when this entry was saved — used for TTL checks. */
  timestamp: number;
  /** Pagination state snapshot — restored to avoid incorrect "scroll up for older" state. */
  pagination: PaginationSnapshot;
  /** PR references detected in the session — persisted so they survive message pagination/trimming. */
  prReferences?: PrReference[];
}

// ─── LRU Cache implementation ─────────────────────────────────────────────

/**
 * Builds a collision-safe cache key from sessionId and instanceId.
 * Uses JSON.stringify to avoid collisions when either value contains
 * the separator character (e.g. instanceId with a port like "host:8080").
 */
function buildKey(sessionId: string, instanceId: string): string {
  return JSON.stringify([sessionId, instanceId]);
}

const _store = new Map<string, CacheEntry>();

function get(sessionId: string, instanceId: string): CacheEntry | null {
  const key = buildKey(sessionId, instanceId);
  const entry = _store.get(key);
  if (!entry) return null;

  // TTL check — expired entries are deleted and treated as a miss.
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    _store.delete(key);
    return null;
  }

  // Promote to most-recently-used: delete then re-insert moves to end of
  // Map insertion order, which is what we use for LRU eviction.
  _store.delete(key);
  _store.set(key, entry);
  return entry;
}

function set(sessionId: string, instanceId: string, entry: CacheEntry): void {
  const key = buildKey(sessionId, instanceId);

  // Delete-then-set moves this key to the end (most recently used).
  _store.delete(key);
  _store.set(key, entry);

  // Evict the oldest entry if we're over capacity.
  if (_store.size > MAX_CACHE_ENTRIES) {
    const oldestKey = _store.keys().next().value;
    if (oldestKey !== undefined) {
      _store.delete(oldestKey);
    }
  }
}

function del(sessionId: string, instanceId: string): void {
  _store.delete(buildKey(sessionId, instanceId));
}

function clear(): void {
  _store.clear();
}

/**
 * Patch just the PR references on an existing cache entry without touching
 * other fields or LRU ordering. If no entry exists yet, stores them in a
 * separate side-map so they can be merged when a full entry is later created.
 */
const _pendingPrs = new Map<string, PrReference[]>();

function patchPrReferences(sessionId: string, instanceId: string, prs: PrReference[]): void {
  const key = buildKey(sessionId, instanceId);
  const entry = _store.get(key);
  if (entry) {
    entry.prReferences = prs;
  } else {
    // No full cache entry yet — stash for later merge
    _pendingPrs.set(key, prs);
  }
}

function getPrReferences(sessionId: string, instanceId: string): PrReference[] | undefined {
  const key = buildKey(sessionId, instanceId);
  const entry = _store.get(key);
  if (entry?.prReferences) return entry.prReferences;
  return _pendingPrs.get(key);
}

// Merge pending PRs into a full entry when it's created via set()
const _originalSet = set;
function setWithPrMerge(sessionId: string, instanceId: string, entry: CacheEntry): void {
  const key = buildKey(sessionId, instanceId);
  // If there are pending PR references and the entry doesn't already have them, merge
  const pending = _pendingPrs.get(key);
  if (pending && !entry.prReferences) {
    entry.prReferences = pending;
  }
  _pendingPrs.delete(key);
  _originalSet(sessionId, instanceId, entry);
}

/** Singleton cache object — import and use directly. */
export const sessionCache = {
  get,
  set: setWithPrMerge,
  delete: del,
  clear,
  patchPrReferences,
  getPrReferences,
} as const;
