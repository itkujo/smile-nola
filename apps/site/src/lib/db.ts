/**
 * SQLite — the marketing site's data layer.
 *
 * Lives in the SAME database file as the booth intake (`<repo-root>/data/leads.db`)
 * so admin tooling can be unified later. The two apps use DIFFERENT tables:
 *
 *   apps/intake/  → `leads`              (booth captures)
 *   apps/site/    → `inquiries`,         (marketing-site contact forms)
 *                   `portfolio_items`,   (admin-managed videos)
 *                   `testimonials`       (admin-managed client quotes)
 *
 * WAL mode is enabled so the booth's writer doesn't block our reader (and
 * vice versa). better-sqlite3 is synchronous — that's fine for our load.
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { getEnv } from "@/lib/env";

/**
 * Resolve where the SQLite file lives. In production (Docker) the volume
 * mounts at /data. In dev it's `<repo-root>/data/`. Either way the path is
 * driven by SMILE_NOLA_DB_DIR with a sensible fallback.
 */
const DB_DIR =
  getEnv("SMILE_NOLA_DB_DIR") ||
  path.resolve(process.cwd(), "..", "..", "data");

const DB_PATH = path.join(DB_DIR, "leads.db");

// Singleton — Astro's SSR mode keeps this module hot across requests.
let _db: Database.Database | null = null;

function open(): Database.Database {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  bootstrapSchema(db);
  return db;
}

export function getDb(): Database.Database {
  if (!_db) _db = open();
  return _db;
}

/**
 * Create the marketing-site tables if they're missing. Safe to call on every
 * cold start — `CREATE TABLE IF NOT EXISTS` is idempotent.
 */
function bootstrapSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at             TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      source                 TEXT    NOT NULL,
      status                 TEXT    NOT NULL DEFAULT 'new',
      first_name             TEXT    NOT NULL,
      last_name              TEXT    NOT NULL,
      email                  TEXT    NOT NULL,
      phone                  TEXT    NOT NULL,
      preferred_contact      TEXT,
      event_date             TEXT,
      event_type             TEXT,
      venue                  TEXT,
      guest_count            INTEGER,
      event_start            TEXT,
      event_end              TEXT,
      planner                TEXT,
      budget_range           TEXT,
      message                TEXT,
      referral               TEXT,
      collections_interested TEXT,
      collection_fields_json TEXT,
      notes                  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_inq_created_at ON inquiries(created_at);
    CREATE INDEX IF NOT EXISTS idx_inq_status     ON inquiries(status);
    CREATE INDEX IF NOT EXISTS idx_inq_source     ON inquiries(source);

    CREATE TABLE IF NOT EXISTS portfolio_items (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at     TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      collection     TEXT    NOT NULL,
      title          TEXT    NOT NULL,
      url            TEXT    NOT NULL,
      thumbnail_url  TEXT,
      embed_id       TEXT,
      provider       TEXT,
      description    TEXT,
      featured       INTEGER NOT NULL DEFAULT 0,
      display_order  INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_pf_collection ON portfolio_items(collection);
    CREATE INDEX IF NOT EXISTS idx_pf_featured   ON portfolio_items(featured);

    CREATE TABLE IF NOT EXISTS testimonials (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at     TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      quote          TEXT    NOT NULL,
      attribution    TEXT    NOT NULL,
      featured       INTEGER NOT NULL DEFAULT 0,
      display_order  INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_ts_featured ON testimonials(featured);
  `);
}

/* ============================================================================
 * Inquiry row types — DB shape + hydrated form.
 * ============================================================================ */

export interface InquiryRow {
  id: number;
  created_at: string;
  source: string;
  status: "new" | "contacted" | "closed";
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  preferred_contact: string | null;
  event_date: string | null;
  event_type: string | null;
  venue: string | null;
  guest_count: number | null;
  event_start: string | null;
  event_end: string | null;
  planner: string | null;
  budget_range: string | null;
  message: string | null;
  referral: string | null;
  collections_interested: string | null;
  collection_fields_json: string | null;
  notes: string | null;
}

export interface InquiryInput {
  source: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  preferred_contact?: string | null;
  event_date?: string | null;
  event_type?: string | null;
  venue?: string | null;
  guest_count?: number | null;
  event_start?: string | null;
  event_end?: string | null;
  planner?: string | null;
  budget_range?: string | null;
  message?: string | null;
  referral?: string | null;
  collections_interested?: string[] | null;
  collection_fields?: Record<string, unknown> | null;
}

/**
 * Insert one inquiry. Returns the new row's id + ISO timestamp.
 *
 * Implementation note: we deliberately avoid prepared-statement caching
 * across calls so the SQL stays trivially readable. Volume is low (a few
 * inquiries per day at peak) so the cost is irrelevant.
 */
export function insertInquiry(input: InquiryInput): { id: number; createdAt: string } {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO inquiries (
        source, first_name, last_name, email, phone,
        preferred_contact, event_date, event_type, venue, guest_count,
        event_start, event_end, planner, budget_range,
        message, referral, collections_interested, collection_fields_json
      ) VALUES (
        @source, @first_name, @last_name, @email, @phone,
        @preferred_contact, @event_date, @event_type, @venue, @guest_count,
        @event_start, @event_end, @planner, @budget_range,
        @message, @referral, @collections_interested, @collection_fields_json
      )`
    )
    .run({
      source: input.source,
      first_name: input.first_name,
      last_name: input.last_name,
      email: input.email,
      phone: input.phone,
      preferred_contact: input.preferred_contact ?? null,
      event_date: input.event_date ?? null,
      event_type: input.event_type ?? null,
      venue: input.venue ?? null,
      guest_count: input.guest_count ?? null,
      event_start: input.event_start ?? null,
      event_end: input.event_end ?? null,
      planner: input.planner ?? null,
      budget_range: input.budget_range ?? null,
      message: input.message ?? null,
      referral: input.referral ?? null,
      collections_interested: input.collections_interested
        ? JSON.stringify(input.collections_interested)
        : null,
      collection_fields_json: input.collection_fields
        ? JSON.stringify(input.collection_fields)
        : null,
    });

  // Read the row back to get the server-assigned created_at for the response.
  const row = db
    .prepare<[number], { created_at: string }>(
      "SELECT created_at FROM inquiries WHERE id = ?"
    )
    .get(Number(result.lastInsertRowid));

  return {
    id: Number(result.lastInsertRowid),
    createdAt: row?.created_at ?? new Date().toISOString(),
  };
}

export function getAllInquiries(): InquiryRow[] {
  return getDb()
    .prepare("SELECT * FROM inquiries ORDER BY created_at DESC")
    .all() as InquiryRow[];
}

export function getInquiry(id: number): InquiryRow | undefined {
  return getDb()
    .prepare("SELECT * FROM inquiries WHERE id = ?")
    .get(id) as InquiryRow | undefined;
}

export function updateInquiryStatus(id: number, status: "new" | "contacted" | "closed"): boolean {
  const r = getDb()
    .prepare("UPDATE inquiries SET status = ? WHERE id = ?")
    .run(status, id);
  return r.changes > 0;
}

export function updateInquiryNotes(id: number, notes: string): boolean {
  const r = getDb()
    .prepare("UPDATE inquiries SET notes = ? WHERE id = ?")
    .run(notes, id);
  return r.changes > 0;
}

export function inquiryCounts(): { new: number; contacted: number; closed: number; total: number } {
  const rows = getDb()
    .prepare<[], { status: string; n: number }>(
      "SELECT status, COUNT(*) as n FROM inquiries GROUP BY status"
    )
    .all() as { status: string; n: number }[];
  const counts = { new: 0, contacted: 0, closed: 0, total: 0 };
  for (const r of rows) {
    if (r.status === "new") counts.new = r.n;
    if (r.status === "contacted") counts.contacted = r.n;
    if (r.status === "closed") counts.closed = r.n;
    counts.total += r.n;
  }
  return counts;
}
