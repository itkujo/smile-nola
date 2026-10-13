/**
 * Booth -> prod one-way sync.
 *
 * In booth mode (SMILE_NOLA_MODE=booth) a loop drains unsynced booth rows to
 * <BOOTH_PROD_API_URL>/api/v1/sync/inquiries with a write:sync bearer token.
 * Rows go as { inquiries: [...] }; prod upserts on external_uuid, so a retry
 * is harmless. Each acknowledged row gets synced_at stamped locally.
 *
 * Offline-tolerant: a network or server failure is logged and retried on the
 * next tick; local rows persist in SQLite until they are acknowledged.
 */

import type Database from "better-sqlite3";
import { BOOTH_SOURCE } from "./schema";
import {
  isSyncConfigured,
  readBoothConfig,
  syncEndpoint,
  type BoothConfig,
} from "./config";
import { boothCounts, boothDb } from "./store";

export const BATCH_SIZE = 50;
const MAX_BATCHES_PER_DRAIN = 20;

interface PendingRow {
  external_uuid: string;
  created_at: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  preferred_contact: string | null;
  event_date: string | null;
  venue: string | null;
  collections_interested: string | null;
  notes: string | null;
  partner1_name: string | null;
  partner2_name: string | null;
  event_setting: string | null;
  poc_relationship: string | null;
  venue_street_address: string | null;
  venue_city: string | null;
  venue_state: string | null;
  venue_postal_code: string | null;
  venue_country: string | null;
  venue_latitude: number | null;
  venue_longitude: number | null;
}

export interface DrainResult {
  ok: boolean;
  /** Rows sent to prod this run. */
  attempted: number;
  /** Rows prod stored as new. */
  inserted: number;
  /** Rows prod already had (acknowledged, not re-stored). */
  duplicates: number;
  /** Rows still waiting afterwards. */
  pending: number;
  message: string;
}

export interface LastRun {
  at: string;
  ok: boolean;
  message: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __sn_booth_sync_started: boolean | undefined;
  // eslint-disable-next-line no-var
  var __sn_booth_sync_in_flight: boolean | undefined;
  // eslint-disable-next-line no-var
  var __sn_booth_sync_last: LastRun | undefined;
}

export function lastSyncRun(): LastRun | null {
  return globalThis.__sn_booth_sync_last ?? null;
}

export function _resetSyncState(): void {
  globalThis.__sn_booth_sync_in_flight = false;
  globalThis.__sn_booth_sync_last = undefined;
}

export function pendingRows(limit: number, db: Database.Database): PendingRow[] {
  return db
    .prepare(
      `SELECT external_uuid, created_at,
              first_name, last_name, email, phone,
              preferred_contact, event_date, venue,
              collections_interested, notes,
              partner1_name, partner2_name, event_setting, poc_relationship,
              venue_street_address, venue_city, venue_state,
              venue_postal_code, venue_country,
              venue_latitude, venue_longitude
       FROM inquiries
       WHERE source = '${BOOTH_SOURCE}'
         AND external_uuid IS NOT NULL
         AND synced_at IS NULL
         AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC
       LIMIT ?`,
    )
    .all(limit) as PendingRow[];
}

export interface DrainOptions {
  db?: Database.Database;
  config?: BoothConfig;
  fetch?: typeof fetch;
}

type BatchOutcome =
  | { kind: "acked"; uuids: string[]; inserted: number; duplicates: number }
  | { kind: "rejected"; status: number; message: string }
  | { kind: "failed"; message: string };

