# Venue Autocomplete Design

**Date**: 2026-05-13
**Status**: approved (ready for implementation)

## Problem

Three inquiry forms on Smile NOLA collect a `venue` value as plain free
text:

- `apps/site/src/components/forms/InquiryFormDeep.astro` (`/contact`)
- `apps/site/src/components/builder/EventDetails.tsx` (`/build`)
- `apps/intake/components/form/steps/StepCelebration.tsx` (booth iPad)

When we push qualified inquiries to VSCO Workspace, we create a Location
contact with `name: inquiry.venue.trim()` and no structured address.
VSCO's Schedule section then can't show a map pin, can't auto-fill the
job's vendor list with the venue, and can't geo-cluster the studio's
work. Free-text "Ace Hotel" doesn't dedupe against "Ace Hotel New
Orleans" or "The Ace · NOLA" — each becomes a separate Location row.

## Goal

Capture structured venue data (name + address + lat/lng) at form-time,
using Google Places Autocomplete with **business search** so couples
can type "Saenger Theatre" and pick a real result. Pass the structured
address to VSCO when creating the Location contact and the Event's
location block.

## Non-goals

- We do NOT capture phone numbers, website, hours, photos, ratings, or
  any other "enrichment" data. VSCO fetches its own location details
  via its dashboard once a place is identified by address.
- We do NOT store Google's `place_id`. The address+lat/lng is enough
  for VSCO to find the venue; storing place_id would be useful for
  future venue analytics but isn't needed today (YAGNI).
- We do NOT change the existing free-text behavior. Users who type
  "TBD" or "grandma's backyard" still submit successfully — the address
  fields stay NULL in that case.
- We do NOT migrate historical inquiries. Existing `inquiries.venue`
  values stay as-is; only new submissions get structured data.

## API choice

**Places API (New)** at `https://places.googleapis.com/v1/places:autocomplete`
and `https://places.googleapis.com/v1/places/{placeId}`. User chose this
over the legacy API for forward compatibility.

Required setup on the GCP project (project `624667977876`):

1. Enable "Places API (New)" at
   https://console.developers.google.com/apis/api/places.googleapis.com/overview?project=624667977876
2. Create an API key restricted to:
   - **API restrictions**: only `Places API (New)`
   - **Application restrictions**: HTTP referrers
     - `https://smile-nola.com/*`
     - `https://*.smile-nola.com/*`
   - For the booth iPad, the existing key needs broader (or none) referrer
     restriction — discuss with the user. For now, the booth shares the
     site's key but the proxy approach means the key never appears in
     the browser, so referrer restrictions are best-effort defense in
     depth, not the primary control.

## Architecture

```
                    Browser
                       │
                       │ (user types in venue field)
                       │
                       ▼
   ┌─────────────────────────────────────────────┐
   │  VenueAutocomplete component                │
   │  - debounced input                          │
   │  - dropdown with suggestions                │
   │  - on pick: writes to hidden form fields    │
   └─────────────────────────────────────────────┘
                       │
              GET /api/places/autocomplete?q=...
              GET /api/places/details?id=...
                       │
                       ▼
   ┌─────────────────────────────────────────────┐
   │  Server-side proxy (Astro API routes)       │
   │  - adds X-Goog-Api-Key header               │
   │  - calls Places API (New)                   │
   │  - returns trimmed JSON to browser          │
   └─────────────────────────────────────────────┘
                       │
                       ▼
              Places API (New)
```

The API key only ever lives server-side, in:
- `apps/site/.env` (dev) and Coolify env (prod): `GOOGLE_PLACES_API_KEY`
- The Astro proxy routes read it via `import.meta.env.GOOGLE_PLACES_API_KEY`

The booth app (`apps/intake`) submits to the same proxy endpoints on the
site domain (already does cross-origin sync), no separate API key needed.

## Components

### 1. Server proxy routes

