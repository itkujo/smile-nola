/**
 * Package builder: the public submit and invite lookup, plus the admin
 * submissions list/detail/status, invite minting and the manual VSCO push.
 * Moved from the old src/pages/api/package-builder/** and
 * src/pages/api/admin/package-builder/** routes.
 *
 * Expired invite (was HTTP 410 invite_expired): the HQ error catalog has no
 * 410, so the lookup answers `conflict` (409, "The object is not in a state
 * that allows this") with the message "invite expired". An unknown invite is
 * `not_found`. On submit, a missing or expired invite stays `bad_request`
 * (was 400 invalid_invite), as before.
 */

import { z } from "zod";
import { defineOperation } from "@/api/registry/define";
import { ApiError, badRequest, conflict, notFound } from "@/api/registry/errors";
import { BuilderSubmissionSchema } from "@/lib/schema";
import { computeSubmission } from "@/lib/builder/compute";
import {
  findInquiryIdByEmail,
  getSubmission,
  insertSubmission,
  listSubmissions,
  updateSubmissionStatus,
} from "@/lib/builder/submissions";
import { createOrGetActiveInvite, getInvite, markInviteConsumed } from "@/lib/builder/invites";
import { sendBuilderSubmissionNotification } from "@/lib/email";
import { rateLimit } from "@/lib/auth";
import { getDb, getInquiry, getVscoEntityId, getVscoPushesForBuilder } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { pushBuilderToVsco } from "@/lib/vsco/push";

/** A database row: keys vary by table, so it is documented as a free-form object. */
const Row = z.record(z.string(), z.any());
const IdParam = z.coerce.number().int().positive();

const RATE_OPTS = { windowMs: 600_000, max: 5 } as const; // 5 per 10 minutes per address

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false; // null means "never expires" (v1 default)
  const expMs = Date.parse(expiresAt.replace(" ", "T") + "Z");
  return Number.isFinite(expMs) && expMs < Date.now();
}

/**
 * Public origin for invite links. Behind a reverse proxy request.url is the
 * internal upstream URL, so trust X-Forwarded-Proto/Host, then
 * SITE_PUBLIC_URL, then request.url.
 */
function publicOrigin(request: Request): string {
  const proto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host");
  if (proto && host) {
    const p = proto.split(",")[0]!.trim();
    const h = host.split(",")[0]!.trim();
    if (p && h) return `${p}://${h}`;
  }
  const override = getEnv("SITE_PUBLIC_URL").trim();
  if (override) return override.replace(/\/$/, "");
  return new URL(request.url).origin;
}

/* ============================================================================
 * Public
 * ========================================================================== */

