/**
 * GET /api/places/details?id=<placeId>
 *
 * Booth-local Google Places details proxy. Returns the parsed venue
 * shape that VenueAutocomplete writes into the form state. Vendored
 * from the marketing site for booth self-sufficiency.
 *
 * Requires `GOOGLE_PLACES_API_KEY`. If absent, returns 503 and the
 * caller falls back to using just the autocomplete `mainText` as the
 * venue name with no structured address.
 */

import { NextResponse } from "next/server";
import { parsePlace, type RawPlace } from "@/lib/places";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GOOGLE_BASE = "https://places.googleapis.com/v1/places/";

const FIELD_MASK = "id,displayName,formattedAddress,addressComponents,location";

// Place IDs are ASCII identifiers (letters, digits, underscore, hyphen).
// Anything else is suspicious and indicates someone is trying to inject
// junk into the URL path.
const PLACE_ID_RE = /^[A-Za-z0-9_\-]+$/;

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const id = (url.searchParams.get("id") ?? "").trim();
  if (!id) {
    return NextResponse.json(
      { error: "missing required query parameter id" },
      { status: 400 },
    );
  }
  if (!PLACE_ID_RE.test(id)) {
    return NextResponse.json({ error: "malformed place id" }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "venue lookup is not configured" },
      { status: 503 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${GOOGLE_BASE}${id}`, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
    });
  } catch (err) {
    console.error("[places/details] fetch failed:", err);
    return NextResponse.json(
      { error: "venue lookup unavailable" },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    console.error(
      `[places/details] Google returned ${upstream.status}: ${text.slice(0, 200)}`,
    );
    return NextResponse.json(
      { error: "venue lookup unavailable" },
      { status: 502 },
    );
  }

  let raw: RawPlace;
  try {
    raw = (await upstream.json()) as RawPlace;
  } catch (err) {
    console.error("[places/details] bad JSON from Google:", err);
    return NextResponse.json(
      { error: "venue lookup unavailable" },
      { status: 502 },
    );
  }

  return NextResponse.json(parsePlace(raw));
}
