import {
  deriveDisplayName,
  groupSessionsByWorkspace,
  filterSessionsByWorkspace,
} from "@/lib/workspace-utils";
import type { SessionListItem } from "@/lib/api-types";
import type { Session } from "@opencode-ai/sdk/v2";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSDKSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    title: "Test Session",
    directory: "/home/user/project",
    projectID: "proj-1",
    version: "1.0.0",
    time: { created: 1700000000, updated: 1700000001 },
    ...overrides,
  } as Session;
}

function makeSession(overrides: Partial<SessionListItem> = {}): SessionListItem {
  return {
    instanceId: "instance-1",
    workspaceId: "ws-1",
    workspaceDirectory: "/home/user/project",
    workspaceDisplayName: null,
    isolationStrategy: "existing",
    sourceDirectory: null,
    branch: null,
    sessionStatus: "active",
    instanceStatus: "running",
    session: makeSDKSession(),
    activityStatus: "busy",
    lifecycleStatus: "running",
    typedInstanceStatus: "running",
    ...overrides,
  };
}

// ─── deriveDisplayName ────────────────────────────────────────────────────────

describe("deriveDisplayName", () => {
  it("returns workspaceDisplayName when present", () => {
    const item = makeSession({ workspaceDisplayName: "My Project" });
    expect(deriveDisplayName(item)).toBe("My Project");
  });

  it("falls back to last path segment of workspaceDirectory", () => {
    const item = makeSession({
      workspaceDisplayName: null,
      workspaceDirectory: "/home/user/my-repo",
    });
    expect(deriveDisplayName(item)).toBe("my-repo");
  });

  it("handles trailing slash by using the last non-empty segment", () => {
    const item = makeSession({
      workspaceDisplayName: null,
      workspaceDirectory: "/home/user/my-repo/",
    });
    expect(deriveDisplayName(item)).toBe("my-repo");
  });

  it("handles root path edge case by returning the original directory", () => {
    const item = makeSession({
      workspaceDisplayName: null,
      workspaceDirectory: "/",
    });
    expect(deriveDisplayName(item)).toBe("/");
  });

  it("uses sourceDirectory for display name when set and workspaceDisplayName is null", () => {
    const item = makeSession({
      workspaceDisplayName: null,
      workspaceDirectory: "/home/user/.weave/workspaces/abc-123",
      sourceDirectory: "/home/user/my-project",
    });
    expect(deriveDisplayName(item)).toBe("my-project");
  });
});

// ─── groupSessionsByWorkspace ─────────────────────────────────────────────────

