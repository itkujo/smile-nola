/**
 * Admin sign-in and sign-out. Public (scope null): login is how you get the
 * session cookie in the first place. Moved from src/pages/api/admin/{login,logout}.ts.
 *
 * Login keeps its own limit on top of the router's: 5 failed or successful
 * attempts per address per 5 minutes (see lib/auth.ts), answered `rate_limited`
 * with Retry-After. A wrong password is `unauthorized` ("Incorrect password.
 * N attempts left.").
 */

import { z } from "zod";
import { defineOperation, withResponse } from "@/api/registry/define";
import { ApiError } from "@/api/registry/errors";
import {
  clearSessionCookie,
  clientIp,
  issueSessionCookie,
  loginRateLimit,
  passwordsMatch,
  resetRateLimit,
} from "@/lib/auth";
import { getEnv } from "@/lib/env";

export const authLogin = defineOperation({
  id: "auth_login",
  summary: "Sign in as admin",
  description:
    "Checks the admin password and sets the 24-hour `sn_admin` session cookie. Limited to 5 " +
    "attempts per address per 5 minutes. Scripts should use a token instead.",
  tag: "auth",
  method: "POST",
  path: "/auth/login",
  scope: null,
  input: z.object({ password: z.string() }),
  output: z.object({ ok: z.literal(true), expiresAt: z.string() }),
  handler({ input, request, clientAddress }) {
    const forwarded = clientIp(request);
    const ip = forwarded !== "unknown" ? forwarded : clientAddress;

    // Counted before the password is checked, so password-stuffing bots get 429s cheaply.
    const peek = loginRateLimit(ip);
    if (!peek.allowed) {
      throw new ApiError("rate_limited", `Too many attempts. Try again in ${peek.retryAfter}s.`, {
        "Retry-After": String(peek.retryAfter),
      });
    }

    const expected = getEnv("ADMIN_PASSWORD");
    if (!expected) {
      console.error("[auth_login] ADMIN_PASSWORD is not set — refusing all logins.");
      throw new ApiError("internal_error", "Admin auth is not configured on the server.");
    }
    if (!passwordsMatch(input.password, expected)) {
      throw new ApiError(
        "unauthorized",
        `Incorrect password. ${peek.remaining} attempt${peek.remaining === 1 ? "" : "s"} left.`,
      );
    }

    resetRateLimit(ip);
    const cookie = issueSessionCookie(request);
    return withResponse(
      { ok: true as const, expiresAt: new Date(cookie.exp * 1000).toISOString() },
      { headers: { "Set-Cookie": cookie.header } },
    );
  },
});

export const authLogout = defineOperation({
  id: "auth_logout",
  summary: "Sign out",
  description: "Clears the admin session cookie. Always succeeds.",
  tag: "auth",
  method: "POST",
  path: "/auth/logout",
  scope: null,
  input: z.object({}),
  output: z.object({ ok: z.literal(true) }),
  handler({ request }) {
    return withResponse({ ok: true as const }, { headers: { "Set-Cookie": clearSessionCookie(request) } });
  },
});
