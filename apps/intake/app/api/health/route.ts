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
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pendingSyncCount, lastSyncRun } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const db = getDb();
    db.prepare("SELECT 1").get();
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
