import "@/api/v1/__tests__/site-env";
import { beforeEach, describe, expect, it } from "vitest";
import { getOperations } from "@/api/registry/index";
import { createToken } from "@/api/registry/tokens";
import { freshDb } from "@/api/registry/__tests__/helpers";
import { RateLimiter } from "@/api/registry/ratelimit";
import { _setBoothDb } from "@/lib/booth/store";
import { createMcpHandler } from "../server";

const URL_ = "http://localhost:4321/api/v1/mcp";
const silent = { warn: () => {}, error: () => {} };
let handler: ReturnType<typeof createMcpHandler>;
let readTok: string;
let writeTok: string;

beforeEach(() => {
  const db = freshDb();
  _setBoothDb(db);
  handler = createMcpHandler({ operations: getOperations(), limiter: new RateLimiter(10_000), logger: silent });
  readTok = createToken({ label: "r", scopes: ["read:inquiries"], expiresAt: null }).token;
  writeTok = createToken({ label: "w", scopes: ["write:inquiries", "read:booth"], expiresAt: null }).token;
});

function rpc(body: unknown, token?: string, extra: Record<string, string> = {}) {
  return handler(
    new Request(URL_, {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...extra,
      },
    }),
  );
}
const call = (method: string, params?: unknown, id = 1) => ({ jsonrpc: "2.0", id, method, params });

describe("mcp transport", () => {
  it("answers GET with 405 in the API error shape", async () => {
    const res = await handler(new Request(URL_, { method: "GET", headers: { authorization: `Bearer ${readTok}` } }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect((await res.json()).error.code).toBe("method_not_allowed");
  });

  it("answers an unauthenticated call with 401 { error }", async () => {
    const res = await rpc(call("tools/list"));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
    const bad = await rpc(call("tools/list"), "sn_nope");
    expect(bad.status).toBe(401);
  });

  it("rejects a request from another origin", async () => {
    const res = await rpc(call("ping"), readTok, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("initializes without a session id", async () => {
    const res = await rpc(
      call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }),
      readTok,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeNull();
    const j = await res.json();
    expect(j.result.protocolVersion).toBe("2025-06-18");
    expect(j.result.capabilities.tools).toBeDefined();
  });

  it("accepts notifications with 202 and answers ping", async () => {
    const n = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, readTok);
    expect(n.status).toBe(202);
    expect((await (await rpc(call("ping"), readTok)).json()).result).toEqual({});
  });

  it("maps bad bodies and unknown methods to JSON-RPC errors", async () => {
    const parse = await handler(
      new Request(URL_, { method: "POST", body: "{", headers: { authorization: `Bearer ${readTok}` } }),
    );
    expect(parse.status).toBe(400);
    expect((await parse.json()).error.code).toBe(-32700);
    expect((await (await rpc(call("nope"), readTok)).json()).error.code).toBe(-32601);
    expect((await (await rpc([call("ping")], readTok)).json()).error.code).toBe(-32600);
  });
});

describe("mcp tools", () => {
  const names = async (token: string) =>
    (await (await rpc(call("tools/list"), token)).json()).result.tools.map((t: { name: string }) => t.name) as string[];

  it("lists only the tools a read-only token may run", async () => {
    const list = await names(readTok);
    expect(list).toEqual(expect.arrayContaining(["me_get", "public_brand_get", "inquiries_list", "inquiries_get"]));
    expect(list).not.toContain("inquiries_update");
    expect(list).not.toContain("portfolio_list");
    expect(list).not.toContain("booth_sync_status");
  });

  it("lists write tools for a write token, and never an excluded operation", async () => {
    const list = await names(writeTok);
    expect(list).toContain("inquiries_update");
    expect(list).toContain("booth_sync_status");
    for (const banned of [
      "inquiries_qualify",
      "builder_push_vsco",
      "tokens_create",
      "tokens_revoke",
      "auth_login",
      "portfolio_delete",
      "booth_inquiries_delete",
    ]) {
      expect(list).not.toContain(banned);
    }
  });

  it("describes tools with an object input schema", async () => {
    const tools = (await (await rpc(call("tools/list"), readTok)).json()).result.tools;
    const get = tools.find((t: { name: string }) => t.name === "inquiries_get");
    expect(get.inputSchema.type).toBe("object");
    expect(Object.keys(get.inputSchema.properties)).toContain("id");
    expect(get.annotations.readOnlyHint).toBe(true);
  });

  it("runs a tool and returns text plus structuredContent", async () => {
    const j = await (await rpc(call("tools/call", { name: "inquiries_list", arguments: {} }), readTok)).json();
    expect(j.error).toBeUndefined();
    expect(j.result.isError).toBe(false);
    expect(j.result.structuredContent.items).toEqual([]);
    expect(JSON.parse(j.result.content[0].text)).toEqual(j.result.structuredContent);
  });

  it("refuses a tool outside the token's scopes with the HQ message", async () => {
    const j = await (
      await rpc(call("tools/call", { name: "inquiries_update", arguments: { id: 1, status: "closed" } }), readTok)
    ).json();
    expect(j.error.message).toBe("This token lacks the write:inquiries scope.");
    expect(j.error.data.code).toBe("insufficient_scope");
  });

  it("does not expose operations that are not marked agent", async () => {
    const j = await (await rpc(call("tools/call", { name: "tokens_create", arguments: {} }), writeTok)).json();
    expect(j.error.code).toBe(-32602);
  });

  it("maps invalid arguments and API errors to JSON-RPC errors", async () => {
    const bad = await (
      await rpc(call("tools/call", { name: "inquiries_get", arguments: { id: "x" } }), readTok)
    ).json();
    expect(bad.error.code).toBe(-32602);
    const missing = await (
      await rpc(call("tools/call", { name: "inquiries_get", arguments: { id: 999 } }), readTok)
    ).json();
    expect(missing.error.data.code).toBe("not_found");
  });
});
