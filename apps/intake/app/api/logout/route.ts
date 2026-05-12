/**
 * POST /api/logout — clear the booth admin session cookie.
 *
 * Hitting this returns a Set-Cookie with Max-Age=0 so the browser drops
 * the session. The response is 200 either way (no need to differentiate
 * "was authed" from "wasn't"; clearing nothing is a no-op).
 */

import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  return NextResponse.json(
    { ok: true },
    {
      status: 200,
      headers: { "Set-Cookie": clearSessionCookie(request) },
    },
  );
}
