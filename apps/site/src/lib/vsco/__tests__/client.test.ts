/**
 * Tests for the VSCO Workspace API client.
 *
 * The client wraps `fetch` and adds:
 *  - X-API-KEY header auth
 *  - JSON encode/decode
 *  - 429 retry honoring Retry-After (seconds or HTTP date)
 *  - Exponential backoff for non-429 transient errors (none for now — we
 *    only retry 429 per spec; other 5xx surface to the caller and the push
 *    layer logs them)
 *  - Typed errors (`VscoError` with status + body)
 *
 * We inject `fetch` so tests run hermetically — no real network calls.
 */

import { describe, it, expect, vi } from 'vitest';
import { VscoClient, VscoError } from '../client';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

describe('VscoClient', () => {
  describe('happy path', () => {
    it('GETs with X-API-KEY header and parses JSON response', async () => {
      const fakeFetch = vi.fn().mockResolvedValue(jsonResponse({ id: 'abc' }));
      const c = new VscoClient({
        apiKey: 'k1',
        baseUrl: 'https://api.test',
        fetch: fakeFetch,
      });

      const result = await c.get<{ id: string }>('/job/abc');

      expect(result).toEqual({ id: 'abc' });
      expect(fakeFetch).toHaveBeenCalledTimes(1);
      const [url, init] = fakeFetch.mock.calls[0];
      expect(url).toBe('https://api.test/job/abc');
      expect(init.method).toBe('GET');
      expect((init.headers as Record<string, string>)['X-API-KEY']).toBe('k1');
      expect((init.headers as Record<string, string>).accept).toBe('application/json');
      expect(init.body).toBeUndefined();
    });

    it('POSTs with JSON body and content-type header', async () => {
      const fakeFetch = vi.fn().mockResolvedValue(jsonResponse({ id: '1' }, { status: 201 }));
      const c = new VscoClient({ apiKey: 'k', baseUrl: 'https://api.test', fetch: fakeFetch });

      await c.post('/job', { name: 'Test Job', stage: 'lead' });

      const [, init] = fakeFetch.mock.calls[0];
      expect(init.method).toBe('POST');
      expect(init.body).toBe(JSON.stringify({ name: 'Test Job', stage: 'lead' }));
      expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    });

    it('PUTs with JSON body', async () => {
      const fakeFetch = vi.fn().mockResolvedValue(jsonResponse({ id: '1' }));
      const c = new VscoClient({ apiKey: 'k', baseUrl: 'https://api.test', fetch: fakeFetch });

      await c.put('/job/1', { stage: 'booked' });

      const [, init] = fakeFetch.mock.calls[0];
      expect(init.method).toBe('PUT');
      expect(init.body).toBe(JSON.stringify({ stage: 'booked' }));
    });

    it('trims trailing slash from baseUrl', async () => {
      const fakeFetch = vi.fn().mockResolvedValue(jsonResponse({}));
      const c = new VscoClient({ apiKey: 'k', baseUrl: 'https://api.test/', fetch: fakeFetch });

      await c.get('/job/1');

      expect(fakeFetch.mock.calls[0][0]).toBe('https://api.test/job/1');
    });

    it('returns undefined for 204 No Content responses', async () => {
      const fakeFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      const c = new VscoClient({ apiKey: 'k', baseUrl: 'https://api.test', fetch: fakeFetch });

      const result = await c.get('/some-resource/1');

      expect(result).toBeUndefined();
    });
  });

  describe('429 rate-limit retry', () => {
    it('retries after Retry-After seconds and returns the eventual success', async () => {
      const fakeFetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response('', { status: 429, headers: { 'retry-after': '0' } }),
        )
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const c = new VscoClient({
        apiKey: 'k',
        baseUrl: 'https://api.test',
        fetch: fakeFetch,
        retryBaseMs: 0,
      });

      const result = await c.get<{ ok: boolean }>('/x');

      expect(result).toEqual({ ok: true });
      expect(fakeFetch).toHaveBeenCalledTimes(2);
    });

    it('honors Retry-After expressed as an HTTP date', async () => {
      // Date one second in the past — sleeps for ~0ms.
      const past = new Date(Date.now() - 1000).toUTCString();
      const fakeFetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response('', { status: 429, headers: { 'retry-after': past } }),
        )
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const c = new VscoClient({
        apiKey: 'k',
        baseUrl: 'https://api.test',
        fetch: fakeFetch,
        retryBaseMs: 0,
      });

      const result = await c.get<{ ok: boolean }>('/x');

      expect(result).toEqual({ ok: true });
      expect(fakeFetch).toHaveBeenCalledTimes(2);
    });

    it('falls back to exponential backoff when Retry-After is missing', async () => {
      const fakeFetch = vi
        .fn()
        .mockResolvedValueOnce(new Response('', { status: 429 }))
        .mockResolvedValueOnce(new Response('', { status: 429 }))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const c = new VscoClient({
        apiKey: 'k',
        baseUrl: 'https://api.test',
        fetch: fakeFetch,
        retryBaseMs: 0,
      });

      const result = await c.get<{ ok: boolean }>('/x');

      expect(result).toEqual({ ok: true });
      expect(fakeFetch).toHaveBeenCalledTimes(3);
    });

    it('gives up after maxRetries and throws VscoError(429)', async () => {
      const fakeFetch = vi
        .fn()
        .mockResolvedValue(new Response('', { status: 429 }));

      const c = new VscoClient({
        apiKey: 'k',
        baseUrl: 'https://api.test',
        fetch: fakeFetch,
        retryBaseMs: 0,
        maxRetries: 2,
      });

      await expect(c.get('/x')).rejects.toMatchObject({
        name: 'VscoError',
        status: 429,
      });
      // 1 initial + 2 retries = 3 attempts
      expect(fakeFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('non-success responses', () => {
    it('throws VscoError with the parsed body on 4xx', async () => {
      const fakeFetch = vi
        .fn()
        .mockResolvedValue(jsonResponse({ title: 'Validation failed', detail: 'name is required' }, { status: 400 }));

      const c = new VscoClient({ apiKey: 'k', baseUrl: 'https://api.test', fetch: fakeFetch });

      await expect(c.get('/x')).rejects.toMatchObject({
        name: 'VscoError',
        status: 400,
        body: { title: 'Validation failed', detail: 'name is required' },
      });
    });

    it('throws VscoError even when the error body is not JSON', async () => {
      const fakeFetch = vi
        .fn()
        .mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }));

      const c = new VscoClient({ apiKey: 'k', baseUrl: 'https://api.test', fetch: fakeFetch });

      const err = await c.get('/x').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(VscoError);
      expect((err as VscoError).status).toBe(502);
      // Body is undefined when parse fails — caller can rely on this.
      expect((err as VscoError).body).toBeUndefined();
    });

    it('error message includes method, path, and status code', async () => {
      const fakeFetch = vi
        .fn()
        .mockResolvedValue(jsonResponse({}, { status: 404 }));

      const c = new VscoClient({ apiKey: 'k', baseUrl: 'https://api.test', fetch: fakeFetch });

      await expect(c.post('/job', {})).rejects.toThrow(/POST.*\/job.*404/);
    });
  });

  describe('URL construction', () => {
    it('handles paths with leading slash', async () => {
      const fakeFetch = vi.fn().mockResolvedValue(jsonResponse({}));
      const c = new VscoClient({ apiKey: 'k', baseUrl: 'https://api.test', fetch: fakeFetch });

      await c.get('/job/123');

      expect(fakeFetch.mock.calls[0][0]).toBe('https://api.test/job/123');
    });

    it('handles paths without leading slash', async () => {
      const fakeFetch = vi.fn().mockResolvedValue(jsonResponse({}));
      const c = new VscoClient({ apiKey: 'k', baseUrl: 'https://api.test', fetch: fakeFetch });

      await c.get('job/123');

      expect(fakeFetch.mock.calls[0][0]).toBe('https://api.test/job/123');
    });

    it('supports query strings in the path', async () => {
      const fakeFetch = vi.fn().mockResolvedValue(jsonResponse({}));
      const c = new VscoClient({ apiKey: 'k', baseUrl: 'https://api.test', fetch: fakeFetch });

      await c.get('/job?externalMappingId=uuid-abc&pageSize=10');

      expect(fakeFetch.mock.calls[0][0]).toBe('https://api.test/job?externalMappingId=uuid-abc&pageSize=10');
    });
  });
});
