/**
 * GET /api/package-builder/invite/<token>
 *
 * Public — resolves an invite token to a prefill payload for the /build page.
 * Returns 404 for unknown tokens and 410 for expired ones. Successful
 * responses match the "Invite prefill response" inter-cluster contract.
 *
 * The /build page calls this server-side during render so the hydrated React
 * island lands with prefilled identity on first paint (no client fetch flash).
 */

import type { APIRoute } from "astro";
import { getInvite } from "@/lib/builder/invites";
import { getInquiry, getDb } from "@/lib/db";

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const token = (params.token ?? "").trim();
  if (!token) {
    return jsonResponse(404, { ok: false, error: "invite_not_found" });
  }

  const db = getDb();
  const invite = getInvite(db, token);
  if (!invite) {
    return jsonResponse(404, { ok: false, error: "invite_not_found" });
  }

  // Expiry check — null means "never expires" (the v1 default per spec section 8.3).
  if (invite.expires_at) {
    const expMs = Date.parse(invite.expires_at.replace(" ", "T") + "Z");
    if (Number.isFinite(expMs) && expMs < Date.now()) {
      return jsonResponse(410, { ok: false, error: "invite_expired" });
    }
  }

  const inquiry = getInquiry(invite.inquiry_id);
  if (!inquiry) {
    // The invite points at a deleted inquiry. Per spec section 4.5 the public
    // page silently degrades to the cold flow; from the API's perspective we
    // also return 404 so the caller hits the same fallback path.
    return jsonResponse(404, { ok: false, error: "invite_not_found" });
  }

  return jsonResponse(200, {
    ok: true,
    inquiryId: inquiry.id,
    prefill: {
      firstName: inquiry.first_name,
      lastName:  inquiry.last_name,
      email:     inquiry.email,
      phone:     inquiry.phone,
      event: {
        date:       inquiry.event_date ?? null,
        type:       inquiry.event_type ?? null,
        venue:      inquiry.venue ?? null,
        guestCount: inquiry.guest_count ?? null,
      },
    },
  });
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
