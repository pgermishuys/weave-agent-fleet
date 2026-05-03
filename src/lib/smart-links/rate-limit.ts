/**
 * Per-provider rate-limit tracker factory.
 *
 * Each provider gets its own independent rate-limit state so that a single
 * depleted provider does not block polling for others.
 *
 * Thresholds follow GitHub's model (works well as a general default):
 *
 * | Remaining     | Multiplier |
 * |---------------|------------|
 * | ≥ 100         | 1× (base)  |
 * | 50 – 99       | 2×         |
 * | 10 – 49       | 4×         |
 * | < 10          | Infinity   |
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RateLimitTracker {
  /**
   * Update state from the latest API response.
   * `resetAt` is Unix epoch **seconds**.
   */
  update(remaining: number, resetAt: number): void;

  /** Return the recommended polling interval given current rate-limit pressure. */
  getRecommendedInterval(baseMs: number): number;

  /**
   * Whether polling should proceed right now.
   * Returns `false` only when the budget is critically low (< 10)
   * **and** the reset window has not yet elapsed.
   */
  shouldPoll(): boolean;

  /** Reset internal state — only for use in tests. */
  _resetForTesting(): void;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a new rate-limit tracker for a provider.
 * Each call returns an independent tracker instance.
 */
export function createRateLimitTracker(): RateLimitTracker {
  let _remaining: number | null = null;
  let _resetAt: number | null = null;

  return {
    update(remaining: number, resetAt: number): void {
      _remaining = remaining;
      _resetAt = resetAt;
    },

    getRecommendedInterval(baseMs: number): number {
      if (_remaining === null) return baseMs;
      if (_remaining >= 100) return baseMs;
      if (_remaining >= 50) return baseMs * 2;
      if (_remaining >= 10) return baseMs * 4;
      return Infinity;
    },

    shouldPoll(): boolean {
      if (_remaining === null) return true;
      if (_remaining >= 10) return true;
      if (_resetAt === null) return true;
      const nowSeconds = Math.floor(Date.now() / 1000);
      return nowSeconds >= _resetAt;
    },

    _resetForTesting(): void {
      _remaining = null;
      _resetAt = null;
    },
  };
}

// ─── Per-provider singleton registry ─────────────────────────────────────────

const _trackers = new Map<string, RateLimitTracker>();

/**
 * Return the singleton rate-limit tracker for a named provider.
 * Creates a new tracker on first access.
 */
export function getRateLimitTracker(providerName: string): RateLimitTracker {
  let tracker = _trackers.get(providerName);
  if (!tracker) {
    tracker = createRateLimitTracker();
    _trackers.set(providerName, tracker);
  }
  return tracker;
}
