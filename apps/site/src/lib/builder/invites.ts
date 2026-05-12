/**
 * CRUD for the `builder_invites` table.
 *
 * An invite is a URL-safe token an admin generates from an inquiry. The
 * recipient opens `/build?invite=<token>` and the page prefills from the
 * linked inquiry. First successful submission stamps `consumed_at` so the
 * admin UI can show "already used" badges.
 *
 * `createOrGetActiveInvite` is the canonical way to issue an invite — it
 * reuses any unconsumed invite for the same inquiry instead of churning
 * tokens. New tokens are minted only after the previous one is consumed.
 *
 * Every function takes the Database instance explicitly so unit tests can
 * inject an in-memory DB.
 */

import crypto from "node:crypto";
import type Database from "better-sqlite3";

export interface BuilderInviteRow {
  token: string;
  inquiry_id: number;
  created_at: string;
  expires_at: string | null;
  consumed_at: string | null;
  created_by: string;
}

/** 24 random bytes encoded as URL-safe base64 → 32 chars, no padding. */
function newToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * Return the inquiry's active (unconsumed) invite if one exists; otherwise
 * mint a new one. V1 invites never expire; `expires_at` is always null.
 * `created_by` defaults to "admin" — every v1 invite is admin-issued.
 */
export function createOrGetActiveInvite(
  db: Database.Database,
  inquiryId: number,
  createdBy: string = "admin",
): BuilderInviteRow {
  const existing = db
    .prepare(
      `SELECT * FROM builder_invites
       WHERE inquiry_id = ? AND consumed_at IS NULL
       ORDER BY created_at DESC, token ASC
       LIMIT 1`,
    )
    .get(inquiryId) as BuilderInviteRow | undefined;
  if (existing) return existing;

  const token = newToken();
  db.prepare(
    `INSERT INTO builder_invites (token, inquiry_id, expires_at, created_by)
     VALUES (?, ?, NULL, ?)`,
  ).run(token, inquiryId, createdBy);

  const row = db
    .prepare("SELECT * FROM builder_invites WHERE token = ?")
    .get(token) as BuilderInviteRow | undefined;
  if (!row) {
    // Should never happen — INSERT succeeded but SELECT couldn't find it.
    throw new Error("createOrGetActiveInvite: failed to read back inserted row");
  }
  return row;
}

export function getInvite(
  db: Database.Database,
  token: string,
): BuilderInviteRow | undefined {
  return db
    .prepare("SELECT * FROM builder_invites WHERE token = ?")
    .get(token) as BuilderInviteRow | undefined;
}

/**
 * Stamp `consumed_at` on first consumption. Returns true if the row was
 * updated (was unconsumed and existed); false if the token is unknown or
 * already consumed. Safe to call multiple times — idempotent semantics.
 */
export function markInviteConsumed(
  db: Database.Database,
  token: string,
): boolean {
  const r = db
    .prepare(
      `UPDATE builder_invites
       SET consumed_at = CURRENT_TIMESTAMP
       WHERE token = ? AND consumed_at IS NULL`,
    )
    .run(token);
  return r.changes > 0;
}
