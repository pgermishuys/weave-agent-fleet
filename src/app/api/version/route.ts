import { NextResponse } from "next/server";
import { getVersionInfo } from "@/lib/server/version-check";

// GET /api/version — returns current version, latest available, and update status
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const channel = searchParams.get("channel") === "dev" ? "dev" : "stable";
  const info = await getVersionInfo(channel);

  return NextResponse.json(
    {
      version: info.current,
      latest: info.latest,
      updateAvailable: info.updateAvailable,
      checkedAt: info.checkedAt?.toISOString() ?? null,
      channel,
      installFlavor: info.installFlavor,
      canSelfUpdate: info.canSelfUpdate,
    },
    { status: 200 }
  );
}
