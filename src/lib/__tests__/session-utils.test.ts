import { nestSessions, sessionsChanged, type NestedSession } from "@/lib/session-utils";
import type { SessionListItem } from "@/lib/api-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let counter = 0;

function makeItem(overrides: Partial<SessionListItem> & { sessionId?: string } = {}): SessionListItem {
  const id = overrides.sessionId ?? `sess-${++counter}`;
  return {
    instanceId: "inst-1",
    workspaceId: "ws-1",
    workspaceDirectory: "/tmp/proj",
    workspaceDisplayName: null,
    isolationStrategy: "existing",
    sourceDirectory: null,
    branch: null,
    sessionStatus: "active",
    instanceStatus: "running",
    session: { id, title: "Test Session", ...overrides.session } as SessionListItem["session"],
    dbId: undefined,
    parentSessionId: undefined,
    activityStatus: "busy",
    lifecycleStatus: "running",
    typedInstanceStatus: "running",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("nestSessions", () => {
  beforeEach(() => {
    counter = 0;
  });

  it("ReturnsEmptyArrayForEmptyInput", () => {
    expect(nestSessions([])).toEqual([]);
  });

  it("PassesThroughSessionsWithNoParentOrDbId", () => {
    const items = [makeItem(), makeItem(), makeItem()];
    const result = nestSessions(items);

    expect(result.length).toBe(3);
    result.forEach((n: NestedSession) => {
      expect(n.children).toEqual([]);
    });
  });

  it("GroupsChildUnderParent", () => {
    const parent = makeItem({ sessionId: "parent", dbId: "db-parent" });
    const child = makeItem({ sessionId: "child", parentSessionId: "db-parent" });
    const result = nestSessions([parent, child]);

    expect(result.length).toBe(1);
    expect(result[0]!.item.session.id).toBe("parent");
    expect(result[0]!.children.length).toBe(1);
    expect(result[0]!.children[0]!.session.id).toBe("child");
  });

  it("GroupsMultipleChildrenUnderOneParent", () => {
    const parent = makeItem({ sessionId: "p", dbId: "db-p" });
    const c1 = makeItem({ sessionId: "c1", parentSessionId: "db-p" });
    const c2 = makeItem({ sessionId: "c2", parentSessionId: "db-p" });
    const c3 = makeItem({ sessionId: "c3", parentSessionId: "db-p" });
    const result = nestSessions([parent, c1, c2, c3]);

    expect(result.length).toBe(1);
    expect(result[0]!.children.length).toBe(3);
    const childIds = result[0]!.children.map((c) => c.session.id);
    expect(childIds).toContain("c1");
    expect(childIds).toContain("c2");
    expect(childIds).toContain("c3");
  });

  it("OrphanedChildRemainsTopLevel", () => {
    const orphan = makeItem({ sessionId: "orphan", parentSessionId: "db-nonexistent" });
    const standalone = makeItem({ sessionId: "standalone" });
    const result = nestSessions([orphan, standalone]);

    expect(result.length).toBe(2);
    const ids = result.map((n) => n.item.session.id);
    expect(ids).toContain("orphan");
    expect(ids).toContain("standalone");
    result.forEach((n: NestedSession) => {
      expect(n.children).toEqual([]);
    });
  });

  it("MultipleParentsWithChildren", () => {
    const p1 = makeItem({ sessionId: "p1", dbId: "db-p1" });
    const p2 = makeItem({ sessionId: "p2", dbId: "db-p2" });
    const c1a = makeItem({ sessionId: "c1a", parentSessionId: "db-p1" });
    const c1b = makeItem({ sessionId: "c1b", parentSessionId: "db-p1" });
    const c2a = makeItem({ sessionId: "c2a", parentSessionId: "db-p2" });
    const standalone = makeItem({ sessionId: "s1" });

    const result = nestSessions([p1, p2, c1a, c1b, c2a, standalone]);

    expect(result.length).toBe(3); // p1, p2, standalone
    const p1Result = result.find((n) => n.item.session.id === "p1");
    const p2Result = result.find((n) => n.item.session.id === "p2");
    const sResult = result.find((n) => n.item.session.id === "s1");

    expect(p1Result!.children.length).toBe(2);
    expect(p2Result!.children.length).toBe(1);
    expect(sResult!.children.length).toBe(0);
  });

  it("SessionWithoutDbIdCannotBeParent", () => {
    // parent has no dbId, so child with parentSessionId cannot link to it
    const notParent = makeItem({ sessionId: "np" }); // no dbId
    const wouldBeChild = makeItem({ sessionId: "wbc", parentSessionId: "np" });
    const result = nestSessions([notParent, wouldBeChild]);

    expect(result.length).toBe(2);
    result.forEach((n: NestedSession) => {
      expect(n.children).toEqual([]);
    });
  });

  it("OrderPreservesInputOrderForTopLevel", () => {
    const a = makeItem({ sessionId: "a", dbId: "db-a" });
    const b = makeItem({ sessionId: "b" });
    const c = makeItem({ sessionId: "c", dbId: "db-c" });
    const childOfA = makeItem({ sessionId: "ca", parentSessionId: "db-a" });

    const result = nestSessions([c, b, a, childOfA]);

    expect(result.length).toBe(3);
    expect(result[0]!.item.session.id).toBe("c");
    expect(result[1]!.item.session.id).toBe("b");
    expect(result[2]!.item.session.id).toBe("a");
  });

  it("ParentWithDbIdButNoChildrenHasEmptyArray", () => {
    const parent = makeItem({ sessionId: "lonely", dbId: "db-lonely" });
    const result = nestSessions([parent]);

    expect(result.length).toBe(1);
    expect(result[0]!.children).toEqual([]);
  });

  it("sorts top-level sessions alphabetically by title when sort option is true", () => {
    const charlie = makeItem({ sessionId: "s1", session: { id: "s1", title: "Charlie" } as SessionListItem["session"] });
    const alpha = makeItem({ sessionId: "s2", session: { id: "s2", title: "Alpha" } as SessionListItem["session"] });
    const bravo = makeItem({ sessionId: "s3", session: { id: "s3", title: "Bravo" } as SessionListItem["session"] });

    const result = nestSessions([charlie, alpha, bravo], { sort: true });

    expect(result.length).toBe(3);
    expect(result[0]!.item.session.title).toBe("Alpha");
    expect(result[1]!.item.session.title).toBe("Bravo");
    expect(result[2]!.item.session.title).toBe("Charlie");
  });

  it("sorts children within a parent alphabetically by title when sort option is true", () => {
    const parent = makeItem({ sessionId: "p", dbId: "db-p", session: { id: "p", title: "Parent" } as SessionListItem["session"] });
    const zeta = makeItem({ sessionId: "z", parentSessionId: "db-p", session: { id: "z", title: "Zeta" } as SessionListItem["session"] });
    const alphaChild = makeItem({ sessionId: "a", parentSessionId: "db-p", session: { id: "a", title: "Alpha" } as SessionListItem["session"] });
    const mu = makeItem({ sessionId: "m", parentSessionId: "db-p", session: { id: "m", title: "Mu" } as SessionListItem["session"] });

    const result = nestSessions([parent, zeta, alphaChild, mu], { sort: true });

    expect(result.length).toBe(1);
    expect(result[0]!.children.length).toBe(3);
    expect(result[0]!.children[0]!.session.title).toBe("Alpha");
    expect(result[0]!.children[1]!.session.title).toBe("Mu");
    expect(result[0]!.children[2]!.session.title).toBe("Zeta");
  });

  it("falls back to session.id for sorting when title is empty", () => {
    const bById = makeItem({ sessionId: "b-session", session: { id: "b-session", title: "" } as SessionListItem["session"] });
    const aById = makeItem({ sessionId: "a-session", session: { id: "a-session", title: "" } as SessionListItem["session"] });
    const cById = makeItem({ sessionId: "c-session", session: { id: "c-session", title: "" } as SessionListItem["session"] });

    const result = nestSessions([bById, aById, cById], { sort: true });

    expect(result.length).toBe(3);
    expect(result[0]!.item.session.id).toBe("a-session");
    expect(result[1]!.item.session.id).toBe("b-session");
    expect(result[2]!.item.session.id).toBe("c-session");
  });

  it("does not sort when sort option is false or omitted", () => {
    const charlie = makeItem({ sessionId: "s1", session: { id: "s1", title: "Charlie" } as SessionListItem["session"] });
    const alpha = makeItem({ sessionId: "s2", session: { id: "s2", title: "Alpha" } as SessionListItem["session"] });
    const bravo = makeItem({ sessionId: "s3", session: { id: "s3", title: "Bravo" } as SessionListItem["session"] });

    // No options — preserves input order
    const resultDefault = nestSessions([charlie, alpha, bravo]);
    expect(resultDefault[0]!.item.session.title).toBe("Charlie");
    expect(resultDefault[1]!.item.session.title).toBe("Alpha");
    expect(resultDefault[2]!.item.session.title).toBe("Bravo");

    // sort: false — preserves input order
    const resultFalse = nestSessions([charlie, alpha, bravo], { sort: false });
    expect(resultFalse[0]!.item.session.title).toBe("Charlie");
    expect(resultFalse[1]!.item.session.title).toBe("Alpha");
    expect(resultFalse[2]!.item.session.title).toBe("Bravo");
  });
});

// ─── sessionsChanged Tests ────────────────────────────────────────────────────

describe("sessionsChanged", () => {
  beforeEach(() => {
    counter = 0;
  });

  it("returns false when arrays are identical (same data)", () => {
    const a = [makeItem({ sessionId: "s1" }), makeItem({ sessionId: "s2" })];
    const b = [makeItem({ sessionId: "s1" }), makeItem({ sessionId: "s2" })];
    expect(sessionsChanged(a, b)).toBe(false);
  });

  it("returns true when a session's activityStatus changes", () => {
    const a = [makeItem({ sessionId: "s1", activityStatus: "busy" })];
    const b = [makeItem({ sessionId: "s1", activityStatus: "idle" })];
    expect(sessionsChanged(a, b)).toBe(true);
  });

  it("returns true when array lengths differ", () => {
    const a = [makeItem({ sessionId: "s1" })];
    const b = [makeItem({ sessionId: "s1" }), makeItem({ sessionId: "s2" })];
    expect(sessionsChanged(a, b)).toBe(true);
  });

  it("returns true when session order changes (different session.id at same index)", () => {
    const a = [makeItem({ sessionId: "s1" }), makeItem({ sessionId: "s2" })];
    const b = [makeItem({ sessionId: "s2" }), makeItem({ sessionId: "s1" })];
    expect(sessionsChanged(a, b)).toBe(true);
  });

  it("returns false for empty arrays", () => {
    expect(sessionsChanged([], [])).toBe(false);
  });

  it("returns true when sessionStatus changes", () => {
    const a = [makeItem({ sessionId: "s1", sessionStatus: "active" })];
    const b = [makeItem({ sessionId: "s1", sessionStatus: "idle" })];
    expect(sessionsChanged(a, b)).toBe(true);
  });

  it("returns true when lifecycleStatus changes", () => {
    const a = [makeItem({ sessionId: "s1", lifecycleStatus: "running" })];
    const b = [makeItem({ sessionId: "s1", lifecycleStatus: "completed" })];
    expect(sessionsChanged(a, b)).toBe(true);
  });

  it("returns true when instanceStatus changes", () => {
    const a = [makeItem({ sessionId: "s1", instanceStatus: "running" })];
    const b = [makeItem({ sessionId: "s1", instanceStatus: "dead" })];
    expect(sessionsChanged(a, b)).toBe(true);
  });

  it("returns true when session title changes", () => {
    const a = [makeItem({ sessionId: "s1", session: { id: "s1", title: "Old" } as unknown as SessionListItem["session"] })];
    const b = [makeItem({ sessionId: "s1", session: { id: "s1", title: "New" } as unknown as SessionListItem["session"] })];
    expect(sessionsChanged(a, b)).toBe(true);
  });
});
