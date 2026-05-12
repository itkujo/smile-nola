import crypto from "node:crypto";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  type HydratedLead,
  type Lead,
  SOURCE_DEFAULT,
} from "./schema";

/**
 * SQLite singleton — the booth intake writes captured leads to the SAME
 * `inquiries` table the marketing site uses. The unified schema is owned
 * by apps/site/src/lib/db.ts (which the marketing site invokes on its own
 * startup); we deliberately do NOT re-declare the table here.
 *
 * The booth distinguishes its rows via `source = 'booth-expo'`. Every other
 * column the booth needs lives on inquiries already (partner1_name,
 * partner2_name, event_setting, poc_relationship, deleted_at) thanks to the
 * Phase 1.1 migration.
 *
 * If the booth boots before the marketing site has run against the DB,
 * we still need the `inquiries` table to exist. We CREATE TABLE IF NOT
 * EXISTS with a minimal column set — the site's bootstrapSchema() will
 * ALTER in any newer columns when it runs. The schema kept here MUST
 * stay a superset of what the booth actually writes; nothing else.
 *
 * The legacy `leads` table is left untouched in production databases.
 * Its rows were copied into `inquiries` by the site's one-shot data
 * migration (migrateLeadsIntoInquiries). The booth no longer reads or
 * writes `leads`.
 */

const DB_DIR =
  process.env.SMILE_NOLA_DB_DIR ??
  path.join(process.cwd(), "..", "..", "data");

const DB_PATH = path.join(DB_DIR, "leads.db");

declare global {
  // eslint-disable-next-line no-var
  var __sn_db: Database.Database | undefined;
}

const BOOTH_SOURCE = "booth-expo";

/** Booth-coded SQL snippet for "select only booth captures, hide deleted ones." */
const BOOTH_WHERE = "source = 'booth-expo' AND deleted_at IS NULL";

