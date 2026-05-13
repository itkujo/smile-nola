/**
 * VSCO Workspace (Táve) API client.
 *
 * Thin wrapper around `fetch` providing:
 *  - X-API-KEY header authentication
 *  - JSON encode/decode
 *  - 429 retry honoring Retry-After (seconds or HTTP date)
 *  - Exponential backoff fallback when Retry-After is missing
 *  - Typed `VscoError` with status and parsed body for non-2xx responses
 *
 * Design notes:
 *  - `fetch` is injectable to keep tests hermetic.
 *  - We only retry 429. Other 5xx surface to the caller; the push layer's
 *    job is to log them — fire-and-forget should never block form responses.
 *  - There is no Idempotency-Key header in the spec, so dedupe is the
 *    caller's responsibility (we use `externalMappings` on Jobs/Contacts).
 *  - The client is stateless except for the constructor options; safe to
 *    keep a single instance per process.
 *
 * Usage:
 *   const c = new VscoClient({ apiKey: process.env.VSCO_API_KEY!, baseUrl });
 *   const job = await c.get<JobRead>('/job/01h35...');
 *   const created = await c.post<JobWorksheetResponse>('/job/-/worksheet', body);
 */

import type { VscoErrorBody } from './types';

export interface VscoClientOptions {
  /** Per-Studio API key from https://workspace.vsco.co/settings/api */
  apiKey: string;
  /** Server base URL, no trailing slash required. */
  baseUrl: string;
  /** Injectable fetch — defaults to global `fetch`. Useful for testing. */
  fetch?: typeof fetch;
  /** Max number of retry attempts AFTER the initial request. Defaults to 5. */
  maxRetries?: number;
  /**
   * Base for exponential-backoff sleep when Retry-After is absent.
   * Sleep on attempt N is `retryBaseMs * 2^N` (0-indexed).
   * Tests set this to 0 to keep them fast.
   */
  retryBaseMs?: number;
}

/**
 * Thrown for any non-2xx response (after exhausting 429 retries).
 *
 * `body` is the parsed JSON error body when present, otherwise `undefined`.
 * VSCO's error responses follow an RFC 7807-ish shape (see `VscoErrorBody`).
 */
export class VscoError extends Error {
  public readonly status: number;
  public readonly body: VscoErrorBody | undefined;

  constructor(status: number, body: VscoErrorBody | undefined, message: string) {
    super(message);
    this.name = 'VscoError';
    this.status = status;
    this.body = body;
  }
}

export class VscoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(opts: VscoClientOptions) {
    if (!opts.apiKey) {
      throw new Error('VscoClient: apiKey is required');
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.maxRetries = opts.maxRetries ?? 5;
    this.retryBaseMs = opts.retryBaseMs ?? 500;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = this.urlFor(path);
    const headers: Record<string, string> = {
      'X-API-KEY': this.apiKey,
      accept: 'application/json',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';

    const init: RequestInit = {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    };

    let attempt = 0;
    while (true) {
      const res = await this.fetchImpl(url, init);

      // 429: rate limited — retry honoring Retry-After or exponential backoff.
      if (res.status === 429 && attempt < this.maxRetries) {
        const retryAfterMs =
          parseRetryAfter(res.headers.get('retry-after')) ??
          this.retryBaseMs * Math.pow(2, attempt);
        await sleep(retryAfterMs);
        attempt++;
        continue;
      }

      // Any non-2xx response (including 429 after exhausting retries) is an error.
      if (!res.ok) {
        const errBody = await parseJsonSafe<VscoErrorBody>(res);
        throw new VscoError(
          res.status,
          errBody,
          `VSCO ${method} ${path} → ${res.status}`,
        );
      }

      // 204 No Content — return undefined.
      if (res.status === 204) {
        return undefined as T;
      }

      // 2xx with JSON body.
      return (await res.json()) as T;
    }
  }

  private urlFor(path: string): string {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${normalized}`;
  }
}

/**
 * Parse the `Retry-After` header per RFC 7231 §7.1.3.
 * Returns milliseconds to sleep, or null if the header is missing/unparseable.
 *
 * The header may be:
 *  - A non-negative integer (seconds)
 *  - An HTTP-date (RFC 1123 timestamp)
 */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;

  const trimmed = header.trim();
  if (trimmed === '') return null;

  // Integer seconds — must be entirely numeric to avoid Date.parse picking
  // up bare numbers as dates.
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Math.max(0, seconds * 1000);
  }

  // HTTP-date.
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse a response body as JSON, returning undefined on any failure.
 * Used for error bodies where we don't want a parse failure to mask the
 * underlying HTTP error.
 */
async function parseJsonSafe<T>(res: Response): Promise<T | undefined> {
  try {
    const text = await res.text();
    if (!text) return undefined;
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}
