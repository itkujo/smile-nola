/**
 * POST /api/contact
 *
 * The deep inquiry endpoint — receives a JSON body matching InquiryDeepSchema
 * from the full /contact form. Persists to the same `inquiries` table the
 * lightweight endpoint writes to.
 *
 * Honeypot check runs BEFORE Zod (same pattern as /api/inquiry).
 * Save-before-notify ordering is the critical invariant.
 */

import type { APIRoute } from "astro";
import { z } from "zod";
import { InquiryDeepSchema } from "@/lib/schema";
import { getInquiry, insertInquiry } from "@/lib/db";
import { sendInquiryNotification } from "@/lib/email";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  // ---- 1. Body parse ------------------------------------------------------
  let raw: unknown;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      raw = await request.json();
    } else if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const fd = await request.formData();
      raw = Object.fromEntries(fd.entries());
    } else {
      return jsonResponse(415, { error: "Unsupported content type" });
    }
  } catch {
    return jsonResponse(400, { error: "Body must be valid JSON or form data" });
  }

  // ---- 2. Honeypot (silent 201 trap, no DB row written) ------------------
  if (
    raw &&
    typeof raw === "object" &&
    "company" in raw &&
    typeof (raw as Record<string, unknown>).company === "string" &&
    ((raw as Record<string, string>).company.trim()).length > 0
  ) {
    return jsonResponse(201, {
      ok: true,
      id: 0,
      message: "Thank you. We'll be in touch within 24 hours.",
    });
  }

  // ---- 3. Validate --------------------------------------------------------
  const parsed = InquiryDeepSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonResponse(400, {
      error: "Validation failed",
      details: flattenZod(parsed.error),
    });
  }
  const data = parsed.data;

  // ---- 4. Persist ---------------------------------------------------------
  let saved: { id: number; createdAt: string };
  try {
    saved = insertInquiry({
      source: data.source || "contact",
      first_name: data.first_name,
      last_name: data.last_name,
      email: data.email,
      phone: data.phone,
      preferred_contact: data.preferred_contact ?? null,
      event_date: data.event_date ?? null,
      event_type: data.event_type ?? null,
      venue: data.venue ?? null,
      guest_count: data.guest_count ?? null,
      event_start: data.event_start ?? null,
      event_end: data.event_end ?? null,
      planner: data.planner ?? null,
      budget_range: data.budget_range ?? null,
      message: composeMessage(data),
      referral: data.referral ?? null,
      collections_interested:
        data.collections_interested && data.collections_interested.length > 0
          ? data.collections_interested
          : null,
      collection_fields:
        data.collection_fields && Object.keys(data.collection_fields).length > 0
          ? data.collection_fields
          : null,
      venue_street_address: data.venue_street_address ?? null,
      venue_city: data.venue_city ?? null,
      venue_state: data.venue_state ?? null,
      venue_postal_code: data.venue_postal_code ?? null,
      venue_country: data.venue_country ?? null,
      venue_latitude: data.venue_latitude ?? null,
      venue_longitude: data.venue_longitude ?? null,
    });
  } catch (err) {
    console.error("[/api/contact] DB insert failed:", err);
    return jsonResponse(500, { error: "Could not save your inquiry. Please email us directly." });
  }

  // ---- 5. Fire-and-forget notification -----------------------------------
  const row = getInquiry(saved.id);
  if (row) {
    void sendInquiryNotification(row);
  }

  // ---- 6. Respond ---------------------------------------------------------
  return jsonResponse(201, {
    ok: true,
    id: saved.id,
    createdAt: saved.createdAt,
    message: "Thank you. We'll be in touch within 24 hours.",
  });
};

/* ============================================================================
 * Helpers
 * ============================================================================ */

/**
 * Combine the user's primary message with any free-form "other_services"
 * narrative so the admin view shows everything in one body. Per-collection
 * structured answers stay in collection_fields_json for export fidelity.
 */
function composeMessage(data: z.infer<typeof InquiryDeepSchema>): string | null {
  const parts: string[] = [];
  if (data.message) parts.push(data.message);
  if (data.other_services) {
    parts.push(`\n\n— Custom services request —\n${data.other_services}`);
  }
  return parts.length > 0 ? parts.join("") : null;
}

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
