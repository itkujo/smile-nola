/**
 * Astro middleware — guards all /admin/* routes.
 *
 * Allows the login page itself and the login API. Every other admin route
 * (page or API) requires a valid signed session cookie. On failure, page
 * requests get a 302 to /admin/login?next=<original-path>; API requests get
 * a 401 JSON response.
 *
 * /api/v1/* is passed straight through to the API router, which does its
 * own auth (src/api/registry/auth.ts).
 */

import { defineMiddleware } from "astro:middleware";
import { isAuthed } from "@/lib/auth";

const PUBLIC_ADMIN_PATHS = new Set<string>([
  "/admin/login",
  "/api/admin/login",
  "/api/admin/logout",
]);

export const onRequest = defineMiddleware(async (context, next) => {
  const { request } = context;
  const url = new URL(request.url);

  // /api/v1/* does its own auth (bearer token or this session cookie) and
  // answers with JSON errors; never redirect an API call to the login page.
  if (url.pathname === "/api/v1" || url.pathname.startsWith("/api/v1/")) return next();

  // Only guard /admin/* and /api/admin/* paths.
  const isAdminRoute =
    url.pathname.startsWith("/admin") || url.pathname.startsWith("/api/admin");
  if (!isAdminRoute) return next();

  if (PUBLIC_ADMIN_PATHS.has(url.pathname)) return next();

  if (isAuthed(request)) return next();

  // Unauthenticated. Page request → redirect; API request → 401 JSON.
  const accept = request.headers.get("accept") ?? "";
  const wantsHtml = accept.includes("text/html");

  if (wantsHtml) {
    const dest = encodeURIComponent(url.pathname + url.search);
    return context.redirect(`/admin/login?next=${dest}`, 302);
  }

  return new Response(
    JSON.stringify({ error: "Unauthenticated" }),
    { status: 401, headers: { "Content-Type": "application/json; charset=utf-8" } }
  );
});
