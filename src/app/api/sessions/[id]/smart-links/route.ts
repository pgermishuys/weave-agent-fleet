import { NextRequest, NextResponse } from "next/server";
import {
  getSession,
  getSessionSmartLinks,
  updateSessionSmartLinks,
  dismissSessionSmartLink,
} from "@/lib/server/db-repository";
import type { SmartLinkReference } from "@/lib/smart-links/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ─── GET /api/sessions/[id]/smart-links ──────────────────────────────────────
// Returns { links: SmartLinkReference[], dismissed: string[] }

export async function GET(
  _req: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id } = await context.params;

  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const row = getSessionSmartLinks(id);

  let links: SmartLinkReference[] = [];
  let dismissed: string[] = [];

  if (row?.smart_links) {
    try {
      links = JSON.parse(row.smart_links) as SmartLinkReference[];
    } catch {
      links = [];
    }
  }

  if (row?.dismissed_smart_links) {
    try {
      dismissed = JSON.parse(row.dismissed_smart_links) as string[];
    } catch {
      dismissed = [];
    }
  }

  return NextResponse.json({ links, dismissed });
}

// ─── PUT /api/sessions/[id]/smart-links ──────────────────────────────────────
// Body: { links: SmartLinkReference[] }
// Upserts the links list, filtering out any dismissed URLs.

export async function PUT(
  req: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id } = await context.params;

  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  let body: { links?: unknown };
  try {
    body = (await req.json()) as { links?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.links)) {
    return NextResponse.json(
      { error: "links must be an array" },
      { status: 400 }
    );
  }

  // Get dismissed URLs to filter them out before persisting
  const row = getSessionSmartLinks(id);
  let dismissed: string[] = [];
  if (row?.dismissed_smart_links) {
    try {
      dismissed = JSON.parse(row.dismissed_smart_links) as string[];
    } catch {
      dismissed = [];
    }
  }

  const dismissedSet = new Set(dismissed);
  const links = (body.links as SmartLinkReference[]).filter(
    (ref) => !dismissedSet.has(ref.url)
  );

  updateSessionSmartLinks(id, JSON.stringify(links));

  return NextResponse.json({ links, dismissed });
}

// ─── DELETE /api/sessions/[id]/smart-links?url=<encoded> ─────────────────────
// Marks the given URL as dismissed and removes it from smart_links.

export async function DELETE(
  req: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id } = await context.params;

  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json(
      { error: "url query parameter is required" },
      { status: 400 }
    );
  }

  // Mark as dismissed
  dismissSessionSmartLink(id, url);

  // Also remove from the links list
  const row = getSessionSmartLinks(id);
  if (row?.smart_links) {
    try {
      const links = JSON.parse(row.smart_links) as SmartLinkReference[];
      const updated = links.filter((ref) => ref.url !== url);
      updateSessionSmartLinks(id, JSON.stringify(updated));
    } catch {
      // Corrupt data — leave as-is; dismiss is already recorded
    }
  }

  return NextResponse.json({ ok: true });
}
