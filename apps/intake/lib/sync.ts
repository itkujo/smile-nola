/**
 * Booth -> prod one-way sync drainer.
 *
 * Periodically scans `inquiries` for rows we wrote locally that haven't
 * been pushed to prod yet (`synced_at IS NULL`), POSTs them to the
 * production sync endpoint, and stamps `synced_at` on success.
 *
 * Designed for offline-tolerance: if the network is down or the prod
 * server is unreachable, the drainer logs a warning and tries again on
 * the next tick. Local rows persist in SQLite indefinitely; nothing is
 * lost waiting for connectivity.
 *
 * Auth: bearer token (INTAKE_SYNC_TOKEN) shared with the prod endpoint
 * via env. Service-to-service; not the same as the booth admin password.
 *
 * Configuration env vars (all optional; the drainer no-ops if URL/token
 * is missing, which is the right behavior for local dev):
 *   INTAKE_SYNC_URL       full URL to the prod sync endpoint
 *                         (e.g. https://smile-nola.com/api/sync/inquiries)
 *   INTAKE_SYNC_TOKEN     bearer token; must match the prod env value
 *   INTAKE_SYNC_INTERVAL  ms between automatic drain attempts (default
 *                         30000). Set to 0 to disable the auto-loop and
 *                         only run on explicit /api/sync/drain calls.
 */

import { getDb } from "./db";

const DEFAULT_INTERVAL_MS = 30_000;
const BATCH_SIZE = 50;

declare global {
  // eslint-disable-next-line no-var
  var __sn_sync_started: boolean | undefined;
  // eslint-disable-next-line no-var
  var __sn_sync_in_flight: boolean | undefined;
  // eslint-disable-next-line no-var
  var __sn_sync_last_run: { at: string; ok: boolean; message: string } | undefined;
}

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

export interface SyncRunResult {
  attempted: number;
  inserted: number;
  duplicates: number;
  ok: boolean;
  message: string;
}

/**
 * Count rows pending push to prod.
 */
