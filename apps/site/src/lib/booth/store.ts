/**
 * Booth rows live in the shared `inquiries` table with source='booth-expo'.
 * Every function takes an optional Database so tests can pass :memory:.
 */

import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { getDb, type InquiryRow } from "@/lib/db";
import { BOOTH_SOURCE, type Lead } from "./schema";

let override: Database.Database | null = null;

/** Test hook: route every booth store call to this database (null restores the default). */
export function _setBoothDb(db: Database.Database | null): void {
  override = db;
}

export function boothDb(db?: Database.Database): Database.Database {
  return db ?? override ?? getDb();
}

const LIVE = `source = '${BOOTH_SOURCE}' AND deleted_at IS NULL`;

export interface BoothInquiry {
  id: number;
  externalUuid: string | null;
  createdAt: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  relationship: string | null;
  preferredContact: string | null;
  partner1Name: string | null;
  partner2Name: string | null;
  eventDate: string | null;
  venue: string | null;
  venueStreetAddress: string | null;
  venueCity: string | null;
  venueState: string | null;
  venuePostalCode: string | null;
  venueCountry: string | null;
  venueLatitude: number | null;
  venueLongitude: number | null;
  setting: string | null;
  collections: string[];
  notes: string | null;
  syncedAt: string | null;
  deletedAt: string | null;
}

export function rowToBoothInquiry(row: InquiryRow): BoothInquiry {
  let collections: string[] = [];
  if (row.collections_interested) {
    try {
      const parsed = JSON.parse(row.collections_interested);
      if (Array.isArray(parsed)) collections = parsed.map(String);
    } catch {
      /* malformed; show none */
    }
  }
  return {
    id: row.id,
    externalUuid: row.external_uuid,
    createdAt: row.created_at,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    relationship: row.poc_relationship,
    preferredContact: row.preferred_contact,
    partner1Name: row.partner1_name,
    partner2Name: row.partner2_name,
    eventDate: row.event_date,
    venue: row.venue,
    venueStreetAddress: row.venue_street_address,
    venueCity: row.venue_city,
    venueState: row.venue_state,
    venuePostalCode: row.venue_postal_code,
    venueCountry: row.venue_country,
    venueLatitude: row.venue_latitude,
    venueLongitude: row.venue_longitude,
    setting: row.event_setting,
    collections,
    notes: row.notes,
    syncedAt: row.synced_at,
    deletedAt: row.deleted_at,
  };
}

/** Insert one lead as source='booth-expo' with a fresh external_uuid. */
export function insertBoothLead(
  lead: Lead,
  db?: Database.Database,
): { id: number; externalUuid: string; createdAt: string } {
  const createdAt = new Date().toISOString();
  const externalUuid = crypto.randomUUID();

  // Same poc_name -> first/last split the booth always used.
  const trimmed = lead.pocName.trim();
  const spaceIdx = trimmed.indexOf(" ");
  const firstName = spaceIdx >= 0 ? trimmed.slice(0, spaceIdx) : trimmed;
  const lastName = spaceIdx >= 0 ? trimmed.slice(spaceIdx + 1).trim() : "";

  const result = boothDb(db)
    .prepare(
      `INSERT INTO inquiries (
         created_at, source, status,
         first_name, last_name, email, phone,
         preferred_contact, event_date, event_type, venue,
         collections_interested, notes,
         partner1_name, partner2_name, event_setting, poc_relationship,
         external_uuid,
         venue_street_address, venue_city, venue_state, venue_postal_code,
         venue_country, venue_latitude, venue_longitude
       ) VALUES (
         @created_at, '${BOOTH_SOURCE}', 'new',
         @first_name, @last_name, @email, @phone,
         @preferred_contact, @event_date, 'wedding', @venue,
         @collections_interested, @notes,
         @partner1_name, @partner2_name, @event_setting, @poc_relationship,
         @external_uuid,
         @venue_street_address, @venue_city, @venue_state, @venue_postal_code,
         @venue_country, @venue_latitude, @venue_longitude
       )`,
    )
    .run({
      created_at: createdAt,
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
      external_uuid: externalUuid,
      venue_street_address: lead.venueStreetAddress ?? null,
      venue_city: lead.venueCity ?? null,
      venue_state: lead.venueState ?? null,
      venue_postal_code: lead.venuePostalCode ?? null,
      venue_country: lead.venueCountry ?? null,
      venue_latitude: lead.venueLatitude ?? null,
      venue_longitude: lead.venueLongitude ?? null,
    });

  return { id: Number(result.lastInsertRowid), externalUuid, createdAt };
}

/** Live booth rows, newest first (by id), strictly before `beforeId` when given. */
export function listBoothInquiries(
  opts: { take: number; beforeId?: number },
  db?: Database.Database,
): BoothInquiry[] {
  const rows = boothDb(db)
    .prepare(
      `SELECT * FROM inquiries
       WHERE ${LIVE} AND (@before IS NULL OR id < @before)
       ORDER BY id DESC
       LIMIT @take`,
    )
    .all({ before: opts.beforeId ?? null, take: opts.take }) as InquiryRow[];
  return rows.map(rowToBoothInquiry);
}

/** Every live booth row as raw inquiry rows (CSV export), oldest first. */
export function allBoothRows(db?: Database.Database): InquiryRow[] {
  return boothDb(db)
    .prepare(`SELECT * FROM inquiries WHERE ${LIVE} ORDER BY created_at ASC, id ASC`)
    .all() as InquiryRow[];
}

/** Soft delete. Returns the row, or null when there is no live booth row with that id. */
export function softDeleteBoothInquiry(id: number, db?: Database.Database): BoothInquiry | null {
  const d = boothDb(db);
  const res = d
    .prepare(`UPDATE inquiries SET deleted_at = ? WHERE id = ? AND ${LIVE}`)
    .run(new Date().toISOString(), id);
  if (res.changes === 0) return null;
  const row = d.prepare("SELECT * FROM inquiries WHERE id = ?").get(id) as InquiryRow;
  return rowToBoothInquiry(row);
}

export function boothCounts(db?: Database.Database): { total: number; pending: number; synced: number } {
  return boothDb(db)
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN synced_at IS NULL THEN 1 ELSE 0 END), 0) AS pending,
              COALESCE(SUM(CASE WHEN synced_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS synced
       FROM inquiries WHERE ${LIVE}`,
    )
    .get() as { total: number; pending: number; synced: number };
}
