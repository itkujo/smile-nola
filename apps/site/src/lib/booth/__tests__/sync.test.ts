import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { bootstrapSchema, upsertBoothInquiry } from "@/lib/db";
import { insertBoothLead } from "../store";
import { drainOnce, syncStatus, _resetSyncState, BATCH_SIZE } from "../sync";
import { readBoothConfig, type BoothConfig } from "../config";
import { LeadSchema } from "../schema";

const CFG: BoothConfig = {
  mode: "booth",
  prodApiUrl: "https://prod.example",
  prodApiToken: "sn_testtoken",
  syncIntervalMs: 0,
};

const lead = (n: number) =>
  LeadSchema.parse({
    pocName: `Person ${n}`,
    pocEmail: `p${n}@example.com`,
    pocPhone: "5045551234",
    pocRelationship: "Planner",
    preferredContact: "Phone",
    partner1Name: "A",
    eventDate: "2027-01-01",
    setting: "Indoor",
    collectionsInterested: ["smile"],
  });

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  bootstrapSchema(db);
  _resetSyncState();
});
afterEach(() => vi.restoreAllMocks());

/** A fake prod: upserts into its own db like the real sync op, answering { ok, results }. */
function fakeProd() {
  const prod = new Database(":memory:");
  bootstrapSchema(prod);
  const calls: { url: string; auth: string | null; body: { inquiries: { external_uuid: string }[] } }[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), body });
    const results = body.inquiries.map((r: Parameters<typeof upsertBoothInquiry>[0]) => {
      const existing = prod.prepare("SELECT id FROM inquiries WHERE external_uuid = ?").get(r.external_uuid) as
        | { id: number }
        | undefined;
      if (existing) return { external_uuid: r.external_uuid, inserted: false, id: existing.id };
      const res = prod
        .prepare(
          `INSERT INTO inquiries (source, first_name, last_name, email, phone, external_uuid)
           VALUES ('booth-expo', ?, ?, ?, ?, ?)`,
        )
        .run(r.first_name, r.last_name, r.email, r.phone, r.external_uuid);
      return { external_uuid: r.external_uuid, inserted: true, id: Number(res.lastInsertRowid) };
    });
    return new Response(JSON.stringify({ ok: true, results }), { status: 200 });
  });
  return { prod, calls, fetch: fetchMock as unknown as typeof fetch };
}

