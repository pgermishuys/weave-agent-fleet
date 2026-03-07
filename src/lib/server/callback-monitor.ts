/**
 * Callback Monitor — server-side event subscription manager that fires
 * completion callbacks without depending on a browser SSE connection.
 *
 * Three layers of redundancy:
 * 1. SSE handler (instant, browser-dependent) — existing, unchanged
 * 2. Event subscription (instant, server-side) — this module
 * 3. Polling fallback (10s delay, catches everything) — this module
 *
 * Duplicate delivery is prevented by the atomic `claimPendingCallback()` in
 * db-repository, which ensures only one caller succeeds per callback row.
 *
 * Uses the globalThis singleton pattern (matching process-manager.ts) for
 * Turbopack compatibility.
 */

import {
  getAllPendingCallbacks,
  claimPendingCallback,
  getSession,
  getSessionByOpencodeId,
  updateSessionStatus,
} from "./db-repository";
import { getInstance, _recoveryComplete } from "./process-manager";
import { getClientForInstance } from "./opencode-client";
import {
  fireSessionCallbacks,
  fireSessionErrorCallbacks,
} from "./callback-service";
import {
  createSessionCompletedNotification,
  type NotificationContext,
} from "./notification-service";

// ─── Constants ────────────────────────────────────────────────────────────────

const CALLBACK_POLL_INTERVAL_MS = 10_000;
/** Stop polling after this many consecutive polls find no pending callbacks. */
const MAX_EMPTY_POLLS = 3;

// ─── Types ────────────────────────────────────────────────────────────────────

interface MonitoredSession {
  dbSessionId: string;
  opencodeSessionId: string;
  instanceId: string;
}

interface InstanceSubscription {
  instanceId: string;
  directory: string;
  sessionStates: Map<string, "idle" | "busy">; // keyed by opencode session ID
  monitoredDbSessionIds: Set<string>; // Fleet DB IDs being monitored on this instance
  abort: AbortController;
}

// ─── globalThis-based singletons ──────────────────────────────────────────────

const _g = globalThis as unknown as {
  __weaveCallbackMonitor?: {
    monitoredSessions: Map<string, MonitoredSession>;
    instanceSubscriptions: Map<string, InstanceSubscription>;
  };
  __weaveCallbackPollInterval?: ReturnType<typeof setInterval> | null;
  __weaveCallbackMonitorInit?: boolean;
  __weaveCallbackConsecutiveEmptyPolls?: number;
};

function getMonitorState() {
  if (!_g.__weaveCallbackMonitor) {
    _g.__weaveCallbackMonitor = {
      monitoredSessions: new Map(),
      instanceSubscriptions: new Map(),
    };
  }
  return _g.__weaveCallbackMonitor;
}

// ─── Event Stream Processing ──────────────────────────────────────────────────

/**
 * Process events from an instance's event stream, detecting busy→idle
 * transitions for monitored sessions and firing callbacks.
 */
