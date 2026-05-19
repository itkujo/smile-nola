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
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(init?.method).toBe('POST')
        const headers = new Headers(init?.headers)
        expect(headers.get('X-Goog-Api-Key')).toBe('TEST_KEY')
        expect(headers.get('X-Goog-FieldMask')).toContain(
          'suggestions.placePrediction',
        )
        const body = JSON.parse(init?.body as string)
        expect(body.input).toBe('Saenger')
        return new Response(
          JSON.stringify({
            suggestions: [
              {
                placePrediction: {
                  placeId: 'PLACE_1',
                  text: {
                    text: 'Saenger Theatre, Canal Street, New Orleans, LA, USA',
                  },
                  structuredFormat: {
                    mainText: { text: 'Saenger Theatre' },
                    secondaryText: {
                      text: 'Canal Street, New Orleans, LA, USA',
                    },
                  },
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      },
    )
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
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'denied' } }), {
          status: 403,
        }),
    ) as any
    const res = await GET({ request: makeReq('q=Foo') } as any)
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toMatch(/search unavailable/i)
  })

  it('returns 502 on fetch network error', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNRESET')
    }) as any
    const res = await GET({ request: makeReq('q=Foo') } as any)
    expect(res.status).toBe(502)
  })

  it('returns empty suggestions array when Google returns 200 with no suggestions', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({}), { status: 200 }),
    ) as any
    const res = await GET({ request: makeReq('q=zzzzz') } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.suggestions).toEqual([])
  })

  it('includes CORS Access-Control-Allow-Origin header on success', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ suggestions: [] }), { status: 200 }),
    ) as any
    const res = await GET({ request: makeReq('q=Foo') } as any)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})
