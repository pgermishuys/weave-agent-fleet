/**
 * Activity event emitter — in-memory pub/sub for real-time activity status delivery.
 *
 * Carries ephemeral activity status events (busy/idle/waiting_input) that are
 * NOT persisted to the DB — they're transient signals for real-time sidebar updates.
 *
 * The session-status-watcher calls `emitActivityStatus()` after persisting
 * busy/idle transitions. The global SSE stream subscribes via `onActivityStatus()`
 * to push events to clients.
 * Uses the globalThis singleton pattern for Turbopack compatibility.
 */

import { EventEmitter } from "events";
import type { SessionActivityStatus } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActivityStatusPayload {
  sessionId: string;
  instanceId: string;
  activityStatus: SessionActivityStatus;
}

// ─── Singleton ────────────────────────────────────────────────────────────────

const _g = globalThis as unknown as {
  __weaveActivityEmitter?: EventEmitter;
  __weaveActivityListenerMonitorInterval?: ReturnType<typeof setInterval> | null;
};

function getEmitter(): EventEmitter {
  if (!_g.__weaveActivityEmitter) {
    _g.__weaveActivityEmitter = new EventEmitter();
    _g.__weaveActivityEmitter.setMaxListeners(100); // Support many SSE connections
  }
  return _g.__weaveActivityEmitter;
}

// ─── Activity status events (ephemeral — not persisted) ───────────────────────

export function emitActivityStatus(payload: ActivityStatusPayload): void {
  getEmitter().emit("activity_status", payload);
}

export function onActivityStatus(
  callback: (payload: ActivityStatusPayload) => void
): () => void {
  const emitter = getEmitter();
  emitter.on("activity_status", callback);
  return () => {
    emitter.off("activity_status", callback);
  };
}

// ─── Listener monitoring ──────────────────────────────────────────────────────

const LISTENER_WARN_THRESHOLD = 50;
const LISTENER_MONITOR_INTERVAL_MS = 60_000;

/** Get current listener counts by event type. */
export function getListenerCounts(): { activity_status: number } {
  const emitter = getEmitter();
  return {
    activity_status: emitter.listenerCount("activity_status"),
  };
}

/**
 * Start periodic monitoring of listener counts.
 * Warns when the total count exceeds the threshold — a possible leak indicator.
 * Idempotent — only one monitor runs at a time.
 */
export function startListenerMonitoring(): void {
  if (_g.__weaveActivityListenerMonitorInterval) return;
  _g.__weaveActivityListenerMonitorInterval = setInterval(() => {
    const counts = getListenerCounts();
    const total = counts.activity_status;
    if (total > LISTENER_WARN_THRESHOLD) {
      console.warn(
        `[activity-emitter] High listener count: ${total} (activity_status: ${counts.activity_status}). Possible leak.`
      );
    }
  }, LISTENER_MONITOR_INTERVAL_MS);
}

/** Stop the listener monitoring interval. */
export function stopListenerMonitoring(): void {
  if (_g.__weaveActivityListenerMonitorInterval) {
    clearInterval(_g.__weaveActivityListenerMonitorInterval);
    _g.__weaveActivityListenerMonitorInterval = null;
  }
}

// ─── Self-initializing startup ────────────────────────────────────────────────
// Start listener monitoring on module load (idempotent).
startListenerMonitoring();
