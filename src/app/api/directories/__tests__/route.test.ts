import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/server/process-manager", () => ({
  getAllowedRoots: vi.fn(() => ["/home/user"]),
  validateDirectory: vi.fn((dir: string) => dir),
  _recoveryComplete: Promise.resolve(),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  const mocked = {
    ...actual,
    readdirSync: vi.fn(() => []),
    existsSync: vi.fn(() => true),
    statSync: vi.fn(() => ({ isDirectory: () => true })),
    realpathSync: vi.fn((p: string) => p),
  };
  return { ...mocked, default: mocked };
});

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { GET } from "@/app/api/directories/route";
import * as processManager from "@/lib/server/process-manager";
import * as fs from "fs";

// ─── Typed mock helpers ───────────────────────────────────────────────────────

const mockGetAllowedRoots = vi.mocked(processManager.getAllowedRoots);
const mockValidateDirectory = vi.mocked(processManager.validateDirectory);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockReaddirSync = vi.mocked(fs.readdirSync) as any;
const mockExistsSync = vi.mocked(fs.existsSync);
const mockStatSync = vi.mocked(fs.statSync);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRealpathSync = vi.mocked(fs.realpathSync) as any;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"));
}

function makeDirent(
  name: string,
  isDirectory: boolean,
  isSymbolicLink = false
): fs.Dirent {
  return {
    name,
    isDirectory: () => isDirectory,
    isFile: () => !isDirectory,
    isSymbolicLink: () => isSymbolicLink,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    parentPath: "/test",
    path: "/test",
  } as fs.Dirent;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/directories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllowedRoots.mockReturnValue(["/home/user"]);
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({
      isDirectory: () => true,
    } as fs.Stats);
    mockRealpathSync.mockImplementation((p: string) => p);
  });

  describe("when no path param is provided", () => {
    it("returns allowed roots as entries", async () => {
      mockGetAllowedRoots.mockReturnValue(["/home/user", "/projects"]);

      const res = await GET(makeRequest("/api/directories"));
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.roots).toEqual(["/home/user", "/projects"]);
      expect(data.entries).toHaveLength(2);
      expect(data.entries[0].path).toBe("/home/user");
      expect(data.entries[1].path).toBe("/projects");
      expect(data.currentPath).toBe("/");
      expect(data.parentPath).toBeNull();
    });

    it("filters roots by search param", async () => {
      mockGetAllowedRoots.mockReturnValue(["/home/user", "/projects"]);

      const res = await GET(makeRequest("/api/directories?search=proj"));
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.entries).toHaveLength(1);
      expect(data.entries[0].path).toBe("/projects");
    });

    it("skips roots that don't exist", async () => {
      mockGetAllowedRoots.mockReturnValue(["/home/user", "/nonexistent"]);
      mockExistsSync.mockImplementation(
        (p) => typeof p === "string" && !p.includes("nonexistent")
      );

      const res = await GET(makeRequest("/api/directories"));
      const data = await res.json();
      expect(data.entries).toHaveLength(1);
      expect(data.entries[0].path).toBe("/home/user");
    });
  });

  describe("when path param is provided", () => {
    it("returns subdirectories for a valid path", async () => {
      mockReaddirSync.mockReturnValue([
        makeDirent("project-a", true),
        makeDirent("project-b", true),
        makeDirent("readme.md", false),
      ]);

      const res = await GET(
        makeRequest("/api/directories?path=/home/user")
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.entries).toHaveLength(2);
      expect(data.entries[0].name).toBe("project-a");
      expect(data.entries[1].name).toBe("project-b");
      expect(data.currentPath).toBe("/home/user");
    });

    it("filters noise directories", async () => {
      mockReaddirSync.mockReturnValue([
        makeDirent("src", true),
        makeDirent("node_modules", true),
        makeDirent(".git", true),
        makeDirent(".next", true),
        makeDirent("dist", true),
        makeDirent("build", true),
        makeDirent("actual-dir", true),
      ]);

      const res = await GET(
        makeRequest("/api/directories?path=/home/user")
      );
      const data = await res.json();
      // Only src and actual-dir should remain (others are noise or hidden)
      expect(data.entries).toHaveLength(2);
      expect(data.entries.map((e: { name: string }) => e.name)).toEqual([
        "actual-dir",
        "src",
      ]);
    });

    it("applies search filter", async () => {
      mockReaddirSync.mockReturnValue([
        makeDirent("my-app", true),
        makeDirent("my-lib", true),
        makeDirent("other", true),
      ]);

      const res = await GET(
        makeRequest("/api/directories?path=/home/user&search=my")
      );
      const data = await res.json();
      expect(data.entries).toHaveLength(2);
      expect(data.entries.map((e: { name: string }) => e.name)).toEqual([
        "my-app",
        "my-lib",
      ]);
    });

    it("sets isGitRepo correctly", async () => {
      mockReaddirSync.mockReturnValue([
        makeDirent("git-project", true),
        makeDirent("plain-dir", true),
      ]);

      mockExistsSync.mockImplementation((p) => {
        if (typeof p === "string" && p.endsWith("git-project/.git"))
          return true;
        if (typeof p === "string" && p.endsWith("plain-dir/.git"))
          return false;
        return true;
      });

      const res = await GET(
        makeRequest("/api/directories?path=/home/user")
      );
      const data = await res.json();
      expect(data.entries[0].name).toBe("git-project");
      expect(data.entries[0].isGitRepo).toBe(true);
      expect(data.entries[1].name).toBe("plain-dir");
      expect(data.entries[1].isGitRepo).toBe(false);
    });

    it("returns parentPath: null when listing an allowed root", async () => {
      mockReaddirSync.mockReturnValue([
        makeDirent("sub", true),
      ]);

      const res = await GET(
        makeRequest("/api/directories?path=/home/user")
      );
      const data = await res.json();
      expect(data.parentPath).toBeNull();
    });

    it("returns correct parentPath for nested directories", async () => {
      mockReaddirSync.mockReturnValue([
        makeDirent("deep", true),
      ]);

      const res = await GET(
        makeRequest("/api/directories?path=/home/user/projects")
      );
      const data = await res.json();
      expect(data.parentPath).toBe("/home/user");
    });

    it("caps results at 100 entries", async () => {
      const dirents = Array.from({ length: 150 }, (_, i) =>
        makeDirent(`dir-${String(i).padStart(3, "0")}`, true)
      );
      mockReaddirSync.mockReturnValue(dirents);

      const res = await GET(
        makeRequest("/api/directories?path=/home/user")
      );
      const data = await res.json();
      expect(data.entries.length).toBeLessThanOrEqual(100);
    });
  });

  describe("error handling", () => {
    it("returns 400 for path outside allowed roots", async () => {
      mockValidateDirectory.mockImplementation(() => {
        throw new Error("Directory is outside the allowed workspace roots");
      });

      const res = await GET(
        makeRequest("/api/directories?path=/etc/secret")
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("outside");
    });

    it("returns 404 for nonexistent path", async () => {
      mockValidateDirectory.mockImplementation(() => {
        throw new Error("Directory does not exist");
      });

      const res = await GET(
        makeRequest("/api/directories?path=/home/user/nope")
      );
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("does not exist");
    });

    it("returns 400 for path that is not a directory", async () => {
      mockValidateDirectory.mockImplementation(() => {
        throw new Error("Path exists but is not a directory");
      });

      const res = await GET(
        makeRequest("/api/directories?path=/home/user/file.txt")
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("not a directory");
    });

    it("returns 403 for permission denied", async () => {
      mockValidateDirectory.mockImplementation((dir: string) => dir);
      const eacces = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
      eacces.code = "EACCES";
      mockReaddirSync.mockImplementation(() => {
        throw eacces;
      });

      const res = await GET(
        makeRequest("/api/directories?path=/home/user/restricted")
      );
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Permission denied");
    });

    it("returns 500 for unexpected errors", async () => {
      mockValidateDirectory.mockImplementation((dir: string) => dir);
      mockReaddirSync.mockImplementation(() => {
        throw new Error("Unexpected filesystem error");
      });

      const res = await GET(
        makeRequest("/api/directories?path=/home/user")
      );
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe("Failed to list directories");
    });
  });

  describe("sorting", () => {
    it("returns entries sorted alphabetically by name", async () => {
      mockReaddirSync.mockReturnValue([
        makeDirent("zeta", true),
        makeDirent("alpha", true),
        makeDirent("middle", true),
      ]);

      const res = await GET(
        makeRequest("/api/directories?path=/home/user")
      );
      const data = await res.json();
      expect(data.entries.map((e: { name: string }) => e.name)).toEqual([
        "alpha",
        "middle",
        "zeta",
      ]);
    });
  });

  describe("symlink security", () => {
    it("rejects path that resolves via symlink to outside allowed roots", async () => {
      // The textual path passes validateDirectory, but realpath resolves elsewhere
      mockRealpathSync.mockReturnValue("/etc/secrets");

      const res = await GET(
        makeRequest("/api/directories?path=/home/user/symlink-to-etc")
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("outside the allowed workspace roots");
    });

    it("excludes symlink entries pointing outside allowed roots", async () => {
      mockReaddirSync.mockReturnValue([
        makeDirent("safe-dir", true),
        makeDirent("escape-link", false, true),
      ]);

      // realpathSync for the main path returns itself (under allowed root)
      // realpathSync for the symlink entry resolves to /etc
      mockRealpathSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.includes("escape-link")) return "/etc";
        return p as string;
      });
      mockStatSync.mockReturnValue({
        isDirectory: () => true,
      } as fs.Stats);

      const res = await GET(
        makeRequest("/api/directories?path=/home/user")
      );
      const data = await res.json();
      // Only the safe directory should be included
      expect(data.entries).toHaveLength(1);
      expect(data.entries[0].name).toBe("safe-dir");
    });

    it("includes symlink entries pointing within allowed roots", async () => {
      mockReaddirSync.mockReturnValue([
        makeDirent("real-dir", true),
        makeDirent("safe-link", false, true),
      ]);

      mockRealpathSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.includes("safe-link"))
          return "/home/user/other-project";
        return p as string;
      });
      mockStatSync.mockReturnValue({
        isDirectory: () => true,
      } as fs.Stats);

      const res = await GET(
        makeRequest("/api/directories?path=/home/user")
      );
      const data = await res.json();
      expect(data.entries).toHaveLength(2);
      expect(data.entries.map((e: { name: string }) => e.name)).toEqual([
        "real-dir",
        "safe-link",
      ]);
    });
  });

  describe("hidden directories", () => {
    it("filters directories starting with dot", async () => {
      mockReaddirSync.mockReturnValue([
        makeDirent("visible", true),
        makeDirent(".hidden", true),
        makeDirent(".ssh", true),
        makeDirent(".config", true),
      ]);

      const res = await GET(
        makeRequest("/api/directories?path=/home/user")
      );
      const data = await res.json();
      expect(data.entries).toHaveLength(1);
      expect(data.entries[0].name).toBe("visible");
    });
  });
});
