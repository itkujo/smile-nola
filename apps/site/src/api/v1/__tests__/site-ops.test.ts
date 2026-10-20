import "./site-env";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOperations } from "@/api/registry/index";
import { createRouter } from "@/api/registry/router";
import { RateLimiter } from "@/api/registry/ratelimit";
import { createToken } from "@/api/registry/tokens";
import { ErrorBodySchema } from "@/api/registry/errors";
import { getDb } from "@/lib/db";
import { sessionCookie } from "@/api/registry/__tests__/helpers";

// Nothing leaves the process: email and VSCO pushes are stubbed, oEmbed does no network.
const sendInquiry = vi.fn(async () => {});
const sendBuilder = vi.fn(async () => {});
vi.mock("@/lib/email", () => ({
  sendInquiryNotification: (...a: unknown[]) => (sendInquiry as any)(...a),
  sendBuilderSubmissionNotification: (...a: unknown[]) => (sendBuilder as any)(...a),
}));
const pushQualified = vi.fn(async () => {});
const pushBuilder = vi.fn(async () => {});
vi.mock("@/lib/vsco/push", () => ({
  pushQualifiedToVsco: (...a: unknown[]) => (pushQualified as any)(...a),
  pushBuilderToVsco: (...a: unknown[]) => (pushBuilder as any)(...a),
}));
vi.mock("@/lib/oembed", async (orig) => ({
  ...(await orig<typeof import("@/lib/oembed")>()),
  resolveThumbnail: async () => "https://img.example/thumb.jpg",
}));

const BASE = "http://localhost:4321/api/v1";
let handle: ReturnType<typeof createRouter>;

beforeEach(() => {
  handle = createRouter({
    operations: getOperations(),
    limiter: new RateLimiter(),
    logger: { warn: () => {}, error: () => {} },
  });
  sendInquiry.mockClear();
  sendBuilder.mockClear();
  pushQualified.mockClear();
  pushBuilder.mockClear();
});

interface CallOpts {
  body?: unknown;
  form?: FormData;
  token?: string;
  cookie?: string;
  headers?: Record<string, string>;
  address?: string;
}
async function call(method: string, path: string, o: CallOpts = {}) {
  const headers = new Headers(o.headers);
  if (o.token) headers.set("authorization", `Bearer ${o.token}`);
  if (o.cookie) headers.set("cookie", o.cookie);
  let body: BodyInit | undefined;
  if (o.form) body = o.form;
  else if (o.body !== undefined) {
    body = JSON.stringify(o.body);
    headers.set("content-type", "application/json");
  }
  const res = await handle(new Request(BASE + path, { method, headers, body }), {
    clientAddress: o.address ?? "198.51.100.7",
  });
  return res;
}
async function json(res: Response) {
  return (await res.json()) as any;
}
async function errorCode(res: Response) {
  const body = await res.json();
  expect(ErrorBodySchema.safeParse(body).success).toBe(true);
  return body.error.code as string;
}
const tok = (...scopes: string[]) => createToken({ label: "t", scopes }).token;

/** Every scoped op rejects: no credential -> 401, wrong scope -> 403. */
async function expectAuthRejection(method: string, path: string, wrongScope: string, body?: unknown) {
  const anon = await call(method, path, { body });
  expect(anon.status).toBe(401);
  expect(await errorCode(anon)).toBe("unauthorized");
  const wrong = await call(method, path, { body, token: tok(wrongScope) });
  expect(wrong.status).toBe(403);
  expect(await errorCode(wrong)).toBe("insufficient_scope");
}

const SHORT = {
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
  phone: "5045550100",
  collection: "smile",
  message: "hello",
};
const DEEP = { first_name: "Grace", last_name: "Hopper", email: "grace@example.com", phone: "5045550111", message: "hi" };

function inquiryCount(email: string): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM inquiries WHERE email = ?").get(email) as { n: number }).n;
}
async function newInquiry(email = `i${Math.random().toString(16).slice(2)}@example.com`) {
  const res = await call("POST", "/inquiries", { body: { ...SHORT, email } });
  expect(res.status).toBe(201);
  return (await json(res)).id as number;
}

