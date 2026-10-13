/**
 * The video portfolio: list, read, create, update, delete. Create and update
 * take JSON or multipart/form-data (the admin form carries an optional
 * thumbnail file in the `thumbnail` field). Moved from
 * src/pages/api/admin/portfolio.ts; ids are now in the path.
 *
 * Save flow, as before:
 *   1. Validate; at least one collection; a video URL OR a thumbnail.
 *   2. parseVideoUrl() rejects URLs that are not YouTube, Vimeo or PicTime.
 *   3. A manual thumbnail is validated (<= 5 MB, image/*) before any write.
 *   4. The row is written, then the thumbnail is saved under the new id.
 *   5. With no manual thumbnail, YouTube/Vimeo fall back to oEmbed.
 */

import { z } from "zod";
import { defineOperation } from "@/api/registry/define";
import { badRequest, notFound } from "@/api/registry/errors";
import { COLLECTION_IDS } from "@/content/collection-id";
import { parseVideoUrl, resolveThumbnail } from "@/lib/oembed";
import {
  deletePortfolioItem,
  getPortfolioItem,
  insertPortfolioItem,
  listPortfolio,
  updatePortfolioItem,
} from "@/lib/portfolio";
import { savePortfolioThumbnail, validateThumbnailUpload } from "@/lib/uploads";

/** A database row: keys vary by table, so it is documented as a free-form object. */
const Row = z.record(z.string(), z.any());
const IdParam = z.coerce.number().int().positive();
const URL_ERROR = "URL must be a YouTube, Vimeo, or PicTime gallery link";

/** A single value from a form (one checkbox) becomes a one-item list. */
const collections = z.preprocess(
  (v) => (v === undefined || Array.isArray(v) ? v : [v]),
  z.array(z.enum(COLLECTION_IDS)).min(1, "Pick at least one collection"),
);

const thumbnail = z
  .any()
  .optional()
  .describe("Optional image file (multipart only), at most 5 MB.");

const WriteOutput = z.object({
  ok: z.literal(true),
  id: z.number().int(),
  item: Row.nullable(),
  warning: z.string().optional(),
});

export const portfolioList = defineOperation({
  id: "portfolio_list",
  summary: "List portfolio items",
  description: "Featured first, then display order. `collection` limits to one collection.",
  tag: "portfolio",
  method: "GET",
  path: "/portfolio",
  scope: "read:portfolio",
  agent: true,
  input: z.object({ collection: z.string().optional() }),
  output: z.object({ items: z.array(Row) }),
  handler({ input }) {
    const c = input.collection;
    const filter = c && (COLLECTION_IDS as readonly string[]).includes(c) ? (c as (typeof COLLECTION_IDS)[number]) : "all";
    return { items: listPortfolio({ collection: filter }) };
  },
});

export const portfolioGet = defineOperation({
  id: "portfolio_get",
  summary: "Read a portfolio item",
  tag: "portfolio",
  method: "GET",
  path: "/portfolio/{id}",
  scope: "read:portfolio",
  input: z.object({ id: IdParam }),
  output: Row,
  handler({ input }) {
    const item = getPortfolioItem(input.id);
    if (!item) throw notFound("Item not found.");
    return item;
  },
});

export const portfolioCreate = defineOperation({
  id: "portfolio_create",
  summary: "Add a portfolio item",
  description:
    "JSON, or multipart/form-data when uploading a thumbnail. A card needs a video URL or a thumbnail. " +
    "If the item saves but the thumbnail does not, the answer is 201 with a `warning`.",
  tag: "portfolio",
  method: "POST",
  path: "/portfolio",
  scope: "write:portfolio",
  multipart: true,
  successStatus: 201,
  input: z.object({
    collections,
    title: z.string().trim().min(1, "Title is required").max(200),
    url: z.string().trim().max(500).optional(),
    gallery_url: z.string().trim().max(500).optional(),
    description: z.string().trim().max(2000).optional(),
    featured: z.coerce.boolean().optional().default(false),
    display_order: z.coerce.number().int().optional().default(0),
    thumbnail,
  }),
  output: WriteOutput,
  async handler({ input }) {
    const file = (input.thumbnail instanceof File ? input.thumbnail : null) as File | null;
    const url = input.url || undefined;

    if (!url && !file) {
      throw badRequest(
        "url: Provide a video URL OR upload a custom thumbnail — photo-only items still need a thumbnail.",
      );
    }
    let video: ReturnType<typeof parseVideoUrl> = null;
    if (url) {
      video = parseVideoUrl(url);
      if (!video) throw badRequest(`url: ${URL_ERROR}`);
    }
    if (file) {
      const err = validateThumbnailUpload(file);
      if (err) throw badRequest(`thumbnail: ${err}`);
    }

    let autoThumb: string | null = null;
    if (video && !file) {
      try {
        autoThumb = await resolveThumbnail(video);
      } catch {
        /* the placeholder will render */
      }
    }

    const { id } = insertPortfolioItem({
      collections: input.collections,
      title: input.title,
      url: url ?? null,
      description: input.description || null,
      gallery_url: input.gallery_url || null,
      featured: input.featured,
      display_order: input.display_order,
      parsed: video,
      thumbnail_url: autoThumb,
    });

    if (file) {
      try {
        const buf = Buffer.from(await file.arrayBuffer());
        const saved = await savePortfolioThumbnail(id, buf);
        updatePortfolioItem(id, { thumbnail_url: saved });
      } catch (e) {
        return {
          ok: true as const,
          id,
          item: getPortfolioItem(id) ?? null,
          warning: `Item saved but thumbnail upload failed: ${e instanceof Error ? e.message : "unknown error"}`,
        };
      }
    }
    return { ok: true as const, id, item: getPortfolioItem(id) ?? null };
  },
});

