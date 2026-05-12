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

import crypto from "node:crypto";
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
 *
 * Exported so unit tests can bootstrap a `:memory:` Database without going
 * through the file-backed singleton in `getDb()`.
 */
export function bootstrapSchema(db: Database.Database): void {
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
      notes                  TEXT,
      -- Booth-expo origin columns (NULL for non-booth sources).
      -- Added so apps/intake can write directly to inquiries instead of
      -- maintaining a parallel leads table.
      partner1_name          TEXT,
      partner2_name          TEXT,
      event_setting          TEXT,    -- free-text from booth (e.g. "Indoor", "Outdoor — Covered")
      poc_relationship       TEXT,    -- free-text from booth (e.g. "One of the couple", "Planner")
      -- Replication scaffolding for booth->prod one-way sync (Phase 2).
      -- external_uuid is the canonical id across machines (booth assigns it
      -- on first insert; prod upserts by this UUID, never by autoincrement id).
      external_uuid          TEXT    UNIQUE,
      synced_at              TEXT,    -- NULL = pending push to prod
      source_legacy_id       INTEGER, -- old leads.id (booth migrations only)
      deleted_at             TEXT     -- soft-delete from booth admin
    );

    CREATE INDEX IF NOT EXISTS idx_inq_created_at ON inquiries(created_at);
    CREATE INDEX IF NOT EXISTS idx_inq_status     ON inquiries(status);
    CREATE INDEX IF NOT EXISTS idx_inq_source     ON inquiries(source);
    -- Indexes that reference the new booth/sync columns are created in
    -- migrateInquiriesAddBoothAndSyncColumns() below, AFTER it ALTERs the
    -- columns into existing databases. Putting them here would fail on
    -- older DBs because the columns don't exist yet at this point.

    CREATE TABLE IF NOT EXISTS portfolio_items (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at     TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      collections    TEXT    NOT NULL DEFAULT '[]', -- JSON array of slugs, e.g. '["smile","visionary"]'
      title          TEXT    NOT NULL,
      url            TEXT,                          -- nullable: photo-only items have no video
      thumbnail_url  TEXT,
      embed_id       TEXT,
      provider       TEXT,
      description    TEXT,
      gallery_url    TEXT,                          -- optional link to the full client gallery
      featured       INTEGER NOT NULL DEFAULT 0,
      display_order  INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_pf_featured ON portfolio_items(featured);

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

  db.exec(`
    CREATE TABLE IF NOT EXISTS package_builder_submissions (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at           TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status               TEXT    NOT NULL DEFAULT 'new',
      invoice_sent_at      TEXT,
      source               TEXT    NOT NULL,

      first_name           TEXT    NOT NULL,
      last_name            TEXT    NOT NULL,
      email                TEXT    NOT NULL,
      phone                TEXT    NOT NULL,

      inquiry_id           INTEGER REFERENCES inquiries(id),
      invite_token         TEXT,

      event_date           TEXT,
      event_type           TEXT,
      venue                TEXT,
      guest_count          INTEGER,
      consultation_pref    TEXT,
      client_note          TEXT,

      selections_json      TEXT    NOT NULL,
      fixed_subtotal_cents INTEGER NOT NULL,
      custom_quoted_json   TEXT,
      warnings_json        TEXT,

      notes                TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pbs_created_at ON package_builder_submissions(created_at);
    CREATE INDEX IF NOT EXISTS idx_pbs_status     ON package_builder_submissions(status);
    CREATE INDEX IF NOT EXISTS idx_pbs_email      ON package_builder_submissions(email);
    CREATE INDEX IF NOT EXISTS idx_pbs_inquiry    ON package_builder_submissions(inquiry_id);

    CREATE TABLE IF NOT EXISTS builder_invites (
      token        TEXT    PRIMARY KEY,
      inquiry_id   INTEGER NOT NULL REFERENCES inquiries(id),
      created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at   TEXT,
      consumed_at  TEXT,
      created_by   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_bi_inquiry ON builder_invites(inquiry_id);
  `);

  migratePortfolioToMultiCollection(db);
  migratePortfolioAddGalleryUrlAndNullableUrl(db);
  migrateInquiriesAddBoothAndSyncColumns(db);
  migrateLeadsIntoInquiries(db);
}

