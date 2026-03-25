/**
 * V1 API types — request/response shapes for the orchestrator API layer.
 * These are the types shared between API routes, React hooks, and UI components.
 */

import type { Session, Part, SessionStatus } from "@opencode-ai/sdk/v2";
import type {
  SessionActivityStatus,
  SessionLifecycleStatus,
  InstanceStatus,
} from "@/lib/types";
import type { ContextSource } from "@/integrations/types";

// Re-export SDK types used across the UI
export type { Session as SDKSession, Part, SessionStatus };
// Re-export new status types for consumer convenience
export type { SessionActivityStatus, SessionLifecycleStatus, InstanceStatus };

// ─── Request/Response Shapes ───────────────────────────────────────────────

export interface CreateSessionRequest {
  directory: string;
  title?: string;
  isolationStrategy?: "existing" | "worktree" | "clone";
  branch?: string;
  /** Optional integration context to inject as the initial prompt */
  context?: ContextSource;
  /** Optional pre-formatted initial prompt text (takes precedence over context) */
  initialPrompt?: string;
  onComplete?: {
    /** OpenCode session ID of the conductor session to notify on completion */
    notifySessionId: string;
    /** Instance ID of the conductor (needed to get the SDK client) */
    notifyInstanceId: string;
  };
}

export interface CreateSessionResponse {
  instanceId: string;
  workspaceId: string;
  session: Session;
}

export interface ResumeSessionResponse {
  instanceId: string;
  session: Session;
}

export interface ForkSessionRequest {
  /** Optional title for the forked session. Defaults to "New Session". */
  title?: string;
}

export interface ForkSessionResponse {
  instanceId: string;
  workspaceId: string;
  session: Session;
  /** The source session ID that was forked (Fleet DB id or opencode session id) */
  forkedFromSessionId: string;
}

export interface SendPromptRequest {
  instanceId: string;
  text: string;
  agent?: string;
  model?: { providerID: string; modelID: string };
  attachments?: ImageAttachment[];
}

/** An image attachment sent alongside a prompt (base64-encoded). */
export interface ImageAttachment {
  /** MIME type: image/png, image/jpeg, image/gif, image/webp */
  mime: string;
  /** Optional filename for display */
  filename?: string;
  /** Base64-encoded image data (NOT the full data URI — just the base64 payload) */
  data: string;
}

export interface SendCommandRequest {
  instanceId: string;
  command: string;
  args?: string;
  agent?: string;
  model?: { providerID: string; modelID: string };
}

export interface SendCommandResponse {
  success: boolean;
  sessionId: string;
}

// ─── Session List ──────────────────────────────────────────────────────────

export interface SessionListItem {
  instanceId: string;
  workspaceId: string;
  workspaceDirectory: string;
  workspaceDisplayName: string | null;
  isolationStrategy: string;
  sessionStatus: "active" | "idle" | "stopped" | "completed" | "disconnected" | "error" | "waiting_input";
  session: Session;
  /** "running" means the OpenCode process is healthy */
  instanceStatus: "running" | "dead";
  /** Internal Fleet DB session ID — used for parent-child matching */
  dbId?: string;
  /** Fleet DB session ID of the parent (conductor) session, if this is a child */
  parentSessionId?: string | null;
  /**
   * The original project directory this session was created from.
   * For worktree/clone sessions, this is the source project path (e.g. /Users/you/my-project).
   * For "existing" sessions or when DB is unavailable, this is null.
   */
  sourceDirectory: string | null;
  /**
   * The git branch this session's workspace was created on (worktree/clone isolation only).
   * Null for "existing" isolation or when workspace metadata is unavailable.
   */
  branch: string | null;
  /**
   * Activity status — what the session's agent is currently doing.
   * Only meaningful while lifecycleStatus is "running".
   */
  activityStatus: SessionActivityStatus | null;
  /**
   * Lifecycle status — overall terminal/non-terminal state of the session.
   */
  lifecycleStatus: SessionLifecycleStatus;
  /**
   * Instance status — whether the OpenCode process backing this session is healthy.
   */
  typedInstanceStatus: InstanceStatus;
  /**
   * Total token count across all messages (populated when available from SSE aggregation or DB).
   */
  totalTokens?: number;
  /**
   * Total cost in USD across all messages (populated when available).
   */
  totalCost?: number;
}

// ─── Streamed Event Model ──────────────────────────────────────────────────

/**
 * The simplified event model sent from the SSE proxy to the browser.
 * Each event carries the raw SDK event type + properties for the client
 * to handle — we avoid mapping here to stay close to the SDK source of truth.
 */
