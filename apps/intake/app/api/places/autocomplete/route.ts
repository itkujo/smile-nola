/**
 * GET /api/places/autocomplete?q=<text>
 *
 * Booth-local Google Places autocomplete proxy. Mirrors the marketing
 * site's `apps/site/src/pages/api/places/autocomplete.ts` so the
 * standalone booth has no dependency on smile-nola.com being reachable
 * for venue suggestions.
 *
 * Requires `GOOGLE_PLACES_API_KEY` in the booth's environment. If absent,
 * returns 503 and the form falls back to free-text entry — capture
 * continues uninterrupted.
 */

import { NextResponse } from "next/server";
import type { AutocompleteSuggestion } from "@/lib/places";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GOOGLE_URL = "https://places.googleapis.com/v1/places:autocomplete";

const FIELD_MASK =
  "suggestions.placePrediction.placeId," +
  "suggestions.placePrediction.text," +
  "suggestions.placePrediction.structuredFormat";

interface RawSuggestionsResponse {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
  }>;
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) {
    return NextResponse.json(
      { error: "missing required query parameter q" },
      { status: 400 },
    );
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "venue search is not configured" },
      { status: 503 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(GOOGLE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        input: q,
        languageCode: "en",
        regionCode: "US",
      }),
    });
  } catch (err) {
    console.error("[places/autocomplete] fetch failed:", err);
    return NextResponse.json(
      { error: "venue search unavailable" },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    console.error(
      `[places/autocomplete] Google returned ${upstream.status}: ${text.slice(
        0,
        200,
      )}`,
    );
    return NextResponse.json(
      { error: "venue search unavailable" },
      { status: 502 },
    );
  }

  let data: RawSuggestionsResponse;
  try {
    data = (await upstream.json()) as RawSuggestionsResponse;
  } catch (err) {
    console.error("[places/autocomplete] bad JSON from Google:", err);
    return NextResponse.json(
      { error: "venue search unavailable" },
      { status: 502 },
    );
  }

  const suggestions: AutocompleteSuggestion[] = (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
    .map((p) => ({
      placeId: p.placeId!,
      mainText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
      secondaryText: p.structuredFormat?.secondaryText?.text ?? "",
    }));

  return NextResponse.json({ suggestions });
}
