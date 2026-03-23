import { NextResponse } from "next/server";
import { getInstallRuntimeMetadata } from "@/lib/server/standalone-update-state";
import {
  getStandaloneUpdateStatus,
  scheduleStandaloneUpdate,
} from "@/lib/server/standalone-updater";
import type { StandaloneUpdateRequest } from "@/lib/api-types";

function normalizeHost(host: string): string {
  const trimmed = host.trim();
  if (trimmed.startsWith("[")) {
    const endBracket = trimmed.indexOf("]");
    return endBracket >= 0 ? trimmed.slice(1, endBracket) : trimmed;
  }

  const colonCount = (trimmed.match(/:/g) ?? []).length;
  if (colonCount > 1) {
    return trimmed;
  }

  const [hostname] = trimmed.split(":");
  return hostname;
}

function isLoopbackHost(host: string): boolean {
  const normalized = normalizeHost(host).toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function ensureLoopbackRequest(request: Request): { ok: true } | { ok: false; response: NextResponse } {
  const urlHost = new URL(request.url).hostname;
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (!isLoopbackHost(urlHost)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Standalone self-update is restricted to local browser sessions." },
        { status: 403 },
      ),
    };
  }

  if (forwardedHost && !isLoopbackHost(forwardedHost)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Standalone self-update is restricted to local browser sessions." },
        { status: 403 },
      ),
    };
  }

  if (forwardedFor) {
    const allLoopback = forwardedFor
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .every(isLoopbackHost);

    if (!allLoopback) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Standalone self-update is restricted to local browser sessions." },
          { status: 403 },
        ),
      };
    }
  }

  return { ok: true };
}

function ensureSameOriginRequest(
  request: Request,
): { ok: true } | { ok: false; response: NextResponse } {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  if (origin) {
    if (normalizeOrigin(origin) === requestOrigin) {
      return { ok: true };
    }

    return {
      ok: false,
      response: NextResponse.json(
        { error: "Standalone self-update requires a same-origin browser request." },
        { status: 403 },
      ),
    };
  }

  if (referer) {
    if (normalizeOrigin(referer) === requestOrigin) {
      return { ok: true };
    }

    return {
      ok: false,
      response: NextResponse.json(
        { error: "Standalone self-update requires a same-origin browser request." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: false,
    response: NextResponse.json(
      { error: "Standalone self-update requires a same-origin browser request." },
      { status: 403 },
    ),
  };
}

function ensureStandaloneMode(): { ok: true } | { ok: false; response: NextResponse } {
  const runtime = getInstallRuntimeMetadata();
  if (runtime.installFlavor !== "standalone" || !runtime.canSelfUpdate) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Standalone self-update is unavailable in this runtime." },
        { status: 409 },
      ),
    };
  }
  return { ok: true };
}

// GET /api/update — returns durable standalone update state.
export async function GET(): Promise<NextResponse> {
  const mode = ensureStandaloneMode();
  if (!mode.ok) return mode.response;

  return NextResponse.json(getStandaloneUpdateStatus(), { status: 200 });
}

// POST /api/update — schedules standalone self-update handoff.
export async function POST(request: Request): Promise<NextResponse> {
  const mode = ensureStandaloneMode();
  if (!mode.ok) return mode.response;

  const loopback = ensureLoopbackRequest(request);
  if (!loopback.ok) return loopback.response;

  const sameOrigin = ensureSameOriginRequest(request);
  if (!sameOrigin.ok) return sameOrigin.response;

  let body: StandaloneUpdateRequest;
  try {
    body = (await request.json()) as StandaloneUpdateRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const channel = body.channel === "dev" ? "dev" : body.channel === "stable" ? "stable" : null;
  if (!channel) {
    return NextResponse.json({ error: "channel must be stable or dev." }, { status: 400 });
  }

  try {
    const status = scheduleStandaloneUpdate(channel);
    return NextResponse.json(status, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to schedule update.";
    const statusCode = message.includes("already in progress") ? 409 : 500;
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
