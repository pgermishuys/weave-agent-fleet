/**
 * Process Manager — server-side singleton that spawns and tracks OpenCode server instances.
 *
 * Each "managed instance" maps to one `opencode serve` process bound to a directory.
 * Multiple sessions can share one instance if they target the same directory.
 *
 * Plugin deadlock prevention: config.plugin is set to [] via OPENCODE_CONFIG_CONTENT
 * (passed by the SDK as an env var to the child process). This prevents the Weave plugin
 * from loading and calling GET /skill back to the server during bootstrap.
 *
 * V2: Persists instance state to SQLite for recovery across server restarts.
 * Uses port-based recovery (not PID) since the SDK doesn't expose the child PID.
 */

import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2";
import { spawn, spawnSync } from "child_process";
import { existsSync, statSync, readdirSync } from "fs";
import { homedir } from "os";
import { createServer, Socket } from "net";
import { dirname, resolve, sep } from "path";
import { randomUUID } from "crypto";
import { killProcessTree, killProcessTreeAsync } from "./process-kill";
import {
  insertInstance,
  updateInstanceStatus,
  markAllInstancesStopped,
  markAllNonTerminalSessionsStopped,
  getSessionsForInstance,
  updateSessionStatus,
  listWorkspaceRoots,
} from "./db-repository";
import { ensureWatching, stopWatching } from "./session-status-watcher";
import { removeAllListeners as hubRemoveAllListeners } from "./instance-event-hub";
import { startCollector, stopCollector, flushNow as flushAnalytics } from "./analytics-collector";
import { log } from "./logger";
import { getMergedConfig } from "./config-manager";

// ─── OPENCODE_BIN support ─────────────────────────────────────────────────────
// If OPENCODE_BIN is set to the full path of the opencode binary, prepend its
// parent directory to PATH so `opencode` is findable by name (e.g. for
// createOpencodeClient or any other spawn sites).
if (process.env.OPENCODE_BIN) {
  const binPath = resolve(process.env.OPENCODE_BIN);
  if (existsSync(binPath)) {
    const binDir = dirname(binPath);
    const sep = process.platform === "win32" ? ";" : ":";
    process.env.PATH = `${binDir}${sep}${process.env.PATH ?? ""}`;
  } else {
    log.warn("process-manager", `OPENCODE_BIN set to "${process.env.OPENCODE_BIN}" but file does not exist`);
  }
}

// ─── OpenCode server spawn ────────────────────────────────────────────────────
// Custom implementation that replaces the SDK's createOpencodeServer().
// On Windows, Node.js child_process.spawn() uses CreateProcessW which only
// resolves .exe files on PATH — it cannot find .cmd/.bat wrappers. Using
// `shell: true` on Windows routes through cmd.exe which resolves PATHEXT
// correctly.
interface SpawnServerOptions {
  hostname?: string;
  port?: number;
  timeout?: number;
  signal?: AbortSignal;
  config?: Record<string, unknown>;
}

