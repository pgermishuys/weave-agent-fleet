import { NextRequest, NextResponse } from "next/server";
import { readdir, stat } from "fs/promises";
import { join } from "path";
import { ensureInstanceForSession } from "@/lib/server/opencode-client";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Directories to exclude from the file tree
const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  "coverage",
  "__pycache__",
  ".weave",
  ".venv",
  "venv",
  ".tox",
  "target", // Rust/Maven
  ".gradle",
  ".idea",
  ".vscode",
  "out",
  ".output",
  ".cache",
]);

const MAX_DEPTH = 10;
const MAX_ENTRIES = 5000;

interface FileEntry {
  path: string;
  type: "file" | "directory";
  size?: number;
}

async function walkDir(
  rootDir: string,
  currentDir: string,
  depth: number,
  entries: FileEntry[],
  maxEntries: number
): Promise<void> {
  if (depth > MAX_DEPTH || entries.length >= maxEntries) return;

  let items;
  try {
    items = await readdir(currentDir, { withFileTypes: true });
  } catch {
    return; // Skip unreadable directories
  }

  for (const item of items) {
    if (entries.length >= maxEntries) break;

    const name = item.name;
    const fullPath = join(currentDir, name);
    // Normalize to forward slashes so the client can split on "/" consistently
    // (path.join uses backslashes on Windows).
    const relativePath = fullPath.slice(rootDir.length + 1).replaceAll("\\", "/");

    if (item.isDirectory()) {
      if (EXCLUDED_DIRS.has(name.toLowerCase()) && name.toLowerCase() !== ".weave") {
        continue;
      }
      entries.push({ path: relativePath, type: "directory" });
      await walkDir(rootDir, fullPath, depth + 1, entries, maxEntries);
    } else if (item.isFile() || item.isSymbolicLink()) {
      try {
        const fileStat = await stat(fullPath);
        entries.push({ path: relativePath, type: "file", size: fileStat.size });
      } catch {
        entries.push({ path: relativePath, type: "file" });
      }
    }
  }
}

// GET /api/sessions/[id]/files?instanceId=xxx — list workspace files
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id: sessionId } = await context.params;
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

  const rootDir = instance.directory;

  try {
    const entries: FileEntry[] = [];
    await walkDir(rootDir, rootDir, 0, entries, MAX_ENTRIES);

    return NextResponse.json(
      { root: rootDir, files: entries },
      { status: 200 }
    );
  } catch (err) {
    console.error(`[GET /api/sessions/files] Error walking directory:`, err);
    return NextResponse.json(
      { error: "Failed to list workspace files" },
      { status: 500 }
    );
  }
}
