# Venue Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace free-text venue inputs on the site /contact form, /build builder, and booth iPad with Google Places autocomplete (business + address search), storing structured address fields and passing them through to VSCO Workspace.

**Architecture:** Browser → server-side proxy at `/api/places/{autocomplete,details}` → Google Places API (New). The proxy keeps the API key off the client and returns trimmed JSON. Forms get a reusable `VenueAutocomplete` component (Astro + React variants). New DB columns capture address fields; existing free-text behavior is preserved as fallback. VSCO mapping populates `Location.mailingAddress` on the venue contact.

**Tech Stack:** Astro 5 SSR (site), Next.js (booth intake), SQLite via `better-sqlite3`, Vitest, Tailwind. Google Places API (New) at `places.googleapis.com/v1/...`.

---

## File Structure

**New files (site):**
- `apps/site/src/lib/places.ts` — pure helpers (parse Google `addressComponents`, types)
- `apps/site/src/lib/places.test.ts` — unit tests for parsers
- `apps/site/src/pages/api/places/autocomplete.ts` — proxy endpoint (POST to Google)
- `apps/site/src/pages/api/places/details.ts` — proxy endpoint (GET to Google)
- `apps/site/src/pages/api/places/__tests__/autocomplete.test.ts`
- `apps/site/src/pages/api/places/__tests__/details.test.ts`
- `apps/site/src/components/forms/VenueAutocomplete.astro` — vanilla JS component
- `apps/site/src/components/forms/VenueAutocompleteReact.tsx` — React variant for the builder

**New files (booth):**
- `apps/intake/components/form/VenueAutocomplete.tsx` — React component, calls site proxy cross-origin

**Modified files:**
- `apps/site/src/components/forms/InquiryFormDeep.astro` — swap venue `<input>` for `<VenueAutocomplete>`
- `apps/site/src/components/builder/EventDetails.tsx` — swap venue input for React component
- `apps/intake/components/form/steps/StepCelebration.tsx` — swap TextField for VenueAutocomplete
- `apps/site/src/lib/db.ts` — schema migration + extended `insertInquiry()` signature + `InquiryRow` shape
- `apps/site/src/lib/schema.ts` — extend `InquiryShortSchema`, `InquiryDeepSchema`, `BuilderSubmissionSchema`
- `apps/intake/lib/schema.ts` — extend `LeadSchema`
- `apps/site/src/pages/api/inquiry.ts` — pass new fields
- `apps/site/src/pages/api/contact.ts` — pass new fields
- `apps/site/src/pages/api/package-builder.ts` — pass new fields
- `apps/site/src/pages/api/sync/inquiries.ts` — accept new fields from booth payload
- `apps/intake/lib/sync.ts` — include new columns in payload
- `apps/site/src/lib/builder/submissions.ts` — accept + persist new fields
- `apps/site/src/lib/vsco/mappings.ts` — pass `mailingAddress` to Location contact
- `apps/site/src/lib/vsco/__tests__/mappings.test.ts` — assert mailingAddress passthrough
- `apps/site/src/pages/admin/inquiries/[id].astro` — render structured address + "View on map"

---

## Task 1: Address-component parser (pure)

**Files:**
- Create: `apps/site/src/lib/places.ts`
- Test: `apps/site/src/lib/places.test.ts`

Google's Places API (New) `Place.addressComponents` is an array like:
```json
[
  { "longText": "1111", "shortText": "1111", "types": ["street_number"] },
  { "longText": "Canal Street", "shortText": "Canal St", "types": ["route"] },
  { "longText": "New Orleans", "shortText": "New Orleans", "types": ["locality", "political"] },
  { "longText": "Orleans Parish", "shortText": "Orleans Parish", "types": ["administrative_area_level_2", "political"] },
  { "longText": "Louisiana", "shortText": "LA", "types": ["administrative_area_level_1", "political"] },
  { "longText": "United States", "shortText": "US", "types": ["country", "political"] },
  { "longText": "70112", "shortText": "70112", "types": ["postal_code"] }
]
```

We need a pure function that converts that → `{ streetAddress, city, state, postalCode, country }`. Plus take `displayName.text` (the business name) and `location.{latitude,longitude}` as separate values from the parent Place.

- [ ] **Step 1.1: Write the failing test for parser**

Create `apps/site/src/lib/places.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parsePlace, type RawPlace } from './places.ts'

const SAENGER: RawPlace = {
  id: 'ChIJR-XiLAqmIIYRIN-3cgL5chU',
  displayName: { text: 'Saenger Theatre', languageCode: 'en' },
  formattedAddress: '1111 Canal St, New Orleans, LA 70112, USA',
  addressComponents: [
    { longText: '1111', shortText: '1111', types: ['street_number'] },
    { longText: 'Canal Street', shortText: 'Canal St', types: ['route'] },
    { longText: 'New Orleans', shortText: 'New Orleans', types: ['locality', 'political'] },
    { longText: 'Louisiana', shortText: 'LA', types: ['administrative_area_level_1', 'political'] },
    { longText: 'United States', shortText: 'US', types: ['country', 'political'] },
    { longText: '70112', shortText: '70112', types: ['postal_code'] },
  ],
  location: { latitude: 29.9572, longitude: -90.0773 },
}

describe('parsePlace', () => {
  it('extracts the business name and full address from a complete place', () => {
    const result = parsePlace(SAENGER)
    expect(result).toEqual({
      name: 'Saenger Theatre',
      streetAddress: '1111 Canal St',
      city: 'New Orleans',
      state: 'LA',
      postalCode: '70112',
      country: 'US',
      latitude: 29.9572,
      longitude: -90.0773,
    })
  })

  it('falls back to sublocality when locality is absent (e.g. some boroughs)', () => {
    const place: RawPlace = {
      id: 'p1',
      displayName: { text: 'Test Spot', languageCode: 'en' },
      formattedAddress: 'unused',
      addressComponents: [
        { longText: 'Brooklyn', shortText: 'Brooklyn', types: ['sublocality_level_1', 'political'] },
        { longText: 'New York', shortText: 'NY', types: ['administrative_area_level_1'] },
      ],
      location: { latitude: 40.7, longitude: -73.9 },
    }
    expect(parsePlace(place).city).toBe('Brooklyn')
  })

  it('joins street_number + route into streetAddress', () => {
    const place: RawPlace = {
      id: 'p2',
      displayName: { text: 'X', languageCode: 'en' },
      formattedAddress: 'unused',
      addressComponents: [
        { longText: '42', shortText: '42', types: ['street_number'] },
        { longText: 'Bourbon Street', shortText: 'Bourbon St', types: ['route'] },
      ],
      location: { latitude: 0, longitude: 0 },
    }
    expect(parsePlace(place).streetAddress).toBe('42 Bourbon St')
  })

  it('returns route only when street_number is absent', () => {
    const place: RawPlace = {
      id: 'p3',
      displayName: { text: 'X', languageCode: 'en' },
      formattedAddress: 'unused',
      addressComponents: [
        { longText: 'Esplanade Avenue', shortText: 'Esplanade Ave', types: ['route'] },
      ],
      location: { latitude: 0, longitude: 0 },
    }
    expect(parsePlace(place).streetAddress).toBe('Esplanade Ave')
  })

  it('returns null for missing components rather than empty strings', () => {
    const minimal: RawPlace = {
      id: 'p4',
      displayName: { text: 'Mystery Spot', languageCode: 'en' },
      formattedAddress: 'unused',
      addressComponents: [],
      location: { latitude: 1, longitude: 2 },
    }
    const result = parsePlace(minimal)
    expect(result.name).toBe('Mystery Spot')
    expect(result.streetAddress).toBeNull()
    expect(result.city).toBeNull()
    expect(result.state).toBeNull()
    expect(result.postalCode).toBeNull()
    expect(result.country).toBeNull()
    expect(result.latitude).toBe(1)
    expect(result.longitude).toBe(2)
  })
})
```

- [ ] **Step 1.2: Run test, expect failure**

```
cd apps/site && pnpm vitest run src/lib/places.test.ts
```
Expected: `Cannot find module './places.ts'`

- [ ] **Step 1.3: Implement `places.ts`**

