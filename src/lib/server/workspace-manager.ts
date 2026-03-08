/**
 * Workspace Manager — creates and manages isolated working directories for OpenCode sessions.
 *
 * Supports three isolation strategies:
 * - `existing`: use a user-specified directory as-is (no copy/clone)
 * - `worktree`: create a git worktree as a sibling of the source repo (same-repo parallelism)
 * - `clone`: shallow-clone a git repo into a new workspace directory (ephemeral)
 *
 * Worktree directories are placed alongside the source repo with the naming convention
 * `{repo-name}-{hyphenated-branch-name}` (e.g. `my-project-feature-auth`).
 * Clone workspaces are created under a configurable root directory
 * (WEAVE_WORKSPACE_ROOT env var, default ~/.weave/workspaces/).
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join, resolve } from "path";
import { randomUUID } from "crypto";
import {
  insertWorkspace,
  getWorkspace,
  getWorkspaceByDirectory,
  markWorkspaceCleaned,
  type DbWorkspace,
} from "./db-repository";

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
function isGitRepo(directory: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd: directory,
      stdio: "pipe",
    });
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
      if (!isGitRepo(sourceDirectory)) {
        throw new Error(
          `Source directory is not a git repository: ${sourceDirectory}`
        );
      }

      const branchName = branch ?? `weave-session-${id.slice(0, 8)}`;

      // Place worktree as a sibling of the source repo directory.
      // Naming: {repo-name}-{hyphenated-branch-name}
      // e.g. source "C:\repos\my-project" + branch "feature/auth" → "C:\repos\my-project-feature-auth"
      const repoName = basename(sourceDirectory);
      const hyphenatedBranch = branchName.replace(/[/\\]/g, "-");
      const worktreeDirName = `${repoName}-${hyphenatedBranch}`;
      const parentDir = dirname(sourceDirectory);
      const workspaceDir = join(parentDir, worktreeDirName);

      execFileSync(
        "git", ["worktree", "add", workspaceDir, "-b", branchName],
        { cwd: sourceDirectory, stdio: "pipe" }
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

      execFileSync(
        "git", ["clone", "--depth=1", sourceDirectory, workspaceDir],
        { stdio: "pipe" }
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
          execFileSync(
            "git", ["worktree", "remove", ws.directory, "--force"],
            { cwd: ws.source_directory, stdio: "pipe" }
          );
        } catch {
          // If git worktree remove fails, fall back to manual directory removal
          rmSync(ws.directory, { recursive: true, force: true });
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
