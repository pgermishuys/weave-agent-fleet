/**
 * Server-side repository scanner.
 *
 * Scans all configured workspace roots for immediate-child git repositories.
 * Results are cached in memory until explicitly invalidated via `invalidateCache()`.
 */

import { execSync } from "child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  type Dirent,
} from "fs";
import { homedir } from "os";
import { isAbsolute, join, resolve, sep } from "path";
import { getAllowedRoots } from "@/lib/server/process-manager";
import type {
  BranchInfo,
  CommitInfo,
  GitHubRemoteInfo,
  RemoteInfo,
  RepositoryDetail,
  RepositoryInfo,
  ScannedRepository,
  RepositoryScanResponse,
  TagInfo,
} from "@/lib/api-types";

// ─── Cache ────────────────────────────────────────────────────────────────────

let cachedResult: RepositoryScanResponse | null = null;

export function invalidateCache(): void {
  cachedResult = null;
}

// ─── Weave workspace root (excluded from scanning) ───────────────────────────

function getWeaveWorkspaceRoot(): string {
  return process.env.WEAVE_WORKSPACE_ROOT
    ? resolve(process.env.WEAVE_WORKSPACE_ROOT)
    : resolve(homedir(), ".weave", "workspaces");
}

// ─── Scanning ────────────────────────────────────────────────────────────────

/**
 * Scan all configured workspace roots for immediate-child git repositories.
 * A directory is considered a git repo if it contains a `.git` entry.
 */
export function scanWorkspaceRoots(): ScannedRepository[] {
  const roots = getAllowedRoots();
  const weaveWsRoot = getWeaveWorkspaceRoot();
  const results: ScannedRepository[] = [];

  for (const root of roots) {
    // Exclude the ephemeral weave workspaces directory
    if (resolve(root) === weaveWsRoot) continue;

    if (!existsSync(root)) continue;

    let entries: Dirent<string>[];
    try {
      entries = readdirSync(root, { withFileTypes: true, encoding: "utf8" });
    } catch {
      // Permission denied or other filesystem error — skip this root
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const fullPath = join(root, entry.name);
      const gitPath = join(fullPath, ".git");

      try {
        if (existsSync(gitPath)) {
          results.push({
            name: entry.name,
            path: fullPath,
            parentRoot: root,
          });
        }
      } catch {
        // Skip entries that error during stat
      }
    }
  }

  return results;
}

/**
 * Return cached scan result, or perform a fresh scan and cache the result.
 */
export function getCachedOrScan(): RepositoryScanResponse {
  if (cachedResult !== null) return cachedResult;

  const repositories = scanWorkspaceRoots();
  cachedResult = { repositories, scannedAt: Date.now() };
  return cachedResult;
}

// ─── Repository Info ──────────────────────────────────────────────────────────

/** Shared options for all git execSync calls — prevents hung processes and huge output. */
const GIT_EXEC_OPTIONS = {
  encoding: "utf8" as const,
  stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"],
  timeout: 5_000,
  maxBuffer: 1024 * 1024,
};

/**
 * Retrieve git metadata for a single validated repository path.
 * The caller must ensure the path is under an allowed root before calling this.
 */
export function getRepositoryInfo(repoPath: string): RepositoryInfo {
  const name = repoPath.split(/[\\/]/).filter(Boolean).at(-1) ?? repoPath;

  // Current branch
  let branch: string | null = null;
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", {
      ...GIT_EXEC_OPTIONS,
      cwd: repoPath,
    }).trim();
    if (branch === "HEAD") branch = null; // detached HEAD
  } catch {
    branch = null;
  }

  // Last commit
  let lastCommit: RepositoryInfo["lastCommit"] = null;
  try {
    const raw = execSync("git log -1 --format=%H%x1F%s%x1F%an%x1F%aI", {
      ...GIT_EXEC_OPTIONS,
      cwd: repoPath,
    }).trim();
    if (raw) {
      const [hash, message, author, date] = raw.split("\x1F");
      lastCommit = { hash: hash ?? "", message: message ?? "", author: author ?? "", date: date ?? "" };
    }
  } catch {
    lastCommit = null;
  }

  // Remotes
  const remotes: Array<{ name: string; url: string }> = [];
  try {
    const raw = execSync("git remote -v", {
      ...GIT_EXEC_OPTIONS,
      cwd: repoPath,
    }).trim();
    const seen = new Set<string>();
    for (const line of raw.split("\n")) {
      const match = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/);
      if (match && !seen.has(match[1])) {
        seen.add(match[1]);
        remotes.push({ name: match[1], url: match[2] });
      }
    }
  } catch {
    // No remotes or git error — leave remotes empty
  }

  return { name, path: repoPath, branch, lastCommit, remotes };
}