export interface SSEEvent {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties: Record<string, any>;
}

// ─── Accumulated Message (for useSessionEvents) ────────────────────────────

export interface AccumulatedTextPart {
  partId: string;
  type: "text";
  text: string;
}

export interface AccumulatedToolPart {
  partId: string;
  type: "tool";
  tool: string;
  callId: string;
  state: Part extends { type: "tool"; state: infer S } ? S : unknown;
}

export interface AccumulatedFilePart {
  partId: string;
  type: "file";
  mime: string;
  filename?: string;
  /** Full data URI or URL for rendering */
  url: string;
}

export type AccumulatedPart = AccumulatedTextPart | AccumulatedToolPart | AccumulatedFilePart;

export interface AccumulatedMessage {
  messageId: string;
  sessionId: string;
  role: "user" | "assistant";
  parts: AccumulatedPart[];
  /** Cost in USD — populated from step-finish parts */
  cost?: number;
  tokens?: { input: number; output: number; reasoning: number };
  /** ISO timestamp */
  createdAt?: number;
  /** The agent name — sourced from info.agent for both user and assistant messages (v2) */
  agent?: string;
  modelID?: string;
  completedAt?: number;
  parentID?: string;
}

// ─── Autocomplete Types ─────────────────────────────────────────────────────

/** Slim command shape returned by GET /api/instances/[id]/commands */
export interface AutocompleteCommand {
  name: string;
  description?: string;
}

/** Slim agent shape returned by GET /api/instances/[id]/agents */
export interface AutocompleteAgent {
  name: string;
  description?: string;
  mode: string;
  color?: string;
  model?: { modelID: string; providerID: string };
  hidden?: boolean;
}

// ─── Model Picker Types ────────────────────────────────────────────────────

/** A single model within a connected provider */
export interface AvailableModel {
  id: string;    // e.g. "claude-sonnet-4-5"
  name: string;  // e.g. "Claude Sonnet 4.5"
}

/** A connected provider with its available models — returned by GET /api/instances/[id]/models */
export interface AvailableProvider {
  id: string;      // e.g. "anthropic"
  name: string;    // e.g. "Anthropic"
  models: AvailableModel[];
}

// ─── Task Tool Call Helpers ─────────────────────────────────────────────────

export function isTaskToolCall(part: AccumulatedToolPart): boolean {
  return part.tool === "task";
}

export function getTaskToolInput(
  part: AccumulatedToolPart
): { subagent_type?: string; description?: string } | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state = part.state as any;
  const input = state?.input;
  if (!input?.subagent_type && !input?.description) return null;
  return { subagent_type: input.subagent_type, description: input.description };
}

export function getTaskToolSessionId(part: AccumulatedToolPart): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state = part.state as any;

  // 1. Check state.metadata — the SDK's ToolStateCompleted/ToolStateRunning
  //    may carry a sessionId (or sessionID) set by the tool implementation.
  const fromMetadata =
    state?.metadata?.sessionId ?? state?.metadata?.sessionID ?? null;
  if (fromMetadata) return fromMetadata;

  // 2. Parse the output string — the Task tool returns "task_id: ses_xxx"
  //    as the first line of its output when the child session completes.
  const output = state?.output;
  if (typeof output === "string") {
    const match = output.match(/task_id:\s*(\S+)/);
    if (match?.[1]) return match[1];
  }

  return null;
}

// File search returns Array<string> (file paths) — no wrapper type needed

// ─── Directory Browser Types ────────────────────────────────────────────────

/** A single directory entry returned by GET /api/directories */
export interface DirectoryEntry {
  /** Directory name, e.g. "my-project" */
  name: string;
  /** Absolute path, e.g. "/home/user/my-project" */
  path: string;
  /** True if the directory contains a .git subdirectory */
  isGitRepo: boolean;
}

/** Response shape for GET /api/directories */
export interface DirectoryListResponse {
  /** Subdirectories in the listed path */
  entries: DirectoryEntry[];
  /** The resolved absolute path being listed */
  currentPath: string;
  /** Parent directory path, or null if at an allowed root */
  parentPath: string | null;
  /** The allowed workspace roots (for root-level navigation) */
  roots: string[];
}

// ─── Fleet Summary ──────────────────────────────────────────────────────────

export interface FleetSummaryResponse {
  activeSessions: number;
  idleSessions: number;
  totalTokens: number;
  totalCost: number;
  queuedTasks: number;
}

// ─── Diff Types ─────────────────────────────────────────────────────────────

