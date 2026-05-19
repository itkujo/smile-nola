/**
 * Helpers for the Google Places API (New) integration.
 *
 * Pure parsers + types live here so the proxy route handlers in
 * `app/api/places/` can be tested without a network. Vendored verbatim
 * from `apps/site/src/lib/places.ts` (intentional duplication — the
 * standalone booth must not depend on the marketing site being reachable).
 */

export interface RawAddressComponent {
  longText: string;
  shortText: string;
  types: string[];
}

export interface RawPlace {
  id: string;
  displayName: { text: string; languageCode?: string };
  formattedAddress: string;
  addressComponents: RawAddressComponent[];
  location: { latitude: number; longitude: number };
}

export interface ParsedPlace {
  name: string;
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
}

/**
 * The trimmed-down autocomplete suggestion shape we return to the browser.
 * Google's raw response has lots more (matchedSubstrings, types[], etc.)
 * that the UI doesn't need.
 */
export interface AutocompleteSuggestion {
  placeId: string;
  mainText: string;
  secondaryText: string;
}

function findByType(
  components: RawAddressComponent[],
  ...types: string[]
): RawAddressComponent | undefined {
  for (const t of types) {
    const hit = components.find((c) => c.types.includes(t));
    if (hit) return hit;
  }
  return undefined;
}

export function parsePlace(place: RawPlace): ParsedPlace {
  const c = place.addressComponents;

  const streetNumber = findByType(c, "street_number");
  const route = findByType(c, "route");
  const streetAddress =
    streetNumber && route
      ? `${streetNumber.shortText} ${route.shortText}`
      : route
        ? route.shortText
        : null;

  const cityHit = findByType(c, "locality", "sublocality_level_1", "postal_town");
  const stateHit = findByType(c, "administrative_area_level_1");
  const postalHit = findByType(c, "postal_code");
  const countryHit = findByType(c, "country");

  return {
    name: place.displayName.text,
    streetAddress,
    city: cityHit?.longText ?? null,
    state: stateHit?.shortText ?? null, // 'LA' not 'Louisiana'
    postalCode: postalHit?.shortText ?? null,
    country: countryHit?.shortText ?? null, // 'US' not 'United States'
    latitude: place.location.latitude,
    longitude: place.location.longitude,
  };
}