// ─── Repository Detail ────────────────────────────────────────────────────────

/**
 * Parse a git remote URL and extract GitHub owner/repo if it is a GitHub URL.
 * Handles SSH (`git@github.com:owner/repo.git`) and HTTPS formats.
 * Exported for unit testing.
 */
export function parseGitHubUrl(url: string): GitHubRemoteInfo | null {
  const sshMatch = url.match(/^git@github\.com:([^/]+)\/([^/.]+?)(?:\.git)?$/);
  const httpsMatch = url.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?$/
  );
  const match = sshMatch ?? httpsMatch;
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  if (!owner || !repo) return null;
  return {
    owner,
    repo,
    repoUrl: `https://github.com/${owner}/${repo}`,
    issuesUrl: `https://github.com/${owner}/${repo}/issues`,
    pullsUrl: `https://github.com/${owner}/${repo}/pulls`,
  };
}

/** README filenames to search for, in priority order. */
const README_CANDIDATES = [
  "README.md",
  "README.MD",
  "readme.md",
  "Readme.md",
  "README",
  "README.txt",
];

/** Maximum README size returned (50 KB) — prevents huge files bloating the response. */
const README_MAX_CHARS = 50_000;

/**
 * Find and read the README file in a repository root.
 * Exported for unit testing.
 */
export function findReadme(
  repoPath: string
): { content: string; filename: string } | null {
  for (const filename of README_CANDIDATES) {
    const fullPath = join(repoPath, filename);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, "utf8");
        return { content: content.slice(0, README_MAX_CHARS), filename };
      } catch {
        // Unreadable — try next candidate
      }
    }
  }
  return null;
}

/**
 * Gather full enriched git metadata for a single validated repository path.
 * Each git command is isolated in its own try/catch so partial failures
 * return sensible defaults rather than crashing the whole response.
 */
