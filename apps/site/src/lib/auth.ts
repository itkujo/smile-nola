/**
 * Admin auth — single shared password, signed httpOnly cookie, in-memory rate
 * limit. No per-user accounts; everyone who knows the password is "admin".
 *
 * Cookie value format:
 *   base64url(json({exp:<unix-secs>, v:1})) + "." + base64url(hmac-sha256)
 *
 * The HMAC is computed over the base64url-encoded payload using
 * ADMIN_SESSION_SECRET. Server validates the HMAC (constant-time) AND that
 * the expiry hasn't passed. No DB-side session table — the signed cookie
 * is the session.
 *
 * CSRF: same-site=lax + httpOnly + the API endpoints require
 * application/json content type, which jointly defeat classical CSRF.
 */

import crypto from "node:crypto";
import { getEnv } from "@/lib/env";

const COOKIE_NAME = "sn_admin";
const SESSION_MAX_AGE_SEC = 60 * 60 * 24; // 24h

/* ============================================================================
 * Password compare
 * ========================================================================== */

/**
 * Constant-time string comparison via crypto.timingSafeEqual.
 * Both inputs are normalized to a fixed-length buffer so the timing doesn't
 * leak the length either.
 */
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
  const raw = getEnv("ADMIN_SESSION_SECRET");
  if (raw.length < 16) {
    // Refuse to issue cookies signed with a weak secret. Surface loudly so
    // an unset env var doesn't silently degrade security.
    throw new Error(
      "ADMIN_SESSION_SECRET is not set or is too short (need at least 16 chars). " +
        "Generate one with: openssl rand -hex 32"
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

/**
 * Returns a freshly-signed cookie value for the given expiry (unix seconds).
 */
function signCookie(expUnix: number): string {
  const payload = b64url(JSON.stringify({ exp: expUnix, v: 1 }));
  const sig = b64url(hmac(payload));
  return `${payload}.${sig}`;
}

/**
 * Validate a cookie value. Returns true iff:
 *   • Format is "payload.sig".
 *   • HMAC matches (constant-time).
 *   • Decoded payload is JSON with exp > now.
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

  // Signature is good — now check expiry.
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
 * Cookie HTTP helpers
 * ========================================================================== */

export interface IssuedCookie {
  /** Pre-built Set-Cookie header value. */
  header: string;
  /** Just the cookie value, in case callers need to surface it. */
  value: string;
  /** Cookie name. */
  name: string;
  /** Expiry as unix seconds. */
  exp: number;
}

export function issueSessionCookie(req?: Request): IssuedCookie {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SEC;
  const value = signCookie(exp);
  // Detect HTTPS so the cookie is Secure on real deploys but not on localhost.
  const isHttps =
    getEnv("NODE_ENV") === "production" ||
    req?.url.startsWith("https://") === true;
  const parts = [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SEC}`,
  ];
  if (isHttps) parts.push("Secure");
  return { header: parts.join("; "), value, name: COOKIE_NAME, exp };
}

/** Clearing cookie — sets the same name to empty with Max-Age=0. */
export function clearSessionCookie(req?: Request): string {
  const isHttps =
    getEnv("NODE_ENV") === "production" ||
    req?.url.startsWith("https://") === true;
  const parts = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (isHttps) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Extract the sn_admin cookie from a Cookie header. Returns undefined if
 * absent.
 */
export function readSessionCookie(cookieHeader: string | null | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const piece of cookieHeader.split(/;\s*/)) {
    const eq = piece.indexOf("=");
    if (eq < 0) continue;
    const name = piece.slice(0, eq).trim();
    if (name === COOKIE_NAME) return piece.slice(eq + 1).trim();
  }
  return undefined;
}

/** Returns true iff the request carries a valid admin session cookie. */
export function isAuthed(request: Request): boolean {
  return verifyCookie(readSessionCookie(request.headers.get("cookie")));
}

/* ============================================================================
 * Rate limit — in-memory, per-(bucket, IP), sliding window
 * ========================================================================== */

interface RateBucket {
  count: number;
  /** Unix ms when the bucket was created. */
  start: number;
}

/**
 * Buckets are keyed by `${bucketKey}::${ip}` so different routes get isolated
 * counters on the same IP. A hammered `/admin/login` cannot lock out
 * `/api/package-builder` and vice versa.
 */
const buckets = new Map<string, RateBucket>();

const LOGIN_BUCKET = "login";
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

/**
 * Returns the IP address to use as the rate-limit key. Honors common proxy
 * headers but falls back to a sentinel when nothing's available.
 */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/**
 * Generic sliding-window rate limiter. Returns `allowed: true` and decrements
 * `remaining` while under the threshold; returns `allowed: false` with a
 * `retryAfter` (seconds) once exceeded.
 *
 * @param bucketKey  Logical bucket (e.g. "login", "builder-submit"). Buckets
 *                   are isolated — exhausting one does not affect another.
 * @param ip         Client IP from {@link clientIp}.
 * @param opts       `windowMs` is the sliding-window length in ms;
 *                   `max` is the maximum number of allowed calls per window.
 *
 * Side effect: prunes expired buckets on each call (cheap O(n) sweep).
 */
export function rateLimit(
  bucketKey: string,
  ip: string,
  opts: { windowMs: number; max: number },
): { allowed: boolean; remaining: number; retryAfter: number } {
  const now = Date.now();
  // Prune across ALL buckets — cheap.
  for (const [k, v] of buckets) {
    if (now - v.start > opts.windowMs) buckets.delete(k);
  }

  const key = `${bucketKey}::${ip}`;
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.start > opts.windowMs) {
    buckets.set(key, { count: 1, start: now });
    return { allowed: true, remaining: opts.max - 1, retryAfter: 0 };
  }

  bucket.count += 1;
  if (bucket.count > opts.max) {
    const retryAfter = Math.max(1, Math.ceil((opts.windowMs - (now - bucket.start)) / 1000));
    return { allowed: false, remaining: 0, retryAfter };
  }
  return { allowed: true, remaining: Math.max(0, opts.max - bucket.count), retryAfter: 0 };
}

/**
 * Login-specific wrapper. Preserves the original (single-arg) API exactly so
 * `/api/admin/login` keeps working without edits. 5 attempts per 5 minutes.
 */
export function loginRateLimit(
  ip: string,
): { allowed: boolean; remaining: number; retryAfter: number } {
  return rateLimit(LOGIN_BUCKET, ip, {
    windowMs: LOGIN_WINDOW_MS,
    max: LOGIN_MAX_ATTEMPTS,
  });
}

/** Reset the login bucket for an IP — call after a successful login. */
export function resetRateLimit(ip: string): void {
  buckets.delete(`${LOGIN_BUCKET}::${ip}`);
}