Create `apps/site/src/lib/places.ts`:
```ts
/**
 * Helpers for the Google Places API (New) integration.
 *
 * The proxy endpoints in src/pages/api/places/ call Google directly;
 * this file holds pure parsers + types so they can be unit-tested
 * without a network.
 */

export interface RawAddressComponent {
  longText: string
  shortText: string
  types: string[]
}

export interface RawPlace {
  id: string
  displayName: { text: string; languageCode?: string }
  formattedAddress: string
  addressComponents: RawAddressComponent[]
  location: { latitude: number; longitude: number }
}

export interface ParsedPlace {
  name: string
  streetAddress: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
  latitude: number
  longitude: number
}

function findByType(
  components: RawAddressComponent[],
  ...types: string[]
): RawAddressComponent | undefined {
  for (const t of types) {
    const hit = components.find((c) => c.types.includes(t))
    if (hit) return hit
  }
  return undefined
}

export function parsePlace(place: RawPlace): ParsedPlace {
  const c = place.addressComponents

  const streetNumber = findByType(c, 'street_number')
  const route = findByType(c, 'route')
  const streetAddress = streetNumber && route
    ? `${streetNumber.shortText} ${route.shortText}`
    : route
      ? route.shortText
      : null

  const cityHit = findByType(c, 'locality', 'sublocality_level_1', 'postal_town')
  const stateHit = findByType(c, 'administrative_area_level_1')
  const postalHit = findByType(c, 'postal_code')
  const countryHit = findByType(c, 'country')

  return {
    name: place.displayName.text,
    streetAddress,
    city: cityHit?.longText ?? null,
    state: stateHit?.shortText ?? null, // 'LA' not 'Louisiana'
    postalCode: postalHit?.shortText ?? null,
    country: countryHit?.shortText ?? null, // 'US' not 'United States'
    latitude: place.location.latitude,
    longitude: place.location.longitude,
  }
}

/**
 * The trimmed-down autocomplete suggestion shape we return to the browser.
 * Google's raw response has lots more (matchedSubstrings, types[], etc.)
 * that the UI doesn't need.
 */
export interface AutocompleteSuggestion {
  placeId: string
  mainText: string
  secondaryText: string
}
```

- [ ] **Step 1.4: Run test, expect pass**

```
pnpm vitest run src/lib/places.test.ts
```
Expected: 5 passing.

- [ ] **Step 1.5: Commit**

```
cd /home/phoenix/code/smile-nola
git add apps/site/src/lib/places.ts apps/site/src/lib/places.test.ts
git commit -m "feat(places): pure parser for Google Places (New) addressComponents

Splits Google's nested addressComponents array into named address fields
(streetAddress, city, state, postalCode, country) plus pulls the business
name and lat/lng into one flat shape ParsedPlace. Returns null for
missing components so downstream code can distinguish 'not in response'
from 'present and empty'.

Used by the upcoming proxy endpoints and frontend component."
```

---

## Task 2: Autocomplete proxy endpoint

**Files:**
- Create: `apps/site/src/pages/api/places/autocomplete.ts`
- Test: `apps/site/src/pages/api/places/__tests__/autocomplete.test.ts`

- [ ] **Step 2.1: Write failing test**

Create `apps/site/src/pages/api/places/__tests__/autocomplete.test.ts`:
```ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { GET } from '../autocomplete.ts'

const ORIG_FETCH = globalThis.fetch
const ORIG_KEY = process.env.GOOGLE_PLACES_API_KEY

function makeReq(qs: string): Request {
  return new Request(`http://localhost/api/places/autocomplete?${qs}`)
}

describe('GET /api/places/autocomplete', () => {
  beforeEach(() => {
    process.env.GOOGLE_PLACES_API_KEY = 'TEST_KEY'
  })
  afterEach(() => {
    globalThis.fetch = ORIG_FETCH
    process.env.GOOGLE_PLACES_API_KEY = ORIG_KEY
  })

  it('returns 400 when q is missing', async () => {
    const res = await GET({ request: makeReq('') } as any)
    expect(res.status).toBe(400)
  })

  it('returns 400 when q is empty or whitespace', async () => {
    const res = await GET({ request: makeReq('q=%20%20') } as any)
    expect(res.status).toBe(400)
  })

  it('returns 503 when GOOGLE_PLACES_API_KEY is not set', async () => {
    delete process.env.GOOGLE_PLACES_API_KEY
    const res = await GET({ request: makeReq('q=Saenger') } as any)
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toMatch(/not configured/i)
  })

  it('forwards to Google with correct headers and body, returns trimmed shape', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST')
      const headers = new Headers(init?.headers)
      expect(headers.get('X-Goog-Api-Key')).toBe('TEST_KEY')
      expect(headers.get('X-Goog-FieldMask')).toContain('suggestions.placePrediction')
      const body = JSON.parse(init?.body as string)
      expect(body.input).toBe('Saenger')
      return new Response(
        JSON.stringify({
          suggestions: [
            {
              placePrediction: {
                placeId: 'PLACE_1',
                text: { text: 'Saenger Theatre, Canal Street, New Orleans, LA, USA' },
                structuredFormat: {
                  mainText: { text: 'Saenger Theatre' },
                  secondaryText: { text: 'Canal Street, New Orleans, LA, USA' },
                },
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    globalThis.fetch = fetchMock as any

    const res = await GET({ request: makeReq('q=Saenger') } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.suggestions).toEqual([
      {
        placeId: 'PLACE_1',
        mainText: 'Saenger Theatre',
        secondaryText: 'Canal Street, New Orleans, LA, USA',
      },
    ])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('returns 502 when Google returns non-2xx', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'denied' } }), { status: 403 }),
    ) as any
    const res = await GET({ request: makeReq('q=Foo') } as any)
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toMatch(/search unavailable/i)
  })

  it('returns 502 on fetch network error', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNRESET') }) as any
    const res = await GET({ request: makeReq('q=Foo') } as any)
    expect(res.status).toBe(502)
  })

  it('returns empty suggestions array when Google returns 200 with no suggestions', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    ) as any
    const res = await GET({ request: makeReq('q=zzzzz') } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.suggestions).toEqual([])
  })
})
```

- [ ] **Step 2.2: Run test, expect failure**

```
cd apps/site && pnpm vitest run src/pages/api/places/__tests__/autocomplete.test.ts
```
Expected: cannot find module.

- [ ] **Step 2.3: Implement the proxy**

Create `apps/site/src/pages/api/places/autocomplete.ts`:
```ts
import type { APIRoute } from 'astro'
import type { AutocompleteSuggestion } from '@/lib/places'

export const prerender = false

const GOOGLE_URL = 'https://places.googleapis.com/v1/places:autocomplete'

const FIELD_MASK =
  'suggestions.placePrediction.placeId,' +
  'suggestions.placePrediction.text,' +
  'suggestions.placePrediction.structuredFormat'

interface RawSuggestionsResponse {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string
      text?: { text?: string }
      structuredFormat?: {
        mainText?: { text?: string }
        secondaryText?: { text?: string }
      }
    }
  }>
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  if (!q) {
    return jsonResponse(400, { error: 'missing required query parameter q' })
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    return jsonResponse(503, { error: 'venue search is not configured' })
  }

  let upstream: Response
  try {
    upstream = await fetch(GOOGLE_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({
        input: q,
        languageCode: 'en',
        regionCode: 'US',
      }),
    })
  } catch (err) {
    console.error('[places/autocomplete] fetch failed:', err)
    return jsonResponse(502, { error: 'venue search unavailable' })
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '')
    console.error(
      `[places/autocomplete] Google returned ${upstream.status}: ${text.slice(0, 200)}`,
    )
    return jsonResponse(502, { error: 'venue search unavailable' })
  }

  let data: RawSuggestionsResponse
  try {
    data = (await upstream.json()) as RawSuggestionsResponse
  } catch (err) {
    console.error('[places/autocomplete] bad JSON from Google:', err)
    return jsonResponse(502, { error: 'venue search unavailable' })
  }

  const suggestions: AutocompleteSuggestion[] = (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
    .map((p) => ({
      placeId: p.placeId!,
      mainText:
        p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
      secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
    }))

  return jsonResponse(200, { suggestions })
}
```

- [ ] **Step 2.4: Run test, expect pass**

```
pnpm vitest run src/pages/api/places/__tests__/autocomplete.test.ts
```
Expected: 7 passing.

- [ ] **Step 2.5: Commit**

```
cd /home/phoenix/code/smile-nola
git add apps/site/src/pages/api/places/autocomplete.ts apps/site/src/pages/api/places/__tests__/autocomplete.test.ts
git commit -m "feat(places): server proxy for Google Places autocomplete

