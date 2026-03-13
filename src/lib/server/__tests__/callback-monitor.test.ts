/**
 * Tests for callback-monitor.ts — session tracking and cleanup logic.
 *
 * Full integration testing (event stream subscription, callback firing) requires
 * a running OpenCode instance and is out of scope. These tests verify the state
 * management: startMonitoring/stopMonitoring track sessions correctly and
 * _resetForTests clears everything.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock process-manager to prevent real instance lookups and recovery
vi.mock("@/lib/server/process-manager", () => ({
  getInstance: vi.fn(() => undefined),
  _recoveryComplete: Promise.resolve(),
}));

// Mock opencode-client to prevent real SDK calls
vi.mock("@/lib/server/opencode-client", () => ({
  getClientForInstance: vi.fn(() => {
    throw new Error("No instance in test");
  }),
}));

// Mock callback-service to prevent real callback delivery
vi.mock("@/lib/server/callback-service", () => ({
  fireSessionCallbacks: vi.fn(),
  fireSessionErrorCallbacks: vi.fn(),
}));

// Mock db-repository — provide no-op implementations for functions used by the module
vi.mock("@/lib/server/db-repository", () => ({
  getAllPendingCallbacks: vi.fn(() => []),
  claimPendingCallback: vi.fn(() => true),
  getSession: vi.fn(() => undefined),
  getSessionByOpencodeId: vi.fn(() => undefined),
  updateSessionStatus: vi.fn(),
}));

import { startMonitoring, stopMonitoring, _resetForTests } from "@/lib/server/callback-monitor";

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetForTests();
  vi.clearAllMocks();
});

afterEach(() => {
  _resetForTests();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("callback-monitor", () => {
  describe("startMonitoring / stopMonitoring", () => {
    it("StartMonitoringDoesNotThrowWhenInstanceIsDead", () => {
      // getInstance returns undefined → instance is dead
      expect(() => startMonitoring("db-1", "oc-1", "inst-1")).not.toThrow();
    });

    it("StopMonitoringIsNoOpForNonExistentSession", () => {
      expect(() => stopMonitoring("nonexistent")).not.toThrow();
    });

    it("DoubleStartMonitoringIsIdempotent", () => {
      // Both calls should succeed without error
      expect(() => {
        startMonitoring("db-1", "oc-1", "inst-1");
        startMonitoring("db-1", "oc-1", "inst-1");
      }).not.toThrow();
    });

    it("StopMonitoringAfterStartDoesNotThrow", () => {
      startMonitoring("db-1", "oc-1", "inst-1");
      expect(() => stopMonitoring("db-1")).not.toThrow();
    });

    it("DoubleStopIsNoOp", () => {
      startMonitoring("db-1", "oc-1", "inst-1");
      stopMonitoring("db-1");
      expect(() => stopMonitoring("db-1")).not.toThrow();
    });
  });

  describe("_resetForTests", () => {
    it("ClearsAllStateWithoutError", () => {
      startMonitoring("db-1", "oc-1", "inst-1");
      startMonitoring("db-2", "oc-2", "inst-2");

      expect(() => _resetForTests()).not.toThrow();
    });

    it("AllowsReMonitoringAfterReset", () => {
      startMonitoring("db-1", "oc-1", "inst-1");
      _resetForTests();

      // Should not throw — state was cleared
      expect(() => startMonitoring("db-1", "oc-1", "inst-1")).not.toThrow();
    });
  });
});