**`apps/site/src/pages/api/places/autocomplete.ts`** — GET endpoint
- Input: query parameter `q` (the user's typed text)
- Action: POSTs to `https://places.googleapis.com/v1/places:autocomplete`
  with body `{ input: q, languageCode: "en", regionCode: "US" }`
- Headers: `X-Goog-Api-Key`, `X-Goog-FieldMask: suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat`
- Response: trimmed to just the array of suggestions:
  `[{ placeId, mainText, secondaryText }, ...]`
- Returns 200 with `{ suggestions: [...] }` or 4xx/5xx with `{ error: "message" }`
- Rate-limit defensive: returns 429 if more than 10 requests/second from
  the same IP (in-memory counter, resets each minute) — soft limit, just
  to avoid runaway client bugs

**`apps/site/src/pages/api/places/details.ts`** — GET endpoint
- Input: query parameter `id` (a place ID from autocomplete)
- Action: GET to `https://places.googleapis.com/v1/places/{placeId}`
- Headers: `X-Goog-Api-Key`, `X-Goog-FieldMask: id,displayName,formattedAddress,addressComponents,location`
- Parses Google's `addressComponents` array into named fields
- Response:
  ```json
  {
    "name": "Saenger Theatre",
    "streetAddress": "1111 Canal St",
    "city": "New Orleans",
    "state": "LA",
    "postalCode": "70112",
    "country": "US",
    "latitude": 29.9572,
    "longitude": -90.0773
  }
  ```

### 2. Frontend component: `VenueAutocomplete`

Two flavors (same behavior, different framework integration):

**Astro/vanilla (`apps/site/src/components/forms/VenueAutocomplete.astro`):**
- Standard form input (`<input type="text" name="venue">`)
- Sibling hidden inputs (`venue_street_address`, `venue_city`, etc.)
- Vanilla JS:
  - debounce 250ms on input
  - fetch `/api/places/autocomplete?q=...`
  - render dropdown of suggestions below the input (semantic `<ul role="listbox">`)
  - on click: fetch details, populate hidden fields, replace input value with `name`
  - keyboard nav (arrow up/down + enter)
  - escape closes the dropdown
  - `aria-` attributes for screen readers (autocomplete combobox pattern)
  - on input edit AFTER a pick, blank out the hidden address fields (user changed mind)

**React (`apps/site/src/components/forms/VenueAutocompleteReact.tsx`):**
- Same behavior as Astro version, written for React. Used by the builder.
- Returns an object `{ name, streetAddress, city, state, postalCode, country, latitude, longitude }` to the parent via callback.

**Intake (booth) version (`apps/intake/components/form/VenueAutocomplete.tsx`):**
- React component, mirrors the site React version
- Calls the SITE proxy at `https://smile-nola.com/api/places/...` (booth
  is already wired for cross-origin to the site for sync)
- Uses same TailwindCSS-shadcn theming as other booth fields (`TextField`
  style)

### 3. Storage migration

`apps/site/src/lib/db.ts` adds the following migration (runs once at
bootstrap, idempotent):

```sql
ALTER TABLE inquiries ADD COLUMN venue_street_address TEXT;
ALTER TABLE inquiries ADD COLUMN venue_city TEXT;
ALTER TABLE inquiries ADD COLUMN venue_state TEXT;
ALTER TABLE inquiries ADD COLUMN venue_postal_code TEXT;
ALTER TABLE inquiries ADD COLUMN venue_country TEXT;
ALTER TABLE inquiries ADD COLUMN venue_latitude REAL;
ALTER TABLE inquiries ADD COLUMN venue_longitude REAL;

ALTER TABLE package_builder_submissions ADD COLUMN venue_street_address TEXT;
ALTER TABLE package_builder_submissions ADD COLUMN venue_city TEXT;
ALTER TABLE package_builder_submissions ADD COLUMN venue_state TEXT;
ALTER TABLE package_builder_submissions ADD COLUMN venue_postal_code TEXT;
ALTER TABLE package_builder_submissions ADD COLUMN venue_country TEXT;
ALTER TABLE package_builder_submissions ADD COLUMN venue_latitude REAL;
ALTER TABLE package_builder_submissions ADD COLUMN venue_longitude REAL;
```

Existing `venue TEXT` column is preserved as the human-readable name.
All other fields are nullable; free-text submissions leave them NULL.

### 4. Schema validation

Both `InquiryDeepSchema` and `InquiryShortSchema` in
`apps/site/src/lib/schema.ts` get optional address fields:

```ts
venue_street_address: z.string().max(200).optional(),
venue_city: z.string().max(80).optional(),
venue_state: z.string().max(40).optional(),
venue_postal_code: z.string().max(20).optional(),
venue_country: z.string().max(2).optional(), // ISO-3166 alpha-2
venue_latitude: z.coerce.number().min(-90).max(90).optional(),
venue_longitude: z.coerce.number().min(-180).max(180).optional(),
```

Same applies to `BuilderSubmissionSchema` and `LeadSchema` (intake).

API routes (`api/inquiry.ts`, `api/contact.ts`, `api/sync/inquiries.ts`,
`api/package-builder.ts`) just pass these fields through to
`insertInquiry()` / `insertBuilderSubmission()`.

### 5. VSCO mapping update

In `apps/site/src/lib/vsco/mappings.ts` `inquiryToJobWorksheet`:

**Location contact (`venue`):**
```ts
if (inquiry.venue && inquiry.venue.trim()) {
  const hasAddress = inquiry.venue_street_address || inquiry.venue_city
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

**Event location block** (new — currently we don't populate this at all):
```ts
if (inquiry.event_date) {
  events.push({
    name: 'Main Event',
    typeId: config.eventTypes['main-event'],
    startDate: inquiry.event_date,
    startTime: inquiry.event_start || null,
    endTime: inquiry.event_end || null,
    ...(inquiry.venue_street_address || inquiry.venue_city ? {
      location: {
        address: {
          streetAddress: inquiry.venue_street_address || null,
          city: inquiry.venue_city || null,
          state: inquiry.venue_state || null,
          postalCode: inquiry.venue_postal_code || null,
          country: inquiry.venue_country || null,
        },
      },
    } : {}),
  })
}
```

We do NOT pass lat/lng to VSCO. The VSCO `Address` schema only takes
the postal address components; VSCO geocodes server-side. Our captured
lat/lng is for our own future use (admin map view, perhaps).

### 6. Admin UI

`apps/site/src/pages/admin/inquiries/[id].astro` already shows
`inquiry.venue`. Add a small display of the structured address below it
when available:

```
Venue: Saenger Theatre
       1111 Canal St, New Orleans, LA 70112
```

Plus a "View on map" link that opens `https://www.google.com/maps?q=<lat>,<lng>`
in a new tab when lat/lng is set.

Builder submission admin view gets the same treatment.

## Error handling

| Failure mode | Behavior |
|---|---|
| User types but never picks (TBD, "Backyard", etc.) | Save free text to `venue`, leave address fields NULL. Form submits successfully. |
| Proxy returns 5xx | Dropdown shows "Search unavailable. Type your venue manually." User can still submit free text. |
| Google API returns 4xx (key issue, quota) | Same as above — failure is invisible to user, free text still works. Server logs the error. |
| User picks then edits the input | Hidden address fields get cleared. Acts like a fresh free-text entry. |
| User picks an item with incomplete address (e.g. small business with no postal code) | Only the fields Google returns are populated. Others stay NULL. |
| Slow network | 5s timeout on proxy → dropdown disappears, free text still works. |

## Testing

**Unit tests (Vitest):**

`apps/site/src/lib/vsco/__tests__/mappings.test.ts` adds tests:
- Inquiry with full venue + address → Location contact has mailingAddress, Event has location.address
- Inquiry with venue name only (no address) → Location contact has name only, no mailingAddress; Event has no location
- Inquiry with venue address fields but no venue name → still creates Location contact with name = a synthesized "Venue at <city>" or similar (edge case)

`apps/site/src/pages/api/places/__tests__/autocomplete.test.ts`:
- Returns 400 if `q` missing
- Mocks Google response, verifies trimmed shape
- Returns 5xx from Google as 502 (bad gateway) with friendly message

`apps/site/src/pages/api/places/__tests__/details.test.ts`:
- Parses Google `addressComponents` array correctly:
  - `street_number` + `route` → `streetAddress`
  - `locality` → `city` (or `sublocality_level_1` as fallback)
  - `administrative_area_level_1.shortText` → `state`
  - `postal_code` → `postalCode`
  - `country.shortText` → `country`
- Returns 400 if `id` missing

`apps/site/src/components/forms/__tests__/VenueAutocomplete.test.ts`:
- Renders input + hidden fields
- Fetches autocomplete after 250ms debounce
- Renders dropdown when results arrive
- On click: fetches details, populates hidden fields
- Keyboard nav (down arrow, enter)
- Escape closes dropdown
- Editing after pick clears hidden fields

**Live smoke test:**
1. Submit fresh inquiry via `/contact` with venue picked from autocomplete
2. Verify SQLite has venue + venue_street_address + venue_city + etc.
3. Verify VSCO Location contact has `mailingAddress`
4. Verify VSCO Event has `location.address`
5. Verify VSCO Schedule section in the UI shows a map pin

## Implementation tasks (high level — full plan in next doc)

1. Add `GOOGLE_PLACES_API_KEY` to `.env.example` (user sets on Coolify)
2. Build server proxy routes (autocomplete + details) with tests
3. Build `VenueAutocomplete.astro` (vanilla version)
4. Wire it into `/contact` form
5. Build React version + wire into builder
6. Build intake version + wire into booth
7. SQLite migration + schema updates
8. Update `insertInquiry()` to accept new fields
9. Update VSCO mapping (Location.mailingAddress + Event.location.address)
10. Admin UI: show structured address + "View on map" link
11. Deploy + live smoke test
12. After verification: user enables New Places API + rotates API key + sets in Coolify

## YAGNI rejections

- **Phone, website, photos** for venues: VSCO fetches its own; we don't need them
- **place_id storage**: useful for future analytics, not needed today
- **Manual address entry mode** as a separate UI: free-text fallback already covers users who don't want to use autocomplete
- **Reverse geocode** when user types lat/lng manually: nobody types lat/lng
- **Distance-from-studio calculation**: scope creep
- **"Recently used venues" suggestions**: cool but premature
- **Backfilling historical inquiries with addresses**: separate one-off effort if ever wanted
