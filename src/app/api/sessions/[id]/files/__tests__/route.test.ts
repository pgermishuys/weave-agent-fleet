import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { mkdtemp, rm, writeFile, mkdir, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/server/opencode-client", () => ({
  ensureInstanceForSession: vi.fn(),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET as listGET } from "@/app/api/sessions/[id]/files/route";
import {
  GET as readGET,
  POST as writeGET,
  DELETE as deleteHandler,
  PATCH as patchHandler,
} from "@/app/api/sessions/[id]/files/[...path]/route";
import { ensureInstanceForSession } from "@/lib/server/opencode-client";

const mockEnsureInstanceForSession = vi.mocked(ensureInstanceForSession);

// ─── Real temp workspace ───────────────────────────────────────────────────────

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "files-route-test-"));
  mockEnsureInstanceForSession.mockResolvedValue({ instance: { directory: tmpRoot } as never, client: {} as never });
});

afterEach(async () => {
  vi.clearAllMocks();
  await rm(tmpRoot, { recursive: true, force: true });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeListRequest(instanceId?: string) {
  const url = instanceId
    ? `http://localhost/api/sessions/sess-1/files?instanceId=${instanceId}`
    : `http://localhost/api/sessions/sess-1/files`;
  return new NextRequest(url, { method: "GET" });
}

function makeReadRequest(filePath: string, instanceId?: string) {
  const url = instanceId
    ? `http://localhost/api/sessions/sess-1/files/${filePath}?instanceId=${instanceId}`
    : `http://localhost/api/sessions/sess-1/files/${filePath}`;
  return new NextRequest(url, { method: "GET" });
}

function makeWriteRequest(filePath: string, instanceId: string, content: string) {
  const url = `http://localhost/api/sessions/sess-1/files/${filePath}?instanceId=${instanceId}`;
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify({ content }),
    headers: { "Content-Type": "application/json" },
  });
}

function makeListContext(id = "sess-1") {
  return { params: Promise.resolve({ id }) };
}

function makeFileContext(id = "sess-1", path: string[] = []) {
  return { params: Promise.resolve({ id, path }) };
}

// ─── File listing route (GET /api/sessions/[id]/files) ─────────────────────────

describe("GET /api/sessions/[id]/files — file listing", () => {
  it("Returns400WhenInstanceIdIsMissing", async () => {
    const res = await listGET(makeListRequest(), makeListContext());
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/instanceId/i);
  });

  it("Returns404WhenInstanceNotFound", async () => {
    mockEnsureInstanceForSession.mockRejectedValue(new Error("Instance not found"));
    const res = await listGET(makeListRequest("inst-x"), makeListContext());
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error).toMatch(/instance not found/i);
  });

  it("Returns200WithFileListOnSuccess", async () => {
    // Create a real directory structure
    await mkdir(join(tmpRoot, "src"));
    await writeFile(join(tmpRoot, "src", "index.ts"), "export {}");
    await writeFile(join(tmpRoot, "README.md"), "# Readme");

    const res = await listGET(makeListRequest("inst-1"), makeListContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.root).toBe(tmpRoot);
    expect(body.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "src", type: "directory" }),
        expect.objectContaining({ path: "README.md", type: "file" }),
        expect.objectContaining({ path: "src/index.ts", type: "file" }),
      ])
    );
  });

  it("ExcludesNodeModulesDirectory", async () => {
    await mkdir(join(tmpRoot, "node_modules"));
    await mkdir(join(tmpRoot, "src"));
    await writeFile(join(tmpRoot, "src", "app.ts"), "content");

    const res = await listGET(makeListRequest("inst-1"), makeListContext());
    const body = await res.json();

    const paths = body.files.map((f: { path: string }) => f.path);
    expect(paths).not.toContain("node_modules");
    expect(paths).toContain("src");
  });

  it("ExcludesGitDirectory", async () => {
    await mkdir(join(tmpRoot, ".git"));
    await writeFile(join(tmpRoot, "package.json"), "{}");

    const res = await listGET(makeListRequest("inst-1"), makeListContext());
    const body = await res.json();

    const paths = body.files.map((f: { path: string }) => f.path);
    expect(paths).not.toContain(".git");
    expect(paths).toContain("package.json");
  });

  it("ReturnsEmptyListWhenDirectoryIsEmpty", async () => {
    const res = await listGET(makeListRequest("inst-1"), makeListContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.files).toEqual([]);
  });
});

