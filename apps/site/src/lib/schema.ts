/**
 * Zod schemas — server-side validation for inquiry submissions.
 *
 * Two schemas:
 *   • InquiryShortSchema — the lightweight form embedded on collection pages.
 *   • InquiryDeepSchema  — the full /contact form (built in Phase 8).
 *
 * Both feed into the same `inquiries` table via lib/db.ts.
 */

import { z } from "zod";
import { COLLECTION_IDS } from "@/content/collection-id";

const trim = (max = 200) => z.string().trim().max(max, `Must be ${max} characters or fewer`);
const optionalTrim = (max = 200) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : undefined));

/* ---- Lightweight form (collection-page embed) ----------------------------- */

export const InquiryShortSchema = z.object({
  first_name: trim(80).min(1, "Please share your first name"),
  last_name:  trim(80).min(1, "Please share your last name"),
  email: z
    .string()
    .trim()
    .min(1, "Please share an email")
    .email("That email looks off"),
  phone: trim(40).min(7, "Please share a phone number"),
  event_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : undefined)),
  message: optionalTrim(4000),

  // Hidden fields
  collection: z.enum(COLLECTION_IDS, {
    errorMap: () => ({ message: "Unknown collection" }),
  }),
  source: trim(80).default("contact"),
});

export type InquiryShortInput = z.infer<typeof InquiryShortSchema>;

/* ---- Deep form (built in Phase 8) ----------------------------------------- */

export const InquiryDeepSchema = z.object({
  first_name: trim(80).min(1, "Please share your first name"),
  last_name:  trim(80).min(1, "Please share your last name"),
  email: z.string().trim().min(1).email("That email looks off"),
  phone: trim(40).min(7),
  preferred_contact: z.enum(["Email", "Phone", "Text"]).optional(),
  event_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : undefined)),
  event_type: optionalTrim(80),
  venue: optionalTrim(160),
  guest_count: z.coerce.number().int().min(0).max(100000).optional(),
  event_start: optionalTrim(40),
  event_end: optionalTrim(40),
  planner: optionalTrim(120),
  budget_range: optionalTrim(80),
  message: optionalTrim(8000),
  referral: optionalTrim(160),
  /** Multi-select; "other" reveals a free-text field. */
  collections_interested: z
    .array(z.enum([...COLLECTION_IDS, "other"]))
    .optional()
    .default([]),
  /** Free-form additional services if "other" is selected. */
  other_services: optionalTrim(2000),
  /** Per-collection answer bundle: { aurora: { video_wall_size: "..." }, ... } */
  collection_fields: z.record(z.string(), z.unknown()).optional(),
  source: trim(80).default("contact"),
});

export type InquiryDeepInput = z.infer<typeof InquiryDeepSchema>;