async function processEventStream(
  instanceId: string,
  eventStream: AsyncIterable<unknown>,
  abortController: AbortController
): Promise<void> {
  const { monitoredSessions, instanceSubscriptions } = getMonitorState();

  try {
    for await (const rawEvent of eventStream) {
      if (abortController.signal.aborted) break;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const event = rawEvent as any;
      const type: string = event?.type ?? "unknown";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const properties: Record<string, any> = event?.properties ?? event ?? {};

      const sub = instanceSubscriptions.get(instanceId);
      if (!sub) break; // subscription was removed

      if (type === "session.status") {
        const statusType: string = properties?.status?.type ?? "";
        const eventSessionId: string =
          properties?.sessionID ?? properties?.info?.id ?? "";

        if (!eventSessionId) continue;

        if (statusType === "busy") {
          sub.sessionStates.set(eventSessionId, "busy");
        } else if (statusType === "idle") {
          const prevState = sub.sessionStates.get(eventSessionId);
          sub.sessionStates.set(eventSessionId, "idle");

          if (prevState === "busy") {
            // Find the monitored session by opencode session ID
            for (const [dbSessionId, monitored] of monitoredSessions) {
              if (
                monitored.opencodeSessionId === eventSessionId &&
                monitored.instanceId === instanceId
              ) {
                try {
                  updateSessionStatus(dbSessionId, "idle");
                  const sessionTitle = getSession(dbSessionId)?.title ?? "Child session";
                  const ctx: NotificationContext = { directory: sub.directory };
                  createSessionCompletedNotification(
                    eventSessionId,
                    instanceId,
                    sessionTitle,
                    ctx
                  );
                  void fireSessionCallbacks(eventSessionId, instanceId);
                } catch (err) {
                  console.error(
                    `[callback-monitor] Failed to fire callback for session ${dbSessionId}:`,
                    err
                  );
                }
                stopMonitoringSession(dbSessionId);
                break;
              }
            }
          }
        }
      } else if (type === "session.idle") {
        const eventSessionId: string =
          properties?.sessionID ?? properties?.info?.id ?? "";
        if (!eventSessionId) continue;

        const prevState = sub.sessionStates.get(eventSessionId);
        sub.sessionStates.set(eventSessionId, "idle");

        if (prevState === "busy") {
          for (const [dbSessionId, monitored] of monitoredSessions) {
            if (
              monitored.opencodeSessionId === eventSessionId &&
              monitored.instanceId === instanceId
            ) {
              try {
                updateSessionStatus(dbSessionId, "idle");
                const sessionTitle = getSession(dbSessionId)?.title ?? "Child session";
                const ctx: NotificationContext = { directory: sub.directory };
                createSessionCompletedNotification(
                  eventSessionId,
                  instanceId,
                  sessionTitle,
                  ctx
                );
                void fireSessionCallbacks(eventSessionId, instanceId);
              } catch (err) {
                console.error(
                  `[callback-monitor] Failed to fire callback for session ${dbSessionId}:`,
                  err
                );
              }
              stopMonitoringSession(dbSessionId);
              break;
            }
          }
        }
      } else if (type === "error") {
        const eventSessionId: string =
          properties?.sessionID ?? properties?.info?.id ?? "";
        if (!eventSessionId) continue;

        for (const [dbSessionId, monitored] of monitoredSessions) {
          if (
            monitored.opencodeSessionId === eventSessionId &&
            monitored.instanceId === instanceId
          ) {
            try {
              void fireSessionErrorCallbacks(eventSessionId, instanceId);
            } catch (err) {
              console.error(
                `[callback-monitor] Failed to fire error callback for session ${dbSessionId}:`,
                err
              );
            }
            stopMonitoringSession(dbSessionId);
            break;
          }
        }
      }
    }
  } catch (err) {
    if (!abortController.signal.aborted) {
      console.error(
        `[callback-monitor] Event stream for instance ${instanceId} errored:`,
        err
      );
    }
  } finally {
    // Stream ended — clean up subscription
    const sub = instanceSubscriptions.get(instanceId);
    if (sub) {
      instanceSubscriptions.delete(instanceId);
      // Any monitored sessions left on this subscription are now orphaned —
      // the polling fallback will catch them
    }
  }
}

// ─── Subscription Management ──────────────────────────────────────────────────

/**
 * Internal: remove a session from monitoring state and clean up instance
 * subscription if no more sessions are being monitored on it.
 */
