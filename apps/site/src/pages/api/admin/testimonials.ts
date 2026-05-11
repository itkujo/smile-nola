/**
 * /api/admin/testimonials — POST (create), PATCH (update), DELETE.
 * Behind the admin middleware. Same pattern as portfolio.
 */

import type { APIRoute } from "astro";
import { z } from "zod";
import {
  deleteTestimonial,
  getTestimonial,
  insertTestimonial,
  updateTestimonial,
} from "@/lib/testimonials";

export const prerender = false;

const CreateSchema = z.object({
  quote: z.string().trim().min(1, "Quote is required").max(4000),
  attribution: z.string().trim().min(1, "Attribution is required").max(200),
  featured: z.coerce.boolean().optional().default(false),
  display_order: z.coerce.number().int().optional().default(0),
});

const UpdateSchema = z.object({
  id: z.coerce.number().int().positive(),
  quote: z.string().trim().min(1).max(4000).optional(),
  attribution: z.string().trim().min(1).max(200).optional(),
  featured: z.coerce.boolean().optional(),
  display_order: z.coerce.number().int().optional(),
});

export const POST: APIRoute = async ({ request }) => {
  const body = await readJson(request);
  if (!body) return json(400, { error: "Body must be valid JSON" });
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  const { id } = insertTestimonial(parsed.data);
  return json(201, { ok: true, id, item: getTestimonial(id) });
};

export const PATCH: APIRoute = async ({ request }) => {
  const body = await readJson(request);
  if (!body) return json(400, { error: "Body must be valid JSON" });
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  const { id, ...rest } = parsed.data;
  if (!getTestimonial(id)) return json(404, { error: "Testimonial not found" });
  const ok = updateTestimonial(id, rest);
  if (!ok) return json(400, { error: "Nothing to update" });
  return json(200, { ok: true, item: getTestimonial(id) });
};

export const DELETE: APIRoute = async ({ request }) => {
  const body = await readJson(request);
  if (!body || typeof body !== "object" || !("id" in body)) {
    return json(400, { error: "Body must include id" });
  }
  const id = Number((body as Record<string, unknown>).id);
  if (!Number.isFinite(id) || id <= 0) return json(400, { error: "Invalid id" });
  const ok = deleteTestimonial(id);
  if (!ok) return json(404, { error: "Testimonial not found" });
  return json(200, { ok: true });
};

async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return null; }
}

function validationError(error: z.ZodError): Response {
  const details: Record<string, string> = {};
  for (const issue of error.issues) {
    details[issue.path.join(".") || "_"] = issue.message;
  }
  return json(400, { error: "Validation failed", details });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
