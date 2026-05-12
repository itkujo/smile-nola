import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loginRateLimit, rateLimit, resetRateLimit } from "./auth";

describe("rateLimit (generic)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to max within the window and blocks the next", () => {
    const ip = "10.0.0.1";
    const opts = { windowMs: 60_000, max: 3 };
    expect(rateLimit("test-a", ip, opts).allowed).toBe(true);
    expect(rateLimit("test-a", ip, opts).allowed).toBe(true);
    const third = rateLimit("test-a", ip, opts);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const blocked = rateLimit("test-a", ip, opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("isolates buckets — exhausting one does not affect another", () => {
    const ip = "10.0.0.2";
    const opts = { windowMs: 60_000, max: 1 };
    expect(rateLimit("bucket-a", ip, opts).allowed).toBe(true);
    expect(rateLimit("bucket-a", ip, opts).allowed).toBe(false);
    // Different bucket key — still fresh.
    expect(rateLimit("bucket-b", ip, opts).allowed).toBe(true);
  });

  it("isolates IPs within the same bucket", () => {
    const opts = { windowMs: 60_000, max: 1 };
    expect(rateLimit("bucket-c", "10.0.0.3", opts).allowed).toBe(true);
    expect(rateLimit("bucket-c", "10.0.0.3", opts).allowed).toBe(false);
    expect(rateLimit("bucket-c", "10.0.0.4", opts).allowed).toBe(true);
  });

  it("resets after the window elapses", () => {
    const ip = "10.0.0.5";
    const opts = { windowMs: 60_000, max: 1 };
    expect(rateLimit("bucket-d", ip, opts).allowed).toBe(true);
    expect(rateLimit("bucket-d", ip, opts).allowed).toBe(false);

    vi.advanceTimersByTime(61_000);
    expect(rateLimit("bucket-d", ip, opts).allowed).toBe(true);
  });
});

describe("loginRateLimit (wrapper, unchanged API)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("still allows 5 attempts per 5-minute window per IP", () => {
    const ip = "10.0.1.1";
    for (let i = 0; i < 5; i++) {
      expect(loginRateLimit(ip).allowed).toBe(true);
    }
    expect(loginRateLimit(ip).allowed).toBe(false);
  });

  it("login bucket is isolated from the builder bucket", () => {
    const ip = "10.0.1.2";
    // Exhaust the login bucket.
    for (let i = 0; i < 5; i++) loginRateLimit(ip);
    expect(loginRateLimit(ip).allowed).toBe(false);
    // The builder bucket on the same IP is unaffected.
    const r = rateLimit("builder-submit", ip, { windowMs: 600_000, max: 5 });
    expect(r.allowed).toBe(true);
  });

  it("resetRateLimit clears the login bucket only", () => {
    const ip = "10.0.1.3";
    for (let i = 0; i < 5; i++) loginRateLimit(ip);
    expect(loginRateLimit(ip).allowed).toBe(false);
    resetRateLimit(ip);
    expect(loginRateLimit(ip).allowed).toBe(true);
  });
});
