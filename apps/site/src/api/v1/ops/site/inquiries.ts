/**
 * Inquiries: the two public forms (collection page, /contact), the admin
 * list/detail/update, "mark qualified", the VSCO debug helpers and the CSV
 * export. Moved from the old src/pages/api/{inquiry,contact,admin/*} routes.
 *
 * Errors use the HQ shape. The old `{ error: "Validation failed", details }`
 * answer is now `bad_request` with the first failing field in the message.
 */

import { z } from "zod";
import { defineOperation, withResponse } from "@/api/registry/define";
import { badRequest, fromZodError, notFound, ApiError } from "@/api/registry/errors";
import { InquiryDeepSchema, InquiryShortSchema } from "@/lib/schema";
import {
  getAllInquiries,
  getDb,
  getInquiry,
  getVscoEntities,
  getVscoPushesForInquiry,
  inquiryCounts,
  insertInquiry,
  markInquiryQualified,
  updateInquiryNotes,
  updateInquiryStatus,
} from "@/lib/db";
import { sendInquiryNotification } from "@/lib/email";
import { csvFilename, inquiriesToCsv } from "@/lib/csv";
import { pushQualifiedToVsco } from "@/lib/vsco/push";

/** A database row: keys vary by table, so it is documented as a free-form object. */
const Row = z.record(z.string(), z.any());
const THANKS = "Thank you. We'll be in touch within 24 hours.";

const SubmitOutput = z.object({
  ok: z.literal(true),
  id: z.number().int(),
  createdAt: z.string().optional(),
  message: z.string(),
});

/** Bots fill every field they find; humans never see `company`. */
function isHoneypotTripped(raw: Record<string, unknown>): boolean {
  return typeof raw.company === "string" && raw.company.trim().length > 0;
}

function flattenMessage(err: z.ZodError): ApiError {
  return fromZodError(err);
}

/* ============================================================================
 * Public forms
 * ========================================================================== */

export const inquiriesCreate = defineOperation({
  id: "inquiries_create",
  summary: "Send the short inquiry (collection page)",
  description:
    "The lightweight form on a collection page. Fields: first_name, last_name, email, phone, " +
    "collection (required); event_date (YYYY-MM-DD), message, source, selected_package and the " +
    "venue_* address fields (optional). A filled `company` field is a honeypot: the answer " +
    "looks like success (id 0) and nothing is saved. Saved before the notification email is sent.",
  tag: "inquiries",
  method: "POST",
  path: "/inquiries",
  scope: null,
  successStatus: 201,
  input: z.object({}).passthrough(),
  output: SubmitOutput,
  handler({ input }) {
    // Honeypot first, so the trap stays hidden from a bot that gets the rest wrong.
    if (isHoneypotTripped(input)) return { ok: true as const, id: 0, message: THANKS };
    const parsed = InquiryShortSchema.safeParse(input);
    if (!parsed.success) throw flattenMessage(parsed.error);
    const data = parsed.data;

    let saved: { id: number; createdAt: string };
    try {
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
      console.error("[inquiries_create] DB insert failed:", err);
      throw new ApiError("internal_error", "Could not save your inquiry. Please email us directly.");
    }
    const row = getInquiry(saved.id);
    if (row) void sendInquiryNotification(row);
    return { ok: true as const, id: saved.id, createdAt: saved.createdAt, message: THANKS };
  },
});

function composeMessage(data: z.infer<typeof InquiryDeepSchema>): string | null {
  const parts: string[] = [];
  if (data.message) parts.push(data.message);
  if (data.other_services) parts.push(`\n\n— Custom services request —\n${data.other_services}`);
  return parts.length > 0 ? parts.join("") : null;
}

