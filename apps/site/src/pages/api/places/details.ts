import type { APIRoute } from 'astro'
import { parsePlace, type RawPlace } from '@/lib/places'

export const prerender = false

const GOOGLE_BASE = 'https://places.googleapis.com/v1/places/'

const FIELD_MASK = 'id,displayName,formattedAddress,addressComponents,location'

// Place IDs are ASCII identifiers (letters, digits, underscore, hyphen).
// Anything else is suspicious and indicates someone is trying to inject
// junk into the URL path.
const PLACE_ID_RE = /^[A-Za-z0-9_\-]+$/

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
} as const

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...CORS_HEADERS,
    },
  })
}

export const OPTIONS: APIRoute = () =>
  new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    },
  })

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
