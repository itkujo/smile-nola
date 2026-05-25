/**
 * Booth admin auth — single shared password, signed httpOnly cookie.
 *
 * Same pattern (and same env vars) as apps/site/src/lib/auth.ts so the
 * operator only memorizes one password and one secret. The cookie name
 * is intentionally DIFFERENT (`sn_intake`) so signing in to the marketing
 * admin doesn't grant access to the booth admin and vice versa: separate
 * deploys, separate sessions.
 *
 * Cookie value format:
 *   base64url(json({exp:<unix-secs>, v:1})) + "." + base64url(hmac-sha256)
 *
 * Why we don't just import from apps/site: apps/intake is a Next.js
 * project and apps/site is an Astro project. They share env vars via
 * Coolify but not source code. Keeping a small auth module in each
 * codebase is cheaper than wiring a shared package.
 */

import crypto from "node:crypto";

export const COOKIE_NAME = "sn_intake";
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24; // 24h

/* ============================================================================
 * Password compare
 * ========================================================================== */

export function passwordsMatch(submitted: string, expected: string): boolean {
  if (!expected) return false;
  const a = crypto.createHash("sha256").update(submitted, "utf8").digest();
  const b = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

/* ============================================================================
 * Cookie sign / verify
 * ========================================================================== */

function getSecret(): Buffer {
  const raw = process.env.ADMIN_SESSION_SECRET ?? "";
  if (raw.length < 16) {
    throw new Error(
      "ADMIN_SESSION_SECRET is not set or is too short (need at least 16 chars). " +
        "Generate one with: openssl rand -hex 32",
    );
  }
  return Buffer.from(raw, "utf8");
}

function b64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, "utf8");
  return b.toString("base64url");
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

function hmac(payload: string): Buffer {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest();
}

function signCookie(expUnix: number): string {
  const payload = b64url(JSON.stringify({ exp: expUnix, v: 1 }));
  const sig = b64url(hmac(payload));
  return `${payload}.${sig}`;
}

/**
 * Validate a cookie value. Returns true iff:
 *   - Format is "payload.sig".
 *   - HMAC matches (constant-time).
 *   - Decoded payload has exp > now.
 */
export function verifyCookie(value: string | undefined | null): boolean {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot < 1 || dot === value.length - 1) return false;

  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);

  let expectedSig: Buffer;
  try {
    expectedSig = hmac(payload);
  } catch {
    return false;
  }

  let providedSig: Buffer;
  try {
    providedSig = b64urlDecode(sig);
  } catch {
    return false;
  }

  if (providedSig.length !== expectedSig.length) return false;
  if (!crypto.timingSafeEqual(providedSig, expectedSig)) return false;

  let parsed: { exp?: number; v?: number };
  try {
    parsed = JSON.parse(b64urlDecode(payload).toString("utf8"));
  } catch {
    return false;
  }
  if (typeof parsed.exp !== "number") return false;
  const now = Math.floor(Date.now() / 1000);
  return parsed.exp > now;
}

/* ============================================================================
 * HTTP helpers
 * ========================================================================== */

export interface IssuedCookie {
  header: string;
  value: string;
  name: string;
  exp: number;
}

/**
 * Decide whether to set the `Secure` flag on outgoing cookies.
 *
 * Browsers REFUSE to store a `Secure` cookie that arrives over plain HTTP.
 * The booth deliberately serves plain HTTP on the LAN (no TLS required for
 * a single-iPad kiosk on venue Wi-Fi), so gating Secure on NODE_ENV would
 * silently break login on every booth deployment.
 *
 * Rule: emit `Secure` only when we are CERTAIN the original client request
 * actually arrived over HTTPS. Trust:
 *   1. `req.url` reporting an https:// origin (rare for fetch APIs but happens
 *      when called from a hosted SSR context like Coolify), OR
 *   2. `X-Forwarded-Proto: https` from a reverse proxy (Coolify's Traefik,
 *      Caddy, nginx, etc. set this when terminating TLS upstream).
 *
 * Plain-HTTP LAN booth → no Secure → cookie persists on the iPad.
 * HTTPS-fronted hosted deployment → Secure → cookie is locked to TLS.
 */
function requestIsHttps(req?: Request): boolean {
  if (!req) return false;
  if (req.url.startsWith("https://")) return true;
  const xfProto = req.headers.get("x-forwarded-proto");
  if (xfProto && xfProto.split(",")[0]?.trim() === "https") return true;
  return false;
}

export function issueSessionCookie(req?: Request): IssuedCookie {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SEC;
  const value = signCookie(exp);
  const parts = [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SEC}`,
  ];
  if (requestIsHttps(req)) parts.push("Secure");
  return { header: parts.join("; "), value, name: COOKIE_NAME, exp };
}

export function clearSessionCookie(req?: Request): string {
  const parts = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (requestIsHttps(req)) parts.push("Secure");
  return parts.join("; ");
}

export function readSessionCookie(
  cookieHeader: string | null | undefined,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const piece of cookieHeader.split(/;\s*/)) {
    const eq = piece.indexOf("=");
    if (eq < 0) continue;
    const name = piece.slice(0, eq).trim();
    if (name === COOKIE_NAME) return piece.slice(eq + 1).trim();
  }
  return undefined;
}

export function isAuthed(request: Request): boolean {
  return verifyCookie(readSessionCookie(request.headers.get("cookie")));
}

/* ============================================================================
 * Rate limit — single bucket, per-IP, sliding window
 * ========================================================================== */

interface RateBucket {
  count: number;
  start: number;
}
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MAX_ATTEMPTS = 5;
const buckets = new Map<string, RateBucket>();

export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

export function loginRateLimit(
  ip: string,
): { allowed: boolean; remaining: number; retryAfter: number } {
  const now = Date.now();
  for (const [k, v] of buckets) {
    if (now - v.start > RATE_WINDOW_MS) buckets.delete(k);
  }

  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.start > RATE_WINDOW_MS) {
    buckets.set(ip, { count: 1, start: now });
    return { allowed: true, remaining: RATE_MAX_ATTEMPTS - 1, retryAfter: 0 };
  }

  bucket.count += 1;
  if (bucket.count > RATE_MAX_ATTEMPTS) {
    const retryAfter = Math.max(
      1,
      Math.ceil((RATE_WINDOW_MS - (now - bucket.start)) / 1000),
    );
    return { allowed: false, remaining: 0, retryAfter };
  }
  return {
    allowed: true,
    remaining: Math.max(0, RATE_MAX_ATTEMPTS - bucket.count),
    retryAfter: 0,
  };
}

export function resetRateLimit(ip: string): void {
  buckets.delete(ip);
}