GET /api/places/autocomplete?q=... — POSTs to Places API (New),
returns a trimmed array of suggestions {placeId, mainText, secondaryText}.
Keeps the Google API key server-side via GOOGLE_PLACES_API_KEY env var.

Returns 400 on missing q, 503 when the key isn't configured (so we
degrade gracefully in dev), 502 when Google itself is unhealthy.
The frontend treats 502/503 by falling back to plain-text venue entry."
```

---

## Task 3: Place-details proxy endpoint

**Files:**
- Create: `apps/site/src/pages/api/places/details.ts`
- Test: `apps/site/src/pages/api/places/__tests__/details.test.ts`

- [ ] **Step 3.1: Write failing test**

Create `apps/site/src/pages/api/places/__tests__/details.test.ts`:
```ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { GET } from '../details.ts'

const ORIG_FETCH = globalThis.fetch
const ORIG_KEY = process.env.GOOGLE_PLACES_API_KEY

function makeReq(qs: string): Request {
  return new Request(`http://localhost/api/places/details?${qs}`)
}

describe('GET /api/places/details', () => {
  beforeEach(() => {
    process.env.GOOGLE_PLACES_API_KEY = 'TEST_KEY'
  })
  afterEach(() => {
    globalThis.fetch = ORIG_FETCH
    process.env.GOOGLE_PLACES_API_KEY = ORIG_KEY
  })

  it('returns 400 when id is missing', async () => {
    const res = await GET({ request: makeReq('') } as any)
    expect(res.status).toBe(400)
  })

  it('returns 400 when id is malformed (contains spaces)', async () => {
    const res = await GET({ request: makeReq('id=bad%20id') } as any)
    expect(res.status).toBe(400)
  })

  it('returns 503 when key is missing', async () => {
    delete process.env.GOOGLE_PLACES_API_KEY
    const res = await GET({ request: makeReq('id=ChIJ_test') } as any)
    expect(res.status).toBe(503)
  })

  it('forwards to Google, parses addressComponents, returns flat shape', async () => {
    globalThis.fetch = vi.fn(async (url: any, init?: RequestInit) => {
      expect(String(url)).toContain('/places/ChIJ_test')
      const headers = new Headers(init?.headers)
      expect(headers.get('X-Goog-Api-Key')).toBe('TEST_KEY')
      expect(headers.get('X-Goog-FieldMask')).toContain('addressComponents')
      return new Response(
        JSON.stringify({
          id: 'ChIJ_test',
          displayName: { text: 'Saenger Theatre', languageCode: 'en' },
          formattedAddress: '1111 Canal St, New Orleans, LA 70112, USA',
          addressComponents: [
            { longText: '1111', shortText: '1111', types: ['street_number'] },
            { longText: 'Canal Street', shortText: 'Canal St', types: ['route'] },
            { longText: 'New Orleans', shortText: 'New Orleans', types: ['locality'] },
            { longText: 'Louisiana', shortText: 'LA', types: ['administrative_area_level_1'] },
            { longText: 'United States', shortText: 'US', types: ['country'] },
            { longText: '70112', shortText: '70112', types: ['postal_code'] },
          ],
          location: { latitude: 29.9572, longitude: -90.0773 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as any
    const res = await GET({ request: makeReq('id=ChIJ_test') } as any)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      name: 'Saenger Theatre',
      streetAddress: '1111 Canal St',
      city: 'New Orleans',
      state: 'LA',
      postalCode: '70112',
      country: 'US',
      latitude: 29.9572,
      longitude: -90.0773,
    })
  })

  it('returns 502 on non-2xx from Google', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('{"error": {"status": "NOT_FOUND"}}', { status: 404 }),
    ) as any
    const res = await GET({ request: makeReq('id=ChIJ_unknown') } as any)
    expect(res.status).toBe(502)
  })
})
```

- [ ] **Step 3.2: Run test, expect failure**

```
pnpm vitest run src/pages/api/places/__tests__/details.test.ts
```
Expected: cannot find module.

- [ ] **Step 3.3: Implement details proxy**

Create `apps/site/src/pages/api/places/details.ts`:
```ts
import type { APIRoute } from 'astro'
import { parsePlace, type RawPlace } from '@/lib/places'

export const prerender = false

const GOOGLE_BASE = 'https://places.googleapis.com/v1/places/'

const FIELD_MASK = 'id,displayName,formattedAddress,addressComponents,location'

// Place IDs are ASCII identifiers (letters, digits, underscore, hyphen).
// Anything else is suspicious and indicates someone is trying to inject
// junk into the URL path.
const PLACE_ID_RE = /^[A-Za-z0-9_\-]+$/

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url)
  const id = (url.searchParams.get('id') ?? '').trim()
  if (!id) {
    return jsonResponse(400, { error: 'missing required query parameter id' })
  }
  if (!PLACE_ID_RE.test(id)) {
    return jsonResponse(400, { error: 'malformed place id' })
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    return jsonResponse(503, { error: 'venue lookup is not configured' })
  }

  let upstream: Response
  try {
    upstream = await fetch(`${GOOGLE_BASE}${id}`, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
    })
  } catch (err) {
    console.error('[places/details] fetch failed:', err)
    return jsonResponse(502, { error: 'venue lookup unavailable' })
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '')
    console.error(
      `[places/details] Google returned ${upstream.status}: ${text.slice(0, 200)}`,
    )
    return jsonResponse(502, { error: 'venue lookup unavailable' })
  }

  let raw: RawPlace
  try {
    raw = (await upstream.json()) as RawPlace
  } catch (err) {
    console.error('[places/details] bad JSON from Google:', err)
    return jsonResponse(502, { error: 'venue lookup unavailable' })
  }

  return jsonResponse(200, parsePlace(raw))
}
```

- [ ] **Step 3.4: Run test, expect pass**

```
pnpm vitest run src/pages/api/places/__tests__/details.test.ts
```
Expected: 5 passing.

- [ ] **Step 3.5: Commit**

```
cd /home/phoenix/code/smile-nola
git add apps/site/src/pages/api/places/details.ts apps/site/src/pages/api/places/__tests__/details.test.ts
git commit -m "feat(places): server proxy for Google Places details lookup

GET /api/places/details?id=<placeId> — GETs from Places API (New),
parses addressComponents into ParsedPlace shape via parsePlace().

Returns 400 on missing/malformed id (place IDs are ASCII identifiers
only, anti-injection check), 503 when key not configured, 502 when
Google fails. Same graceful-degradation pattern as autocomplete."
```

---

## Task 4: SQLite migration — venue address columns

**Files:**
- Modify: `apps/site/src/lib/db.ts`
- Test: extend existing `apps/site/src/lib/__tests__/db.test.ts` if present (or skip if pattern is integration-style)

- [ ] **Step 4.1: Find existing migration helpers in db.ts**

Run `grep -n "ALTER TABLE\|migrateInquiriesAddBoothAndSyncColumns\|columnExists" apps/site/src/lib/db.ts | head -20` to find the migration pattern. The codebase uses runtime `ALTER TABLE` calls guarded by `columnExists()` checks during bootstrap.

- [ ] **Step 4.2: Add the migration function**

In `apps/site/src/lib/db.ts`, locate `bootstrapSchema()` and add a new migration helper called from inside it. Add at the end of the migrations:

```ts
function migrateInquiriesAddVenueAddressColumns(db: Database): void {
  for (const col of [
    'venue_street_address',
    'venue_city',
    'venue_state',
    'venue_postal_code',
    'venue_country',
  ]) {
    if (!columnExists(db, 'inquiries', col)) {
      db.exec(`ALTER TABLE inquiries ADD COLUMN ${col} TEXT`)
    }
  }
  for (const col of ['venue_latitude', 'venue_longitude']) {
    if (!columnExists(db, 'inquiries', col)) {
      db.exec(`ALTER TABLE inquiries ADD COLUMN ${col} REAL`)
    }
  }
}

