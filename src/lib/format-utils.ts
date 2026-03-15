/**
 * Format utilities — display helpers extracted from mock-data.ts.
 * These are pure functions with no mock data dependencies.
 */

export function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return tokens.toString();
}

export function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const timeOnlyFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/**
 * Format a unix-ms timestamp for message display.
 * - Same calendar day as now → "2:34 PM" (time only)
 * - Different day → "Mar 1, 2:34 PM" (short month + day + time)
 * - Falsy / NaN → "" (graceful fallback)
 *
 * @param timestamp - unix milliseconds
 * @param now       - reference time (Date or unix ms). If falsy/0 → always use dateTimeFormatter (server-safe)
 */
export function formatTimestamp(timestamp: number | undefined | null, now?: Date | number): string {
  if (!timestamp || isNaN(timestamp)) return "";

  const date = new Date(timestamp);

  // If now is not provided or is falsy (e.g. 0 from server snapshot), skip same-day check
  if (!now) {
    return dateTimeFormatter.format(date);
  }

  const nowDate = now instanceof Date ? now : new Date(now);

  const sameDay =
    date.getFullYear() === nowDate.getFullYear() &&
    date.getMonth() === nowDate.getMonth() &&
    date.getDate() === nowDate.getDate();

  return sameDay ? timeOnlyFormatter.format(date) : dateTimeFormatter.format(date);
}

/**
 * Format a unix-ms timestamp as a human-readable relative time string.
 * - < 30s  → "just now"
 * - < 60s  → "Xs ago"  (e.g. "45s ago")
 * - < 60m  → "Xm ago"  (e.g. "5m ago")
 * - < 24h  → "Xh ago"  (e.g. "2h ago")
 * - >= 24h → falls back to formatTimestamp(timestamp)
 *
 * @param timestamp - unix milliseconds
 * @param now       - reference time in unix ms (defaults to Date.now(); injectable for tests)
 */
export function formatRelativeTime(
  timestamp: number | Date | string,
  now?: number
): string {
  let ts: number;
  if (typeof timestamp === "number") {
    ts = timestamp;
  } else if (timestamp instanceof Date) {
    ts = timestamp.getTime();
  } else {
    // String — handle SQLite datetime format (may lack timezone indicator)
    const normalized =
      timestamp.endsWith("Z") || timestamp.includes("+")
        ? timestamp
        : timestamp + "Z";
    ts = new Date(normalized).getTime();
  }

  const reference = now ?? Date.now();
  const diffMs = reference - ts;
  const diffS = Math.floor(diffMs / 1000);

  if (diffS < 30) return "just now";
  if (diffS < 60) return `${diffS}s ago`;

  const diffM = Math.floor(diffS / 60);
  if (diffM < 60) return `${diffM}m ago`;

  const diffH = Math.floor(diffM / 60);
  if (diffH < 24) return `${diffH}h ago`;

  return formatTimestamp(ts);
}

export function getStatusColor(status: string): string {
  switch (status) {
    case "active":
    case "running":
      return "text-green-500";
    case "idle":
    case "paused":
      return "text-zinc-400";
    case "waiting_input":
      return "text-amber-500";
    case "completed":
    case "drained":
      return "text-blue-500";
    case "error":
    case "failed":
      return "text-red-500";
    case "pending":
    case "queued":
      return "text-zinc-500";
    case "draft":
      return "text-zinc-400";
    default:
      return "text-zinc-500";
  }
}

export function getStatusDot(status: string): string {
  switch (status) {
    case "active":
    case "running":
      return "bg-green-500";
    case "idle":
    case "paused":
      return "bg-zinc-400";
    case "waiting_input":
      return "bg-amber-500";
    case "completed":
    case "drained":
      return "bg-blue-500";
    case "error":
    case "failed":
      return "bg-red-500";
    case "pending":
    case "queued":
      return "bg-zinc-500";
    default:
      return "bg-zinc-500";
  }
}
