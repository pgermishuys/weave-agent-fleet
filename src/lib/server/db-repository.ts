/**
 * Database repository — typed CRUD functions for the three fleet tables.
 *
 * All functions are synchronous (better-sqlite3 is sync).
 * These are thin wrappers around prepared statements — no business logic here.
 */

import { getDb } from "./database";
import type {
  SessionActivityStatus,
  SessionLifecycleStatus,
} from "@/lib/types";

// ─── Row Types ────────────────────────────────────────────────────────────────

export interface DbWorkspace {
  id: string;
  directory: string;
  source_directory: string | null;
  isolation_strategy: "existing" | "worktree" | "clone";
  branch: string | null;
  created_at: string;
  cleaned_up_at: string | null;
  display_name: string | null;
}

export interface DbInstance {
  id: string;
  port: number;
  pid: number | null;
  directory: string;
  url: string;
  status: "running" | "stopped";
  created_at: string;
  stopped_at: string | null;
}

export interface DbSession {
  id: string;
  workspace_id: string;
  instance_id: string;
  opencode_session_id: string;
  title: string;
  status: "active" | "idle" | "stopped" | "completed" | "disconnected" | "error" | "waiting_input";
  directory: string;
  created_at: string;
  stopped_at: string | null;
  parent_session_id: string | null;
  /** Activity status — what the agent is currently doing (null until first write) */
  activity_status: SessionActivityStatus | null;
  /** Lifecycle status — overall terminal/non-terminal state (null until first write) */
  lifecycle_status: SessionLifecycleStatus | null;
}

// ─── Insert input types (id + timestamps are required on insert) ──────────────

export type InsertWorkspace = Pick<
  DbWorkspace,
  "id" | "directory" | "isolation_strategy"
> &
  Partial<Pick<DbWorkspace, "source_directory" | "branch">>;

export type InsertInstance = Pick<
  DbInstance,
  "id" | "port" | "directory" | "url"
> &
  Partial<Pick<DbInstance, "pid">>;

export type InsertSession = Pick<
  DbSession,
  | "id"
  | "workspace_id"
  | "instance_id"
  | "opencode_session_id"
  | "directory"
> &
  Partial<Pick<DbSession, "title" | "parent_session_id">>;

// ─── Workspaces ───────────────────────────────────────────────────────────────

export function insertWorkspace(ws: InsertWorkspace): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO workspaces (id, directory, source_directory, isolation_strategy, branch)
     VALUES (@id, @directory, @source_directory, @isolation_strategy, @branch)`
  ).run({
    id: ws.id,
    directory: ws.directory,
    source_directory: ws.source_directory ?? null,
    isolation_strategy: ws.isolation_strategy,
    branch: ws.branch ?? null,
  });
}

export function getWorkspace(id: string): DbWorkspace | undefined {
  return getDb()
    .prepare("SELECT * FROM workspaces WHERE id = ?")
    .get(id) as DbWorkspace | undefined;
}

export function getWorkspaceByDirectory(
  directory: string,
  isolationStrategy: string
): DbWorkspace | undefined {
  return getDb()
    .prepare(
      "SELECT * FROM workspaces WHERE directory = ? AND isolation_strategy = ? AND cleaned_up_at IS NULL ORDER BY created_at DESC LIMIT 1"
    )
    .get(directory, isolationStrategy) as DbWorkspace | undefined;
}

export function listWorkspaces(): DbWorkspace[] {
  return getDb().prepare("SELECT * FROM workspaces ORDER BY created_at DESC").all() as DbWorkspace[];
}

export function markWorkspaceCleaned(id: string): void {
  getDb()
    .prepare(
      "UPDATE workspaces SET cleaned_up_at = datetime('now') WHERE id = ?"
    )
    .run(id);
}

export function updateWorkspaceDisplayName(id: string, displayName: string): void {
  getDb()
    .prepare("UPDATE workspaces SET display_name = @display_name WHERE id = @id")
    .run({ id, display_name: displayName });
}

// ─── Instances ────────────────────────────────────────────────────────────────

export function insertInstance(inst: InsertInstance): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO instances (id, port, pid, directory, url, status)
     VALUES (@id, @port, @pid, @directory, @url, 'running')`
  ).run({
    id: inst.id,
    port: inst.port,
    pid: inst.pid ?? null,
    directory: inst.directory,
    url: inst.url,
  });
}