export const portfolioUpdate = defineOperation({
  id: "portfolio_update",
  summary: "Change a portfolio item",
  description:
    "JSON, or multipart/form-data when uploading a thumbnail. Only the fields sent change. An empty " +
    "`url` turns the item into a photo-only entry (it must then keep a thumbnail).",
  tag: "portfolio",
  method: "PATCH",
  path: "/portfolio/{id}",
  scope: "write:portfolio",
  multipart: true,
  input: z.object({
    id: IdParam,
    collections: collections.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    url: z.string().trim().max(500).optional(),
    gallery_url: z.string().trim().max(500).optional(),
    description: z.string().trim().max(2000).optional(),
    featured: z.coerce.boolean().optional(),
    display_order: z.coerce.number().int().optional(),
    thumbnail,
  }),
  output: WriteOutput,
  async handler({ input }) {
    const id = input.id;
    const existing = getPortfolioItem(id);
    if (!existing) throw notFound("Item not found.");
    const file = (input.thumbnail instanceof File ? input.thumbnail : null) as File | null;

    // `url` sent but empty: the caller is removing the video.
    const urlProvided = input.url !== undefined;
    const url = input.url || undefined;

    let parsedVideo: ReturnType<typeof parseVideoUrl> | undefined = undefined;
    let autoThumbnail: string | null | undefined = undefined;
    if (url) {
      const video = parseVideoUrl(url);
      if (!video) throw badRequest(`url: ${URL_ERROR}`);
      parsedVideo = video;
      if (!file) {
        try {
          autoThumbnail = await resolveThumbnail(video);
        } catch {
          /* ignore */
        }
      }
    } else if (urlProvided) {
      parsedVideo = null;
    }

    if (file) {
      const err = validateThumbnailUpload(file);
      if (err) throw badRequest(`thumbnail: ${err}`);
    }

    // After the update the item must still carry a URL or a usable thumbnail.
    const willHaveUrl = urlProvided ? Boolean(url) : Boolean(existing.url);
    const willHaveThumbnail =
      Boolean(file) || (autoThumbnail !== undefined ? Boolean(autoThumbnail) : Boolean(existing.thumbnail_url));
    if (!willHaveUrl && !willHaveThumbnail) {
      throw badRequest(
        "url: Item must keep either a video URL or a thumbnail. Upload a thumbnail before clearing the URL.",
      );
    }

    const changed = updatePortfolioItem(id, {
      collections: input.collections,
      title: input.title,
      url: urlProvided ? (url ?? null) : undefined,
      description: input.description !== undefined ? input.description || null : undefined,
      gallery_url: input.gallery_url !== undefined ? input.gallery_url || undefined : undefined,
      featured: input.featured,
      display_order: input.display_order,
      parsed: parsedVideo,
      thumbnail_url: autoThumbnail,
    });

    if (file) {
      try {
        const buf = Buffer.from(await file.arrayBuffer());
        const saved = await savePortfolioThumbnail(id, buf);
        updatePortfolioItem(id, { thumbnail_url: saved });
      } catch (e) {
        return {
          ok: true as const,
          id,
          item: getPortfolioItem(id) ?? null,
          warning: `Item updated but thumbnail upload failed: ${e instanceof Error ? e.message : "unknown error"}`,
        };
      }
    }
    if (!changed && !file) throw badRequest("body: Nothing to update");
    return { ok: true as const, id, item: getPortfolioItem(id) ?? null };
  },
});

export const portfolioDelete = defineOperation({
  id: "portfolio_delete",
  summary: "Delete a portfolio item",
  tag: "portfolio",
  method: "DELETE",
  path: "/portfolio/{id}",
  scope: "write:portfolio",
  input: z.object({ id: IdParam }),
  output: z.object({ ok: z.literal(true) }),
  handler({ input }) {
    if (!deletePortfolioItem(input.id)) throw notFound("Item not found.");
    return { ok: true as const };
  },
});
