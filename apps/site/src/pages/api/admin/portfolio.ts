/**
 * /api/admin/portfolio — POST (create), PATCH (update), DELETE.
 *
 * Behind the admin middleware. All body parsing is JSON. Save flow:
 *   1. Validate input.
 *   2. parseVideoUrl() — reject early if the URL isn't YouTube or Vimeo.
 *   3. resolveThumbnail() — fetch the thumbnail URL (best-effort; failure
 *      is non-fatal, the card will fall back to a typographic placeholder).
 *   4. Insert / update row.
 */

import type { APIRoute } from "astro";
import { z } from "zod";
import { COLLECTION_IDS } from "@/content/collection-id";
import { parseVideoUrl, resolveThumbnail } from "@/lib/oembed";
import {
  deletePortfolioItem,
  getPortfolioItem,
  insertPortfolioItem,
  updatePortfolioItem,
} from "@/lib/portfolio";

export const prerender = false;

const CreateSchema = z.object({
  collection: z.enum(COLLECTION_IDS),
  title: z.string().trim().min(1, "Title is required").max(200),
  url: z.string().trim().min(1, "URL is required").max(500),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  featured: z.coerce.boolean().optional().default(false),
  display_order: z.coerce.number().int().optional().default(0),
});

const UpdateSchema = z.object({
  id: z.coerce.number().int().positive(),
  collection: z.enum(COLLECTION_IDS).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  url: z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  featured: z.coerce.boolean().optional(),
  display_order: z.coerce.number().int().optional(),
});

export const POST: APIRoute = async ({ request }) => {
  const body = await readJson(request);
  if (!body) return json(400, { error: "Body must be valid JSON" });

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const video = parseVideoUrl(parsed.data.url);
  if (!video) {
    return json(400, { error: "URL must be a YouTube or Vimeo link" });
  }

  // Best-effort thumbnail fetch.
  let thumbnail: string | null = null;
  try {
    thumbnail = await resolveThumbnail(video);
  } catch {
    /* ignore */
  }

  const { id } = insertPortfolioItem({
    collection: parsed.data.collection,
    title: parsed.data.title,
    url: parsed.data.url,
    description: parsed.data.description || null,
    featured: parsed.data.featured,
    display_order: parsed.data.display_order,
    parsed: video,
    thumbnail_url: thumbnail,
  });

  return json(201, { ok: true, id, item: getPortfolioItem(id) });
};

export const PATCH: APIRoute = async ({ request }) => {
  const body = await readJson(request);
  if (!body) return json(400, { error: "Body must be valid JSON" });

  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const id = parsed.data.id;
  if (!getPortfolioItem(id)) return json(404, { error: "Item not found" });

  // If URL changed, re-parse + re-fetch thumbnail.
  let parsedVideo = undefined;
  let thumbnail = undefined;
  if (parsed.data.url) {
    const video = parseVideoUrl(parsed.data.url);
    if (!video) {
      return json(400, { error: "URL must be a YouTube or Vimeo link" });
    }
    parsedVideo = video;
    try { thumbnail = await resolveThumbnail(video); } catch { /* ignore */ }
  }

  const ok = updatePortfolioItem(id, {
    collection: parsed.data.collection,
    title: parsed.data.title,
    url: parsed.data.url,
    description: parsed.data.description !== undefined ? parsed.data.description || null : undefined,
    featured: parsed.data.featured,
    display_order: parsed.data.display_order,
    parsed: parsedVideo,
    thumbnail_url: thumbnail,
  });

  if (!ok) return json(400, { error: "Nothing to update" });

  return json(200, { ok: true, item: getPortfolioItem(id) });
};

export const DELETE: APIRoute = async ({ request }) => {
  const body = await readJson(request);
  if (!body || typeof body !== "object" || !("id" in body)) {
    return json(400, { error: "Body must include id" });
  }
  const id = Number((body as Record<string, unknown>).id);
  if (!Number.isFinite(id) || id <= 0) return json(400, { error: "Invalid id" });

  const ok = deletePortfolioItem(id);
  if (!ok) return json(404, { error: "Item not found" });

  return json(200, { ok: true });
};

/* ============================================================================
 * Helpers
 * ============================================================================ */

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
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