function migrateBuilderSubmissionsAddVenueAddressColumns(db: Database): void {
  for (const col of [
    'venue_street_address',
    'venue_city',
    'venue_state',
    'venue_postal_code',
    'venue_country',
  ]) {
    if (!columnExists(db, 'package_builder_submissions', col)) {
      db.exec(`ALTER TABLE package_builder_submissions ADD COLUMN ${col} TEXT`)
    }
  }
  for (const col of ['venue_latitude', 'venue_longitude']) {
    if (!columnExists(db, 'package_builder_submissions', col)) {
      db.exec(`ALTER TABLE package_builder_submissions ADD COLUMN ${col} REAL`)
    }
  }
}
```

Call both functions inside `bootstrapSchema()` after the existing migration calls.

- [ ] **Step 4.3: Extend `InquiryRow` and `InquiryInput` shapes**

Find the `InquiryRow` interface (around line 60-130 area in db.ts) and add:
```ts
venue_street_address: string | null
venue_city: string | null
venue_state: string | null
venue_postal_code: string | null
venue_country: string | null
venue_latitude: number | null
venue_longitude: number | null
```

Find the `InquiryInput` type and add the same fields as `string | null` (or `number | null` for lat/lng), marked optional.

Find the SQL in `insertInquiry()` (around line 695-800) and:
- Add the 7 new columns to the INSERT column list.
- Add 7 new `?` placeholders.
- Add the 7 values to the bind array, defaulting each to `null`.

Find the SELECT statements that build `InquiryRow` (e.g. `getInquiry`, `listInquiries`) and add the 7 new columns to each SELECT.

- [ ] **Step 4.4: Run typecheck**

```
cd apps/site && pnpm typecheck
```
Expected: 0 errors. If TypeScript flags rows missing the new fields, those call sites need updates — fix them inline (typically just spreading from `row.*` to keep all columns).

- [ ] **Step 4.5: Run tests**

```
pnpm test
```
Expected: 201 still passing (the migration is additive; nothing existing should change behavior).

- [ ] **Step 4.6: Commit**

```
cd /home/phoenix/code/smile-nola
git add apps/site/src/lib/db.ts
git commit -m "feat(db): add venue address columns to inquiries + builder submissions

7 new nullable columns each: venue_street_address, venue_city,
venue_state, venue_postal_code, venue_country (TEXT) and
venue_latitude, venue_longitude (REAL). Migrations are idempotent —
re-running bootstrapSchema() on an already-migrated DB is a no-op.

Existing venue TEXT column is preserved as the human-readable name;
the new columns are populated only when the venue was picked from
Google Places autocomplete. Free-text venue submissions leave the
new columns NULL — fully backwards compatible.

InquiryRow and the SELECT statements are extended to surface the
new columns to downstream consumers."
```

---

## Task 5: Schema validation extends

**Files:**
- Modify: `apps/site/src/lib/schema.ts`
- Modify: `apps/intake/lib/schema.ts`

- [ ] **Step 5.1: Define a reusable venue address sub-schema in site/schema.ts**

In `apps/site/src/lib/schema.ts`, before `InquiryShortSchema`:
```ts
/**
 * Venue address sub-fields. Populated only when the user picked the
 * venue from Google Places autocomplete; absent or empty for free-text
 * submissions. All fields are optional so old clients submitting just
 * `venue` still validate.
 */
const venueAddressFields = {
  venue_street_address: z.string().max(200).trim().optional().nullable(),
  venue_city: z.string().max(80).trim().optional().nullable(),
  venue_state: z.string().max(40).trim().optional().nullable(),
  venue_postal_code: z.string().max(20).trim().optional().nullable(),
  venue_country: z.string().max(2).trim().optional().nullable(),
  venue_latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  venue_longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
}
```

- [ ] **Step 5.2: Extend the schemas**

Add `...venueAddressFields` to:
- `InquiryShortSchema` (around line 26)
- `InquiryDeepSchema` (around line 57)
- `BuilderSubmissionSchema` (around line 160 — but its venue lives under `event.venue`; instead, add `event.venue_*` fields as a sibling or restructure to `event.venue: { name, streetAddress, ... }`)

For BuilderSubmissionSchema specifically — check the existing nested shape. If `event.venue: string`, change to nested object:
```ts
event: z.object({
  date: z.string().nullable(),
  type: z.string().nullable(),
  venue: z.string().nullable(),
  venue_street_address: z.string().max(200).trim().optional().nullable(),
  venue_city: z.string().max(80).trim().optional().nullable(),
  venue_state: z.string().max(40).trim().optional().nullable(),
  venue_postal_code: z.string().max(20).trim().optional().nullable(),
  venue_country: z.string().max(2).trim().optional().nullable(),
  venue_latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  venue_longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  guestCount: z.number().int().nullable(),
  note: z.string().nullable(),
}),
```

- [ ] **Step 5.3: Extend booth schema**

In `apps/intake/lib/schema.ts`, the booth uses `venueName` (camelCase). Add address fields next to it:
```ts
venueName: optionalTrimmed(160),
venueStreetAddress: optionalTrimmed(200),
venueCity: optionalTrimmed(80),
venueState: optionalTrimmed(40),
venuePostalCode: optionalTrimmed(20),
venueCountry: z.string().length(2).optional().nullable(),
venueLatitude: z.coerce.number().min(-90).max(90).optional().nullable(),
venueLongitude: z.coerce.number().min(-180).max(180).optional().nullable(),
```

Also update the `Lead` TypeScript interface in the same file (around line 132) to include these.

- [ ] **Step 5.4: Typecheck**

```
cd apps/site && pnpm typecheck && cd ../intake && pnpm typecheck
```
Expected: 0 errors. If the booth typecheck fails on rows passing to insertLead, follow the chain into `lib/db.ts` (booth) and add columns there too (mirroring the site).

- [ ] **Step 5.5: Run tests both apps**

```
cd /home/phoenix/code/smile-nola/apps/site && pnpm test
```
Expected: all green.

- [ ] **Step 5.6: Commit**

```
cd /home/phoenix/code/smile-nola
git add apps/site/src/lib/schema.ts apps/intake/lib/schema.ts apps/intake/lib/db.ts
git commit -m "feat(schema): venue address fields on inquiry + builder + lead schemas

InquiryShortSchema, InquiryDeepSchema, BuilderSubmissionSchema, and
booth LeadSchema all accept the 7 new venue address fields. All are
optional + nullable — free-text submissions still validate.

BuilderSubmissionSchema.event grows venue_* sibling fields beside the
existing event.venue string."
```

---

## Task 6: API routes pass venue fields through

**Files:**
- Modify: `apps/site/src/pages/api/inquiry.ts`
- Modify: `apps/site/src/pages/api/contact.ts`
- Modify: `apps/site/src/pages/api/package-builder.ts`
- Modify: `apps/site/src/pages/api/sync/inquiries.ts`
- Modify: `apps/intake/lib/sync.ts`
- Modify: `apps/site/src/lib/builder/submissions.ts`

- [ ] **Step 6.1: Update inquiry/contact API routes**

In `apps/site/src/pages/api/inquiry.ts` find the `insertInquiry()` call (around line 100-110). Just before the call, copy venue address fields from `parsed` to the input object:
```ts
const inq = insertInquiry({
  // ... existing fields ...
  venue_street_address: parsed.venue_street_address ?? null,
  venue_city: parsed.venue_city ?? null,
  venue_state: parsed.venue_state ?? null,
  venue_postal_code: parsed.venue_postal_code ?? null,
  venue_country: parsed.venue_country ?? null,
  venue_latitude: parsed.venue_latitude ?? null,
  venue_longitude: parsed.venue_longitude ?? null,
})
```

Do the same in `apps/site/src/pages/api/contact.ts`.

- [ ] **Step 6.2: Update package-builder API route**

In `apps/site/src/pages/api/package-builder.ts`, find where it persists the submission. Pass `parsed.event.venue_*` fields through to `insertBuilderSubmission()`. The submission helper expects flat columns — update `apps/site/src/lib/builder/submissions.ts` `insertBuilderSubmission()` signature + SQL INSERT to accept and persist the 7 fields, and update the `PackageBuilderSubmissionRow` type.

- [ ] **Step 6.3: Update sync (booth → site) endpoint**

`apps/site/src/pages/api/sync/inquiries.ts` validates the booth's payload. Find the schema or zod object and add venue_* fields as optional. Then propagate them into `insertInquiry()`.

- [ ] **Step 6.4: Update booth sync.ts**

`apps/intake/lib/sync.ts` builds the payload. The SELECT statement at ~line 115-130 lists columns to ship. Add the 7 venue address columns. Then add them to the per-row object built into the JSON payload.

- [ ] **Step 6.5: Run typecheck + tests**

```
cd /home/phoenix/code/smile-nola/apps/site && pnpm typecheck && pnpm test
cd /home/phoenix/code/smile-nola/apps/intake && pnpm typecheck
```
Expected: 0 errors, all tests pass.

- [ ] **Step 6.6: Commit**

```
cd /home/phoenix/code/smile-nola
git add apps/site/src/pages/api/inquiry.ts \
        apps/site/src/pages/api/contact.ts \
        apps/site/src/pages/api/package-builder.ts \
        apps/site/src/pages/api/sync/inquiries.ts \
        apps/intake/lib/sync.ts \
        apps/site/src/lib/builder/submissions.ts
