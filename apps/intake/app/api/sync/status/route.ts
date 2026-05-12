/**
 * GET /api/sync/status
 *
 * Returns the count of pending booth captures (rows the booth wrote but
 * hasn't successfully pushed to prod yet) and the timestamp + outcome of
 * the most recent drain attempt. The booth admin polls this to show an
 * unobtrusive "X pending sync" badge.
 *
 * Admin-only — uses the same isAuthed() gate as the rest of the admin
 * surface. Public guests at the kiosk shouldn't be able to enumerate
 * sync health.
 *
 * As a side effect, hitting this endpoint starts the periodic auto-drain
 * loop if it isn't already running. That's how the loop comes up in
 * production: the booth admin loading once is enough to kick it off.
 */

import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { ensureSyncLoopStarted, lastSyncRun, pendingSyncCount } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthed(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthenticated" },
      { status: 401 },
    );
  }

  ensureSyncLoopStarted();

  return NextResponse.json({
    ok: true,
    pending: pendingSyncCount(),
    lastRun: lastSyncRun(),
    configured: Boolean(
      process.env.INTAKE_SYNC_URL && process.env.INTAKE_SYNC_TOKEN,
    ),
  });
}
