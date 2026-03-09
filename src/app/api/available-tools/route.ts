import { NextResponse } from "next/server";
import { detectInstalledTools } from "@/lib/server/tool-detector";
import { resolveTools } from "@/lib/server/tool-registry";
import { getMergedToolsConfig } from "@/lib/server/config-manager";

// GET /api/available-tools — return tools detected on this system
export async function GET(): Promise<NextResponse> {
  try {
    const detected = await detectInstalledTools();
    const toolsConfig = getMergedToolsConfig();
    const tools = resolveTools(detected, toolsConfig);

    return NextResponse.json(
      { tools, platform: process.platform },
      {
        headers: {
          "Cache-Control": "private, max-age=300",
        },
      }
    );
  } catch (err) {
    console.error("[GET /api/available-tools] Detection failed:", err);
    return NextResponse.json(
      { error: "Failed to detect installed tools" },
      { status: 500 }
    );
  }
}