git commit -m "feat(api): plumb venue address fields end-to-end

Site inquiry/contact/package-builder/sync routes all forward the new
venue address fields into insertInquiry/insertBuilderSubmission. Booth
sync.ts ships the new columns to /api/sync/inquiries. Builder
submissions schema persists the new columns alongside the existing
event details.

No-op for current free-text submitters — all fields are optional and
default to null. Sets up the next task (form UI) to actually populate
them."
```

---

## Task 7: Vanilla `VenueAutocomplete.astro` component

**Files:**
- Create: `apps/site/src/components/forms/VenueAutocomplete.astro`

The Astro component renders:
- A visible `<input type="text" name="venue">`
- 7 sibling hidden inputs (`venue_street_address`, `venue_city`, etc.)
- An empty `<ul role="listbox" hidden>` for the dropdown
- A `<script>` block that wires up `fetch`, debounce, keyboard nav, and ARIA combobox attributes

- [ ] **Step 7.1: Create the component**

Create `apps/site/src/components/forms/VenueAutocomplete.astro`:

```astro
---
/**
 * Venue autocomplete combobox.
 *
 * Usage:
 *   <VenueAutocomplete
 *     id="contact-venue"
 *     label="Venue (name or location)"
 *     placeholder="e.g. Saenger Theatre, New Orleans"
 *     initialValue={savedDraft?.venue ?? ''}
 *   />
 *
 * Renders a visible text input + 7 hidden inputs that the form submits:
 *   venue_street_address, venue_city, venue_state, venue_postal_code,
 *   venue_country, venue_latitude, venue_longitude
 *
 * When the user picks a suggestion from the dropdown, the hidden fields
 * get populated. When the user edits the visible input after a pick,
 * the hidden fields clear (acts like fresh free-text entry).
 *
 * Free-text entry without picking is fully supported — the visible
 * input always submits as `name="venue"`. Hidden fields stay empty.
 *
 * Server-side: the /api/places/* proxy handles the Google API key.
 * If the proxy returns 5xx (key missing / Google down), the dropdown
 * silently disappears and the user can still submit free text.
 */

interface Props {
  id: string
  label: string
  name?: string
  placeholder?: string
  initialValue?: string
  required?: boolean
}

const {
  id,
  label,
  name = 'venue',
  placeholder = '',
  initialValue = '',
  required = false,
} = Astro.props
---

<label class="sn-field-label" for={id}>
  <span>{label}{required ? ' *' : ''}</span>
  <div class="venue-ac" data-venue-ac>
    <input
      type="text"
      id={id}
      name={name}
      placeholder={placeholder}
      value={initialValue}
      autocomplete="off"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded="false"
      aria-controls={`${id}-listbox`}
      required={required}
      data-venue-input
    />
    <ul
      id={`${id}-listbox`}
      role="listbox"
      class="venue-ac__listbox"
      hidden
      data-venue-listbox
    ></ul>
    <input type="hidden" name="venue_street_address" data-venue-field="streetAddress" />
    <input type="hidden" name="venue_city" data-venue-field="city" />
    <input type="hidden" name="venue_state" data-venue-field="state" />
    <input type="hidden" name="venue_postal_code" data-venue-field="postalCode" />
    <input type="hidden" name="venue_country" data-venue-field="country" />
    <input type="hidden" name="venue_latitude" data-venue-field="latitude" />
    <input type="hidden" name="venue_longitude" data-venue-field="longitude" />
  </div>
</label>