export function pendingSyncCount(): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM inquiries
       WHERE source = 'booth-expo'
         AND external_uuid IS NOT NULL
         AND synced_at IS NULL
         AND deleted_at IS NULL`,
    )
    .get() as { n: number };
  return row.n;
}

/**
 * Drain pending rows in a single batch. Safe to call concurrently — the
 * `__sn_sync_in_flight` guard prevents two drains from running at once.
 * Returns a structured result so callers (drain endpoint, scheduler) can
 * react and log.
 */
export async function runSyncOnce(): Promise<SyncRunResult> {
  if (globalThis.__sn_sync_in_flight) {
    return {
      attempted: 0,
      inserted: 0,
      duplicates: 0,
      ok: false,
      message: "drain already in flight",
    };
  }

  const url = (process.env.INTAKE_SYNC_URL ?? "").trim();
  const token = (process.env.INTAKE_SYNC_TOKEN ?? "").trim();
  if (!url || !token) {
    return {
      attempted: 0,
      inserted: 0,
      duplicates: 0,
      ok: false,
      message:
        "INTAKE_SYNC_URL / INTAKE_SYNC_TOKEN not configured — sync disabled",
    };
  }

  globalThis.__sn_sync_in_flight = true;
  try {
    const db = getDb();
    const pending = db
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
         WHERE source = 'booth-expo'
           AND external_uuid IS NOT NULL
           AND synced_at IS NULL
           AND deleted_at IS NULL
         ORDER BY created_at ASC
         LIMIT ${BATCH_SIZE}`,
      )
      .all() as PendingRow[];

    if (pending.length === 0) {
      const result: SyncRunResult = {
        attempted: 0,
        inserted: 0,
        duplicates: 0,
        ok: true,
        message: "nothing to sync",
      };
      recordRun(result);
      return result;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ inquiries: pending }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const result: SyncRunResult = {
        attempted: pending.length,
        inserted: 0,
        duplicates: 0,
        ok: false,
        message: `network error: ${message}`,
      };
      recordRun(result);
      console.warn(`[sync] network error draining ${pending.length} rows:`, message);
      return result;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const result: SyncRunResult = {
        attempted: pending.length,
        inserted: 0,
        duplicates: 0,
        ok: false,
        message: `prod returned ${res.status}: ${body.slice(0, 200)}`,
      };
      recordRun(result);
      console.warn(
        `[sync] prod responded ${res.status} for batch of ${pending.length} rows:`,
        body.slice(0, 200),
      );
      return result;
    }

    interface SyncResponse {
      ok: boolean;
      results?: { external_uuid: string; inserted: boolean; id: number }[];
    }
    const parsed = (await res.json().catch(() => ({}))) as SyncResponse;
    if (!parsed.ok || !Array.isArray(parsed.results)) {
      const result: SyncRunResult = {
        attempted: pending.length,
        inserted: 0,
        duplicates: 0,
        ok: false,
        message: "prod response shape invalid",
      };
      recordRun(result);
      return result;
    }

    // Stamp synced_at = CURRENT_TIMESTAMP for every UUID prod acknowledged
    // (whether it inserted fresh OR reported a duplicate — either way the
    // row IS in prod and we don't need to retry).
    const stamp = db.prepare(
      `UPDATE inquiries SET synced_at = CURRENT_TIMESTAMP
       WHERE external_uuid = ? AND synced_at IS NULL`,
    );
    let inserted = 0;
    let duplicates = 0;
    const tx = db.transaction((rows: { external_uuid: string; inserted: boolean }[]) => {
      for (const r of rows) {
        stamp.run(r.external_uuid);
        if (r.inserted) inserted += 1;
        else duplicates += 1;
      }
    });
    tx(parsed.results);

    const result: SyncRunResult = {
      attempted: pending.length,
      inserted,
      duplicates,
      ok: true,
      message:
        `pushed ${pending.length} rows; ` +
        `prod inserted ${inserted}, deduped ${duplicates}`,
    };
    recordRun(result);
    return result;
  } finally {
    globalThis.__sn_sync_in_flight = false;
  }
}

function recordRun(result: SyncRunResult): void {
  globalThis.__sn_sync_last_run = {
    at: new Date().toISOString(),
    ok: result.ok,
    message: result.message,
  };
}

export function lastSyncRun(): { at: string; ok: boolean; message: string } | null {
  return globalThis.__sn_sync_last_run ?? null;
}

/**
 * Start the periodic auto-drain. Idempotent — calling twice is a no-op.
 * In dev (next dev), module reloads sometimes lose the timer; the
 * `__sn_sync_started` global flag survives those reloads only when the
 * underlying Node process stays up (which it does in `next dev`).
 *
 * The first request to /api/sync/status or /api/sync/drain imports this
 * file and starts the loop. We deliberately do NOT start it from server
 * module init because Next.js may evaluate the route module on the edge
 * runtime where setInterval isn't reliable. Lazy-start from a Node-runtime
 * route handler is more predictable.
 */
export function ensureSyncLoopStarted(): void {
  if (globalThis.__sn_sync_started) return;
  const intervalRaw = process.env.INTAKE_SYNC_INTERVAL;
  const interval =
    intervalRaw === undefined || intervalRaw === ""
      ? DEFAULT_INTERVAL_MS
      : Number.parseInt(intervalRaw, 10);
  if (!Number.isFinite(interval) || interval <= 0) {
    globalThis.__sn_sync_started = true;
    return; // explicitly disabled
  }
  globalThis.__sn_sync_started = true;
  console.log(`[sync] starting auto-drain every ${interval}ms`);
  setInterval(() => {
    runSyncOnce().catch((err) => {
      console.warn("[sync] auto-drain threw:", err);
    });
  }, interval).unref?.();
}