export function getInstance(id: string): DbInstance | undefined {
  return getDb()
    .prepare("SELECT * FROM instances WHERE id = ?")
    .get(id) as DbInstance | undefined;
}

export function getInstanceByDirectory(directory: string): DbInstance | undefined {
  return getDb()
    .prepare("SELECT * FROM instances WHERE directory = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1")
    .get(directory) as DbInstance | undefined;
}

export function listInstances(): DbInstance[] {
  return getDb().prepare("SELECT * FROM instances ORDER BY created_at DESC").all() as DbInstance[];
}

export function updateInstanceStatus(
  id: string,
  status: "running" | "stopped",
  stoppedAt?: string
): void {
  getDb()
    .prepare(
      "UPDATE instances SET status = @status, stopped_at = @stopped_at WHERE id = @id"
    )
    .run({ id, status, stopped_at: stoppedAt ?? null });
}

export function getRunningInstances(): DbInstance[] {
  return getDb()
    .prepare("SELECT * FROM instances WHERE status = 'running' ORDER BY created_at ASC")
    .all() as DbInstance[];
}

/**
 * Mark ALL running instances as stopped.
 *
 * Called at the very start of recovery. When Fleet restarts (whether after a
 * crash or a graceful shutdown) every previous OpenCode process is
 * definitively dead — there is nothing to "reconnect" to. Eagerly
 * transitioning every instance to "stopped" means the subsequent session
 * sweep can work unconditionally.
 *
 * Returns the number of instances transitioned.
 */
export function markAllInstancesStopped(stoppedAt: string): number {
  const result = getDb()
    .prepare(
      `UPDATE instances
         SET status = 'stopped', stopped_at = @stopped_at
       WHERE status = 'running'`
    )
    .run({ stopped_at: stoppedAt });
  return result.changes;
}

/**
 * Mark ALL non-terminal sessions as stopped.
 *
 * Called immediately after `markAllInstancesStopped()` during startup.
 * Because every OpenCode process is dead on Fleet restart, any session still
 * in a non-terminal state (active, idle, waiting_input, disconnected) is
 * stale and must be moved to "stopped".
 *
 * Returns the number of sessions transitioned.
 */