/**
 * One-shot migration that brings older `inquiries` tables up to the unified
 * shape (booth + site under one roof). Adds the 8 new columns and the two
 * supporting indexes if they're missing.
 *
 * Idempotent: each `ALTER TABLE ADD COLUMN` is guarded by a `PRAGMA
 * table_info` check, so running it on a fresh DB or an already-migrated DB
 * is a no-op.
 */
function migrateInquiriesAddBoothAndSyncColumns(db: Database.Database): void {
  type ColInfo = { name: string };
  const cols = db
    .prepare<[], ColInfo>("PRAGMA table_info(inquiries)")
    .all() as ColInfo[];
  const have = new Set(cols.map((c) => c.name));

  const add = (col: string, sql: string): void => {
    if (!have.has(col)) {
      db.exec(`ALTER TABLE inquiries ADD COLUMN ${sql};`);
    }
  };

  add("partner1_name",    "partner1_name    TEXT");
  add("partner2_name",    "partner2_name    TEXT");
  add("event_setting",    "event_setting    TEXT");
  add("poc_relationship", "poc_relationship TEXT");
  add("external_uuid",    "external_uuid    TEXT");
  add("synced_at",        "synced_at        TEXT");
  add("source_legacy_id", "source_legacy_id INTEGER");
  add("deleted_at",       "deleted_at       TEXT");

  // UNIQUE on external_uuid can't be added retroactively on an existing
  // column with ALTER TABLE in SQLite. We enforce uniqueness via a partial
  // index that ignores NULLs (existing rows that haven't been backfilled
  // yet are NULL and don't participate in uniqueness checks).
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_inq_external_uuid " +
      "ON inquiries(external_uuid) WHERE external_uuid IS NOT NULL;",
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_inq_deleted_at ON inquiries(deleted_at);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_inq_synced_at  ON inquiries(synced_at);");
}

/**
 * Booth `leads` -> unified `inquiries` migration.
 *
 * Idempotent. Only fires when the legacy `leads` table is present AND has
 * rows whose `id` isn't already in `inquiries.source_legacy_id`. Once every
 * row is migrated, this becomes a per-boot no-op (one cheap COUNT query).
 *
 * Run inside a transaction so partial failure leaves the DB consistent.
 *
 * Mapping rules (locked in plan, see commit context):
 *   leads.captured_at         -> inquiries.created_at
 *   leads.poc_name            -> inquiries.first_name + last_name (split on
 *                                FIRST space; single-word -> first_name="X",
 *                                last_name="")
 *   leads.poc_email           -> email
 *   leads.poc_phone           -> phone
 *   leads.poc_relationship    -> poc_relationship
 *   leads.preferred_contact   -> preferred_contact
 *   leads.partner1_name       -> partner1_name
 *   leads.partner2_name       -> partner2_name
 *   leads.event_date          -> event_date
 *   leads.venue_name          -> venue
 *   leads.setting             -> event_setting
 *   leads.collections_interested -> collections_interested (verbatim JSON)
 *   leads.notes               -> notes
 *   leads.deleted_at          -> deleted_at
 *   leads.id                  -> source_legacy_id (audit trail)
 *   leads.source ("New Orleans Bridal and Wedding Expo" etc.)
 *                             -> source = "booth-expo" (normalized)
 *
 *   constant: inquiries.event_type = "wedding" (booth is wedding-only)
 *
 * The booth's leads table is intentionally NOT dropped here. Phase 2 sync
 * needs the source rows to remain readable for a while in case migration is
 * found to have lost something. A separate one-shot script will rename it
 * to `leads_archived` once you confirm production looks good.
 */
