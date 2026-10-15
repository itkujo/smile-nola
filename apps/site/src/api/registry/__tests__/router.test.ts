import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineOperation } from "../define";
import { ApiError, ERROR_CODES, ErrorBodySchema, conflict, unavailable } from "../errors";
import { getOperations } from "../index";
import { RateLimiter } from "../ratelimit";
import { _setTokenDb, createToken, getToken } from "../tokens";
import { freshDb, jsonReq, makeRouter, req, sessionCookie } from "./helpers";

async function errorOf(res: Response) {
  const body = await res.json();
  expect(ErrorBodySchema.safeParse(body).success).toBe(true);
  return body.error as { code: string; message: string };
}

// Test-only operations that exercise every error path.
const echo = defineOperation({
  id: "test_echo",
  summary: "Echo",
  tag: "test",
  method: "POST",
  path: "/test/echo/{id}",
  scope: "write:inquiries",
  input: z.object({ id: z.coerce.number().int(), name: z.string().min(1), flag: z.string().optional() }),
  output: z.object({ id: z.number(), name: z.string(), flag: z.string().nullable() }),
  handler: ({ input }) => ({ id: input.id, name: input.name, flag: input.flag ?? null }),
});
const readInq = defineOperation({
  id: "test_read",
  summary: "Read",
  tag: "test",
  method: "GET",
  path: "/test/echo/{id}",
  scope: "read:inquiries",
  input: z.object({ id: z.string() }),
  output: z.object({ id: z.string() }),
  handler: ({ input }) => ({ id: input.id }),
});
const specific = defineOperation({
  id: "test_specific",
  summary: "Specific",
  tag: "test",
  method: "GET",
  path: "/test/echo/special",
  scope: null,
  input: z.object({}),
  output: z.object({ special: z.literal(true) }),
  handler: () => ({ special: true as const }),
});
const boom = defineOperation({
  id: "test_boom",
  summary: "Boom",
  tag: "test",
  method: "GET",
  path: "/test/boom",
  scope: null,
  input: z.object({ kind: z.string().optional() }),
  output: z.object({ ok: z.boolean() }),
  handler: ({ input }) => {
    if (input.kind === "conflict") throw conflict("Not in a state that allows this.");
    if (input.kind === "unavailable") throw unavailable("Upstream is down.");
    if (input.kind === "badout") return { ok: "nope" } as unknown as { ok: boolean };
    throw new Error("kaboom");
  },
});

const ops = [...getOperations(), echo, readInq, specific, boom];