describe("groupSessionsByWorkspace", () => {
  it("returns empty array for empty sessions", () => {
    expect(groupSessionsByWorkspace([])).toEqual([]);
  });

  it("returns single group with correct fields for single session", () => {
    const session = makeSession({
      workspaceId: "ws-1",
      workspaceDirectory: "/home/user/project",
      workspaceDisplayName: "My Project",
      lifecycleStatus: "running",
      typedInstanceStatus: "running",
    });

    const groups = groupSessionsByWorkspace([session]);

    expect(groups).toHaveLength(1);
    expect(groups[0].workspaceId).toBe("ws-1");
    expect(groups[0].workspaceDirectory).toBe("/home/user/project");
    expect(groups[0].displayName).toBe("My Project");
    expect(groups[0].sessionCount).toBe(1);
    expect(groups[0].hasRunningSession).toBe(true);
    expect(groups[0].sessions).toEqual([session]);
  });

  it("groups sessions by workspaceDirectory, not workspaceId", () => {
    const session1 = makeSession({
      instanceId: "inst-1",
      workspaceId: "ws-1",
      workspaceDirectory: "/home/user/project",
    });
    const session2 = makeSession({
      instanceId: "inst-2",
      workspaceId: "ws-2",
      workspaceDirectory: "/home/user/project",
    });

    const groups = groupSessionsByWorkspace([session1, session2]);

    expect(groups).toHaveLength(1);
    expect(groups[0].sessions).toHaveLength(2);
  });

  it("merges multiple workspace IDs with same directory into a single group", () => {
    const session1 = makeSession({
      instanceId: "inst-1",
      workspaceId: "ws-alpha",
      workspaceDirectory: "/shared/dir",
    });
    const session2 = makeSession({
      instanceId: "inst-2",
      workspaceId: "ws-beta",
      workspaceDirectory: "/shared/dir",
    });
    const session3 = makeSession({
      instanceId: "inst-3",
      workspaceId: "ws-gamma",
      workspaceDirectory: "/shared/dir",
    });

    const groups = groupSessionsByWorkspace([session1, session2, session3]);

    expect(groups).toHaveLength(1);
    expect(groups[0].sessions).toHaveLength(3);
  });

  it("sets sessionCount equal to number of sessions in the group", () => {
    const sessions = [
      makeSession({ instanceId: "inst-1", workspaceDirectory: "/dir/a" }),
      makeSession({ instanceId: "inst-2", workspaceDirectory: "/dir/a" }),
      makeSession({ instanceId: "inst-3", workspaceDirectory: "/dir/a" }),
    ];

    const groups = groupSessionsByWorkspace(sessions);

    expect(groups[0].sessionCount).toBe(3);
  });

  it("sets hasRunningSession true only when lifecycleStatus=running AND typedInstanceStatus=running", () => {
    const session = makeSession({
      lifecycleStatus: "running",
      typedInstanceStatus: "running",
    });

    const groups = groupSessionsByWorkspace([session]);

    expect(groups[0].hasRunningSession).toBe(true);
  });

  it("sets hasRunningSession false when running lifecycle but instance stopped", () => {
    const session = makeSession({
      lifecycleStatus: "running",
      typedInstanceStatus: "stopped",
    });

    const groups = groupSessionsByWorkspace([session]);

    expect(groups[0].hasRunningSession).toBe(false);
  });

  it("sets hasRunningSession false when lifecycle is stopped", () => {
    const session = makeSession({
      lifecycleStatus: "stopped",
      typedInstanceStatus: "running",
    });

    const groups = groupSessionsByWorkspace([session]);

    expect(groups[0].hasRunningSession).toBe(false);
  });

  it("sets hasRunningSession false when disconnected", () => {
    const session = makeSession({
      lifecycleStatus: "disconnected",
      typedInstanceStatus: "stopped",
    });

    const groups = groupSessionsByWorkspace([session]);

    expect(groups[0].hasRunningSession).toBe(false);
  });

  it("sets hasRunningSession true when idle (running lifecycle, running instance)", () => {
    const session = makeSession({
      activityStatus: "idle",
      lifecycleStatus: "running",
      typedInstanceStatus: "running",
    });

    const groups = groupSessionsByWorkspace([session]);

    expect(groups[0].hasRunningSession).toBe(true);
  });

  it("sets hasRunningSession false when completed", () => {
    const session = makeSession({
      lifecycleStatus: "completed",
      typedInstanceStatus: "stopped",
    });

    const groups = groupSessionsByWorkspace([session]);

    expect(groups[0].hasRunningSession).toBe(false);
  });

  it("sets hasRunningSession true if ANY session in the group is running+running", () => {
    const dead = makeSession({
      instanceId: "inst-dead",
      workspaceDirectory: "/shared/dir",
      lifecycleStatus: "stopped",
      typedInstanceStatus: "stopped",
    });
    const running = makeSession({
      instanceId: "inst-running",
      workspaceDirectory: "/shared/dir",
      lifecycleStatus: "running",
      typedInstanceStatus: "running",
    });

    const groups = groupSessionsByWorkspace([dead, running]);

    expect(groups[0].hasRunningSession).toBe(true);
  });

  it("uses first session's workspaceId for the group", () => {
    const first = makeSession({
      instanceId: "inst-1",
      workspaceId: "ws-first",
      workspaceDirectory: "/shared/dir",
    });
    const second = makeSession({
      instanceId: "inst-2",
      workspaceId: "ws-second",
      workspaceDirectory: "/shared/dir",
    });

    const groups = groupSessionsByWorkspace([first, second]);

    expect(groups[0].workspaceId).toBe("ws-first");
  });

  it("prefers explicit workspaceDisplayName over derived directory name", () => {
    const session = makeSession({
      workspaceDirectory: "/home/user/my-project",
      workspaceDisplayName: "Explicit Display Name",
    });

    const groups = groupSessionsByWorkspace([session]);

    expect(groups[0].displayName).toBe("Explicit Display Name");
  });

  it("uses derived directory name as displayName when workspaceDisplayName is null", () => {
    const session = makeSession({
      workspaceDirectory: "/home/user/my-project",
      workspaceDisplayName: null,
    });

    const groups = groupSessionsByWorkspace([session]);

    expect(groups[0].displayName).toBe("my-project");
  });

  it("preserves explicit displayName when worktree session without custom name merges first", () => {
    // Worktree session (no custom name) is processed FIRST
    const worktree = makeSession({
      instanceId: "inst-wt",
      workspaceId: "ws-wt",
      workspaceDirectory: "/home/user/.weave/workspaces/uuid-1",
      workspaceDisplayName: null,
      isolationStrategy: "worktree",
      sourceDirectory: "/home/user/my-project",
    });
    // Existing session (with custom name) is processed SECOND
    const existing = makeSession({
      instanceId: "inst-existing",
      workspaceId: "ws-existing",
      workspaceDirectory: "/home/user/my-project",
      workspaceDisplayName: "My Cool Project",
      isolationStrategy: "existing",
      sourceDirectory: null,
    });

    const groups = groupSessionsByWorkspace([worktree, existing]);

    expect(groups).toHaveLength(1);
    expect(groups[0].displayName).toBe("My Cool Project");
  });

  it("preserves explicit displayName when worktree session without custom name merges second", () => {
    // Existing session (with custom name) is processed FIRST
    const existing = makeSession({
      instanceId: "inst-existing",
      workspaceId: "ws-existing",
      workspaceDirectory: "/home/user/my-project",
      workspaceDisplayName: "My Cool Project",
      isolationStrategy: "existing",
      sourceDirectory: null,
    });
    // Worktree session (no custom name) is processed SECOND
    const worktree = makeSession({
      instanceId: "inst-wt",
      workspaceId: "ws-wt",
      workspaceDirectory: "/home/user/.weave/workspaces/uuid-1",
      workspaceDisplayName: null,
      isolationStrategy: "worktree",
      sourceDirectory: "/home/user/my-project",
    });

    const groups = groupSessionsByWorkspace([existing, worktree]);

    expect(groups).toHaveLength(1);
    expect(groups[0].displayName).toBe("My Cool Project");
  });

  it("sorts groups alphabetically regardless of running status", () => {
    const stoppedSession = makeSession({
      instanceId: "inst-stopped",
      workspaceDirectory: "/dir/a-alpha",
      workspaceDisplayName: null,
      lifecycleStatus: "stopped",
      typedInstanceStatus: "stopped",
    });
    const runningSession = makeSession({
      instanceId: "inst-running",
      workspaceDirectory: "/dir/z-zeta",
      workspaceDisplayName: null,
      lifecycleStatus: "running",
      typedInstanceStatus: "running",
    });

    const groups = groupSessionsByWorkspace([stoppedSession, runningSession]);

    expect(groups[0].workspaceDirectory).toBe("/dir/a-alpha");
    expect(groups[1].workspaceDirectory).toBe("/dir/z-zeta");
  });

  it("sorts non-running groups alphabetically by displayName", () => {
    const charlie = makeSession({
      instanceId: "inst-c",
      workspaceDirectory: "/dir/charlie",
      workspaceDisplayName: null,
      lifecycleStatus: "stopped",
      typedInstanceStatus: "stopped",
    });
    const alpha = makeSession({
      instanceId: "inst-a",
      workspaceDirectory: "/dir/alpha",
      workspaceDisplayName: null,
      lifecycleStatus: "stopped",
      typedInstanceStatus: "stopped",
    });
    const bravo = makeSession({
      instanceId: "inst-b",
      workspaceDirectory: "/dir/bravo",
      workspaceDisplayName: null,
      lifecycleStatus: "stopped",
      typedInstanceStatus: "stopped",
    });

    const groups = groupSessionsByWorkspace([charlie, alpha, bravo]);

    expect(groups[0].displayName).toBe("alpha");
    expect(groups[1].displayName).toBe("bravo");
    expect(groups[2].displayName).toBe("charlie");
  });

  it("creates multiple groups for multiple distinct directories", () => {
    const session1 = makeSession({
      instanceId: "inst-1",
      workspaceId: "ws-1",
      workspaceDirectory: "/dir/project-a",
    });
    const session2 = makeSession({
      instanceId: "inst-2",
      workspaceId: "ws-2",
      workspaceDirectory: "/dir/project-b",
    });
    const session3 = makeSession({
      instanceId: "inst-3",
      workspaceId: "ws-3",
      workspaceDirectory: "/dir/project-c",
    });

    const groups = groupSessionsByWorkspace([session1, session2, session3]);

    expect(groups).toHaveLength(3);
  });

  it("groups worktree sessions under their sourceDirectory", () => {
    const existing = makeSession({
      instanceId: "inst-existing",
      workspaceId: "ws-existing",
      workspaceDirectory: "/home/user/my-project",
      isolationStrategy: "existing",
      sourceDirectory: null,
    });
    const worktree = makeSession({
      instanceId: "inst-worktree",
      workspaceId: "ws-worktree",
      workspaceDirectory: "/home/user/.weave/workspaces/abc-123",
      isolationStrategy: "worktree",
      sourceDirectory: "/home/user/my-project",
    });

    const groups = groupSessionsByWorkspace([existing, worktree]);

    expect(groups).toHaveLength(1);
    expect(groups[0].sessions).toHaveLength(2);
    expect(groups[0].workspaceDirectory).toBe("/home/user/my-project");
  });

  it("groups two worktree sessions with the same sourceDirectory together", () => {
    const wt1 = makeSession({
      instanceId: "inst-wt1",
      workspaceId: "ws-wt1",
      workspaceDirectory: "/home/user/.weave/workspaces/uuid-1",
      isolationStrategy: "worktree",
      sourceDirectory: "/home/user/shared-project",
    });
    const wt2 = makeSession({
      instanceId: "inst-wt2",
      workspaceId: "ws-wt2",
      workspaceDirectory: "/home/user/.weave/workspaces/uuid-2",
      isolationStrategy: "worktree",
      sourceDirectory: "/home/user/shared-project",
    });
    const other = makeSession({
      instanceId: "inst-other",
      workspaceId: "ws-other",
      workspaceDirectory: "/home/user/other-project",
      isolationStrategy: "existing",
      sourceDirectory: null,
    });

    const groups = groupSessionsByWorkspace([wt1, wt2, other]);

    expect(groups).toHaveLength(2);
    const sharedGroup = groups.find((g) => g.workspaceDirectory === "/home/user/shared-project");
    expect(sharedGroup).toBeDefined();
    expect(sharedGroup!.sessions).toHaveLength(2);
  });

  it("worktree group uses sourceDirectory as the group workspaceDirectory", () => {
    const worktree = makeSession({
      instanceId: "inst-wt",
      workspaceId: "ws-wt",
      workspaceDirectory: "/home/user/.weave/workspaces/some-uuid",
      isolationStrategy: "worktree",
      sourceDirectory: "/home/user/real-project",
    });

    const groups = groupSessionsByWorkspace([worktree]);

    expect(groups[0].workspaceDirectory).toBe("/home/user/real-project");
    expect(groups[0].displayName).toBe("real-project");
  });
});