function migrateLeadsIntoInquiries(db: Database.Database): void {
  // Skip silently if the legacy table doesn't exist (fresh DBs after this
  // commit will have no `leads` table at all once Phase 1.3 lands).
  const leadsExists = db
    .prepare<[], { n: number }>(
      "SELECT COUNT(*) AS n FROM sqlite_master " +
        "WHERE type='table' AND name='leads'",
    )
    .get();
  if (!leadsExists || leadsExists.n === 0) return;

  // Find leads.id values not yet migrated.
  interface LegacyLead {
    id: number;
    captured_at: string;
    poc_name: string;
    poc_email: string;
    poc_phone: string;
    poc_relationship: string;
    preferred_contact: string;
    partner1_name: string;
    partner2_name: string | null;
    event_date: string;
    venue_name: string | null;
    setting: string;
    collections_interested: string;
    notes: string | null;
    source: string;
    deleted_at: string | null;
  }

  const pending = db
    .prepare<[], LegacyLead>(
      `SELECT * FROM leads
       WHERE id NOT IN (
         SELECT source_legacy_id FROM inquiries
         WHERE source_legacy_id IS NOT NULL AND source = 'booth-expo'
       )`,
    )
    .all() as LegacyLead[];

  if (pending.length === 0) return;

  const insert = db.prepare(
    `INSERT INTO inquiries (
       created_at, source, status,
       first_name, last_name, email, phone,
       preferred_contact, event_date, event_type, venue,
       collections_interested, notes,
       partner1_name, partner2_name, event_setting, poc_relationship,
       external_uuid, source_legacy_id, deleted_at
     ) VALUES (
       @created_at, 'booth-expo', 'new',
       @first_name, @last_name, @email, @phone,
       @preferred_contact, @event_date, 'wedding', @venue,
       @collections_interested, @notes,
       @partner1_name, @partner2_name, @event_setting, @poc_relationship,
       @external_uuid, @source_legacy_id, @deleted_at
     )`,
  );

  const tx = db.transaction((rows: LegacyLead[]) => {
    for (const r of rows) {
      const trimmed = r.poc_name.trim();
      const spaceIdx = trimmed.indexOf(" ");
      const firstName =
        spaceIdx >= 0 ? trimmed.slice(0, spaceIdx) : trimmed || "(unknown)";
      const lastName = spaceIdx >= 0 ? trimmed.slice(spaceIdx + 1).trim() : "";

      insert.run({
        created_at: r.captured_at,
        first_name: firstName,
        last_name: lastName,
        email: r.poc_email,
        phone: r.poc_phone,
        preferred_contact: r.preferred_contact,
        event_date: r.event_date,
        venue: r.venue_name,
        collections_interested: r.collections_interested,
        notes: r.notes,
        partner1_name: r.partner1_name,
        partner2_name: r.partner2_name,
        event_setting: r.setting,
        poc_relationship: r.poc_relationship,
        external_uuid: crypto.randomUUID(),
        source_legacy_id: r.id,
        deleted_at: r.deleted_at,
      });
    }
  });

  tx(pending);

  // eslint-disable-next-line no-console
  console.log(
    `[db] migrated ${pending.length} booth lead${pending.length === 1 ? "" : "s"} into inquiries`,
  );
}

/**
 * One-shot migration for existing databases that still have the old single
 * `collection TEXT` column on portfolio_items.
 *
 *   1. Detect: query PRAGMA table_info, look for the legacy `collection` column.
 *   2. If present and the new `collections` column is empty for that row,
 *      backfill `collections = JSON_ARRAY(collection)`.
 *   3. Drop the legacy column (SQLite 3.35+; better-sqlite3 ships with 3.42+).
 *
 * Idempotent — running it on a fresh DB or an already-migrated DB is a no-op.
 */
