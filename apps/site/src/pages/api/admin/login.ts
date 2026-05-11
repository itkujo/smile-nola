/**
 * POST /api/admin/login
 *
 * Body: { password: string }
 *
 * Verifies the password against ADMIN_PASSWORD (constant-time compare).
 * On success, issues a signed httpOnly session cookie valid 24h.
 * Failures are rate-limited per IP (5 attempts per 5-minute window).
 */

import type { APIRoute } from "astro";
import {
  clientIp,
  issueSessionCookie,
  loginRateLimit,
  passwordsMatch,
  resetRateLimit,
} from "@/lib/auth";
import { getEnv } from "@/lib/env";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const ip = clientIp(request);

  // Pre-check rate limit (before reading body so password-stuffing bots get
  // 429'd cheaply).
  const peek = loginRateLimit(ip);
  if (!peek.allowed) {
    return new Response(
      JSON.stringify({ error: `Too many attempts. Try again in ${peek.retryAfter}s.` }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Retry-After": String(peek.retryAfter),
        },
      }
    );
  }

  let body: { password?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Bad request");
  }

  const password = typeof body.password === "string" ? body.password : "";
  const expected = getEnv("ADMIN_PASSWORD");

  if (!expected) {
    console.error("[admin/login] ADMIN_PASSWORD is not set — refusing all logins.");
    return jsonError(500, "Admin auth is not configured on the server.");
  }

  if (!passwordsMatch(password, expected)) {
    // The peek above already incremented the counter, so reflect the remaining count.
    const status = loginRateLimit(ip);
    return new Response(
      JSON.stringify({
        error: "Incorrect password.",
        remainingAttempts: status.remaining,
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  // Success: clear the rate-limit bucket and issue a session.
  resetRateLimit(ip);
  const cookie = issueSessionCookie(request);

  return new Response(
    JSON.stringify({ ok: true, expiresAt: new Date(cookie.exp * 1000).toISOString() }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie": cookie.header,
      },
    }
  );
};

function jsonError(status: number, msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
