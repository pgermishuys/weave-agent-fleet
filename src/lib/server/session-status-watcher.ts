/**
 * Session Status Watcher — server-side event listener that persists
 * busy/idle transitions for ALL sessions on each running instance.
 *
 * Unlike the callback monitor (which only tracks child sessions with
 * completion callbacks and stops monitoring after one idle transition),
 * this watcher continuously tracks status for every session so the
 * sidebar can always show accurate working/idle state.
 *
 * Architecture:
 * - Registers one listener per running OpenCode instance on the shared
 *   Instance Event Hub (which owns the actual SDK subscription and reconnection).
 * - Detects `session.status` (busy/idle) events for any session on that instance
 * - Persists status transitions to the Fleet DB
 * - The sidebar's polled `GET /api/sessions` endpoint then picks up the
 *   correct DB status even when the SDK poll returns no data (because the
 *   SDK only returns sessions with active event subscriptions — which the
 *   hub ensures exist)
 *
 * Uses the globalThis singleton pattern (matching process-manager.ts) for
 * Turbopack compatibility.
 */

import {
  getSessionByOpencodeId,
  updateSessionStatus,
  getSession,
  getActiveChildSessions,
} from "./db-repository";
import type { DbSession } from "./db-repository";
import { getInstance } from "./process-manager";
import { addListener } from "./instance-event-hub";
import type { InstanceEventListener } from "./instance-event-hub";
import { emitActivityStatus } from "./activity-emitter";
import { recordTokens } from "./analytics-collector";
import { log } from "./logger";

// ─── globalThis-based singletons ──────────────────────────────────────────────

const _g = globalThis as unknown as {
  __weaveSessionStatusWatchers?: Map<string, () => void>;
};

function getWatchers(): Map<string, () => void> {
  if (!_g.__weaveSessionStatusWatchers) {
    _g.__weaveSessionStatusWatchers = new Map();
  }
  return _g.__weaveSessionStatusWatchers;
}

// ─── Parent Status Propagation ────────────────────────────────────────────────

const TERMINAL_STATUSES = ["stopped", "completed", "error", "disconnected"];

/**
 * After a child session changes status, propagate the effect to the parent.
 * - Child became busy → parent should be busy (it's waiting on a child)
 * - Child became idle → check if parent has other active children; if none, parent is idle
 */
function propagateToParent(
  childDbSession: DbSession,
  childNewStatus: "busy" | "idle",
): void {
  if (!childDbSession.parent_session_id) return;

  try {
    const parentDbSession = getSession(childDbSession.parent_session_id);
    if (!parentDbSession || TERMINAL_STATUSES.includes(parentDbSession.status)) return;

    if (childNewStatus === "busy") {
      // Child is busy → parent should show as busy (waiting on child)
      if (parentDbSession.status !== "active") {
        updateSessionStatus(parentDbSession.id, "active");
        emitActivityStatus({
          sessionId: parentDbSession.opencode_session_id,
          instanceId: parentDbSession.instance_id,
          activityStatus: "busy",
        });
      }
    } else {
      // Child went idle — check if parent has OTHER active children
      const activeChildren = getActiveChildSessions(parentDbSession.id);
      if (activeChildren.length === 0) {
        // No more active children — parent can go idle
        if (parentDbSession.status !== "idle") {
          updateSessionStatus(parentDbSession.id, "idle");
          emitActivityStatus({
            sessionId: parentDbSession.opencode_session_id,
            instanceId: parentDbSession.instance_id,
            activityStatus: "idle",
          });
        }
      }
      // If there are still active children, parent stays busy — no action needed
    }
  } catch (err) {
    log.warn("session-status-watcher", "Failed to propagate status to parent", {
      childSessionId: childDbSession.id,
      parentSessionId: childDbSession.parent_session_id,
      err,
    });
  }
}

// ─── Event Handler ────────────────────────────────────────────────────────────

/**
 * Build the event handler for a given instance. Processes events dispatched
 * by the Instance Event Hub, persisting busy/idle transitions for every
 * session on that instance.
 */
