import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import type {
  StandaloneUpdateLifecycleState,
  StandaloneUpdateStatusResponse,
  UpdateChannel,
} from "@/lib/api-types";
import { emitStandaloneUpdate } from "@/lib/server/activity-emitter";
import { getCurrentVersion } from "@/lib/server/version-check";
import { getInstallRuntimeMetadata } from "@/lib/server/standalone-update-state";
import { spawnDetachedStandaloneUpdateHelper } from "@/lib/server/standalone-update-helper";

interface PersistedStandaloneUpdateState {
  state: StandaloneUpdateLifecycleState;
  channel: UpdateChannel | null;
  targetVersion: string | null;
  error: string | null;
  startedAt: string | null;
  updatedAt: string;
  reconnectHint: string | null;
}

const ACTIVE_STATES = new Set<StandaloneUpdateLifecycleState>([
  "scheduled",
  "stopping",
  "installing",
  "restarting",
]);

function getStandaloneStatePath(): string {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    return join(base, "weave", "standalone-update.json");
  }
  return join(homedir(), ".weave", "standalone-update.json");
}

function readPersistedState(): PersistedStandaloneUpdateState {
  const statePath = getStandaloneStatePath();
  if (!existsSync(statePath)) {
    return {
      state: "idle",
      channel: null,
      targetVersion: null,
      error: null,
      startedAt: null,
      updatedAt: new Date().toISOString(),
      reconnectHint: null,
    };
  }

  try {
    const raw = readFileSync(statePath, "utf-8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw) as PersistedStandaloneUpdateState;
    return parsed;
  } catch {
    return {
      state: "failed",
      channel: null,
      targetVersion: null,
      error: "Corrupted standalone update state file.",
      startedAt: null,
      updatedAt: new Date().toISOString(),
      reconnectHint: null,
    };
  }
}

function persistState(next: PersistedStandaloneUpdateState): void {
  const statePath = getStandaloneStatePath();
  mkdirSync(dirname(statePath), { recursive: true });

  const tempPath = `${statePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(next, null, 2), "utf-8");
  renameSync(tempPath, statePath);
}

function emitState(message: string, state: PersistedStandaloneUpdateState): void {
  emitStandaloneUpdate({
    type: "standalone_update",
    state: state.state,
    channel: state.channel,
    message,
    at: state.updatedAt,
    error: state.error ?? undefined,
  });
}

function toResponse(state: PersistedStandaloneUpdateState): StandaloneUpdateStatusResponse {
  return {
    mode: "standalone",
    state: state.state,
    channel: state.channel,
    targetVersion: state.targetVersion,
    currentVersion: getCurrentVersion() ?? "dev",
    error: state.error,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    reconnectHint: state.reconnectHint,
  };
}

export function getStandaloneUpdateStatus(): StandaloneUpdateStatusResponse {
  return toResponse(readPersistedState());
}

export function resetStandaloneUpdateState(): void {
  const statePath = getStandaloneStatePath();
  if (existsSync(statePath)) {
    unlinkSync(statePath);
  }
}

export function scheduleStandaloneUpdate(channel: UpdateChannel): StandaloneUpdateStatusResponse {
  const runtime = getInstallRuntimeMetadata();
  if (runtime.installFlavor !== "standalone" || !runtime.canSelfUpdate || !runtime.standaloneContext) {
    throw new Error("Standalone self-update is unavailable in this runtime.");
  }

  const current = readPersistedState();
  if (ACTIVE_STATES.has(current.state)) {
    throw new Error("A standalone update is already in progress.");
  }

  const startedAt = new Date().toISOString();
  const scheduled: PersistedStandaloneUpdateState = {
    state: "scheduled",
    channel,
    targetVersion: null,
    error: null,
    startedAt,
    updatedAt: startedAt,
    reconnectHint: "Server will restart while update installs.",
  };

  persistState(scheduled);
  emitState(`Standalone ${channel} update scheduled.`, scheduled);

  try {
    spawnDetachedStandaloneUpdateHelper({
      context: runtime.standaloneContext,
      channel,
      stateFilePath: getStandaloneStatePath(),
    });
  } catch (error) {
    const failedAt = new Date().toISOString();
    const failed: PersistedStandaloneUpdateState = {
      ...scheduled,
      state: "failed",
      error: error instanceof Error ? error.message : "Failed to start detached update helper.",
      updatedAt: failedAt,
    };
    persistState(failed);
    emitState("Standalone update failed to start.", failed);
    return toResponse(failed);
  }

  const stoppingAt = new Date().toISOString();
  const stopping: PersistedStandaloneUpdateState = {
    ...scheduled,
    state: "stopping",
    updatedAt: stoppingAt,
  };
  persistState(stopping);
  emitState("Standalone update handoff in progress; server is stopping.", stopping);

  setTimeout(() => {
    process.kill(process.pid, "SIGTERM");
  }, 200);

  return toResponse(stopping);
}
