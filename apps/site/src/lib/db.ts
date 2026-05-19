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

    -- Site-wide key/value store for small admin-managed configuration.
    -- Currently holds the announcement banner state (single row keyed
    -- "banner") but the table is intentionally generic so future single-flag
    -- toggles (maintenance mode, intake pause, etc.) can ride the same
    -- schema without another migration.
    --
    -- value is opaque JSON, parsed and validated by the consumer; updated_at
    -- gets refreshed on every write so the admin UI can show "last updated"
    -- without us tracking per-field timestamps.
    CREATE TABLE IF NOT EXISTS site_settings (
      key        TEXT    PRIMARY KEY,
      value      TEXT    NOT NULL,
      updated_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  migratePortfolioToMultiCollection(db);
  migratePortfolioAddGalleryUrlAndNullableUrl(db);
  migrateInquiriesAddBoothAndSyncColumns(db);
  migrateLeadsIntoInquiries(db);
  archiveLegacyLeadsTable(db);
  migrateAddVscoTables(db);
  migrateAddVenueAddressColumns(db);
  backfillInquiryExternalUuids(db);
}

/**
 * One-shot backfill: assign external_uuid to any inquiry row missing one.
 *
 * Why: external_uuid is the stable lookup key the VSCO integration uses
 * for idempotency. Booth-origin rows always arrive with one (the booth
 * generates it). Website-origin rows started getting one auto-assigned
 * in commit 7dc7fd8 (the "wire builder push into POST /api/package-builder"
 * commit). Anyone who submitted via the marketing site BEFORE that commit
 * deployed has external_uuid = NULL, which makes the VSCO push paths
 * silently skip with "inquiry missing external_uuid".
 *
 * This migration finds those rows and assigns a fresh UUIDv4 to each.
 *
 * Safe to run on every cold start:
 *   - Selects only `external_uuid IS NULL` rows, so re-runs are zero-cost
 *   - Assigns a fresh UUID per row (independent calls to crypto.randomUUID),
 *     so the UNIQUE partial index on external_uuid won't be violated
 *   - Logs the affected row count so deploy logs surface what happened
 *
 * Once every inquiry has a UUID (probably forever after the first run),
 * this becomes a no-op.
 */
function backfillInquiryExternalUuids(db: Database.Database): void {
  const nullRows = db
    .prepare<[], { id: number }>(
      "SELECT id FROM inquiries WHERE external_uuid IS NULL",
    )
    .all();
  if (nullRows.length === 0) return;

  const update = db.prepare("UPDATE inquiries SET external_uuid = ? WHERE id = ?");
  const tx = db.transaction((rows: Array<{ id: number }>) => {
    for (const row of rows) {
      update.run(crypto.randomUUID(), row.id);
    }
  });
  tx(nullRows);

  // eslint-disable-next-line no-console
  console.log(
    `[db] backfillInquiryExternalUuids: assigned UUIDs to ${nullRows.length} inquiry row(s)`,
  );
}

/**
 * VSCO Workspace integration tables.
 *
 *   inquiries.qualified_at          - timestamp set by admin "Mark Qualified"
 *                                     button. Until this is non-null, no data
 *                                     pushes to VSCO. After it's set, every
 *                                     subsequent update (builder, manual edit)
 *                                     mirrors to VSCO.
 *
 *   vsco_entities                   - records every VSCO ULID we've created so
 *                                     we never re-create the same entity. PK
 *                                     is (external_uuid, kind): one row per
 *                                     (our row, type of VSCO entity). For
 *                                     example after pushing inquiry uuid-1
 *                                     we'd have rows for:
 *                                       (uuid-1, 'job') -> ULID of the Job
 *                                       (uuid-1, 'contact-poc') -> ULID
 *                                       (uuid-1, 'contact-partner-a') -> ULID
 *                                       (uuid-1, 'event-main') -> ULID
 *                                       (uuid-1, 'venue') -> ULID
 *
 *   vsco_pushes                     - audit log of every push attempt. Records
 *                                     the trigger, the verdict (ok/failed/
 *                                     skipped), the HTTP status, the error
 *                                     body (when failed), and the duration.
 *                                     Indexed by external_uuid so the admin
 *                                     UI can show a per-inquiry sync history.
 *
 * All three changes are idempotent: re-running them on an already-migrated
 * DB is a no-op.
 */
