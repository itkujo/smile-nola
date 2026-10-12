import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOperations } from "../index";
import { RateLimiter } from "../ratelimit";
import { _setTokenDb, createToken } from "../tokens";
import { freshDb, makeRouter, req } from "./helpers";

describe("RateLimiter", () => {
  it("counts per key, reports remaining and reset, and blocks past the limit", () => {
    const rl = new RateLimiter(3, 60_000);
    const t = 1_000_000;
    expect(rl.consume("a", t)).toMatchObject({ allowed: true, remaining: 2, reset: 60 });
    rl.consume("a", t);
    expect(rl.consume("a", t + 30_000)).toMatchObject({ allowed: true, remaining: 0, reset: 30 });
    expect(rl.consume("a", t + 30_000).allowed).toBe(false);
    expect(rl.consume("b", t + 30_000).allowed).toBe(true);
    expect(rl.consume("a", t + 60_000)).toMatchObject({ allowed: true, remaining: 2 });
  });
});

describe("router rate limiting", () => {
  beforeEach(() => {
    freshDb();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    _setTokenDb(null);
  });

  it("120 a minute per address; the 121st is 429 rate_limited with Retry-After", async () => {
    const handle = makeRouter(getOperations(), new RateLimiter());
    let last: Response | undefined;
    for (let i = 0; i < 120; i++) last = await handle(req("/public/brand"), { clientAddress: "1.2.3.4" });
    expect(last!.status).toBe(200);
    expect(last!.headers.get("ratelimit-remaining")).toBe("0");

    const blocked = await handle(req("/public/brand"), { clientAddress: "1.2.3.4" });
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error.code).toBe("rate_limited");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(blocked.headers.get("ratelimit-limit")).toBe("120");
    expect(blocked.headers.get("x-request-id")).toBeTruthy();

    // Another address is unaffected.
    const other = await handle(req("/public/brand"), { clientAddress: "5.6.7.8" });
    expect(other.status).toBe(200);

    vi.advanceTimersByTime(60_000);
    const again = await handle(req("/public/brand"), { clientAddress: "1.2.3.4" });
    expect(again.status).toBe(200);
  });

  it("counts per token, not per address, when a token is sent", async () => {
    const handle = makeRouter(getOperations(), new RateLimiter(2, 60_000));
    const a = createToken({ label: "a", scopes: ["admin"] }).token;
    const b = createToken({ label: "b", scopes: ["admin"] }).token;
    await handle(req("/me", { token: a }), { clientAddress: "9.9.9.9" });
    await handle(req("/me", { token: a }), { clientAddress: "9.9.9.9" });
    expect((await handle(req("/me", { token: a }), { clientAddress: "9.9.9.9" })).status).toBe(429);
    expect((await handle(req("/me", { token: b }), { clientAddress: "9.9.9.9" })).status).toBe(200);
  });
});