describe("inquiries: public forms", () => {
  it("POST /inquiries saves, notifies, and rate-limit headers are present", async () => {
    const res = await call("POST", "/inquiries", { body: SHORT });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body).toMatchObject({ ok: true, message: expect.stringContaining("24 hours") });
    expect(body.id).toBeGreaterThan(0);
    expect(inquiryCount("ada@example.com")).toBe(1);
    expect(sendInquiry).toHaveBeenCalledOnce();
    expect(res.headers.get("ratelimit-limit")).toBe("120");
  });

  it("honeypot: a filled company field looks like success but saves nothing", async () => {
    const res = await call("POST", "/inquiries", { body: { ...SHORT, email: "bot@example.com", company: "ACME" } });
    expect(res.status).toBe(201);
    expect((await json(res)).id).toBe(0);
    expect(inquiryCount("bot@example.com")).toBe(0);
    expect(sendInquiry).not.toHaveBeenCalled();
  });

  it("validation failure is bad_request naming the field; the router limits per address", async () => {
    const res = await call("POST", "/inquiries", { body: { ...SHORT, email: "nope" } });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("bad_request");
  });

  it("rejects a non-JSON body with 415", async () => {
    const fd = new FormData();
    fd.set("first_name", "x");
    const res = await call("POST", "/inquiries", { form: fd });
    expect(res.status).toBe(415);
  });

  it("POST /inquiries/contact saves the deep form and honours the honeypot", async () => {
    const res = await call("POST", "/inquiries/contact", { body: DEEP });
    expect(res.status).toBe(201);
    expect(inquiryCount("grace@example.com")).toBe(1);
    const trap = await call("POST", "/inquiries/contact", { body: { ...DEEP, email: "b2@example.com", company: "x" } });
    expect((await json(trap)).id).toBe(0);
    expect(inquiryCount("b2@example.com")).toBe(0);
    const bad = await call("POST", "/inquiries/contact", { body: { ...DEEP, phone: "1" } });
    expect(bad.status).toBe(400);
  });
});

