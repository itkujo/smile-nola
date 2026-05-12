/**
 * POST /api/login
 *
 * Body: { password: string }
 *
 * Verifies the password against ADMIN_PASSWORD (constant-time compare).
 * On success, issues a signed httpOnly session cookie valid 24h.
 * Failures are rate-limited per IP (5 attempts per 5-minute window).
 *
 * Mirrors apps/site/src/pages/api/admin/login.ts. The two sites use the
 * same ADMIN_PASSWORD env var but DIFFERENT cookie names so sessions
 * don't bleed across.
 */

import { NextResponse } from "next/server";
import {
  clientIp,
  issueSessionCookie,
  loginRateLimit,
  passwordsMatch,
  resetRateLimit,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const ip = clientIp(request);

  // Pre-check rate limit before reading the body so brute-forcers get
  // 429'd cheaply.
  const peek = loginRateLimit(ip);
  if (!peek.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${peek.retryAfter}s.` },
      {
        status: 429,
        headers: { "Retry-After": String(peek.retryAfter) },
      },
    );
  }

  let body: { password?: unknown };
  try {
    body = (await request.json()) as { password?: unknown };
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";
  const expected = process.env.ADMIN_PASSWORD ?? "";

  if (!expected) {
    console.error(
      "[intake /api/login] ADMIN_PASSWORD is not set — refusing all logins.",
    );
    return NextResponse.json(
      { error: "Admin auth is not configured on the server." },
      { status: 500 },
    );
  }

  if (!passwordsMatch(password, expected)) {
    const status = loginRateLimit(ip);
    return NextResponse.json(
      {
        error: "Incorrect password.",
        remainingAttempts: status.remaining,
      },
      { status: 401 },
    );
  }

  resetRateLimit(ip);
  const cookie = issueSessionCookie(request);

  return NextResponse.json(
    {
      ok: true,
      expiresAt: new Date(cookie.exp * 1000).toISOString(),
    },
    {
      status: 200,
      headers: { "Set-Cookie": cookie.header },
    },
  );
}
