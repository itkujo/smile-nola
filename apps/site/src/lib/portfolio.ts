/**
 * Portfolio data layer — CRUD against the `portfolio_items` table.
 *
 * Schema lives in lib/db.ts. This module wraps it with typed CRUD helpers
 * + a few read patterns (per-collection list, featured-list, etc.).
 *
 * Collections are stored as a JSON array in the `collections` column. The
 * array's order is normalised to canonical COLLECTIONS order on every write
 * so the public chip rendering is deterministic (smile → visionary →
 * digital-atelier → aurora → resonance), regardless of how the admin
 * checked the boxes.
 */

import { getDb } from "@/lib/db";
import type { CollectionId } from "@/content/collection-id";
import { COLLECTION_IDS, isCollectionId } from "@/content/collection-id";
import type { ParsedVideo } from "@/lib/oembed";

/* ============================================================================
 * Row types
 * ========================================================================= */

/** Raw row as it lives in SQLite — `collections` is a JSON string. */
interface PortfolioRowRaw {
  id: number;
  created_at: string;
  collections: string;
  title: string;
  url: string | null;          // null for photo-only items (no video)
  thumbnail_url: string | null;
  embed_id: string | null;
  provider: "youtube" | "vimeo" | "pictime" | null;
  description: string | null;
  gallery_url: string | null;  // optional deep-link to the full client gallery
  featured: number; // 0 | 1
  display_order: number;
}

/** Hydrated row consumed by Astro pages — `collections` is a typed array. */
export interface PortfolioRow {
  id: number;
  created_at: string;
  collections: CollectionId[];
  title: string;
  url: string | null;
  thumbnail_url: string | null;
  embed_id: string | null;
  provider: "youtube" | "vimeo" | "pictime" | null;
  description: string | null;
  gallery_url: string | null;
  featured: number;
  display_order: number;
}

export interface PortfolioInput {
  collections: CollectionId[]; // ≥ 1 enforced at the API layer
  title: string;
  /** null/undefined for photo-only items; the API layer enforces that at
   *  least one of (url, thumbnail) is present. */
  url?: string | null;
  description?: string | null;
  gallery_url?: string | null;
  featured?: boolean;
  display_order?: number;
  parsed?: ParsedVideo | null;
  thumbnail_url?: string | null;
}

/* ============================================================================
 * Helpers
 * ========================================================================= */

/**
 * Normalise the collections array on write:
 *   - Drop anything that isn't a known slug
 *   - Drop duplicates
 *   - Re-sort to canonical COLLECTION_IDS order so chip rendering is stable
 */
function normaliseCollections(input: readonly string[]): CollectionId[] {
  const valid = new Set<CollectionId>();
  for (const c of input) {
    if (isCollectionId(c)) valid.add(c);
  }
  return COLLECTION_IDS.filter((id) => valid.has(id));
}

function hydrate(raw: PortfolioRowRaw): PortfolioRow {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.collections);
  } catch {
    parsed = [];
  }
  const arr = Array.isArray(parsed) ? parsed.filter(isCollectionId) : [];
  return { ...raw, collections: arr };
}

/* ============================================================================
 * Reads
 * ========================================================================= */

/**
 * List portfolio items, optionally filtered to a single collection.
 *
 * Filter implementation: SQLite's JSON1 `json_each` lets us test for set
 * membership without parsing in JS — `WHERE EXISTS (SELECT 1 FROM
 * json_each(collections) WHERE value = ?)`. Volume is tiny so the cost is
 * irrelevant.
 */
export function listPortfolio(opts?: {
  collection?: CollectionId | "all";
  featuredFirst?: boolean;
}): PortfolioRow[] {
  const db = getDb();
  const filter = opts?.collection;
  let rows: PortfolioRowRaw[];
  if (filter && filter !== "all" && isCollectionId(filter)) {
    rows = db
      .prepare(
        `SELECT * FROM portfolio_items
         WHERE EXISTS (SELECT 1 FROM json_each(collections) WHERE value = ?)
         ORDER BY featured DESC, display_order ASC, created_at DESC`,
      )
      .all(filter) as PortfolioRowRaw[];
  } else {
    rows = db
      .prepare(
        `SELECT * FROM portfolio_items
         ORDER BY featured DESC, display_order ASC, created_at DESC`,
      )
      .all() as PortfolioRowRaw[];
  }
  return rows.map(hydrate);
}

