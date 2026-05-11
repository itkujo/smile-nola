/**
 * /api/admin/portfolio — POST (create), PATCH (update), DELETE.
 *
 * Behind the admin middleware. Accepts BOTH application/json (legacy clients,
 * delete) AND multipart/form-data (the admin form, since it can carry a
 * thumbnail file). The form always sends multipart so it can include a
 * file even when one isn't selected; we just detect and branch on the
 * Content-Type.
 *
 * Save flow:
 *   1. Validate input + at-least-one collection.
 *   2. parseVideoUrl() — reject early if the URL isn't a known provider.
 *   3. If a manual thumbnail was uploaded, validate it (≤ 5 MB, image/*).
 *   4. Insert / update row to mint or fetch the item id.
 *   5. Save the manual thumbnail under that id, then patch the URL back.
 *      (We do this after step 4 because the filename uses the item id.)
 *   6. If no manual upload, fall back to resolveThumbnail() (oEmbed) — only
 *      for YouTube/Vimeo. PicTime returns null; the typographic placeholder
 *      kicks in on the card.
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
import {
  savePortfolioThumbnail,
  validateThumbnailUpload,
} from "@/lib/uploads";

export const prerender = false;

/* ============================================================================
 * Schemas
 * ========================================================================= */

const collectionsField = z
  .array(z.enum(COLLECTION_IDS))
  .min(1, "Pick at least one collection");

const CreateSchema = z.object({
  collections: collectionsField,
  title: z.string().trim().min(1, "Title is required").max(200),
  url: z.string().trim().min(1, "URL is required").max(500),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  featured: z.coerce.boolean().optional().default(false),
  display_order: z.coerce.number().int().optional().default(0),
});

const UpdateSchema = z.object({
  id: z.coerce.number().int().positive(),
  collections: collectionsField.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  url: z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  featured: z.coerce.boolean().optional(),
  display_order: z.coerce.number().int().optional(),
});

/* ============================================================================
 * POST — create
 * ========================================================================= */

export const POST: APIRoute = async ({ request }) => {
  const { fields, thumbnailFile, error: parseError } = await readFormOrJson(request);
  if (parseError) return json(400, { error: parseError });

  const parsedInput = CreateSchema.safeParse(fields);
  if (!parsedInput.success) return validationError(parsedInput.error);

  const video = parseVideoUrl(parsedInput.data.url);
  if (!video) {
    return json(400, {
      error: "URL must be a YouTube, Vimeo, or PicTime gallery link",
    });
  }

  // Validate thumbnail upload up front so we don't insert a row only to
  // discover the file is bad.
  if (thumbnailFile) {
    const err = validateThumbnailUpload(thumbnailFile);
    if (err) return json(400, { error: err });
  }

  // Best-effort auto-thumbnail (YouTube/Vimeo only). Manual upload wins if
  // both are present.
  let thumbnail: string | null = null;
  if (!thumbnailFile) {
    try {
      thumbnail = await resolveThumbnail(video);
    } catch {
      /* ignore — placeholder will render */
    }
  }

  const { id } = insertPortfolioItem({
    collections: parsedInput.data.collections,
    title: parsedInput.data.title,
    url: parsedInput.data.url,
    description: parsedInput.data.description || null,
    featured: parsedInput.data.featured,
    display_order: parsedInput.data.display_order,
    parsed: video,
    thumbnail_url: thumbnail,
  });

  // Save the manual thumbnail (if any) NOW that we have the id, then patch
  // the URL onto the row.
  if (thumbnailFile) {
    try {
      const buf = Buffer.from(await thumbnailFile.arrayBuffer());
      const url = await savePortfolioThumbnail(id, buf);
      updatePortfolioItem(id, { thumbnail_url: url });
    } catch (e) {
      // Item was created but thumbnail save failed — surface the partial
      // success so the admin knows to retry the upload.
      return json(201, {
        ok: true,
        id,
        item: getPortfolioItem(id),
        warning: `Item saved but thumbnail upload failed: ${
          e instanceof Error ? e.message : "unknown error"
        }`,
      });
    }
  }

  return json(201, { ok: true, id, item: getPortfolioItem(id) });
};

