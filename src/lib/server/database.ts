/**
 * Database module — server-side SQLite singleton via better-sqlite3.
 *
 * The database file location is resolved by the profile module:
 *   - Default profile: ~/.weave/fleet.db
 *   - Named profiles:  ~/.weave/profiles/<name>/fleet.db
 * Override with the WEAVE_DB_PATH environment variable (takes precedence).
 *
 * Uses WAL mode for concurrent read performance and a busy_timeout
 * to handle write contention in Next.js dev mode.
 */

import Database from "better-sqlite3";
import { mkdirSync, rmSync } from "fs";
import { dirname } from "path";
import { getProfileDbPath } from "./profile";

let _db: Database.Database | null = null;

/**
 * Returns the singleton database instance.
 * Creates the database file and schema on first call.
 */
export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = getProfileDbPath();

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

  // Phase 5: add total_tokens and total_cost columns for per-session token tracking
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN total_tokens INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN total_cost REAL NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — ignore
  }

  // Smart links: detected links and user-dismissed link URLs per session
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN smart_links TEXT`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN dismissed_smart_links TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Add index on sessions.status for efficient status-based queries
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`);

  // Add index on sessions.parent_session_id for efficient child lookups
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id)`);

  // Add index on sessions.created_at for efficient paginated queries (ORDER BY created_at DESC)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC)`);

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
  const dbPath = getProfileDbPath();
  rmSync(dbPath, { force: true });
}
