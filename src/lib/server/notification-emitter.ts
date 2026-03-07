/**
 * Notification event emitter — in-memory pub/sub for real-time notification delivery.
 *
 * The notification service calls `emitNotification()` after inserting a notification.
 * The global SSE stream subscribes via `onNotification()` to push events to clients.
 * Uses the globalThis singleton pattern for Turbopack compatibility.
 *
 * Also carries ephemeral activity status events (busy/idle/waiting_input) that are
 * NOT persisted to the DB — they're transient signals for real-time sidebar updates.
 */

import { EventEmitter } from "events";
import type { DbNotification } from "./db-repository";
import type { SessionActivityStatus } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActivityStatusPayload {
  sessionId: string;
  instanceId: string;
  activityStatus: SessionActivityStatus;
}

// ─── Singleton ────────────────────────────────────────────────────────────────

const _g = globalThis as unknown as {
  __weaveNotificationEmitter?: EventEmitter;
  __weaveListenerMonitorInterval?: ReturnType<typeof setInterval> | null;
};

function getEmitter(): EventEmitter {
  if (!_g.__weaveNotificationEmitter) {
    _g.__weaveNotificationEmitter = new EventEmitter();
    _g.__weaveNotificationEmitter.setMaxListeners(100); // Support many SSE connections
  }
  return _g.__weaveNotificationEmitter;
}

// ─── Notification events (persisted) ──────────────────────────────────────────

export function emitNotification(notification: DbNotification): void {
  getEmitter().emit("notification", notification);
}

export function onNotification(
  callback: (notification: DbNotification) => void
): () => void {
  const emitter = getEmitter();
  emitter.on("notification", callback);
  return () => {
    emitter.off("notification", callback);
  };
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
export function getListenerCounts(): { notification: number; activity_status: number } {
  const emitter = getEmitter();
  return {
    notification: emitter.listenerCount("notification"),
    activity_status: emitter.listenerCount("activity_status"),
  };
}

/**
 * Start periodic monitoring of listener counts.
 * Warns when the total count exceeds the threshold — a possible leak indicator.
 * Idempotent — only one monitor runs at a time.
 */
export function startListenerMonitoring(): void {
  if (_g.__weaveListenerMonitorInterval) return;
  _g.__weaveListenerMonitorInterval = setInterval(() => {
    const counts = getListenerCounts();
    const total = counts.notification + counts.activity_status;
    if (total > LISTENER_WARN_THRESHOLD) {
      console.warn(
        `[notification-emitter] High listener count: ${total} (notification: ${counts.notification}, activity_status: ${counts.activity_status}). Possible leak.`
      );
    }
  }, LISTENER_MONITOR_INTERVAL_MS);
}

/** Stop the listener monitoring interval. */
export function stopListenerMonitoring(): void {
  if (_g.__weaveListenerMonitorInterval) {
    clearInterval(_g.__weaveListenerMonitorInterval);
    _g.__weaveListenerMonitorInterval = null;
  }
}

// ─── Self-initializing startup ────────────────────────────────────────────────
// Start listener monitoring on module load (idempotent).
startListenerMonitoring();
