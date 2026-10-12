/**
 * API tokens: "sn_" + 43 base64url chars (32 random bytes). Only the sha256
 * hex of the token is stored (api_tokens.token_hash); the token itself is
 * returned once, by createToken.
 */

import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";

export const TOKEN_PREFIX = "sn_";

let dbOverride: Database.Database | null = null;

/** Tests point the token store at a :memory: database. */
export function _setTokenDb(db: Database.Database | null): void {
  dbOverride = db;
}

function db(): Database.Database {
  return dbOverride ?? getDb();
}

export interface TokenRecord {
  id: number;
  label: string;
  scopes: string[];
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface TokenRow {
  id: number;
  label: string;
  token_hash: string;
  scopes: string;
  expires_at: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function toRecord(r: TokenRow): TokenRecord {
  let scopes: string[] = [];
  try {
    const parsed = JSON.parse(r.scopes);
    if (Array.isArray(parsed)) scopes = parsed.filter((s): s is string => typeof s === "string");
  } catch {
    scopes = [];
  }
  return {
    id: r.id,
    label: r.label,
    scopes,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
  };
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateToken(): string {
  return TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
}

export function createToken(input: {
  label: string;
  scopes: string[];
  expiresAt?: string | null;
}): { token: string; record: TokenRecord } {
  const token = generateToken();
  const now = new Date().toISOString();
  const scopes = [...new Set(input.scopes)];
  const info = db()
    .prepare(
      `INSERT INTO api_tokens (label, token_hash, scopes, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.label, hashToken(token), JSON.stringify(scopes), input.expiresAt ?? null, now);
  const record = getToken(Number(info.lastInsertRowid));
  if (!record) throw new Error("token insert vanished");
  return { token, record };
}

export function getToken(id: number): TokenRecord | undefined {
  const r = db().prepare(`SELECT * FROM api_tokens WHERE id = ?`).get(id) as TokenRow | undefined;
  return r ? toRecord(r) : undefined;
}

/** Newest first. `beforeId` is the paging cursor (exclusive). */
export function listTokens(opts: { take: number; beforeId?: number }): TokenRecord[] {
  const rows = (
    opts.beforeId === undefined
      ? db().prepare(`SELECT * FROM api_tokens ORDER BY id DESC LIMIT ?`).all(opts.take)
      : db()
          .prepare(`SELECT * FROM api_tokens WHERE id < ? ORDER BY id DESC LIMIT ?`)
          .all(opts.beforeId, opts.take)
  ) as TokenRow[];
  return rows.map(toRecord);
}

export type RevokeResult = "revoked" | "missing" | "already_revoked";

export function revokeToken(id: number): RevokeResult {
  const existing = getToken(id);
  if (!existing) return "missing";
  if (existing.revokedAt) return "already_revoked";
  db().prepare(`UPDATE api_tokens SET revoked_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  return "revoked";
}

export function findTokenByValue(token: string): TokenRecord | undefined {
  if (!token.startsWith(TOKEN_PREFIX)) return undefined;
  const r = db()
    .prepare(`SELECT * FROM api_tokens WHERE token_hash = ?`)
    .get(hashToken(token)) as TokenRow | undefined;
  return r ? toRecord(r) : undefined;
}

export function touchToken(id: number): void {
  db().prepare(`UPDATE api_tokens SET last_used_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
}
