/**
 * POST /api/package-builder
 *
 * Receives a JSON body matching BuilderSubmissionSchema, validates and
 * recomputes server-side against the canonical pricing catalog, resolves
 * the optional invite token, persists the submission, and fires off the
 * Resend notification (never awaited — save-before-notify ordering).
 *
 * Error codes follow spec section 8.1 exactly:
 *   400  validation_failed | unknown_selection | invalid_invite
 *   429  rate_limited
 *   500  server_error
 *
 * The endpoint NEVER trusts a client-submitted total. `computeSubmission`
 * is the only authority on the dollar number that gets persisted.
 */

import type { APIRoute } from "astro";
import type { z } from "zod";
import { BuilderSubmissionSchema } from "@/lib/schema";
import { computeSubmission } from "@/lib/builder/compute";
import {
  findInquiryIdByEmail,
  getSubmission,
  insertSubmission,
} from "@/lib/builder/submissions";
import { getInvite, markInviteConsumed } from "@/lib/builder/invites";
import { sendBuilderSubmissionNotification } from "@/lib/email";
import { clientIp, rateLimit } from "@/lib/auth";
import { getDb, getInquiry } from "@/lib/db";
import { pushBuilderToVsco } from "@/lib/vsco/push";

export const prerender = false;

const RATE_OPTS = { windowMs: 600_000, max: 5 } as const; // 5 per 10 minutes per IP

export const POST: APIRoute = async ({ request }) => {
  // ---- 1. Rate limit (cheap; do this before body parse) -----------------
  const ip = clientIp(request);
  const gate = rateLimit("builder-submit", ip, RATE_OPTS);
  if (!gate.allowed) {
    return jsonResponse(429, {
      ok: false,
      error: "rate_limited",
      retryAfter: gate.retryAfter,
    });
  }

  // ---- 2. Body parse -----------------------------------------------------
  let raw: unknown;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return jsonResponse(415, { ok: false, error: "validation_failed" });
    }
    raw = await request.json();
  } catch {
    return jsonResponse(400, { ok: false, error: "validation_failed" });
  }

  // ---- 3. Zod validate ---------------------------------------------------
  const parsed = BuilderSubmissionSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonResponse(400, {
      ok: false,
      error: "validation_failed",
      details: flattenZod(parsed.error),
    });
  }
  const data = parsed.data;

  // ---- 4. Server-authoritative recompute ---------------------------------
  // computeSubmission validates every id against the catalog and computes the
  // canonical subtotal, custom-quoted list, and warnings. We discard whatever
  // the client may have claimed for those values.
  const computed = computeSubmission(data.selections);
  if (!computed.ok) {
    return jsonResponse(400, {
      ok: false,
      error: "unknown_selection",
      details: computed.details ?? computed.error,
    });
  }

  // ---- 5. Invite resolution (invited path) -------------------------------
  const db = getDb();
  let inquiryId: number | null = null;
  let inviteToken: string | null = null;
  let source: "invited-builder" | "cold-builder" = "cold-builder";

  if (data.invite) {
    const invite = getInvite(db, data.invite);
    if (!invite) {
      return jsonResponse(400, { ok: false, error: "invalid_invite" });
    }
    if (invite.expires_at) {
      const expMs = Date.parse(invite.expires_at.replace(" ", "T") + "Z");
      if (Number.isFinite(expMs) && expMs < Date.now()) {
        return jsonResponse(400, { ok: false, error: "invalid_invite" });
      }
    }
    inquiryId = invite.inquiry_id;
    inviteToken = invite.token;
    source = "invited-builder";
    // Stamp consumed_at — idempotent, fine to call on an already-consumed token.
    markInviteConsumed(db, invite.token);
  } else {
    // Cold path — soft-link by email if a matching inquiry exists.
    inquiryId = findInquiryIdByEmail(db, data.client.email);
  }

  // ---- 6. Persist --------------------------------------------------------
  let saved: { id: number; createdAt: string };
  try {
    saved = insertSubmission(db, {
      source,
      first_name: data.client.firstName,
      last_name:  data.client.lastName,
      email:      data.client.email,
      phone:      data.client.phone,
      inquiry_id:   inquiryId,
      invite_token: inviteToken,
      event_date:        data.event.date,
      event_type:        data.event.type,
      venue:             data.event.venue,
      guest_count:       data.event.guestCount,
      consultation_pref: data.consultationPref,
      client_note:       data.event.note,
      selections_json:      JSON.stringify(data.selections),
      fixed_subtotal_cents: computed.fixedSubtotalCents,
      custom_quoted_json:   computed.customQuoted.length > 0
        ? JSON.stringify(computed.customQuoted)
        : null,
      warnings_json: computed.warnings.length > 0
        ? JSON.stringify(computed.warnings)
        : null,
    });
  } catch (err) {
    console.error("[/api/package-builder] DB insert failed:", err);
    return jsonResponse(500, { ok: false, error: "server_error" });
  }

  // ---- 7. Fire-and-forget notification (NEVER awaited) -------------------
  // Load the linked inquiry so the email subject + body can carry the
  // booth-origin partner names (the builder form doesn't capture them).
  // Cold-flow submissions have inquiry_id=null and the email falls back to
  // the submission's own contact name.
  const row = getSubmission(db, saved.id);
  if (row) {
    const linkedInquiry = inquiryId != null ? (getInquiry(inquiryId) ?? null) : null;
    void sendBuilderSubmissionNotification(row, computed, linkedInquiry);
    // Mirror to VSCO Workspace (no-op when VSCO_ENABLED=0 or the linked
    // inquiry isn't qualified yet). Fire-and-forget — never blocks the
    // response, never throws, always records an audit row.
    void pushBuilderToVsco(row);
  }

  // ---- 8. Respond --------------------------------------------------------
  return jsonResponse(201, {
    ok: true,
    id: saved.id,
    createdAt: saved.createdAt,
  });
};

/* ============================================================================
 * Helpers (local to this endpoint, same shape as /api/contact.ts)
 * ============================================================================ */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function flattenZod(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    out[issue.path.join(".") || "_"] = issue.message;
  }
  return out;
}
