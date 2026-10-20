/**
 * Fixed-window rate limit for /api/v1: 120 requests a minute per token, or
 * per address when the caller has no token. In memory, so counters reset
 * when the server restarts.
 *
 * Every counted answer carries RateLimit-Limit, RateLimit-Remaining and
 * RateLimit-Reset (seconds until the window resets); a 429 adds Retry-After.
 */

export const API_RATE_LIMIT = 120;
export const API_RATE_WINDOW_MS = 60_000;

export interface RateDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets (>= 1). */
  reset: number;
}

interface Window {
  start: number;
  count: number;
}

export class RateLimiter {
  private windows = new Map<string, Window>();
  private lastSweep = 0;

  constructor(
    readonly limit: number = API_RATE_LIMIT,
    readonly windowMs: number = API_RATE_WINDOW_MS,
  ) {}

  consume(key: string, now = Date.now()): RateDecision {
    this.sweep(now);
    let w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      w = { start: now, count: 0 };
      this.windows.set(key, w);
    }
    w.count += 1;
    const reset = Math.max(1, Math.ceil((w.start + this.windowMs - now) / 1000));
    return {
      allowed: w.count <= this.limit,
      limit: this.limit,
      remaining: Math.max(0, this.limit - w.count),
      reset,
    };
  }

  reset(): void {
    this.windows.clear();
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [k, w] of this.windows) {
      if (now - w.start >= this.windowMs) this.windows.delete(k);
    }
  }
}

export function rateLimitHeaders(d: RateDecision): Record<string, string> {
  return {
    "RateLimit-Limit": String(d.limit),
    "RateLimit-Remaining": String(d.remaining),
    "RateLimit-Reset": String(d.reset),
  };
}

/** The limiter the live router uses. */
export const apiRateLimiter = new RateLimiter();
