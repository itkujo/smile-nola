/**
 * PATCH /api/admin/inquiries/<id>
 *
 * Updates an inquiry's status and/or admin notes. Behind the middleware
 * guard.
 *
 * Body (JSON): { status?: 'new'|'contacted'|'closed', notes?: string }
 */

import type { APIRoute } from "astro";
import { z } from "zod";
import { getInquiry, updateInquiryNotes, updateInquiryStatus } from "@/lib/db";

export const prerender = false;

const PatchSchema = z.object({
  status: z.enum(["new", "contacted", "closed"]).optional(),
  notes: z.string().max(8000).optional(),
});

export const PATCH: APIRoute = async ({ request, params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return json(400, { error: "Invalid id" });
  }
  if (!getInquiry(id)) {
    return json(404, { error: "Inquiry not found" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Body must be valid JSON" });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    const details: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      details[issue.path.join(".") || "_"] = issue.message;
    }
    return json(400, { error: "Validation failed", details });
  }

  const { status, notes } = parsed.data;
  if (status === undefined && notes === undefined) {
    return json(400, { error: "Nothing to update" });
  }

  if (status !== undefined) updateInquiryStatus(id, status);
  if (notes !== undefined) updateInquiryNotes(id, notes);

  const updated = getInquiry(id);
  return json(200, { ok: true, inquiry: updated });
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
