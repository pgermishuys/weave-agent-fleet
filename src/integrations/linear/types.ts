/** Shared types for the Linear integration. */

export interface LinearIssueStatusResponse {
  id: string;
  /** Human-readable identifier, e.g. "TEAM-123" */
  identifier: string;
  title: string;
  url: string;
  state: {
    name: string;
    type:
      | "triage"
      | "backlog"
      | "unstarted"
      | "started"
      | "completed"
      | "cancelled";
    color: string;
  };
  /** Rate-limit remaining (from X-RateLimit-Requests-Remaining header) */
  rateLimitRemaining?: number;
  /** Unix epoch seconds when the rate-limit window resets */
  rateLimitReset?: number;
}
