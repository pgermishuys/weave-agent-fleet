"use client";

import {
  useFleetConnectionContext,
  type FleetConnectionContextValue,
} from "@/contexts/fleet-connection-context";

export function useFleetConnections(): FleetConnectionContextValue {
  return useFleetConnectionContext();
}
