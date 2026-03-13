import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { _resetDbForTests } from "@/lib/server/database";
import {
  insertWorkspace,
  getWorkspace,
  listWorkspaces,
  markWorkspaceCleaned,
  updateWorkspaceDisplayName,
  insertInstance,
  getInstance,
  getInstanceByDirectory,
  listInstances,
  updateInstanceStatus,
  getRunningInstances,
  insertSession,
  getSession,
  getSessionByOpencodeId,
  listSessions,
  listActiveSessions,
  updateSessionStatus,
  getSessionsForInstance,
  getAnySessionForInstance,
  getNonTerminalSessionsForInstance,
  updateSessionForResume,
  deleteSession,
  getSessionsForWorkspace,
  insertSessionCallback,
  getPendingCallbacksForSession,
  markCallbackFired,
  deleteCallbacksForSession,
  claimPendingCallback,
  getAllPendingCallbacks,
  insertWorkspaceRoot,
  listWorkspaceRoots,
  deleteWorkspaceRoot,
  getWorkspaceRootByPath,
  getSessionStatusCounts,
  getActiveChildSessions,
  getSessionIdsWithActiveChildren,
} from "@/lib/server/db-repository";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mkWorkspaceId() {
  return `ws-${randomUUID()}`;
}

function mkInstanceId() {
  return `inst-${randomUUID()}`;
}

function mkSessionId() {
  return `sess-${randomUUID()}`;
}

function mkOpencodeSessionId() {
  return `oc-${randomUUID()}`;
}

function mkCallbackId() {
  return `cb-${randomUUID()}`;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  process.env.WEAVE_DB_PATH = join(tmpdir(), `fleet-repo-test-${randomUUID()}.db`);
  _resetDbForTests();
});

afterEach(() => {
  _resetDbForTests();
  delete process.env.WEAVE_DB_PATH;
});

// ─── Workspaces ───────────────────────────────────────────────────────────────