// ─── File read route (GET /api/sessions/[id]/files/[...path]) ─────────────────

describe("GET /api/sessions/[id]/files/[...path] — file read", () => {
  it("Returns400WhenInstanceIdIsMissing", async () => {
    const res = await readGET(
      makeReadRequest("src/index.ts"),
      makeFileContext("sess-1", ["src", "index.ts"])
    );
    expect(res.status).toBe(400);
  });

  it("Returns404WhenInstanceNotFound", async () => {
    mockEnsureInstanceForSession.mockRejectedValue(new Error("Instance not found"));
    const res = await readGET(
      makeReadRequest("src/index.ts", "inst-1"),
      makeFileContext("sess-1", ["src", "index.ts"])
    );
    expect(res.status).toBe(404);
  });

  it("Returns403WhenPathTraversalDetected", async () => {
    const res = await readGET(
      makeReadRequest("../../etc/passwd", "inst-1"),
      makeFileContext("sess-1", ["..", "..", "etc", "passwd"])
    );
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toMatch(/access denied/i);
  });

  it("Returns200WithFileContentForTextFile", async () => {
    await mkdir(join(tmpRoot, "src"));
    const content = "export const x = 1;";
    await writeFile(join(tmpRoot, "src", "index.ts"), content);

    const res = await readGET(
      makeReadRequest("src/index.ts", "inst-1"),
      makeFileContext("sess-1", ["src", "index.ts"])
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.content).toBe(content);
    expect(body.isBinary).toBe(false);
    expect(body.language).toBe("typescript");
  });

  it("Returns200WithBinaryFlagForBinaryFile", async () => {
    // Write a file with null bytes (binary detection)
    const binaryBuf = Buffer.alloc(100);
    binaryBuf[10] = 0x00;
    const { writeFile: writeFileFn } = await import("fs/promises");
    await writeFileFn(join(tmpRoot, "image.dat"), binaryBuf);

    const res = await readGET(
      makeReadRequest("image.dat", "inst-1"),
      makeFileContext("sess-1", ["image.dat"])
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isBinary).toBe(true);
    expect(body.content).toBeNull();
  });

  it("Returns200WithBase64ForPngImage", async () => {
    // Write a binary file with .png extension
    const pngBuf = Buffer.alloc(100);
    pngBuf[10] = 0x00;
    const { writeFile: writeFileFn } = await import("fs/promises");
    await writeFileFn(join(tmpRoot, "image.png"), pngBuf);

    const res = await readGET(
      makeReadRequest("image.png", "inst-1"),
      makeFileContext("sess-1", ["image.png"])
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isBinary).toBe(true);
    expect(body.isImage).toBe(true);
    expect(body.isSvg).toBe(false);
    expect(body.mime).toBe("image/png");
    expect(typeof body.content).toBe("string");
  });

  it("Returns200WithSvgAsText", async () => {
    const svgContent = "<svg><circle r='5'/></svg>";
    await writeFile(join(tmpRoot, "icon.svg"), svgContent);

    const res = await readGET(
      makeReadRequest("icon.svg", "inst-1"),
      makeFileContext("sess-1", ["icon.svg"])
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.content).toBe(svgContent);
    expect(body.language).toBeTruthy();
  });

  it("Returns404WhenFileNotFound", async () => {
    const res = await readGET(
      makeReadRequest("missing.ts", "inst-1"),
      makeFileContext("sess-1", ["missing.ts"])
    );
    expect(res.status).toBe(404);
  });
});

// ─── File write route (POST /api/sessions/[id]/files/[...path]) ───────────────

