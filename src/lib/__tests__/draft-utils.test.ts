import { buildDraftKey, pruneDrafts } from "@/lib/draft-utils";
import { removePersistedKey } from "@/hooks/use-persisted-state";

// ─── Minimal localStorage mock for node environment ─────────────────────────
const store = new Map<string, string>();
const localStorageMock: Storage = {
  get length() {
    return store.size;
  },
  clear() {
    store.clear();
  },
  getItem(key: string) {
    return store.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    store.set(key, value);
  },
  removeItem(key: string) {
    store.delete(key);
  },
  key(index: number) {
    return [...store.keys()][index] ?? null;
  },
};

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

// Mock removePersistedKey so we can verify which keys get removed
// without needing the full useSyncExternalStore machinery
vi.mock("@/hooks/use-persisted-state", () => ({
  removePersistedKey: vi.fn((key: string) => {
    localStorageMock.removeItem(key);
  }),
}));

const mockedRemove = removePersistedKey as ReturnType<typeof vi.fn>;

// ─── buildDraftKey ──────────────────────────────────────────────────────────

describe("buildDraftKey", () => {
  it("prefixes session ID with weave:draft:", () => {
    expect(buildDraftKey("abc-123")).toBe("weave:draft:abc-123");
  });

  it("handles empty string", () => {
    expect(buildDraftKey("")).toBe("weave:draft:");
  });
});

// ─── pruneDrafts ────────────────────────────────────────────────────────────

describe("pruneDrafts", () => {
  beforeEach(() => {
    localStorageMock.clear();
    mockedRemove.mockClear();
  });

  it("does nothing when draft count is under the limit", () => {
    for (let i = 0; i < 15; i++) {
      localStorageMock.setItem(
        `weave:draft:session-${i}`,
        JSON.stringify({ text: `draft ${i}`, updatedAt: 1000 + i }),
      );
    }
    pruneDrafts(20);
    expect(mockedRemove).not.toHaveBeenCalled();
  });

  it("does nothing when draft count equals the limit", () => {
    for (let i = 0; i < 20; i++) {
      localStorageMock.setItem(
        `weave:draft:session-${i}`,
        JSON.stringify({ text: `draft ${i}`, updatedAt: 1000 + i }),
      );
    }
    pruneDrafts(20);
    expect(mockedRemove).not.toHaveBeenCalled();
  });

  it("removes the oldest drafts when count exceeds the limit", () => {
    for (let i = 0; i < 25; i++) {
      localStorageMock.setItem(
        `weave:draft:session-${i}`,
        JSON.stringify({ text: `draft ${i}`, updatedAt: 1000 + i }),
      );
    }
    pruneDrafts(20);
    // Should remove the 5 oldest (updatedAt 1000–1004)
    expect(mockedRemove).toHaveBeenCalledTimes(5);
    expect(mockedRemove).toHaveBeenCalledWith("weave:draft:session-0");
    expect(mockedRemove).toHaveBeenCalledWith("weave:draft:session-1");
    expect(mockedRemove).toHaveBeenCalledWith("weave:draft:session-2");
    expect(mockedRemove).toHaveBeenCalledWith("weave:draft:session-3");
    expect(mockedRemove).toHaveBeenCalledWith("weave:draft:session-4");
  });

  it("treats corrupt JSON entries as oldest (updatedAt = 0)", () => {
    // 19 valid drafts with updatedAt 100–118
    for (let i = 0; i < 19; i++) {
      localStorageMock.setItem(
        `weave:draft:session-${i}`,
        JSON.stringify({ text: `draft ${i}`, updatedAt: 100 + i }),
      );
    }
    // 2 corrupt entries
    localStorageMock.setItem("weave:draft:corrupt-1", "not-json{{{");
    localStorageMock.setItem("weave:draft:corrupt-2", "{broken");

    pruneDrafts(20);
    // 21 total, need to remove 1. Corrupt entries have updatedAt=0, so they're oldest.
    expect(mockedRemove).toHaveBeenCalledTimes(1);
    // One of the two corrupt entries should be removed (both have updatedAt=0, sort is stable)
    const removedKey = mockedRemove.mock.calls[0][0] as string;
    expect(removedKey).toMatch(/^weave:draft:corrupt-/);
  });

  it("only touches weave:draft:* keys, ignores other localStorage keys", () => {
    // Non-draft keys
    localStorageMock.setItem("weave-theme", JSON.stringify("dark"));
    localStorageMock.setItem("weave:fleet:prefs", JSON.stringify({ groupBy: "directory" }));
    localStorageMock.setItem("some-other-key", "value");

    // 21 drafts
    for (let i = 0; i < 21; i++) {
      localStorageMock.setItem(
        `weave:draft:session-${i}`,
        JSON.stringify({ text: `draft ${i}`, updatedAt: 1000 + i }),
      );
    }

    pruneDrafts(20);
    // Should remove only the 1 oldest draft
    expect(mockedRemove).toHaveBeenCalledTimes(1);
    expect(mockedRemove).toHaveBeenCalledWith("weave:draft:session-0");

    // Non-draft keys should still exist
    expect(localStorageMock.getItem("weave-theme")).toBe(JSON.stringify("dark"));
    expect(localStorageMock.getItem("weave:fleet:prefs")).toBe(
      JSON.stringify({ groupBy: "directory" }),
    );
    expect(localStorageMock.getItem("some-other-key")).toBe("value");
  });

  it("handles entries missing updatedAt as oldest", () => {
    for (let i = 0; i < 21; i++) {
      localStorageMock.setItem(
        `weave:draft:session-${i}`,
        JSON.stringify({ text: `draft ${i}`, updatedAt: 100 + i }),
      );
    }
    // One entry with no updatedAt field
    localStorageMock.setItem(
      "weave:draft:no-timestamp",
      JSON.stringify({ text: "old draft" }),
    );

    pruneDrafts(20);
    // 22 total → remove 2. The one without updatedAt (treated as 0) + the oldest valid
    expect(mockedRemove).toHaveBeenCalledTimes(2);
    const removedKeys = mockedRemove.mock.calls.map((c: unknown[]) => c[0]) as string[];
    expect(removedKeys).toContain("weave:draft:no-timestamp");
  });
});
