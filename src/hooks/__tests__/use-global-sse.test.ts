/**
 * Unit tests for `useGlobalSSE` — module-level singleton EventSource hook.
 *
 * Tests verify:
 * 1. Ref-counted subscriptions (connect on first, disconnect on last)
 * 2. Event dispatching to registered callbacks
 * 3. Cleanup behavior on last unsubscribe
 * 4. Multiple subscribers share a single EventSource
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── EventSource mock ───────────────────────────────────────────────────────

interface MockES {
  url: string;
  readyState: number;
  onmessage: ((e: MessageEvent<string>) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  dispatchEvent: ReturnType<typeof vi.fn>;
  withCredentials: boolean;
  CONNECTING: 0;
  OPEN: 1;
  CLOSED: 2;
}

let mockInstances: MockES[] = [];

function createMockEventSourceClass() {
  return class MockEventSource {
    static CONNECTING = 0 as const;
    static OPEN = 1 as const;
    static CLOSED = 2 as const;
    CONNECTING = 0 as const;
    OPEN = 1 as const;
    CLOSED = 2 as const;

    url: string;
    readyState = 0;
    onmessage: ((e: MessageEvent<string>) => void) | null = null;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    withCredentials = false;
    close = vi.fn(() => {
      this.readyState = 2;
    });
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
    dispatchEvent = vi.fn(() => true);

    constructor(url: string) {
      this.url = url;
      mockInstances.push(this as unknown as MockES);
    }
  };
}

// Install global EventSource mock before importing the module
(globalThis as Record<string, unknown>).EventSource = createMockEventSourceClass();

// ─── Import module AFTER mock is installed ──────────────────────────────────

const {
  _resetForTesting,
  _getSubscriberCount,
  _isConnected,
  _subscribe,
  _unsubscribe,
  _addListener,
  _removeListener,
} = await import("@/hooks/use-global-sse");

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("useGlobalSSE singleton", () => {
  beforeEach(() => {
    mockInstances = [];
    _resetForTesting();
  });

  afterEach(() => {
    _resetForTesting();
    mockInstances = [];
  });

  describe("ref-counted subscriptions", () => {
    it("starts with no subscribers and no connection", () => {
      expect(_getSubscriberCount()).toBe(0);
      expect(_isConnected()).toBe(false);
      expect(mockInstances).toHaveLength(0);
    });

    it("connects on first subscriber", () => {
      _subscribe();

      expect(_getSubscriberCount()).toBe(1);
      expect(_isConnected()).toBe(true);
      expect(mockInstances).toHaveLength(1);
      expect(mockInstances[0]!.url).toBe("/api/activity-stream");
    });

    it("does not create a second EventSource for additional subscribers", () => {
      _subscribe();
      _subscribe();

      expect(_getSubscriberCount()).toBe(2);
      expect(_isConnected()).toBe(true);
      expect(mockInstances).toHaveLength(1); // Still just 1
    });

    it("stays connected when going from 2 to 1 subscriber", () => {
      _subscribe();
      _subscribe();
      _unsubscribe();

      expect(_getSubscriberCount()).toBe(1);
      expect(_isConnected()).toBe(true);
      expect(mockInstances[0]!.close).not.toHaveBeenCalled();
    });

    it("disconnects when last subscriber unsubscribes", () => {
      _subscribe();
      _subscribe();
      _unsubscribe();
      _unsubscribe();

      expect(_getSubscriberCount()).toBe(0);
      expect(_isConnected()).toBe(false);
      expect(mockInstances[0]!.close).toHaveBeenCalledTimes(1);
    });

    it("reconnects when a new subscriber arrives after full disconnect", () => {
      _subscribe();
      _unsubscribe(); // Disconnect
      expect(_isConnected()).toBe(false);

      _subscribe(); // New subscriber
      expect(_isConnected()).toBe(true);
      expect(mockInstances).toHaveLength(2); // Second EventSource created
    });

    it("does not go below 0 subscribers", () => {
      _unsubscribe();
      _unsubscribe();

      expect(_getSubscriberCount()).toBe(0);
      expect(_isConnected()).toBe(false);
    });
  });

  describe("event dispatching", () => {
    it("dispatches parsed events to registered callbacks", () => {
      _subscribe();
      const cb = vi.fn();
      _addListener("activity_status", cb);

      const es = mockInstances[0]!;
      const payload = { type: "activity_status", sessionId: "s1", activityStatus: "busy" };
      es.onmessage!({ data: JSON.stringify(payload) } as MessageEvent<string>);

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(payload);
    });

    it("dispatches to correct channel only", () => {
      _subscribe();
      const activityCb = vi.fn();
      const otherCb = vi.fn();
      _addListener("activity_status", activityCb);
      _addListener("other_event", otherCb);

      const es = mockInstances[0]!;
      es.onmessage!({
        data: JSON.stringify({ type: "activity_status", sessionId: "s1" }),
      } as MessageEvent<string>);

      expect(activityCb).toHaveBeenCalledTimes(1);
      expect(otherCb).not.toHaveBeenCalled();
    });

    it("dispatches to multiple callbacks on the same channel", () => {
      _subscribe();
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      _addListener("activity_status", cb1);
      _addListener("activity_status", cb2);

      const es = mockInstances[0]!;
      es.onmessage!({
        data: JSON.stringify({ type: "activity_status", sessionId: "s1" }),
      } as MessageEvent<string>);

      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    });

    it("stops dispatching after callback is removed", () => {
      _subscribe();
      const cb = vi.fn();
      _addListener("activity_status", cb);

      const es = mockInstances[0]!;
      es.onmessage!({
        data: JSON.stringify({ type: "activity_status" }),
      } as MessageEvent<string>);
      expect(cb).toHaveBeenCalledTimes(1);

      _removeListener("activity_status", cb);
      es.onmessage!({
        data: JSON.stringify({ type: "activity_status" }),
      } as MessageEvent<string>);
      expect(cb).toHaveBeenCalledTimes(1); // Not called again
    });

    it("ignores malformed JSON messages", () => {
      _subscribe();
      const cb = vi.fn();
      _addListener("activity_status", cb);

      const es = mockInstances[0]!;
      // Should not throw
      es.onmessage!({ data: "not valid json{" } as MessageEvent<string>);

      expect(cb).not.toHaveBeenCalled();
    });

    it("ignores messages with unknown event types", () => {
      _subscribe();
      const cb = vi.fn();
      _addListener("activity_status", cb);

      const es = mockInstances[0]!;
      es.onmessage!({
        data: JSON.stringify({ type: "unknown_event" }),
      } as MessageEvent<string>);

      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe("reconnection", () => {
    it("closes EventSource on error and schedules reconnect", () => {
      vi.useFakeTimers();
      _subscribe();

      const es = mockInstances[0]!;
      es.onerror!();

      expect(es.close).toHaveBeenCalledTimes(1);
      expect(_isConnected()).toBe(false);

      // Advance past reconnect delay (base 1s + up to 1s jitter)
      vi.advanceTimersByTime(2100);

      expect(_isConnected()).toBe(true);
      expect(mockInstances).toHaveLength(2); // New EventSource created

      vi.useRealTimers();
    });

    it("resets backoff delay on successful open", () => {
      vi.useFakeTimers();
      _subscribe();

      const es1 = mockInstances[0]!;
      // Simulate error → reconnect → open → error → reconnect
      es1.onerror!(); // Closes, schedules reconnect with base delay
      vi.advanceTimersByTime(2100);

      const es2 = mockInstances[1]!;
      es2.onopen!(); // Reset backoff
      es2.onerror!(); // Should use base delay again, not doubled
      vi.advanceTimersByTime(2100); // Base delay + jitter

      expect(mockInstances).toHaveLength(3);

      vi.useRealTimers();
    });

    it("does not reconnect after all subscribers unsubscribe", () => {
      vi.useFakeTimers();
      _subscribe();

      const es = mockInstances[0]!;
      _unsubscribe(); // Last subscriber leaves

      // EventSource was closed by disconnect
      expect(es.close).toHaveBeenCalled();
      expect(_isConnected()).toBe(false);

      // Even after waiting, no reconnect should happen
      vi.advanceTimersByTime(60_000);
      expect(mockInstances).toHaveLength(1); // No new connections

      vi.useRealTimers();
    });
  });
});