describe("POST /api/sessions/[id]/files/[...path] — file write", () => {
  it("Returns400WhenInstanceIdIsMissing", async () => {
    const req = new NextRequest("http://localhost/api/sessions/sess-1/files/src/new.ts", {
      method: "POST",
      body: JSON.stringify({ content: "hello" }),
    });
    const res = await writeGET(req, makeFileContext("sess-1", ["src", "new.ts"]));
    expect(res.status).toBe(400);
  });

  it("Returns404WhenInstanceNotFound", async () => {
    mockEnsureInstanceForSession.mockRejectedValue(new Error("Instance not found"));
    const req = makeWriteRequest("src/new.ts", "inst-1", "content");
    const res = await writeGET(req, makeFileContext("sess-1", ["src", "new.ts"]));
    expect(res.status).toBe(404);
  });

  it("Returns403WhenWritingToGitDirectory", async () => {
    const req = makeWriteRequest(".git/config", "inst-1", "malicious");
    const res = await writeGET(req, makeFileContext("sess-1", [".git", "config"]));
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toMatch(/cannot write to .git/i);
  });

  it("Returns403WhenPathTraversalDetected", async () => {
    const req = makeWriteRequest("../escape.ts", "inst-1", "content");
    const res = await writeGET(req, makeFileContext("sess-1", ["..", "escape.ts"]));
    expect(res.status).toBe(403);
  });

  it("Returns400WhenBodyIsInvalidJson", async () => {
    const req = new NextRequest(
      `http://localhost/api/sessions/sess-1/files/src/new.ts?instanceId=inst-1`,
      { method: "POST", body: "not-json", headers: { "Content-Type": "application/json" } }
    );
    const res = await writeGET(req, makeFileContext("sess-1", ["src", "new.ts"]));
    expect(res.status).toBe(400);
  });

  it("Returns400WhenContentIsNotString", async () => {
    const req = new NextRequest(
      `http://localhost/api/sessions/sess-1/files/src/new.ts?instanceId=inst-1`,
      {
        method: "POST",
        body: JSON.stringify({ content: 12345 }),
        headers: { "Content-Type": "application/json" },
      }
    );
    const res = await writeGET(req, makeFileContext("sess-1", ["src", "new.ts"]));
    expect(res.status).toBe(400);
  });

  it("Returns200AndWritesFileOnSuccess", async () => {
    const fileContent = "export const x = 42;";
    const req = makeWriteRequest("new-file.ts", "inst-1", fileContent);
    const res = await writeGET(req, makeFileContext("sess-1", ["new-file.ts"]));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.path).toBe("new-file.ts");

    // Verify the file was actually written
    const { readFile: readFileFn } = await import("fs/promises");
    const written = await readFileFn(join(tmpRoot, "new-file.ts"), "utf-8");
    expect(written).toBe(fileContent);
  });

  it("CreatesMissingParentDirectoriesBeforeWriting", async () => {
    const req = makeWriteRequest("deep/nested/file.ts", "inst-1", "content");
    const res = await writeGET(req, makeFileContext("sess-1", ["deep", "nested", "file.ts"]));

    expect(res.status).toBe(200);

    // Verify the nested file exists
    const { readFile: readFileFn } = await import("fs/promises");
    const written = await readFileFn(join(tmpRoot, "deep", "nested", "file.ts"), "utf-8");
    expect(written).toBe("content");
  });
});

// ─── POST directory creation ─────────────────────────────────────────────────

describe("POST /api/sessions/[id]/files/[...path] — directory creation", () => {
  function makeDirRequest(folderPath: string, instanceId: string) {
    const url = `http://localhost/api/sessions/sess-1/files/${folderPath}?instanceId=${instanceId}`;
    return new NextRequest(url, {
      method: "POST",
      body: JSON.stringify({ type: "directory" }),
      headers: { "Content-Type": "application/json" },
    });
  }

  it("Returns200AndCreatesFolderOnSuccess", async () => {
    const req = makeDirRequest("my-new-folder", "inst-1");
    const res = await writeGET(req, makeFileContext("sess-1", ["my-new-folder"]));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.type).toBe("directory");

    const s = await stat(join(tmpRoot, "my-new-folder"));
    expect(s.isDirectory()).toBe(true);
  });

  it("Returns200AndCreatesNestedFolders", async () => {
    const req = makeDirRequest("deep/nested/dir", "inst-1");
    const res = await writeGET(req, makeFileContext("sess-1", ["deep", "nested", "dir"]));

    expect(res.status).toBe(200);
    const s = await stat(join(tmpRoot, "deep", "nested", "dir"));
    expect(s.isDirectory()).toBe(true);
  });

  it("Returns403WhenCreatingGitDirectory", async () => {
    const req = makeDirRequest(".git", "inst-1");
    const res = await writeGET(req, makeFileContext("sess-1", [".git"]));
    expect(res.status).toBe(403);
  });
});

// ─── DELETE route ─────────────────────────────────────────────────────────────