export function getPortfolioItem(id: number): PortfolioRow | undefined {
  const row = getDb()
    .prepare("SELECT * FROM portfolio_items WHERE id = ?")
    .get(id) as PortfolioRowRaw | undefined;
  return row ? hydrate(row) : undefined;
}

export function getFeaturedPortfolio(limit = 1): PortfolioRow[] {
  return (
    getDb()
      .prepare(
        `SELECT * FROM portfolio_items
         WHERE featured = 1
         ORDER BY display_order ASC, created_at DESC
         LIMIT ?`,
      )
      .all(limit) as PortfolioRowRaw[]
  ).map(hydrate);
}

/* ============================================================================
 * Writes
 * ========================================================================= */

export function insertPortfolioItem(input: PortfolioInput): { id: number } {
  const collections = normaliseCollections(input.collections);
  if (collections.length === 0) {
    throw new Error("At least one collection is required");
  }
  const r = getDb()
    .prepare(
      `INSERT INTO portfolio_items (
        collections, title, url, thumbnail_url, embed_id, provider,
        description, gallery_url, featured, display_order
      ) VALUES (
        @collections, @title, @url, @thumbnail_url, @embed_id, @provider,
        @description, @gallery_url, @featured, @display_order
      )`,
    )
    .run({
      collections: JSON.stringify(collections),
      title: input.title,
      url: input.url ?? null,
      thumbnail_url: input.thumbnail_url ?? null,
      embed_id: input.parsed?.embedId ?? null,
      provider: input.parsed?.provider ?? null,
      description: input.description ?? null,
      gallery_url: input.gallery_url ?? null,
      featured: input.featured ? 1 : 0,
      display_order: input.display_order ?? 0,
    });
  return { id: Number(r.lastInsertRowid) };
}

export function updatePortfolioItem(
  id: number,
  input: Partial<PortfolioInput>,
): boolean {
  const fields: string[] = [];
  const params: Record<string, unknown> = { id };
  if (input.collections !== undefined) {
    const normalised = normaliseCollections(input.collections);
    if (normalised.length === 0) {
      throw new Error("At least one collection is required");
    }
    fields.push("collections = @collections");
    params.collections = JSON.stringify(normalised);
  }
  if (input.title !== undefined) {
    fields.push("title = @title");
    params.title = input.title;
  }
  if (input.url !== undefined) {
    fields.push("url = @url");
    params.url = input.url ?? null;
  }
  if (input.thumbnail_url !== undefined) {
    fields.push("thumbnail_url = @thumbnail_url");
    params.thumbnail_url = input.thumbnail_url ?? null;
  }
  if (input.parsed !== undefined) {
    fields.push("embed_id = @embed_id");
    fields.push("provider = @provider");
    params.embed_id = input.parsed?.embedId ?? null;
    params.provider = input.parsed?.provider ?? null;
  }
  if (input.description !== undefined) {
    fields.push("description = @description");
    params.description = input.description ?? null;
  }
  if (input.gallery_url !== undefined) {
    fields.push("gallery_url = @gallery_url");
    params.gallery_url = input.gallery_url ?? null;
  }
  if (input.featured !== undefined) {
    fields.push("featured = @featured");
    params.featured = input.featured ? 1 : 0;
  }
  if (input.display_order !== undefined) {
    fields.push("display_order = @display_order");
    params.display_order = input.display_order;
  }

  if (fields.length === 0) return false;

  const r = getDb()
    .prepare(`UPDATE portfolio_items SET ${fields.join(", ")} WHERE id = @id`)
    .run(params);
  return r.changes > 0;
}

export function deletePortfolioItem(id: number): boolean {
  const r = getDb()
    .prepare("DELETE FROM portfolio_items WHERE id = ?")
    .run(id);
  return r.changes > 0;
}
