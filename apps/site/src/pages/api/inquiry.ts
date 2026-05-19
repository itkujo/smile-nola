/**
 * POST /api/inquiry
 *
 * The lightweight inquiry endpoint — receives a JSON body matching
 * InquiryShortSchema from the collection-page embedded form.
 *
 * Order of operations (save-before-notify is the critical invariant):
 *   1. Parse JSON body.
 *   2. Validate via Zod. 400 on validation failure.
 *   3. Reject the request if the honeypot field has any content.
 *   4. Insert into SQLite. 500 on DB failure.
 *   5. Fire-and-forget the email notification (does not block the response).
 *   6. Respond 201 with the inquiry id and timestamp.
 *
 * Email failures NEVER cascade into a request failure.
 */

import type { APIRoute } from "astro";
import { z } from "zod";
import { InquiryShortSchema } from "@/lib/schema";
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

  // ---- 2. Honeypot (runs BEFORE schema validation so the trap stays hidden) ----
  // Bots fill every field they find. Humans never see the `company` field
  // because the form CSS hides it. If it's filled, silently accept-then-drop:
  // returning 201 means bots think they succeeded and move on, with no clue
  // they hit a trap. Real content NEVER reaches the DB.
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
  const parsed = InquiryShortSchema.safeParse(raw);
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
    // If a tier slug came through from a Reserve CTA, nest it under
    // collection_fields.<slug>.selected_package so it shows up in the admin
    // detail view + CSV export under the right collection bucket.
    const collectionFields: Record<string, Record<string, string>> | null = data.selected_package
      ? { [data.collection]: { selected_package: data.selected_package } }
      : null;

    saved = insertInquiry({
      source: data.source || `collection-${data.collection}`,
      first_name: data.first_name,
      last_name: data.last_name,
      email: data.email,
      phone: data.phone,
      event_date: data.event_date ?? null,
      message: data.message ?? null,
      collections_interested: [data.collection],
      collection_fields: collectionFields,
      venue_street_address: data.venue_street_address ?? null,
      venue_city: data.venue_city ?? null,
      venue_state: data.venue_state ?? null,
      venue_postal_code: data.venue_postal_code ?? null,
      venue_country: data.venue_country ?? null,
      venue_latitude: data.venue_latitude ?? null,
      venue_longitude: data.venue_longitude ?? null,
    });
  } catch (err) {
    console.error("[/api/inquiry] DB insert failed:", err);
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