function migrateAddVscoTables(db: Database.Database): void {
  // 1. inquiries.qualified_at column
  type ColInfo = { name: string };
  const cols = db
    .prepare<[], ColInfo>("PRAGMA table_info(inquiries)")
    .all() as ColInfo[];
  const have = new Set(cols.map((c) => c.name));
  if (!have.has("qualified_at")) {
    db.exec("ALTER TABLE inquiries ADD COLUMN qualified_at TEXT;");
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_inq_qualified_at ON inquiries(qualified_at);",
  );

  // 2. vsco_entities — maps (our external_uuid, kind) -> VSCO ULID
  db.exec(`
    CREATE TABLE IF NOT EXISTS vsco_entities (
      external_uuid TEXT    NOT NULL,
      kind          TEXT    NOT NULL,
      vsco_id       TEXT    NOT NULL,
      created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (external_uuid, kind)
    );
    CREATE INDEX IF NOT EXISTS idx_vsco_ent_uuid ON vsco_entities(external_uuid);
  `);

  // 3. vsco_pushes — append-only audit log
  db.exec(`
    CREATE TABLE IF NOT EXISTS vsco_pushes (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at     TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      external_uuid  TEXT,                -- usually inquiry.external_uuid; nullable for builder-only pushes
      inquiry_id     INTEGER,             -- our inquiries.id when applicable
      builder_id     INTEGER,             -- our package_builder_submissions.id when applicable
      trigger        TEXT    NOT NULL,    -- 'inquiry-create' | 'inquiry-update' | 'builder-create' | 'qualify' | 'manual'
      verdict        TEXT    NOT NULL,    -- 'ok' | 'failed' | 'skipped'
      http_status    INTEGER,             -- VSCO HTTP status (when applicable)
      error_body     TEXT,                -- JSON-stringified VSCO error body
      duration_ms    INTEGER,             -- wall-clock duration of the push
      notes          TEXT                 -- free-form, e.g. "VSCO_ENABLED=0 — skipped"
    );
    CREATE INDEX IF NOT EXISTS idx_vsco_pushes_uuid    ON vsco_pushes(external_uuid);
    CREATE INDEX IF NOT EXISTS idx_vsco_pushes_inquiry ON vsco_pushes(inquiry_id);
    CREATE INDEX IF NOT EXISTS idx_vsco_pushes_builder ON vsco_pushes(builder_id);
    CREATE INDEX IF NOT EXISTS idx_vsco_pushes_at      ON vsco_pushes(created_at);
  `);
}

/**
 * Adds 7 nullable columns to inquiries and package_builder_submissions for
 * structured venue address data captured from Google Places autocomplete.
 *
 * Idempotent — each ALTER TABLE is guarded by a PRAGMA check.
 *
 * Existing `venue TEXT` column is preserved as the human-readable name.
 * New columns are populated only when the venue was picked from the
 * autocomplete dropdown; free-text submissions leave them NULL.
 */
function migrateAddVenueAddressColumns(db: Database.Database): void {
  type ColInfo = { name: string };

  const inqCols = db
    .prepare<[], ColInfo>("PRAGMA table_info(inquiries)")
    .all() as ColInfo[];
  const inqHave = new Set(inqCols.map((c) => c.name));
  const TEXT_COLS = [
    "venue_street_address",
    "venue_city",
    "venue_state",
    "venue_postal_code",
    "venue_country",
  ];
  const REAL_COLS = ["venue_latitude", "venue_longitude"];
  for (const col of TEXT_COLS) {
    if (!inqHave.has(col)) {
      db.exec(`ALTER TABLE inquiries ADD COLUMN ${col} TEXT;`);
    }
  }
  for (const col of REAL_COLS) {
    if (!inqHave.has(col)) {
      db.exec(`ALTER TABLE inquiries ADD COLUMN ${col} REAL;`);
    }
  }

  const bldCols = db
    .prepare<[], ColInfo>(
      "PRAGMA table_info(package_builder_submissions)",
    )
    .all() as ColInfo[];
  const bldHave = new Set(bldCols.map((c) => c.name));
  for (const col of TEXT_COLS) {
    if (!bldHave.has(col)) {
      db.exec(`ALTER TABLE package_builder_submissions ADD COLUMN ${col} TEXT;`);
    }
  }
  for (const col of REAL_COLS) {
    if (!bldHave.has(col)) {
      db.exec(`ALTER TABLE package_builder_submissions ADD COLUMN ${col} REAL;`);
    }
  }
}