describe("inquiries: admin", () => {
  it("list / get / counts / export need read:inquiries", async () => {
    const id = await newInquiry("list@example.com");
    const t = tok("read:inquiries");

    const list = await json(await call("GET", "/inquiries?status=new", { token: t }));
    expect(list.items.some((r: any) => r.id === id)).toBe(true);

    const one = await json(await call("GET", `/inquiries/${id}`, { token: t }));
    expect(one.email).toBe("list@example.com");

    const counts = await json(await call("GET", "/inquiries/counts", { token: t }));
    expect(counts.total).toBeGreaterThan(0);

    const csv = await call("GET", "/inquiries/export.csv?status=all", { token: t });
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.headers.get("content-disposition")).toMatch(/attachment; filename=".*\.csv"/);
    expect(await csv.text()).toContain("list@example.com");

    const missing = await call("GET", "/inquiries/999999", { token: t });
    expect(missing.status).toBe(404);

    await expectAuthRejection("GET", "/inquiries", "read:testimonials");
    await expectAuthRejection("GET", `/inquiries/${id}`, "read:portfolio");
    await expectAuthRejection("GET", "/inquiries/export.csv", "read:builder");
    await expectAuthRejection("GET", "/inquiries/counts", "write:settings");
  });

  it("the admin session reaches the same operations", async () => {
    const res = await call("GET", "/inquiries/counts", { cookie: sessionCookie() });
    expect(res.status).toBe(200);
  });

  it("PATCH updates status and notes; read scope is not enough", async () => {
    const id = await newInquiry();
    const res = await call("PATCH", `/inquiries/${id}`, { token: tok("write:inquiries"), body: { status: "contacted", notes: "called" } });
    expect(res.status).toBe(200);
    expect((await json(res)).inquiry).toMatchObject({ status: "contacted", notes: "called" });
    const empty = await call("PATCH", `/inquiries/${id}`, { token: tok("write:inquiries"), body: {} });
    expect(empty.status).toBe(400);
    await expectAuthRejection("PATCH", `/inquiries/${id}`, "read:inquiries", { status: "closed" });
  });

  it("qualify stamps qualified_at once and triggers the VSCO push", async () => {
    const id = await newInquiry();
    const t = tok("write:inquiries");
    const a = await json(await call("POST", `/inquiries/${id}/qualify`, { token: t }));
    expect(a.ok).toBe(true);
    const b = await json(await call("POST", `/inquiries/${id}/qualify`, { token: t }));
    expect(b.qualified_at).toBe(a.qualified_at);
    expect(pushQualified).toHaveBeenCalledTimes(2);
    await expectAuthRejection("POST", `/inquiries/${id}/qualify`, "read:inquiries");
  });

  it("vsco-debug and vsco-clear", async () => {
    const id = await newInquiry();
    const dbg = await json(await call("GET", `/inquiries/${id}/vsco-debug`, { token: tok("read:inquiries") }));
    expect(dbg.inquiry.id).toBe(id);
    expect(dbg.entities).toEqual([]);
    const uuid = dbg.inquiry.external_uuid as string;
    expect(uuid).toBeTruthy();
    getDb().prepare("INSERT INTO vsco_entities (external_uuid, kind, vsco_id) VALUES (?, ?, ?)").run(uuid, "order", "ORD1");
    const clear = await call("POST", `/inquiries/${id}/vsco-clear`, { token: tok("write:inquiries"), body: { kind: "order" } });
    expect(clear.status).toBe(200);
    expect(await json(clear)).toMatchObject({ ok: true, deletedCount: 1, kind: "order" });
    const badKind = await call("POST", `/inquiries/${id}/vsco-clear`, { token: tok("write:inquiries"), body: { kind: "job" } });
    expect(badKind.status).toBe(400);
    await expectAuthRejection("GET", `/inquiries/${id}/vsco-debug`, "read:builder");
    await expectAuthRejection("POST", `/inquiries/${id}/vsco-clear`, "read:inquiries", { kind: "order" });
  });
});

const SUBMISSION = {
  client: { firstName: "Jo", lastName: "Doe", email: "jo@example.com", phone: "5045550122" },
  event: { date: "2027-05-01", type: "wedding", venue: "Saenger", guestCount: 120, note: null },
  consultationPref: "video",
  selections: {
    collections: ["smile"],
    packages: [{ collectionId: "smile", packageId: "memory-booth" }],
    addons: [],
  },
};