// ─── filterSessionsByWorkspace ────────────────────────────────────────────────

describe("filterSessionsByWorkspace", () => {
  it("returns all sessions when filter is null", () => {
    const sessions = [
      makeSession({ instanceId: "inst-1", workspaceId: "ws-1" }),
      makeSession({ instanceId: "inst-2", workspaceId: "ws-2" }),
    ];

    expect(filterSessionsByWorkspace(sessions, null)).toBe(sessions);
  });

  it("returns all sessions when filter is undefined", () => {
    const sessions = [
      makeSession({ instanceId: "inst-1", workspaceId: "ws-1" }),
      makeSession({ instanceId: "inst-2", workspaceId: "ws-2" }),
    ];

    expect(filterSessionsByWorkspace(sessions, undefined)).toBe(sessions);
  });

  it("returns all sessions when filter is empty string (falsy)", () => {
    const sessions = [
      makeSession({ instanceId: "inst-1", workspaceId: "ws-1" }),
      makeSession({ instanceId: "inst-2", workspaceId: "ws-2" }),
    ];

    expect(filterSessionsByWorkspace(sessions, "")).toBe(sessions);
  });

  it("returns all sessions sharing the matched workspace directory", () => {
    const target1 = makeSession({
      instanceId: "inst-1",
      workspaceId: "ws-1",
      workspaceDirectory: "/dir/shared",
    });
    const target2 = makeSession({
      instanceId: "inst-2",
      workspaceId: "ws-2",
      workspaceDirectory: "/dir/shared",
    });
    const other = makeSession({
      instanceId: "inst-3",
      workspaceId: "ws-3",
      workspaceDirectory: "/dir/other",
    });

    const result = filterSessionsByWorkspace([target1, target2, other], "ws-1");

    expect(result).toHaveLength(2);
    expect(result).toContain(target1);
    expect(result).toContain(target2);
    expect(result).not.toContain(other);
  });

  it("returns all sessions in the same directory when filtering by any one workspace ID", () => {
    const session1 = makeSession({
      instanceId: "inst-1",
      workspaceId: "ws-alpha",
      workspaceDirectory: "/dir/shared",
    });
    const session2 = makeSession({
      instanceId: "inst-2",
      workspaceId: "ws-beta",
      workspaceDirectory: "/dir/shared",
    });
    const other = makeSession({
      instanceId: "inst-3",
      workspaceId: "ws-other",
      workspaceDirectory: "/dir/other",
    });

    const resultByAlpha = filterSessionsByWorkspace([session1, session2, other], "ws-alpha");
    const resultByBeta = filterSessionsByWorkspace([session1, session2, other], "ws-beta");

    expect(resultByAlpha).toHaveLength(2);
    expect(resultByBeta).toHaveLength(2);
    expect(resultByAlpha).toContain(session1);
    expect(resultByAlpha).toContain(session2);
    expect(resultByBeta).toContain(session1);
    expect(resultByBeta).toContain(session2);
  });

  it("returns empty array when filter does not match any workspaceId", () => {
    const sessions = [
      makeSession({ instanceId: "inst-1", workspaceId: "ws-1" }),
      makeSession({ instanceId: "inst-2", workspaceId: "ws-2" }),
    ];

    expect(filterSessionsByWorkspace(sessions, "ws-nonexistent")).toEqual([]);
  });

  it("returns empty array for empty sessions regardless of filter", () => {
    expect(filterSessionsByWorkspace([], "ws-1")).toEqual([]);
  });

  it("includes worktree sessions when filtering by an existing session in the same source directory", () => {
    const existing = makeSession({
      instanceId: "inst-existing",
      workspaceId: "ws-existing",
      workspaceDirectory: "/home/user/my-project",
      isolationStrategy: "existing",
      sourceDirectory: null,
    });
    const worktree = makeSession({
      instanceId: "inst-worktree",
      workspaceId: "ws-worktree",
      workspaceDirectory: "/home/user/.weave/workspaces/abc-123",
      isolationStrategy: "worktree",
      sourceDirectory: "/home/user/my-project",
    });
    const other = makeSession({
      instanceId: "inst-other",
      workspaceId: "ws-other",
      workspaceDirectory: "/home/user/other-project",
      sourceDirectory: null,
    });

    const result = filterSessionsByWorkspace([existing, worktree, other], "ws-existing");

    expect(result).toHaveLength(2);
    expect(result).toContain(existing);
    expect(result).toContain(worktree);
    expect(result).not.toContain(other);
  });

  it("includes existing sessions when filtering by a worktree session's workspace ID", () => {
    const existing = makeSession({
      instanceId: "inst-existing",
      workspaceId: "ws-existing",
      workspaceDirectory: "/home/user/my-project",
      isolationStrategy: "existing",
      sourceDirectory: null,
    });
    const worktree = makeSession({
      instanceId: "inst-worktree",
      workspaceId: "ws-worktree",
      workspaceDirectory: "/home/user/.weave/workspaces/abc-123",
      isolationStrategy: "worktree",
      sourceDirectory: "/home/user/my-project",
    });

    const result = filterSessionsByWorkspace([existing, worktree], "ws-worktree");

    expect(result).toHaveLength(2);
    expect(result).toContain(existing);
    expect(result).toContain(worktree);
  });
});
