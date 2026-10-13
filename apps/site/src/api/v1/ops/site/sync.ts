/**
 * Booth sync: POST /api/v1/sync/inquiries (scope write:sync).
 *
 * Replaces the old /api/sync/inquiries route and its INTAKE_SYNC_TOKEN. The
 * booth now uses an ordinary sn_ token with the write:sync scope, made at
 * /admin/tokens.
 *
 * Idempotent on external_uuid: re-pushing a row is a no-op (`inserted:
 * false`), so the booth can safely retry its queue. The CRM email goes out
 * only for fresh inserts, fire-and-forget.
 */

import { z } from "zod";
import { defineOperation } from "@/api/registry/define";
import { ApiError, badRequest } from "@/api/registry/errors";
import { getInquiry, upsertBoothInquiry, type BoothSyncPayload } from "@/lib/db";
import { sendInquiryNotification } from "@/lib/email";

const MAX_BATCH = 200; // roughly one expo's worth

const isString = (x: unknown): x is string => typeof x === "string";
const isStringOrNull = (x: unknown): x is string | null => x === null || typeof x === "string";

function validatePayload(item: unknown): BoothSyncPayload {
  if (!item || typeof item !== "object") throw badRequest("inquiries: row is not an object");
  const o = item as Record<string, unknown>;
  const fail = (m: string) => badRequest(`inquiries: ${m}`);

  for (const k of ["external_uuid", "created_at", "first_name", "email", "phone"] as const) {
    if (!isString(o[k]) || (o[k] as string).length === 0) throw fail(`field ${k} must be a non-empty string`);
  }
  // last_name may be "" (single-word poc_name values split to an empty last name).
  if (!isString(o.last_name)) throw fail("field last_name must be a string");

  for (const k of [
    "preferred_contact",
    "event_date",
    "venue",
    "collections_interested",
    "notes",
    "partner1_name",
    "partner2_name",
    "event_setting",
    "poc_relationship",
  ] as const) {
    if (!isStringOrNull(o[k])) throw fail(`field ${k} must be a string or null`);
  }
  // Older booth payloads (pre-autocomplete) leave the venue address fully absent.
  for (const k of [
    "venue_street_address",
    "venue_city",
    "venue_state",
    "venue_postal_code",
    "venue_country",
  ] as const) {
    if (o[k] !== undefined && !isStringOrNull(o[k])) throw fail(`field ${k} must be a string, null, or absent`);
  }
  for (const k of ["venue_latitude", "venue_longitude"] as const) {
    if (o[k] !== undefined && o[k] !== null && typeof o[k] !== "number") {
      throw fail(`field ${k} must be a number, null, or absent`);
    }
  }

  const created = o.created_at as string;
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(created)) {
    throw fail(`created_at must look like an ISO timestamp (got ${created.slice(0, 32)})`);
  }
  const uuid = o.external_uuid as string;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
    throw fail("external_uuid must be a UUID v4");
  }

  return {
    external_uuid: uuid,
    created_at: created,
    first_name: o.first_name as string,
    last_name: o.last_name as string,
    email: o.email as string,
    phone: o.phone as string,
    preferred_contact: o.preferred_contact as string | null,
    event_date: o.event_date as string | null,
    venue: o.venue as string | null,
    collections_interested: o.collections_interested as string | null,
    notes: o.notes as string | null,
    partner1_name: o.partner1_name as string | null,
    partner2_name: o.partner2_name as string | null,
    event_setting: o.event_setting as string | null,
    poc_relationship: o.poc_relationship as string | null,
    venue_street_address: (o.venue_street_address ?? null) as string | null,
    venue_city: (o.venue_city ?? null) as string | null,
    venue_state: (o.venue_state ?? null) as string | null,
    venue_postal_code: (o.venue_postal_code ?? null) as string | null,
    venue_country: (o.venue_country ?? null) as string | null,
    venue_latitude: typeof o.venue_latitude === "number" ? o.venue_latitude : null,
    venue_longitude: typeof o.venue_longitude === "number" ? o.venue_longitude : null,
  };
}

export const syncInquiries = defineOperation({
  id: "sync_inquiries",
  summary: "Sync booth inquiries",
  description:
    "Upserts a batch of booth-captured inquiries (at most 200), keyed on external_uuid. Each row: " +
    "external_uuid (UUID), created_at (ISO), first_name, last_name, email, phone, plus the optional " +
    "booth fields (preferred_contact, event_date, venue, collections_interested, notes, partner1_name, " +
    "partner2_name, event_setting, poc_relationship, venue_* address). Rows are checked all-or-nothing " +
    "before any write.",
  tag: "sync",
  method: "POST",
  path: "/sync/inquiries",
  scope: "write:sync",
  input: z.object({
    inquiries: z.array(z.unknown(), { required_error: "expected `inquiries: BoothSyncPayload[]`" }).max(MAX_BATCH, `batch too large (max ${MAX_BATCH})`),
  }),
  output: z.object({
    ok: z.literal(true),
    results: z.array(z.object({ external_uuid: z.string(), inserted: z.boolean(), id: z.number().int() })),
  }),
  handler({ input }) {
    const payloads = input.inquiries.map(validatePayload);
    const results: { external_uuid: string; inserted: boolean; id: number }[] = [];
    for (const payload of payloads) {
      try {
        const r = upsertBoothInquiry(payload);
        results.push({ external_uuid: payload.external_uuid, inserted: r.inserted, id: r.id });
        // Exactly one notification per unique booth capture, however often the booth retries.
        if (r.inserted) {
          const row = getInquiry(r.id);
          if (row) void sendInquiryNotification(row);
          else console.error(`[sync] freshly-inserted inquiry id=${r.id} not found for notification`);
        }
      } catch (err) {
        console.error("[sync] upsertBoothInquiry threw:", err);
        throw new ApiError("internal_error", "database write failed");
      }
    }
    return { ok: true as const, results };
  },
});
