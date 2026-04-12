import { NextRequest, NextResponse } from "next/server";
import {
  getAllIntegrationConfigs,
  setIntegrationConfig,
  removeIntegrationConfig,
} from "@/lib/server/integration-store";
import { log } from "@/lib/server/logger";

export interface IntegrationStatusInfo {
  id: string;
  name: string;
  status: "connected" | "disconnected";
  connectedAt?: string;
}

const KNOWN_INTEGRATION_NAMES: Record<string, string> = {
  github: "GitHub",
  "google-chat": "Google Chat",
};

// GET /api/integrations — returns all integration statuses
export async function GET(): Promise<NextResponse> {
  try {
    const configs = getAllIntegrationConfigs();
    const integrations: IntegrationStatusInfo[] = Object.entries(configs).map(
      ([id, config]) => ({
        id,
        name: KNOWN_INTEGRATION_NAMES[id] ?? id,
        status: "connected",
        connectedAt: config.connectedAt as string | undefined,
      })
    );

    return NextResponse.json({ integrations });
  } catch (err) {
    log.warn("integrations-route", "Failed to get integrations", { err });
    return NextResponse.json(
      { error: "Failed to get integrations" },
      { status: 500 }
    );
  }
}

// POST /api/integrations — connect an integration
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { id: string; config: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id, config } = body;

  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return NextResponse.json({ error: "config is required" }, { status: 400 });
  }

  try {
    const success = setIntegrationConfig(id, config);
    if (!success) {
      return NextResponse.json(
        { error: "Failed to save integration config" },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    log.warn("integrations-route", "Failed to connect integration", {
      id,
      err,
    });
    return NextResponse.json(
      { error: "Failed to connect integration" },
      { status: 500 }
    );
  }
}

// DELETE /api/integrations?id=github — disconnect an integration
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id query param is required" }, { status: 400 });
  }

  try {
    const success = removeIntegrationConfig(id);
    if (!success) {
      return NextResponse.json(
        { error: "Failed to remove integration config" },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    log.warn("integrations-route", "Failed to disconnect integration", {
      id,
      err,
    });
    return NextResponse.json(
      { error: "Failed to disconnect integration" },
      { status: 500 }
    );
  }
}
