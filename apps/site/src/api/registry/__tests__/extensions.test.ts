import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { Validator } from "@seriousme/openapi-schema-validator";
import { defineOperation, withResponse } from "../define";
import { generateOpenApi } from "../openapi";
import { SCOPES } from "../scopes";
import { _setTokenDb } from "../tokens";
import { BASE, freshDb, jsonReq, makeRouter, req } from "./helpers";

const whoami = defineOperation({
  id: "ext_addr",
  summary: "Address",
  tag: "ext",
  method: "GET",
  path: "/ext/addr",
  scope: null,
  input: z.object({}),
  output: z.object({ addr: z.string() }),
  handler: ({ clientAddress }) => ({ addr: clientAddress }),
});
const cookie = defineOperation({
  id: "ext_cookie",
  summary: "Cookie",
  tag: "ext",
  method: "POST",
  path: "/ext/cookie",
  scope: null,
  successStatus: 200,
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  handler: () => withResponse({ ok: true }, { headers: { "Set-Cookie": "a=b; Path=/" }, status: 202 }),
});
const csv = defineOperation({
  id: "ext_csv",
  summary: "Csv",
  tag: "ext",
  method: "GET",
  path: "/ext/csv",
  scope: null,
  text: { contentType: "text/csv; charset=utf-8" },
  input: z.object({}),
  output: z.string(),
  handler: () => withResponse("a,b\n1,2\n", { headers: { "Content-Disposition": 'attachment; filename="x.csv"' } }),
});
const upload = defineOperation({
  id: "ext_upload",
  summary: "Upload",
  tag: "ext",
  method: "POST",
  path: "/ext/upload",
  scope: null,
  multipart: true,
  input: z.object({ title: z.string(), tags: z.preprocess((v) => (Array.isArray(v) ? v : v === undefined ? [] : [v]), z.array(z.string())), file: z.any().optional() }),
  output: z.object({ title: z.string(), tags: z.array(z.string()), size: z.number() }),
  handler: ({ input }) => ({ title: input.title, tags: input.tags, size: (input.file as File | undefined)?.size ?? 0 }),
});
const jsonOnly = defineOperation({
  id: "ext_json",
  summary: "Json",
  tag: "ext",
  method: "POST",
  path: "/ext/json",
  scope: null,
  input: z.object({ title: z.string() }),
  output: z.object({ title: z.string() }),
  handler: ({ input }) => ({ title: input.title }),
});
const ops = [whoami, cookie, csv, upload, jsonOnly];

describe("registry extensions", () => {
  let handle: ReturnType<typeof makeRouter>;
  beforeEach(() => {
    freshDb();
    handle = makeRouter(ops);
  });
  afterEach(() => _setTokenDb(null));

  it("passes clientAddress to handlers", async () => {
    const res = await handle(req("/ext/addr"), { clientAddress: "203.0.113.9" });
    expect(await res.json()).toEqual({ addr: "203.0.113.9" });
    const none = await handle(req("/ext/addr"));
    expect(await none.json()).toEqual({ addr: "unknown" });
  });

  it("withResponse adds headers and overrides status", async () => {
    const res = await handle(jsonReq("/ext/cookie", "POST", {}));
    expect(res.status).toBe(202);
    expect(res.headers.get("set-cookie")).toBe("a=b; Path=/");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("text operations answer the string as-is", async () => {
    const res = await handle(req("/ext/csv"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toContain("x.csv");
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(await res.text()).toBe("a,b\n1,2\n");
  });

  it("multipart is accepted only on operations that declare it", async () => {
    const fd = new FormData();
    fd.append("title", "hello");
    fd.append("tags", "a");
    fd.append("tags", "b");
    fd.append("file", new File(["12345"], "t.png", { type: "image/png" }));
    const ok = await handle(new Request(BASE + "/ext/upload", { method: "POST", body: fd }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ title: "hello", tags: ["a", "b"], size: 5 });

    const single = new FormData();
    single.append("title", "t");
    single.append("tags", "only");
    const one = await handle(new Request(BASE + "/ext/upload", { method: "POST", body: single }));
    expect((await one.json()).tags).toEqual(["only"]);

    const fd2 = new FormData();
    fd2.append("title", "hello");
    const rejected = await handle(new Request(BASE + "/ext/json", { method: "POST", body: fd2 }));
    expect(rejected.status).toBe(415);
    expect((await rejected.json()).error.code).toBe("unsupported_media_type");
  });

  it("upload operations still take JSON", async () => {
    const res = await handle(jsonReq("/ext/upload", "POST", { title: "j", tags: ["x"] }));
    expect(await res.json()).toEqual({ title: "j", tags: ["x"], size: 0 });
  });

  it("openapi stays valid with multipart and text operations; sync scope exists", async () => {
    const doc = generateOpenApi(ops);
    const result = await new Validator().validate(doc as never);
    expect(result.errors ?? []).toEqual([]);
    const paths = doc.paths as Record<string, Record<string, any>>;
    expect(paths["/ext/upload"].post.requestBody.content["multipart/form-data"]).toBeTruthy();
    expect(paths["/ext/csv"].get.responses["200"].content["text/csv; charset=utf-8"]).toBeTruthy();
    expect(SCOPES["write:sync"]).toBeTruthy();
    expect(SCOPES["read:sync"]).toBeTruthy();
  });
});
