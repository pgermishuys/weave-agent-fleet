import { NextRequest, NextResponse } from "next/server";
import { validateRepoPath, getRepositoryDetail } from "@/lib/server/repository-scanner";
import { existsSync } from "fs";
import { join, resolve } from "path";

// GET /api/repositories/detail?path=<encoded-absolute-path>
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

  // Verify it is actually a git repository (resolve() reaffirms path for static analysis)
  if (!existsSync(join(resolve(resolvedPath), ".git"))) {
    return NextResponse.json({ error: "Path is not a git repository" }, { status: 404 });
  }

  try {
    const repository = getRepositoryDetail(resolvedPath);
    return NextResponse.json({ repository });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to read repository detail";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
