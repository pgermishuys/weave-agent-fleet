/**
 * Token manager — generation, hashing, persistence, and verification
 * of the Fleet API bearer token.
 *
 * The hashed token is stored at ~/.weave/api-token.hash, alongside fleet.db.
 * The plaintext token is only ever returned at generation time — it is
 * never stored on disk.
 */

import { randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname } from "path";
import * as bcrypt from "bcryptjs";
import { getTokenHashPath } from "@/cli/config-paths";

/**
 * Returns true if a token hash file already exists on disk.
 */
export function tokenExists(): boolean {
  return existsSync(getTokenHashPath());
}

/**
 * Generate a cryptographically random 32-byte token (64-char hex string),
 * hash it with bcrypt (rounds=12), persist the hash to disk, and return
 * the plaintext token. The caller must print and discard it — it is never
 * stored on disk.
 *
 * Throws if the hash file already exists — call tokenExists() first.
 */
export async function generateAndPersistToken(): Promise<string> {
  const hashPath = getTokenHashPath();

  if (existsSync(hashPath)) {
    throw new Error(
      `Token hash already exists at ${hashPath}. Call rotateToken() to replace it.`
    );
  }

  const token = randomBytes(32).toString("hex");
  const hash = await bcrypt.hash(token, 12);

  // Ensure ~/.weave/ directory exists
  mkdirSync(dirname(hashPath), { recursive: true });

  writeFileSync(hashPath, hash, { encoding: "utf8", mode: 0o600 });

  return token;
}

/**
 * Rotate: delete the existing hash, generate a new token, persist it,
 * and return the plaintext. Safe to call only when the server is stopped.
 *
 * Throws if the existing hash file cannot be deleted.
 */
export async function rotateToken(): Promise<string> {
  const hashPath = getTokenHashPath();

  if (existsSync(hashPath)) {
    // This will throw if deletion fails — do not silently continue
    unlinkSync(hashPath);
  }

  return generateAndPersistToken();
}

/**
 * Verify a presented bearer token against the stored hash.
 * Returns true if valid, false otherwise.
 * Returns false (not throws) if no hash file exists.
 */
export async function verifyToken(presented: string): Promise<boolean> {
  const hashPath = getTokenHashPath();

  if (!existsSync(hashPath)) {
    return false;
  }

  try {
    const storedHash = readFileSync(hashPath, { encoding: "utf8" }).trim();
    return await bcrypt.compare(presented, storedHash);
  } catch {
    // File read or bcrypt errors should not crash the middleware — return false
    return false;
  }
}
