/**
 * Testimonials: list, read, create, update, delete. Moved from
 * src/pages/api/admin/testimonials.ts; ids are now in the path.
 */

import { z } from "zod";
import { defineOperation } from "@/api/registry/define";
import { badRequest, notFound } from "@/api/registry/errors";
import {
  deleteTestimonial,
  getTestimonial,
  insertTestimonial,
  listTestimonials,
  updateTestimonial,
} from "@/lib/testimonials";

/** A database row: keys vary by table, so it is documented as a free-form object. */
const Row = z.record(z.string(), z.any());
const IdParam = z.coerce.number().int().positive();

export const testimonialsList = defineOperation({
  id: "testimonials_list",
  summary: "List testimonials",
  description: "Featured first, then display order. `featured=true` limits to featured ones.",
  tag: "testimonials",
  method: "GET",
  path: "/testimonials",
  scope: "read:testimonials",
  agent: true,
  input: z.object({
    featured: z.enum(["true", "false"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  }),
  output: z.object({ items: z.array(Row) }),
  handler({ input }) {
    return { items: listTestimonials({ onlyFeatured: input.featured === "true", limit: input.limit }) };
  },
});

export const testimonialsGet = defineOperation({
  id: "testimonials_get",
  summary: "Read a testimonial",
  tag: "testimonials",
  method: "GET",
  path: "/testimonials/{id}",
  scope: "read:testimonials",
  input: z.object({ id: IdParam }),
  output: Row,
  handler({ input }) {
    const item = getTestimonial(input.id);
    if (!item) throw notFound("Testimonial not found.");
    return item;
  },
});

export const testimonialsCreate = defineOperation({
  id: "testimonials_create",
  summary: "Add a testimonial",
  tag: "testimonials",
  method: "POST",
  path: "/testimonials",
  scope: "write:testimonials",
  successStatus: 201,
  input: z.object({
    quote: z.string().trim().min(1, "Quote is required").max(4000),
    attribution: z.string().trim().min(1, "Attribution is required").max(200),
    featured: z.coerce.boolean().optional().default(false),
    display_order: z.coerce.number().int().optional().default(0),
  }),
  output: z.object({ ok: z.literal(true), id: z.number().int(), item: Row.nullable() }),
  handler({ input }) {
    const { id } = insertTestimonial(input);
    return { ok: true as const, id, item: getTestimonial(id) ?? null };
  },
});

export const testimonialsUpdate = defineOperation({
  id: "testimonials_update",
  summary: "Change a testimonial",
  tag: "testimonials",
  method: "PATCH",
  path: "/testimonials/{id}",
  scope: "write:testimonials",
  input: z.object({
    id: IdParam,
    quote: z.string().trim().min(1).max(4000).optional(),
    attribution: z.string().trim().min(1).max(200).optional(),
    featured: z.coerce.boolean().optional(),
    display_order: z.coerce.number().int().optional(),
  }),
  output: z.object({ ok: z.literal(true), item: Row.nullable() }),
  handler({ input }) {
    const { id, ...rest } = input;
    if (!getTestimonial(id)) throw notFound("Testimonial not found.");
    if (!updateTestimonial(id, rest)) throw badRequest("body: Nothing to update");
    return { ok: true as const, item: getTestimonial(id) ?? null };
  },
});

export const testimonialsDelete = defineOperation({
  id: "testimonials_delete",
  summary: "Delete a testimonial",
  tag: "testimonials",
  method: "DELETE",
  path: "/testimonials/{id}",
  scope: "write:testimonials",
  input: z.object({ id: IdParam }),
  output: z.object({ ok: z.literal(true) }),
  handler({ input }) {
    if (!deleteTestimonial(input.id)) throw notFound("Testimonial not found.");
    return { ok: true as const };
  },
});