async function postBatch(
  rows: PendingRow[],
  url: string,
  token: string,
  doFetch: typeof fetch,
): Promise<BatchOutcome> {
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ inquiries: rows }),
    });
  } catch (err) {
    return { kind: "failed", message: `network error: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { kind: "rejected", status: res.status, message: `prod returned ${res.status}: ${body.slice(0, 200)}` };
  }
  const parsed = (await res.json().catch(() => null)) as {
    ok?: boolean;
    results?: unknown;
    data?: unknown;
  } | null;
  if (!parsed || parsed.ok === false) {
    return { kind: "failed", message: "prod response not understood" };
  }
  const list = Array.isArray(parsed.results) ? parsed.results : Array.isArray(parsed.data) ? parsed.data : null;
  if (!list) return { kind: "failed", message: "prod response had no results list" };
  const uuids: string[] = [];
  let inserted = 0;
  let duplicates = 0;
  for (const item of list) {
    const r = item as { external_uuid?: unknown; externalUuid?: unknown; inserted?: unknown };
    const uuid = r.external_uuid ?? r.externalUuid;
    if (typeof uuid !== "string") continue;
    uuids.push(uuid);
    if (r.inserted === false) duplicates += 1;
    else inserted += 1;
  }
  return { kind: "acked", uuids, inserted, duplicates };
}

/**
 * Push pending rows to prod, a batch at a time, until none are left or a
 * batch fails. Only one drain runs at a time per process.
 */
export async function drainOnce(opts: DrainOptions = {}): Promise<DrainResult> {
  const cfg = opts.config ?? readBoothConfig();
  const db = boothDb(opts.db);
  const doFetch = opts.fetch ?? fetch;

  const finish = (r: Omit<DrainResult, "pending">): DrainResult => {
    const result = { ...r, pending: boothCounts(db).pending };
    globalThis.__sn_booth_sync_last = { at: new Date().toISOString(), ok: r.ok, message: r.message };
    if (!r.ok) console.warn(`[booth-sync] ${r.message}`);
    return result;
  };

  if (globalThis.__sn_booth_sync_in_flight) {
    return { ok: false, attempted: 0, inserted: 0, duplicates: 0, pending: boothCounts(db).pending, message: "a drain is already running" };
  }
  const url = syncEndpoint(cfg);
  if (!url || !isSyncConfigured(cfg)) {
    return finish({
      ok: false, attempted: 0, inserted: 0, duplicates: 0,
      message: "BOOTH_PROD_API_URL / BOOTH_PROD_API_TOKEN not set; sync is off",
    });
  }

  globalThis.__sn_booth_sync_in_flight = true;
  try {
    const stamp = db.prepare(
      "UPDATE inquiries SET synced_at = ? WHERE external_uuid = ? AND synced_at IS NULL",
    );
    const ack = db.transaction((uuids: string[]) => {
      const at = new Date().toISOString();
      for (const u of uuids) stamp.run(at, u);
    });

    let attempted = 0;
    let inserted = 0;
    let duplicates = 0;

    for (let i = 0; i < MAX_BATCHES_PER_DRAIN; i++) {
      const rows = pendingRows(BATCH_SIZE, db);
      if (rows.length === 0) break;

      let outcome = await postBatch(rows, url, cfg.prodApiToken, doFetch);

      // One bad row makes prod refuse the whole batch (400). Resend singly so
      // the good rows still flow and only the bad one stays pending.
      if (outcome.kind === "rejected" && outcome.status === 400 && rows.length > 1) {
        const uuids: string[] = [];
        let ins = 0;
        let dup = 0;
        for (const row of rows) {
          const single = await postBatch([row], url, cfg.prodApiToken, doFetch);
          if (single.kind === "acked") {
            uuids.push(...single.uuids);
            ins += single.inserted;
            dup += single.duplicates;
          } else if (single.kind === "failed") {
            outcome = single;
            break;
          }
        }
        if (outcome.kind !== "failed") {
          outcome = { kind: "acked", uuids, inserted: ins, duplicates: dup };
          if (uuids.length === 0) {
            outcome = { kind: "rejected", status: 400, message: "prod rejected every row in the batch" };
          }
        }
      }

      attempted += rows.length;
      if (outcome.kind !== "acked") {
        return finish({ ok: false, attempted, inserted, duplicates, message: outcome.message });
      }
      ack(outcome.uuids);
      inserted += outcome.inserted;
      duplicates += outcome.duplicates;
      // Nothing acknowledged would loop on the same rows; stop.
      if (outcome.uuids.length === 0) {
        return finish({ ok: false, attempted, inserted, duplicates, message: "prod acknowledged no rows" });
      }
    }

    return finish({
      ok: true,
      attempted,
      inserted,
      duplicates,
      message:
        attempted === 0
          ? "nothing to sync"
          : `pushed ${attempted} row(s); prod stored ${inserted}, already had ${duplicates}`,
    });
  } finally {
    globalThis.__sn_booth_sync_in_flight = false;
  }
}

export interface SyncStatus {
  mode: "booth" | "prod";
  configured: boolean;
  /** Prod origin the drain posts to, without the token; null when unset. */
  target: string | null;
  intervalMs: number;
  loopRunning: boolean;
  total: number;
  pending: number;
  synced: number;
  lastRun: LastRun | null;
}

export function syncStatus(db?: Database.Database, cfg: BoothConfig = readBoothConfig()): SyncStatus {
  const counts = boothCounts(db);
  return {
    mode: cfg.mode,
    configured: isSyncConfigured(cfg),
    target: cfg.prodApiUrl || null,
    intervalMs: cfg.syncIntervalMs,
    loopRunning: globalThis.__sn_booth_sync_started === true && cfg.mode === "booth" && cfg.syncIntervalMs > 0,
    ...counts,
    lastRun: lastSyncRun(),
  };
}

/**
 * Start the periodic drain. A no-op outside booth mode, when the interval
 * is 0 (manual only) and on every call after the first. Astro has no
 * server-start hook, so this runs when the booth page or the API router
 * first loads (the compose healthcheck makes that happen right after boot).
 */
export function ensureSyncLoop(): void {
  if (globalThis.__sn_booth_sync_started) return;
  const cfg = readBoothConfig();
  if (cfg.mode !== "booth" || cfg.syncIntervalMs <= 0) return;
  globalThis.__sn_booth_sync_started = true;
  console.log(`[booth-sync] draining to ${cfg.prodApiUrl || "(BOOTH_PROD_API_URL unset)"} every ${cfg.syncIntervalMs}ms`);
  const timer = setInterval(() => {
    drainOnce().catch((err) => console.warn("[booth-sync] drain threw:", err));
  }, cfg.syncIntervalMs);
  timer.unref?.();
}