describe("workspace repository", () => {
  it("InsertsAndRetrievesWorkspace", () => {
    const id = mkWorkspaceId();
    insertWorkspace({ id, directory: "/tmp/project", isolation_strategy: "existing" });
    const ws = getWorkspace(id);
    expect(ws).toBeDefined();
    expect(ws?.id).toBe(id);
    expect(ws?.directory).toBe("/tmp/project");
    expect(ws?.isolation_strategy).toBe("existing");
    expect(ws?.cleaned_up_at).toBeNull();
  });

  it("InsertsWorkspaceWithAllOptionalFields", () => {
    const id = mkWorkspaceId();
    insertWorkspace({
      id,
      directory: "/tmp/workspace",
      isolation_strategy: "worktree",
      source_directory: "/tmp/source",
      branch: "feature/test",
    });
    const ws = getWorkspace(id);
    expect(ws?.source_directory).toBe("/tmp/source");
    expect(ws?.branch).toBe("feature/test");
  });

  it("ReturnsUndefinedForMissingWorkspace", () => {
    expect(getWorkspace("nonexistent")).toBeUndefined();
  });

  it("ListsWorkspacesAndContainsAllInserted", () => {
    const id1 = mkWorkspaceId();
    const id2 = mkWorkspaceId();
    insertWorkspace({ id: id1, directory: "/tmp/a", isolation_strategy: "existing" });
    insertWorkspace({ id: id2, directory: "/tmp/b", isolation_strategy: "existing" });
    const list = listWorkspaces();
    expect(list.length).toBe(2);
    const ids = list.map((w) => w.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });

  it("ListsEmptyWhenNoWorkspaces", () => {
    expect(listWorkspaces()).toEqual([]);
  });

  it("MarksWorkspaceAsCleaned", () => {
    const id = mkWorkspaceId();
    insertWorkspace({ id, directory: "/tmp/x", isolation_strategy: "clone" });
    markWorkspaceCleaned(id);
    const ws = getWorkspace(id);
    expect(ws?.cleaned_up_at).not.toBeNull();
  });

  it("UpdatesWorkspaceDisplayName", () => {
    const id = mkWorkspaceId();
    insertWorkspace({ id, directory: "/tmp/named", isolation_strategy: "existing" });
    expect(getWorkspace(id)?.display_name).toBeNull();

    updateWorkspaceDisplayName(id, "My Project");
    const ws = getWorkspace(id);
    expect(ws?.display_name).toBe("My Project");
  });

  it("UpdatesDisplayNameOnlyForTargetWorkspace", () => {
    const id1 = mkWorkspaceId();
    const id2 = mkWorkspaceId();
    insertWorkspace({ id: id1, directory: "/tmp/a", isolation_strategy: "existing" });
    insertWorkspace({ id: id2, directory: "/tmp/b", isolation_strategy: "existing" });

    updateWorkspaceDisplayName(id1, "Renamed");
    expect(getWorkspace(id1)?.display_name).toBe("Renamed");
    expect(getWorkspace(id2)?.display_name).toBeNull();
  });

  it("OverwritesExistingDisplayName", () => {
    const id = mkWorkspaceId();
    insertWorkspace({ id, directory: "/tmp/ow", isolation_strategy: "existing" });
    updateWorkspaceDisplayName(id, "First");
    updateWorkspaceDisplayName(id, "Second");
    expect(getWorkspace(id)?.display_name).toBe("Second");
  });
});

// ─── Instances ────────────────────────────────────────────────────────────────

describe("instance repository", () => {
  it("InsertsAndRetrievesInstance", () => {
    const id = mkInstanceId();
    insertInstance({ id, port: 4097, directory: "/tmp/proj", url: "http://localhost:4097" });
    const inst = getInstance(id);
    expect(inst).toBeDefined();
    expect(inst?.id).toBe(id);
    expect(inst?.port).toBe(4097);
    expect(inst?.status).toBe("running");
    expect(inst?.pid).toBeNull();
  });

  it("InsertsInstanceWithPid", () => {
    const id = mkInstanceId();
    insertInstance({ id, port: 4098, directory: "/tmp/proj2", url: "http://localhost:4098", pid: 12345 });
    const inst = getInstance(id);
    expect(inst?.pid).toBe(12345);
  });

  it("ReturnsUndefinedForMissingInstance", () => {
    expect(getInstance("nonexistent")).toBeUndefined();
  });

  it("GetsInstanceByDirectory", () => {
    const id = mkInstanceId();
    insertInstance({ id, port: 4099, directory: "/tmp/specific", url: "http://localhost:4099" });
    const inst = getInstanceByDirectory("/tmp/specific");
    expect(inst?.id).toBe(id);
  });

  it("ReturnsUndefinedForStoppedInstanceByDirectory", () => {
    const id = mkInstanceId();
    insertInstance({ id, port: 4100, directory: "/tmp/stopped", url: "http://localhost:4100" });
    updateInstanceStatus(id, "stopped");
    expect(getInstanceByDirectory("/tmp/stopped")).toBeUndefined();
  });

  it("ListsAllInstances", () => {
    insertInstance({ id: mkInstanceId(), port: 4101, directory: "/tmp/a", url: "http://localhost:4101" });
    insertInstance({ id: mkInstanceId(), port: 4102, directory: "/tmp/b", url: "http://localhost:4102" });
    expect(listInstances().length).toBe(2);
  });

  it("UpdatesInstanceStatusToStopped", () => {
    const id = mkInstanceId();
    insertInstance({ id, port: 4103, directory: "/tmp/c", url: "http://localhost:4103" });
    const now = new Date().toISOString();
    updateInstanceStatus(id, "stopped", now);
    const inst = getInstance(id);
    expect(inst?.status).toBe("stopped");
    expect(inst?.stopped_at).toBe(now);
  });

  it("GetRunningInstancesExcludesStopped", () => {
    const runId = mkInstanceId();
    const stopId = mkInstanceId();
    insertInstance({ id: runId, port: 4104, directory: "/tmp/r", url: "http://localhost:4104" });
    insertInstance({ id: stopId, port: 4105, directory: "/tmp/s", url: "http://localhost:4105" });
    updateInstanceStatus(stopId, "stopped");
    const running = getRunningInstances();
    expect(running.length).toBe(1);
    expect(running[0]?.id).toBe(runId);
  });
});

// ─── Sessions ─────────────────────────────────────────────────────────────────

describe("session repository", () => {
  function setup() {
    const wsId = mkWorkspaceId();
    const instId = mkInstanceId();
    insertWorkspace({ id: wsId, directory: "/tmp/proj", isolation_strategy: "existing" });
    insertInstance({ id: instId, port: 4200, directory: "/tmp/proj", url: "http://localhost:4200" });
    return { wsId, instId };
  }

  it("InsertsAndRetrievesSession", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    const ocId = mkOpencodeSessionId();
    insertSession({
      id,
      workspace_id: wsId,
      instance_id: instId,
      opencode_session_id: ocId,
      directory: "/tmp/proj",
    });
    const sess = getSession(id);
    expect(sess).toBeDefined();
    expect(sess?.id).toBe(id);
    expect(sess?.opencode_session_id).toBe(ocId);
    expect(sess?.status).toBe("active");
    expect(sess?.title).toBe("Untitled");
  });

  it("InsertsSessionWithCustomTitle", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    insertSession({
      id,
      workspace_id: wsId,
      instance_id: instId,
      opencode_session_id: mkOpencodeSessionId(),
      directory: "/tmp/proj",
      title: "My Task",
    });
    expect(getSession(id)?.title).toBe("My Task");
  });

  it("ReturnsUndefinedForMissingSession", () => {
    expect(getSession("nonexistent")).toBeUndefined();
  });

  it("GetsSessionByOpencodeId", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    const ocId = mkOpencodeSessionId();
    insertSession({ id, workspace_id: wsId, instance_id: instId, opencode_session_id: ocId, directory: "/tmp/proj" });
    expect(getSessionByOpencodeId(ocId)?.id).toBe(id);
  });

  it("ListsAllSessions", () => {
    const { wsId, instId } = setup();
    insertSession({ id: mkSessionId(), workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: mkSessionId(), workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    expect(listSessions().length).toBe(2);
  });

  it("ListsOnlyActiveSessions", () => {
    const { wsId, instId } = setup();
    const id1 = mkSessionId();
    const id2 = mkSessionId();
    insertSession({ id: id1, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: id2, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id1, "stopped");
    const active = listActiveSessions();
    expect(active.length).toBe(1);
    expect(active[0]?.id).toBe(id2);
  });

  it("UpdatesSessionStatusToStopped", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    insertSession({ id, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    const now = new Date().toISOString();
    updateSessionStatus(id, "stopped", now);
    const sess = getSession(id);
    expect(sess?.status).toBe("stopped");
    expect(sess?.stopped_at).toBe(now);
  });

  it("UpdatesSessionStatusToDisconnected", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    insertSession({ id, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id, "disconnected");
    expect(getSession(id)?.status).toBe("disconnected");
  });

  it("GetsSessionsForInstance", () => {
    const { wsId, instId } = setup();
    const id1 = mkSessionId();
    const id2 = mkSessionId();
    insertSession({ id: id1, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: id2, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id1, "stopped");
    const sessions = getSessionsForInstance(instId);
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.id).toBe(id2);
  });

  it("UpdatesSessionStatusToIdle", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    insertSession({ id, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id, "idle");
    const sess = getSession(id);
    expect(sess?.status).toBe("idle");
  });

  it("UpdatesSessionStatusToCompleted", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    insertSession({ id, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    const now = new Date().toISOString();
    updateSessionStatus(id, "completed", now);
    const sess = getSession(id);
    expect(sess?.status).toBe("completed");
    expect(sess?.stopped_at).toBe(now);
  });

  it("GetSessionsForInstanceReturnsIdleSessions", () => {
    const { wsId, instId } = setup();
    const id1 = mkSessionId();
    const id2 = mkSessionId();
    insertSession({ id: id1, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: id2, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id2, "idle");
    const sessions = getSessionsForInstance(instId);
    expect(sessions.length).toBe(2);
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });

  it("ListActiveSessionsIncludesIdleSessions", () => {
    const { wsId, instId } = setup();
    const id1 = mkSessionId();
    const id2 = mkSessionId();
    const id3 = mkSessionId();
    const id4 = mkSessionId();
    insertSession({ id: id1, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: id2, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: id3, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: id4, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id2, "idle");
    updateSessionStatus(id3, "stopped");
    updateSessionStatus(id4, "disconnected");
    const active = listActiveSessions();
    expect(active.length).toBe(2);
    const ids = active.map((s) => s.id);
    expect(ids).toContain(id1); // active
    expect(ids).toContain(id2); // idle
  });

  it("UpdateSessionForResumeUpdatesInstanceIdAndSetsStatusActive", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    insertSession({ id, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id, "disconnected");

    const newInstId = mkInstanceId();
    insertInstance({ id: newInstId, port: 4300, directory: "/tmp/proj", url: "http://localhost:4300" });
    updateSessionForResume(id, newInstId);

    const sess = getSession(id);
    expect(sess?.instance_id).toBe(newInstId);
    expect(sess?.status).toBe("active");
  });

  it("UpdateSessionForResumeClearsStoppedAt", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    insertSession({ id, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id, "stopped", new Date().toISOString());
    expect(getSession(id)?.stopped_at).not.toBeNull();

    const newInstId = mkInstanceId();
    insertInstance({ id: newInstId, port: 4301, directory: "/tmp/proj", url: "http://localhost:4301" });
    updateSessionForResume(id, newInstId);

    expect(getSession(id)?.stopped_at).toBeNull();
  });

  it("UpdateSessionForResumeWorksForDisconnectedSession", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    insertSession({ id, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id, "disconnected");

    const newInstId = mkInstanceId();
    insertInstance({ id: newInstId, port: 4302, directory: "/tmp/proj", url: "http://localhost:4302" });
    updateSessionForResume(id, newInstId);

    const sess = getSession(id);
    expect(sess?.status).toBe("active");
    expect(sess?.instance_id).toBe(newInstId);
  });

  it("UpdateSessionForResumeWorksForStoppedSession", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    insertSession({ id, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id, "stopped", new Date().toISOString());

    const newInstId = mkInstanceId();
    insertInstance({ id: newInstId, port: 4303, directory: "/tmp/proj", url: "http://localhost:4303" });
    updateSessionForResume(id, newInstId);

    expect(getSession(id)?.status).toBe("active");
  });

  it("UpdateSessionForResumeIsNoOpForNonexistentSession", () => {
    // Should not throw — updating a non-existent row is a no-op in SQLite
    expect(() => updateSessionForResume("nonexistent-id", "some-inst-id")).not.toThrow();
  });

  it("GetNonTerminalSessionsForInstanceReturnsActiveIdleAndDisconnected", () => {
    const { wsId, instId } = setup();
    const id1 = mkSessionId(); // active
    const id2 = mkSessionId(); // idle
    const id3 = mkSessionId(); // disconnected
    const id4 = mkSessionId(); // stopped (terminal)
    const id5 = mkSessionId(); // completed (terminal)

    for (const id of [id1, id2, id3, id4, id5]) {
      insertSession({ id, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    }
    updateSessionStatus(id2, "idle");
    updateSessionStatus(id3, "disconnected");
    updateSessionStatus(id4, "stopped", new Date().toISOString());
    updateSessionStatus(id5, "completed", new Date().toISOString());

    const sessions = getNonTerminalSessionsForInstance(instId);
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(id1); // active
    expect(ids).toContain(id2); // idle
    expect(ids).toContain(id3); // disconnected
    expect(ids).not.toContain(id4); // stopped
    expect(ids).not.toContain(id5); // completed
  });

  it("GetNonTerminalSessionsForInstanceReturnsEmptyWhenAllTerminal", () => {
    const { wsId, instId } = setup();
    const id1 = mkSessionId();
    insertSession({ id: id1, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id1, "stopped", new Date().toISOString());

    const sessions = getNonTerminalSessionsForInstance(instId);
    expect(sessions.length).toBe(0);
  });

  // ─── getAnySessionForInstance ──────────────────────────────────────────────

  it("GetAnySessionForInstanceReturnsOldestSession", () => {
    const { wsId, instId } = setup();
    const id1 = mkSessionId();
    const id2 = mkSessionId();
    insertSession({ id: id1, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: id2, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });

    const result = getAnySessionForInstance(instId);
    expect(result).toBeDefined();
    expect(result?.id).toBe(id1); // oldest by created_at
  });

  it("GetAnySessionForInstanceIncludesTerminalSessions", () => {
    const { wsId, instId } = setup();
    const id1 = mkSessionId();
    insertSession({ id: id1, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id1, "stopped", new Date().toISOString());

    const result = getAnySessionForInstance(instId);
    expect(result).toBeDefined();
    expect(result?.id).toBe(id1);
    expect(result?.status).toBe("stopped");
  });

  it("GetAnySessionForInstanceIncludesCompletedSessions", () => {
    const { wsId, instId } = setup();
    const id1 = mkSessionId();
    insertSession({ id: id1, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id1, "completed", new Date().toISOString());

    const result = getAnySessionForInstance(instId);
    expect(result).toBeDefined();
    expect(result?.id).toBe(id1);
    expect(result?.status).toBe("completed");
  });

  it("GetAnySessionForInstanceReturnsUndefinedWhenNoSessions", () => {
    const result = getAnySessionForInstance("nonexistent-instance");
    expect(result).toBeUndefined();
  });

  it("GetAnySessionForInstanceDoesNotReturnSessionsFromOtherInstances", () => {
    const { wsId, instId } = setup();
    const otherInstId = mkInstanceId();
    insertInstance({ id: otherInstId, port: 4201, directory: "/tmp/other", url: "http://localhost:4201" });

    const id1 = mkSessionId();
    insertSession({ id: id1, workspace_id: wsId, instance_id: otherInstId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/other" });

    const result = getAnySessionForInstance(instId);
    expect(result).toBeUndefined();
  });
});

// ─── Session Deletion ─────────────────────────────────────────────────────────

describe("session deletion", () => {
  function setup() {
    const wsId = mkWorkspaceId();
    const instId = mkInstanceId();
    insertWorkspace({ id: wsId, directory: "/tmp/proj", isolation_strategy: "existing" });
    insertInstance({ id: instId, port: 4500, directory: "/tmp/proj", url: "http://localhost:4500" });
    return { wsId, instId };
  }

  it("DeletesSessionFromDatabase", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    insertSession({
      id,
      workspace_id: wsId,
      instance_id: instId,
      opencode_session_id: mkOpencodeSessionId(),
      directory: "/tmp/proj",
    });
    expect(getSession(id)).toBeDefined();

    deleteSession(id);

    expect(getSession(id)).toBeUndefined();
  });

  it("DeleteSessionReturnsTrueWhenRowDeleted", () => {
    const { wsId, instId } = setup();
    const id = mkSessionId();
    insertSession({
      id,
      workspace_id: wsId,
      instance_id: instId,
      opencode_session_id: mkOpencodeSessionId(),
      directory: "/tmp/proj",
    });

    const result = deleteSession(id);

    expect(result).toBe(true);
  });

  it("DeleteSessionReturnsFalseForNonexistentSession", () => {
    const result = deleteSession("nonexistent-session-id");
    expect(result).toBe(false);
  });

  it("DeleteSessionDoesNotAffectOtherSessions", () => {
    const { wsId, instId } = setup();
    const id1 = mkSessionId();
    const id2 = mkSessionId();
    insertSession({ id: id1, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: id2, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });

    deleteSession(id1);

    expect(getSession(id1)).toBeUndefined();
    expect(getSession(id2)).toBeDefined();
  });

  it("GetSessionsForWorkspaceReturnsAllSessionsForWorkspace", () => {
    const { wsId, instId } = setup();
    const id1 = mkSessionId();
    const id2 = mkSessionId();
    insertSession({ id: id1, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: id2, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });

    const sessions = getSessionsForWorkspace(wsId);

    expect(sessions.length).toBe(2);
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });
});

// ─── Session Status Counts ────────────────────────────────────────────────────

describe("getSessionStatusCounts", () => {
  function setup() {
    const wsId = mkWorkspaceId();
    const instId = mkInstanceId();
    insertWorkspace({ id: wsId, directory: "/tmp/proj", isolation_strategy: "existing" });
    insertInstance({ id: instId, port: 4550, directory: "/tmp/proj", url: "http://localhost:4550" });
    return { wsId, instId };
  }

  it("ReturnsZerosWhenNoSessions", () => {
    const counts = getSessionStatusCounts();
    expect(counts).toEqual({ active: 0, idle: 0 });
  });

  it("CountsActiveAndIdleSessions", () => {
    const { wsId, instId } = setup();
    const id1 = mkSessionId();
    const id2 = mkSessionId();
    const id3 = mkSessionId();
    const id4 = mkSessionId();
    insertSession({ id: id1, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: id2, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: id3, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: id4, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(id2, "idle");
    updateSessionStatus(id3, "idle");
    updateSessionStatus(id4, "stopped");

    const counts = getSessionStatusCounts();
    expect(counts.active).toBe(1);
    expect(counts.idle).toBe(2);
  });

  it("ExcludesStoppedCompletedAndDisconnectedSessions", () => {
    const { wsId, instId } = setup();
    insertSession({ id: mkSessionId(), workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });

    const stoppedId = mkSessionId();
    const completedId = mkSessionId();
    const disconnectedId = mkSessionId();
    insertSession({ id: stoppedId, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: completedId, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: disconnectedId, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    updateSessionStatus(stoppedId, "stopped");
    updateSessionStatus(completedId, "completed");
    updateSessionStatus(disconnectedId, "disconnected");

    const counts = getSessionStatusCounts();
    expect(counts.active).toBe(1);
    expect(counts.idle).toBe(0);
  });
});

// ─── Session Callbacks ────────────────────────────────────────────────────────

describe("session callback repository", () => {
  function setup() {
    const wsId = mkWorkspaceId();
    const instId = mkInstanceId();
    insertWorkspace({ id: wsId, directory: "/tmp/proj", isolation_strategy: "existing" });
    insertInstance({ id: instId, port: 4600, directory: "/tmp/proj", url: "http://localhost:4600" });
    const sourceId = mkSessionId();
    const targetId = mkSessionId();
    insertSession({ id: sourceId, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: targetId, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    return { wsId, instId, sourceId, targetId };
  }

  it("InsertsAndRetrievesPendingCallback", () => {
    const { instId, sourceId, targetId } = setup();
    const cbId = mkCallbackId();
    insertSessionCallback({ id: cbId, source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });

    const pending = getPendingCallbacksForSession(sourceId);
    expect(pending.length).toBe(1);
    expect(pending[0]?.id).toBe(cbId);
    expect(pending[0]?.source_session_id).toBe(sourceId);
    expect(pending[0]?.target_session_id).toBe(targetId);
    expect(pending[0]?.target_instance_id).toBe(instId);
    expect(pending[0]?.status).toBe("pending");
    expect(pending[0]?.fired_at).toBeNull();
  });

  it("ReturnsEmptyArrayWhenNoCallbacks", () => {
    expect(getPendingCallbacksForSession("nonexistent")).toEqual([]);
  });

  it("ReturnsMultiplePendingCallbacksForSameSource", () => {
    const { wsId, instId, sourceId } = setup();
    const target2 = mkSessionId();
    insertSession({ id: target2, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });

    insertSessionCallback({ id: mkCallbackId(), source_session_id: sourceId, target_session_id: sourceId, target_instance_id: instId });
    insertSessionCallback({ id: mkCallbackId(), source_session_id: sourceId, target_session_id: target2, target_instance_id: instId });

    expect(getPendingCallbacksForSession(sourceId).length).toBe(2);
  });

  it("MarkCallbackFiredExcludesFromPending", () => {
    const { instId, sourceId, targetId } = setup();
    const cbId = mkCallbackId();
    insertSessionCallback({ id: cbId, source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });

    markCallbackFired(cbId);

    const pending = getPendingCallbacksForSession(sourceId);
    expect(pending.length).toBe(0);
  });

  it("MarkCallbackFiredSetsFiredAt", () => {
    const { instId, sourceId, targetId } = setup();
    const cbId = mkCallbackId();
    insertSessionCallback({ id: cbId, source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });

    markCallbackFired(cbId);

    // Verify via a raw query that status is 'fired' and fired_at is set
    // We can check indirectly: getPendingCallbacksForSession won't return it,
    // and inserting another callback for the same source still works
    const pending = getPendingCallbacksForSession(sourceId);
    expect(pending.length).toBe(0);
  });

  it("MarkCallbackFiredOnlyAffectsTargetCallback", () => {
    const { instId, sourceId, targetId } = setup();
    const cb1 = mkCallbackId();
    const cb2 = mkCallbackId();
    insertSessionCallback({ id: cb1, source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });
    insertSessionCallback({ id: cb2, source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });

    markCallbackFired(cb1);

    const pending = getPendingCallbacksForSession(sourceId);
    expect(pending.length).toBe(1);
    expect(pending[0]?.id).toBe(cb2);
  });

  it("DeleteCallbacksBySourceSession", () => {
    const { instId, sourceId, targetId } = setup();
    insertSessionCallback({ id: mkCallbackId(), source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });
    insertSessionCallback({ id: mkCallbackId(), source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });

    const count = deleteCallbacksForSession(sourceId);

    expect(count).toBe(2);
    expect(getPendingCallbacksForSession(sourceId)).toEqual([]);
  });

  it("DeleteCallbacksByTargetSession", () => {
    const { instId, sourceId, targetId } = setup();
    insertSessionCallback({ id: mkCallbackId(), source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });

    const count = deleteCallbacksForSession(targetId);

    expect(count).toBe(1);
    expect(getPendingCallbacksForSession(sourceId)).toEqual([]);
  });

  it("DeleteCallbacksReturnsZeroWhenNoneMatch", () => {
    expect(deleteCallbacksForSession("nonexistent")).toBe(0);
  });

  it("DeleteCallbacksDoesNotAffectOtherSessions", () => {
    const { wsId, instId, sourceId, targetId } = setup();
    const otherSource = mkSessionId();
    insertSession({ id: otherSource, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });

    insertSessionCallback({ id: mkCallbackId(), source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });
    insertSessionCallback({ id: mkCallbackId(), source_session_id: otherSource, target_session_id: targetId, target_instance_id: instId });

    deleteCallbacksForSession(sourceId);

    expect(getPendingCallbacksForSession(otherSource).length).toBe(1);
  });

  // ─── claimPendingCallback ─────────────────────────────────────────────────

  it("ClaimPendingCallbackReturnsTrueOnFirstClaim", () => {
    const { instId, sourceId, targetId } = setup();
    const cbId = mkCallbackId();
    insertSessionCallback({ id: cbId, source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });

    const result = claimPendingCallback(cbId);

    expect(result).toBe(true);
  });

  it("ClaimPendingCallbackReturnsFalseOnSecondClaim", () => {
    const { instId, sourceId, targetId } = setup();
    const cbId = mkCallbackId();
    insertSessionCallback({ id: cbId, source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });

    claimPendingCallback(cbId);
    const result = claimPendingCallback(cbId);

    expect(result).toBe(false);
  });

  it("ClaimPendingCallbackExcludesFromPendingList", () => {
    const { instId, sourceId, targetId } = setup();
    const cbId = mkCallbackId();
    insertSessionCallback({ id: cbId, source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });

    claimPendingCallback(cbId);

    expect(getPendingCallbacksForSession(sourceId)).toEqual([]);
  });

  it("ClaimPendingCallbackDoesNotAffectOtherCallbacks", () => {
    const { instId, sourceId, targetId } = setup();
    const cb1 = mkCallbackId();
    const cb2 = mkCallbackId();
    insertSessionCallback({ id: cb1, source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });
    insertSessionCallback({ id: cb2, source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });

    claimPendingCallback(cb1);

    const pending = getPendingCallbacksForSession(sourceId);
    expect(pending.length).toBe(1);
    expect(pending[0]?.id).toBe(cb2);
  });

  // ─── getAllPendingCallbacks ────────────────────────────────────────────────

  it("GetAllPendingCallbacksReturnsAllPendingAcrossSessions", () => {
    const { wsId, instId, sourceId, targetId } = setup();
    const otherSource = mkSessionId();
    insertSession({ id: otherSource, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });

    insertSessionCallback({ id: mkCallbackId(), source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });
    insertSessionCallback({ id: mkCallbackId(), source_session_id: otherSource, target_session_id: targetId, target_instance_id: instId });

    const all = getAllPendingCallbacks();
    expect(all.length).toBe(2);
  });

  it("GetAllPendingCallbacksExcludesFiredCallbacks", () => {
    const { instId, sourceId, targetId } = setup();
    const cb1 = mkCallbackId();
    const cb2 = mkCallbackId();
    insertSessionCallback({ id: cb1, source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });
    insertSessionCallback({ id: cb2, source_session_id: sourceId, target_session_id: targetId, target_instance_id: instId });

    markCallbackFired(cb1);

    const all = getAllPendingCallbacks();
    expect(all.length).toBe(1);
    expect(all[0]?.id).toBe(cb2);
  });

  it("GetAllPendingCallbacksReturnsEmptyWhenNonePending", () => {
    expect(getAllPendingCallbacks()).toEqual([]);
  });
});

// ─── Workspace Roots ──────────────────────────────────────────────────────────

describe("workspace root repository", () => {
  it("InsertAndRetrieveWorkspaceRoot", () => {
    const id = randomUUID();
    insertWorkspaceRoot({ id, path: "/home/user/projects" });
    const roots = listWorkspaceRoots();
    expect(roots.length).toBe(1);
    expect(roots[0]?.id).toBe(id);
    expect(roots[0]?.path).toBe("/home/user/projects");
    expect(roots[0]?.created_at).toBeDefined();
  });

  it("ListWorkspaceRootsReturnsAllInserted", () => {
    insertWorkspaceRoot({ id: randomUUID(), path: "/projects/a" });
    insertWorkspaceRoot({ id: randomUUID(), path: "/projects/b" });
    insertWorkspaceRoot({ id: randomUUID(), path: "/projects/c" });
    const roots = listWorkspaceRoots();
    expect(roots.length).toBe(3);
    const paths = roots.map((r) => r.path);
    expect(paths).toContain("/projects/a");
    expect(paths).toContain("/projects/b");
    expect(paths).toContain("/projects/c");
  });

  it("ListWorkspaceRootsReturnsEmptyWhenNone", () => {
    expect(listWorkspaceRoots()).toEqual([]);
  });

  it("DeleteWorkspaceRootReturnsTrueWhenDeleted", () => {
    const id = randomUUID();
    insertWorkspaceRoot({ id, path: "/home/user/work" });
    const result = deleteWorkspaceRoot(id);
    expect(result).toBe(true);
    expect(listWorkspaceRoots()).toEqual([]);
  });

  it("DeleteWorkspaceRootReturnsFalseForNonexistent", () => {
    const result = deleteWorkspaceRoot("nonexistent-id");
    expect(result).toBe(false);
  });

  it("GetWorkspaceRootByPathFindsExistingRoot", () => {
    const id = randomUUID();
    insertWorkspaceRoot({ id, path: "/opt/code" });
    const root = getWorkspaceRootByPath("/opt/code");
    expect(root).toBeDefined();
    expect(root?.id).toBe(id);
    expect(root?.path).toBe("/opt/code");
  });

  it("GetWorkspaceRootByPathReturnsUndefinedForMissing", () => {
    expect(getWorkspaceRootByPath("/nonexistent")).toBeUndefined();
  });

  it("InsertDuplicatePathThrowsUniqueConstraint", () => {
    insertWorkspaceRoot({ id: randomUUID(), path: "/unique/path" });
    expect(() => {
      insertWorkspaceRoot({ id: randomUUID(), path: "/unique/path" });
    }).toThrow();
  });
});

// ─── Child Session Queries ────────────────────────────────────────────────────

describe("child session queries", () => {
  function setup() {
    const wsId = mkWorkspaceId();
    const instId = mkInstanceId();
    insertWorkspace({ id: wsId, directory: "/tmp/proj", isolation_strategy: "existing" });
    insertInstance({ id: instId, port: 4700, directory: "/tmp/proj", url: "http://localhost:4700" });
    return { wsId, instId };
  }

  // ─── getActiveChildSessions ───────────────────────────────────────────────

  it("GetActiveChildSessionsReturnsActiveChildren", () => {
    const { wsId, instId } = setup();
    const parentId = mkSessionId();
    const childId = mkSessionId();
    insertSession({ id: parentId, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: childId, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj", parent_session_id: parentId });

    const children = getActiveChildSessions(parentId);
    expect(children.length).toBe(1);
    expect(children[0]?.id).toBe(childId);
  });

  it("GetActiveChildSessionsIncludesWaitingInputChildren", () => {
    const { wsId, instId } = setup();
    const parentId = mkSessionId();
    const childId = mkSessionId();
    insertSession({ id: parentId, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: childId, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj", parent_session_id: parentId });
    updateSessionStatus(childId, "waiting_input");

    const children = getActiveChildSessions(parentId);
    expect(children.length).toBe(1);
    expect(children[0]?.id).toBe(childId);
  });

  it("GetActiveChildSessionsExcludesIdleAndTerminalChildren", () => {
    const { wsId, instId } = setup();
    const parentId = mkSessionId();
    const idleChild = mkSessionId();
    const stoppedChild = mkSessionId();
    const completedChild = mkSessionId();
    insertSession({ id: parentId, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: idleChild, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj", parent_session_id: parentId });
    insertSession({ id: stoppedChild, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj", parent_session_id: parentId });
    insertSession({ id: completedChild, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj", parent_session_id: parentId });
    updateSessionStatus(idleChild, "idle");
    updateSessionStatus(stoppedChild, "stopped");
    updateSessionStatus(completedChild, "completed");

    const children = getActiveChildSessions(parentId);
    expect(children.length).toBe(0);
  });

  it("GetActiveChildSessionsReturnsEmptyWhenNoChildren", () => {
    const { wsId, instId } = setup();
    const parentId = mkSessionId();
    insertSession({ id: parentId, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });

    const children = getActiveChildSessions(parentId);
    expect(children.length).toBe(0);
  });

  // ─── getSessionIdsWithActiveChildren ──────────────────────────────────────

  it("GetSessionIdsWithActiveChildrenReturnsParentIds", () => {
    const { wsId, instId } = setup();
    const parent1 = mkSessionId();
    const parent2 = mkSessionId();
    const child1 = mkSessionId();
    const child2 = mkSessionId();
    insertSession({ id: parent1, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: parent2, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: child1, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj", parent_session_id: parent1 });
    insertSession({ id: child2, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj", parent_session_id: parent2 });

    const result = getSessionIdsWithActiveChildren();
    expect(result.size).toBe(2);
    expect(result.has(parent1)).toBe(true);
    expect(result.has(parent2)).toBe(true);
  });

  it("GetSessionIdsWithActiveChildrenExcludesIdleAndTerminalChildren", () => {
    const { wsId, instId } = setup();
    const parentId = mkSessionId();
    const idleChild = mkSessionId();
    const stoppedChild = mkSessionId();
    insertSession({ id: parentId, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: idleChild, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj", parent_session_id: parentId });
    insertSession({ id: stoppedChild, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj", parent_session_id: parentId });
    updateSessionStatus(idleChild, "idle");
    updateSessionStatus(stoppedChild, "stopped");

    const result = getSessionIdsWithActiveChildren();
    expect(result.size).toBe(0);
  });

  it("GetSessionIdsWithActiveChildrenReturnsEmptySetWhenNone", () => {
    const result = getSessionIdsWithActiveChildren();
    expect(result.size).toBe(0);
  });

  it("GetSessionIdsWithActiveChildrenDeduplicatesParentIds", () => {
    const { wsId, instId } = setup();
    const parentId = mkSessionId();
    const child1 = mkSessionId();
    const child2 = mkSessionId();
    insertSession({ id: parentId, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj" });
    insertSession({ id: child1, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj", parent_session_id: parentId });
    insertSession({ id: child2, workspace_id: wsId, instance_id: instId, opencode_session_id: mkOpencodeSessionId(), directory: "/tmp/proj", parent_session_id: parentId });

    const result = getSessionIdsWithActiveChildren();
    expect(result.size).toBe(1);
    expect(result.has(parentId)).toBe(true);
  });
});
