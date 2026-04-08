/**
 * SDK Client Wrapper — convenience layer for API routes.
 * Retrieves the OpencodeClient for a managed instance and re-exports SDK types.
 */

import { getInstance, spawnInstance } from "./process-manager";
import type { ManagedInstance } from "./process-manager";
import {
  getSession,
  getSessionByOpencodeId,
  getInstance as getDbInstance,
  updateSessionInstanceId,
} from "./db-repository";
import { log } from "./logger";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";

// Re-export SDK types for use in API routes
export type { OpencodeClient };
export type {
  Session,
  Message,
  Part,
  FileDiff,
} from "@opencode-ai/sdk/v2";

/**
 * Retrieve the OpencodeClient for a running managed instance.
 * Throws if the instance is not found or is dead.
 */
export function getClientForInstance(instanceId: string): OpencodeClient {
  const instance = getInstance(instanceId);
  if (!instance) {
    throw new Error(`Instance not found: ${instanceId}`);
  }
  if (instance.status === "dead") {
    throw new Error(`Instance is dead: ${instanceId}`);
  }
  return instance.client;
}

/**
 * Ensure a live instance exists for a session, recovering lazily if the
 * instance is dead or missing after a fleet restart.
 *
 * Fast path: if the instance is already running in memory, return immediately.
 *
 * Slow path (lazy recovery):
 *  1. Look up the session in DB to find its directory.
 *  2. Call spawnInstance(directory) — which handles concurrent coalescing and
 *     directory dedup internally — to get or create a live instance.
 *  3. Update the session's instance_id FK so subsequent requests take the fast path.
 *  4. Return { instance, client }.
 *
 * This does NOT change the session's status or stopped_at — that is the
 * responsibility of the session-status-watcher or user-initiated resume.
 *
 * Throws if the session is not found in DB or if spawning fails.
 */
export async function ensureInstanceForSession(
  instanceId: string,
  sessionId: string
): Promise<{ instance: ManagedInstance; client: OpencodeClient }> {
  // Fast path: instance is alive in memory
  const existing = getInstance(instanceId);
  if (existing && existing.status === "running") {
    return { instance: existing, client: existing.client };
  }

  // Slow path: need to recover
  log.info("opencode-client", "Instance not available — attempting lazy recovery", {
    instanceId,
    sessionId,
  });

  // Look up session in DB to find directory (support both fleet DB id and opencode session id)
  const dbSession = getSession(sessionId) ?? getSessionByOpencodeId(sessionId);
  if (!dbSession) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const directory = dbSession.directory;

  // Spawn or reuse instance for this directory.
  // spawnInstance handles: directory dedup, concurrent coalescing, port allocation.
  const newInstance = await spawnInstance(directory);

  // Update the session's instance_id FK to point to the new instance
  if (newInstance.id !== dbSession.instance_id) {
    try {
      updateSessionInstanceId(dbSession.id, newInstance.id);
    } catch (err) {
      // Non-fatal: the session still works; the DB FK is just temporarily stale
      log.warn("opencode-client", "Failed to update session instance_id in DB", {
        sessionId: dbSession.id,
        newInstanceId: newInstance.id,
        err,
      });
    }
  }

  return { instance: newInstance, client: newInstance.client };
}

/**
 * Ensure a live instance exists by instance ID, recovering lazily if the
 * instance is dead or missing.
 *
 * Used by instance-scoped routes (models, agents, commands, find/files) that
 * receive only an instanceId and have no sessionId available.
 *
 * Fast path: instance running in memory — return it.
 *
 * Slow path: look up instance record in DB to get the directory, then spawn
 * a fresh instance for that directory.
 *
 * Throws if the instance record is not found in DB or if spawning fails.
 */
export async function ensureInstanceById(
  instanceId: string
): Promise<{ instance: ManagedInstance; client: OpencodeClient }> {
  // Fast path: instance alive in memory
  const existing = getInstance(instanceId);
  if (existing && existing.status === "running") {
    return { instance: existing, client: existing.client };
  }

  // Slow path: look up DB instance record for directory
  log.info("opencode-client", "Instance not available — recovering by instance id", {
    instanceId,
  });

  const dbInst = getDbInstance(instanceId);
  if (!dbInst) {
    throw new Error(`Instance not found: ${instanceId}`);
  }

  const newInstance = await spawnInstance(dbInst.directory);

  return { instance: newInstance, client: newInstance.client };
}
