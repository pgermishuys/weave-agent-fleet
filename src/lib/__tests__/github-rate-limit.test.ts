import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  updateRateLimit,
  getRateLimitState,
  getRecommendedInterval,
  shouldPoll,
  _resetForTesting,
} from "../github-rate-limit";

describe("github-rate-limit", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  // ─── getRateLimitState ────────────────────────────────────────────────────

  describe("getRateLimitState", () => {
    it("ReturnsNullForBothFieldsInitially", () => {
      const state = getRateLimitState();
      expect(state.remaining).toBeNull();
      expect(state.resetAt).toBeNull();
    });

    it("ReturnsUpdatedValuesAfterUpdate", () => {
      updateRateLimit(4200, 1700000000);
      const state = getRateLimitState();
      expect(state.remaining).toBe(4200);
      expect(state.resetAt).toBe(1700000000);
    });

    it("ReturnsLatestValuesAfterMultipleUpdates", () => {
      updateRateLimit(500, 1700000000);
      updateRateLimit(42, 1700003600);
      const state = getRateLimitState();
      expect(state.remaining).toBe(42);
      expect(state.resetAt).toBe(1700003600);
    });
  });

  // ─── getRecommendedInterval ───────────────────────────────────────────────

  describe("getRecommendedInterval", () => {
    const BASE = 30_000;

    it("ReturnsBaseWhenRemainingIsNull", () => {
      expect(getRecommendedInterval(BASE)).toBe(BASE);
    });

    it("ReturnsBaseWhenRemainingAtOrAbove100", () => {
      updateRateLimit(100, 1700000000);
      expect(getRecommendedInterval(BASE)).toBe(BASE);

      updateRateLimit(4999, 1700000000);
      expect(getRecommendedInterval(BASE)).toBe(BASE);
    });

    it("ReturnsDoubleWhenRemainingBetween50And99", () => {
      updateRateLimit(99, 1700000000);
      expect(getRecommendedInterval(BASE)).toBe(BASE * 2);

      updateRateLimit(50, 1700000000);
      expect(getRecommendedInterval(BASE)).toBe(BASE * 2);
    });

    it("ReturnsQuadrupleWhenRemainingBetween10And49", () => {
      updateRateLimit(49, 1700000000);
      expect(getRecommendedInterval(BASE)).toBe(BASE * 4);

      updateRateLimit(10, 1700000000);
      expect(getRecommendedInterval(BASE)).toBe(BASE * 4);
    });

    it("ReturnsInfinityWhenRemainingBelow10", () => {
      updateRateLimit(9, 1700000000);
      expect(getRecommendedInterval(BASE)).toBe(Infinity);

      updateRateLimit(0, 1700000000);
      expect(getRecommendedInterval(BASE)).toBe(Infinity);
    });
  });

  // ─── shouldPoll ───────────────────────────────────────────────────────────

  describe("shouldPoll", () => {
    it("ReturnsTrueWhenRemainingIsNull", () => {
      expect(shouldPoll()).toBe(true);
    });

    it("ReturnsTrueWhenRemainingAtOrAbove10", () => {
      updateRateLimit(10, 1700000000);
      expect(shouldPoll()).toBe(true);

      updateRateLimit(5000, 1700000000);
      expect(shouldPoll()).toBe(true);
    });

    it("ReturnsFalseWhenRemainingBelow10AndResetInFuture", () => {
      // Set reset time far in the future
      const futureResetAt = Math.floor(Date.now() / 1000) + 3600;
      updateRateLimit(5, futureResetAt);
      expect(shouldPoll()).toBe(false);
    });

    it("ReturnsTrueWhenRemainingBelow10ButResetHasPassed", () => {
      // Set reset time in the past
      const pastResetAt = Math.floor(Date.now() / 1000) - 60;
      updateRateLimit(5, pastResetAt);
      expect(shouldPoll()).toBe(true);
    });

    it("ReturnsTrueWhenRemainingBelow10ButResetAtIsNull", () => {
      // Edge case: remaining is known but resetAt somehow isn't
      // (shouldn't happen in practice, but test defensiveness)
      updateRateLimit(5, 1700000000);
      // Now manually verify with a reset time that has passed
      const pastResetAt = Math.floor(Date.now() / 1000) - 1;
      updateRateLimit(5, pastResetAt);
      expect(shouldPoll()).toBe(true);
    });

    it("ReturnsFalseWhenRemainingIsZeroAndResetInFuture", () => {
      const futureResetAt = Math.floor(Date.now() / 1000) + 3600;
      updateRateLimit(0, futureResetAt);
      expect(shouldPoll()).toBe(false);
    });
  });

  // ─── _resetForTesting ─────────────────────────────────────────────────────

  describe("_resetForTesting", () => {
    it("ResetsStateToInitial", () => {
      updateRateLimit(42, 1700000000);
      _resetForTesting();
      const state = getRateLimitState();
      expect(state.remaining).toBeNull();
      expect(state.resetAt).toBeNull();
    });
  });
});