export const builderSubmit = defineOperation({
  id: "builder_submit",
  summary: "Submit a package builder selection",
  description:
    "The /build page's submit. The server recomputes the price from its own catalog and ignores " +
    "any total the client sends. With `invite`, the submission links to the invited inquiry; " +
    "otherwise it links by email if an inquiry matches. Limited to 5 per 10 minutes per address.",
  tag: "builder",
  method: "POST",
  path: "/builder/submissions",
  scope: null,
  successStatus: 201,
  input: BuilderSubmissionSchema,
  output: z.object({ ok: z.literal(true), id: z.number().int(), createdAt: z.string() }),
  handler({ input: data, clientAddress }) {
    const gate = rateLimit("builder-submit", clientAddress, RATE_OPTS);
    if (!gate.allowed) {
      throw new ApiError("rate_limited", `Too many submissions. Wait ${gate.retryAfter} seconds.`, {
        "Retry-After": String(gate.retryAfter),
      });
    }

    const computed = computeSubmission(data.selections);
    if (!computed.ok) {
      const details = computed.details ?? computed.error;
      throw badRequest(`unknown_selection: ${typeof details === "string" ? details : JSON.stringify(details)}`);
    }

    const db = getDb();
    let inquiryId: number | null = null;
    let inviteToken: string | null = null;
    let source: "invited-builder" | "cold-builder" = "cold-builder";

    if (data.invite) {
      const invite = getInvite(db, data.invite);
      if (!invite || isExpired(invite.expires_at)) throw badRequest("invalid_invite: unknown or expired invite");
      inquiryId = invite.inquiry_id;
      inviteToken = invite.token;
      source = "invited-builder";
      markInviteConsumed(db, invite.token);
    } else {
      inquiryId = findInquiryIdByEmail(db, data.client.email);
    }

    let saved: { id: number; createdAt: string };
    try {
      saved = insertSubmission(db, {
        source,
        first_name: data.client.firstName,
        last_name: data.client.lastName,
        email: data.client.email,
        phone: data.client.phone,
        inquiry_id: inquiryId,
        invite_token: inviteToken,
        event_date: data.event.date,
        event_type: data.event.type,
        venue: data.event.venue,
        guest_count: data.event.guestCount,
        consultation_pref: data.consultationPref,
        client_note: data.event.note,
        selections_json: JSON.stringify(data.selections),
        fixed_subtotal_cents: computed.fixedSubtotalCents,
        custom_quoted_json: computed.customQuoted.length > 0 ? JSON.stringify(computed.customQuoted) : null,
        warnings_json: computed.warnings.length > 0 ? JSON.stringify(computed.warnings) : null,
        venue_street_address: data.event.venue_street_address,
        venue_city: data.event.venue_city,
        venue_state: data.event.venue_state,
        venue_postal_code: data.event.venue_postal_code,
        venue_country: data.event.venue_country,
        venue_latitude: data.event.venue_latitude,
        venue_longitude: data.event.venue_longitude,
      });
    } catch (err) {
      console.error("[builder_submit] DB insert failed:", err);
      throw new ApiError("internal_error", "Could not save your submission.");
    }

    // Fire-and-forget: never awaited, never blocks, never throws.
    const row = getSubmission(db, saved.id);
    if (row) {
      const linkedInquiry = inquiryId != null ? (getInquiry(inquiryId) ?? null) : null;
      void sendBuilderSubmissionNotification(row, computed, linkedInquiry);
      void pushBuilderToVsco(row);
    }
    return { ok: true as const, id: saved.id, createdAt: saved.createdAt };
  },
});

export const builderInviteGet = defineOperation({
  id: "builder_invite_get",
  summary: "Look up a package builder invite",
  description:
    "Resolves an invite token to the prefill for /build. `not_found` for an unknown token or an " +
    "invite whose inquiry is gone; `conflict` with message \"invite expired\" for an expired one " +
    "(the old route answered 410, which the error catalog does not have).",
  tag: "builder",
  method: "GET",
  path: "/builder/invites/{token}",
  scope: null,
  input: z.object({ token: z.string().trim().min(1) }),
  output: z.object({
    ok: z.literal(true),
    inquiryId: z.number().int(),
    prefill: z.object({
      firstName: z.string(),
      lastName: z.string(),
      email: z.string(),
      phone: z.string(),
      event: z.object({
        date: z.string().nullable(),
        type: z.string().nullable(),
        venue: z.string().nullable(),
        guestCount: z.number().nullable(),
      }),
    }),
  }),
  handler({ input }) {
    const invite = getInvite(getDb(), input.token);
    if (!invite) throw notFound("Invite not found.");
    if (isExpired(invite.expires_at)) throw conflict("invite expired");
    const inquiry = getInquiry(invite.inquiry_id);
    if (!inquiry) throw notFound("Invite not found.");
    return {
      ok: true as const,
      inquiryId: inquiry.id,
      prefill: {
        firstName: inquiry.first_name,
        lastName: inquiry.last_name,
        email: inquiry.email,
        phone: inquiry.phone,
        event: {
          date: inquiry.event_date ?? null,
          type: inquiry.event_type ?? null,
          venue: inquiry.venue ?? null,
          guestCount: inquiry.guest_count ?? null,
        },
      },
    };
  },
});

/* ============================================================================
 * Admin
 * ========================================================================== */

