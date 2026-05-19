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
      `[places/autocomplete] Google returned ${upstream.status}: ${text.slice(
        0,
        200,
      )}`,
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
      mainText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
      secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
    }))

  return jsonResponse(200, { suggestions })
}