export function getRepositoryDetail(repoPath: string): RepositoryDetail {
  const name = repoPath.split(/[\\/]/).filter(Boolean).at(-1) ?? repoPath;
  const opts = { ...GIT_EXEC_OPTIONS, cwd: repoPath };

  // ── Current branch ──────────────────────────────────────────────────────────
  let branch: string | null = null;
  try {
    const raw = execSync("git rev-parse --abbrev-ref HEAD", opts).trim();
    branch = raw === "HEAD" ? null : raw;
  } catch { /* no commits or not a git repo */ }

  // ── Uncommitted file count ───────────────────────────────────────────────────
  let uncommittedCount = 0;
  try {
    const raw = execSync("git status --porcelain", opts).trim();
    uncommittedCount = raw ? raw.split("\n").filter(Boolean).length : 0;
  } catch { /* default 0 */ }

  // ── Total commit count ───────────────────────────────────────────────────────
  let totalCommitCount = 0;
  try {
    const raw = execSync("git rev-list --count HEAD", opts).trim();
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed)) totalCommitCount = parsed;
  } catch { /* default 0 */ }

  // ── First commit date ────────────────────────────────────────────────────────
  let firstCommitDate: string | null = null;
  try {
    const raw = execSync("git log --reverse --format=%aI -1", opts).trim();
    if (raw) firstCommitDate = raw;
  } catch { /* default null */ }

  // ── Last commit date ─────────────────────────────────────────────────────────
  let lastCommitDate: string | null = null;
  try {
    const raw = execSync("git log -1 --format=%aI", opts).trim();
    if (raw) lastCommitDate = raw;
  } catch { /* default null */ }

  // ── Branches ─────────────────────────────────────────────────────────────────
  const branches: BranchInfo[] = [];
  try {
    const raw = execSync(
      "git branch -a --sort=-committerdate --format=%(refname:short)%x1F%(objectname:short)%x1F%(subject)%x1F%(authorname)%x1F%(authoremail)%x1F%(committerdate:iso)",
      opts
    ).trim();
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const [branchName, shortHash, message, author, authorEmail, date] =
        line.split("\x1F");
      if (!branchName) continue;
      // Filter out symbolic HEAD references like "origin/HEAD -> origin/main"
      if (branchName.includes(" -> ")) continue;
      const isRemote =
        branchName.startsWith("origin/") || branchName.startsWith("remotes/");
      branches.push({
        name: branchName,
        shortHash: shortHash ?? "",
        message: message ?? "",
        author: author ?? "",
        authorEmail: authorEmail ?? "",
        date: date ?? "",
        isCurrent: branchName === branch,
        isRemote,
      });
    }
  } catch { /* default [] */ }

  // ── Tags ─────────────────────────────────────────────────────────────────────
  const tags: TagInfo[] = [];
  try {
    const raw = execSync(
      "git tag --sort=-creatordate --format=%(refname:short)%x1F%(objectname:short)%x1F%(creatordate:iso)%x1F%(taggername)%x1F%(taggeremail)",
      opts
    ).trim();
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const [tagName, shortHash, date, tagger, taggerEmail] =
        line.split("\x1F");
      if (!tagName) continue;
      tags.push({
        name: tagName,
        shortHash: shortHash ?? "",
        date: date ?? "",
        tagger: tagger ?? "",
        taggerEmail: taggerEmail ?? "",
      });
    }
  } catch { /* default [] */ }

  // ── Recent commits ───────────────────────────────────────────────────────────
  const recentCommits: CommitInfo[] = [];
  try {
    const raw = execSync(
      "git log -10 --format=%H%x1F%h%x1F%s%x1F%an%x1F%ae%x1F%aI",
      opts
    ).trim();
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const [hash, shortHash, message, author, authorEmail, date] =
        line.split("\x1F");
      if (!hash) continue;
      recentCommits.push({
        hash: hash,
        shortHash: shortHash ?? "",
        message: message ?? "",
        author: author ?? "",
        authorEmail: authorEmail ?? "",
        date: date ?? "",
      });
    }
  } catch { /* default [] */ }

  // ── Remotes with GitHub detection ────────────────────────────────────────────
  const remotes: RemoteInfo[] = [];
  try {
    const raw = execSync("git remote -v", opts).trim();
    const seen = new Set<string>();
    for (const line of raw.split("\n")) {
      const match = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/);
      if (match && !seen.has(match[1])) {
        seen.add(match[1]);
        const remoteName = match[1];
        const url = match[2];
        remotes.push({
          name: remoteName,
          url,
          github: parseGitHubUrl(url),
        });
      }
    }
  } catch { /* default [] */ }

  // ── README ───────────────────────────────────────────────────────────────────
  const readme = findReadme(repoPath);

  return {
    name,
    path: repoPath,
    branch,
    uncommittedCount,
    totalCommitCount,
    firstCommitDate,
    lastCommitDate,
    branches,
    tags,
    recentCommits,
    remotes,
    readmeContent: readme?.content ?? null,
    readmeFilename: readme?.filename ?? null,
  };
}

// ─── Path validation ──────────────────────────────────────────────────────────

/**
 * Validate that a given path is an absolute path under an allowed workspace root
 * and that it actually exists as a directory. Returns the resolved path.
 * Throws with a user-facing message on failure.
 */
export function validateRepoPath(inputPath: string): string {
  if (!inputPath || !isAbsolute(inputPath)) {
    throw new Error("Path must be a non-empty absolute path.");
  }

  const resolvedPath = resolve(inputPath);
  const roots = getAllowedRoots();

  const underAllowedRoot = roots.some(
    (root) => resolvedPath === root || resolvedPath.startsWith(root + sep)
  );

  if (!underAllowedRoot) {
    throw new Error("Path is outside the allowed workspace roots.");
  }

  if (!existsSync(resolvedPath)) {
    throw new Error("Path does not exist.");
  }

  try {
    if (!statSync(resolvedPath).isDirectory()) {
      throw new Error("Path is not a directory.");
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith("Path is not")) throw err;
    throw new Error("Cannot access path.");
  }

  return resolvedPath;
}
