import {
  formatTokens,
  formatCost,
  formatDuration,
  formatTimestamp,
  formatRelativeTime,
  getStatusColor,
  getStatusDot,
} from "@/lib/format-utils";

// ─── formatTokens ────────────────────────────────────────────────────────────

describe("formatTokens", () => {
  it("returns '0' for 0", () => {
    expect(formatTokens(0)).toBe("0");
  });

  it("returns '1' for 1", () => {
    expect(formatTokens(1)).toBe("1");
  });

  it("returns '999' for 999", () => {
    expect(formatTokens(999)).toBe("999");
  });

  it("returns '1.0k' for 1000", () => {
    expect(formatTokens(1000)).toBe("1.0k");
  });

  it("returns '1.5k' for 1500", () => {
    expect(formatTokens(1500)).toBe("1.5k");
  });

  it("returns '10.0k' for 10000", () => {
    expect(formatTokens(10000)).toBe("10.0k");
  });

  it("returns '1000.0k' for 999999 (rounds to 1 decimal at the k scale)", () => {
    expect(formatTokens(999999)).toBe("1000.0k");
  });
});

// ─── formatCost ──────────────────────────────────────────────────────────────

describe("formatCost", () => {
  it("returns '$0.00' for 0", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("returns '$0.10' for 0.1", () => {
    expect(formatCost(0.1)).toBe("$0.10");
  });

  it("returns '$0.01' for 0.005 (toFixed rounding)", () => {
    expect(formatCost(0.005)).toBe("$0.01");
  });

  it("returns '$1.50' for 1.5", () => {
    expect(formatCost(1.5)).toBe("$1.50");
  });

  it("returns '$100.00' for 99.999", () => {
    expect(formatCost(99.999)).toBe("$100.00");
  });
});

// ─── formatDuration ──────────────────────────────────────────────────────────

describe("formatDuration", () => {
  it("returns '0s' for 0 seconds", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("returns '1s' for 1 second", () => {
    expect(formatDuration(1)).toBe("1s");
  });

  it("returns '30s' for 30 seconds", () => {
    expect(formatDuration(30)).toBe("30s");
  });

  it("returns '59s' for 59 seconds", () => {
    expect(formatDuration(59)).toBe("59s");
  });

  it("returns '1m 0s' for exactly 60 seconds", () => {
    expect(formatDuration(60)).toBe("1m 0s");
  });

  it("returns '1m 30s' for 90 seconds", () => {
    expect(formatDuration(90)).toBe("1m 30s");
  });

  it("returns '60m 0s' for 3600 seconds", () => {
    expect(formatDuration(3600)).toBe("60m 0s");
  });
});

// ─── getStatusColor ──────────────────────────────────────────────────────────

describe("getStatusColor", () => {
  it("returns 'text-green-500' for 'active'", () => {
    expect(getStatusColor("active")).toBe("text-green-500");
  });

  it("returns 'text-green-500' for 'running'", () => {
    expect(getStatusColor("running")).toBe("text-green-500");
  });

  it("returns 'text-zinc-400' for 'idle'", () => {
    expect(getStatusColor("idle")).toBe("text-zinc-400");
  });

  it("returns 'text-zinc-400' for 'paused'", () => {
    expect(getStatusColor("paused")).toBe("text-zinc-400");
  });

  it("returns 'text-amber-500' for 'waiting_input'", () => {
    expect(getStatusColor("waiting_input")).toBe("text-amber-500");
  });

  it("returns 'text-blue-500' for 'completed'", () => {
    expect(getStatusColor("completed")).toBe("text-blue-500");
  });

  it("returns 'text-blue-500' for 'drained'", () => {
    expect(getStatusColor("drained")).toBe("text-blue-500");
  });

  it("returns 'text-red-500' for 'error'", () => {
    expect(getStatusColor("error")).toBe("text-red-500");
  });

  it("returns 'text-red-500' for 'failed'", () => {
    expect(getStatusColor("failed")).toBe("text-red-500");
  });

  it("returns 'text-zinc-500' for 'pending'", () => {
    expect(getStatusColor("pending")).toBe("text-zinc-500");
  });

  it("returns 'text-zinc-500' for 'queued'", () => {
    expect(getStatusColor("queued")).toBe("text-zinc-500");
  });

  it("returns 'text-zinc-400' for 'draft'", () => {
    expect(getStatusColor("draft")).toBe("text-zinc-400");
  });

  it("returns 'text-zinc-500' for an unknown status string", () => {
    expect(getStatusColor("unknown-status")).toBe("text-zinc-500");
  });

  it("returns 'text-zinc-500' for an empty string", () => {
    expect(getStatusColor("")).toBe("text-zinc-500");
  });
});

// ─── getStatusDot ────────────────────────────────────────────────────────────

describe("getStatusDot", () => {
  it("returns 'bg-green-500' for 'active'", () => {
    expect(getStatusDot("active")).toBe("bg-green-500");
  });

  it("returns 'bg-green-500' for 'running'", () => {
    expect(getStatusDot("running")).toBe("bg-green-500");
  });

  it("returns 'bg-zinc-400' for 'idle'", () => {
    expect(getStatusDot("idle")).toBe("bg-zinc-400");
  });

  it("returns 'bg-zinc-400' for 'paused'", () => {
    expect(getStatusDot("paused")).toBe("bg-zinc-400");
  });

  it("returns 'bg-amber-500' for 'waiting_input'", () => {
    expect(getStatusDot("waiting_input")).toBe("bg-amber-500");
  });

  it("returns 'bg-blue-500' for 'completed'", () => {
    expect(getStatusDot("completed")).toBe("bg-blue-500");
  });

  it("returns 'bg-blue-500' for 'drained'", () => {
    expect(getStatusDot("drained")).toBe("bg-blue-500");
  });

  it("returns 'bg-red-500' for 'error'", () => {
    expect(getStatusDot("error")).toBe("bg-red-500");
  });

  it("returns 'bg-red-500' for 'failed'", () => {
    expect(getStatusDot("failed")).toBe("bg-red-500");
  });

  it("returns 'bg-zinc-500' for 'pending'", () => {
    expect(getStatusDot("pending")).toBe("bg-zinc-500");
  });

  it("returns 'bg-zinc-500' for 'queued'", () => {
    expect(getStatusDot("queued")).toBe("bg-zinc-500");
  });

  it("returns 'bg-zinc-500' for an unknown status string", () => {
    expect(getStatusDot("unknown-status")).toBe("bg-zinc-500");
  });

  it("returns 'bg-zinc-500' for an empty string", () => {
    expect(getStatusDot("")).toBe("bg-zinc-500");
  });
});

// ─── formatRelativeTime ───────────────────────────────────────────────────────

describe("formatRelativeTime", () => {
  const BASE = 1_700_000_000_000; // fixed reference point (ms)

  it("returns 'just now' for timestamps less than 30 seconds ago", () => {
    expect(formatRelativeTime(BASE - 10_000, BASE)).toBe("just now");
  });

  it("returns 'just now' for a timestamp equal to now (0 seconds ago)", () => {
    expect(formatRelativeTime(BASE, BASE)).toBe("just now");
  });

  it("returns 'just now' for exactly 29 seconds ago", () => {
    expect(formatRelativeTime(BASE - 29_000, BASE)).toBe("just now");
  });

  it("returns 'Xs ago' for exactly 30 seconds ago", () => {
    expect(formatRelativeTime(BASE - 30_000, BASE)).toBe("30s ago");
  });

  it("returns '45s ago' for 45 seconds ago", () => {
    expect(formatRelativeTime(BASE - 45_000, BASE)).toBe("45s ago");
  });

  it("returns '59s ago' for 59 seconds ago", () => {
    expect(formatRelativeTime(BASE - 59_000, BASE)).toBe("59s ago");
  });

  it("returns '1m ago' for exactly 60 seconds ago", () => {
    expect(formatRelativeTime(BASE - 60_000, BASE)).toBe("1m ago");
  });

  it("returns '5m ago' for 5 minutes ago", () => {
    expect(formatRelativeTime(BASE - 5 * 60_000, BASE)).toBe("5m ago");
  });

  it("returns '59m ago' for 59 minutes ago", () => {
    expect(formatRelativeTime(BASE - 59 * 60_000, BASE)).toBe("59m ago");
  });

  it("returns '1h ago' for exactly 60 minutes ago", () => {
    expect(formatRelativeTime(BASE - 60 * 60_000, BASE)).toBe("1h ago");
  });

  it("returns '2h ago' for 2 hours ago", () => {
    expect(formatRelativeTime(BASE - 2 * 3_600_000, BASE)).toBe("2h ago");
  });

  it("returns '23h ago' for 23 hours ago", () => {
    expect(formatRelativeTime(BASE - 23 * 3_600_000, BASE)).toBe("23h ago");
  });

  it("falls back to formatTimestamp for exactly 24 hours ago", () => {
    const ts = BASE - 24 * 3_600_000;
    const result = formatRelativeTime(ts, BASE);
    // formatTimestamp returns a date+time string (different day), not a relative string
    expect(result).not.toMatch(/ago/);
    expect(result).not.toBe("just now");
    expect(result.length).toBeGreaterThan(0);
  });

  it("falls back to formatTimestamp for timestamps > 24h ago", () => {
    const ts = BASE - 48 * 3_600_000;
    const result = formatRelativeTime(ts, BASE);
    expect(result).not.toMatch(/ago/);
    expect(result).not.toBe("just now");
  });

  it("handles 0 timestamp gracefully (returns '' from formatTimestamp fallback)", () => {
    // 0 is more than 24h before any real 'now', so it falls through to formatTimestamp(0) → ""
    const result = formatRelativeTime(0, BASE);
    expect(result).toBe("");
  });

  // ── Date input overload ──────────────────────────────────────────────────

  it("accepts a Date input and produces the same result as the equivalent number", () => {
    const ts = BASE - 5 * 60_000;
    const dateInput = new Date(ts);
    expect(formatRelativeTime(dateInput, BASE)).toBe("5m ago");
  });

  it("accepts a Date input for 'just now' range", () => {
    const dateInput = new Date(BASE - 10_000);
    expect(formatRelativeTime(dateInput, BASE)).toBe("just now");
  });

  it("accepts a Date input for hours-ago range", () => {
    const dateInput = new Date(BASE - 3 * 3_600_000);
    expect(formatRelativeTime(dateInput, BASE)).toBe("3h ago");
  });

  // ── String input overload ────────────────────────────────────────────────

  it("accepts a string input with timezone (ISO 8601 with Z)", () => {
    // Create a known ISO string that is 2 minutes before BASE
    const ts = BASE - 2 * 60_000;
    const isoString = new Date(ts).toISOString(); // ends with 'Z'
    expect(formatRelativeTime(isoString, BASE)).toBe("2m ago");
  });

  it("accepts a string input with timezone offset (+00:00)", () => {
    const ts = BASE - 45_000;
    // Construct an ISO string with explicit +00:00
    const isoZ = new Date(ts).toISOString();
    const withOffset = isoZ.replace("Z", "+00:00");
    expect(formatRelativeTime(withOffset, BASE)).toBe("45s ago");
  });

  it("accepts a SQLite datetime string without timezone (appends Z)", () => {
    // SQLite format: "YYYY-MM-DD HH:MM:SS" (no T, no Z)
    // We need the result to be 10 minutes before BASE
    const ts = BASE - 10 * 60_000;
    const d = new Date(ts);
    const sqliteStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`;
    expect(formatRelativeTime(sqliteStr, BASE)).toBe("10m ago");
  });

  it("accepts a string with T separator but no timezone (appends Z)", () => {
    const ts = BASE - 30_000;
    const d = new Date(ts);
    // ISO-like but without trailing Z
    const noZ = d.toISOString().replace("Z", "");
    expect(formatRelativeTime(noZ, BASE)).toBe("30s ago");
  });
});

// ─── formatTimestamp ─────────────────────────────────────────────────────────

describe("formatTimestamp", () => {
  it("returns time-only string for a timestamp from today", () => {
    // Create a timestamp for today at 14:34 local time
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 34, 0);
    const result = formatTimestamp(today.getTime(), now);
    // Should produce time-only like "2:34 PM"
    expect(result).toBe("2:34 PM");
  });

  it("returns date+time string for a timestamp from a different day", () => {
    // Jan 15, 2024 at 09:05 local time
    const past = new Date(2024, 0, 15, 9, 5, 0);
    const result = formatTimestamp(past.getTime());
    // Should include month + day + time like "Jan 15, 9:05 AM"
    expect(result).toMatch(/Jan 15.+9:05 AM/);
  });

  it("returns full date+time when now is not provided (server-safe fallback)", () => {
    // Without now, always use dateTimeFormatter (server-safe)
    const past = new Date(2024, 0, 15, 9, 5, 0);
    const result = formatTimestamp(past.getTime());
    expect(result).toMatch(/Jan 15.+9:05 AM/);
  });

  it("returns full date+time when now is 0 (server snapshot sentinel)", () => {
    const ts = new Date(2024, 0, 15, 9, 5, 0);
    const result = formatTimestamp(ts.getTime(), 0);
    expect(result).toMatch(/Jan 15.+9:05 AM/);
  });

  it("returns empty string for undefined", () => {
    expect(formatTimestamp(undefined)).toBe("");
  });

  it("returns empty string for NaN", () => {
    expect(formatTimestamp(NaN)).toBe("");
  });

  it("returns empty string for 0", () => {
    expect(formatTimestamp(0)).toBe("");
  });

  it("returns empty string for null", () => {
    expect(formatTimestamp(null)).toBe("");
  });
});