export const inquiriesContact = defineOperation({
  id: "inquiries_contact",
  summary: "Send the full contact inquiry",
  description:
    "The deep form on /contact. Required: first_name, last_name, email, phone. Optional: event " +
    "details, venue_* address fields, collections_interested, collection_fields, other_services. " +
    "A filled `company` field is a honeypot (answers like success, saves nothing).",
  tag: "inquiries",
  method: "POST",
  path: "/inquiries/contact",
  scope: null,
  successStatus: 201,
  input: z.object({}).passthrough(),
  output: SubmitOutput,
  handler({ input }) {
    if (isHoneypotTripped(input)) return { ok: true as const, id: 0, message: THANKS };
    const parsed = InquiryDeepSchema.safeParse(input);
    if (!parsed.success) throw flattenMessage(parsed.error);
    const data = parsed.data;

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
      console.error("[inquiries_contact] DB insert failed:", err);
      throw new ApiError("internal_error", "Could not save your inquiry. Please email us directly.");
    }
    const row = getInquiry(saved.id);
    if (row) void sendInquiryNotification(row);
    return { ok: true as const, id: saved.id, createdAt: saved.createdAt, message: THANKS };
  },
});

/* ============================================================================
 * Admin
 * ========================================================================== */

const StatusFilter = z.enum(["new", "contacted", "closed", "open", "all"]);

export const inquiriesList = defineOperation({
  id: "inquiries_list",
  summary: "List inquiries",
  description:
    "Newest first. `status` filters: new, contacted or closed match exactly; open is new plus " +
    "contacted; all (default) is every row.",
  tag: "inquiries",
  method: "GET",
  path: "/inquiries",
  scope: "read:inquiries",
  agent: true,
  input: z.object({ status: StatusFilter.optional() }),
  output: z.object({ items: z.array(Row) }),
  handler({ input }) {
    const all = getAllInquiries();
    const s = input.status;
    let rows = all;
    if (s === "new" || s === "contacted" || s === "closed") rows = all.filter((r) => r.status === s);
    else if (s === "open") rows = all.filter((r) => r.status !== "closed");
    return { items: rows };
  },
});

export const inquiriesCounts = defineOperation({
  id: "inquiries_counts",
  summary: "Inquiry counts by status",
  tag: "inquiries",
  method: "GET",
  path: "/inquiries/counts",
  scope: "read:inquiries",
  input: z.object({}),
  output: z.object({
    new: z.number().int(),
    contacted: z.number().int(),
    closed: z.number().int(),
    total: z.number().int(),
  }),
  handler: () => inquiryCounts(),
});

export const inquiriesExport = defineOperation({
  id: "inquiries_export",
  summary: "Export inquiries as CSV",
  description:
    "A HoneyBook-importable CSV that follows the admin list. `status` filters like the list " +
    "(new, contacted, closed, open, all). Sent as a file download.",
  tag: "inquiries",
  method: "GET",
  path: "/inquiries/export.csv",
  scope: "read:inquiries",
  text: { contentType: "text/csv; charset=utf-8" },
  input: z.object({ status: StatusFilter.optional() }),
  output: z.string(),
  handler({ input }) {
    const all = getAllInquiries();
    const s = input.status;
    let rows = all;
    if (s === "new" || s === "contacted" || s === "closed") rows = all.filter((r) => r.status === s);
    else if (s === "open") rows = all.filter((r) => r.status !== "closed");
    return withResponse(inquiriesToCsv(rows), {
      headers: {
        "Content-Disposition": `attachment; filename="${csvFilename()}"`,
        "Cache-Control": "no-store",
      },
    });
  },
});

const IdParam = z.coerce.number().int().positive();

export const inquiriesGet = defineOperation({
  id: "inquiries_get",
  summary: "Read an inquiry",
  tag: "inquiries",
  method: "GET",
  path: "/inquiries/{id}",
  scope: "read:inquiries",
  agent: true,
  input: z.object({ id: IdParam }),
  output: Row,
  handler({ input }) {
    const row = getInquiry(input.id);
    if (!row) throw notFound("Inquiry not found.");
    return row;
  },
});

