/**
 * POST /api/admin/logout
 *
 * Clears the admin session cookie. Always returns 200 (idempotent).
 */
import type { APIRoute } from "astro";
import { clearSessionCookie } from "@/lib/auth";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": clearSessionCookie(request),
    },
  });
};
