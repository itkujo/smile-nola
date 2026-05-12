/**
 * Edge middleware: cheap pre-check for the admin section.
 *
 * Why it exists: stops anonymous traffic before it even reaches the page
 * renderers or API routes. If the booth admin URL ever leaks, a guessed
 * GET /admin should return a redirect or 401 immediately, not render
 * server-side JSX that touches the DB.
 *
 * What it does NOT do: cryptographic verification of the cookie. The HMAC
 * check uses node:crypto, which isn't available in the edge runtime that
 * Next.js middleware runs in by default. Instead we look only for the
 * presence and rough shape of the cookie ("payload.signature" with both
 * halves non-empty). Pages and route handlers re-validate properly with
 * isAuthed() from ./lib/auth before doing anything sensitive.
 *
 * Defense in depth: a forged cookie that LOOKS shaped right gets past
 * this middleware but is rejected by the page/route's isAuthed() call,
 * so an attacker still can't read leads. The middleware exists to deny
 * cheaply when the cookie is missing.
 *
 * Routes covered (see `config.matcher` below):
 *   /admin           (and everything under it)
 *   /api/leads       (the JSON dump endpoint)
 *   /api/leads/:id   (DELETE endpoint)
 *   /api/export      (CSV export endpoint)
 *
 * NOT covered: `/` (the kiosk capture form), `/api/submit` (form POST),
 * `/login` (so people can actually log in), `/api/login`, `/api/logout`.
 */

import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = "sn_intake";

function looksLikeValidCookie(value: string | undefined): boolean {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot < 1 || dot === value.length - 1) return false;
  // Both halves must be present and use the base64url alphabet.
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(sig)) {
    return false;
  }
  return true;
}

export function middleware(req: NextRequest): NextResponse {
  const cookieValue = req.cookies.get(COOKIE_NAME)?.value;
  const hasCookie = looksLikeValidCookie(cookieValue);
  if (hasCookie) return NextResponse.next();

  const url = req.nextUrl.clone();
  const isApi =
    url.pathname.startsWith("/api/leads") ||
    url.pathname === "/api/export";

  if (isApi) {
    return NextResponse.json(
      { ok: false, error: "Unauthenticated" },
      { status: 401 },
    );
  }

  // For /admin: redirect to /login with a ?next= param.
  url.pathname = "/login";
  url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/leads/:path*",
    "/api/leads",
    "/api/export",
  ],
};
