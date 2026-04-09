import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadSessionLinks,
  saveSessionLinks,
  removeSessionLinks,
  cleanupStaleLinks,
  mergePrReferences,
  mergeIssueReferences,
} from "../link-storage";
import type { StoredSessionLinks, IssueReference } from "../link-storage";
import type { PrReference } from "../pr-utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePr(n: number): PrReference {
  return {
    owner: "acme",
    repo: "repo",
    number: n,
    url: `https://github.com/acme/repo/pull/${n}`,
  };
}

function makeIssue(n: number): IssueReference {
  return {
    owner: "acme",
    repo: "repo",
    number: n,
    url: `https://github.com/acme/repo/issues/${n}`,
  };
}

function makeStoredLinks(
  overrides: Partial<StoredSessionLinks> = {}
): StoredSessionLinks {
  return {
    version: 1,
    updatedAt: Date.now(),
    prs: [],
    issues: [],
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("link-storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ─── loadSessionLinks ──────────────────────────────────────────────────

  describe("loadSessionLinks", () => {
    it("ReturnsNullForNonexistentKey", () => {
      expect(loadSessionLinks("nonexistent")).toBeNull();
    });

    it("ReturnsNullForInvalidJson", () => {
      localStorage.setItem("weave:session-links:bad", "not-json{{{");
      expect(loadSessionLinks("bad")).toBeNull();
    });

    it("ReturnsNullForWrongVersion", () => {
      const data = { version: 99, updatedAt: Date.now(), prs: [], issues: [] };
      localStorage.setItem(
        "weave:session-links:wrong-ver",
        JSON.stringify(data)
      );
      expect(loadSessionLinks("wrong-ver")).toBeNull();
    });

    it("ReturnsNullWhenPrsOrIssuesAreNotArrays", () => {
      const data = { version: 1, updatedAt: Date.now(), prs: "bad", issues: [] };
      localStorage.setItem(
        "weave:session-links:bad-shape",
        JSON.stringify(data)
      );
      expect(loadSessionLinks("bad-shape")).toBeNull();
    });
  });

  // ─── saveSessionLinks / loadSessionLinks roundtrip ─────────────────────

  describe("saveSessionLinks + loadSessionLinks roundtrip", () => {
    it("RoundtripsCorrectly", () => {
      const links = makeStoredLinks({
        prs: [makePr(1), makePr(2)],
        issues: [makeIssue(10)],
      });
      saveSessionLinks("sess-1", links);
      const loaded = loadSessionLinks("sess-1");
      expect(loaded).toEqual(links);
    });

    it("OverwritesPreviousData", () => {
      saveSessionLinks("sess-1", makeStoredLinks({ prs: [makePr(1)] }));
      const updated = makeStoredLinks({ prs: [makePr(1), makePr(2)] });
      saveSessionLinks("sess-1", updated);
      expect(loadSessionLinks("sess-1")).toEqual(updated);
    });
  });

  // ─── removeSessionLinks ────────────────────────────────────────────────

  describe("removeSessionLinks", () => {
    it("RemovesExistingEntry", () => {
      saveSessionLinks("sess-1", makeStoredLinks());
      expect(loadSessionLinks("sess-1")).not.toBeNull();
      removeSessionLinks("sess-1");
      expect(loadSessionLinks("sess-1")).toBeNull();
    });

    it("NoOpForNonexistentKey", () => {
      // Should not throw
      removeSessionLinks("nonexistent");
    });
  });

  // ─── cleanupStaleLinks ─────────────────────────────────────────────────

  describe("cleanupStaleLinks", () => {
    it("RemovesEntriesOlderThanThreshold", () => {
      const old = makeStoredLinks({ updatedAt: Date.now() - 8 * 86_400_000 }); // 8 days ago
      const recent = makeStoredLinks({ updatedAt: Date.now() - 1_000 }); // 1 second ago
      saveSessionLinks("old-sess", old);
      saveSessionLinks("new-sess", recent);

      cleanupStaleLinks(7 * 86_400_000); // 7 days

      expect(loadSessionLinks("old-sess")).toBeNull();
      expect(loadSessionLinks("new-sess")).not.toBeNull();
    });

    it("RemovesCorruptEntries", () => {
      localStorage.setItem("weave:session-links:corrupt", "{{{bad json");
      saveSessionLinks("good", makeStoredLinks());

      cleanupStaleLinks();

      expect(localStorage.getItem("weave:session-links:corrupt")).toBeNull();
      expect(loadSessionLinks("good")).not.toBeNull();
    });

    it("DoesNotTouchNonPrefixedKeys", () => {
      localStorage.setItem("other-app-key", "value");
      cleanupStaleLinks();
      expect(localStorage.getItem("other-app-key")).toBe("value");
    });
  });

  // ─── Graceful degradation ──────────────────────────────────────────────

  describe("graceful degradation", () => {
    it("SaveNoOpsWhenSetItemThrows", () => {
      const originalSetItem = localStorage.setItem.bind(localStorage);
      vi.spyOn(localStorage, "setItem").mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });

      // Should not throw
      saveSessionLinks("sess-1", makeStoredLinks({ prs: [makePr(1)] }));

      vi.restoreAllMocks();
    });
  });

  // ─── mergePrReferences ─────────────────────────────────────────────────

  describe("mergePrReferences", () => {
    it("ReturnsEmptyForNoSources", () => {
      expect(mergePrReferences()).toEqual([]);
    });

    it("ReturnsEmptyForNullAndUndefinedSources", () => {
      expect(mergePrReferences(null, undefined)).toEqual([]);
    });

    it("DeduplicatesByUrl", () => {
      const result = mergePrReferences(
        [makePr(1), makePr(2)],
        [makePr(2), makePr(3)]
      );
      expect(result).toEqual([makePr(1), makePr(2), makePr(3)]);
    });

    it("PreservesFirstSourceOrder", () => {
      const result = mergePrReferences(
        [makePr(3)],
        [makePr(1), makePr(2), makePr(3)]
      );
      // PR 3 comes first (from first source), then 1, 2 from second
      expect(result.map((p) => p.number)).toEqual([3, 1, 2]);
    });
  });

  // ─── mergeIssueReferences ──────────────────────────────────────────────

  describe("mergeIssueReferences", () => {
    it("ReturnsEmptyForNoSources", () => {
      expect(mergeIssueReferences()).toEqual([]);
    });

    it("DeduplicatesByUrl", () => {
      const result = mergeIssueReferences(
        [makeIssue(1), makeIssue(2)],
        [makeIssue(2), makeIssue(3)]
      );
      expect(result).toEqual([makeIssue(1), makeIssue(2), makeIssue(3)]);
    });

    it("PreservesFirstSourceOrder", () => {
      const result = mergeIssueReferences(
        [makeIssue(5)],
        [makeIssue(1), makeIssue(5)]
      );
      expect(result.map((i) => i.number)).toEqual([5, 1]);
    });
  });
});
