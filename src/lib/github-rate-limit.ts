// ─── GitHub Rate-Limit Tracker ─────────────────────────────────────────────
//
// Singleton module that tracks the most recent GitHub API rate-limit state
// and provides adaptive polling interval recommendations.
//
// Imported by both the PR and issue status polling hooks so they share
// a single view of the remaining budget.
// ───────────────────────────────────────────────────────────────────────────

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RateLimitState {
  remaining: number | null;
  resetAt: number | null;
}

// ─── State ─────────────────────────────────────────────────────────────────

let _remaining: number | null = null;
let _resetAt: number | null = null; // Unix epoch **seconds**

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Update the tracked rate-limit state.
 * Call this after every GitHub API response that includes
 * `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers.
 */
export function updateRateLimit(remaining: number, resetAt: number): void {
  _remaining = remaining;
  _resetAt = resetAt;
}

/** Return the current known rate-limit state. */
export function getRateLimitState(): RateLimitState {
  return { remaining: _remaining, resetAt: _resetAt };
}

/**
 * Return the recommended polling interval (ms) given current rate-limit
 * pressure.
 *
 * | Remaining     | Multiplier |
 * |---------------|------------|
 * | ≥ 100         | 1× (base)  |
 * | 50 – 99       | 2×         |
 * | 10 – 49       | 4×         |
 * | < 10          | Infinity   |
 *
 * When `remaining` is unknown (`null`), the base interval is returned
 * unchanged — we don't penalise before the first response arrives.
 */
export function getRecommendedInterval(baseMs: number): number {
  if (_remaining === null) return baseMs;
  if (_remaining >= 100) return baseMs;
  if (_remaining >= 50) return baseMs * 2;
  if (_remaining >= 10) return baseMs * 4;
  return Infinity;
}

/**
 * Whether it is safe to poll right now.
 *
 * Returns `false` when the remaining budget is critically low (< 10)
 * **and** the reset window has not yet elapsed.
 */
export function shouldPoll(): boolean {
  if (_remaining === null) return true;
  if (_remaining >= 10) return true;
  // Critically low — check whether the reset window has passed.
  if (_resetAt === null) return true;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return nowSeconds >= _resetAt;
}

// ─── Test helper ───────────────────────────────────────────────────────────

/** Reset internal state — only for use in tests. */
export function _resetForTesting(): void {
  _remaining = null;
  _resetAt = null;
}
