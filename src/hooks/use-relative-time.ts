import { useSyncExternalStore } from "react";

const TICK_INTERVAL_MS = 30_000;

let now = Date.now();
const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(callback: () => void): () => void {
  subscribers.add(callback);
  if (subscribers.size === 1 && timer === null) {
    timer = setInterval(() => {
      now = Date.now();
      for (const cb of subscribers) cb();
    }, TICK_INTERVAL_MS);
  }
  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  return now;
}

function getServerSnapshot(): number {
  return 0;
}

/**
 * Returns the current timestamp, updated every 30 seconds via a shared singleton timer.
 * Only one setInterval runs regardless of how many components use this hook.
 */
export function useRelativeTime(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