async function spawnOpencodeServer(
  options: SpawnServerOptions
): Promise<{ url: string; pid: number | undefined; close: (force?: boolean) => void }> {
  const hostname = options.hostname ?? "127.0.0.1";
  const port = options.port ?? 4096;
  const timeout = options.timeout ?? 5000;

  const command = process.env.OPENCODE_BIN ?? "opencode";
  const args = ["serve", `--hostname=${hostname}`, `--port=${port}`];
  const config = options.config ?? {};
  if ((config as { logLevel?: string }).logLevel) {
    args.push(`--log-level=${(config as { logLevel: string }).logLevel}`);
  }

  const proc = spawn(command, args, {
    signal: options.signal,
    // On Windows, shell: true is required so cmd.exe resolves .cmd/.bat via PATHEXT
    shell: process.platform === "win32",
    env: {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    },
  });

  const url = await new Promise<string>((resolve, reject) => {
    const id = setTimeout(() => {
      reject(
        new Error(
          `Timeout waiting for opencode server to start after ${timeout}ms`
        )
      );
    }, timeout);

    let output = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const lines = output.split("\n");
      for (const line of lines) {
        if (line.startsWith("opencode server listening")) {
          const match = line.match(/on\s+(https?:\/\/[^\s\r]+)/);
          if (!match) {
            clearTimeout(id);
            reject(
              new Error(
                `Failed to parse server url from output: ${line}`
              )
            );
            return;
          }
          clearTimeout(id);
          resolve(match[1]);
          return;
        }
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.on("exit", (code) => {
      clearTimeout(id);
      let msg = `opencode server exited with code ${code}`;
      if (output.trim()) {
        msg += `\nServer output: ${output}`;
      }
      reject(new Error(msg));
    });

    proc.on("error", (error) => {
      clearTimeout(id);
      reject(error);
    });

    if (options.signal) {
      options.signal.addEventListener("abort", () => {
        clearTimeout(id);
        reject(new Error("Aborted"));
      });
    }
  });

  const KILL_GRACE_MS =
    parseInt(process.env.WEAVE_KILL_GRACE_MS ?? "", 10) || 5000;

  return {
    url,
    pid: proc.pid,
    close(force?: boolean) {
      // No-op if process never spawned or already exited
      if (proc.pid === undefined || proc.exitCode !== null) return;
      // Capture pid — narrowed to number by the undefined check above
      const pid = proc.pid;

      if (force) {
        // Synchronous kill — used during process.on('exit') where no async work runs.
        // On Windows: taskkill /T /F kills the entire process tree (cmd.exe + opencode.exe).
        // On POSIX: proc.kill("SIGKILL") terminates the ChildProcess directly.
        killProcessTree(proc, "SIGKILL", pid);
        return;
      }

      // Graceful: attempt soft kill → timeout → force kill
      // On Windows: taskkill /T /F is always forceful — there is no graceful equivalent.
      //   Windows processes don't handle SIGTERM, so we force-kill immediately.
      // On POSIX: SIGTERM → grace period → SIGKILL escalation.
      if (process.platform === "win32") {
        // Windows: no graceful option — kill the process tree immediately
        killProcessTree(proc, "SIGKILL", pid);
        return;
      }

      // POSIX graceful: SIGTERM → timeout → SIGKILL
      void killProcessTreeAsync(proc, "SIGTERM", pid).catch((err: unknown) => {
        // ESRCH (process already dead) is swallowed inside killProcessTreeAsync.
        // Any error reaching here is unexpected (e.g. EPERM) — log for diagnostics.
        log.warn("process-manager", "SIGTERM failed during graceful close — SIGKILL escalation will follow", {
          pid,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      const killTimer = setTimeout(() => {
        if (proc.exitCode === null) {
          log.warn("process-manager", "Process did not exit after SIGTERM grace period — sending SIGKILL", {
            pid,
            graceMs: KILL_GRACE_MS,
          });
          killProcessTree(proc, "SIGKILL", pid);
        }
      }, KILL_GRACE_MS);

      // If the process exits within the grace period, clear the timer
      proc.once("exit", () => {
        clearTimeout(killTimer);
      });

      // Ensure the timer doesn't prevent Node.js from exiting
      if (killTimer.unref) {
        killTimer.unref();
      }
    },
  };
}

// Re-export for convenience
export type { OpencodeClient } from "@opencode-ai/sdk/v2";

export interface ManagedInstance {
  id: string;
  port: number;
  url: string;
  directory: string;
  client: OpencodeClient;
  close: (force?: boolean) => void;
  status: "running" | "dead";
  createdAt: Date;
  /** True if this instance was recovered from DB on startup (not freshly spawned) */
  recovered: boolean;
}

const PORT_START = 4097;
const PORT_END = 4200;
const SPAWN_TIMEOUT_MS = 30_000;
const MAX_PORT_RETRIES = 5;

/**
 * Check if a port is actually available on the OS by attempting to bind it.
 * Returns true if the port is free, false if it's already in use.
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

// ─── globalThis-based singletons ──────────────────────────────────────────────
// Next.js dev mode with Turbopack may load this module multiple times in
// separate route compilation chunks, creating distinct module-level variables.
// Using globalThis ensures all chunks share the same Maps/Sets/state.

const _g = globalThis as unknown as {
  __weaveInstances?: Map<string, ManagedInstance>;
  __weaveUsedPorts?: Set<number>;
  __weaveDirToInstance?: Map<string, string>;
  __weaveInflightSpawns?: Map<string, Promise<ManagedInstance>>;
  __weaveRecoveryResolve?: (() => void) | null;
  __weaveRecoveryPromise?: Promise<void>;
  __weaveCleanupRun?: boolean;
  __weaveHealthFailCounts?: Map<string, number>;
  __weaveHealthCheckInterval?: ReturnType<typeof setInterval> | null;
  __weaveRespawnAttempts?: Map<string, number[]>;
  __weaveInitDone?: boolean;
  __weaveSignalHandlersRegistered?: boolean;
  __weavePortCooldowns?: Map<number, number>;
};

// Module-level singleton map — persists across API route invocations in one Next.js process
const instances: Map<string, ManagedInstance> = (_g.__weaveInstances ??= new Map());
// Track which ports are in use
const usedPorts: Set<number> = (_g.__weaveUsedPorts ??= new Set());
// Track which directories already have an instance
const directoryToInstanceId: Map<string, string> = (_g.__weaveDirToInstance ??= new Map());
// Track in-flight spawn promises to prevent duplicate concurrent spawns for the same directory
const inflightSpawns: Map<string, Promise<ManagedInstance>> = (_g.__weaveInflightSpawns ??= new Map());
// Track ports in cooldown (port → timestamp when cooldown started)
// Ports enter cooldown when the OS reports them in use but no managed instance owns them.
// They are held out of allocation for WEAVE_PORT_COOLDOWN_MS (default 60s) to allow
// zombie processes time to release them, preventing permanent port exhaustion.
const portCooldowns: Map<number, number> = (_g.__weavePortCooldowns ??= new Map());

// Recovery state — resolved once startup recovery is complete
if (!_g.__weaveRecoveryPromise) {
  _g.__weaveRecoveryPromise = new Promise<void>((resolve) => {
    _g.__weaveRecoveryResolve = resolve;
  });
}
let _recoveryCompleteResolve: (() => void) | null = _g.__weaveRecoveryResolve ?? null;
export const _recoveryComplete: Promise<void> = _g.__weaveRecoveryPromise!;

// Guard against double cleanup
let _cleanupRun: boolean = (_g.__weaveCleanupRun ??= false);

/**
 * Discover filesystem root directories. On Windows this returns available
 * drive letters (e.g. ["C:\\", "D:\\"]), on Unix/macOS it returns ["/"].
 */
function getFilesystemRoots(): string[] {
  if (process.platform === "win32") {
    // Enumerate drive letters A-Z; keep those that exist and are accessible.
    const drives: string[] = [];
    for (let code = 65; code <= 90; code++) {
      const drive = `${String.fromCharCode(code)}:\\`;
      try {
        // readdirSync will throw if the drive doesn't exist or isn't ready
        readdirSync(drive);
        drives.push(drive);
      } catch {
        // Drive doesn't exist or isn't ready (e.g. empty CD-ROM drive)
      }
    }
    // Fallback: if no drives were found (shouldn't happen), use homedir
    return drives.length > 0 ? drives : [resolve(homedir())];
  }
  return ["/"];
}

/**
 * Returns workspace roots defined by the ORCHESTRATOR_WORKSPACE_ROOTS env var.
 * When the env var is not set, defaults to the filesystem roots (drive letters
 * on Windows, "/" on Unix) so the directory picker can navigate the full
 * filesystem. These are "system" roots that cannot be removed via the UI.
 */
export function getEnvRoots(): string[] {
  const envRoots = process.env.ORCHESTRATOR_WORKSPACE_ROOTS;
  if (envRoots) {
    const separator = process.platform === "win32" ? ";" : ":";
    return envRoots.split(separator).map((r) => resolve(r.trim())).filter(Boolean);
  }
  return getFilesystemRoots();
}

/**
 * Allowed workspace base directories. Returns the union of env-var roots,
 * user-added roots (persisted in SQLite), and the Weave workspace root
 * (where worktree/clone directories live), deduplicated by resolved path.
 * Only directories under these roots can be used to spawn OpenCode instances
 * or be opened in an editor.
 */
export function getAllowedRoots(): string[] {
  const envRoots = getEnvRoots();

  let dbRoots: string[] = [];
  try {
    dbRoots = listWorkspaceRoots().map((r) => r.path);
  } catch (err) {
    log.warn("process-manager", "Failed to read workspace roots from DB", { err });
  }

  // Always allow the Weave workspace root where worktree/clone directories
  // are created (WEAVE_WORKSPACE_ROOT or ~/.weave/workspaces by default).
  const weaveWsRoot = process.env.WEAVE_WORKSPACE_ROOT
    ? resolve(process.env.WEAVE_WORKSPACE_ROOT)
    : resolve(homedir(), ".weave", "workspaces");

  const seen = new Set<string>();
  const merged: string[] = [];
  for (const root of [...envRoots, ...dbRoots, weaveWsRoot]) {
    const resolved = resolve(root);
    if (!seen.has(resolved)) {
      seen.add(resolved);
      merged.push(resolved);
    }
  }
  return merged;
}

/**
 * Validate that a directory path is safe to use:
 * - Must be an absolute path
 * - Must resolve to a location under an allowed root
 * - Must exist and be a directory
 *
 * @throws {Error} with a safe, user-facing message on validation failure
 */
export function validateDirectory(directory: string): string {
  const resolved = resolve(directory);

  const roots = getAllowedRoots();
  const underAllowedRoot = roots.some(
    (root) =>
      resolved === root ||
      resolved.startsWith(root.endsWith(sep) ? root : root + sep)
  );
  if (!underAllowedRoot) {
    throw new Error("Directory is outside the allowed workspace roots");
  }

  try {
    const stat = statSync(resolved);
    if (!stat.isDirectory()) {
      throw new Error("Path exists but is not a directory");
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Path exists")) throw err;
    throw new Error("Directory does not exist");
  }

  return resolved;
}

export function allocatePort(): number {
  const cooldownMs =
    parseInt(process.env.WEAVE_PORT_COOLDOWN_MS ?? "", 10) || 60_000;
  const now = Date.now();

  for (let port = PORT_START; port <= PORT_END; port++) {
    // Skip ports actively managed by a running instance
    if (usedPorts.has(port)) continue;

    // Skip ports in active cooldown (zombie process may still hold them)
    const cooldownStart = portCooldowns.get(port);
    if (cooldownStart !== undefined) {
      if (now - cooldownStart < cooldownMs) {
        // Still in cooldown — skip this port
        continue;
      }
      // Cooldown expired — remove from cooldowns and let it be re-checked
      portCooldowns.delete(port);
    }

    usedPorts.add(port);
    return port;
  }
  throw new Error(`No available ports in range ${PORT_START}–${PORT_END}`);
}

export function releasePort(port: number): void {
  usedPorts.delete(port);
}

/**
 * Reset all internal state — for tests only.
 */
export function _resetForTests(): void {
  // Reset the cleanup guard so destroyAll() actually runs
  _cleanupRun = false;
  _g.__weaveCleanupRun = false;
  destroyAll();
  // Reset again after destroyAll sets it to true, so subsequent calls work
  _cleanupRun = false;
  _g.__weaveCleanupRun = false;
  usedPorts.clear();
  portCooldowns.clear();
  directoryToInstanceId.clear();
  inflightSpawns.clear();
  _healthFailCounts.clear();
  _respawnAttempts.clear();
}

/**
 * Return the portCooldowns Map for test assertions.
 */
export function _getPortCooldownsForTests(): Map<number, number> {
  return portCooldowns;
}

/**
 * Mark all previous instances and sessions as stopped on startup.
 *
 * When Fleet restarts — whether after a crash or a graceful shutdown — every
 * previous OpenCode process is definitively dead. There is nothing to
 * "reconnect" to. This function eagerly transitions all running instances
 * and all non-terminal sessions to "stopped" in a single pass, eliminating
 * stale "disconnected" or "active" records left behind by the previous run.
 *
 * Called once on module init (lazily, on first API call that calls `ensureRecovered()`).
 */
export async function recoverInstances(): Promise<void> {
  try {
    const now = new Date().toISOString();
    const stoppedInstances = markAllInstancesStopped(now);
    const stoppedSessions = markAllNonTerminalSessionsStopped(now);
    if (stoppedInstances > 0 || stoppedSessions > 0) {
      log.info("process-manager", `Startup cleanup: marked ${stoppedInstances} instance(s) and ${stoppedSessions} session(s) as stopped`);
    }
  } catch (err) {
    log.warn("process-manager", "DB not available — skipping startup cleanup", { err });
  }

  _recoveryCompleteResolve?.();
  _recoveryCompleteResolve = null;
  _g.__weaveRecoveryResolve = null;
}

/**
 * Check if an OpenCode server at the given URL is alive via HTTP.
 * Used as a "last chance" verification before marking an instance dead.
 * Returns true if it responds with any HTTP status < 500.
 */
async function httpHealthCheck(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${url}/session`, {
        signal: controller.signal,
      });
      return response.status < 500;
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    log.warn("process-manager", "HTTP health check failed — treating as unreachable", {
      url, timeoutMs, errorName: (err as Error)?.name, errorMessage: (err as Error)?.message,
    });
    return false;
  }
}

/**
 * Lightweight TCP probe — checks if something is listening on the given port.
 * Uses a raw TCP connect (SYN/ACK) which is handled entirely by the kernel,
 * imposing zero load on the application. Returns true if the connection
 * succeeds, false on timeout or error.
 */
function tcpPortAlive(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, "127.0.0.1");
  });
}

/** Exported for testing only. */
export function _tcpPortAliveForTests(port: number, timeoutMs: number): Promise<boolean> {
  return tcpPortAlive(port, timeoutMs);
}

/**
 * Build agent model config from merged WeaveConfig for a directory.
 * Returns `{ agent: { <name>: { model: "provider/model" } } }` if any agents
 * have model overrides, or an empty object if none do.
 *
 * Exported for testing.
 */
export function buildAgentModelConfig(directory: string): Record<string, unknown> {
  try {
    const weaveConfig = getMergedConfig(directory);
    const agentConfig: Record<string, { model: string }> = {};
    if (weaveConfig.agents) {
      for (const [name, cfg] of Object.entries(weaveConfig.agents)) {
        if (cfg.model) {
          agentConfig[name] = { model: cfg.model };
        }
      }
    }
    if (Object.keys(agentConfig).length > 0) {
      return { agent: agentConfig };
    }
  } catch (err) {
    log.warn("process-manager", "Failed to read agent model config — proceeding without model overrides", { directory, err });
  }
  return {};
}

/**
 * Spawn a new OpenCode server instance for the given directory.
 * Reuses an existing running instance if one already exists for that directory.
 *
 * Includes retry logic: if a port is held by a zombie/external process,
 * it releases the port and tries the next available one (up to MAX_PORT_RETRIES).
 */
export async function spawnInstance(directory: string): Promise<ManagedInstance> {
  // Reuse existing running instance for the same directory
  const existingId = directoryToInstanceId.get(directory);
  if (existingId) {
    const existing = instances.get(existingId);
    if (existing && existing.status === "running") {
      return existing;
    }
    // Dead — clean up and respawn; release the leaked port
    if (existing) {
      releasePort(existing.port);
    }
    directoryToInstanceId.delete(directory);
    instances.delete(existingId);
  }

  // Coalesce concurrent spawns for the same directory — if a spawn is already
  // in flight, return the same promise instead of spawning a second instance.
  const inflight = inflightSpawns.get(directory);
  if (inflight) {
    return inflight;
  }

  const spawnPromise = (async (): Promise<ManagedInstance> => {
    const instanceId = randomUUID();

    // Retry loop: allocate a port, verify it's available on the OS, then spawn.
    // If the port is held by a zombie process, release it and try the next one.
    let server: { url: string; pid: number | undefined; close: (force?: boolean) => void };
    let port: number | undefined;
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_PORT_RETRIES; attempt++) {
      port = allocatePort();

      // Pre-check: is the OS port actually free?
      const available = await isPortAvailable(port);
      if (!available) {
        log.warn("process-manager", `Port ${port} allocated but OS reports it in use — moving to cooldown`, { port });
        // Release from usedPorts and add to cooldowns for retry after cooldown expires.
        // The cooldown prevents this port from being allocated again until the zombie
        // process (if any) releases it.
        releasePort(port);
        portCooldowns.set(port, Date.now());
        continue;
      }

      try {
        server = await spawnOpencodeServer({
          port,
          timeout: SPAWN_TIMEOUT_MS,
          config: {
            plugin: [],
            permission: { edit: "allow", bash: "allow", external_directory: "allow" },
            ...buildAgentModelConfig(directory),
          },
        });
        // Success — break out of retry loop
        break;
      } catch (err) {
        lastError = err;
        // Release the port so it can be reclaimed later if the issue was transient
        releasePort(port);
        log.warn("process-manager", `Failed to spawn on port ${port} (attempt ${attempt + 1}/${MAX_PORT_RETRIES})`, { port, attempt: attempt + 1, err });
      }
    }

    if (!server! || port === undefined) {
      throw lastError ?? new Error("Failed to spawn OpenCode server: all port attempts exhausted");
    }

    // Persist to DB for recovery across restarts
    try {
      insertInstance({
        id: instanceId,
        port,
        directory,
        url: server.url,
        pid: server.pid ?? null,
      });
    } catch (err) {
      log.warn("process-manager", "Failed to persist instance to DB — running in-memory only", { instanceId, err });
    }

    const client = createOpencodeClient({ baseUrl: server.url, directory });

    const instance: ManagedInstance = {
      id: instanceId,
      port,
      url: server.url,
      directory,
      client,
      close: server.close,
      status: "running",
      createdAt: new Date(),
      recovered: false,
    };

    instances.set(instanceId, instance);
    directoryToInstanceId.set(directory, instanceId);

    // Start watching session status events for this instance
    ensureWatching(instanceId);

    return instance;
  })();

  inflightSpawns.set(directory, spawnPromise);
  try {
    return await spawnPromise;
  } finally {
    inflightSpawns.delete(directory);
  }
}

export function getInstance(id: string): ManagedInstance | undefined {
  return instances.get(id);
}

export function listInstances(): ManagedInstance[] {
  return Array.from(instances.values());
}

export function destroyInstance(id: string, force?: boolean): void {
  // Stop watching session status events before tearing down
  stopWatching(id);
  // Force-clean hub subscription (cancels any pending reconnection)
  hubRemoveAllListeners(id);

  const instance = instances.get(id);
  if (!instance) return;

  // Update DB first so even if kill fails, the DB reflects intent
  try {
    updateInstanceStatus(id, "stopped", new Date().toISOString());
  } catch (err) {
    log.warn("process-manager", "Failed to update instance status to stopped in DB", { instanceId: id, err });
  }

  // Cascade: mark all active sessions on this instance as disconnected
  try {
    const activeSessions = getSessionsForInstance(id);
    for (const session of activeSessions) {
      updateSessionStatus(session.id, "disconnected", new Date().toISOString());
    }
  } catch (err) {
    log.warn("process-manager", "Failed to cascade session disconnections on instance destroy", { instanceId: id, err });
  }

  try {
    instance.close(force);
  } catch (err) {
    log.warn("process-manager", "Error while closing instance process", { instanceId: id, err });
  }
  instance.status = "dead";
  instances.delete(id);
  directoryToInstanceId.delete(instance.directory);
  releasePort(instance.port);
}

export function destroyAll(): void {
  if (_cleanupRun) return;
  _cleanupRun = true;
  _g.__weaveCleanupRun = true;

  // Flush pending analytics before tearing down instances
  try {
    flushAnalytics();
  } catch {
    // Ignore errors in shutdown — best effort
  }
  stopCollector();

  for (const id of [...instances.keys()]) {
    destroyInstance(id, true);
  }

  // Windows belt-and-suspenders: after destroying all managed instances,
  // do a final synchronous sweep of ALL ports in the managed range to catch
  // any orphaned processes not tracked in our managed instance map.
  // Uses spawnSync (guaranteed synchronous, safe inside process.on("exit")).
  if (process.platform === "win32") {
    try {
      // Run netstat once and scan all lines for our port range.
      // netstat -ano output: Proto LocalAddress ForeignAddress State PID
      // Local address format: "127.0.0.1:<port>" or "0.0.0.0:<port>"
      // We split each line into columns and only inspect the local address (column 2)
      // to avoid false positives from foreign address ports in our range.
      const result = spawnSync("netstat", ["-ano"], { encoding: "utf8", timeout: 5000 });
      if (result.stdout) {
        const lines = (result.stdout as string).split("\n");
        for (const line of lines) {
          // Split into whitespace-delimited columns:
          // [0]=Proto, [1]=LocalAddress, [2]=ForeignAddress, [3]=State, [4]=PID
          const cols = line.trim().split(/\s+/);
          if (cols.length < 5) continue;
          const localAddr = cols[1];
          const portMatch = localAddr.match(/:(\d+)$/);
          if (!portMatch) continue;
          const port = parseInt(portMatch[1], 10);
          if (port < PORT_START || port > PORT_END) continue;

          const pid = cols[4];
          if (pid && /^\d+$/.test(pid) && pid !== "0") {
            spawnSync("taskkill", ["/PID", pid, "/T", "/F"], { timeout: 3000 });
          }
        }
      }
    } catch {
      // Ignore errors in exit handler — best effort only
    }
  }
}

// Kick off recovery as soon as the module is first loaded.
// Guard: only run once across Turbopack module re-evaluations.
if (!_g.__weaveInitDone) {
  _g.__weaveInitDone = true;

  // This is intentionally fire-and-forget — callers await `_recoveryComplete` if they need to.
  recoverInstances().catch((err) => {
    log.error("process-manager", "Recovery failed", { err });
  });
}

// ─── Health Check Loop ────────────────────────────────────────────────────────

const HEALTH_CHECK_TIMEOUT_MS =
  parseInt(process.env.WEAVE_HEALTH_CHECK_TIMEOUT_MS ?? "", 10) || 5_000;
const HEALTH_CHECK_INTERVAL_MS =
  parseInt(process.env.WEAVE_HEALTH_CHECK_INTERVAL_MS ?? "", 10) || 30_000;
const HEALTH_CHECK_FAIL_THRESHOLD =
  parseInt(process.env.WEAVE_HEALTH_CHECK_FAIL_THRESHOLD ?? "", 10) || 5;
const HEALTH_CHECK_LAST_CHANCE_TIMEOUT_MS =
  parseInt(process.env.WEAVE_HEALTH_CHECK_LAST_CHANCE_TIMEOUT_MS ?? "", 10) || 15_000;
const HEALTH_CHECK_MAX_RESPAWNS = 3;
const HEALTH_CHECK_RESPAWN_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// Track consecutive failure counts per instance (shared via globalThis)
const _healthFailCounts: Map<string, number> = (_g.__weaveHealthFailCounts ??= new Map());

// Track respawn attempts per directory to prevent infinite respawn loops (shared via globalThis)
const _respawnAttempts: Map<string, number[]> = (_g.__weaveRespawnAttempts ??= new Map());

// Log resolved health check configuration at startup
log.info("process-manager", "Health check configuration", {
  timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
  intervalMs: HEALTH_CHECK_INTERVAL_MS,
  failThreshold: HEALTH_CHECK_FAIL_THRESHOLD,
  lastChanceTimeoutMs: HEALTH_CHECK_LAST_CHANCE_TIMEOUT_MS,
  maxRespawns: HEALTH_CHECK_MAX_RESPAWNS,
  respawnWindowMs: HEALTH_CHECK_RESPAWN_WINDOW_MS,
});

/**
 * Attempt to respawn an instance for a directory that was killed by health checks.
 * Respects a rate limit: max HEALTH_CHECK_MAX_RESPAWNS attempts within
 * HEALTH_CHECK_RESPAWN_WINDOW_MS to prevent infinite loops.
 */
async function attemptRespawn(directory: string, deadInstanceId: string): Promise<void> {
  const now = Date.now();
  const attempts = _respawnAttempts.get(directory) ?? [];
  // Prune old attempts outside the window
  const recent = attempts.filter(t => now - t < HEALTH_CHECK_RESPAWN_WINDOW_MS);

  if (recent.length >= HEALTH_CHECK_MAX_RESPAWNS) {
    log.error("process-manager", "Respawn rate limit reached for directory — not respawning", {
      directory, recentAttempts: recent.length, maxAttempts: HEALTH_CHECK_MAX_RESPAWNS,
      windowMs: HEALTH_CHECK_RESPAWN_WINDOW_MS,
    });
    // Store only recent (valid) timestamps — stale ones are already pruned
    _respawnAttempts.set(directory, recent);
    return;
  }

  // Clean up stale key if all previous timestamps expired
  if (recent.length === 0 && _respawnAttempts.has(directory)) {
    _respawnAttempts.delete(directory);
  }

  recent.push(now);
  _respawnAttempts.set(directory, recent);

  try {
    log.info("process-manager", "Attempting auto-respawn for directory after health check death", {
      directory, deadInstanceId, attempt: recent.length,
    });
    const newInstance = await spawnInstance(directory);
    log.info("process-manager", "Auto-respawn successful — new instance created", {
      directory, deadInstanceId, newInstanceId: newInstance.id, newPort: newInstance.port,
    });
  } catch (err) {
    log.error("process-manager", "Auto-respawn failed for directory", { directory, deadInstanceId, err });
  }
}

/**
 * Sweep _respawnAttempts and remove entries whose timestamps are all
 * older than HEALTH_CHECK_RESPAWN_WINDOW_MS. Called periodically from
 * the health check loop and exposed for testing.
 */
export function _cleanupStaleRespawnAttempts(): void {
  const now = Date.now();
  for (const [dir, timestamps] of _respawnAttempts) {
    const recent = timestamps.filter(t => now - t < HEALTH_CHECK_RESPAWN_WINDOW_MS);
    if (recent.length === 0) {
      _respawnAttempts.delete(dir);
    } else {
      _respawnAttempts.set(dir, recent);
    }
  }
}

/**
 * Return the _respawnAttempts Map for test assertions.
 */
export function _getRespawnAttemptsForTests(): Map<string, number[]> {
  return _respawnAttempts;
}

/**
 * Start a periodic health check loop that verifies each managed instance
 * is still responding. Uses a two-tier probe strategy:
 *   1. Regular checks: lightweight TCP connect (zero application load)
 *   2. "Last chance": HTTP GET /session with extended timeout before killing
 *
 * After HEALTH_CHECK_FAIL_THRESHOLD consecutive TCP failures and a failed
 * last-chance HTTP check, the instance is marked dead. If it had active
 * sessions, auto-respawn is attempted (rate-limited).
 *
 * Called once after recovery completes.
 */
export function startHealthCheckLoop(): void {
  if (_g.__weaveHealthCheckInterval) return; // already running

  // Cycle counter for periodic (not every-tick) sweeps
  let _healthCheckCycle = 0;
  const PORT_COOLDOWN_SWEEP_EVERY_N_CYCLES = 5;
  const PORT_MAX_STUCK_MS =
    parseInt(process.env.WEAVE_PORT_MAX_STUCK_MS ?? "", 10) || 5 * 60 * 1000; // 5 minutes

  _g.__weaveHealthCheckInterval = setInterval(async () => {
    _healthCheckCycle++;
    // Collect running instances for parallel port checks
    const running = [...instances.entries()].filter(([, i]) => i.status === "running");

    // Parallel TCP port checks — all run concurrently
    const results = await Promise.allSettled(
      running.map(async ([id, instance]) => ({
        id,
        instance,
        alive: await tcpPortAlive(instance.port, HEALTH_CHECK_TIMEOUT_MS),
      }))
    );

    // Process results with failure-counting, last-chance verification, and auto-respawn
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { id, instance, alive } = result.value;
      if (alive) {
        // Recovery logging: if the instance previously had failures, log the recovery
        if (_healthFailCounts.has(id)) {
          log.info("process-manager", `Instance ${id} health check recovered after previous failures`, {
            instanceId: id, previousFails: _healthFailCounts.get(id),
          });
        }
        _healthFailCounts.delete(id);
      } else {
        const fails = (_healthFailCounts.get(id) ?? 0) + 1;
        _healthFailCounts.set(id, fails);

        if (fails >= HEALTH_CHECK_FAIL_THRESHOLD) {
          // "Last chance" — one final HTTP check with extended timeout before killing
          log.warn("process-manager", `Instance ${id} failed TCP health check ${fails} times — attempting last-chance HTTP verification`, {
            instanceId: id, fails, port: instance.port,
          });
          const lastChanceAlive = await httpHealthCheck(instance.url, HEALTH_CHECK_LAST_CHANCE_TIMEOUT_MS);
          if (lastChanceAlive) {
            log.info("process-manager", `Instance ${id} passed last-chance HTTP check — resetting failure count`, { instanceId: id });
            _healthFailCounts.delete(id);
            continue; // Skip death — instance is actually alive
          }

          // Truly dead — proceed with death handling
          log.warn("process-manager", `Instance ${id} failed last-chance HTTP check — marking dead`, {
            instanceId: id, fails, port: instance.port,
          });
          instance.status = "dead";
          _healthFailCounts.delete(id);

          // Stop session status watcher for this instance (prevents leaked watchers)
          stopWatching(id);
          // Force-clean hub subscription (cancels any pending reconnection)
          hubRemoveAllListeners(id);

          try {
            updateInstanceStatus(id, "stopped", new Date().toISOString());
          } catch (err) {
            log.warn("process-manager", "Failed to mark dead instance as stopped in DB", { instanceId: id, err });
          }

          let activeSessions: ReturnType<typeof getSessionsForInstance> = [];
          try {
            activeSessions = getSessionsForInstance(id);
            for (const session of activeSessions) {
              updateSessionStatus(session.id, "disconnected", new Date().toISOString());
            }
          } catch (err) {
            log.warn("process-manager", "Failed to cascade session disconnections after health check failure", { instanceId: id, err });
          }

          directoryToInstanceId.delete(instance.directory);
          releasePort(instance.port);
          instances.delete(id);

          // Attempt auto-respawn if the dead instance had active sessions
          if (activeSessions.length > 0) {
            // Fire-and-forget — don't block the health check loop
            void attemptRespawn(instance.directory, id);
          }
        } else {
          // Not yet at threshold — log the failure count
          log.warn("process-manager", `Instance ${id} TCP health check failed`, {
            instanceId: id, failCount: fails, threshold: HEALTH_CHECK_FAIL_THRESHOLD, port: instance.port,
          });
        }
      }
    }

    // Periodic cleanup: remove stale _respawnAttempts entries
    _cleanupStaleRespawnAttempts();

    // Periodic zombie port reclamation — run every N cycles to avoid overhead.
    // Re-checks expired cooldown ports and reclaims them if they're now free.
    if (_healthCheckCycle % PORT_COOLDOWN_SWEEP_EVERY_N_CYCLES === 0 && portCooldowns.size > 0) {
      const now = Date.now();
      const cooldownMs =
        parseInt(process.env.WEAVE_PORT_COOLDOWN_MS ?? "", 10) || 60_000;

      for (const [port, cooldownStart] of portCooldowns) {
        const elapsedMs = now - cooldownStart;

        // If cooldown has expired, check if the port is now free
        if (elapsedMs >= cooldownMs) {
          const free = await isPortAvailable(port);
          if (free) {
            // Port is available again — remove from cooldowns so it can be allocated
            portCooldowns.delete(port);
            log.info("process-manager", `Zombie port ${port} is now free — removed from cooldown`, { port, elapsedMs });
          } else {
            // Still occupied — log a warning; on Windows hint at the zombie PID
            if (elapsedMs >= PORT_MAX_STUCK_MS) {
              log.error("process-manager", `Port ${port} has been in cooldown for ${Math.round(elapsedMs / 1000)}s — possible zombie process. Manual intervention may be required.`, { port, elapsedMs });
            } else {
              log.warn("process-manager", `Port ${port} still in use after cooldown expiry — zombie process may still be running`, { port, elapsedMs });
            }
            // Reset cooldown timer so we re-check again after another cooldown period
            portCooldowns.set(port, now);
          }
        }
      }
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

// Start health checks after recovery completes (guarded by startHealthCheckLoop's idempotency)
_recoveryComplete.then(() => {
  startHealthCheckLoop();
  startCollector();
  // Ensure callback monitor is loaded — its self-initializing code starts the polling loop
  import("./callback-monitor").catch((err) => { log.warn("process-manager", "Failed to load callback monitor", { err }); });
}).catch((err) => { log.warn("process-manager", "Post-recovery startup tasks failed", { err }); });

// Clean up all instances when the Node.js process exits.
// Guard: only register once across Turbopack module re-evaluations to prevent
// MaxListenersExceededWarning from accumulating duplicate handlers.
if (!_g.__weaveSignalHandlersRegistered) {
  _g.__weaveSignalHandlersRegistered = true;
  process.on("exit", destroyAll);
  process.on("SIGTERM", () => {
    destroyAll();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    destroyAll();
    process.exit(0);
  });
  // SIGHUP is not supported on Windows — registering it throws an error.
  // Only register on non-Windows platforms.
  if (process.platform !== "win32") {
    process.on("SIGHUP", () => {
      destroyAll();
      process.exit(0);
    });
  }
  process.on("beforeExit", destroyAll);
  // Last-resort cleanup for uncaught exceptions — attempt to kill all instances
  // before re-throwing so processes aren't left as zombies on unexpected crashes.
  process.on("uncaughtException", (err) => {
    try {
      destroyAll();
    } catch {
      // Ignore cleanup errors — we're already in an error state
    }
    throw err;
  });
}
