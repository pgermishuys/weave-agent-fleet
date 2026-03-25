import { NextRequest, NextResponse } from "next/server";
import { getRepositoryDetail } from "@/lib/server/repository-scanner";
import { getAllowedRoots } from "@/lib/server/process-manager";
import { existsSync, statSync } from "fs";
import { isAbsolute, join, resolve, sep } from "path";

// GET /api/repositories/detail?path=<encoded-absolute-path>
export async function GET(request: NextRequest): Promise<NextResponse> {
  const inputPath = request.nextUrl.searchParams.get("path");

  if (!inputPath || !isAbsolute(inputPath)) {
    return NextResponse.json({ error: "Path must be a non-empty absolute path" }, { status: 400 });
  }

  // Sanitize: resolve to canonical form and verify against allowlist (CWE-22).
  // The for-loop + direct startsWith() is required so CodeQL recognises the
  // StartsWithDirSanitizer barrier guard (callbacks like Array.some are not recognised).
  const safePath = resolve(inputPath);
  const roots = getAllowedRoots();
  let matchedRoot: string | undefined;
  for (const root of roots) {
    if (safePath === root || safePath.startsWith(root + sep)) {
      matchedRoot = root;
      break;
    }
  }
  if (!matchedRoot) {
    return NextResponse.json({ error: "Path is outside the allowed workspace roots" }, { status: 400 });
  }
  // Re-assert prefix with the matched root so CodeQL sees a direct startsWith guard
  // over the code that follows (StartsWithDirSanitizer requires this pattern).
  if (!safePath.startsWith(matchedRoot)) {
    return NextResponse.json({ error: "Path is outside the allowed workspace roots" }, { status: 400 });
  }

  if (!existsSync(safePath)) {
    return NextResponse.json({ error: "Path does not exist" }, { status: 400 });
  }

  try {
    if (!statSync(safePath).isDirectory()) {
      return NextResponse.json({ error: "Path is not a directory" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Cannot access path" }, { status: 400 });
  }

  // Verify it is actually a git repository
  if (!existsSync(join(safePath, ".git"))) {
    return NextResponse.json({ error: "Path is not a git repository" }, { status: 404 });
  }

  try {
    const repository = getRepositoryDetail(safePath);
    return NextResponse.json({ repository });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to read repository detail";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