function open(): Database.Database {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Minimal bootstrap. If the marketing site has booted at least once
  // against this DB, the full unified schema is already present and this
  // is a no-op. If the booth runs first on a fresh machine, this gets
  // us a usable inquiries table with the columns we write.
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
      partner1_name          TEXT,
      partner2_name          TEXT,
      event_setting          TEXT,
      poc_relationship       TEXT,
      external_uuid          TEXT,
      synced_at              TEXT,
      source_legacy_id       INTEGER,
      deleted_at             TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_inq_created_at ON inquiries(created_at);
    CREATE INDEX IF NOT EXISTS idx_inq_source     ON inquiries(source);
    CREATE INDEX IF NOT EXISTS idx_inq_deleted_at ON inquiries(deleted_at);
  `);

  return db;
}

export function getDb(): Database.Database {
  if (!global.__sn_db) {
    global.__sn_db = open();
  }
  return global.__sn_db;
}

interface InquiryBoothRow {
  id: number;
  created_at: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  poc_relationship: string | null;
  preferred_contact: string | null;
  partner1_name: string | null;
  partner2_name: string | null;
  event_date: string | null;
  venue: string | null;
  event_setting: string | null;
  collections_interested: string | null;
  notes: string | null;
  source: string;
  deleted_at: string | null;
}

function rowToHydratedLead(row: InquiryBoothRow): HydratedLead {
  let collections: HydratedLead["collectionsInterested"] = [];
  if (row.collections_interested) {
    try {
      const parsed = JSON.parse(row.collections_interested);
      if (Array.isArray(parsed)) {
        collections = parsed as HydratedLead["collectionsInterested"];
      }
    } catch {
      /* malformed; show empty */
    }
  }
  // Recompose the booth's `pocName` from first_name + last_name. The
  // migration deliberately split it on the first space; rejoining with a
  // single space is the lossless inverse.
  const pocName = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return {
    id: row.id,
    capturedAt: row.created_at,
    pocName: pocName || row.first_name,
    pocEmail: row.email,
    pocPhone: row.phone,
    pocRelationship: row.poc_relationship ?? "",
    preferredContact: row.preferred_contact ?? "",
    partner1Name: row.partner1_name ?? "",
    partner2Name: row.partner2_name,
    eventDate: row.event_date ?? "",
    venueName: row.venue,
    setting: row.event_setting ?? "",
    collectionsInterested: collections,
    notes: row.notes,
    source: row.source,
    deletedAt: row.deleted_at,
  };
}

const insertStmt = () =>
  getDb().prepare(`
    INSERT INTO inquiries (
      created_at, source, status,
      first_name, last_name, email, phone,
      preferred_contact, event_date, event_type, venue,
      collections_interested, notes,
      partner1_name, partner2_name, event_setting, poc_relationship,
      external_uuid
    ) VALUES (
      @created_at, '${BOOTH_SOURCE}', 'new',
      @first_name, @last_name, @email, @phone,
      @preferred_contact, @event_date, 'wedding', @venue,
      @collections_interested, @notes,
      @partner1_name, @partner2_name, @event_setting, @poc_relationship,
      @external_uuid
    )
  `);

/**
 * Insert a booth-captured lead into `inquiries` with `source='booth-expo'`.
 *
 * Returns the autoincrement id (so the booth admin can keep working with
 * numeric ids) AND the capturedAt timestamp (returned as ISO 8601 for
 * frontend display).
 *
 * The `external_uuid` field is populated here so Phase 2's booth->prod sync
 * has a canonical cross-machine id from the moment of capture. Resilient to
 * an offline booth: even if this row never gets pushed to prod, it has a
 * stable id locally.
 */
export function insertLead(lead: Lead): { id: number; capturedAt: string } {
  const capturedAt = new Date().toISOString();

  // Mirror the same poc_name -> first_name/last_name split the data
  // migration uses for legacy rows. Keeps both intake paths consistent.
  const trimmed = lead.pocName.trim();
  const spaceIdx = trimmed.indexOf(" ");
  const firstName = spaceIdx >= 0 ? trimmed.slice(0, spaceIdx) : trimmed;
  const lastName = spaceIdx >= 0 ? trimmed.slice(spaceIdx + 1).trim() : "";

  const result = insertStmt().run({
    created_at: capturedAt,
    first_name: firstName || "(unknown)",
    last_name: lastName,
    email: lead.pocEmail,
    phone: lead.pocPhone,
    preferred_contact: lead.preferredContact,
    event_date: lead.eventDate,
    venue: lead.venueName ?? null,
    collections_interested: JSON.stringify(lead.collectionsInterested),
    notes: lead.notes ?? null,
    partner1_name: lead.partner1Name,
    partner2_name: lead.partner2Name ?? null,
    event_setting: lead.setting,
    poc_relationship: lead.pocRelationship,
    external_uuid: crypto.randomUUID(),
  });

  // SOURCE_DEFAULT is kept exported for the existing UI strings ("New
  // Orleans Bridal and Wedding Expo" label on the admin page). The
  // database normalizes to 'booth-expo' regardless.
  void SOURCE_DEFAULT;

  return { id: Number(result.lastInsertRowid), capturedAt };
}

export function getAllLeads({
  includeDeleted = false,
}: { includeDeleted?: boolean } = {}): HydratedLead[] {
  const where = includeDeleted
    ? "source = 'booth-expo'"
    : BOOTH_WHERE;
  const rows = getDb()
    .prepare(
      `SELECT id, created_at, first_name, last_name, email, phone,
              poc_relationship, preferred_contact,
              partner1_name, partner2_name, event_date, venue,
              event_setting, collections_interested, notes, source, deleted_at
       FROM inquiries
       WHERE ${where}
       ORDER BY created_at DESC`,
    )
    .all() as InquiryBoothRow[];
  return rows.map(rowToHydratedLead);
}

export function softDeleteLead(id: number): boolean {
  const result = getDb()
    .prepare(
      `UPDATE inquiries SET deleted_at = ?
       WHERE id = ? AND ${BOOTH_WHERE}`,
    )
    .run(new Date().toISOString(), id);
  return result.changes > 0;
}

export function restoreLead(id: number): boolean {
  const result = getDb()
    .prepare(
      `UPDATE inquiries SET deleted_at = NULL
       WHERE id = ? AND source = 'booth-expo'`,
    )
    .run(id);
  return result.changes > 0;
}

export function leadCount(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM inquiries WHERE ${BOOTH_WHERE}`)
    .get() as { n: number };
  return row.n;
}