export const builderInviteCreate = defineOperation({
  id: "builder_invite_create",
  summary: "Make a package builder invite link",
  description:
    "Mints an invite for an inquiry, or re-uses its active (unconsumed) one, so asking twice gives " +
    "the same link.",
  tag: "builder",
  method: "POST",
  path: "/builder/invites",
  scope: "write:builder",
  input: z.object({ inquiryId: z.coerce.number().int().positive() }),
  output: z.object({
    ok: z.literal(true),
    url: z.string(),
    token: z.string(),
    expiresAt: z.string().nullable(),
  }),
  handler({ input, request }) {
    if (!getInquiry(input.inquiryId)) throw notFound("Inquiry not found.");
    const invite = createOrGetActiveInvite(getDb(), input.inquiryId, "admin");
    return {
      ok: true as const,
      url: `${publicOrigin(request)}/build?invite=${encodeURIComponent(invite.token)}`,
      token: invite.token,
      expiresAt: invite.expires_at,
    };
  },
});

export const builderSubmissionsList = defineOperation({
  id: "builder_submissions_list",
  summary: "List package builder submissions",
  description: "Newest first.",
  tag: "builder",
  method: "GET",
  path: "/builder/submissions",
  scope: "read:builder",
  agent: true,
  input: z.object({}),
  output: z.object({ items: z.array(Row) }),
  handler: () => ({ items: listSubmissions(getDb()) }),
});

export const builderSubmissionGet = defineOperation({
  id: "builder_submission_get",
  summary: "Read a package builder submission",
  description:
    "The submission, its linked inquiry (if any), its VSCO push history and the linked inquiry's " +
    "VSCO Job and Order ids.",
  tag: "builder",
  method: "GET",
  path: "/builder/submissions/{id}",
  scope: "read:builder",
  agent: true,
  input: z.object({ id: IdParam }),
  output: z.object({
    submission: Row,
    linkedInquiry: Row.nullable(),
    vscoPushes: z.array(Row),
    linkedJobId: z.string().nullable(),
    linkedOrderId: z.string().nullable(),
  }),
  handler({ input }) {
    const submission = getSubmission(getDb(), input.id);
    if (!submission) throw notFound("Submission not found.");
    const linkedInquiry = submission.inquiry_id != null ? (getInquiry(submission.inquiry_id) ?? null) : null;
    const externalUuid = linkedInquiry?.external_uuid ?? null;
    return {
      submission,
      linkedInquiry,
      vscoPushes: getVscoPushesForBuilder(submission.id),
      linkedJobId: externalUuid != null ? getVscoEntityId(externalUuid, "job") : null,
      linkedOrderId: externalUuid != null ? getVscoEntityId(externalUuid, "order") : null,
    };
  },
});

export const builderSubmissionUpdate = defineOperation({
  id: "builder_submission_update",
  summary: "Mark a submission invoice-sent, or revert it to new",
  description: "`invoice_sent` stamps invoice_sent_at; `new` clears it.",
  tag: "builder",
  method: "PATCH",
  path: "/builder/submissions/{id}",
  scope: "write:builder",
  input: z.object({ id: IdParam, status: z.enum(["new", "invoice_sent"]) }),
  output: z.object({ ok: z.literal(true), submission: Row }),
  handler({ input }) {
    const db = getDb();
    if (!updateSubmissionStatus(db, input.id, input.status)) throw notFound("Submission not found.");
    return { ok: true as const, submission: getSubmission(db, input.id)! };
  },
});

export const builderPushVsco = defineOperation({
  id: "builder_push_vsco",
  summary: "Retry the VSCO Order push for a submission",
  description:
    "Fire-and-forget: answers as soon as the push starts; the outcome (pushed, skipped with a " +
    "reason, or failed) is recorded in the submission's VSCO push history.",
  tag: "builder",
  method: "POST",
  path: "/builder/submissions/{id}/push-vsco",
  scope: "write:builder",
  input: z.object({ id: IdParam }),
  output: z.object({ ok: z.literal(true) }),
  handler({ input }) {
    const submission = getSubmission(getDb(), input.id);
    if (!submission) throw notFound("Submission not found.");
    void pushBuilderToVsco(submission, { trigger: "manual" });
    return { ok: true as const };
  },
});
