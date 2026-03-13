/**
 * Unit tests for `session-cache` — LRU eviction, TTL expiry, and core API.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  sessionCache,
  MAX_CACHE_ENTRIES,
  CACHE_TTL_MS,
} from "@/lib/session-cache";
import type { CacheEntry } from "@/lib/session-cache";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<CacheEntry> = {}): CacheEntry {
  return {
    messages: [],
    scrollPosition: 0,
    scrollHeight: 0,
    sessionStatus: "idle",
    lastMessageId: null,
    timestamp: Date.now(),
    pagination: { hasMore: false, oldestMessageId: null, totalCount: null },
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("sessionCache", () => {
  // Clear the shared module-level state between tests.
  beforeEach(() => {
    sessionCache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("set / get basic semantics", () => {
    it("returns the stored entry immediately after set", () => {
      const entry = makeEntry({ scrollPosition: 42, sessionStatus: "busy" });
      sessionCache.set("sess-1", "inst-1", entry);

      const result = sessionCache.get("sess-1", "inst-1");
      expect(result).not.toBeNull();
      expect(result?.scrollPosition).toBe(42);
      expect(result?.sessionStatus).toBe("busy");
    });

    it("returns null for a key that was never set", () => {
      expect(sessionCache.get("nonexistent", "inst-0")).toBeNull();
    });

    it("overwrites an existing entry for the same key", () => {
      sessionCache.set("sess-1", "inst-1", makeEntry({ scrollPosition: 10 }));
      sessionCache.set("sess-1", "inst-1", makeEntry({ scrollPosition: 99 }));

      const result = sessionCache.get("sess-1", "inst-1");
      expect(result?.scrollPosition).toBe(99);
    });
  });

  describe("delete", () => {
    it("removes the entry so subsequent get returns null", () => {
      sessionCache.set("sess-del", "inst-1", makeEntry());
      sessionCache.delete("sess-del", "inst-1");

      expect(sessionCache.get("sess-del", "inst-1")).toBeNull();
    });

    it("is a no-op for a key that does not exist", () => {
      // Should not throw
      expect(() => sessionCache.delete("ghost", "inst-1")).not.toThrow();
    });
  });

  describe("clear", () => {
    it("removes all entries", () => {
      sessionCache.set("a", "inst-1", makeEntry());
      sessionCache.set("b", "inst-1", makeEntry());
      sessionCache.set("c", "inst-1", makeEntry());

      sessionCache.clear();

      expect(sessionCache.get("a", "inst-1")).toBeNull();
      expect(sessionCache.get("b", "inst-1")).toBeNull();
      expect(sessionCache.get("c", "inst-1")).toBeNull();
    });
  });

  describe("TTL expiry", () => {
    it("returns null and deletes entry when TTL has elapsed", () => {
      // Store an entry with a timestamp that is older than CACHE_TTL_MS.
      const expired = makeEntry({ timestamp: Date.now() - CACHE_TTL_MS - 1 });
      sessionCache.set("old", "inst-1", expired);

      expect(sessionCache.get("old", "inst-1")).toBeNull();
    });

    it("returns the entry when it is exactly within TTL", () => {
      const recent = makeEntry({ timestamp: Date.now() - CACHE_TTL_MS + 5_000 });
      sessionCache.set("fresh", "inst-1", recent);

      expect(sessionCache.get("fresh", "inst-1")).not.toBeNull();
    });

    it("returns the entry at the exact TTL boundary (not strictly greater)", () => {
      // The check is `> CACHE_TTL_MS`, so exactly CACHE_TTL_MS should still be valid.
      const boundary = makeEntry({ timestamp: Date.now() - CACHE_TTL_MS });
      sessionCache.set("boundary", "inst-1", boundary);

      expect(sessionCache.get("boundary", "inst-1")).not.toBeNull();
    });
  });

  describe("LRU eviction", () => {
    it(`evicts the oldest entry when the ${MAX_CACHE_ENTRIES + 1}th entry is inserted`, () => {
      // Fill the cache to capacity.
      for (let i = 1; i <= MAX_CACHE_ENTRIES; i++) {
        sessionCache.set(`sess-${i}`, "inst", makeEntry({ scrollPosition: i }));
      }

      // Inserting one more should evict sess-1 (the oldest).
      sessionCache.set("sess-overflow", "inst", makeEntry({ scrollPosition: 999 }));

      expect(sessionCache.get("sess-1", "inst")).toBeNull();
      // All other entries remain.
      for (let i = 2; i <= MAX_CACHE_ENTRIES; i++) {
        expect(sessionCache.get(`sess-${i}`, "inst")).not.toBeNull();
      }
      expect(sessionCache.get("sess-overflow", "inst")).not.toBeNull();
    });

    it("promotes a get'd entry so it is not the next eviction target", () => {
      // Fill the cache to capacity, with sess-1 inserted first.
      for (let i = 1; i <= MAX_CACHE_ENTRIES; i++) {
        sessionCache.set(`sess-${i}`, "inst", makeEntry({ scrollPosition: i }));
      }

      // Access sess-1 — this should move it to the "most recently used" end.
      const promoted = sessionCache.get("sess-1", "inst");
      expect(promoted).not.toBeNull();

      // Now inserting one new entry should evict sess-2 (now the oldest), not sess-1.
      sessionCache.set("sess-new", "inst", makeEntry({ scrollPosition: 111 }));

      expect(sessionCache.get("sess-1", "inst")).not.toBeNull(); // promoted — survived
      expect(sessionCache.get("sess-2", "inst")).toBeNull();     // evicted
      expect(sessionCache.get("sess-new", "inst")).not.toBeNull();
    });
  });

  describe("cache key format", () => {
    it("uses sessionId:instanceId as the key, keeping entries isolated", () => {
      sessionCache.set("sess-a", "inst-1", makeEntry({ scrollPosition: 1 }));
      sessionCache.set("sess-a", "inst-2", makeEntry({ scrollPosition: 2 }));
      sessionCache.set("sess-b", "inst-1", makeEntry({ scrollPosition: 3 }));

      expect(sessionCache.get("sess-a", "inst-1")?.scrollPosition).toBe(1);
      expect(sessionCache.get("sess-a", "inst-2")?.scrollPosition).toBe(2);
      expect(sessionCache.get("sess-b", "inst-1")?.scrollPosition).toBe(3);
    });

    it("works with IDs containing special characters (UUIDs, dots, dashes)", () => {
      const sessionId = "01JQTM2P4XB7V9N3K5F8G6H0WD";
      const instanceId = "instance.server-01.local:8080";
      const entry = makeEntry({ scrollPosition: 77 });

      sessionCache.set(sessionId, instanceId, entry);

      const result = sessionCache.get(sessionId, instanceId);
      expect(result).not.toBeNull();
      expect(result?.scrollPosition).toBe(77);
    });

    it("does not collide when separator character appears in IDs", () => {
      // With a naive ":" separator, sessionId="sess:foo" + instanceId="bar"
      // would produce the same key as sessionId="sess" + instanceId="foo:bar".
      // JSON.stringify prevents this collision.
      sessionCache.set("sess:foo", "bar", makeEntry({ scrollPosition: 10 }));
      sessionCache.set("sess", "foo:bar", makeEntry({ scrollPosition: 20 }));

      expect(sessionCache.get("sess:foo", "bar")?.scrollPosition).toBe(10);
      expect(sessionCache.get("sess", "foo:bar")?.scrollPosition).toBe(20);
    });
  });
});