describe("/api/v1 router", () => {
  let warn: ReturnType<typeof vi.fn>;
  let error: ReturnType<typeof vi.fn>;
  let handle: ReturnType<typeof makeRouter>;

  beforeEach(() => {
    freshDb();
    warn = vi.fn();
    error = vi.fn();
    handle = makeRouter(ops, new RateLimiter(), { warn, error });
  });
  afterEach(() => _setTokenDb(null));

  it("dispatches a public op and stamps X-Request-Id and rate headers", async () => {
    const res = await handle(req("/public/brand"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Smile NOLA", tagline: expect.any(String) });
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get("ratelimit-limit")).toBe("120");
    expect(res.headers.get("ratelimit-remaining")).toBe("119");
    expect(Number(res.headers.get("ratelimit-reset"))).toBeGreaterThan(0);
  });

  it("serves the OpenAPI document with no token", async () => {
    const res = await handle(req("/openapi.json"));
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.servers[0].url).toBe("http://localhost:4321/api/v1");
  });

  it("unknown path -> 404 not_found, logged with the request id", async () => {
    const res = await handle(req("/nope"));
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("not_found");
    const id = res.headers.get("x-request-id");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(id!));
  });

  it("known path, wrong method -> 405 method_not_allowed with Allow", async () => {
    const res = await handle(req("/me/tokens", { method: "PUT" }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, POST");
    expect((await errorOf(res)).code).toBe("method_not_allowed");
  });

  it("prefers the most specific path template", async () => {
    const res = await handle(req("/test/echo/special"));
    expect(await res.json()).toEqual({ special: true });
  });

  it("no credential on a scoped op -> 401 unauthorized", async () => {
    const res = await handle(req("/me"));
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe("unauthorized");
  });

  it("malformed Authorization or unknown token -> 401 unauthorized", async () => {
    const a = await handle(req("/me", { headers: { authorization: "Basic abc" } }));
    expect((await errorOf(a)).code).toBe("unauthorized");
    const b = await handle(req("/me", { token: "sn_doesnotexist" }));
    expect(b.status).toBe(401);
    expect((await errorOf(b)).code).toBe("unauthorized");
  });

  it("bearer token authenticates, and last_used_at is recorded", async () => {
    const { token, record } = createToken({ label: "script", scopes: ["read:inquiries"] });
    expect(token.startsWith("sn_")).toBe(true);
    const res = await handle(req("/me", { token }));
    expect(res.status).toBe(200);
    const me = await res.json();
    expect(me).toMatchObject({ via: "token", scopes: ["read:inquiries"], token: { id: record.id, label: "script" } });
    expect(getToken(record.id)?.lastUsedAt).not.toBeNull();
  });

  it("session cookie authenticates and acts as every scope", async () => {
    const res = await handle(req("/me", { cookie: sessionCookie() }));
    expect(res.status).toBe(200);
    const me = await res.json();
    expect(me.via).toBe("session");
    expect(me.scopes).toContain("admin");
    expect(me.scopes).toContain("write:settings");
  });

  it("expired token -> 401 token_expired", async () => {
    const { token } = createToken({ label: "old", scopes: ["admin"], expiresAt: "2020-01-01T00:00:00.000Z" });
    const res = await handle(req("/me", { token }));
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe("token_expired");
  });

  it("revoked token -> 401 unauthorized", async () => {
    const cookie = sessionCookie();
    const { token, record } = createToken({ label: "x", scopes: ["admin"] });
    const del = await handle(req(`/me/tokens/${record.id}`, { method: "DELETE", cookie }));
    expect(del.status).toBe(200);
    expect((await del.json()).revokedAt).not.toBeNull();
    const res = await handle(req("/me", { token }));
    expect((await errorOf(res)).code).toBe("unauthorized");
  });

  it("missing scope -> 403 insufficient_scope naming it; write includes read", async () => {
    const { token: readOnly } = createToken({ label: "r", scopes: ["read:inquiries"] });
    const res = await handle(jsonReq("/test/echo/1", "POST", { name: "a" }, { token: readOnly }));
    expect(res.status).toBe(403);
    const err = await errorOf(res);
    expect(err.code).toBe("insufficient_scope");
    expect(err.message).toContain("write:inquiries");

    const { token: writer } = createToken({ label: "w", scopes: ["write:inquiries"] });
    const ok = await handle(req("/test/echo/7", { token: writer }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ id: "7" });
  });

  it("cross-site signed-in write -> 403 forbidden", async () => {
    const res = await handle(
      req("/me/tokens/1", { method: "DELETE", cookie: sessionCookie(), headers: { "sec-fetch-site": "cross-site" } }),
    );
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe("forbidden");
  });

  it("validation failure -> 400 bad_request naming the field", async () => {
    const { token } = createToken({ label: "w", scopes: ["write:inquiries"] });
    const res = await handle(jsonReq("/test/echo/1", "POST", { name: "" }, { token }));
    expect(res.status).toBe(400);
    const err = await errorOf(res);
    expect(err.code).toBe("bad_request");
    expect(err.message).toMatch(/^name:/);

    const badJson = await handle(
      req("/test/echo/1", { method: "POST", token, body: "{nope", headers: { "content-type": "application/json" } }),
    );
    expect((await errorOf(badJson)).message).toMatch(/^body:/);
  });

  it("assembles input from path params, query and body", async () => {
    const { token } = createToken({ label: "w", scopes: ["write:inquiries"] });
    const res = await handle(jsonReq("/test/echo/42?flag=yes", "POST", { name: "Ann" }, { token }));
    expect(await res.json()).toEqual({ id: 42, name: "Ann", flag: "yes" });
  });

  it("non-JSON body on a body-taking op -> 415 unsupported_media_type", async () => {
    const res = await handle(
      req("/me/tokens", {
        method: "POST",
        cookie: sessionCookie(),
        body: "label=x",
        headers: { "content-type": "text/plain" },
      }),
    );
    expect(res.status).toBe(415);
    expect((await errorOf(res)).code).toBe("unsupported_media_type");
  });

  it("conflict and unavailable map to 409 and 503", async () => {
    const c = await handle(req("/test/boom?kind=conflict"));
    expect(c.status).toBe(409);
    expect((await errorOf(c)).code).toBe("conflict");
    const u = await handle(req("/test/boom?kind=unavailable"));
    expect(u.status).toBe(503);
    expect((await errorOf(u)).code).toBe("unavailable");
  });

  it("a thrown bug -> 500 internal_error quoting the request id, logged as error", async () => {
    const res = await handle(req("/test/boom"));
    expect(res.status).toBe(500);
    const err = await errorOf(res);
    expect(err.code).toBe("internal_error");
    const id = res.headers.get("x-request-id")!;
    expect(err.message).toContain(id);
    expect(err.message).not.toContain("kaboom");
    expect(error).toHaveBeenCalledWith(expect.stringContaining(id), expect.any(Error));
  });

  it("an answer outside the output schema -> 500 internal_error", async () => {
    const res = await handle(req("/test/boom?kind=badout"));
    expect(res.status).toBe(500);
  });

  it("every error code has a status and is reachable through ApiError", () => {
    for (const [code, { status }] of Object.entries(ERROR_CODES)) {
      const e = new ApiError(code as keyof typeof ERROR_CODES, "m");
      expect(e.status).toBe(status);
      expect(ErrorBodySchema.parse(e.toBody())).toEqual({ error: { code, message: "m" } });
    }
  });
});

describe("token management ops", () => {
  let handle: ReturnType<typeof makeRouter>;
  beforeEach(() => {
    freshDb();
    handle = makeRouter(getOperations());
  });
  afterEach(() => _setTokenDb(null));

  it("creates a token shown once, then lists without it", async () => {
    const cookie = sessionCookie();
    const res = await handle(
      jsonReq("/me/tokens", "POST", { label: "Zapier", scopes: ["read:inquiries", "admin"] }, { cookie }),
    );
    expect(res.status).toBe(201);
    const made = await res.json();
    expect(made.token).toMatch(/^sn_[A-Za-z0-9_-]{43}$/);
    expect(made.scopes).toEqual(["read:inquiries", "admin"]);

    // The new token works and can itself manage tokens (admin scope).
    const list = await handle(req("/me/tokens", { token: made.token }));
    expect(list.status).toBe(200);
    const page = await list.json();
    expect(page.data).toHaveLength(1);
    expect(page.data[0].token).toBeUndefined();
    expect(page.nextCursor).toBeNull();
  });

  it("rejects unknown scopes, empty labels, past expiry", async () => {
    const cookie = sessionCookie();
    const a = await handle(jsonReq("/me/tokens", "POST", { label: "x", scopes: ["read:nope"] }, { cookie }));
    expect((await a.json()).error.message).toMatch(/^scopes\.0: unknown scope/);
    const b = await handle(jsonReq("/me/tokens", "POST", { label: " ", scopes: ["admin"] }, { cookie }));
    expect((await b.json()).error.message).toMatch(/^label:/);
    const c = await handle(
      jsonReq("/me/tokens", "POST", { label: "x", scopes: ["admin"], expiresAt: "2001-01-01T00:00:00Z" }, { cookie }),
    );
    expect((await c.json()).error.message).toMatch(/^expiresAt:/);
  });

  it("revoke: 404 for unknown id, 409 when already revoked, 400 for a bad id", async () => {
    const cookie = sessionCookie();
    const { record } = createToken({ label: "x", scopes: ["admin"] });
    expect((await handle(req("/me/tokens/999", { method: "DELETE", cookie }))).status).toBe(404);
    expect((await handle(req(`/me/tokens/${record.id}`, { method: "DELETE", cookie }))).status).toBe(200);
    const again = await handle(req(`/me/tokens/${record.id}`, { method: "DELETE", cookie }));
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("conflict");
    const bad = await handle(req("/me/tokens/abc", { method: "DELETE", cookie }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.message).toMatch(/^id:/);
  });

  it("pages the token list with limit and cursor", async () => {
    const cookie = sessionCookie();
    for (let i = 0; i < 5; i++) createToken({ label: `t${i}`, scopes: ["admin"] });
    const p1 = await (await handle(req("/me/tokens?limit=2", { cookie }))).json();
    expect(p1.data.map((t: { label: string }) => t.label)).toEqual(["t4", "t3"]);
    expect(p1.nextCursor).toEqual(expect.any(String));
    const p2 = await (await handle(req(`/me/tokens?limit=2&cursor=${p1.nextCursor}`, { cookie }))).json();
    expect(p2.data.map((t: { label: string }) => t.label)).toEqual(["t2", "t1"]);
    const p3 = await (await handle(req(`/me/tokens?limit=2&cursor=${p2.nextCursor}`, { cookie }))).json();
    expect(p3.data.map((t: { label: string }) => t.label)).toEqual(["t0"]);
    expect(p3.nextCursor).toBeNull();

    const over = await handle(req("/me/tokens?limit=101", { cookie }));
    expect((await over.json()).error.message).toMatch(/^limit:/);
    const junk = await handle(req("/me/tokens?cursor=!!!", { cookie }));
    expect((await junk.json()).error.message).toMatch(/^cursor:/);
  });
});
