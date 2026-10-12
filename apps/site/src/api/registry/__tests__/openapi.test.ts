import { describe, expect, it } from "vitest";
import { Validator } from "@seriousme/openapi-schema-validator";
import { z } from "zod";
import { collectOperations, getOperations } from "../index";
import { defineOperation, isOperation } from "../define";
import { generateOpenApi } from "../openapi";
import { SCOPE_NAMES } from "../scopes";

describe("registry discovery", () => {
  it("finds every op file under src/api/v1/ops", () => {
    const ids = getOperations().map((o) => o.id);
    expect(ids).toEqual(
      expect.arrayContaining(["me_get", "tokens_list", "tokens_create", "tokens_revoke", "public_brand_get", "openapi_get"]),
    );
    expect(getOperations().every(isOperation)).toBe(true);
  });

  it("rejects duplicate ids and duplicate routes", () => {
    const mk = (id: string, path: string) =>
      defineOperation({
        id,
        summary: id,
        tag: "t",
        method: "GET",
        path,
        scope: null,
        input: z.object({}),
        output: z.object({}),
        handler: () => ({}),
      });
    expect(() => collectOperations({ a: { x: mk("one", "/a") }, b: { y: mk("one", "/b") } })).toThrow(/duplicate operation id/);
    expect(() => collectOperations({ a: { x: mk("one", "/a") }, b: { y: mk("two", "/a") } })).toThrow(/duplicate route/);
  });

  it("refuses bad ids and paths", () => {
    const base = { summary: "s", tag: "t", method: "GET" as const, scope: null, input: z.object({}), output: z.object({}), handler: () => ({}) };
    expect(() => defineOperation({ ...base, id: "Bad-Id", path: "/a" })).toThrow();
    expect(() => defineOperation({ ...base, id: "ok", path: "a/b" })).toThrow();
  });
});

describe("OpenAPI generation", () => {
  const doc = generateOpenApi(getOperations(), { serverUrl: "https://smile-nola.com/api/v1" });

  it("is a valid OpenAPI 3.1 document", async () => {
    const result = await new Validator().validate(doc as never);
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
    expect(doc.openapi).toBe("3.1.0");
  });

  it("has one operation per registry entry, keyed by id", () => {
    const paths = doc.paths as Record<string, Record<string, { operationId: string }>>;
    const ids = Object.values(paths).flatMap((p) => Object.values(p).map((o) => o.operationId));
    expect(ids.sort()).toEqual(getOperations().map((o) => o.id).sort());
    expect(paths["/me/tokens/{id}"].delete.operationId).toBe("tokens_revoke");
  });

  it("declares scopes on a security scheme and per operation", () => {
    const components = doc.components as {
      securitySchemes: Record<string, { type: string; "x-scopes"?: Record<string, string> }>;
    };
    expect(components.securitySchemes.bearerAuth.type).toBe("http");
    expect(Object.keys(components.securitySchemes.bearerAuth["x-scopes"]!)).toEqual(SCOPE_NAMES);
    expect(components.securitySchemes.sessionCookie.type).toBe("apiKey");

    const paths = doc.paths as Record<string, Record<string, { security: unknown[] }>>;
    expect(paths["/me/tokens"].post.security).toEqual([{ bearerAuth: ["admin"] }, { sessionCookie: [] }]);
    expect(paths["/public/brand"].get.security).toEqual([]);
  });

  it("puts path params in the path, list params in the query, and bodies in requestBody", () => {
    const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>;
    const revoke = paths["/me/tokens/{id}"].delete.parameters as { in: string; name: string }[];
    expect(revoke).toEqual([expect.objectContaining({ in: "path", name: "id" })]);
    const list = paths["/me/tokens"].get.parameters as { in: string; name: string }[];
    expect(list.map((p) => `${p.in}:${p.name}`).sort()).toEqual(["query:cursor", "query:limit"]);
    expect(paths["/me/tokens"].post.requestBody).toBeDefined();
    const responses = paths["/me/tokens"].post.responses as Record<string, unknown>;
    expect(Object.keys(responses)).toEqual(expect.arrayContaining(["201", "400", "401", "403", "415", "429", "500"]));
  });
});
