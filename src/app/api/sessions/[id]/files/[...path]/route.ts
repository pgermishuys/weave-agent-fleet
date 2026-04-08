import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir, rm, stat, rename, realpath } from "fs/promises";
import { dirname } from "path";
import { ensureInstanceForSession } from "@/lib/server/opencode-client";
import {
  validatePathWithinRoot,
  isGitPath,
  isWithinRoot,
  PathTraversalError,
} from "@/lib/server/path-security";
import { getMonacoLanguageFromPath } from "@/lib/tool-card-utils";

interface RouteContext {
  params: Promise<{ id: string; path: string[] }>;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const BINARY_CHECK_SIZE = 8192; // 8 KB sample for binary detection

/** Detect binary content by looking for null bytes in the first BINARY_CHECK_SIZE bytes. */
function detectBinary(buf: Buffer): boolean {
  const sample = buf.slice(0, BINARY_CHECK_SIZE);
  return sample.includes(0x00);
}

// GET /api/sessions/[id]/files/[...path]?instanceId=xxx — read a file
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id: sessionId, path: pathSegments } = await context.params;
  const instanceId = request.nextUrl.searchParams.get("instanceId");

  if (!instanceId) {
    return NextResponse.json(
      { error: "instanceId query parameter is required" },
      { status: 400 }
    );
  }

  let instance;
  try {
    ({ instance } = await ensureInstanceForSession(instanceId, sessionId));
  } catch {
    return NextResponse.json(
      { error: "Instance not found or unavailable" },
      { status: 404 }
    );
  }

  // Reconstruct relative path from catch-all segments
  const relativePath = pathSegments.join("/");

  // Refuse reads of .git directory (case-insensitive, including interior segments)
  if (isGitPath(relativePath)) {
    return NextResponse.json(
      { error: "Access denied" },
      { status: 403 }
    );
  }

  let resolvedPath: string;
  try {
    resolvedPath = await validatePathWithinRoot(instance.directory, relativePath);
  } catch (err) {
    if (err instanceof PathTraversalError) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const buf = await readFile(resolvedPath);

    if (buf.length > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)` },
        { status: 413 }
      );
    }

    if (detectBinary(buf)) {
      // For images/SVGs, return base64 so the client can render them
      const ext = relativePath.split(".").pop()?.toLowerCase() ?? "";
      const imageExts = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"]);
      const svgExts = new Set(["svg"]);

      if (svgExts.has(ext)) {
        // SVG is text-based XML — return as text even though it may look "binary"
        const content = buf.toString("utf-8");
        return NextResponse.json({
          path: relativePath,
          content,
          size: buf.length,
          language: "xml",
          isBinary: false,
          isImage: true,
          isSvg: true,
        });
      }

      if (imageExts.has(ext)) {
        const base64 = buf.toString("base64");
        const mimeMap: Record<string, string> = {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          webp: "image/webp",
          bmp: "image/bmp",
          ico: "image/x-icon",
        };
        const mime = mimeMap[ext] ?? "application/octet-stream";
        return NextResponse.json({
          path: relativePath,
          content: base64,
          size: buf.length,
          language: null,
          isBinary: true,
          isImage: true,
          isSvg: false,
          mime,
        });
      }

      return NextResponse.json({
        path: relativePath,
        content: null,
        size: buf.length,
        language: null,
        isBinary: true,
        isImage: false,
        isSvg: false,
      });
    }

    const content = buf.toString("utf-8");
    const language = getMonacoLanguageFromPath(relativePath);

    return NextResponse.json({
      path: relativePath,
      content,
      size: buf.length,
      language,
      isBinary: false,
      isImage: false,
      isSvg: false,
    });
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr?.code === "ENOENT") {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    console.error(`[GET /api/sessions/files/${relativePath}] Error:`, err);
    return NextResponse.json({ error: "Failed to read file" }, { status: 500 });
  }
}

// POST /api/sessions/[id]/files/[...path]?instanceId=xxx — write a file or create a folder
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id: sessionId, path: pathSegments } = await context.params;
  const instanceId = request.nextUrl.searchParams.get("instanceId");

  if (!instanceId) {
    return NextResponse.json(
      { error: "instanceId query parameter is required" },
      { status: 400 }
    );
  }

  let instance;
  try {
    ({ instance } = await ensureInstanceForSession(instanceId, sessionId));
  } catch {
    return NextResponse.json(
      { error: "Instance not found or unavailable" },
      { status: 404 }
    );
  }

  const relativePath = pathSegments.join("/");

  // Refuse writes to .git directory (case-insensitive, including interior segments)
  if (isGitPath(relativePath)) {
    return NextResponse.json(
      { error: "Cannot write to .git directory" },
      { status: 403 }
    );
  }

  let resolvedPath: string;
  try {
    resolvedPath = await validatePathWithinRoot(instance.directory, relativePath);
  } catch (err) {
    if (err instanceof PathTraversalError) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  let body: { content?: string; type?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ── Directory creation ───────────────────────────────────────────────────────
  if (body.type === "directory") {
    try {
      await mkdir(resolvedPath, { recursive: true });
      return NextResponse.json(
        { success: true, path: relativePath, type: "directory" },
        { status: 200 }
      );
    } catch (err) {
      console.error(`[POST dir /api/sessions/files/${relativePath}] Error:`, err);
      return NextResponse.json({ error: "Failed to create directory" }, { status: 500 });
    }
  }

  // ── File write ───────────────────────────────────────────────────────────────
  if (typeof body.content !== "string") {
    return NextResponse.json(
      { error: "body.content must be a string" },
      { status: 400 }
    );
  }

  // Enforce size limit on writes
  if (Buffer.byteLength(body.content, "utf-8") > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `Content too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)` },
      { status: 413 }
    );
  }

  try {
    // Ensure parent directory exists
    await mkdir(dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, body.content, "utf-8");

    return NextResponse.json({ success: true, path: relativePath }, { status: 200 });
  } catch (err) {
    console.error(`[POST /api/sessions/files/${relativePath}] Error:`, err);
    return NextResponse.json({ error: "Failed to write file" }, { status: 500 });
  }
}

// DELETE /api/sessions/[id]/files/[...path]?instanceId=xxx — delete a file or folder
export async function DELETE(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id: sessionId, path: pathSegments } = await context.params;
  const instanceId = request.nextUrl.searchParams.get("instanceId");

  if (!instanceId) {
    return NextResponse.json(
      { error: "instanceId query parameter is required" },
      { status: 400 }
    );
  }

  let instance;
  try {
    ({ instance } = await ensureInstanceForSession(instanceId, sessionId));
  } catch {
    return NextResponse.json(
      { error: "Instance not found or unavailable" },
      { status: 404 }
    );
  }

  const relativePath = pathSegments.join("/");

  // Refuse deletes of .git directory (case-insensitive, including interior segments)
  if (isGitPath(relativePath)) {
    return NextResponse.json(
      { error: "Cannot delete .git directory" },
      { status: 403 }
    );
  }

  let resolvedPath: string;
  try {
    resolvedPath = await validatePathWithinRoot(instance.directory, relativePath);
  } catch (err) {
    if (err instanceof PathTraversalError) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  // Verify the path exists
  try {
    await stat(resolvedPath);
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr?.code === "ENOENT") {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to access path" }, { status: 500 });
  }

  try {
    await rm(resolvedPath, { recursive: true, force: true });
    return NextResponse.json({ success: true, path: relativePath }, { status: 200 });
  } catch (err) {
    console.error(`[DELETE /api/sessions/files/${relativePath}] Error:`, err);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}

// PATCH /api/sessions/[id]/files/[...path]?instanceId=xxx — rename/move a file or folder
export async function PATCH(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id: sessionId, path: pathSegments } = await context.params;
  const instanceId = request.nextUrl.searchParams.get("instanceId");

  if (!instanceId) {
    return NextResponse.json(
      { error: "instanceId query parameter is required" },
      { status: 400 }
    );
  }

  let instance;
  try {
    ({ instance } = await ensureInstanceForSession(instanceId, sessionId));
  } catch {
    return NextResponse.json(
      { error: "Instance not found or unavailable" },
      { status: 404 }
    );
  }

  const relativePath = pathSegments.join("/");

  // Parse body for newPath
  let body: { newPath: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.newPath !== "string" || !body.newPath) {
    return NextResponse.json(
      { error: "body.newPath must be a non-empty string" },
      { status: 400 }
    );
  }

  // Refuse operations on .git directory (source or destination)
  if (isGitPath(relativePath)) {
    return NextResponse.json(
      { error: "Cannot rename .git directory" },
      { status: 403 }
    );
  }
  if (isGitPath(body.newPath)) {
    return NextResponse.json(
      { error: "Cannot rename into .git directory" },
      { status: 403 }
    );
  }

  // Validate source path
  let resolvedOldPath: string;
  try {
    resolvedOldPath = await validatePathWithinRoot(instance.directory, relativePath);
  } catch (err) {
    if (err instanceof PathTraversalError) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    return NextResponse.json({ error: "Invalid source path" }, { status: 400 });
  }

  // Validate destination path
  let resolvedNewPath: string;
  try {
    resolvedNewPath = await validatePathWithinRoot(instance.directory, body.newPath);
  } catch (err) {
    if (err instanceof PathTraversalError) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    return NextResponse.json({ error: "Invalid destination path" }, { status: 400 });
  }

  // Extra symlink-escape check for destination parent directory.
  // When the destination doesn't exist yet, validatePathWithinRoot skips realpath
  // for the full path. We explicitly resolve the parent and re-validate it.
  try {
    const realRoot = await realpath(instance.directory);
    const destParent = dirname(resolvedNewPath);
    try {
      const realDestParent = await realpath(destParent);
      if (!isWithinRoot(realRoot, realDestParent)) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
    } catch {
      // Parent doesn't exist yet — will be created below; lexicographic check already passed
    }
  } catch {
    // realpath on workspace root failed — unexpected, fall through
  }

  // Verify source exists
  try {
    await stat(resolvedOldPath);
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr?.code === "ENOENT") {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to access source" }, { status: 500 });
  }

  // Verify destination does not already exist
  try {
    await stat(resolvedNewPath);
    // If we got here, destination exists — conflict
    return NextResponse.json(
      { error: "Destination already exists" },
      { status: 409 }
    );
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr?.code !== "ENOENT") {
      return NextResponse.json({ error: "Failed to check destination" }, { status: 500 });
    }
    // ENOENT: destination doesn't exist — good, proceed
  }

  try {
    // Ensure parent directory of destination exists
    await mkdir(dirname(resolvedNewPath), { recursive: true });
    await rename(resolvedOldPath, resolvedNewPath);

    return NextResponse.json(
      { success: true, oldPath: relativePath, newPath: body.newPath },
      { status: 200 }
    );
  } catch (err) {
    console.error(`[PATCH /api/sessions/files/${relativePath}] Error:`, err);
    return NextResponse.json({ error: "Failed to rename" }, { status: 500 });
  }
}
