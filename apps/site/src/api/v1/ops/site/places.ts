/**
 * Venue search: a keyed proxy to Google Places (New), so the browser never
 * sees GOOGLE_PLACES_API_KEY. Public (scope null), limited per address by the
 * router. Moved from src/pages/api/places/*.
 *
 * Failure mapping (the error catalog has no 502): a missing key or an
 * upstream failure is `unavailable` (503). The old routes' open CORS headers
 * are dropped: the forms call these same-origin, and the booth has its own
 * proxy.
 */

import { z } from "zod";
import { defineOperation } from "@/api/registry/define";
import { unavailable } from "@/api/registry/errors";
import { parsePlace, type AutocompleteSuggestion, type RawPlace } from "@/lib/places";

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const DETAILS_BASE = "https://places.googleapis.com/v1/places/";

const AUTOCOMPLETE_MASK =
  "suggestions.placePrediction.placeId," +
  "suggestions.placePrediction.text," +
  "suggestions.placePrediction.structuredFormat";
const DETAILS_MASK = "id,displayName,formattedAddress,addressComponents,location";

// Place IDs are ASCII identifiers; anything else is someone injecting into the URL path.
const PLACE_ID_RE = /^[A-Za-z0-9_-]+$/;

interface RawSuggestionsResponse {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
    };
  }>;
}

export const placesAutocomplete = defineOperation({
  id: "places_autocomplete",
  summary: "Suggest venues for a search",
  description: "Proxies Google Places autocomplete. Needs the server's GOOGLE_PLACES_API_KEY.",
  tag: "places",
  method: "GET",
  path: "/places/autocomplete",
  scope: null,
  input: z.object({ q: z.string().trim().min(1, "missing required query parameter q") }),
  output: z.object({
    suggestions: z.array(
      z.object({ placeId: z.string(), mainText: z.string(), secondaryText: z.string() }),
    ),
  }),
  async handler({ input }) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) throw unavailable("venue search is not configured");

    let upstream: Response;
    try {
      upstream = await fetch(AUTOCOMPLETE_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": AUTOCOMPLETE_MASK,
        },
        body: JSON.stringify({ input: input.q, languageCode: "en", regionCode: "US" }),
      });
    } catch (err) {
      console.error("[places_autocomplete] fetch failed:", err);
      throw unavailable("venue search unavailable");
    }
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      console.error(`[places_autocomplete] Google returned ${upstream.status}: ${text.slice(0, 200)}`);
      throw unavailable("venue search unavailable");
    }
    let data: RawSuggestionsResponse;
    try {
      data = (await upstream.json()) as RawSuggestionsResponse;
    } catch (err) {
      console.error("[places_autocomplete] bad JSON from Google:", err);
      throw unavailable("venue search unavailable");
    }
    const suggestions: AutocompleteSuggestion[] = (data.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
      .map((p) => ({
        placeId: p.placeId!,
        mainText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
        secondaryText: p.structuredFormat?.secondaryText?.text ?? "",
      }));
    return { suggestions };
  },
});

export const placesDetails = defineOperation({
  id: "places_details",
  summary: "Look up a venue's address",
  description: "Proxies Google Places details for a place id and returns a flat address.",
  tag: "places",
  method: "GET",
  path: "/places/details",
  scope: null,
  input: z.object({
    id: z
      .string()
      .trim()
      .min(1, "missing required query parameter id")
      .regex(PLACE_ID_RE, "malformed place id"),
  }),
  output: z.object({
    name: z.string(),
    streetAddress: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    postalCode: z.string().nullable(),
    country: z.string().nullable(),
    latitude: z.number(),
    longitude: z.number(),
  }),
  async handler({ input }) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) throw unavailable("venue lookup is not configured");

    let upstream: Response;
    try {
      upstream = await fetch(`${DETAILS_BASE}${input.id}`, {
        method: "GET",
        headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": DETAILS_MASK },
      });
    } catch (err) {
      console.error("[places_details] fetch failed:", err);
      throw unavailable("venue lookup unavailable");
    }
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      console.error(`[places_details] Google returned ${upstream.status}: ${text.slice(0, 200)}`);
      throw unavailable("venue lookup unavailable");
    }
    let raw: RawPlace;
    try {
      raw = (await upstream.json()) as RawPlace;
    } catch (err) {
      console.error("[places_details] bad JSON from Google:", err);
      throw unavailable("venue lookup unavailable");
    }
    return parsePlace(raw);
  },
});