describe("drainOnce", () => {
  it("posts to /api/v1/sync/inquiries with the bearer token and stamps synced_at", async () => {
    insertBoothLead(lead(1), db);
    insertBoothLead(lead(2), db);
    const p = fakeProd();

    const r = await drainOnce({ db, config: CFG, fetch: p.fetch });

    expect(r).toMatchObject({ ok: true, attempted: 2, inserted: 2, duplicates: 0, pending: 0 });
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0].url).toBe("https://prod.example/api/v1/sync/inquiries");
    expect(p.calls[0].auth).toBe("Bearer sn_testtoken");
    expect(p.calls[0].body.inquiries).toHaveLength(2);
    const unsynced = db.prepare("SELECT COUNT(*) AS n FROM inquiries WHERE synced_at IS NULL").get() as { n: number };
    expect(unsynced.n).toBe(0);
    const synced = db.prepare("SELECT synced_at FROM inquiries LIMIT 1").get() as { synced_at: string };
    expect(Date.parse(synced.synced_at)).not.toBeNaN();
    expect(p.prod.prepare("SELECT COUNT(*) AS n FROM inquiries").get()).toEqual({ n: 2 });
  });

  it("is idempotent: a second drain sends nothing; a replay dedupes on external_uuid", async () => {
    insertBoothLead(lead(1), db);
    const p = fakeProd();
    await drainOnce({ db, config: CFG, fetch: p.fetch });

    const again = await drainOnce({ db, config: CFG, fetch: p.fetch });
    expect(again).toMatchObject({ ok: true, attempted: 0, message: "nothing to sync" });
    expect(p.calls).toHaveLength(1);

    // Lose the local stamp (crash between prod ack and local write): resend.
    db.prepare("UPDATE inquiries SET synced_at = NULL").run();
    const replay = await drainOnce({ db, config: CFG, fetch: p.fetch });
    expect(replay).toMatchObject({ ok: true, attempted: 1, inserted: 0, duplicates: 1, pending: 0 });
    expect(p.prod.prepare("SELECT COUNT(*) AS n FROM inquiries").get()).toEqual({ n: 1 });
  });

  it("keeps rows pending when prod is unreachable, then delivers them later", async () => {
    insertBoothLead(lead(1), db);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const down = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const failed = await drainOnce({ db, config: CFG, fetch: down });
    expect(failed.ok).toBe(false);
    expect(failed.message).toContain("network error");
    expect(failed.pending).toBe(1);
    expect(syncStatus(db, CFG).lastRun?.ok).toBe(false);

    const p = fakeProd();
    const ok = await drainOnce({ db, config: CFG, fetch: p.fetch });
    expect(ok).toMatchObject({ ok: true, inserted: 1, pending: 0 });
  });

  it("keeps rows pending when prod answers an error status", async () => {
    insertBoothLead(lead(1), db);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const denied = vi.fn(async () => new Response('{"error":{"code":"unauthorized"}}', { status: 401 })) as unknown as typeof fetch;
    const r = await drainOnce({ db, config: CFG, fetch: denied });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("401");
    expect(r.pending).toBe(1);
  });

  it("skips soft-deleted and non-booth rows", async () => {
    const a = insertBoothLead(lead(1), db);
    insertBoothLead(lead(2), db);
    db.prepare("UPDATE inquiries SET deleted_at = ? WHERE id = ?").run(new Date().toISOString(), a.id);
    db.prepare("INSERT INTO inquiries (source, first_name, last_name, email, phone, external_uuid) VALUES ('website','W','S','w@e.com','5555555','11111111-1111-4111-8111-111111111111')").run();
    const p = fakeProd();
    const r = await drainOnce({ db, config: CFG, fetch: p.fetch });
    expect(r.attempted).toBe(1);
    expect(p.calls[0].body.inquiries).toHaveLength(1);
  });

  it("sends in batches", async () => {
    for (let i = 0; i < BATCH_SIZE + 5; i++) insertBoothLead(lead(i), db);
    const p = fakeProd();
    const r = await drainOnce({ db, config: CFG, fetch: p.fetch });
    expect(r).toMatchObject({ ok: true, attempted: BATCH_SIZE + 5, pending: 0 });
    expect(p.calls.map((c) => c.body.inquiries.length)).toEqual([BATCH_SIZE, 5]);
  });

  it("resends a rejected batch row by row so one bad row does not block the rest", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = insertBoothLead(lead(1), db);
    insertBoothLead(lead(2), db);
    const p = fakeProd();
    const inner = p.fetch;
    const picky = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const bad = body.inquiries.some((r: { external_uuid: string }) => r.external_uuid === a.externalUuid);
      if (bad) return new Response('{"error":{"code":"bad_request"}}', { status: 400 });
      return inner(url, init);
    }) as unknown as typeof fetch;

    const r = await drainOnce({ db, config: CFG, fetch: picky });
    expect(r.pending).toBe(1);
    const left = db.prepare("SELECT external_uuid FROM inquiries WHERE synced_at IS NULL").all() as { external_uuid: string }[];
    expect(left.map((x) => x.external_uuid)).toEqual([a.externalUuid]);
  });

  it("does nothing without a URL and token", async () => {
    insertBoothLead(lead(1), db);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = vi.fn() as unknown as typeof fetch;
    const r = await drainOnce({ db, config: { ...CFG, prodApiToken: "" }, fetch: f });
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("readBoothConfig", () => {
  afterEach(() => {
    delete process.env.SMILE_NOLA_MODE;
    delete process.env.BOOTH_SYNC_INTERVAL_MS;
    delete process.env.BOOTH_PROD_API_URL;
  });

  it("defaults to prod mode and a 30s interval", () => {
    expect(readBoothConfig()).toMatchObject({ mode: "prod", syncIntervalMs: 30_000 });
  });

  it("reads booth mode, 0 as manual, and trims a trailing slash", () => {
    process.env.SMILE_NOLA_MODE = "booth";
    process.env.BOOTH_SYNC_INTERVAL_MS = "0";
    process.env.BOOTH_PROD_API_URL = "https://smile-nola.com/";
    expect(readBoothConfig()).toMatchObject({ mode: "booth", syncIntervalMs: 0, prodApiUrl: "https://smile-nola.com" });
  });
});
