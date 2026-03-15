import { apiFetch } from "@/lib/api-client";

/**
 * Fetch the live session status from the Fleet API.
 * Returns "busy" or "idle". Defaults to "idle" on any error.
 */
export async function fetchSessionStatus(
  sessionId: string,
  instanceId: string,
  connectionId?: string
): Promise<"idle" | "busy"> {
  try {
    const url = `/api/sessions/${encodeURIComponent(sessionId)}/status?instanceId=${encodeURIComponent(instanceId)}`;
    const response = await apiFetch(url, undefined, connectionId);
    if (!response.ok) return "idle";
    const data = (await response.json()) as { status?: string };
    if (data.status === "busy") return "busy";
    return "idle";
  } catch {
    return "idle";
  }
}
