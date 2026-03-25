import { NextResponse } from "next/server";
import { invalidateCache, getCachedOrScan } from "@/lib/server/repository-scanner";

// POST /api/repositories/refresh — invalidate the cache and return a fresh scan
export async function POST(): Promise<NextResponse> {
  try {
    invalidateCache();
    const result = getCachedOrScan();
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to refresh repositories";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
