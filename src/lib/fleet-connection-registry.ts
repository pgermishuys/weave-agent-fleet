/**
 * Fleet Connection Registry
 *
 * Manages named connections to Fleet Server instances.
 * - Local connection is always present at index 0 and cannot be removed.
 * - Remote connections are persisted to localStorage.
 * - `window.__FLEET_TOKEN__` is read fresh on every Local API call — never stored.
 */

export type ConnectionStatus = "online" | "offline" | "connecting" | "error";

export interface FleetConnection {
  id: string;           // unique slug, e.g. "local", "work-server"
  name: string;         // display name
  url: string;          // base URL, e.g. "http://localhost:3000"
  token?: string;       // bearer token — undefined for Local (read from window)
  status: ConnectionStatus; // runtime only, not persisted
  isLocal: boolean;     // true only for the built-in Local connection
}

// Serialisable form stored in localStorage (no status, no isLocal flag needed)
type PersistedConnection = Omit<FleetConnection, "status" | "isLocal">;

const CONNECTIONS_KEY = "weave:fleet:connections";
const ACTIVE_CONNECTION_KEY = "weave:fleet:activeConnectionId";

export const LOCAL_CONNECTION: FleetConnection = {
  id: "local",
  name: "Local",
  url: "",          // relative, same-origin
  token: undefined, // read from window.__FLEET_TOKEN__ on demand
  status: "connecting",
  isLocal: true,
};

function readPersistedConnections(): PersistedConnection[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CONNECTIONS_KEY);
    if (raw) {
      return JSON.parse(raw) as PersistedConnection[];
    }
  } catch {
    // ignore parse errors
  }
  return [];
}

function writePersistedConnections(conns: PersistedConnection[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(conns));
  } catch {
    // ignore quota errors
  }
}

function readActiveConnectionId(): string {
  if (typeof window === "undefined") return "local";
  try {
    return localStorage.getItem(ACTIVE_CONNECTION_KEY) ?? "local";
  } catch {
    return "local";
  }
}

function writeActiveConnectionId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ACTIVE_CONNECTION_KEY, id);
  } catch {
    // ignore
  }
}

export class FleetConnectionRegistry {
  /** Runtime connection map — includes Local (never persisted) */
  private _connections: Map<string, FleetConnection> = new Map();

  constructor() {
    // Always seed with Local
    this._connections.set("local", { ...LOCAL_CONNECTION });

    // Hydrate remote connections from localStorage
    const persisted = readPersistedConnections();
    for (const p of persisted) {
      this._connections.set(p.id, {
        ...p,
        status: "connecting",
        isLocal: false,
      });
    }
  }

  /** All connections — Local always first */
  getConnections(): FleetConnection[] {
    const result: FleetConnection[] = [];
    const local = this._connections.get("local");
    if (local) result.push(local);
    for (const [id, conn] of this._connections) {
      if (id !== "local") result.push(conn);
    }
    return result;
  }

  getActiveConnection(): FleetConnection {
    const activeId = readActiveConnectionId();
    return this._connections.get(activeId) ?? this._connections.get("local")!;
  }

  setActiveConnection(id: string): void {
    if (!this._connections.has(id)) {
      throw new Error(`Connection "${id}" not found`);
    }
    writeActiveConnectionId(id);
  }

  addConnection(conn: Omit<FleetConnection, "status">): void {
    if (conn.isLocal) throw new Error("Cannot add a connection with isLocal=true");
    if (this._connections.has(conn.id)) {
      throw new Error(`Connection with id "${conn.id}" already exists`);
    }
    const full: FleetConnection = { ...conn, status: "connecting" };
    this._connections.set(conn.id, full);
    this._persistRemoteConnections();
  }

  removeConnection(id: string): void {
    const conn = this._connections.get(id);
    if (!conn) throw new Error(`Connection "${id}" not found`);
    if (conn.isLocal) throw new Error("Cannot remove the Local connection");
    this._connections.delete(id);
    // If the removed connection was active, fall back to local
    if (readActiveConnectionId() === id) {
      writeActiveConnectionId("local");
    }
    this._persistRemoteConnections();
  }

  updateConnection(
    id: string,
    patch: Partial<Omit<FleetConnection, "id" | "isLocal" | "status">>
  ): void {
    const conn = this._connections.get(id);
    if (!conn) throw new Error(`Connection "${id}" not found`);
    if (conn.isLocal) throw new Error("Cannot update the Local connection");
    const updated: FleetConnection = { ...conn, ...patch };
    this._connections.set(id, updated);
    this._persistRemoteConnections();
  }

  /** Runtime-only — does not persist to localStorage */
  setConnectionStatus(id: string, status: ConnectionStatus): void {
    const conn = this._connections.get(id);
    if (!conn) return; // silently ignore unknown ids
    this._connections.set(id, { ...conn, status });
  }

  /**
   * Returns the bearer token for the given connection.
   * For Local: reads `window.__FLEET_TOKEN__` fresh every time — never from localStorage.
   * For remote connections: returns the stored token.
   */
  getTokenForConnection(id: string): string | undefined {
    if (id === "local") {
      if (typeof window === "undefined") return undefined;
      // Access via bracket notation to avoid TypeScript unknown-property errors
      return (window as unknown as Record<string, string | undefined>)["__FLEET_TOKEN__"];
    }
    const conn = this._connections.get(id);
    return conn?.token;
  }

  /** Persist only remote (non-local) connections */
  private _persistRemoteConnections(): void {
    const remotes: PersistedConnection[] = [];
    for (const [id, conn] of this._connections) {
      if (id === "local") continue;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { status: _status, isLocal: _isLocal, ...persisted } = conn;
      remotes.push(persisted);
    }
    writePersistedConnections(remotes);
  }
}

/** Singleton registry — import this everywhere */
export const connectionRegistry = new FleetConnectionRegistry();