<script>
  type Suggestion = { placeId: string; mainText: string; secondaryText: string }
  type ParsedPlace = {
    name: string
    streetAddress: string | null
    city: string | null
    state: string | null
    postalCode: string | null
    country: string | null
    latitude: number
    longitude: number
  }

  const FIELDS: Array<keyof ParsedPlace> = [
    'streetAddress', 'city', 'state', 'postalCode', 'country', 'latitude', 'longitude',
  ]

  function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T {
    let h: ReturnType<typeof setTimeout> | null = null
    return ((...args: any[]) => {
      if (h) clearTimeout(h)
      h = setTimeout(() => fn(...args), ms)
    }) as T
  }

  function initVenueAc(root: HTMLElement) {
    const input = root.querySelector<HTMLInputElement>('[data-venue-input]')!
    const listbox = root.querySelector<HTMLUListElement>('[data-venue-listbox]')!
    const fields = new Map<string, HTMLInputElement>()
    root.querySelectorAll<HTMLInputElement>('[data-venue-field]').forEach((el) => {
      fields.set(el.dataset.venueField!, el)
    })

    let suggestions: Suggestion[] = []
    let activeIndex = -1
    let isPicked = false

    function clearAddressFields() {
      for (const key of FIELDS) {
        const el = fields.get(key as string)
        if (el) el.value = ''
      }
    }

    function applyPicked(p: ParsedPlace) {
      input.value = p.name
      for (const key of FIELDS) {
        const el = fields.get(key as string)
        if (!el) continue
        const v = p[key]
        el.value = v == null ? '' : String(v)
      }
      isPicked = true
      closeList()
    }

    function renderList() {
      listbox.innerHTML = ''
      activeIndex = -1
      if (suggestions.length === 0) {
        closeList()
        return
      }
      suggestions.forEach((s, i) => {
        const li = document.createElement('li')
        li.id = `${input.id}-opt-${i}`
        li.setAttribute('role', 'option')
        li.setAttribute('aria-selected', 'false')
        li.className = 'venue-ac__opt'
        const main = document.createElement('span')
        main.className = 'venue-ac__opt-main'
        main.textContent = s.mainText
        const sec = document.createElement('span')
        sec.className = 'venue-ac__opt-sec'
        sec.textContent = s.secondaryText
        li.appendChild(main)
        if (s.secondaryText) li.appendChild(sec)
        li.addEventListener('mousedown', (e) => {
          e.preventDefault()
          pick(i)
        })
        listbox.appendChild(li)
      })
      openList()
    }

    function openList() {
      listbox.hidden = false
      input.setAttribute('aria-expanded', 'true')
    }

    function closeList() {
      listbox.hidden = true
      input.setAttribute('aria-expanded', 'false')
      input.removeAttribute('aria-activedescendant')
    }

    function setActive(i: number) {
      const opts = Array.from(listbox.querySelectorAll<HTMLLIElement>('[role="option"]'))
      opts.forEach((el, idx) => {
        el.setAttribute('aria-selected', idx === i ? 'true' : 'false')
        el.classList.toggle('is-active', idx === i)
      })
      activeIndex = i
      if (i >= 0 && opts[i]) {
        input.setAttribute('aria-activedescendant', opts[i].id)
      } else {
        input.removeAttribute('aria-activedescendant')
      }
    }

    async function pick(i: number) {
      const s = suggestions[i]
      if (!s) return
      try {
        const res = await fetch(`/api/places/details?id=${encodeURIComponent(s.placeId)}`)
        if (!res.ok) {
          // Failed to fetch details — keep what they typed as free text.
          input.value = s.mainText
          clearAddressFields()
          closeList()
          return
        }
        const data: ParsedPlace = await res.json()
        applyPicked(data)
      } catch {
        input.value = s.mainText
        clearAddressFields()
        closeList()
      }
    }

    async function search(q: string) {
      if (!q || q.length < 2) {
        suggestions = []
        renderList()
        return
      }
      try {
        const res = await fetch(`/api/places/autocomplete?q=${encodeURIComponent(q)}`)
        if (!res.ok) {
          suggestions = []
          renderList()
          return
        }
        const data: { suggestions: Suggestion[] } = await res.json()
        suggestions = data.suggestions ?? []
        renderList()
      } catch {
        suggestions = []
        renderList()
      }
    }

    const debouncedSearch = debounce(search, 250)

    input.addEventListener('input', () => {
      if (isPicked) {
        clearAddressFields()
        isPicked = false
      }
      debouncedSearch(input.value.trim())
    })

    input.addEventListener('keydown', (e) => {
      if (listbox.hidden || suggestions.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((activeIndex + 1) % suggestions.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive(activeIndex <= 0 ? suggestions.length - 1 : activeIndex - 1)
      } else if (e.key === 'Enter' && activeIndex >= 0) {
        e.preventDefault()
        pick(activeIndex)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        closeList()
      }
    })

    input.addEventListener('blur', () => {
      setTimeout(closeList, 150) // let mousedown on option fire first
    })
  }

  document.querySelectorAll<HTMLElement>('[data-venue-ac]').forEach(initVenueAc)
</script>

<style>
  .venue-ac { position: relative; display: block; }
  .venue-ac__listbox {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin: 4px 0 0;
    padding: 4px 0;
    list-style: none;
    background: white;
    border: 1px solid rgba(0, 0, 0, 0.18);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    max-height: 280px;
    overflow-y: auto;
    z-index: 50;
  }
  .venue-ac__opt {
    padding: 8px 12px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .venue-ac__opt:hover,
  .venue-ac__opt.is-active {
    background: rgba(0, 0, 0, 0.06);
  }
  .venue-ac__opt-main {
    font-weight: 500;
    color: var(--sn-color-text, #1a1a1a);
  }
  .venue-ac__opt-sec {
    font-size: 0.875em;
    color: rgba(0, 0, 0, 0.6);
  }
</style>
```

- [ ] **Step 7.2: Verify it compiles**

```
cd apps/site && pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 7.3: Commit**

```
cd /home/phoenix/code/smile-nola
git add apps/site/src/components/forms/VenueAutocomplete.astro
git commit -m "feat(forms): vanilla VenueAutocomplete.astro combobox

Reusable Astro component for venue search across all site forms.
Renders a visible text input + 7 hidden address fields. Calls the
/api/places proxy. Debounced 250ms. Full keyboard nav. ARIA combobox
pattern (role+aria-expanded+aria-activedescendant). Free-text fallback
when no suggestion is picked.

No React dependency — works inside the existing Astro form pages
without bundling React just for this component."
```

---

## Task 8: Wire VenueAutocomplete into `/contact` form

**Files:**
- Modify: `apps/site/src/components/forms/InquiryFormDeep.astro`

- [ ] **Step 8.1: Find the existing venue input**

In `apps/site/src/components/forms/InquiryFormDeep.astro` around line 228 there's:
```astro
<span class="sn-field-label">Venue (name or location)</span>
<input type="text" name="venue" placeholder="e.g. The Sugar Mill · New Orleans, LA" />
```

- [ ] **Step 8.2: Replace with VenueAutocomplete**

Add to the file's frontmatter imports at the top:
```ts
import VenueAutocomplete from './VenueAutocomplete.astro'
```

Replace the markup:
```astro
<VenueAutocomplete
  id="venue"
  label="Venue (name or location)"
  placeholder="e.g. Saenger Theatre, New Orleans"
/>
```

- [ ] **Step 8.3: Build + smoke test**

```
cd apps/site && pnpm build
```
Expected: build succeeds.

- [ ] **Step 8.4: Local smoke test (dev server)**

Run `pnpm dev`, open http://localhost:4321/contact, verify:
- The venue input renders without errors in the console
- Typing "Saenger" makes a request to `/api/places/autocomplete` (visible in Network tab)
- If `GOOGLE_PLACES_API_KEY` is set in `apps/site/.env`, suggestions appear
- Selecting a suggestion populates the name and you can see the hidden inputs filled (via DevTools Elements inspector)
- Submitting the form successfully POSTs to `/api/contact` with the new venue fields

If the API key isn't enabled yet on the new Places API (user enables manually), suggestions won't appear and the form falls back to free text — this is the intended degradation.

- [ ] **Step 8.5: Commit**

```
cd /home/phoenix/code/smile-nola
git add apps/site/src/components/forms/InquiryFormDeep.astro
git commit -m "feat(/contact): venue autocomplete on the deep inquiry form

Swaps the free-text venue input for the new VenueAutocomplete component.
Falls back to plain text when the Google Places API key is missing or
the proxy fails — preserves the existing free-text behavior for users
who type 'TBD' or 'grandma's backyard'."
```

---

## Task 9: React `VenueAutocompleteReact` for the builder

**Files:**
- Create: `apps/site/src/components/forms/VenueAutocompleteReact.tsx`
- Modify: `apps/site/src/components/builder/EventDetails.tsx`

- [ ] **Step 9.1: Find the builder venue input**

Run `grep -n "venue" apps/site/src/components/builder/EventDetails.tsx`. Find the venue text input and where its value is stored in the builder's state hook.

- [ ] **Step 9.2: Create the React component**

Create `apps/site/src/components/forms/VenueAutocompleteReact.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react'

export interface VenueValue {
  name: string
  streetAddress: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
}

interface Suggestion { placeId: string; mainText: string; secondaryText: string }

export const EMPTY_VENUE: VenueValue = {
  name: '',
  streetAddress: null,
  city: null,
  state: null,
  postalCode: null,
  country: null,
  latitude: null,
  longitude: null,
}

interface Props {
  value: VenueValue
  onChange: (v: VenueValue) => void
  label?: string
  placeholder?: string
  id?: string
  required?: boolean
  /** Optional override for the proxy base. Booth uses an absolute URL. */
  proxyBase?: string
}

export function VenueAutocompleteReact({
  value,
  onChange,
  label = 'Venue',
  placeholder = 'Venue name or location',
  id = 'venue',
  required = false,
  proxyBase = '',
}: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPickedRef = useRef(false)

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
  }, [])

  function update(name: string) {
    if (isPickedRef.current && name !== value.name) {
      // User is editing after a pick — clear the structured address.
      onChange({ ...EMPTY_VENUE, name })
      isPickedRef.current = false
    } else {
      onChange({ ...value, name })
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!name || name.length < 2) {
      setSuggestions([])
      return
    }
    debounceRef.current = setTimeout(() => search(name), 250)
  }

  async function search(q: string) {
    try {
      const res = await fetch(`${proxyBase}/api/places/autocomplete?q=${encodeURIComponent(q)}`)
      if (!res.ok) {
        setSuggestions([])
        return
      }
      const data: { suggestions: Suggestion[] } = await res.json()
      setSuggestions(data.suggestions ?? [])
      setOpen(true)
      setActiveIndex(-1)
    } catch {
      setSuggestions([])
    }
  }

  async function pick(s: Suggestion) {
    try {
      const res = await fetch(`${proxyBase}/api/places/details?id=${encodeURIComponent(s.placeId)}`)
      if (!res.ok) {
        onChange({ ...EMPTY_VENUE, name: s.mainText })
        setOpen(false)
        return
      }
      const data = await res.json() as VenueValue
      onChange({
        name: data.name,
        streetAddress: data.streetAddress ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        postalCode: data.postalCode ?? null,
        country: data.country ?? null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
      })
      isPickedRef.current = true
      setOpen(false)
    } catch {
      onChange({ ...EMPTY_VENUE, name: s.mainText })
      setOpen(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      pick(suggestions[activeIndex]!)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <label className="venue-ac-react block">
      <span className="block text-sm mb-1">{label}{required ? ' *' : ''}</span>
      <div className="relative">
        <input
          id={id}
          type="text"
          value={value.name}
          placeholder={placeholder}
          required={required}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-listbox`}
          onChange={(e) => update(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
            blurTimerRef.current = setTimeout(() => setOpen(false), 150)
          }}
          className="w-full rounded border px-3 py-2"
        />
        {open && suggestions.length > 0 && (
          <ul
            id={`${id}-listbox`}
            role="listbox"
            className="absolute top-full left-0 right-0 mt-1 max-h-72 overflow-y-auto rounded border bg-white shadow-lg z-50"
          >
            {suggestions.map((s, i) => (
              <li
                key={s.placeId}
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(e) => { e.preventDefault(); pick(s) }}
                className={`px-3 py-2 cursor-pointer ${i === activeIndex ? 'bg-gray-100' : ''}`}
              >
                <div className="font-medium">{s.mainText}</div>
                {s.secondaryText && (
                  <div className="text-sm text-gray-600">{s.secondaryText}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </label>
  )
}
```

- [ ] **Step 9.3: Wire into EventDetails**

In `apps/site/src/components/builder/EventDetails.tsx`, import `VenueAutocompleteReact` and `VenueValue`. Replace the existing venue text input. The builder state hook should already have an `event.venue: string` — extend it to hold the full `VenueValue` object (call it `event.venue` still, change type from `string | null` to `VenueValue`).

Update `apps/site/src/components/builder/useBuilderState.ts` accordingly: the venue state becomes the full object. On submission, the post body sends both `event.venue` (the name as a string for backwards compat) AND the seven address fields.

Adjust `Builder.tsx` and the submit payload to flatten `event.venue` into `event.venue` (string) + `event.venue_*` siblings, matching the BuilderSubmissionSchema from Task 5.

- [ ] **Step 9.4: Typecheck + tests**

```
cd apps/site && pnpm typecheck && pnpm test
```
Expected: green.

- [ ] **Step 9.5: Commit**

```
cd /home/phoenix/code/smile-nola
git add apps/site/src/components/forms/VenueAutocompleteReact.tsx \
        apps/site/src/components/builder/EventDetails.tsx \
        apps/site/src/components/builder/useBuilderState.ts \
        apps/site/src/components/builder/Builder.tsx
git commit -m "feat(builder): VenueAutocompleteReact in EventDetails

React variant of the venue combobox. Same proxy endpoints, same
keyboard nav, same free-text fallback. Builder state hook holds the
full VenueValue object; submit payload flattens to event.venue (name
string) + event.venue_* address siblings per BuilderSubmissionSchema."
```

---

## Task 10: Booth `VenueAutocomplete.tsx`

**Files:**
- Create: `apps/intake/components/form/VenueAutocomplete.tsx`
- Modify: `apps/intake/components/form/steps/StepCelebration.tsx`
- Modify: `apps/intake/components/form/IntakeForm.tsx` (defaults)

- [ ] **Step 10.1: Create booth component**

Create `apps/intake/components/form/VenueAutocomplete.tsx`. Copy the React component from Task 9 but adjust styling for the booth's design system (uses shadcn-ish components). The key difference: `proxyBase` defaults to the site domain in production so booth iPads hit the site's proxy. In dev, it defaults to localhost:4321.

Add at the top of the file:
```tsx
const DEFAULT_PROXY_BASE =
  process.env.NEXT_PUBLIC_PROXY_BASE ?? 'https://smile-nola.com'
```

Use `proxyBase = DEFAULT_PROXY_BASE` as the prop default.

CORS: the site proxy needs to allow the booth's origin. Add `Access-Control-Allow-Origin: *` (or the booth's specific origin) to the proxy responses' headers. This is safe — the endpoints don't carry credentials, the API key never leaves the server.

- [ ] **Step 10.2: Add CORS headers to the proxy**

Modify `apps/site/src/pages/api/places/autocomplete.ts` and `details.ts`:
```ts
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
    },
  })
}

export const OPTIONS: APIRoute = () => new Response(null, {
  status: 204,
  headers: {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  },
})
```

Update the existing autocomplete + details tests to also assert presence of the CORS header on success (`expect(res.headers.get('access-control-allow-origin')).toBe('*')`).

- [ ] **Step 10.3: Wire into StepCelebration**

In `apps/intake/components/form/steps/StepCelebration.tsx`, replace the venue `<TextField>` (line ~86-94) with the new `<VenueAutocomplete>`. The booth uses react-hook-form — register the new fields:

```tsx
const onVenuePicked = (v: VenueValue) => {
  setValue('venueName', v.name)
  setValue('venueStreetAddress', v.streetAddress ?? '')
  setValue('venueCity', v.city ?? '')
  setValue('venueState', v.state ?? '')
  setValue('venuePostalCode', v.postalCode ?? '')
  setValue('venueCountry', v.country ?? '')
  setValue('venueLatitude', v.latitude)
  setValue('venueLongitude', v.longitude)
}
```

- [ ] **Step 10.4: Update form defaults**

In `apps/intake/components/form/IntakeForm.tsx`, find the `defaultValues` block and add the new fields with empty/null defaults.

- [ ] **Step 10.5: Typecheck booth**

```
cd apps/intake && pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 10.6: Commit**

```
cd /home/phoenix/code/smile-nola
git add apps/intake/components/form/VenueAutocomplete.tsx \
        apps/intake/components/form/steps/StepCelebration.tsx \
        apps/intake/components/form/IntakeForm.tsx \
        apps/site/src/pages/api/places/autocomplete.ts \
        apps/site/src/pages/api/places/details.ts \
        apps/site/src/pages/api/places/__tests__/autocomplete.test.ts \
        apps/site/src/pages/api/places/__tests__/details.test.ts
git commit -m "feat(booth+cors): venue autocomplete on the booth iPad

Booth's StepCelebration replaces the free-text venue field with the
new VenueAutocomplete. The booth calls the SITE's /api/places/* proxy
cross-origin (booth is on a different domain) so we add Access-
Control-Allow-Origin: * + OPTIONS preflight handling to both proxy
endpoints. Tests assert the CORS header on success responses.

NEXT_PUBLIC_PROXY_BASE env var lets dev override the proxy origin.
Defaults to https://smile-nola.com in production."
```

---

## Task 11: VSCO mapping passes `mailingAddress` to Location contact

**Files:**
- Modify: `apps/site/src/lib/vsco/mappings.ts`
- Modify: `apps/site/src/lib/vsco/__tests__/mappings.test.ts`

- [ ] **Step 11.1: Write failing test**

In `apps/site/src/lib/vsco/__tests__/mappings.test.ts`, find the existing venue test (search for `'kind: location'` or `inquiry\.venue`). Add a new test:

```ts
it('Location contact carries mailingAddress when venue address fields are set', () => {
  const inquiry = makeInquiry({
    venue: 'Saenger Theatre',
    venue_street_address: '1111 Canal St',
    venue_city: 'New Orleans',
    venue_state: 'LA',
    venue_postal_code: '70112',
    venue_country: 'US',
    venue_latitude: 29.9572,
    venue_longitude: -90.0773,
  } as any)
  const ws = inquiryToJobWorksheet(inquiry, { config: cfg, siteBase })
  const venue = ws.contacts.find((c) => c.contact.kind === 'location')
  expect(venue).toBeDefined()
  expect((venue!.contact as any).name).toBe('Saenger Theatre')
  expect((venue!.contact as any).mailingAddress).toEqual({
    streetAddress: '1111 Canal St',
    city: 'New Orleans',
    state: 'LA',
    postalCode: '70112',
    country: 'US',
  })
})

it('Location contact has no mailingAddress when only venue name is set (free text)', () => {
  const inquiry = makeInquiry({ venue: 'Backyard' } as any)
  const ws = inquiryToJobWorksheet(inquiry, { config: cfg, siteBase })
  const venue = ws.contacts.find((c) => c.contact.kind === 'location')
  expect(venue).toBeDefined()
  expect((venue!.contact as any).name).toBe('Backyard')
  expect((venue!.contact as any).mailingAddress).toBeUndefined()
})
```

The `makeInquiry` helper needs to accept the new venue_* fields. If TS errors, update `makeInquiry` to spread overrides + initialize the new fields as `null`:
```ts
venue_street_address: null,
venue_city: null,
venue_state: null,
venue_postal_code: null,
venue_country: null,
venue_latitude: null,
venue_longitude: null,
```
…and use `Partial<InquiryRow & { venue_street_address: ... }>` style override typing.

- [ ] **Step 11.2: Run test, expect failure**

```
cd apps/site && pnpm vitest run src/lib/vsco/__tests__/mappings.test.ts -t "mailingAddress"
```
Expected: 2 failing.

- [ ] **Step 11.3: Implement mapping change**

In `apps/site/src/lib/vsco/mappings.ts` find the venue contact construction (around line 497):

```ts
// 3. Venue (Location contact) if known
if (inquiry.venue && inquiry.venue.trim()) {
  const hasAddress = Boolean(
    inquiry.venue_street_address ||
    inquiry.venue_city ||
    inquiry.venue_state ||
    inquiry.venue_postal_code ||
    inquiry.venue_country,
  )
  contacts.push({
    jobRoles: [config.jobRoles.venue],
    contact: {
      kind: 'location',
      name: inquiry.venue.trim(),
      ...(hasAddress && {
        mailingAddress: {
          streetAddress: inquiry.venue_street_address || null,
          city: inquiry.venue_city || null,
          state: inquiry.venue_state || null,
          postalCode: inquiry.venue_postal_code || null,
          country: inquiry.venue_country || null,
        },
      }),
    },
  })
}
```

- [ ] **Step 11.4: Run tests, expect pass**

```
pnpm vitest run src/lib/vsco/__tests__/mappings.test.ts
```
Expected: 2 new tests pass; all 203+ pass.

- [ ] **Step 11.5: Commit**

```
cd /home/phoenix/code/smile-nola
git add apps/site/src/lib/vsco/mappings.ts apps/site/src/lib/vsco/__tests__/mappings.test.ts
git commit -m "feat(vsco): venue Location contact carries mailingAddress

When the inquiry has structured venue address fields (set via Google
Places autocomplete), pass them as Location.mailingAddress on the
venue contact. VSCO's Schedule section uses this to render the map pin.

Free-text-only venues continue to work — mailingAddress is omitted
when all address fields are null."
```

---

## Task 12: Admin UI shows structured address + map link

**Files:**
- Modify: `apps/site/src/pages/admin/inquiries/[id].astro`
- Modify: `apps/site/src/pages/admin/builder-submissions/[id].astro` (if it exists; otherwise skip)

- [ ] **Step 12.1: Locate the venue display**

Run `grep -n "inquiry.venue" apps/site/src/pages/admin/inquiries/[id].astro` to find the current display row.

- [ ] **Step 12.2: Extend it**

Replace the venue display row with:
```astro
<div class="admin-row">
  <span class="admin-row__label">Venue</span>
  <span class="admin-row__value">
    {inquiry.venue || '—'}
    {inquiry.venue_street_address || inquiry.venue_city ? (
      <span class="admin-row__detail block text-sm text-gray-600">
        {[
          inquiry.venue_street_address,
          inquiry.venue_city,
          inquiry.venue_state,
          inquiry.venue_postal_code,
        ].filter(Boolean).join(', ')}
      </span>
    ) : null}
    {inquiry.venue_latitude && inquiry.venue_longitude ? (
      <a
        href={`https://www.google.com/maps?q=${inquiry.venue_latitude},${inquiry.venue_longitude}`}
        target="_blank"
        rel="noopener noreferrer"
        class="admin-row__link text-sm"
      >
        View on map ↗
      </a>
    ) : null}
  </span>
