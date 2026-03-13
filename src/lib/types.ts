// === Core Entities ===

export type WorkspaceStatus = "starting" | "ready" | "error" | "stopped";

export interface Workspace {
  id: string;
  name: string;
  directory: string;
  sourceRepo?: string;
  isolationStrategy: "worktree" | "clone" | "existing";
  branch?: string;
  opencodePort: number;
  opencodePid: number;
  status: WorkspaceStatus;
  createdAt: Date;
}

export type SessionStatus =
  | "active"
  | "idle"
  | "waiting_input"
  | "completed"
  | "error"
  | "stopped"
  | "disconnected";

/**
 * Activity status — what the session's agent is currently doing.
 * Only meaningful while the lifecycle is "running".
 */
export type SessionActivityStatus = "busy" | "idle" | "waiting_input";

/**
 * Lifecycle status — the overall terminal/non-terminal state of the session.
 */
export type SessionLifecycleStatus =
  | "running"
  | "completed"
  | "stopped"
  | "error"
  | "disconnected";

/**
 * Instance (OpenCode process) status.
 */
export type InstanceStatus = "running" | "stopped";

export type SessionSourceType =
  | "manual"
  | "template"
  | "batch"
  | "github"
  | "pipeline";

export interface SessionSource {
  type: SessionSourceType;
  templateId?: string;
  batchId?: string;
  issueUrl?: string;
  issueNumber?: number;
  pipelineId?: string;
  stageIndex?: number;
}

export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cache: number;
}

export interface Session {
  id: string;
  workspaceId: string;
  name: string;
  status: SessionStatus;
  currentAgent: string;
  initialPrompt: string;
  source: SessionSource;
  tokens: TokenUsage;
  cost: number;
  contextUsage: number;
  planRef?: string;
  planProgress?: { done: number; total: number };
  pipelineStageId?: string;
  tags: string[];
  modifiedFiles: FileChange[];
  createdAt: Date;
  completedAt?: Date;
}

export interface FileChange {
  path: string;
  type: "added" | "modified" | "deleted";
}

// === Events ===

export type EventType =
  | "message"
  | "agent_switch"
  | "delegation_start"
  | "delegation_end"
  | "tool_call"
  | "tool_result"
  | "plan_progress"
  | "status_change"
  | "cost_update";

export interface SessionEvent {
  id: string;
  sessionId: string;
  timestamp: Date;
  type: EventType;
  agent?: string;
  data: Record<string, unknown>;
}

// === Orchestration ===

export type PipelineStatus =
  | "draft"
  | "running"
  | "paused"
  | "completed"
  | "failed";

export type StageStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export interface Pipeline {
  id: string;
  name: string;
  description: string;
  stages: PipelineStage[];
  status: PipelineStatus;
  createdAt: Date;
}

export interface PipelineStage {
  id: string;
  index: number;
  name: string;
  workspaceDir: string;
  prompt: string;
  dependsOn: string[];
  contextFrom?: string[];
  sessionId?: string;
  status: StageStatus;
  tokens?: number;
  cost?: number;
}

export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  prompt: string;
  variables: TemplateVariable[];
  defaultWorkspace?: string;
  tags: string[];
  usageCount: number;
}

export interface TemplateVariable {
  name: string;
  description: string;
  required: boolean;
  defaultValue?: string;
}

export type QueueStatus = "running" | "paused" | "drained";

export type QueueItemStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export interface TaskQueue {
  id: string;
  name: string;
  concurrency: number;
  items: QueueItem[];
  status: QueueStatus;
}

export interface QueueItem {
  id: string;
  templateId?: string;
  prompt: string;
  workspaceDir: string;
  priority: number;
  status: QueueItemStatus;
  sessionId?: string;
  duration?: number;
  cost?: number;
  tokens?: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

// === Aggregates ===

export interface FleetSummary {
  activeSessions: number;
  idleSessions: number;
  totalTokens: number;
  totalCost: number;
  queuedTasks: number;
}
