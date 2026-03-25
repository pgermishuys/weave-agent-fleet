/**
 * Tests for repository-scanner.ts helpers:
 *   - parseGitHubUrl
 *   - findReadme
 *   - scanWorkspaceRoots
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("@/lib/server/process-manager", () => ({
  getAllowedRoots: vi.fn(() => []),
}));

import { getAllowedRoots } from "@/lib/server/process-manager";
import { parseGitHubUrl, findReadme, scanWorkspaceRoots } from "@/lib/server/repository-scanner";

const mockGetAllowedRoots = vi.mocked(getAllowedRoots);

// ─── parseGitHubUrl ──────────────────────────────────────────────────────────

describe("parseGitHubUrl", () => {
  it("ParsesSshUrlWithDotGit", () => {
    const result = parseGitHubUrl("git@github.com:owner/repo.git");
    expect(result).not.toBeNull();
    expect(result!.owner).toBe("owner");
    expect(result!.repo).toBe("repo");
    expect(result!.repoUrl).toBe("https://github.com/owner/repo");
    expect(result!.issuesUrl).toBe("https://github.com/owner/repo/issues");
    expect(result!.pullsUrl).toBe("https://github.com/owner/repo/pulls");
  });

  it("ParsesSshUrlWithoutDotGit", () => {
    const result = parseGitHubUrl("git@github.com:owner/repo");
    expect(result).not.toBeNull();
    expect(result!.owner).toBe("owner");
    expect(result!.repo).toBe("repo");
  });

  it("ParsesHttpsUrlWithDotGit", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo.git");
    expect(result).not.toBeNull();
    expect(result!.owner).toBe("owner");
    expect(result!.repo).toBe("repo");
    expect(result!.repoUrl).toBe("https://github.com/owner/repo");
  });

  it("ParsesHttpsUrlWithoutDotGit", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo");
    expect(result).not.toBeNull();
    expect(result!.owner).toBe("owner");
    expect(result!.repo).toBe("repo");
  });

  it("ParsesHttpUrlWithDotGit", () => {
    const result = parseGitHubUrl("http://github.com/owner/repo.git");
    expect(result).not.toBeNull();
    expect(result!.owner).toBe("owner");
    expect(result!.repo).toBe("repo");
  });

  it("ReturnsNullForNonGitHubSshUrl", () => {
    expect(parseGitHubUrl("git@gitlab.com:owner/repo.git")).toBeNull();
  });

  it("ReturnsNullForNonGitHubHttpsUrl", () => {
    expect(parseGitHubUrl("https://gitlab.com/owner/repo.git")).toBeNull();
  });

  it("ReturnsNullForMalformedUrl", () => {
    expect(parseGitHubUrl("not-a-url")).toBeNull();
  });

  it("ReturnsNullForEmptyString", () => {
    expect(parseGitHubUrl("")).toBeNull();
  });
});

// ─── findReadme ──────────────────────────────────────────────────────────────

describe("findReadme", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("FindsReadmeMdFile", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "readme-test-"));
    writeFileSync(join(tmpDir, "README.md"), "# Hello World");

    const result = findReadme(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.filename).toBe("README.md");
    expect(result!.content).toBe("# Hello World");
  });

  it("FindsReadmeMdUppercaseOrEquivalent", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "readme-test-"));
    writeFileSync(join(tmpDir, "README.MD"), "# Uppercase");

    const result = findReadme(tmpDir);
    expect(result).not.toBeNull();
    // On case-insensitive filesystems (Windows/macOS), README.md may match README.MD
    expect(["README.MD", "README.md"]).toContain(result!.filename);
    expect(result!.content).toBe("# Uppercase");
  });

  it("ReturnsNullWhenNoReadmeExists", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "readme-test-"));

    const result = findReadme(tmpDir);
    expect(result).toBeNull();
  });

  it("PrefersReadmeMdOverReadme", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "readme-test-"));
    writeFileSync(join(tmpDir, "README.md"), "# Markdown");
    writeFileSync(join(tmpDir, "README"), "Plain text");

    const result = findReadme(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.filename).toBe("README.md");
    expect(result!.content).toBe("# Markdown");
  });
});

// ─── scanWorkspaceRoots ───────────────────────────────────────────────────────

describe("scanWorkspaceRoots", () => {
  let tmpRoot: string;

  afterEach(() => {
    if (tmpRoot) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
    // Reset to a non-matching path so the weave-root exclusion doesn't interfere
    delete process.env.WEAVE_WORKSPACE_ROOT;
    mockGetAllowedRoots.mockReturnValue([]);
  });

  it("IncludesDirectoryWithDotGitDirectory", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "scanner-test-"));
    process.env.WEAVE_WORKSPACE_ROOT = join(tmpdir(), "nonexistent-weave-root");

    const repoDir = join(tmpRoot, "my-repo");
    mkdirSync(join(repoDir, ".git"), { recursive: true });
    mockGetAllowedRoots.mockReturnValue([tmpRoot]);

    const results = scanWorkspaceRoots();

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("my-repo");
    expect(results[0].path).toBe(repoDir);
    expect(results[0].parentRoot).toBe(tmpRoot);
  });

  it("ExcludesDirectoryWithDotGitFile", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "scanner-test-"));
    process.env.WEAVE_WORKSPACE_ROOT = join(tmpdir(), "nonexistent-weave-root");

    const worktreeDir = join(tmpRoot, "my-worktree");
    mkdirSync(worktreeDir, { recursive: true });
    writeFileSync(join(worktreeDir, ".git"), "gitdir: /some/path/.git/worktrees/my-worktree");
    mockGetAllowedRoots.mockReturnValue([tmpRoot]);

    const results = scanWorkspaceRoots();

    expect(results).toHaveLength(0);
  });

  it("ExcludesDirectoryWithNoDotGit", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "scanner-test-"));
    process.env.WEAVE_WORKSPACE_ROOT = join(tmpdir(), "nonexistent-weave-root");

    const plainDir = join(tmpRoot, "not-a-repo");
    mkdirSync(plainDir, { recursive: true });
    mockGetAllowedRoots.mockReturnValue([tmpRoot]);

    const results = scanWorkspaceRoots();

    expect(results).toHaveLength(0);
  });

  it("SkipsNonDirectoryEntries", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "scanner-test-"));
    process.env.WEAVE_WORKSPACE_ROOT = join(tmpdir(), "nonexistent-weave-root");

    writeFileSync(join(tmpRoot, "some-file.txt"), "not a directory");
    mockGetAllowedRoots.mockReturnValue([tmpRoot]);

    const results = scanWorkspaceRoots();

    expect(results).toHaveLength(0);
  });
});