</div>
```

- [ ] **Step 12.3: Build to verify**

```
cd apps/site && pnpm build
```
Expected: no errors.

- [ ] **Step 12.4: Commit**

```
cd /home/phoenix/code/smile-nola
git add apps/site/src/pages/admin/inquiries/[id].astro
git commit -m "feat(admin): show venue address + 'View on map' link

When an inquiry has structured venue data from Places autocomplete,
the admin detail page renders the full address below the venue name
and a 'View on map ↗' link that opens Google Maps centered on the
captured lat/lng."
```

---

## Task 13: Deploy + live smoke test

- [ ] **Step 13.1: Push to main + deploy**

```
cd /home/phoenix/code/smile-nola
git push origin main
```

Wait for Coolify deploy to settle (use the same polling pattern as previous deploys, watching `last_online_at`).

- [ ] **Step 13.2: Verify environment**

```
# Confirm GOOGLE_PLACES_API_KEY is set
curl -s -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "https://empower.relentnet.com/api/v1/applications/f4owsscow4wksc04c0os0o40/envs" \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
for e in data:
    if e.get('key') == 'GOOGLE_PLACES_API_KEY':
        v = e.get('value') or e.get('real_value') or ''
        print(f'GOOGLE_PLACES_API_KEY: {len(v)} chars'); break
