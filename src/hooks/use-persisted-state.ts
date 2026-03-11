"use client";

import { useSyncExternalStore, useCallback } from "react";

// ── Per-key subscriber registry ──────────────────────────────────────────────
// When setState writes to localStorage we notify all subscribers so
// useSyncExternalStore re-reads the snapshot.
const keyListeners = new Map<string, Set<() => void>>();

function emitChange(key: string) {
  const listeners = keyListeners.get(key);
  if (listeners) {
    for (const listener of listeners) {
      listener();
    }
  }
}

function subscribeToKey(key: string) {
  return (callback: () => void) => {
    let listeners = keyListeners.get(key);
    if (!listeners) {
      listeners = new Set();
      keyListeners.set(key, listeners);
    }
    listeners.add(callback);
    return () => {
      listeners!.delete(callback);
      if (listeners!.size === 0) keyListeners.delete(key);
    };
  };
}

// ── Snapshot cache ───────────────────────────────────────────────────────────
// useSyncExternalStore requires referential stability: if the underlying value
// hasn't changed, getSnapshot must return the same object reference.
const snapshotCache = new Map<string, { raw: string | null; value: unknown }>();

function getStorageValue<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(key);
    const cached = snapshotCache.get(key);
    if (cached && cached.raw === raw) {
      return cached.value as T;
    }
    const value = raw !== null ? (JSON.parse(raw) as T) : defaultValue;
    snapshotCache.set(key, { raw, value });
    return value;
  } catch {
    return defaultValue;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function usePersistedState<T>(
  key: string,
  defaultValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  // subscribe is stable per key
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const subscribe = useCallback(subscribeToKey(key), [key]);

  const getSnapshot = useCallback(
    () => getStorageValue(key, defaultValue),
    // defaultValue is the initial fallback; safe to capture once
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  );

  // Server snapshot always returns the default — guarantees hydration match
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const getServerSnapshot = useCallback(() => defaultValue, []);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setState = useCallback(
    (newValue: T | ((prev: T) => T)) => {
      try {
        const current = getStorageValue(key, defaultValue);
        const next =
          typeof newValue === "function"
            ? (newValue as (prev: T) => T)(current)
            : newValue;
        localStorage.setItem(key, JSON.stringify(next));
        // Invalidate cache so getSnapshot returns the new value
        snapshotCache.delete(key);
        emitChange(key);
      } catch {
        // localStorage may be unavailable
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  );

  return [value, setState];
}

// ── Key removal utility ──────────────────────────────────────────────────────
// Removes a key from localStorage, invalidates the snapshot cache, and notifies
// subscribers so any useSyncExternalStore reading that key re-renders with its
// default value.
export function removePersistedKey(key: string): void {
  try {
    localStorage.removeItem(key);
    snapshotCache.delete(key);
    emitChange(key);
  } catch {
    // localStorage unavailable
  }
}
