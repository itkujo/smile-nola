/**
 * Testimonials data layer — CRUD against the `testimonials` table.
 * Schema lives in lib/db.ts.
 */

import { getDb } from "@/lib/db";

export interface TestimonialRow {
  id: number;
  created_at: string;
  quote: string;
  attribution: string;
  featured: number;
  display_order: number;
}

export interface TestimonialInput {
  quote: string;
  attribution: string;
  featured?: boolean;
  display_order?: number;
}

export function listTestimonials(opts?: { onlyFeatured?: boolean; limit?: number }): TestimonialRow[] {
  const db = getDb();
  let sql = "SELECT * FROM testimonials";
  if (opts?.onlyFeatured) sql += " WHERE featured = 1";
  sql += " ORDER BY featured DESC, display_order ASC, created_at DESC";
  if (opts?.limit) sql += ` LIMIT ${opts.limit}`;
  return db.prepare(sql).all() as TestimonialRow[];
}

export function getTestimonial(id: number): TestimonialRow | undefined {
  return getDb()
    .prepare("SELECT * FROM testimonials WHERE id = ?")
    .get(id) as TestimonialRow | undefined;
}

export function insertTestimonial(input: TestimonialInput): { id: number } {
  const r = getDb()
    .prepare(
      `INSERT INTO testimonials (quote, attribution, featured, display_order)
       VALUES (@quote, @attribution, @featured, @display_order)`
    )
    .run({
      quote: input.quote,
      attribution: input.attribution,
      featured: input.featured ? 1 : 0,
      display_order: input.display_order ?? 0,
    });
  return { id: Number(r.lastInsertRowid) };
}

export function updateTestimonial(id: number, input: Partial<TestimonialInput>): boolean {
  const fields: string[] = [];
  const params: Record<string, unknown> = { id };
  if (input.quote !== undefined) { fields.push("quote = @quote"); params.quote = input.quote; }
  if (input.attribution !== undefined) { fields.push("attribution = @attribution"); params.attribution = input.attribution; }
  if (input.featured !== undefined) { fields.push("featured = @featured"); params.featured = input.featured ? 1 : 0; }
  if (input.display_order !== undefined) { fields.push("display_order = @display_order"); params.display_order = input.display_order; }
  if (fields.length === 0) return false;
  const r = getDb()
    .prepare(`UPDATE testimonials SET ${fields.join(", ")} WHERE id = @id`)
    .run(params);
  return r.changes > 0;
}

export function deleteTestimonial(id: number): boolean {
  const r = getDb().prepare("DELETE FROM testimonials WHERE id = ?").run(id);
  return r.changes > 0;
}