describe("builder", () => {
  it("submit: server-priced, notified, pushed; unknown selections are bad_request", async () => {
    const res = await call("POST", "/builder/submissions", { body: SUBMISSION, address: "10.0.0.1" });
    expect(res.status).toBe(201);
    const { id } = await json(res);
    expect(id).toBeGreaterThan(0);
    const row = getDb().prepare("SELECT * FROM package_builder_submissions WHERE id = ?").get(id) as any;
    expect(row.source).toBe("cold-builder");
    expect(row.fixed_subtotal_cents).toBe(69500);
    expect(sendBuilder).toHaveBeenCalledOnce();
    expect(pushBuilder).toHaveBeenCalledOnce();

    const bad = await call("POST", "/builder/submissions", {
      address: "10.0.0.2",
      body: { ...SUBMISSION, selections: { collections: ["smile"], packages: [{ collectionId: "smile", packageId: "nope" }], addons: [] } },
    });
    expect(bad.status).toBe(400);
    const invalidInvite = await call("POST", "/builder/submissions", { body: { ...SUBMISSION, invite: "nosuchtoken" }, address: "10.0.0.3" });
    expect(invalidInvite.status).toBe(400);
  });

  it("submit is limited to 5 per address, with Retry-After", async () => {
    let last!: Response;
    for (let i = 0; i < 6; i++) last = await call("POST", "/builder/submissions", { body: SUBMISSION, address: "10.9.9.9" });
    expect(last.status).toBe(429);
    expect(last.headers.get("retry-after")).toBeTruthy();
    expect(await errorCode(last)).toBe("rate_limited");
  });

  it("invite flow: mint (idempotent), look up, submit as invited, expired -> conflict", async () => {
    const inquiryId = await newInquiry("invited@example.com");
    const w = tok("write:builder");
    const first = await json(await call("POST", "/builder/invites", { token: w, body: { inquiryId } }));
    expect(first.url).toBe(`https://test.smilenola.example/build?invite=${encodeURIComponent(first.token)}`);
    const again = await json(await call("POST", "/builder/invites", { token: w, body: { inquiryId } }));
    expect(again.token).toBe(first.token);
    await expectAuthRejection("POST", "/builder/invites", "read:builder", { inquiryId });
    const noInquiry = await call("POST", "/builder/invites", { token: w, body: { inquiryId: 999999 } });
    expect(noInquiry.status).toBe(404);

    // Public lookup, no credential.
    const look = await call("GET", `/builder/invites/${first.token}`);
    expect(look.status).toBe(200);
    expect(await json(look)).toMatchObject({ ok: true, inquiryId, prefill: { firstName: "Ada", email: "invited@example.com" } });
    expect((await call("GET", "/builder/invites/unknown")).status).toBe(404);

    const sub = await call("POST", "/builder/submissions", { body: { ...SUBMISSION, invite: first.token }, address: "10.0.1.1" });
    expect(sub.status).toBe(201);
    const row = getDb().prepare("SELECT * FROM package_builder_submissions WHERE id = ?").get((await json(sub)).id) as any;
    expect(row).toMatchObject({ source: "invited-builder", inquiry_id: inquiryId });

    getDb().prepare("UPDATE builder_invites SET expires_at = '2000-01-01 00:00:00' WHERE token = ?").run(first.token);
    const expired = await call("GET", `/builder/invites/${first.token}`);
    expect(expired.status).toBe(409);
    const err = (await json(expired)).error;
    expect(err).toEqual({ code: "conflict", message: "invite expired" });
    const expiredSubmit = await call("POST", "/builder/submissions", { body: { ...SUBMISSION, invite: first.token }, address: "10.0.1.2" });
    expect(expiredSubmit.status).toBe(400);
  });

  it("list / get / update status / push-vsco", async () => {
    const created = await json(await call("POST", "/builder/submissions", { body: SUBMISSION, address: "10.0.2.1" }));
    const id = created.id;
    const r = tok("read:builder");
    const list = await json(await call("GET", "/builder/submissions", { token: r }));
    expect(list.items.some((s: any) => s.id === id)).toBe(true);
    const one = await json(await call("GET", `/builder/submissions/${id}`, { token: r }));
    expect(one.submission.id).toBe(id);
    expect(one.vscoPushes).toEqual([]);
    expect((await call("GET", "/builder/submissions/999999", { token: r })).status).toBe(404);

    const w = tok("write:builder");
    const sent = await json(await call("PATCH", `/builder/submissions/${id}`, { token: w, body: { status: "invoice_sent" } }));
    expect(sent.submission.status).toBe("invoice_sent");
    expect(sent.submission.invoice_sent_at).toBeTruthy();
    const back = await json(await call("PATCH", `/builder/submissions/${id}`, { token: w, body: { status: "new" } }));
    expect(back.submission.invoice_sent_at).toBeNull();

    pushBuilder.mockClear();
    const push = await call("POST", `/builder/submissions/${id}/push-vsco`, { token: w });
    expect(push.status).toBe(200);
    expect(pushBuilder).toHaveBeenCalledWith(expect.objectContaining({ id }), { trigger: "manual" });

    await expectAuthRejection("GET", "/builder/submissions", "read:inquiries");
    await expectAuthRejection("GET", `/builder/submissions/${id}`, "read:portfolio");
    await expectAuthRejection("PATCH", `/builder/submissions/${id}`, "read:builder", { status: "new" });
    await expectAuthRejection("POST", `/builder/submissions/${id}/push-vsco`, "read:builder");
  });
});

