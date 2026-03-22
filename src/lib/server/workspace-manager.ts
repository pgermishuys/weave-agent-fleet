/**
 * Workspace Manager — creates and manages isolated working directories for OpenCode sessions.
 *
 * Supports three isolation strategies:
 * - `existing`: use a user-specified directory as-is (no copy/clone)
 * - `worktree`: create a git worktree under a dedicated sibling folder (same-repo parallelism)
 * - `clone`: shallow-clone a git repo into a new workspace directory (ephemeral)
 *
 * Worktree directories are placed under a dedicated sibling folder with the naming
 * convention `{repo-name}-worktrees/{hyphenated-branch-name}`
 * (e.g. `my-project-worktrees/feature-auth`).
 * Clone workspaces are created under a configurable root directory
 * (WEAVE_WORKSPACE_ROOT env var, default ~/.weave/workspaces/).
 */

import { execFile } from "child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join, resolve, sep } from "path";
import { randomUUID } from "crypto";
import { promisify } from "util";
import {
  insertWorkspace,
  getWorkspace,
  getWorkspaceByDirectory,
  markWorkspaceCleaned,
  type DbWorkspace,
} from "./db-repository";
import { withTimeout } from "./async-utils";

const execFileAsync = promisify(execFile);

export type IsolationStrategy = "existing" | "worktree" | "clone";

export interface CreateWorkspaceOpts {
  sourceDirectory: string;
  strategy: IsolationStrategy;
  branch?: string;
}

export interface WorkspaceInfo {
  id: string;
  directory: string;
  strategy: IsolationStrategy;
}

function getWorkspaceRoot(): string {
  if (process.env.WEAVE_WORKSPACE_ROOT) {
    return resolve(process.env.WEAVE_WORKSPACE_ROOT);
  }
  return resolve(homedir(), ".weave", "workspaces");
}

const DEFAULT_GIT_TIMEOUT_MS = 60_000;

function getGitTimeoutMs(): number {
  const envVal = parseInt(process.env.WEAVE_GIT_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(envVal) && envVal > 0 ? envVal : DEFAULT_GIT_TIMEOUT_MS;
}

/**
 * Run a git command asynchronously with a configurable timeout.
 * Uses `WEAVE_GIT_TIMEOUT_MS` env var (default 60,000ms).
 */
async function execGitAsync(
  args: string[],
  options: { cwd?: string } = {}
): Promise<{ stdout: string; stderr: string }> {
  const timeoutMs = getGitTimeoutMs();
  const command = `git ${args.join(" ")}`;
  try {
    return await withTimeout(
      execFileAsync("git", args, {
        ...options,
        timeout: timeoutMs,
      }),
      timeoutMs,
      command
    );
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("timed out")) {
      throw error;
    }
    const err = error as { stderr?: string; code?: number | string };
    const stderr = err.stderr ?? "";
    const code = err.code ?? "unknown";
    throw new Error(`git command failed: ${command} (exit code ${code}): ${stderr.trim()}`);
  }
}

/**
 * Validate that a path exists and is a directory.
 */
function assertDirectory(path: string, label: string): void {
  if (!existsSync(path)) {
    throw new Error(`${label} does not exist: ${path}`);
  }
  if (!statSync(path).isDirectory()) {
    throw new Error(`${label} is not a directory: ${path}`);
  }
}

/**
 * Check whether a directory is inside a git repository.
 */
