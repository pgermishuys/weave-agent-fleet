"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import {
  connectionRegistry,
  type FleetConnection,
  type ConnectionStatus,
} from "@/lib/fleet-connection-registry";

export interface FleetConnectionContextValue {
  connections: FleetConnection[];
  activeConnection: FleetConnection;
  setActiveConnection: (id: string) => void;
  addConnection: (conn: Omit<FleetConnection, "status">) => void;
  removeConnection: (id: string) => void;
  updateConnection: (
    id: string,
    patch: Partial<Omit<FleetConnection, "id" | "isLocal" | "status">>
  ) => void;
  /** Update runtime status (called by useConnectionHealth) */
  setConnectionStatus: (id: string, status: ConnectionStatus) => void;
}

const FleetConnectionContext = createContext<FleetConnectionContextValue | null>(null);

export function useFleetConnectionContext(): FleetConnectionContextValue {
  const ctx = useContext(FleetConnectionContext);
  if (!ctx) {
    throw new Error(
      "useFleetConnectionContext must be used within <FleetConnectionProvider>"
    );
  }
  return ctx;
}

interface FleetConnectionProviderProps {
  children: ReactNode;
}

export function FleetConnectionProvider({ children }: FleetConnectionProviderProps) {
  // Seed state from registry; mutations call registry + setState to trigger re-renders
  const [connections, setConnections] = useState<FleetConnection[]>(() =>
    connectionRegistry.getConnections()
  );
  const [activeConnection, setActiveConnectionState] = useState<FleetConnection>(() =>
    connectionRegistry.getActiveConnection()
  );

  const refreshState = useCallback(() => {
    setConnections(connectionRegistry.getConnections());
    setActiveConnectionState(connectionRegistry.getActiveConnection());
  }, []);

  const setActiveConnection = useCallback(
    (id: string) => {
      connectionRegistry.setActiveConnection(id);
      refreshState();
    },
    [refreshState]
  );

  const addConnection = useCallback(
    (conn: Omit<FleetConnection, "status">) => {
      connectionRegistry.addConnection(conn);
      refreshState();
    },
    [refreshState]
  );

  const removeConnection = useCallback(
    (id: string) => {
      connectionRegistry.removeConnection(id);
      refreshState();
    },
    [refreshState]
  );

  const updateConnection = useCallback(
    (
      id: string,
      patch: Partial<Omit<FleetConnection, "id" | "isLocal" | "status">>
    ) => {
      connectionRegistry.updateConnection(id, patch);
      refreshState();
    },
    [refreshState]
  );

  const setConnectionStatus = useCallback(
    (id: string, status: ConnectionStatus) => {
      connectionRegistry.setConnectionStatus(id, status);
      // Re-read connections to pick up the status change
      setConnections(connectionRegistry.getConnections());
      setActiveConnectionState(connectionRegistry.getActiveConnection());
    },
    []
  );

  const value: FleetConnectionContextValue = {
    connections,
    activeConnection,
    setActiveConnection,
    addConnection,
    removeConnection,
    updateConnection,
    setConnectionStatus,
  };

  return (
    <FleetConnectionContext.Provider value={value}>
      {children}
    </FleetConnectionContext.Provider>
  );
}
