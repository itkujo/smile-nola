/**
 * Single canonical list of the five collection slugs.
 *
 * MUST stay aligned with apps/intake/lib/schema.ts so inquiry data is
 * portable across the booth intake and the marketing site.
 */

export const COLLECTION_IDS = [
  "aurora",
  "resonance",
  "visionary",
  "digital-atelier",
  "smile",
] as const;

export type CollectionId = (typeof COLLECTION_IDS)[number];

export function isCollectionId(value: unknown): value is CollectionId {
  return typeof value === "string" && (COLLECTION_IDS as readonly string[]).includes(value);
}
