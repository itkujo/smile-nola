/**
 * POST /api/admin/inquiries/sync
 *
 * Receives a batch of booth-captured inquiries from a remote booth laptop
 * and upserts them into the production `inquiries` table. Used by the
 * Phase 2 one-way replication: the booth runs its own local SQLite for
 * resilience against expo Wi-Fi failures and pushes rows here when online.
 *
 * Auth: a static bearer token in the Authorization header, configured via
 * the INTAKE_SYNC_TOKEN env var. NOT the same as the admin password — that
 * is meant for human session login; this token is for service-to-service.
 *
 *   curl -X POST https://smile-nola.com/api/admin/inquiries/sync \
 *     -H 'Authorization: Bearer <INTAKE_SYNC_TOKEN>' \
 *     -H 'Content-Type: application/json' \
 *     -d '{"inquiries":[{...},{...}]}'
 *
 * Response:
 *   200 { ok: true, results: [{external_uuid, inserted, id}, ...] }
 *   400 validation_failed
 *   401 unauthenticated
 *   500 server_error
 *
 * Idempotency: keyed on external_uuid. Re-pushing the same row is a no-op
 * (the response will say `inserted: false`). The booth uses this property
 * to safely retry the queue after a transient failure.
 */

import type { APIRoute } from "astro";
import crypto from "node:crypto";
import { getEnv } from "@/lib/env";
import { upsertBoothInquiry, type BoothSyncPayload } from "@/lib/db";

export const prerender = false;

interface Body {
  inquiries?: unknown;
}

interface SyncResult {
  external_uuid: string;
  inserted: boolean;
  id: number;
}

export const POST: APIRoute = async ({ request }) => {
  // ---- Auth ---------------------------------------------------------------
  const expected = getEnv("INTAKE_SYNC_TOKEN").trim();
  if (!expected) {
    console.error(
      "[sync] INTAKE_SYNC_TOKEN is not set — refusing all sync attempts.",
    );
    return jsonResponse(500, { ok: false, error: "server_error" });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const presented = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!constantTimeEqual(presented, expected)) {
    return jsonResponse(401, { ok: false, error: "unauthenticated" });
  }

  // ---- Body parse ---------------------------------------------------------
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return jsonResponse(415, { ok: false, error: "validation_failed" });
  }

  let raw: Body;
  try {
    raw = (await request.json()) as Body;
  } catch {
    return jsonResponse(400, { ok: false, error: "validation_failed" });
  }

  if (!Array.isArray(raw.inquiries)) {
    return jsonResponse(400, {
      ok: false,
      error: "validation_failed",
      details: "expected `inquiries: BoothSyncPayload[]`",
    });
  }

  // Reasonable bound on batch size so a single misbehaving booth can't
  // park a 10MB POST. 200 rows = roughly one expo's worth.
  if (raw.inquiries.length > 200) {
    return jsonResponse(400, {
      ok: false,
      error: "validation_failed",
      details: "batch too large (max 200)",
    });
  }

  // ---- Validate + upsert --------------------------------------------------
  const results: SyncResult[] = [];
  let writeError: string | null = null;

  for (const item of raw.inquiries) {
    const validated = validatePayload(item);
    if (!validated.ok) {
      return jsonResponse(400, {
        ok: false,
        error: "validation_failed",
        details: validated.message,
      });
    }
    try {
      const r = upsertBoothInquiry(validated.payload);
      results.push({
        external_uuid: validated.payload.external_uuid,
        inserted: r.inserted,
        id: r.id,
      });
    } catch (err) {
      console.error("[sync] upsertBoothInquiry threw:", err);
      writeError = "database write failed";
      break;
    }
  }

  if (writeError) {
    return jsonResponse(500, { ok: false, error: "server_error" });
  }

  return jsonResponse(200, { ok: true, results });
};

/* ============================================================================
 * Helpers
 * ========================================================================== */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  // Length-leaking is acceptable here (token lengths are constant config).
  // crypto.timingSafeEqual requires equal-length buffers.
  if (a.length !== b.length) return false;
  if (a.length === 0) return false;
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return crypto.timingSafeEqual(ab, bb);
}

function isString(x: unknown): x is string {
  return typeof x === "string";
}
function isStringOrNull(x: unknown): x is string | null {
  return x === null || typeof x === "string";
}

interface ValidatedOk {
  ok: true;
  payload: BoothSyncPayload;
}
interface ValidatedFail {
  ok: false;
  message: string;
}

function validatePayload(item: unknown): ValidatedOk | ValidatedFail {
  if (!item || typeof item !== "object") {
    return { ok: false, message: "row is not an object" };
  }
  const o = item as Record<string, unknown>;

  // Required strings (non-empty).
  for (const k of ["external_uuid", "created_at", "first_name", "email", "phone"] as const) {
    if (!isString(o[k]) || (o[k] as string).length === 0) {
      return { ok: false, message: `field ${k} must be a non-empty string` };
    }
  }
  // last_name may be "" (the migration's split produces empty last_name for
  // single-word poc_name values).
  if (!isString(o.last_name)) {
    return { ok: false, message: "field last_name must be a string" };
  }

  // Optional strings (string | null).
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
    if (!isStringOrNull(o[k])) {
      return { ok: false, message: `field ${k} must be a string or null` };
    }
  }

  // Defensive shape: created_at must look like an ISO-ish date so we
  // don't accept arbitrary garbage that the SQLite TEXT column will
  // happily store but later display tools will choke on.
  const created = o.created_at as string;
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(created)) {
    return {
      ok: false,
      message: `created_at must look like an ISO timestamp (got ${created.slice(0, 32)})`,
    };
  }

  // Defensive shape: external_uuid must look like a UUID. The booth uses
  // crypto.randomUUID() which always emits the canonical form. Anything
  // else is malformed.
  const uuid = o.external_uuid as string;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)
  ) {
    return { ok: false, message: "external_uuid must be a UUID v4" };
  }

  return {
    ok: true,
    payload: {
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
    },
  };
}
