import { z } from "zod";

/**
 * Smile NOLA Intake Lead schema.
 *
 * One source of truth used for:
 *   • react-hook-form client validation (via @hookform/resolvers/zod)
 *   • API route server validation
 *   • DB row shape
 *   • HoneyBook CSV column mapping
 *
 * Rule honored: only fields the user actually needs are required.
 */

export const COLLECTIONS = [
  { id: "aurora", label: "The Aurora Collection", tagline: "Lighting & video walls" },
  { id: "resonance", label: "The Resonance Series", tagline: "Concert-grade sound" },
  { id: "visionary", label: "The Visionary Suite", tagline: "Cinematic videography" },
  { id: "digital-atelier", label: "The Digital Atelier", tagline: "Web & event design" },
  { id: "smile", label: "The Smile Collection", tagline: "Photo booth experiences" },
] as const;

export type CollectionId = (typeof COLLECTIONS)[number]["id"];
export const COLLECTION_IDS = COLLECTIONS.map((c) => c.id) as [
  CollectionId,
  ...CollectionId[],
];

export const RELATIONSHIPS = [
  "One of the couple",
  "Planner",
  "Family",
  "Other",
] as const;

export const PREFERRED_CONTACTS = ["Email", "Phone", "Text"] as const;

export const SETTINGS = [
  "Indoor",
  "Outdoor — Covered",
  "Outdoor — Uncovered",
  "Not sure yet",
] as const;

const trimmedString = (max = 200) =>
  z.string().trim().max(max, `Must be ${max} characters or fewer`);

// Accepts string | null | undefined | "" and normalizes to `string | undefined`
// (undefined for any falsy input). The booth form's RHF will sometimes hand us
// `null` from the JSON wire format, and the API route forwards bodies verbatim,
// so we need to accept it explicitly here. Mirrors the same fix that landed on
// the marketing site's BuilderSubmissionSchema (commit b9b3798).
const optionalTrimmed = (max = 200) =>
  z
    .union([
      z.string().trim().max(max, `Must be ${max} characters or fewer`),
      z.null(),
    ])
    .optional()
    .transform((v) => (v ? v : undefined));

export const LeadSchema = z.object({
  // POC
  pocName: trimmedString(100).min(1, "Please share your name"),
  pocEmail: z
    .string()
    .trim()
    .min(1, "Please share an email")
    .email("That email looks off"),
  pocPhone: trimmedString(40).min(7, "Please share a phone number"),
  pocRelationship: z.enum(RELATIONSHIPS, {
    errorMap: () => ({ message: "Pick what fits you best" }),
  }),
  preferredContact: z.enum(PREFERRED_CONTACTS, {
    errorMap: () => ({ message: "Pick a preferred contact method" }),
  }),

  // Celebration
  partner1Name: trimmedString(100).min(1, "Please share Partner 1's name"),
  partner2Name: optionalTrimmed(100),
  eventDate: z
    .string()
    .trim()
    .min(1, "Pick a date")
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date"),
  venueName: optionalTrimmed(160),

  // Vision
  setting: z.enum(SETTINGS, {
    errorMap: () => ({ message: "Pick the setting" }),
  }),
  collectionsInterested: z
    .array(z.enum(COLLECTION_IDS))
    .min(1, "Pick at least one experience"),
  notes: optionalTrimmed(2000),
});

export type Lead = z.infer<typeof LeadSchema>;

/** Row as stored in SQLite (collections JSON-encoded). */
export interface LeadRow {
  id: number;
  captured_at: string;
  poc_name: string;
  poc_email: string;
  poc_phone: string;
  poc_relationship: string;
  preferred_contact: string;
  partner1_name: string;
  partner2_name: string | null;
  event_date: string;
  venue_name: string | null;
  setting: string;
  collections_interested: string; // JSON array
  notes: string | null;
  source: string;
  deleted_at: string | null;
}

/** Hydrated lead with parsed collections array. */
export interface HydratedLead {
  id: number;
  capturedAt: string;
  pocName: string;
  pocEmail: string;
  pocPhone: string;
  pocRelationship: string;
  preferredContact: string;
  partner1Name: string;
  partner2Name: string | null;
  eventDate: string;
  venueName: string | null;
  setting: string;
  collectionsInterested: CollectionId[];
  notes: string | null;
  source: string;
  deletedAt: string | null;
}

export function hydrate(row: LeadRow): HydratedLead {
  let collections: CollectionId[] = [];
  try {
    const parsed = JSON.parse(row.collections_interested);
    if (Array.isArray(parsed)) collections = parsed as CollectionId[];
  } catch {
    /* ignore */
  }
  return {
    id: row.id,
    capturedAt: row.captured_at,
    pocName: row.poc_name,
    pocEmail: row.poc_email,
    pocPhone: row.poc_phone,
    pocRelationship: row.poc_relationship,
    preferredContact: row.preferred_contact,
    partner1Name: row.partner1_name,
    partner2Name: row.partner2_name,
    eventDate: row.event_date,
    venueName: row.venue_name,
    setting: row.setting,
    collectionsInterested: collections,
    notes: row.notes,
    source: row.source,
    deletedAt: row.deleted_at,
  };
}

export const SOURCE_DEFAULT = "New Orleans Bridal and Wedding Expo";

export function collectionLabel(id: CollectionId): string {
  return COLLECTIONS.find((c) => c.id === id)?.label ?? id;
}
