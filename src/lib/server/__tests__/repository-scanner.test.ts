/**
 * Tests for repository-scanner.ts helpers:
 *   - parseGitHubUrl
 *   - findReadme
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { parseGitHubUrl, findReadme } from "@/lib/server/repository-scanner";

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
