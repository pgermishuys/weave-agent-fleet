/**
 * Shared SSE EventSource singleton with ref-counted subscriptions.
 *
 * Module-level state (NOT a React context) — avoids adding a provider to
 * the component tree and prevents context re-render cascades.
 *
 * The EventSource connects on first subscriber and disconnects when the
 * last subscriber unmounts. Reconnection uses exponential backoff with
 * jitter (base 1s, max 30s, reset on successful open).
 *
 * Each subscriber registers typed event callbacks via `on(eventType, cb)`.
 * The singleton parses JSON once per message and dispatches to relevant
 * callbacks based on the `type` field in the parsed data.
 */

import { useEffect } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

type SSECallback = (payload: unknown) => void;

export interface SSESubscription {
  /** Register a callback for a specific event type */
  on(eventType: string, callback: SSECallback): void;
  /** Remove a specific callback */
  off(eventType: string, callback: SSECallback): void;
}

// ─── Module-level singleton state ───────────────────────────────────────────

const SSE_URL = "/api/notifications/stream";
const BASE_DELAY = 1000;
const MAX_DELAY = 30_000;

let eventSource: EventSource | null = null;
let subscriberCount = 0;
let reconnectDelay = BASE_DELAY;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Map<string, Set<SSECallback>>();

// ─── Singleton lifecycle ────────────────────────────────────────────────────

function dispatch(eventType: string, payload: unknown): void {
  const callbacks = listeners.get(eventType);
  if (!callbacks || callbacks.size === 0) return;
  for (const cb of callbacks) {
    cb(payload);
  }
}

function handleMessage(e: MessageEvent<string>): void {
  try {
    const data = JSON.parse(e.data) as { type: string; [key: string]: unknown };
    dispatch(data.type, data);
  } catch {
    // Ignore parse errors
  }
}

function handleOpen(): void {
  reconnectDelay = BASE_DELAY; // Reset backoff on successful connection
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return; // Already scheduled
  const delay = reconnectDelay + Math.random() * 1000; // Jitter
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (subscriberCount > 0) {
      connect();
    }
  }, delay);
}

function handleError(): void {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (subscriberCount > 0) {
    scheduleReconnect();
  }
}

function connect(): void {
  if (eventSource !== null) return; // Already connected
  if (typeof EventSource === "undefined") return; // SSR guard

  const es = new EventSource(SSE_URL);
  es.onmessage = handleMessage;
  es.onopen = handleOpen;
  es.onerror = handleError;
  eventSource = es;
}

function disconnect(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  reconnectDelay = BASE_DELAY;
}

function subscribe(): void {
  subscriberCount++;
  if (subscriberCount === 1) {
    connect();
  }
}

function unsubscribe(): void {
  subscriberCount = Math.max(0, subscriberCount - 1);
  if (subscriberCount === 0) {
    disconnect();
  }
}

function addListener(eventType: string, callback: SSECallback): void {
  let set = listeners.get(eventType);
  if (!set) {
    set = new Set();
    listeners.set(eventType, set);
  }
  set.add(callback);
}

function removeListener(eventType: string, callback: SSECallback): void {
  const set = listeners.get(eventType);
  if (!set) return;
  set.delete(callback);
  if (set.size === 0) {
    listeners.delete(eventType);
  }
}

// ─── Test helpers (exported for unit tests only) ────────────────────────────

/** @internal — reset singleton state for testing */
export function _resetForTesting(): void {
  disconnect();
  subscriberCount = 0;
  listeners.clear();
}

/** @internal — get current subscriber count for testing */
export function _getSubscriberCount(): number {
  return subscriberCount;
}

/** @internal — check if EventSource is currently connected */
export function _isConnected(): boolean {
  return eventSource !== null;
}

/** @internal — directly call subscribe (simulates hook mount) */
export const _subscribe = subscribe;

/** @internal — directly call unsubscribe (simulates hook unmount) */
export const _unsubscribe = unsubscribe;

/** @internal — directly add a listener */
export const _addListener = addListener;

/** @internal — directly remove a listener */
export const _removeListener = removeListener;

// ─── React hook ─────────────────────────────────────────────────────────────

/**
 * Subscribe to the global SSE EventSource singleton.
 *
 * On mount: increments subscriber count, connects if first subscriber.
 * On unmount: decrements subscriber count, disconnects if last subscriber.
 * Returns stable `on`/`off` methods for registering typed event callbacks.
 */
const stableSubscription: SSESubscription = {
  on: addListener,
  off: removeListener,
};

export function useGlobalSSE(): SSESubscription {
  useEffect(() => {
    subscribe();
    return () => {
      unsubscribe();
    };
  }, []);

  return stableSubscription;
}