describe("places", () => {
  const realFetch = globalThis.fetch;
  const restore = () => {
    globalThis.fetch = realFetch;
    process.env.GOOGLE_PLACES_API_KEY = "TEST_KEY";
  };

  it("autocomplete: validates q, needs the key, forwards to Google, trims the shape", async () => {
    expect((await call("GET", "/places/autocomplete")).status).toBe(400);
    expect((await call("GET", "/places/autocomplete?q=%20%20")).status).toBe(400);

    const fetchMock = vi.fn(async (_u: any, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("X-Goog-Api-Key")).toBe("TEST_KEY");
      expect(JSON.parse(init?.body as string).input).toBe("Saenger");
      return new Response(
        JSON.stringify({
          suggestions: [
            {
              placePrediction: {
                placeId: "PLACE_1",
                text: { text: "Saenger Theatre, New Orleans" },
                structuredFormat: { mainText: { text: "Saenger Theatre" }, secondaryText: { text: "Canal Street" } },
              },
            },
            { notAPrediction: true },
          ],
        }),
        { status: 200 },
      );
    });
    globalThis.fetch = fetchMock as any;
    try {
      const res = await call("GET", "/places/autocomplete?q=Saenger");
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({
        suggestions: [{ placeId: "PLACE_1", mainText: "Saenger Theatre", secondaryText: "Canal Street" }],
      });
      globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as any;
      expect(await json(await call("GET", "/places/autocomplete?q=zzz"))).toEqual({ suggestions: [] });
    } finally {
      restore();
    }
  });

  it("autocomplete: 503 unavailable without a key or when Google fails", async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    const noKey = await call("GET", "/places/autocomplete?q=x");
    expect(noKey.status).toBe(503);
    expect((await json(noKey)).error.message).toMatch(/not configured/);
    process.env.GOOGLE_PLACES_API_KEY = "TEST_KEY";
    globalThis.fetch = vi.fn(async () => new Response("denied", { status: 403 })) as any;
    try {
      expect((await call("GET", "/places/autocomplete?q=x")).status).toBe(503);
      globalThis.fetch = vi.fn(async () => {
        throw new Error("ECONNRESET");
      }) as any;
      expect((await call("GET", "/places/autocomplete?q=x")).status).toBe(503);
    } finally {
      restore();
    }
  });

  it("details: validates the id, parses address components", async () => {
    expect((await call("GET", "/places/details")).status).toBe(400);
    expect((await call("GET", "/places/details?id=bad%20id")).status).toBe(400);
    globalThis.fetch = vi.fn(async (url: any) => {
      expect(String(url)).toContain("/places/ChIJ_test");
      return new Response(
        JSON.stringify({
          id: "ChIJ_test",
          displayName: { text: "Saenger Theatre" },
          formattedAddress: "1111 Canal St",
          addressComponents: [
            { longText: "1111", shortText: "1111", types: ["street_number"] },
            { longText: "Canal Street", shortText: "Canal St", types: ["route"] },
            { longText: "New Orleans", shortText: "New Orleans", types: ["locality"] },
            { longText: "Louisiana", shortText: "LA", types: ["administrative_area_level_1"] },
            { longText: "United States", shortText: "US", types: ["country"] },
            { longText: "70112", shortText: "70112", types: ["postal_code"] },
          ],
          location: { latitude: 29.9572, longitude: -90.0773 },
        }),
        { status: 200 },
      );
    }) as any;
    try {
      const res = await call("GET", "/places/details?id=ChIJ_test");
      expect(await json(res)).toEqual({
        name: "Saenger Theatre",
        streetAddress: "1111 Canal St",
        city: "New Orleans",
        state: "LA",
        postalCode: "70112",
        country: "US",
        latitude: 29.9572,
        longitude: -90.0773,
      });
      delete process.env.GOOGLE_PLACES_API_KEY;
      expect((await call("GET", "/places/details?id=ChIJ_test")).status).toBe(503);
      process.env.GOOGLE_PLACES_API_KEY = "TEST_KEY";
      globalThis.fetch = vi.fn(async () => new Response("{}", { status: 404 })) as any;
      expect((await call("GET", "/places/details?id=ChIJ_unknown")).status).toBe(503);
    } finally {
      restore();
    }
  });
});