/** Mirrors the SDK's FileDiff shape for frontend consumption (decouples frontend from SDK types) */
export interface FileDiffItem {
  file: string;
  before: string;
  after: string;
  additions: number;
  deletions: number;
  status: "added" | "deleted" | "modified";
}

// ─── Workspace Roots Types ──────────────────────────────────────────────────

/** A single workspace root returned by GET /api/workspace-roots */
export interface WorkspaceRootItem {
  /** DB id, or null for env-var roots */
  id: string | null;
  /** Absolute path to the workspace root */
  path: string;
  /** Whether this root comes from the env var ("env") or was user-added ("user") */
  source: "env" | "user";
  /** Whether the path currently exists on the filesystem */
  exists: boolean;
}

/** Response shape for GET /api/workspace-roots */
export interface WorkspaceRootsResponse {
  roots: WorkspaceRootItem[];
}

/** Request body for POST /api/workspace-roots */
export interface AddWorkspaceRootRequest {
  path: string;
}

/** Response shape for POST /api/workspace-roots */
export interface AddWorkspaceRootResponse {
  id: string;
  path: string;
}

// ─── Repository Scanner Types ────────────────────────────────────────────────

export interface ScannedRepository {
  name: string;        // directory name, e.g. "my-project"
  path: string;        // absolute path, e.g. "/home/user/repos/my-project"
  parentRoot: string;  // the workspace root it was found under
}

export interface RepositoryScanResponse {
  repositories: ScannedRepository[];
  scannedAt: number;   // unix timestamp (ms) of last scan
}

export interface RepositoryInfo {
  name: string;
  path: string;
  branch: string | null;
  lastCommit: {
    hash: string;
    message: string;
    author: string;
    date: string;      // ISO timestamp
  } | null;
  remotes: Array<{ name: string; url: string }>;
}

export interface RepositoryInfoResponse {
  repository: RepositoryInfo;
}

// ─── Repository Detail Types (enriched) ──────────────────────────────────────

export interface BranchInfo {
  name: string;           // e.g. "main", "remotes/origin/feature-x"
  shortHash: string;      // abbreviated commit hash
  message: string;        // latest commit subject
  author: string;         // author name
  authorEmail: string;    // author email (for gravatar)
  date: string;           // ISO timestamp of latest commit
  isCurrent: boolean;     // true if this is the HEAD branch
  isRemote: boolean;      // true if starts with "remotes/" or "origin/"
}

export interface TagInfo {
  name: string;           // e.g. "v1.0.0"
  shortHash: string;      // abbreviated object hash
  date: string;           // ISO timestamp (creator date)
  tagger: string;         // tagger name (empty string for lightweight tags)
  taggerEmail: string;    // tagger email (empty string for lightweight tags)
}

export interface CommitInfo {
  hash: string;           // full SHA
  shortHash: string;      // abbreviated SHA
  message: string;        // subject line
  author: string;         // author name
  authorEmail: string;    // author email
  date: string;           // ISO timestamp
}

export interface GitHubRemoteInfo {
  owner: string;
  repo: string;
  repoUrl: string;        // https://github.com/owner/repo
  issuesUrl: string;      // https://github.com/owner/repo/issues
  pullsUrl: string;       // https://github.com/owner/repo/pulls
}

export interface RemoteInfo {
  name: string;           // e.g. "origin"
  url: string;            // raw URL
  github: GitHubRemoteInfo | null; // parsed GitHub info, null if not GitHub
}

export interface RepositoryDetail {
  name: string;
  path: string;
  branch: string | null;          // current HEAD branch
  uncommittedCount: number;       // number of uncommitted files (from git status)
  totalCommitCount: number;       // total commits on HEAD
  firstCommitDate: string | null; // ISO timestamp of initial commit
  lastCommitDate: string | null;  // ISO timestamp of most recent commit
  branches: BranchInfo[];         // all branches sorted by committer date desc
  tags: TagInfo[];                // all tags sorted by creator date desc
  recentCommits: CommitInfo[];    // last 10 commits
  remotes: RemoteInfo[];          // remotes with parsed GitHub info
  readmeContent: string | null;   // raw README text, null if not found
  readmeFilename: string | null;  // actual filename found (e.g. "README.md")
}

export interface RepositoryDetailResponse {
  repository: RepositoryDetail;
}

// ─── Session History Types ──────────────────────────────────────────────────

export interface HistorySession {
  id: string;
  opencodeSessionId: string | null;
  instanceId: string;
  title: string | null;
  status: string;
  directory: string;
  workspaceDisplayName: string | null;
  createdAt: string;
  stoppedAt: string | null;
}

export interface HistoryResponse {
  sessions: HistorySession[];
  total: number;
}
