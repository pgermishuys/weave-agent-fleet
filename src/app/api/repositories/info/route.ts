import { NextRequest, NextResponse } from "next/server";
import { validateRepoPath, getRepositoryInfo } from "@/lib/server/repository-scanner";
import { existsSync } from "fs";
import { join } from "path";

// GET /api/repositories/info?path=<encoded-absolute-path>
export async function GET(request: NextRequest): Promise<NextResponse> {
  const inputPath = request.nextUrl.searchParams.get("path");

  if (!inputPath) {
    return NextResponse.json({ error: "Missing required query param: path" }, { status: 400 });
  }

  let resolvedPath: string;
  try {
    resolvedPath = validateRepoPath(inputPath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Invalid path";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Verify it is actually a git repository
  if (!existsSync(join(resolvedPath, ".git"))) {
    return NextResponse.json({ error: "Path is not a git repository" }, { status: 404 });
  }

  try {
    const repository = getRepositoryInfo(resolvedPath);
    return NextResponse.json({ repository });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to read repository info";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
