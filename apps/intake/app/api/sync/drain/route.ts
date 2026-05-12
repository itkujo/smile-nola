/**
 * POST /api/sync/drain
 *
 * Manually triggers one drain pass. Returns the result of the run
 * (attempted/inserted/duplicates/message). Useful for "I want to sync NOW
 * before closing the laptop at the end of the expo" workflows, and as the
 * button the booth admin click-trigger calls.
 *
 * Admin-only.
 */

import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { ensureSyncLoopStarted, runSyncOnce } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthed(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthenticated" },
      { status: 401 },
    );
  }

  ensureSyncLoopStarted();
  const result = await runSyncOnce();

  return NextResponse.json({
    ok: result.ok,
    result,
  });
}