function stopMonitoringSession(dbSessionId: string): void {
  const { monitoredSessions, instanceSubscriptions } = getMonitorState();

  const monitored = monitoredSessions.get(dbSessionId);
  if (!monitored) return;

  monitoredSessions.delete(dbSessionId);

  // Remove from instance subscription tracking
  const sub = instanceSubscriptions.get(monitored.instanceId);
  if (sub) {
    sub.monitoredDbSessionIds.delete(dbSessionId);
    sub.sessionStates.delete(monitored.opencodeSessionId);

    // If no more sessions on this instance, tear down the subscription
    if (sub.monitoredDbSessionIds.size === 0) {
      sub.abort.abort();
      instanceSubscriptions.delete(monitored.instanceId);
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start monitoring a child session for busy→idle transitions.
 * Creates an instance-level event subscription if one doesn't exist.
 * Performs an initial status poll to catch already-idle sessions.
 */
export function startMonitoring(
  dbSessionId: string,
  opencodeSessionId: string,
  instanceId: string
): void {
  const { monitoredSessions, instanceSubscriptions } = getMonitorState();

  // Idempotent — skip if already monitoring
  if (monitoredSessions.has(dbSessionId)) return;

  monitoredSessions.set(dbSessionId, {
    dbSessionId,
    opencodeSessionId,
    instanceId,
  });

  // Restart polling loop if it was paused due to inactivity
  if (!_g.__weaveCallbackPollInterval) {
    _g.__weaveCallbackConsecutiveEmptyPolls = 0;
    startCallbackPollingLoop();
  }

  // Add to existing instance subscription or create new one
  let sub = instanceSubscriptions.get(instanceId);
  if (sub) {
    sub.monitoredDbSessionIds.add(dbSessionId);
  } else {
    // Create new subscription for this instance
    const instance = getInstance(instanceId);
    if (!instance || instance.status === "dead") {
      console.warn(
        `[callback-monitor] Instance ${instanceId} is dead — cannot monitor session ${dbSessionId}`
      );
      monitoredSessions.delete(dbSessionId);
      return;
    }

    const abort = new AbortController();
    sub = {
      instanceId,
      directory: instance.directory,
      sessionStates: new Map(),
      monitoredDbSessionIds: new Set([dbSessionId]),
      abort,
    };
    instanceSubscriptions.set(instanceId, sub);

    // Start event subscription (fire-and-forget)
    void (async () => {
      try {
        const client = getClientForInstance(instanceId);
        const subscribeResult = await client.event.subscribe({
          directory: instance.directory,
        });

        const eventStream =
          "stream" in subscribeResult
            ? (subscribeResult as { stream: AsyncIterable<unknown> }).stream
            : (subscribeResult as AsyncIterable<unknown>);

        await processEventStream(instanceId, eventStream, abort);
      } catch (err) {
        console.error(
          `[callback-monitor] Failed to subscribe to instance ${instanceId}:`,
          err
        );
        // Clean up on failure — polling will catch the session
        const currentSub = instanceSubscriptions.get(instanceId);
        if (currentSub) {
          instanceSubscriptions.delete(instanceId);
        }
      }
    })();
  }

  // Initial status poll — catch already-idle sessions
  void (async () => {
    try {
      const instance = getInstance(instanceId);
      if (!instance || instance.status === "dead") return;

      const result = await instance.client.session.status({
        directory: instance.directory,
      });
      const statusMap = (result.data ?? {}) as Record<string, { type: string }>;
      const liveStatus = statusMap[opencodeSessionId];

      if (liveStatus?.type === "idle") {
        // Already idle — fire callback immediately
        const dbSession = getSession(dbSessionId);
        if (dbSession) {
          updateSessionStatus(dbSessionId, "idle");
          createSessionCompletedNotification(
            opencodeSessionId,
            instanceId,
            dbSession.title,
            { directory: instance.directory }
          );
          void fireSessionCallbacks(opencodeSessionId, instanceId);
        }
        stopMonitoringSession(dbSessionId);
      } else if (liveStatus?.type === "busy") {
        // Mark as busy in subscription state so we can detect the transition
        const currentSub = instanceSubscriptions.get(instanceId);
        if (currentSub) {
          currentSub.sessionStates.set(opencodeSessionId, "busy");
        }
      }
    } catch (err) {
      console.error(
        `[callback-monitor] Initial status poll failed for session ${dbSessionId}:`,
        err
      );
      // Non-fatal — event subscription or polling will catch it
    }
  })();
}

/**
 * Stop monitoring a session. Called when a session is deleted or terminated.
 */
export function stopMonitoring(dbSessionId: string): void {
  stopMonitoringSession(dbSessionId);
}

// ─── Polling Safety Net ───────────────────────────────────────────────────────

/**
 * Start a periodic polling loop that checks all pending callbacks and fires
 * any whose sessions have gone idle. This catches cases where the event
 * subscription misses a transition (e.g., subscription started after
 * completion, instance reconnected, etc.).
 *
 * Idempotent — only one loop runs at a time.
 */
export function startCallbackPollingLoop(): void {
  if (_g.__weaveCallbackPollInterval) return;

  _g.__weaveCallbackPollInterval = setInterval(async () => {
    try {
      const pending = getAllPendingCallbacks();
      if (pending.length === 0) {
        _g.__weaveCallbackConsecutiveEmptyPolls = (_g.__weaveCallbackConsecutiveEmptyPolls ?? 0) + 1;
        if (_g.__weaveCallbackConsecutiveEmptyPolls >= MAX_EMPTY_POLLS) {
          // No pending callbacks for several consecutive polls — pause the loop
          if (_g.__weaveCallbackPollInterval) {
            clearInterval(_g.__weaveCallbackPollInterval);
            _g.__weaveCallbackPollInterval = null;
          }
        }
        return;
      }
      _g.__weaveCallbackConsecutiveEmptyPolls = 0;

      // Group by source session's instance to batch status checks
      const byInstance = new Map<string, typeof pending>();
      for (const cb of pending) {
        const sourceSession = getSession(cb.source_session_id);
        if (!sourceSession) {
          // Source session deleted — claim and skip
          claimPendingCallback(cb.id);
          continue;
        }
        const list = byInstance.get(sourceSession.instance_id) ?? [];
        list.push(cb);
        byInstance.set(sourceSession.instance_id, list);
      }

      for (const [instanceId, callbacks] of byInstance) {
        const instance = getInstance(instanceId);
        if (!instance || instance.status === "dead") {
          // Instance dead — fire error callbacks for each
          for (const cb of callbacks) {
            const sourceSession = getSession(cb.source_session_id);
            if (sourceSession) {
              void fireSessionErrorCallbacks(
                sourceSession.opencode_session_id,
                instanceId
              );
            }
          }
          continue;
        }

        // Poll session statuses
        try {
          const result = await instance.client.session.status({
            directory: instance.directory,
          });
          const statusMap = (result.data ?? {}) as Record<
            string,
            { type: string }
          >;

          for (const cb of callbacks) {
            const sourceSession = getSession(cb.source_session_id);
            if (!sourceSession) continue;

            const liveStatus = statusMap[sourceSession.opencode_session_id];
            if (liveStatus?.type === "idle") {
              // Session is idle — fire the callback
              void fireSessionCallbacks(
                sourceSession.opencode_session_id,
                instanceId
              );
              // Also update DB status
              if (sourceSession.status !== "idle") {
                updateSessionStatus(sourceSession.id, "idle");
              }
              createSessionCompletedNotification(
                sourceSession.opencode_session_id,
                instanceId,
                sourceSession.title,
                { directory: instance.directory }
              );
              // Stop monitoring if we were monitoring
              stopMonitoringSession(sourceSession.id);
            }
          }
        } catch (err) {
          console.error(
            `[callback-monitor] Polling status for instance ${instanceId} failed:`,
            err
          );
        }
      }
    } catch (err) {
      console.error("[callback-monitor] Polling loop error:", err);
    }
  }, CALLBACK_POLL_INTERVAL_MS);
}

/**
 * Reset all internal state — for tests only.
 */
export function _resetForTests(): void {
  const state = getMonitorState();

  // Abort all subscriptions
  for (const sub of state.instanceSubscriptions.values()) {
    sub.abort.abort();
  }

  state.monitoredSessions.clear();
  state.instanceSubscriptions.clear();

  if (_g.__weaveCallbackPollInterval) {
    clearInterval(_g.__weaveCallbackPollInterval);
    _g.__weaveCallbackPollInterval = null;
  }
  _g.__weaveCallbackConsecutiveEmptyPolls = 0;
  _g.__weaveCallbackMonitorInit = false;
}

// ─── Self-initializing startup ────────────────────────────────────────────────
// Start the polling loop after instance recovery completes.
// Guarded so it only runs once across Turbopack re-evaluations.

if (!_g.__weaveCallbackMonitorInit) {
  _g.__weaveCallbackMonitorInit = true;
  _recoveryComplete
    .then(() => {
      startCallbackPollingLoop();
    })
    .catch(() => {
      /* non-fatal */
    });
}