function buildHandler(instanceId: string): InstanceEventListener {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function handleEvent({ type, properties }: { type: string; properties: Record<string, any> }): void {
    if (type === "session.status") {
      const statusType: string = properties?.status?.type ?? "";
      const eventSessionId: string =
        properties?.sessionID ?? properties?.info?.id ?? "";

      if (!eventSessionId) return;

      if (statusType === "idle") {
        try {
          const dbSession = getSessionByOpencodeId(eventSessionId);
          if (dbSession && !TERMINAL_STATUSES.includes(dbSession.status) && dbSession.status !== "idle") {
            updateSessionStatus(dbSession.id, "idle");
            emitActivityStatus({
              sessionId: eventSessionId,
              instanceId,
              activityStatus: "idle",
            });
            propagateToParent(dbSession, "idle");
          }
        } catch (err) {
          log.warn("session-status-watcher", "Failed to persist idle status", {
            sessionId: eventSessionId,
            instanceId,
            err,
          });
        }
      } else if (statusType === "busy") {
        try {
          const dbSession = getSessionByOpencodeId(eventSessionId);
          if (dbSession && !TERMINAL_STATUSES.includes(dbSession.status) && dbSession.status !== "active") {
            updateSessionStatus(dbSession.id, "active");
            emitActivityStatus({
              sessionId: eventSessionId,
              instanceId,
              activityStatus: "busy",
            });
            propagateToParent(dbSession, "busy");
          }
        } catch (err) {
          log.warn("session-status-watcher", "Failed to persist active status", {
            sessionId: eventSessionId,
            instanceId,
            err,
          });
        }
      }
    } else if (type === "session.idle") {
      // Some SDK versions emit session.idle instead of session.status
      const eventSessionId: string =
        properties?.sessionID ?? properties?.info?.id ?? "";
      if (!eventSessionId) return;

      try {
        const dbSession = getSessionByOpencodeId(eventSessionId);
        if (dbSession && !TERMINAL_STATUSES.includes(dbSession.status) && dbSession.status !== "idle") {
          updateSessionStatus(dbSession.id, "idle");
          emitActivityStatus({
            sessionId: eventSessionId,
            instanceId,
            activityStatus: "idle",
          });
          propagateToParent(dbSession, "idle");
        }
      } catch (err) {
        log.warn("session-status-watcher", "Failed to persist idle status (session.idle event)", {
          sessionId: eventSessionId,
          instanceId,
          err,
        });
      }
    } else if (type.startsWith("permission.")) {
      // Permission events indicate the session is waiting for user input
      const eventSessionId: string =
        properties?.sessionID ?? properties?.info?.id ?? "";
      if (!eventSessionId) return;

      try {
        const dbSession = getSessionByOpencodeId(eventSessionId);
        if (dbSession && !TERMINAL_STATUSES.includes(dbSession.status) && dbSession.status !== "waiting_input") {
          updateSessionStatus(dbSession.id, "waiting_input");
          emitActivityStatus({
            sessionId: eventSessionId,
            instanceId,
            activityStatus: "waiting_input",
          });
        }
      } catch (err) {
        log.warn("session-status-watcher", "Failed to persist waiting_input status", {
          sessionId: eventSessionId,
          instanceId,
          err,
        });
      }
    } else if (type === "question.asked") {
      // Question events indicate the session needs user input before continuing
      const eventSessionId: string =
        properties?.sessionID ?? properties?.info?.id ?? "";
      if (!eventSessionId) return;

      try {
        const dbSession = getSessionByOpencodeId(eventSessionId);
        if (dbSession && !TERMINAL_STATUSES.includes(dbSession.status) && dbSession.status !== "waiting_input") {
          updateSessionStatus(dbSession.id, "waiting_input");
          emitActivityStatus({
            sessionId: eventSessionId,
            instanceId,
            activityStatus: "waiting_input",
          });
        }
      } catch (err) {
        log.warn("session-status-watcher", "Failed to persist waiting_input status for question.asked", {
          sessionId: eventSessionId,
          instanceId,
          err,
        });
      }
    } else if (type === "question.replied" || type === "question.rejected") {
      // When the user answers or rejects a question, transition back to active
      const eventSessionId: string =
        properties?.sessionID ?? properties?.info?.id ?? "";
      if (!eventSessionId) return;

      try {
        const dbSession = getSessionByOpencodeId(eventSessionId);
        if (dbSession && dbSession.status === "waiting_input") {
          updateSessionStatus(dbSession.id, "active");
          emitActivityStatus({
            sessionId: eventSessionId,
            instanceId,
            activityStatus: "busy",
          });
        }
      } catch (err) {
        log.warn("session-status-watcher", "Failed to persist active status for question.replied/rejected", {
          sessionId: eventSessionId,
          instanceId,
          err,
        });
      }
    } else if (type === "message.part.updated") {
      // Delegate to the analytics collector — O(1) Map write, no DB, no EventEmitter.
      // The collector flushes accumulated data to DB on a timer (default: 2s).
      const part = properties?.part;
      if (!part || part.type !== "step-finish") return;

      const eventSessionId: string = part.sessionID ?? "";
      const tokensDelta = (part.tokens?.input ?? 0) + (part.tokens?.output ?? 0) + (part.tokens?.reasoning ?? 0);
      const costDelta: number = part.cost ?? 0;

      if (!eventSessionId || (tokensDelta === 0 && costDelta === 0)) return;

      recordTokens(eventSessionId, tokensDelta, costDelta);
    }
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Ensure there is an active listener watching session status transitions
 * for the given instance. Idempotent — if a watcher already exists for
 * this instance, this is a no-op.
 *
 * The underlying SDK subscription is managed by the Instance Event Hub,
 * which handles reconnection automatically.
 */
export function ensureWatching(instanceId: string): void {
  const watchers = getWatchers();

  // Already watching this instance
  if (watchers.has(instanceId)) return;

  const instance = getInstance(instanceId);
  if (!instance || instance.status === "dead") {
    log.warn("session-status-watcher", "Instance is dead — cannot watch", { instanceId });
    return;
  }

  const handler = buildHandler(instanceId);
  const unsubscribe = addListener(instanceId, handler);
  watchers.set(instanceId, unsubscribe);
}

/**
 * Stop watching an instance. Called when an instance is terminated.
 */
export function stopWatching(instanceId: string): void {
  const watchers = getWatchers();
  const unsubscribe = watchers.get(instanceId);
  if (unsubscribe) {
    unsubscribe();
    watchers.delete(instanceId);
  }
}

/**
 * Reset all state — for tests only.
 */
export function _resetForTests(): void {
  const watchers = getWatchers();
  for (const unsubscribe of watchers.values()) {
    unsubscribe();
  }
  watchers.clear();
}
