/**
 * GET /api/fleet/identity
 *
 * Returns server identity information for Fleet clients.
 * Clients call this endpoint on connection to display a meaningful label
 * in multi-fleet UIs.
 *
 * This endpoint describes *this* server only — it has no awareness of other
 * fleet servers. Multi-fleet aggregation is a client-side concern.
 *
 * Supported env vars:
 *   FLEET_NAME          Display name (default: "Fleet Server")
 *   FLEET_DESCRIPTION   Server description (default: "")
 *
 * Auth: Bearer token required (handled by src/middleware.ts).
 */

import { NextResponse } from "next/server";

export interface FleetIdentity {
  name: string;
  version: string;
  description: string;
  capabilities: string[];
}

export async function GET(): Promise<NextResponse<FleetIdentity>> {
  const identity: FleetIdentity = {
    name: process.env.FLEET_NAME ?? "Fleet Server",
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0",
    description: process.env.FLEET_DESCRIPTION ?? "",
    // Static for now — these are the isolation strategies the process manager supports
    capabilities: ["worktree", "clone", "existing"],
  };

  return NextResponse.json(identity, { status: 200 });
}