"
```

- [ ] **Step 13.3: Probe the proxy live**

```
curl -s "https://smile-nola.com/api/places/autocomplete?q=Saenger+Theatre" | python3 -m json.tool
```
Expected: a JSON `{ suggestions: [...] }` array containing Saenger Theatre. If the user has enabled Places API (New), this returns 200 with results. If not, the proxy returns 502 (Google upstream error) and we know to ping the user to enable the API.

If 503 is returned: API key not propagated yet — wait for deploy.

If 200 returned: pick the first placeId and probe details:
```
curl -s "https://smile-nola.com/api/places/details?id=<placeId>" | python3 -m json.tool
```
Expected: full ParsedPlace JSON.

- [ ] **Step 13.4: Submit a fresh inquiry with venue picked**

The smoke test mirrors the Model B verification approach:
1. POST to `/api/contact` with a payload that includes `venue` AND all 7 address fields filled in (simulate what the form would submit after a pick):
   ```json
   {
     "first_name": "VenueTest",
     "last_name": "Final",
     "email": "smoke-test+venue@smile-nola.com",
     "phone": "+15045550213",
     "event_date": "2026-12-19",
     "event_type": "Wedding",
     "guest_count": 100,
     "venue": "Saenger Theatre",
     "venue_street_address": "1111 Canal St",
     "venue_city": "New Orleans",
     "venue_state": "LA",
     "venue_postal_code": "70112",
     "venue_country": "US",
     "venue_latitude": 29.9572,
     "venue_longitude": -90.0773,
     "collections_interested": ["smile", "visionary"],
     "source": "contact"
   }
   ```
2. Mark Qualified.
3. `GET /api/admin/inquiries/<id>/vsco-debug` and grab the job ULID.
4. `GET https://workspace.vsco.co/api/v2/address-book/<venue-contact-ULID>` — verify `mailingAddress` is populated:
   ```json
   {
     "kind": "location",
     "name": "Saenger Theatre",
     "mailingAddress": {
       "streetAddress": "1111 Canal St",
       "city": "New Orleans",
       "state": "LA",
       "postalCode": "70112",
       "country": "US"
     }
   }
   ```
5. Visit the Job in VSCO's UI and check the Schedule section — should show map pin.

- [ ] **Step 13.5: Manual UI test (optional, after user wakes up)**

Open https://smile-nola.com/contact in a browser, type "Saenger" in the venue field, pick the suggestion, submit the form, and verify a new inquiry exists in admin with structured address.

- [ ] **Step 13.6: Final commit summarizing**

If the smoke test passes, no more code commits needed. If something fails, fix + recommit.

---

## Self-review of this plan

**Spec coverage:**
- Tasks 2 + 3 cover the server proxy section
- Task 7 covers the Astro/vanilla component
- Task 9 covers the React component for builder
- Task 10 covers the booth + CORS
- Task 4 covers the storage migration
- Task 5 covers schema validation
- Task 6 covers wiring through API routes
- Task 11 covers VSCO mapping
- Task 12 covers admin UI
- Task 13 covers deploy + smoke test
- ✓ Every spec section maps to at least one task

**Placeholder scan:**
- No "TBD" / "implement later" / "add error handling without showing how"
- All code blocks are complete
- Test code is concrete

**Type consistency:**
- `VenueValue` / `ParsedPlace` shapes match between Tasks 1, 7, 9, 10
- `venue_*` column names are identical across DB migration, schema, mapping, and forms
- Booth uses `venueName`-style names internally but ships canonical `venue_*` names in the sync payload (Task 6)

---

## Execution plan

I'll execute this plan inline in this session, committing each task. The user is asleep — I'll work straight through Tasks 1–12 and then deploy + smoke-test on Task 13. If a test fails or a deploy goes sideways, I stop and write a detailed status comment so they can pick up in the morning.
