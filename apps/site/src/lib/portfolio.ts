/**
 * Portfolio data layer — CRUD against the `portfolio_items` table.
 *
 * Schema lives in lib/db.ts. This module wraps it with typed CRUD helpers
 * + a few read patterns (per-collection list, featured-list, etc.).
 */

import { getDb } from "@/lib/db";
import type { CollectionId } from "@/content/collection-id";
import { isCollectionId } from "@/content/collection-id";
import type { ParsedVideo } from "@/lib/oembed";

export interface PortfolioRow {
  id: number;
  created_at: string;
  collection: CollectionId;
  title: string;
  url: string;
  thumbnail_url: string | null;
  embed_id: string | null;
  provider: "youtube" | "vimeo" | "pictime" | null;
  description: string | null;
  featured: number; // 0 | 1
  display_order: number;
}

export interface PortfolioInput {
  collection: CollectionId;
  title: string;
  url: string;
  description?: string | null;
  featured?: boolean;
  display_order?: number;
  parsed?: ParsedVideo | null;
  thumbnail_url?: string | null;
}

export function listPortfolio(opts?: {
  collection?: CollectionId | "all";
  featuredFirst?: boolean;
}): PortfolioRow[] {
  const db = getDb();
  const filter = opts?.collection;
  if (filter && filter !== "all" && isCollectionId(filter)) {
    return db
      .prepare(
        "SELECT * FROM portfolio_items WHERE collection = ? ORDER BY featured DESC, display_order ASC, created_at DESC"
      )
      .all(filter) as PortfolioRow[];
  }
  return db
    .prepare(
      "SELECT * FROM portfolio_items ORDER BY featured DESC, display_order ASC, created_at DESC"
    )
    .all() as PortfolioRow[];
}

export function getPortfolioItem(id: number): PortfolioRow | undefined {
  return getDb()
    .prepare("SELECT * FROM portfolio_items WHERE id = ?")
    .get(id) as PortfolioRow | undefined;
}

export function getFeaturedPortfolio(limit = 1): PortfolioRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM portfolio_items WHERE featured = 1 ORDER BY display_order ASC, created_at DESC LIMIT ?"
    )
    .all(limit) as PortfolioRow[];
}

export function insertPortfolioItem(input: PortfolioInput): { id: number } {
  const r = getDb()
    .prepare(
      `INSERT INTO portfolio_items (
        collection, title, url, thumbnail_url, embed_id, provider,
        description, featured, display_order
      ) VALUES (
        @collection, @title, @url, @thumbnail_url, @embed_id, @provider,
        @description, @featured, @display_order
      )`
    )
    .run({
      collection: input.collection,
      title: input.title,
      url: input.url,
      thumbnail_url: input.thumbnail_url ?? null,
      embed_id: input.parsed?.embedId ?? null,
      provider: input.parsed?.provider ?? null,
      description: input.description ?? null,
      featured: input.featured ? 1 : 0,
      display_order: input.display_order ?? 0,
    });
  return { id: Number(r.lastInsertRowid) };
}

export function updatePortfolioItem(id: number, input: Partial<PortfolioInput>): boolean {
  // Build the update dynamically so each call only touches what changed.
  const fields: string[] = [];
  const params: Record<string, unknown> = { id };
  if (input.collection !== undefined) { fields.push("collection = @collection"); params.collection = input.collection; }
  if (input.title !== undefined)      { fields.push("title = @title");           params.title = input.title; }
  if (input.url !== undefined)        { fields.push("url = @url");               params.url = input.url; }
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
  if (input.description !== undefined) { fields.push("description = @description"); params.description = input.description ?? null; }
  if (input.featured !== undefined)    { fields.push("featured = @featured"); params.featured = input.featured ? 1 : 0; }
  if (input.display_order !== undefined) { fields.push("display_order = @display_order"); params.display_order = input.display_order; }

  if (fields.length === 0) return false;

  const r = getDb()
    .prepare(`UPDATE portfolio_items SET ${fields.join(", ")} WHERE id = @id`)
    .run(params);
  return r.changes > 0;
}

export function deletePortfolioItem(id: number): boolean {
  const r = getDb().prepare("DELETE FROM portfolio_items WHERE id = ?").run(id);
  return r.changes > 0;
}
