"use client";

import { useEffect } from "react";
import { apiFetch } from "@/lib/api-client";
import { connectionRegistry } from "@/lib/fleet-connection-registry";
import { useFleetConnections } from "@/hooks/use-fleet-connections";

const POLL_INTERVAL_MS = 30_000;

/**
 * Polls GET /api/fleet/identity for every registered connection every 30 s.
 * Updates connection status in the registry and triggers a re-render.
 *
 * Call once at the app root (inside FleetConnectionProvider).
 */
export function useConnectionHealth(): void {
  const { connections, setConnectionStatus } = useFleetConnections();

  useEffect(() => {
    let cancelled = false;
    const controllers: AbortController[] = [];

    async function checkAll() {
      if (cancelled) return;
      const currentConnections = connectionRegistry.getConnections();

      for (const conn of currentConnections) {
        if (cancelled) break;
        const controller = new AbortController();
        controllers.push(controller);

        try {
          const response = await apiFetch(
            "/api/fleet/identity",
            { signal: controller.signal },
            conn.id
          );

          if (cancelled) break;

          if (response.ok) {
            setConnectionStatus(conn.id, "online");
          } else if (response.status === 401) {
            setConnectionStatus(conn.id, "error");
          } else {
            setConnectionStatus(conn.id, "offline");
          }
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            break; // unmounted / cancelled
          }
          if (!cancelled) {
            setConnectionStatus(conn.id, "offline");
          }
        }
      }
    }

    // Run immediately
    void checkAll();

    // Then poll every 30 s
    const intervalId = setInterval(() => {
      void checkAll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      controllers.forEach((c) => c.abort());
    };
  // Re-run when the number of connections changes (new server added/removed)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections.length, setConnectionStatus]);
}
