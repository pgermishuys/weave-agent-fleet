/**
 * Database module — server-side SQLite singleton via better-sqlite3.
 *
 * The database file is stored at ~/.weave/fleet.db by default.
 * Override with the WEAVE_DB_PATH environment variable.
 *
 * Uses WAL mode for concurrent read performance and a busy_timeout
 * to handle write contention in Next.js dev mode.
 */

import Database from "better-sqlite3";
import { mkdirSync, rmSync } from "fs";
import { homedir } from "os";
import { dirname, resolve } from "path";

function getDbPath(): string {
  if (process.env.WEAVE_DB_PATH) {
    return resolve(process.env.WEAVE_DB_PATH);
  }
  return resolve(homedir(), ".weave", "fleet.db");
}

let _db: Database.Database | null = null;

/**
 * Returns the singleton database instance.
 * Creates the database file and schema on first call.
 */
export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = getDbPath();

  // Ensure the parent directory exists
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  // Enable WAL mode for concurrent reads + write contention handling
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  // Create schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      directory TEXT NOT NULL,
      source_directory TEXT,
      isolation_strategy TEXT NOT NULL DEFAULT 'existing',
      branch TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      cleaned_up_at TEXT
    );

    CREATE TABLE IF NOT EXISTS instances (
      id TEXT PRIMARY KEY,
      port INTEGER NOT NULL,
      pid INTEGER,
      directory TEXT NOT NULL,
      url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      stopped_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      instance_id TEXT NOT NULL REFERENCES instances(id),
      opencode_session_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Untitled',
      status TEXT NOT NULL DEFAULT 'active',
      directory TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      stopped_at TEXT
    );

    CREATE TABLE IF NOT EXISTS session_callbacks (
      id TEXT PRIMARY KEY,
      source_session_id TEXT NOT NULL,
      target_session_id TEXT NOT NULL,
      target_instance_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      fired_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_callbacks_source ON session_callbacks(source_session_id, status);

    CREATE TABLE IF NOT EXISTS workspace_roots (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrations — wrapped in try/catch since columns may already exist
  try {
    db.exec(`ALTER TABLE workspaces ADD COLUMN display_name TEXT`);
  } catch {
    // Column already exists — ignore
  }

  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN parent_session_id TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Phase 3: add activity_status and lifecycle_status columns
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN activity_status TEXT`);
  } catch {
    // Column already exists — ignore
  }

  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN lifecycle_status TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Add index on sessions.status for efficient status-based queries
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`);

  // Add index on sessions.parent_session_id for efficient child lookups
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id)`);

  _db = db;
  return db;
}

/**
 * Reset the database for tests — closes the connection and deletes the file.
 * Only use in test environments.
 */
export function _resetDbForTests(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
  const dbPath = getDbPath();
  rmSync(dbPath, { force: true });
}