describe("DELETE /api/sessions/[id]/files/[...path]", () => {
  function makeDeleteRequest(filePath: string, instanceId?: string) {
    const url = instanceId
      ? `http://localhost/api/sessions/sess-1/files/${filePath}?instanceId=${instanceId}`
      : `http://localhost/api/sessions/sess-1/files/${filePath}`;
    return new NextRequest(url, { method: "DELETE" });
  }

  it("Returns400WhenInstanceIdIsMissing", async () => {
    const res = await deleteHandler(
      makeDeleteRequest("file.ts"),
      makeFileContext("sess-1", ["file.ts"])
    );
    expect(res.status).toBe(400);
  });

  it("Returns404WhenInstanceNotFound", async () => {
    mockEnsureInstanceForSession.mockRejectedValue(new Error("Instance not found"));
    const res = await deleteHandler(
      makeDeleteRequest("file.ts", "inst-1"),
      makeFileContext("sess-1", ["file.ts"])
    );
    expect(res.status).toBe(404);
  });

  it("Returns403WhenDeletingGitDirectory", async () => {
    const res = await deleteHandler(
      makeDeleteRequest(".git", "inst-1"),
      makeFileContext("sess-1", [".git"])
    );
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toMatch(/\.git/i);
  });

  it("Returns403WhenDeletingInteriorGitSegment", async () => {
    const res = await deleteHandler(
      makeDeleteRequest("foo/.git/config", "inst-1"),
      makeFileContext("sess-1", ["foo", ".git", "config"])
    );
    expect(res.status).toBe(403);
  });

  it("Returns403WhenDeletingGitPathWithBackslashes", async () => {
    const res = await deleteHandler(
      makeDeleteRequest(".git\\config", "inst-1"),
      makeFileContext("sess-1", [".git\\config"])
    );
    expect(res.status).toBe(403);
  });

  it("Returns403WhenPathTraversalDetected", async () => {
    const res = await deleteHandler(
      makeDeleteRequest("../../etc/passwd", "inst-1"),
      makeFileContext("sess-1", ["..", "..", "etc", "passwd"])
    );
    expect(res.status).toBe(403);
  });

  it("Returns404WhenFileNotFound", async () => {
    const res = await deleteHandler(
      makeDeleteRequest("nonexistent.ts", "inst-1"),
      makeFileContext("sess-1", ["nonexistent.ts"])
    );
    expect(res.status).toBe(404);
  });

  it("Returns200AndDeletesFileOnSuccess", async () => {
    await writeFile(join(tmpRoot, "to-delete.ts"), "content");

    const res = await deleteHandler(
      makeDeleteRequest("to-delete.ts", "inst-1"),
      makeFileContext("sess-1", ["to-delete.ts"])
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    // File should no longer exist
    await expect(stat(join(tmpRoot, "to-delete.ts"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("Returns200AndDeletesDirectoryRecursively", async () => {
    await mkdir(join(tmpRoot, "to-delete-dir"));
    await writeFile(join(tmpRoot, "to-delete-dir", "inner.ts"), "x");

    const res = await deleteHandler(
      makeDeleteRequest("to-delete-dir", "inst-1"),
      makeFileContext("sess-1", ["to-delete-dir"])
    );
    expect(res.status).toBe(200);

    await expect(stat(join(tmpRoot, "to-delete-dir"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

// ─── PATCH route ──────────────────────────────────────────────────────────────

describe("PATCH /api/sessions/[id]/files/[...path]", () => {
  function makePatchRequest(filePath: string, instanceId: string, newPath: string) {
    const url = `http://localhost/api/sessions/sess-1/files/${filePath}?instanceId=${instanceId}`;
    return new NextRequest(url, {
      method: "PATCH",
      body: JSON.stringify({ newPath }),
      headers: { "Content-Type": "application/json" },
    });
  }

  it("Returns400WhenInstanceIdIsMissing", async () => {
    const url = `http://localhost/api/sessions/sess-1/files/old.ts`;
    const req = new NextRequest(url, {
      method: "PATCH",
      body: JSON.stringify({ newPath: "new.ts" }),
    });
    const res = await patchHandler(req, makeFileContext("sess-1", ["old.ts"]));
    expect(res.status).toBe(400);
  });

  it("Returns404WhenInstanceNotFound", async () => {
    mockEnsureInstanceForSession.mockRejectedValue(new Error("Instance not found"));
    const res = await patchHandler(
      makePatchRequest("old.ts", "inst-1", "new.ts"),
      makeFileContext("sess-1", ["old.ts"])
    );
    expect(res.status).toBe(404);
  });

  it("Returns403WhenSourceIsGitPath", async () => {
    const res = await patchHandler(
      makePatchRequest(".git/config", "inst-1", "safe.ts"),
      makeFileContext("sess-1", [".git", "config"])
    );
    expect(res.status).toBe(403);
  });

  it("Returns403WhenDestinationIsGitPath", async () => {
    await writeFile(join(tmpRoot, "safe.ts"), "x");
    const res = await patchHandler(
      makePatchRequest("safe.ts", "inst-1", ".git/injected"),
      makeFileContext("sess-1", ["safe.ts"])
    );
    expect(res.status).toBe(403);
  });

  it("Returns403WhenDestinationHasInteriorGitSegment", async () => {
    await writeFile(join(tmpRoot, "safe.ts"), "x");
    const res = await patchHandler(
      makePatchRequest("safe.ts", "inst-1", "foo/.git/hooks/post-checkout"),
      makeFileContext("sess-1", ["safe.ts"])
    );
    expect(res.status).toBe(403);
  });

  it("Returns403WhenDestinationIsGitPathWithBackslashes", async () => {
    await writeFile(join(tmpRoot, "safe.ts"), "x");
    const res = await patchHandler(
      makePatchRequest("safe.ts", "inst-1", ".git\\injected"),
      makeFileContext("sess-1", ["safe.ts"])
    );
    expect(res.status).toBe(403);
  });

  it("Returns403WhenPathTraversalOnSource", async () => {
    const res = await patchHandler(
      makePatchRequest("../../etc/passwd", "inst-1", "new.ts"),
      makeFileContext("sess-1", ["..", "..", "etc", "passwd"])
    );
    expect(res.status).toBe(403);
  });

  it("Returns403WhenPathTraversalOnDestination", async () => {
    await writeFile(join(tmpRoot, "safe.ts"), "x");
    const res = await patchHandler(
      makePatchRequest("safe.ts", "inst-1", "../../escape.ts"),
      makeFileContext("sess-1", ["safe.ts"])
    );
    expect(res.status).toBe(403);
  });

  it("Returns404WhenSourceNotFound", async () => {
    const res = await patchHandler(
      makePatchRequest("missing.ts", "inst-1", "new.ts"),
      makeFileContext("sess-1", ["missing.ts"])
    );
    expect(res.status).toBe(404);
  });

  it("Returns409WhenDestinationAlreadyExists", async () => {
    await writeFile(join(tmpRoot, "source.ts"), "x");
    await writeFile(join(tmpRoot, "dest.ts"), "y");

    const res = await patchHandler(
      makePatchRequest("source.ts", "inst-1", "dest.ts"),
      makeFileContext("sess-1", ["source.ts"])
    );
    expect(res.status).toBe(409);
  });

  it("Returns200AndRenamesFileOnSuccess", async () => {
    await writeFile(join(tmpRoot, "old-name.ts"), "file content");

    const res = await patchHandler(
      makePatchRequest("old-name.ts", "inst-1", "new-name.ts"),
      makeFileContext("sess-1", ["old-name.ts"])
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.newPath).toBe("new-name.ts");

    // Old path gone, new path exists with same content
    await expect(stat(join(tmpRoot, "old-name.ts"))).rejects.toMatchObject({ code: "ENOENT" });
    const s = await stat(join(tmpRoot, "new-name.ts"));
    expect(s.isFile()).toBe(true);
  });

  it("Returns200AndRenamesDirectoryOnSuccess", async () => {
    await mkdir(join(tmpRoot, "old-dir"));
    await writeFile(join(tmpRoot, "old-dir", "inner.ts"), "x");

    const res = await patchHandler(
      makePatchRequest("old-dir", "inst-1", "new-dir"),
      makeFileContext("sess-1", ["old-dir"])
    );
    expect(res.status).toBe(200);

    await expect(stat(join(tmpRoot, "old-dir"))).rejects.toMatchObject({ code: "ENOENT" });
    const s = await stat(join(tmpRoot, "new-dir", "inner.ts"));
    expect(s.isFile()).toBe(true);
  });

  it("Returns200AndCreatesParentDirsForDestination", async () => {
    await writeFile(join(tmpRoot, "flat.ts"), "content");

    const res = await patchHandler(
      makePatchRequest("flat.ts", "inst-1", "deep/nested/moved.ts"),
      makeFileContext("sess-1", ["flat.ts"])
    );
    expect(res.status).toBe(200);

    const s = await stat(join(tmpRoot, "deep", "nested", "moved.ts"));
    expect(s.isFile()).toBe(true);
  });
});