describe("portfolio", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

  it("create (JSON) / list / get / update / delete with scopes", async () => {
    const w = tok("write:portfolio");
    const r = tok("read:portfolio");
    const created = await call("POST", "/portfolio", { token: w, body: { title: "Reel", url: YT, collections: ["smile"], featured: true } });
    expect(created.status).toBe(201);
    const { id, item } = await json(created);
    expect(item).toMatchObject({ title: "Reel", provider: "youtube", thumbnail_url: "https://img.example/thumb.jpg" });

    const list = await json(await call("GET", "/portfolio?collection=smile", { token: r }));
    expect(list.items.some((i: any) => i.id === id)).toBe(true);
    const none = await json(await call("GET", "/portfolio?collection=aurora", { token: r }));
    expect(none.items.some((i: any) => i.id === id)).toBe(false);
    expect((await json(await call("GET", `/portfolio/${id}`, { token: r }))).title).toBe("Reel");

    const upd = await call("PATCH", `/portfolio/${id}`, { token: w, body: { title: "Reel 2", display_order: 3 } });
    expect(upd.status).toBe(200);
    expect((await json(upd)).item).toMatchObject({ title: "Reel 2", display_order: 3 });

    const clearUrl = await call("PATCH", `/portfolio/${id}`, { token: w, body: { url: "" } });
    expect(clearUrl.status).toBe(200); // still has its thumbnail

    expect((await call("DELETE", `/portfolio/${id}`, { token: w })).status).toBe(200);
    expect((await call("GET", `/portfolio/${id}`, { token: r })).status).toBe(404);
    expect((await call("DELETE", `/portfolio/${id}`, { token: w })).status).toBe(404);
  });

  it("rules: collection required, URL must be a known provider, url or thumbnail required", async () => {
    const w = tok("write:portfolio");
    expect((await call("POST", "/portfolio", { token: w, body: { title: "x", url: YT, collections: [] } })).status).toBe(400);
    expect((await call("POST", "/portfolio", { token: w, body: { title: "x", url: "https://example.com/v", collections: ["smile"] } })).status).toBe(400);
    expect((await call("POST", "/portfolio", { token: w, body: { title: "x", collections: ["smile"] } })).status).toBe(400);
  });

  it("multipart create saves the thumbnail; bad files are rejected; wrong scope is refused", async () => {
    const w = tok("write:portfolio");
    const form = new FormData();
    form.set("title", "Photo only");
    form.append("collections", "smile");
    form.append("collections", "aurora");
    form.set("thumbnail", new File([png], "t.png", { type: "image/png" }));
    const res = await call("POST", "/portfolio", { token: w, form });
    expect(res.status).toBe(201);
    const { item, warning } = await json(res);
    expect(warning).toBeUndefined();
    expect(item.thumbnail_url).toMatch(/^\/uploads\/portfolio\//);
    expect(JSON.parse(JSON.stringify(item.collections))).toEqual(["aurora", "smile"]) // canonical collection order;

    // One checkbox arrives as a single value.
    const one = new FormData();
    one.set("title", "One collection");
    one.append("collections", "smile");
    one.set("thumbnail", new File([png], "t.png", { type: "image/png" }));
    expect((await call("POST", "/portfolio", { token: w, form: one })).status).toBe(201);

    const bad = new FormData();
    bad.set("title", "Bad file");
    bad.append("collections", "smile");
    bad.set("thumbnail", new File(["not an image"], "t.txt", { type: "text/plain" }));
    expect((await call("POST", "/portfolio", { token: w, form: bad })).status).toBe(400);

    const denied = await call("POST", "/portfolio", { token: tok("read:portfolio"), form });
    expect(denied.status).toBe(403);
    expect((await call("POST", "/portfolio", { form })).status).toBe(401);

    // Multipart is accepted only where an operation declares it.
    const other = new FormData();
    other.set("quote", "q");
    other.set("attribution", "a");
    expect((await call("POST", "/testimonials", { token: tok("write:testimonials"), form: other })).status).toBe(415);
  });

  it("auth rejection on list/get/delete", async () => {
    await expectAuthRejection("GET", "/portfolio", "read:testimonials");
    await expectAuthRejection("GET", "/portfolio/1", "read:inquiries");
    await expectAuthRejection("DELETE", "/portfolio/1", "read:portfolio");
    await expectAuthRejection("PATCH", "/portfolio/1", "read:portfolio", { title: "x" });
  });
});

