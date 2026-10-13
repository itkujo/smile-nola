import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { getOperations } from "@/api/registry/index";
import { createToken } from "@/api/registry/tokens";
import { freshDb, jsonReq, makeRouter, req } from "@/api/registry/__tests__/helpers";
import { RateLimiter } from "@/api/registry/ratelimit";
import { _setBoothDb } from "@/lib/booth/store";
import { boothCsv } from "@/lib/booth/csv";

const LEAD = {
  pocName: "Jane Q Public",
  pocEmail: "jane@example.com",
  pocPhone: "(504) 555-1234",
  pocRelationship: "One of the couple",
  preferredContact: "Email",
  partner1Name: "Jane",
  partner2Name: "Joe",
  eventDate: "2027-05-01",
  venueName: "Pitot House",
  venueCity: "New Orleans",
  venueLatitude: 29.97,
  venueLongitude: -90.08,
  setting: "Indoor",
  collectionsInterested: ["aurora", "smile"],
  notes: "Lights please",
};

let db: Database.Database;
let router: ReturnType<typeof makeRouter>;
let readTok: string;
let writeTok: string;

beforeEach(() => {
  db = freshDb();
  _setBoothDb(db);
  router = makeRouter(getOperations(), new RateLimiter(10_000));
  readTok = createToken({ label: "r", scopes: ["read:booth"], expiresAt: null }).token;
  writeTok = createToken({ label: "w", scopes: ["write:booth"], expiresAt: null }).token;
});

afterEach(() => {
  _setBoothDb(null);
});

let nextIp = 0;
// Each call gets its own forwarded address unless one is given, so the
// per-address submit limit only bites in the test that asks for it.
async function submit(over: Record<string, unknown> = {}, ip?: string) {
  const addr = ip ?? `10.0.${Math.floor(nextIp / 250)}.${nextIp++ % 250}`;
  const req0 = new Request("http://localhost:4321/api/v1/booth/inquiries", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": addr },
    body: JSON.stringify({ ...LEAD, ...over }),
  });
  return router(req0, { clientAddress: addr });
}

describe("POST /booth/inquiries", () => {
  it("is public and stores a booth-expo row with a random external_uuid", async () => {
    const res = await submit();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.externalUuid).toMatch(/^[0-9a-f-]{36}$/);
    const row = db.prepare("SELECT * FROM inquiries WHERE id = ?").get(body.id) as Record<string, unknown>;
    expect(row.source).toBe("booth-expo");
    expect(row.external_uuid).toBe(body.externalUuid);
    expect(row.first_name).toBe("Jane");
    expect(row.last_name).toBe("Q Public");
    expect(row.synced_at).toBeNull();
    expect(row.venue_latitude).toBe(29.97);
    expect(JSON.parse(row.collections_interested as string)).toEqual(["aurora", "smile"]);
  });

  it("gives every submission its own uuid", async () => {
    const a = await (await submit()).json();
    const b = await (await submit()).json();
    expect(a.externalUuid).not.toBe(b.externalUuid);
  });

  it("names the failing field", async () => {
    const res = await submit({ pocEmail: "nope" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("pocEmail");
  });

  it("rejects an empty collection list", async () => {
    const res = await submit({ collectionsInterested: [] });
    expect(res.status).toBe(400);
  });

  it("rate limits per address", async () => {
    let last = 201;
    for (let i = 0; i < 31; i++) last = (await submit({}, "9.9.9.9")).status;
    expect(last).toBe(429);
  });
});

describe("GET /booth/inquiries", () => {
  it("needs read:booth", async () => {
    expect((await router(req("/booth/inquiries"))).status).toBe(401);
    expect((await router(req("/booth/inquiries", { token: createToken({ label: "x", scopes: ["read:inquiries"], expiresAt: null }).token }))).status).toBe(403);
  });

  it("pages newest first and skips non-booth and deleted rows", async () => {
    for (let i = 0; i < 5; i++) await submit({ pocName: `Person${i}` });
    db.prepare(
      "INSERT INTO inquiries (source, first_name, last_name, email, phone) VALUES ('website','Web','Site','w@e.com','5555555')",
    ).run();

    const first = await (await router(req("/booth/inquiries?limit=2", { token: readTok }))).json();
    expect(first.data.map((r: { firstName: string }) => r.firstName)).toEqual(["Person4", "Person3"]);
    expect(first.nextCursor).toBeTruthy();

    const second = await (
      await router(req(`/booth/inquiries?limit=2&cursor=${first.nextCursor}`, { token: readTok }))
    ).json();
    expect(second.data.map((r: { firstName: string }) => r.firstName)).toEqual(["Person2", "Person1"]);

    const third = await (
      await router(req(`/booth/inquiries?limit=2&cursor=${second.nextCursor}`, { token: readTok }))
    ).json();
    expect(third.data.map((r: { firstName: string }) => r.firstName)).toEqual(["Person0"]);
    expect(third.nextCursor).toBeNull();
  });
});

describe("DELETE /booth/inquiries/{id}", () => {
  it("soft deletes: the row stays, but drops out of the list", async () => {
    const { id } = await (await submit()).json();
    const res = await router(req(`/booth/inquiries/${id}`, { method: "DELETE", token: writeTok }));
    expect(res.status).toBe(200);
    expect((await res.json()).deletedAt).toBeTruthy();

    const row = db.prepare("SELECT deleted_at FROM inquiries WHERE id = ?").get(id) as { deleted_at: string | null };
    expect(row.deleted_at).toBeTruthy();
    const list = await (await router(req("/booth/inquiries", { token: readTok }))).json();
    expect(list.data).toEqual([]);
  });

  it("404s on a missing, already-deleted or non-booth row", async () => {
    const { id } = await (await submit()).json();
    const del = () => router(req(`/booth/inquiries/${id}`, { method: "DELETE", token: writeTok }));
    expect((await del()).status).toBe(200);
    expect((await del()).status).toBe(404);
    expect((await router(req("/booth/inquiries/9999", { method: "DELETE", token: writeTok }))).status).toBe(404);
  });

  it("needs write:booth", async () => {
    const { id } = await (await submit()).json();
    const res = await router(req(`/booth/inquiries/${id}`, { method: "DELETE", token: readTok }));
    expect(res.status).toBe(403);
  });
});

describe("booth CSV", () => {
  it("exports live booth rows only, with the HoneyBook columns", async () => {
    await submit({ pocName: "Keep Me" });
    const gone = await (await submit({ pocName: "Drop Me" })).json();
    await router(req(`/booth/inquiries/${gone.id}`, { method: "DELETE", token: writeTok }));

    const { csv, count } = boothCsv();
    expect(count).toBe(1);
    expect(csv.startsWith("﻿First Name,Last Name,Email,Phone")).toBe(true);
    expect(csv).toContain("Keep");
    expect(csv).not.toContain("Drop");
    expect(csv).toContain("booth-expo");
  });
});

describe("GET /booth/sync/status", () => {
  it("reports the queue", async () => {
    await submit();
    await submit();
    const body = await (await router(req("/booth/sync/status", { token: readTok }))).json();
    expect(body).toMatchObject({ mode: "prod", total: 2, pending: 2, synced: 0, lastRun: null });
  });
});

describe("POST /booth/sync/drain", () => {
  it("refuses outside booth mode", async () => {
    const res = await router(req("/booth/sync/drain", { method: "POST", token: writeTok }));
    expect(res.status).toBe(409);
  });
});