/* ============================================================================
 * PATCH — update
 * ========================================================================= */

export const PATCH: APIRoute = async ({ request }) => {
  const { fields, thumbnailFile, error: parseError } = await readFormOrJson(request);
  if (parseError) return json(400, { error: parseError });

  const parsedInput = UpdateSchema.safeParse(fields);
  if (!parsedInput.success) return validationError(parsedInput.error);

  const id = parsedInput.data.id;
  if (!getPortfolioItem(id)) return json(404, { error: "Item not found" });

  // If URL changed, re-parse + maybe re-fetch the auto thumbnail.
  let parsedVideo = undefined;
  let autoThumbnail: string | null | undefined = undefined;
  if (parsedInput.data.url) {
    const video = parseVideoUrl(parsedInput.data.url);
    if (!video) {
      return json(400, {
        error: "URL must be a YouTube, Vimeo, or PicTime gallery link",
      });
    }
    parsedVideo = video;
    // Only auto-fetch if no manual upload accompanies this PATCH.
    if (!thumbnailFile) {
      try {
        autoThumbnail = await resolveThumbnail(video);
      } catch {
        /* ignore */
      }
    }
  }

  // Validate manual thumbnail before touching the row.
  if (thumbnailFile) {
    const err = validateThumbnailUpload(thumbnailFile);
    if (err) return json(400, { error: err });
  }

  // Apply the non-thumbnail updates first.
  const ok = updatePortfolioItem(id, {
    collections: parsedInput.data.collections,
    title: parsedInput.data.title,
    url: parsedInput.data.url,
    description:
      parsedInput.data.description !== undefined
        ? parsedInput.data.description || null
        : undefined,
    featured: parsedInput.data.featured,
    display_order: parsedInput.data.display_order,
    parsed: parsedVideo,
    thumbnail_url: autoThumbnail,
  });

  // Then save the manual thumbnail if provided.
  if (thumbnailFile) {
    try {
      const buf = Buffer.from(await thumbnailFile.arrayBuffer());
      const url = await savePortfolioThumbnail(id, buf);
      updatePortfolioItem(id, { thumbnail_url: url });
    } catch (e) {
      return json(200, {
        ok: true,
        item: getPortfolioItem(id),
        warning: `Item updated but thumbnail upload failed: ${
          e instanceof Error ? e.message : "unknown error"
        }`,
      });
    }
  }

  if (!ok && !thumbnailFile) {
    return json(400, { error: "Nothing to update" });
  }

  return json(200, { ok: true, item: getPortfolioItem(id) });
};

/* ============================================================================
 * DELETE
 * ========================================================================= */

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
 * Body parsing
 *
 * The admin form posts multipart so it can carry an optional thumbnail file.
 * Older callers (and the delete handler) post JSON. readFormOrJson detects
 * the content-type and normalises both into a plain `fields` object plus an
 * optional File handle.
 * ========================================================================= */

interface ParsedBody {
  fields: Record<string, unknown>;
  thumbnailFile: File | null;
  error: string | null;
}

async function readFormOrJson(request: Request): Promise<ParsedBody> {
  const ct = request.headers.get("content-type") ?? "";

  if (ct.includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      const fields: Record<string, unknown> = {};
      let thumbnailFile: File | null = null;
      // Collect `collections` as an array (it appears once per checked box).
      const collections: string[] = [];
      for (const [key, value] of form.entries()) {
        if (key === "thumbnail" && value instanceof File && value.size > 0) {
          thumbnailFile = value;
        } else if (key === "collections" && typeof value === "string") {
          collections.push(value);
        } else if (typeof value === "string") {
          fields[key] = value;
        }
      }
      if (collections.length > 0) fields.collections = collections;
      return { fields, thumbnailFile, error: null };
    } catch {
      return { fields: {}, thumbnailFile: null, error: "Could not parse form data" };
    }
  }

  // JSON path
  const body = await readJson(request);
  if (body === null || typeof body !== "object") {
    return { fields: {}, thumbnailFile: null, error: "Body must be valid JSON" };
  }
  return { fields: body as Record<string, unknown>, thumbnailFile: null, error: null };
}

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