describe("testimonials", () => {
  it("CRUD with scopes", async () => {
    const w = tok("write:testimonials");
    const r = tok("read:testimonials");
    const c = await call("POST", "/testimonials", { token: w, body: { quote: "Lovely", attribution: "A & B", featured: true } });
    expect(c.status).toBe(201);
    const { id } = await json(c);
    const featured = await json(await call("GET", "/testimonials?featured=true&limit=5", { token: r }));
    expect(featured.items.some((t: any) => t.id === id)).toBe(true);
    expect((await json(await call("GET", `/testimonials/${id}`, { token: r }))).quote).toBe("Lovely");
    const upd = await json(await call("PATCH", `/testimonials/${id}`, { token: w, body: { quote: "Perfect" } }));
    expect(upd.item.quote).toBe("Perfect");
    expect((await call("PATCH", `/testimonials/${id}`, { token: w, body: {} })).status).toBe(400);
    expect((await call("DELETE", `/testimonials/${id}`, { token: w })).status).toBe(200);
    expect((await call("DELETE", `/testimonials/${id}`, { token: w })).status).toBe(404);
    expect((await call("POST", "/testimonials", { token: w, body: { quote: "", attribution: "x" } })).status).toBe(400);
  });

  it("auth rejection", async () => {
    await expectAuthRejection("GET", "/testimonials", "read:portfolio");
    await expectAuthRejection("POST", "/testimonials", "read:testimonials", { quote: "q", attribution: "a" });
    await expectAuthRejection("PATCH", "/testimonials/1", "read:testimonials", { quote: "q" });
    await expectAuthRejection("DELETE", "/testimonials/1", "read:testimonials");
  });
});

describe("settings: site banner", () => {
  it("get and replace", async () => {
    const banner = { enabled: true, message: "Booking 2027", linkUrl: "/contact", linkLabel: "Reserve", variant: "gold" };
    const put = await call("PUT", "/settings/site-banner", { token: tok("write:settings"), body: banner });
    expect(put.status).toBe(200);
    expect((await json(put)).banner).toMatchObject(banner);
    const got = await json(await call("GET", "/settings/site-banner", { token: tok("read:settings") }));
    expect(got).toMatchObject(banner);
    const bad = await call("PUT", "/settings/site-banner", { token: tok("write:settings"), body: { ...banner, linkUrl: "javascript:alert(1)" } });
    expect(bad.status).toBe(400);
  });

  it("auth rejection", async () => {
    await expectAuthRejection("GET", "/settings/site-banner", "read:inquiries");
    await expectAuthRejection("PUT", "/settings/site-banner", "read:settings", { enabled: false, message: "", linkUrl: null, linkLabel: null, variant: "gold" });
  });
});