function migratePortfolioToMultiCollection(db: Database.Database): void {
  type ColInfo = { name: string; notnull: number; dflt_value: string | null };
  const cols = db
    .prepare<[], ColInfo>("PRAGMA table_info(portfolio_items)")
    .all() as ColInfo[];
  const hasLegacy = cols.some((c) => c.name === "collection");
  const hasNew = cols.some((c) => c.name === "collections");

  // Defensive: if the new column is missing for any reason (e.g. a DB that
  // pre-dates this code revision), add it before backfilling.
  if (!hasNew) {
    db.exec(
      `ALTER TABLE portfolio_items ADD COLUMN collections TEXT NOT NULL DEFAULT '[]'`,
    );
  }

  if (hasLegacy) {
    // Backfill rows where collections is still the empty default.
    db.exec(
      `UPDATE portfolio_items
       SET collections = JSON_ARRAY(collection)
       WHERE (collections IS NULL OR collections = '[]')
         AND collection IS NOT NULL
         AND collection != ''`,
    );
    // The legacy index on `collection` must go BEFORE we drop the column —
    // SQLite refuses an ALTER DROP COLUMN that would invalidate an existing
    // index (error: "after drop column: no such column: collection").
    db.exec(`DROP INDEX IF EXISTS idx_pf_collection`);
    // Drop the legacy column. Requires SQLite >= 3.35 (better-sqlite3 ships 3.42+).
    db.exec(`ALTER TABLE portfolio_items DROP COLUMN collection`);
  }
}

/**
 * Migration for the gallery-URL + video-optional feature:
 *
 *   1. ADD COLUMN gallery_url TEXT — straightforward, just a new nullable col.
 *   2. Relax url's NOT NULL constraint so photo-only items can omit the
 *      video. SQLite cannot alter a column's NOT NULL status in place; the
 *      idiomatic fix is a table rebuild: create a new table with the right
 *      schema, copy rows over, drop the old one, rename.
 *
 * Both steps are guarded so a DB that already has the new shape is a no-op.
 */
function migratePortfolioAddGalleryUrlAndNullableUrl(
  db: Database.Database,
): void {
  type ColInfo = { name: string; notnull: number; dflt_value: string | null };
  const cols = db
    .prepare<[], ColInfo>("PRAGMA table_info(portfolio_items)")
    .all() as ColInfo[];

  // Step 1 — add gallery_url if missing.
  if (!cols.some((c) => c.name === "gallery_url")) {
    db.exec(`ALTER TABLE portfolio_items ADD COLUMN gallery_url TEXT`);
  }

  // Step 2 — relax url NOT NULL via table rebuild, only if currently NOT NULL.
  const urlCol = cols.find((c) => c.name === "url");
  if (urlCol && urlCol.notnull === 1) {
    db.exec(`
      BEGIN;

      CREATE TABLE portfolio_items_new (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at     TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        collections    TEXT    NOT NULL DEFAULT '[]',
        title          TEXT    NOT NULL,
        url            TEXT,
        thumbnail_url  TEXT,
        embed_id       TEXT,
        provider       TEXT,
        description    TEXT,
        gallery_url    TEXT,
        featured       INTEGER NOT NULL DEFAULT 0,
        display_order  INTEGER NOT NULL DEFAULT 0
      );

      INSERT INTO portfolio_items_new
        (id, created_at, collections, title, url, thumbnail_url,
         embed_id, provider, description, gallery_url, featured, display_order)
      SELECT
         id, created_at, collections, title, url, thumbnail_url,
         embed_id, provider, description, gallery_url, featured, display_order
      FROM portfolio_items;

      DROP TABLE portfolio_items;
      ALTER TABLE portfolio_items_new RENAME TO portfolio_items;
      CREATE INDEX IF NOT EXISTS idx_pf_featured ON portfolio_items(featured);

      COMMIT;
    `);
  }
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
  // Booth-expo origin columns (NULL for non-booth sources).
  partner1_name: string | null;
  partner2_name: string | null;
  event_setting: string | null;
  poc_relationship: string | null;
  // Replication scaffolding for booth->prod sync.
  external_uuid: string | null;
  synced_at: string | null;
  source_legacy_id: number | null;
  deleted_at: string | null;
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
