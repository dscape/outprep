/**
 * Session permissions management.
 *
 * Provides default permission scoping for agent sessions (filesystem, network,
 * tools) and CRUD for permission requests stored in the forge SQLite database.
 */

import { getForgeDb } from "../state/forge-db";
import { randomUUID } from "node:crypto";

/* ── Permission shape ────────────────────────────────────── */

export interface SessionPermissions {
  filesystem: {
    readAllow: string[];
    writeAllow: string[];
    writeDeny: string[];
  };
  network: {
    allowedDomains: string[];
    deniedDomains: string[];
  };
  tools: string[];
}

/**
 * Return the default permission set for a new session.
 * `worktreePath` is the sandbox root — agents can read/write inside it
 * plus the shared data directory.
 */
export function defaultPermissions(worktreePath: string): SessionPermissions {
  return {
    filesystem: {
      readAllow: [worktreePath, "packages/forge/data/"],
      writeAllow: [worktreePath],
      writeDeny: [".env", ".git/config"],
    },
    network: {
      allowedDomains: ["api.anthropic.com", "lichess.org", "api.search.brave.com"],
      deniedDomains: [],
    },
    tools: ["eval", "code", "config", "knowledge", "oracle", "web"],
  };
}

/* ── Permission requests ─────────────────────────────────── */

/**
 * Insert a new permission request into the database.
 * Returns the generated request ID.
 */
export function requestPermission(
  sessionId: string,
  agentId: string | null,
  permissionType: string,
  details: Record<string, any>,
): string {
  const db = getForgeDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO permission_requests (id, session_id, agent_id, requested_at, permission_type, details, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(id, sessionId, agentId, new Date().toISOString(), permissionType, JSON.stringify(details));
  return id;
}

/**
 * Approve a pending permission request.
 * Returns true if a row was updated (i.e. the request existed and was pending).
 */
export function approvePermission(requestId: string, respondedBy: string = "admin"): boolean {
  const db = getForgeDb();
  const result = db.prepare(`
    UPDATE permission_requests SET status = 'approved', responded_at = ?, response_by = ?
    WHERE id = ? AND status = 'pending'
  `).run(new Date().toISOString(), respondedBy, requestId);
  return result.changes > 0;
}

/**
 * Reject a pending permission request.
 * Returns true if a row was updated.
 */
export function rejectPermission(requestId: string, respondedBy: string = "admin"): boolean {
  const db = getForgeDb();
  const result = db.prepare(`
    UPDATE permission_requests SET status = 'rejected', responded_at = ?, response_by = ?
    WHERE id = ? AND status = 'pending'
  `).run(new Date().toISOString(), respondedBy, requestId);
  return result.changes > 0;
}

/**
 * List pending permission requests.
 * Optionally filter by agent ID.
 */
export function getPendingPermissions(agentId?: string): any[] {
  const db = getForgeDb();
  if (agentId) {
    return db.prepare(
      `SELECT * FROM permission_requests WHERE agent_id = ? AND status = 'pending' ORDER BY requested_at DESC`,
    ).all(agentId);
  }
  return db.prepare(
    `SELECT * FROM permission_requests WHERE status = 'pending' ORDER BY requested_at DESC`,
  ).all();
}

/**
 * Read the permissions JSON stored on a session row.
 * Returns null if no permissions are set or the session doesn't exist.
 */
export function getSessionPermissions(sessionId: string): SessionPermissions | null {
  const db = getForgeDb();
  const row = db.prepare(`SELECT permissions FROM sessions WHERE id = ?`).get(sessionId) as
    | { permissions: string | null }
    | undefined;
  if (!row?.permissions) return null;
  try {
    return JSON.parse(row.permissions) as SessionPermissions;
  } catch {
    return null;
  }
}