describe("sync", () => {
  const row = (n: number) => ({
    external_uuid: `00000000-0000-4000-8000-00000000000${n}`,
    created_at: "2026-10-01T12:00:00.000Z",
    first_name: "Booth",
    last_name: `Guest${n}`,
    email: `booth${n}@example.com`,
    phone: "5045550133",
    preferred_contact: null,
    event_date: null,
    venue: null,
    collections_interested: null,
    notes: null,
    partner1_name: null,
    partner2_name: null,
    event_setting: null,
    poc_relationship: null,
  });

  it("upserts idempotently with write:sync and notifies only fresh inserts", async () => {
    const t = tok("write:sync");
    const first = await json(await call("POST", "/sync/inquiries", { token: t, body: { inquiries: [row(1), row(2)] } }));
    expect(first.results.map((r: any) => r.inserted)).toEqual([true, true]);
    expect(sendInquiry).toHaveBeenCalledTimes(2);
    const again = await json(await call("POST", "/sync/inquiries", { token: t, body: { inquiries: [row(1)] } }));
    expect(again.results[0]).toMatchObject({ inserted: false, id: first.results[0].id });
    expect(sendInquiry).toHaveBeenCalledTimes(2);
  });

  it("validates the batch before writing anything", async () => {
    const t = tok("write:sync");
    const res = await call("POST", "/sync/inquiries", { token: t, body: { inquiries: [row(3), { ...row(4), external_uuid: "nope" }] } });
    expect(res.status).toBe(400);
    expect((await json(res)).error.message).toMatch(/UUID/);
    expect(inquiryCount("booth3@example.com")).toBe(0);
    expect((await call("POST", "/sync/inquiries", { token: t, body: {} })).status).toBe(400);
    const big = Array.from({ length: 201 }, (_, i) => row(5 + (i % 3)));
    expect((await call("POST", "/sync/inquiries", { token: t, body: { inquiries: big } })).status).toBe(400);
  });

  it("needs write:sync: no credential, read-only or other scopes are refused", async () => {
    await expectAuthRejection("POST", "/sync/inquiries", "write:inquiries", { inquiries: [] });
    const readOnly = await call("POST", "/sync/inquiries", { token: tok("read:sync"), body: { inquiries: [] } });
    expect(readOnly.status).toBe(403);
    expect(inquiryCount("booth1@example.com")).toBeGreaterThanOrEqual(0);
  });
});

describe("auth", () => {
  it("login sets the session cookie, which then authenticates; logout clears it", async () => {
    const ok = await call("POST", "/auth/login", { body: { password: "correct horse battery" }, address: "10.1.1.1" });
    expect(ok.status).toBe(200);
    const body = await json(ok);
    expect(body.ok).toBe(true);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
    const setCookie = ok.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/^sn_admin=/);
    expect(setCookie).toMatch(/HttpOnly/i);

    const cookie = setCookie.split(";")[0];
    const me = await call("GET", "/me", { cookie });
    expect(me.status).toBe(200);
    expect((await json(me)).via).toBe("session");

    const out = await call("POST", "/auth/logout");
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toMatch(/sn_admin=;|Max-Age=0/i);
  });

  it("wrong password is unauthorized; five attempts per address then rate_limited", async () => {
    const addr = "10.2.2.2";
    const wrong = await call("POST", "/auth/login", { body: { password: "nope" }, address: addr });
    expect(wrong.status).toBe(401);
    expect(await errorCode(wrong)).toBe("unauthorized");
    expect(wrong.headers.get("set-cookie")).toBeNull();
    let last!: Response;
    for (let i = 0; i < 5; i++) last = await call("POST", "/auth/login", { body: { password: "nope" }, address: addr });
    expect(last.status).toBe(429);
    expect(last.headers.get("retry-after")).toBeTruthy();
    // Another address is unaffected.
    expect((await call("POST", "/auth/login", { body: { password: "correct horse battery" }, address: "10.3.3.3" })).status).toBe(200);
  });

  it("a request without a password is a bad_request", async () => {
    const res = await call("POST", "/auth/login", { body: {}, address: "10.4.4.4" });
    expect(res.status).toBe(400);
  });
});

describe("old routes are gone, docs are generated", () => {
  it("every moved operation is registered under /api/v1 with a tag from the brief", () => {
    const ops = getOperations();
    const tags = new Set(ops.map((o) => o.tag));
    for (const t of ["inquiries", "builder", "places", "portfolio", "testimonials", "settings", "sync", "auth"]) {
      expect(tags.has(t)).toBe(true);
    }
    const publicIds = ops.filter((o) => o.scope === null).map((o) => o.id);
    expect(publicIds).toEqual(
      expect.arrayContaining([
        "inquiries_create",
        "inquiries_contact",
        "builder_submit",
        "builder_invite_get",
        "places_autocomplete",
        "places_details",
        "auth_login",
        "auth_logout",
      ]),
    );
    expect(ops.find((o) => o.id === "sync_inquiries")?.scope).toBe("write:sync");
  });
});