async function isGitRepo(directory: string): Promise<boolean> {
  try {
    await execGitAsync(["rev-parse", "--git-dir"], { cwd: directory });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create an isolated workspace directory based on the chosen strategy.
 * Persists the workspace record to the database.
 *
 * @returns WorkspaceInfo with the id and the resolved working directory path
 */
export async function createWorkspace(
  opts: CreateWorkspaceOpts
): Promise<WorkspaceInfo> {
  const { strategy, branch } = opts;
  const sourceDirectory = resolve(opts.sourceDirectory);

  assertDirectory(sourceDirectory, "Source directory");

  const id = randomUUID();

  switch (strategy) {
    case "existing": {
      // Reuse an existing workspace record for this directory if one exists,
      // so that all sessions targeting the same directory share a workspace.
      const existing = getWorkspaceByDirectory(sourceDirectory, "existing");
      if (existing) {
        return { id: existing.id, directory: existing.directory, strategy };
      }

      // No workspace for this directory yet — create one
      insertWorkspace({
        id,
        directory: sourceDirectory,
        isolation_strategy: "existing",
        source_directory: sourceDirectory,
      });
      return { id, directory: sourceDirectory, strategy };
    }

    case "worktree": {
      if (!(await isGitRepo(sourceDirectory))) {
        throw new Error(
          `Source directory is not a git repository: ${sourceDirectory}`
        );
      }

      const branchName = branch ?? `weave-session-${id.slice(0, 8)}`;

      // Place worktree under a dedicated sibling folder to avoid polluting the parent.
      // Naming: {repo-name}-worktrees/{hyphenated-branch-name}
      // e.g. source "C:\repos\my-project" + branch "feature/auth"
      //   → "C:\repos\my-project-worktrees\feature-auth"
      const repoName = basename(sourceDirectory);
      const hyphenatedBranch = branchName.replace(/[/\\]/g, "-");
      const parentDir = resolve(dirname(sourceDirectory));
      const worktreesRoot = join(parentDir, `${repoName}-worktrees`);
      const workspaceDir = join(worktreesRoot, hyphenatedBranch);

      // Guard against path traversal — both paths must stay under the parent directory
      const resolvedWorktreesRoot = resolve(worktreesRoot);
      const resolvedWorkspaceDir = resolve(workspaceDir);
      if (!resolvedWorktreesRoot.startsWith(parentDir + sep)) {
        throw new Error(`Worktree root escapes parent directory: ${resolvedWorktreesRoot}`);
      }
      if (!resolvedWorkspaceDir.startsWith(resolvedWorktreesRoot + sep)) {
        throw new Error(`Invalid branch name results in path outside worktree root: ${branchName}`);
      }

      mkdirSync(worktreesRoot, { recursive: true });

      await execGitAsync(
        ["worktree", "add", workspaceDir, "-b", branchName],
        { cwd: sourceDirectory }
      );

      insertWorkspace({
        id,
        directory: workspaceDir,
        isolation_strategy: "worktree",
        source_directory: sourceDirectory,
        branch: branchName,
      });

      return { id, directory: workspaceDir, strategy };
    }

    case "clone": {
      const workspaceRoot = getWorkspaceRoot();
      mkdirSync(workspaceRoot, { recursive: true });

      const workspaceDir = join(workspaceRoot, id);

      await execGitAsync(
        ["clone", "--depth=1", sourceDirectory, workspaceDir],
        {}
      );

      insertWorkspace({
        id,
        directory: workspaceDir,
        isolation_strategy: "clone",
        source_directory: sourceDirectory,
        branch: branch ?? null,
      });

      return { id, directory: workspaceDir, strategy };
    }
  }
}

/**
 * Clean up a workspace based on its isolation strategy.
 * - `existing`: no-op (never delete the user's real directory)
 * - `worktree`: remove the git worktree and update DB
 * - `clone`: delete the directory and update DB
 */
export async function cleanupWorkspace(id: string): Promise<void> {
  const ws = getWorkspace(id) as DbWorkspace | undefined;
  if (!ws) {
    throw new Error(`Workspace not found: ${id}`);
  }

  if (ws.cleaned_up_at) {
    // Already cleaned up — idempotent
    return;
  }

  switch (ws.isolation_strategy) {
    case "existing":
      // Never delete the user's actual directory
      markWorkspaceCleaned(id);
      return;

    case "worktree": {
      if (ws.source_directory && existsSync(ws.directory)) {
        try {
          await execGitAsync(
            ["worktree", "remove", ws.directory, "--force"],
            { cwd: ws.source_directory }
          );
        } catch {
          // If git worktree remove fails, fall back to manual directory removal
          rmSync(ws.directory, { recursive: true, force: true });
        }

        // Remove the -worktrees parent folder if it is now empty
        const worktreesRoot = dirname(ws.directory);
        if (
          existsSync(worktreesRoot) &&
          worktreesRoot.endsWith("-worktrees") &&
          readdirSync(worktreesRoot).length === 0
        ) {
          rmSync(worktreesRoot, { recursive: true, force: true });
        }
      }
      markWorkspaceCleaned(id);
      return;
    }

    case "clone": {
      if (existsSync(ws.directory)) {
        rmSync(ws.directory, { recursive: true, force: true });
      }
      markWorkspaceCleaned(id);
      return;
    }
  }
}

/**
 * Returns the resolved working directory for a workspace.
 */
export function getWorkspaceDirectory(id: string): string {
  const ws = getWorkspace(id) as DbWorkspace | undefined;
  if (!ws) {
    throw new Error(`Workspace not found: ${id}`);
  }
  return ws.directory;
}
