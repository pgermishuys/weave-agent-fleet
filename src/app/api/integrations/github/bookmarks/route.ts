import { NextRequest, NextResponse } from "next/server";
import {
  getIntegrationConfig,
  setIntegrationConfig,
} from "@/lib/server/integration-store";
import type { BookmarkedRepo } from "@/integrations/github/types";

// GET /api/integrations/github/bookmarks
export async function GET(): Promise<NextResponse> {
  const config = getIntegrationConfig("github");
  const bookmarks = (config?.bookmarkedRepos as BookmarkedRepo[] | undefined) ?? [];
  return NextResponse.json(bookmarks, { status: 200 });
}

// PUT /api/integrations/github/bookmarks
export async function PUT(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("bookmarks" in body) ||
    !Array.isArray((body as Record<string, unknown>).bookmarks)
  ) {
    return NextResponse.json(
      { error: "Request body must be { bookmarks: BookmarkedRepo[] }" },
      { status: 400 }
    );
  }

  const bookmarks = (body as { bookmarks: BookmarkedRepo[] }).bookmarks;
  const existing = getIntegrationConfig("github") ?? {};
  setIntegrationConfig("github", { ...existing, bookmarkedRepos: bookmarks });

  return NextResponse.json(bookmarks, { status: 200 });
}
