import { NextResponse } from "next/server";
import { getCachedOrScan } from "@/lib/server/repository-scanner";

// GET /api/repositories — returns cached scan of git repositories under workspace roots
export async function GET(): Promise<NextResponse> {
  try {
    const result = getCachedOrScan();
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to scan repositories";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
