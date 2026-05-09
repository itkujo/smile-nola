import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  hydrate,
  type HydratedLead,
  type Lead,
  type LeadRow,
  SOURCE_DEFAULT,
} from "./schema";

/**
 * SQLite singleton. Database lives at <repo-root>/data/leads.db so it
 * survives `next build` and lives outside the app folder.
 */

const DB_DIR =
  process.env.SMILE_NOLA_DB_DIR ??
  path.join(process.cwd(), "..", "..", "data");

const DB_PATH = path.join(DB_DIR, "leads.db");

declare global {
  // eslint-disable-next-line no-var
  var __sn_db: Database.Database | undefined;
}

function open(): Database.Database {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      captured_at TEXT NOT NULL,
      poc_name TEXT NOT NULL,
      poc_email TEXT NOT NULL,
      poc_phone TEXT NOT NULL,
      poc_relationship TEXT NOT NULL,
      preferred_contact TEXT NOT NULL,
      partner1_name TEXT NOT NULL,
      partner2_name TEXT,
      event_date TEXT NOT NULL,
      venue_name TEXT,
      setting TEXT NOT NULL,
      collections_interested TEXT NOT NULL,
      notes TEXT,
      source TEXT NOT NULL DEFAULT '${SOURCE_DEFAULT.replace(/'/g, "''")}',
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_leads_captured_at ON leads(captured_at);
    CREATE INDEX IF NOT EXISTS idx_leads_deleted_at ON leads(deleted_at);
  `);
  return db;
}

export function getDb(): Database.Database {
  if (!global.__sn_db) {
    global.__sn_db = open();
  }
  return global.__sn_db;
}

const insertStmt = () =>
  getDb().prepare<unknown[], LeadRow>(`
    INSERT INTO leads (
      captured_at, poc_name, poc_email, poc_phone, poc_relationship,
      preferred_contact, partner1_name, partner2_name, event_date,
      venue_name, setting, collections_interested, notes, source
    ) VALUES (
      @captured_at, @poc_name, @poc_email, @poc_phone, @poc_relationship,
      @preferred_contact, @partner1_name, @partner2_name, @event_date,
      @venue_name, @setting, @collections_interested, @notes, @source
    )
  `);

export function insertLead(lead: Lead): { id: number; capturedAt: string } {
  const capturedAt = new Date().toISOString();
  const result = insertStmt().run({
    captured_at: capturedAt,
    poc_name: lead.pocName,
    poc_email: lead.pocEmail,
    poc_phone: lead.pocPhone,
    poc_relationship: lead.pocRelationship,
    preferred_contact: lead.preferredContact,
    partner1_name: lead.partner1Name,
    partner2_name: lead.partner2Name ?? null,
    event_date: lead.eventDate,
    venue_name: lead.venueName ?? null,
    setting: lead.setting,
    collections_interested: JSON.stringify(lead.collectionsInterested),
    notes: lead.notes ?? null,
    source: SOURCE_DEFAULT,
  });
  return { id: Number(result.lastInsertRowid), capturedAt };
}

export function getAllLeads({
  includeDeleted = false,
}: { includeDeleted?: boolean } = {}): HydratedLead[] {
  const where = includeDeleted ? "" : "WHERE deleted_at IS NULL";
  const rows = getDb()
    .prepare<unknown[], LeadRow>(
      `SELECT * FROM leads ${where} ORDER BY captured_at DESC`,
    )
    .all() as LeadRow[];
  return rows.map(hydrate);
}

export function softDeleteLead(id: number): boolean {
  const result = getDb()
    .prepare(`UPDATE leads SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`)
    .run(new Date().toISOString(), id);
  return result.changes > 0;
}

export function restoreLead(id: number): boolean {
  const result = getDb()
    .prepare(`UPDATE leads SET deleted_at = NULL WHERE id = ?`)
    .run(id);
  return result.changes > 0;
}

export function leadCount(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) as n FROM leads WHERE deleted_at IS NULL`)
    .get() as { n: number };
  return row.n;
}
