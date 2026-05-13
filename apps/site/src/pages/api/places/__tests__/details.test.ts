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
            {
              longText: 'Canal Street',
              shortText: 'Canal St',
              types: ['route'],
            },
            {
              longText: 'New Orleans',
              shortText: 'New Orleans',
              types: ['locality'],
            },
            {
              longText: 'Louisiana',
              shortText: 'LA',
              types: ['administrative_area_level_1'],
            },
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
    globalThis.fetch = vi.fn(
      async () =>
        new Response('{"error": {"status": "NOT_FOUND"}}', { status: 404 }),
    ) as any
    const res = await GET({ request: makeReq('id=ChIJ_unknown') } as any)
    expect(res.status).toBe(502)
  })

  it('includes CORS Access-Control-Allow-Origin header on success', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'ChIJ_test',
            displayName: { text: 'X' },
            formattedAddress: '',
            addressComponents: [],
            location: { latitude: 0, longitude: 0 },
          }),
          { status: 200 },
        ),
    ) as any
    const res = await GET({ request: makeReq('id=ChIJ_test') } as any)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})
