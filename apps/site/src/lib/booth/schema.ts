import { z } from "zod";

/**
 * Booth lead schema.
 *
 * One source of truth for:
 *   - client validation in the /booth form (components/booth/form/useLeadForm)
 *   - POST /api/v1/booth/inquiries input validation
 *
 * Rule honored: only fields the visitor actually needs are required.
 */

export const COLLECTIONS = [
  { id: "aurora", label: "The Aurora Collection", tagline: "Lighting & video walls" },
  { id: "resonance", label: "The Resonance Series", tagline: "Concert-grade sound" },
  { id: "visionary", label: "The Visionary Suite", tagline: "Cinematic videography" },
  { id: "digital-atelier", label: "The Digital Atelier", tagline: "Web & event design" },
  { id: "smile", label: "The Smile Collection", tagline: "Photo booth experiences" },
] as const;

export type CollectionId = (typeof COLLECTIONS)[number]["id"];
export const COLLECTION_IDS = COLLECTIONS.map((c) => c.id) as [CollectionId, ...CollectionId[]];

export const RELATIONSHIPS = ["One of the couple", "Planner", "Family", "Other"] as const;

export const PREFERRED_CONTACTS = ["Email", "Phone", "Text"] as const;

export const SETTINGS = [
  "Indoor",
  "Outdoor — Covered",
  "Outdoor — Uncovered",
  "Not sure yet",
] as const;

/** The `source` every booth row carries in the inquiries table. */
export const BOOTH_SOURCE = "booth-expo";

const trimmedString = (max = 200) =>
  z.string().trim().max(max, `Must be ${max} characters or fewer`);

// Accepts string | null | undefined | "" and normalizes to `string | undefined`
// (undefined for any falsy input). JSON bodies may carry null for blanks.
const optionalTrimmed = (max = 200) =>
  z
    .union([z.string().trim().max(max, `Must be ${max} characters or fewer`), z.null()])
    .optional()
    .transform((v) => (v ? v : undefined));

export const LeadSchema = z.object({
  // POC
  pocName: trimmedString(100).min(1, "Please share your name"),
  pocEmail: z.string().trim().min(1, "Please share an email").email("That email looks off"),
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
  // Optional structured venue address, filled when the visitor picked the
  // venue from Google Places autocomplete.
  venueStreetAddress: optionalTrimmed(200),
  venueCity: optionalTrimmed(80),
  venueState: optionalTrimmed(40),
  venuePostalCode: optionalTrimmed(20),
  venueCountry: optionalTrimmed(2),
  venueLatitude: z
    .number()
    .min(-90)
    .max(90)
    .nullish()
    .transform((v) => v ?? undefined),
  venueLongitude: z
    .number()
    .min(-180)
    .max(180)
    .nullish()
    .transform((v) => v ?? undefined),

  // Vision
  setting: z.enum(SETTINGS, {
    errorMap: () => ({ message: "Pick the setting" }),
  }),
  collectionsInterested: z.array(z.enum(COLLECTION_IDS)).min(1, "Pick at least one experience"),
  notes: optionalTrimmed(2000),
});

export type Lead = z.infer<typeof LeadSchema>;

export const SOURCE_DEFAULT = "New Orleans Bridal and Wedding Expo";

export function collectionLabel(id: CollectionId): string {
  return COLLECTIONS.find((c) => c.id === id)?.label ?? id;
}