export function markAllNonTerminalSessionsStopped(stoppedAt: string): number {
  const result = getDb()
    .prepare(
      `UPDATE sessions
         SET status = 'stopped', stopped_at = @stopped_at
       WHERE status NOT IN ('stopped', 'completed', 'error')`
    )
    .run({ stopped_at: stoppedAt });
  return result.changes;
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export function insertSession(sess: InsertSession): void {
  getDb()
    .prepare(
      `INSERT INTO sessions (id, workspace_id, instance_id, opencode_session_id, title, status, directory, parent_session_id)
       VALUES (@id, @workspace_id, @instance_id, @opencode_session_id, @title, 'active', @directory, @parent_session_id)`
    )
    .run({
      id: sess.id,
      workspace_id: sess.workspace_id,
      instance_id: sess.instance_id,
      opencode_session_id: sess.opencode_session_id,
      title: sess.title ?? "Untitled",
      directory: sess.directory,
      parent_session_id: sess.parent_session_id ?? null,
    });
}

export function getSession(id: string): DbSession | undefined {
  return getDb()
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(id) as DbSession | undefined;
}

export function getSessionByOpencodeId(opencodeSessionId: string): DbSession | undefined {
  return getDb()
    .prepare("SELECT * FROM sessions WHERE opencode_session_id = ?")
    .get(opencodeSessionId) as DbSession | undefined;
}

export function listSessions(): DbSession[] {
  return getDb()
    .prepare("SELECT * FROM sessions ORDER BY created_at DESC")
    .all() as DbSession[];
}

/**
 * Count sessions grouped by status using SQL aggregation.
 * Returns { active, idle } counts without loading full rows into memory.
 */
export function getSessionStatusCounts(): { active: number; idle: number } {
  const rows = getDb()
    .prepare(
      "SELECT status, COUNT(*) as count FROM sessions WHERE status IN ('active', 'idle') GROUP BY status"
    )
    .all() as Array<{ status: string; count: number }>;

  const counts = { active: 0, idle: 0 };
  for (const row of rows) {
    if (row.status === "active") counts.active = row.count;
    else if (row.status === "idle") counts.idle = row.count;
  }
  return counts;
}

export function listActiveSessions(): DbSession[] {
  return getDb()
    .prepare("SELECT * FROM sessions WHERE status IN ('active', 'idle') ORDER BY created_at DESC")
    .all() as DbSession[];
}

export function updateSessionStatus(
  id: string,
  status: "active" | "idle" | "stopped" | "completed" | "disconnected" | "error" | "waiting_input",
  stoppedAt?: string
): void {
  // Derive the new typed status columns from the legacy status value
  const activityStatus = deriveActivityStatus(status);
  const lifecycleStatus = deriveLifecycleStatus(status);

  getDb()
    .prepare(
      "UPDATE sessions SET status = @status, stopped_at = @stopped_at, activity_status = @activity_status, lifecycle_status = @lifecycle_status WHERE id = @id"
    )
    .run({ id, status, stopped_at: stoppedAt ?? null, activity_status: activityStatus, lifecycle_status: lifecycleStatus });
}

/**
 * Derive the activity status from the legacy session status.
 * Activity is only meaningful while a session is running — terminal states return null.
 */
function deriveActivityStatus(
  status: DbSession["status"]
): SessionActivityStatus | null {
  switch (status) {
    case "active":
      return "busy";
    case "idle":
      return "idle";
    case "waiting_input":
      return "waiting_input";
    default:
      // Terminal states — no meaningful activity
      return null;
  }
}

/**
 * Derive the lifecycle status from the legacy session status.
 */
function deriveLifecycleStatus(
  status: DbSession["status"]
): SessionLifecycleStatus {
    switch (status) {
    case "active":
    case "idle":
    case "waiting_input":
      return "running";
    case "disconnected":
      return "disconnected";
    case "completed":
      return "completed";
    case "stopped":
      return "stopped";
    case "error":
      return "error";
  }
}

export function getSessionsForInstance(instanceId: string): DbSession[] {
  return getDb()
    .prepare("SELECT * FROM sessions WHERE instance_id = ? AND status IN ('active', 'idle')")
    .all(instanceId) as DbSession[];
}

/**
 * Get the oldest session for an instance regardless of status.
 * Used only for breadcrumb resolution as a last-resort fallback when
 * the explicit parentSessionId hint is not available.
 * By ordering by created_at ASC we return the earliest (most likely parent) session.
 */
export function getAnySessionForInstance(instanceId: string): DbSession | undefined {
  return getDb()
    .prepare("SELECT * FROM sessions WHERE instance_id = ? ORDER BY created_at ASC LIMIT 1")
    .get(instanceId) as DbSession | undefined;
}

/**
 * Get all sessions for an instance that are NOT in a terminal state.
 * Used during recovery to cascade instance death to orphaned sessions.
 * Unlike getSessionsForInstance() which only returns active/idle,
 * this includes disconnected/waiting_input sessions too.
 */
export function getNonTerminalSessionsForInstance(instanceId: string): DbSession[] {
  return getDb()
    .prepare("SELECT * FROM sessions WHERE instance_id = ? AND status NOT IN ('stopped', 'completed', 'error')")
    .all(instanceId) as DbSession[];
}

export function updateSessionTitle(id: string, title: string): void {
  getDb()
    .prepare("UPDATE sessions SET title = @title WHERE id = @id")
    .run({ id, title });
}

export function updateSessionForResume(id: string, instanceId: string): void {
  getDb()
    .prepare(
      "UPDATE sessions SET instance_id = @instance_id, status = 'active', activity_status = 'busy', lifecycle_status = 'running', stopped_at = NULL WHERE id = @id"
    )
    .run({ id, instance_id: instanceId });
}

export function searchSessions(opts: {
  search?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}): { sessions: DbSession[]; total: number } {
  const db = getDb();
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (opts.search) {
    conditions.push("title LIKE @search");
    params.search = `%${opts.search}%`;
  }

  if (opts.status) {
    conditions.push("status = @status");
    params.status = opts.status;
  }

  if (opts.fromDate) {
    conditions.push("created_at >= @fromDate");
    params.fromDate = opts.fromDate;
  }

  if (opts.toDate) {
    conditions.push("created_at <= @toDate");
    params.toDate = opts.toDate;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = db
    .prepare(`SELECT COUNT(*) as count FROM sessions ${where}`)
    .get(params) as { count: number };

  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;

  const sessions = db
    .prepare(`SELECT * FROM sessions ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset }) as DbSession[];

  return { sessions, total: countRow.count };
}

/**
 * Get all active (non-idle, non-terminal) child sessions for a parent.
 * Used by session-status-watcher to check if a parent has remaining busy children.
 */
export function getActiveChildSessions(parentDbId: string): DbSession[] {
  return getDb()
    .prepare("SELECT * FROM sessions WHERE parent_session_id = ? AND status IN ('active', 'waiting_input')")
    .all(parentDbId) as DbSession[];
}

/**
 * Batch query: returns all parent session IDs that have at least one active child.
 * Called once per GET /api/sessions poll to avoid N+1 queries.
 */
export function getSessionIdsWithActiveChildren(): Set<string> {
  const rows = getDb()
    .prepare(
      "SELECT DISTINCT parent_session_id FROM sessions WHERE parent_session_id IS NOT NULL AND status IN ('active', 'waiting_input')"
    )
    .all() as Array<{ parent_session_id: string }>;
  return new Set(rows.map(r => r.parent_session_id));
}

export function getSessionsForWorkspace(workspaceId: string): DbSession[] {
  return getDb()
    .prepare("SELECT * FROM sessions WHERE workspace_id = ?")
    .all(workspaceId) as DbSession[];
}

export function deleteSession(id: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM sessions WHERE id = ?")
    .run(id);
  return result.changes > 0;
}

// ─── Notifications ────────────────────────────────────────────────────────────

// DbNotification is defined in api-types.ts (shared with frontend).
// Re-export here so server-side consumers keep working unchanged.
export type { DbNotification } from "@/lib/api-types";
import type { DbNotification } from "@/lib/api-types";

export type InsertNotification = Pick<DbNotification, "id" | "type" | "message"> &
  Partial<Pick<DbNotification, "session_id" | "instance_id" | "pipeline_id">>;

export function insertNotification(notif: InsertNotification): void {
  getDb()
    .prepare(
      `INSERT INTO notifications (id, type, session_id, instance_id, pipeline_id, message)
       VALUES (@id, @type, @session_id, @instance_id, @pipeline_id, @message)`
    )
    .run({
      id: notif.id,
      type: notif.type,
      session_id: notif.session_id ?? null,
      instance_id: notif.instance_id ?? null,
      pipeline_id: notif.pipeline_id ?? null,
      message: notif.message,
    });
}

export function listNotifications(opts?: { unreadOnly?: boolean; limit?: number }): DbNotification[] {
  const where = opts?.unreadOnly ? "WHERE read = 0" : "";
  const rawLimit = opts?.limit ?? 50;
  const safeLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 50;
  const limitClause = `LIMIT ${safeLimit}`;
  return getDb()
    .prepare(`SELECT * FROM notifications ${where} ORDER BY created_at DESC ${limitClause}`)
    .all() as DbNotification[];
}

export function getNotification(id: string): DbNotification | undefined {
  return getDb()
    .prepare("SELECT * FROM notifications WHERE id = ?")
    .get(id) as DbNotification | undefined;
}

export function markNotificationRead(id: string): void {
  getDb()
    .prepare("UPDATE notifications SET read = 1 WHERE id = ?")
    .run(id);
}

export function markAllNotificationsRead(): void {
  getDb()
    .prepare("UPDATE notifications SET read = 1 WHERE read = 0")
    .run();
}

export function countUnreadNotifications(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) as count FROM notifications WHERE read = 0")
    .get() as { count: number };
  return row.count;
}

export function deleteNotification(id: string): void {
  getDb()
    .prepare("DELETE FROM notifications WHERE id = ?")
    .run(id);
}

export function deleteNotificationsForSession(sessionId: string): number {
  const result = getDb()
    .prepare("DELETE FROM notifications WHERE session_id = ?")
    .run(sessionId);
  return result.changes;
}

export function deleteAllNotifications(): number {
  const result = getDb()
    .prepare("DELETE FROM notifications")
    .run();
  return result.changes;
}

export function deleteOldNotifications(olderThan: string): number {
  const result = getDb()
    .prepare("DELETE FROM notifications WHERE created_at < ?")
    .run(olderThan);
  return result.changes;
}

// ─── Session Callbacks ────────────────────────────────────────────────────────

export interface DbSessionCallback {
  id: string;
  source_session_id: string;
  target_session_id: string;
  target_instance_id: string;
  status: "pending" | "fired";
  created_at: string;
  fired_at: string | null;
}

export type InsertSessionCallback = Pick<
  DbSessionCallback,
  "id" | "source_session_id" | "target_session_id" | "target_instance_id"
>;

export function insertSessionCallback(cb: InsertSessionCallback): void {
  getDb()
    .prepare(
      `INSERT INTO session_callbacks (id, source_session_id, target_session_id, target_instance_id)
       VALUES (@id, @source_session_id, @target_session_id, @target_instance_id)`
    )
    .run({
      id: cb.id,
      source_session_id: cb.source_session_id,
      target_session_id: cb.target_session_id,
      target_instance_id: cb.target_instance_id,
    });
}

export function getPendingCallbacksForSession(sourceSessionId: string): DbSessionCallback[] {
  return getDb()
    .prepare("SELECT * FROM session_callbacks WHERE source_session_id = ? AND status = 'pending'")
    .all(sourceSessionId) as DbSessionCallback[];
}

export function markCallbackFired(id: string): void {
  getDb()
    .prepare("UPDATE session_callbacks SET status = 'fired', fired_at = datetime('now') WHERE id = ?")
    .run(id);
}

/**
 * Atomically claim a pending callback — sets status to 'fired' only if it is
 * currently 'pending'. Returns true if the row was updated (i.e. this caller
 * won the claim), false if another caller already claimed it.
 */
export function claimPendingCallback(id: string): boolean {
  const result = getDb()
    .prepare(
      "UPDATE session_callbacks SET status = 'fired', fired_at = datetime('now') WHERE id = ? AND status = 'pending'"
    )
    .run(id);
  return result.changes > 0;
}

/**
 * Get all pending callbacks across all sessions.
 * Used by the polling safety net to catch missed transitions.
 */
export function getAllPendingCallbacks(): DbSessionCallback[] {
  return getDb()
    .prepare("SELECT * FROM session_callbacks WHERE status = 'pending'")
    .all() as DbSessionCallback[];
}

export function deleteCallbacksForSession(sessionId: string): number {
  const result = getDb()
    .prepare("DELETE FROM session_callbacks WHERE source_session_id = ? OR target_session_id = ?")
    .run(sessionId, sessionId);
  return result.changes;
}

// ─── Workspace Roots ──────────────────────────────────────────────────────────

export interface DbWorkspaceRoot {
  id: string;
  path: string;
  created_at: string;
}

export function insertWorkspaceRoot(root: { id: string; path: string }): void {
  getDb()
    .prepare(
      `INSERT INTO workspace_roots (id, path) VALUES (@id, @path)`
    )
    .run({ id: root.id, path: root.path });
}

export function listWorkspaceRoots(): DbWorkspaceRoot[] {
  return getDb()
    .prepare("SELECT * FROM workspace_roots ORDER BY created_at ASC")
    .all() as DbWorkspaceRoot[];
}

export function deleteWorkspaceRoot(id: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM workspace_roots WHERE id = ?")
    .run(id);
  return result.changes > 0;
}

export function getWorkspaceRootByPath(path: string): DbWorkspaceRoot | undefined {
  return getDb()
    .prepare("SELECT * FROM workspace_roots WHERE path = @path")
    .get({ path }) as DbWorkspaceRoot | undefined;
}