/**
 * Rename the legacy `leads` table to `leads_archived` once every row has
 * been migrated into `inquiries`. Stops the booth intake (and any future
 * code) from accidentally reading or writing the stale table.
 *
 * Idempotent:
 *   - if `leads` doesn't exist, no-op
 *   - if every leads.id is represented in inquiries.source_legacy_id,
 *     rename it
 *   - otherwise (something's still pending), leave both tables in place
 *     so the next bootstrap can finish the data migration first
 *
 * We rename rather than DROP for audit safety: if anything looks wrong in
 * inquiries post-migration, the operator can recover from leads_archived
 * with a manual SQL pass. A separate, explicit DROP can happen weeks
 * later once we're confident.
 */
function archiveLegacyLeadsTable(db: Database.Database): void {
  const exists = db
    .prepare<[], { n: number }>(
      "SELECT COUNT(*) AS n FROM sqlite_master " +
        "WHERE type='table' AND name='leads'",
    )
    .get();
  if (!exists || exists.n === 0) return;

  const pending = db
    .prepare<[], { n: number }>(
      `SELECT COUNT(*) AS n FROM leads
       WHERE id NOT IN (
         SELECT source_legacy_id FROM inquiries
         WHERE source_legacy_id IS NOT NULL AND source = 'booth-expo'
       )`,
    )
    .get();
  if (!pending || pending.n > 0) return;

  // Check whether leads_archived already exists (e.g. a previous boot did
  // the rename). If so, we'd be trying to rename onto an existing name.
  const archivedExists = db
    .prepare<[], { n: number }>(
      "SELECT COUNT(*) AS n FROM sqlite_master " +
        "WHERE type='table' AND name='leads_archived'",
    )
    .get();
  if (archivedExists && archivedExists.n > 0) return;

  db.exec("ALTER TABLE leads RENAME TO leads_archived;");
  // eslint-disable-next-line no-console
  console.log("[db] renamed legacy `leads` table to `leads_archived`");
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
  // VSCO Workspace integration — set when admin presses "Mark Qualified".
  qualified_at: string | null;
  // Structured venue address — populated when user picked from Google Places
  // autocomplete; NULL for free-text venue entries.
  venue_street_address: string | null;
  venue_city: string | null;
  venue_state: string | null;
  venue_postal_code: string | null;
  venue_country: string | null;
  venue_latitude: number | null;
  venue_longitude: number | null;
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
  // Optional structured venue address (from Google Places autocomplete).
  venue_street_address?: string | null;
  venue_city?: string | null;
  venue_state?: string | null;
  venue_postal_code?: string | null;
  venue_country?: string | null;
  venue_latitude?: number | null;
  venue_longitude?: number | null;
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
  // Always assign an external_uuid for new inquiries. Booth-origin rows arrive
  // with one already set via the sync endpoint (which uses upsertBoothInquiry,
  // bypassing this function entirely). Website-origin rows didn't get one
  // historically — they do now so the VSCO integration has a stable
  // idempotency key across retries and admin actions.
  const result = db
    .prepare(
      `INSERT INTO inquiries (
        source, first_name, last_name, email, phone,
        preferred_contact, event_date, event_type, venue, guest_count,
        event_start, event_end, planner, budget_range,
        message, referral, collections_interested, collection_fields_json,
        external_uuid,
        venue_street_address, venue_city, venue_state, venue_postal_code,
        venue_country, venue_latitude, venue_longitude
      ) VALUES (
        @source, @first_name, @last_name, @email, @phone,
        @preferred_contact, @event_date, @event_type, @venue, @guest_count,
        @event_start, @event_end, @planner, @budget_range,
        @message, @referral, @collections_interested, @collection_fields_json,
        @external_uuid,
        @venue_street_address, @venue_city, @venue_state, @venue_postal_code,
        @venue_country, @venue_latitude, @venue_longitude
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
      external_uuid: crypto.randomUUID(),
      venue_street_address: input.venue_street_address ?? null,
      venue_city: input.venue_city ?? null,
      venue_state: input.venue_state ?? null,
      venue_postal_code: input.venue_postal_code ?? null,
      venue_country: input.venue_country ?? null,
      venue_latitude: input.venue_latitude ?? null,
      venue_longitude: input.venue_longitude ?? null,
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

/* ============================================================================
 * Booth -> prod replication (Phase 2)
 * ========================================================================== */

/**
 * Shape of one inquiry row as the booth pushes it to the prod sync endpoint.
 * Optional fields are nullable; the booth fills in everything it has and
 * leaves NULL for fields it doesn't capture.
 */
export interface BoothSyncPayload {
  external_uuid: string;
  created_at: string;       // booth-local ISO timestamp (kept verbatim)
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  preferred_contact: string | null;
  event_date: string | null;
  venue: string | null;
  collections_interested: string | null; // JSON-stringified array
  notes: string | null;
  // Booth-specific
  partner1_name: string | null;
  partner2_name: string | null;
  event_setting: string | null;
  poc_relationship: string | null;
  // Optional structured venue address — booth may have these if it
  // ships an upgraded payload. Older booth payloads leave them undefined,
  // in which case we treat them as null.
  venue_street_address?: string | null;
  venue_city?: string | null;
  venue_state?: string | null;
  venue_postal_code?: string | null;
  venue_country?: string | null;
  venue_latitude?: number | null;
  venue_longitude?: number | null;
}

/**
 * Idempotent upsert keyed on external_uuid. If a row with that UUID already
 * exists, do nothing (the booth's most recent push wins; prod is canonical
 * after first ingest). Returns whether the row was newly inserted.
 *
 * The endpoint that calls this validates the bearer token; this function
 * deliberately doesn't reach for auth state. Stays pure.
 */
export function upsertBoothInquiry(
  payload: BoothSyncPayload,
): { inserted: boolean; id: number } {
  const db = getDb();

  // Check first — INSERT OR IGNORE would also work but doesn't tell us
  // whether we inserted or skipped, which the caller wants to report.
  const existing = db
    .prepare<[string], { id: number }>(
      "SELECT id FROM inquiries WHERE external_uuid = ?",
    )
    .get(payload.external_uuid);

  if (existing) {
    return { inserted: false, id: existing.id };
  }

  const result = db
    .prepare(
      `INSERT INTO inquiries (
         created_at, source, status, event_type,
         first_name, last_name, email, phone,
         preferred_contact, event_date, venue,
         collections_interested, notes,
         partner1_name, partner2_name, event_setting, poc_relationship,
         external_uuid, synced_at,
         venue_street_address, venue_city, venue_state, venue_postal_code,
         venue_country, venue_latitude, venue_longitude
       ) VALUES (
         @created_at, 'booth-expo', 'new', 'wedding',
         @first_name, @last_name, @email, @phone,
         @preferred_contact, @event_date, @venue,
         @collections_interested, @notes,
         @partner1_name, @partner2_name, @event_setting, @poc_relationship,
         @external_uuid, CURRENT_TIMESTAMP,
         @venue_street_address, @venue_city, @venue_state, @venue_postal_code,
         @venue_country, @venue_latitude, @venue_longitude
       )`,
    )
    .run({
      ...payload,
      venue_street_address: payload.venue_street_address ?? null,
      venue_city: payload.venue_city ?? null,
      venue_state: payload.venue_state ?? null,
      venue_postal_code: payload.venue_postal_code ?? null,
      venue_country: payload.venue_country ?? null,
      venue_latitude: payload.venue_latitude ?? null,
      venue_longitude: payload.venue_longitude ?? null,
    });

  return { inserted: true, id: Number(result.lastInsertRowid) };
}

/* ============================================================================
 * VSCO Workspace integration helpers
 * ========================================================================== */

/**
 * Kinds of VSCO entities we keep IDs for. New kinds may be added at any
 * time; the database schema is intentionally a free-form text column so
 * we never need a migration just to track a new entity.
 *
 *   job            - the main Job created for an inquiry
 *   order          - the Order created from a builder submission
 *   contact-poc    - the primary point-of-contact Person
 *   contact-partner-a / contact-partner-b - paired partners (booth flow)
 *   venue          - the Location contact for the event venue
 *   event-main     - the main-event Event attached to the Job
 */
export type VscoEntityKind =
  | "job"
  | "order"
  | "contact-poc"
  | "contact-partner-a"
  | "contact-partner-b"
  | "venue"
  | "event-main";

export interface VscoEntityRow {
  external_uuid: string;
  kind: VscoEntityKind;
  vsco_id: string;
  created_at: string;
}

export function recordVscoEntity(
  externalUuid: string,
  kind: VscoEntityKind,
  vscoId: string,
): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO vsco_entities (external_uuid, kind, vsco_id)
       VALUES (?, ?, ?)`,
    )
    .run(externalUuid, kind, vscoId);
}

