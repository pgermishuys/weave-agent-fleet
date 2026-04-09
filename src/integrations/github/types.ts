export interface GitHubRepo {
  id: number;
  full_name: string; // "owner/repo"
  name: string;
  owner: { login: string; avatar_url: string };
  description: string | null;
  html_url: string;
  private: boolean;
  stargazers_count: number;
  language: string | null;
  updated_at: string;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed";
  labels: Array<{ name: string; color: string }>;
  user: { login: string; avatar_url: string };
  comments: number;
  created_at: string;
  updated_at: string;
  pull_request?: { url: string }; // present if this "issue" is actually a PR
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed" | "merged";
  labels: Array<{ name: string; color: string }>;
  user: { login: string; avatar_url: string };
  comments: number;
  additions: number;
  deletions: number;
  changed_files: number;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  draft: boolean;
}

export interface GitHubComment {
  id: number;
  body: string;
  user: { login: string; avatar_url: string };
  created_at: string;
}

export interface BookmarkedRepo {
  /** "owner/repo" — used as unique key */
  fullName: string;
  owner: string;
  name: string;
}

export interface GitHubCheckSuite {
  id: number;
  status: "queued" | "in_progress" | "completed";
  conclusion: "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out" | "action_required" | null;
}

export interface GitHubCheckSuitesResponse {
  total_count: number;
  check_suites: GitHubCheckSuite[];
}

/** Combined PR + checks status for the sidebar polling endpoint. */
export interface PrStatusResponse {
  number: number;
  title: string;
  state: "open" | "closed";
  merged: boolean;
  draft: boolean;
  checksStatus: "pending" | "running" | "success" | "failure" | "none";
  headRef: string;
  url: string;
  /** GitHub API rate-limit remaining (from most recent upstream response). */
  rateLimitRemaining?: number;
  /** Unix epoch seconds when the rate-limit window resets. */
  rateLimitReset?: number;
}

/** Lean repo shape for in-memory cache — subset of GitHubRepo */
export interface CachedGitHubRepo {
  id: number;
  full_name: string;
  name: string;
  owner_login: string;
  private: boolean;
  language: string | null;
  stargazers_count: number;
}

/** Issue status for the sidebar polling endpoint. */
export interface IssueStatusResponse {
  number: number;
  title: string;
  state: "open" | "closed";
  labels: Array<{ name: string; color: string }>;
  url: string;
  /** GitHub API rate-limit remaining (from most recent upstream response). */
  rateLimitRemaining?: number;
  /** Unix epoch seconds when the rate-limit window resets. */
  rateLimitReset?: number;
}

// ─── Issue Filter ─────────────────────────────────────────────────────────────

export interface IssueFilterState {
  state: "open" | "closed" | "all";
  labels: string[];
  /** Milestone title (user-friendly); mapped to number before API call */
  milestone: string | null;
  /** Username, "*" (any), or "none" (unassigned) */
  assignee: string | null;
  /** Issue creator username */
  author: string | null;
  /** Issue type name, "*" (any), or "none" */
  type: string | null;
  sort: "created" | "updated" | "comments";
  direction: "asc" | "desc";
  /** Free-text search query — switches to GitHub Search API when non-empty */
  search: string;
}

export const DEFAULT_ISSUE_FILTER: IssueFilterState = {
  state: "open",
  labels: [],
  milestone: null,
  assignee: null,
  author: null,
  type: null,
  sort: "updated",
  direction: "desc",
  search: "",
};

// ─── Metadata types for filter dropdowns ─────────────────────────────────────

export interface GitHubLabel {
  name: string;
  color: string;
  description: string | null;
}

export interface GitHubMilestone {
  number: number;
  title: string;
  state: "open" | "closed";
  open_issues: number;
  closed_issues: number;
}

export interface GitHubAssignee {
  login: string;
  avatar_url: string;
}
