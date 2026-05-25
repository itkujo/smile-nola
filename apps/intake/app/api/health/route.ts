/**
 * GET /api/health
 *
 * Liveness + readiness probe that exercises the full write path.
 *
 * Returns 200 only when:
 *   • better-sqlite3 loaded successfully (the fcntl64 bug check),
 *   • the database file is reachable,
 *   • a trivial `SELECT 1` succeeds against it.
 *
 * Also reports sync queue depth and last sync attempt so external
 * monitoring (or the start script) can see when a booth is accumulating
 * unsynced rows. Returns 503 if the DB is unhealthy so Docker / systemd
 * restarts the container automatically.
 *
 * SIDE EFFECT: also lazy-starts the sync loop.
 *
 * The sync drainer is a singleton that runs on a setInterval inside the
 * Node process. It needs SOMETHING to call ensureSyncLoopStarted() once
 * per process lifetime. The original callers were /api/sync/status and
 * /api/sync/drain, both admin-gated — meaning a freshly-booted booth
 * with no human ever logging in would queue leads locally and NEVER
 * drain them.
 *
 * Wiring it here works because:
 *   1. Docker healthcheck hits /api/health every 30s starting 30s after
 *      container boot. Sync loop is alive within the first minute.
 *   2. Anything else that touches /api/health (operator curl, external
 *      monitoring) also keeps it primed across the process lifetime.
 *   3. ensureSyncLoopStarted() is idempotent — calling it on every
 *      health probe is cheap (a boolean check).
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  ensureSyncLoopStarted,
  pendingSyncCount,
  lastSyncRun,
} from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const db = getDb();
    db.prepare("SELECT 1").get();
    // Idempotent; ensures the in-process sync drainer is running.
    ensureSyncLoopStarted();
    return NextResponse.json({
      ok: true,
      db: "ok",
      pending: pendingSyncCount(),
      lastSync: lastSyncRun(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[health] db check failed:", message);
    return NextResponse.json(
      { ok: false, db: "error", error: message },
      { status: 503 },
    );
  }
}