export function recordVscoEntities(
  externalUuid: string,
  entities: Array<{ kind: VscoEntityKind; vscoId: string }>,
): void {
  if (entities.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO vsco_entities (external_uuid, kind, vsco_id)
     VALUES (?, ?, ?)`,
  );
  const tx = db.transaction(
    (rows: Array<{ kind: VscoEntityKind; vscoId: string }>) => {
      for (const r of rows) stmt.run(externalUuid, r.kind, r.vscoId);
    },
  );
  tx(entities);
}

export function getVscoEntities(externalUuid: string): VscoEntityRow[] {
  return getDb()
    .prepare<[string], VscoEntityRow>(
      "SELECT * FROM vsco_entities WHERE external_uuid = ?",
    )
    .all(externalUuid) as VscoEntityRow[];
}

export function getVscoEntityId(
  externalUuid: string,
  kind: VscoEntityKind,
): string | null {
  const row = getDb()
    .prepare<[string, string], { vsco_id: string }>(
      "SELECT vsco_id FROM vsco_entities WHERE external_uuid = ? AND kind = ?",
    )
    .get(externalUuid, kind);
  return row?.vsco_id ?? null;
}

export type VscoPushTrigger =
  | "inquiry-create"
  | "inquiry-update"
  | "builder-create"
  | "qualify"
  | "manual";

export type VscoPushVerdict = "ok" | "failed" | "skipped";

export interface VscoPushInput {
  external_uuid?: string | null;
  inquiry_id?: number | null;
  builder_id?: number | null;
  trigger: VscoPushTrigger;
  verdict: VscoPushVerdict;
  http_status?: number | null;
  error_body?: string | null;
  duration_ms?: number | null;
  notes?: string | null;
}

export function recordVscoPush(input: VscoPushInput): void {
  getDb()
    .prepare(
      `INSERT INTO vsco_pushes (
         external_uuid, inquiry_id, builder_id,
         trigger, verdict, http_status, error_body,
         duration_ms, notes
       ) VALUES (
         @external_uuid, @inquiry_id, @builder_id,
         @trigger, @verdict, @http_status, @error_body,
         @duration_ms, @notes
       )`,
    )
    .run({
      external_uuid: input.external_uuid ?? null,
      inquiry_id: input.inquiry_id ?? null,
      builder_id: input.builder_id ?? null,
      trigger: input.trigger,
      verdict: input.verdict,
      http_status: input.http_status ?? null,
      error_body: input.error_body ?? null,
      duration_ms: input.duration_ms ?? null,
      notes: input.notes ?? null,
    });
}

export interface VscoPushRow {
  id: number;
  created_at: string;
  external_uuid: string | null;
  inquiry_id: number | null;
  builder_id: number | null;
  trigger: VscoPushTrigger;
  verdict: VscoPushVerdict;
  http_status: number | null;
  error_body: string | null;
  duration_ms: number | null;
  notes: string | null;
}

export function getVscoPushesForInquiry(inquiryId: number): VscoPushRow[] {
  return getDb()
    .prepare<[number], VscoPushRow>(
      "SELECT * FROM vsco_pushes WHERE inquiry_id = ? ORDER BY created_at DESC, id DESC",
    )
    .all(inquiryId) as VscoPushRow[];
}

/**
 * Push audit history scoped to a specific builder submission. Used by the
 * builder admin detail page to show retry attempts inline. Mirrors
 * getVscoPushesForInquiry() in shape.
 */
export function getVscoPushesForBuilder(submissionId: number): VscoPushRow[] {
  return getDb()
    .prepare<[number], VscoPushRow>(
      "SELECT * FROM vsco_pushes WHERE builder_id = ? ORDER BY created_at DESC, id DESC",
    )
    .all(submissionId) as VscoPushRow[];
}

/**
 * Set `qualified_at = CURRENT_TIMESTAMP` on an inquiry. Returns the new
 * timestamp on success, or null when the row doesn't exist or was already
 * qualified.
 *
 * This is the gate for VSCO sync: until an inquiry is qualified, no data
 * pushes outbound. Idempotent — re-qualifying a row is a no-op.
 */
export function markInquiryQualified(id: number): string | null {
  const db = getDb();
  const result = db
    .prepare(
      "UPDATE inquiries SET qualified_at = CURRENT_TIMESTAMP WHERE id = ? AND qualified_at IS NULL",
    )
    .run(id);
  if (result.changes === 0) return null;
  const row = db
    .prepare<[number], { qualified_at: string }>(
      "SELECT qualified_at FROM inquiries WHERE id = ?",
    )
    .get(id);
  return row?.qualified_at ?? null;
}
