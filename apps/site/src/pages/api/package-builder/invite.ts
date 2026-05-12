/**
 * POST /api/package-builder/invite
 *
 * Admin-only. Body: { inquiryId: number }. Mints an invite token for the
 * given inquiry, or re-uses the existing unconsumed invite if one is already
 * active (so clicking "Copy invite link" twice gives the same URL — spec
 * section 11.3).
 *
 * Returns: { ok: true, url, token, expiresAt }.
 *
 * This endpoint lives under /api/package-builder/ — NOT under /api/admin/ —
 * so the global admin middleware does not cover it. We gate explicitly with
 * isAuthed(request).
 */

import type { APIRoute } from "astro";
import { isAuthed } from "@/lib/auth";
import { createOrGetActiveInvite } from "@/lib/builder/invites";
import { getDb } from "@/lib/db";

export const prerender = false;

interface InviteRequestBody {
  inquiryId?: unknown;
}

export const POST: APIRoute = async ({ request }) => {
  // ---- 1. Auth ----------------------------------------------------------
  if (!isAuthed(request)) {
    return jsonResponse(401, { ok: false, error: "unauthenticated" });
  }

  // ---- 2. Parse body ----------------------------------------------------
  let raw: InviteRequestBody;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return jsonResponse(415, { ok: false, error: "validation_failed" });
    }
    raw = (await request.json()) as InviteRequestBody;
  } catch {
    return jsonResponse(400, { ok: false, error: "validation_failed" });
  }

  const inquiryId = Number(raw.inquiryId);
  if (!Number.isInteger(inquiryId) || inquiryId < 1) {
    return jsonResponse(400, { ok: false, error: "validation_failed" });
  }

  // ---- 3. Mint or re-use invite -----------------------------------------
  let invite: { token: string; inquiry_id: number; expires_at: string | null };
  try {
    invite = createOrGetActiveInvite(getDb(), inquiryId, "admin");
  } catch (err) {
    console.error("[/api/package-builder/invite] createOrGetActiveInvite failed:", err);
    return jsonResponse(500, { ok: false, error: "server_error" });
  }

  // ---- 4. Build the URL (origin from the inbound request) ---------------
  // In production this evaluates to https://smile-nola.com/build?invite=…;
  // locally it stays on http://localhost:4321 so dev testing works without
  // hard-coded hosts.
  const base = new URL(request.url).origin;
  const url = `${base}/build?invite=${encodeURIComponent(invite.token)}`;

  return jsonResponse(200, {
    ok: true,
    url,
    token: invite.token,
    expiresAt: invite.expires_at,
  });
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