export const inquiriesUpdate = defineOperation({
  id: "inquiries_update",
  summary: "Change an inquiry's status or notes",
  tag: "inquiries",
  method: "PATCH",
  path: "/inquiries/{id}",
  scope: "write:inquiries",
  input: z.object({
    id: IdParam,
    status: z.enum(["new", "contacted", "closed"]).optional(),
    notes: z.string().max(8000).optional(),
  }),
  output: z.object({ ok: z.literal(true), inquiry: Row }),
  handler({ input }) {
    if (!getInquiry(input.id)) throw notFound("Inquiry not found.");
    if (input.status === undefined && input.notes === undefined) throw badRequest("body: Nothing to update");
    if (input.status !== undefined) updateInquiryStatus(input.id, input.status);
    if (input.notes !== undefined) updateInquiryNotes(input.id, input.notes);
    return { ok: true as const, inquiry: getInquiry(input.id)! };
  },
});

export const inquiriesQualify = defineOperation({
  id: "inquiries_qualify",
  summary: "Mark an inquiry qualified (and push it to VSCO)",
  description:
    "Sets qualified_at once; calling again keeps the original time and retries the VSCO push " +
    "(fire-and-forget).",
  tag: "inquiries",
  method: "POST",
  path: "/inquiries/{id}/qualify",
  scope: "write:inquiries",
  input: z.object({ id: IdParam }),
  output: z.object({ ok: z.literal(true), qualified_at: z.string() }),
  handler({ input }) {
    const inquiry = getInquiry(input.id);
    if (!inquiry) throw notFound("Inquiry not found.");
    let qualified_at: string | null = inquiry.qualified_at;
    if (!qualified_at) {
      qualified_at = markInquiryQualified(input.id);
      if (!qualified_at) throw new ApiError("internal_error", "Could not mark qualified.");
    }
    const updated = getInquiry(input.id);
    if (updated) void pushQualifiedToVsco(updated);
    return { ok: true as const, qualified_at };
  },
});

const VSCO_KINDS = [
  "order",
  "event-main",
  "contact-poc",
  "contact-partner-a",
  "contact-partner-b",
  "venue",
] as const;

export const inquiriesVscoClear = defineOperation({
  id: "inquiries_vsco_clear",
  summary: "Forget a recorded VSCO entity",
  description:
    "Debug helper: clears one recorded vsco_entities row (kind: " +
    VSCO_KINDS.join(", ") +
    ") so the next push recreates it. Never touches the Job entity.",
  tag: "inquiries",
  method: "POST",
  path: "/inquiries/{id}/vsco-clear",
  scope: "write:inquiries",
  input: z.object({ id: IdParam, kind: z.enum(VSCO_KINDS) }),
  output: z.object({
    ok: z.literal(true),
    deletedCount: z.number().int(),
    external_uuid: z.string(),
    kind: z.string(),
  }),
  handler({ input }) {
    const inquiry = getInquiry(input.id);
    if (!inquiry) throw notFound("Inquiry not found.");
    if (!inquiry.external_uuid) throw badRequest("id: Inquiry has no external_uuid");
    const result = getDb()
      .prepare("DELETE FROM vsco_entities WHERE external_uuid = ? AND kind = ?")
      .run(inquiry.external_uuid, input.kind);
    return {
      ok: true as const,
      deletedCount: result.changes,
      external_uuid: inquiry.external_uuid,
      kind: input.kind,
    };
  },
});

export const inquiriesVscoDebug = defineOperation({
  id: "inquiries_vsco_debug",
  summary: "Show an inquiry's VSCO entities and push history",
  description: "Debug helper: the vsco_pushes rows (with error bodies) and recorded entities.",
  tag: "inquiries",
  method: "GET",
  path: "/inquiries/{id}/vsco-debug",
  scope: "read:inquiries",
  input: z.object({ id: IdParam }),
  output: z.object({
    inquiry: z.object({
      id: z.number().int(),
      external_uuid: z.string().nullable(),
      qualified_at: z.string().nullable(),
    }),
    entities: z.array(Row),
    pushes: z.array(Row),
  }),
  handler({ input }) {
    const inquiry = getInquiry(input.id);
    if (!inquiry) throw notFound("Inquiry not found.");
    return {
      inquiry: {
        id: inquiry.id,
        external_uuid: inquiry.external_uuid,
        qualified_at: inquiry.qualified_at,
      },
      entities: inquiry.external_uuid ? getVscoEntities(inquiry.external_uuid) : [],
      pushes: getVscoPushesForInquiry(input.id),
    };
  },
});
