/**
 * CRUD for the `package_builder_submissions` table.
 *
 * Every function takes the Database instance explicitly so unit tests can
 * inject an in-memory DB. Production callers use `getDb()` from `@/lib/db`.
 */

import type Database from "better-sqlite3";

export type SubmissionStatus = "new" | "invoice_sent";
export type SubmissionSource = "invited-builder" | "cold-builder";
export type ConsultationPref = "video" | "in_person" | "none";

export interface PackageBuilderSubmissionRow {
  id: number;
  created_at: string;
  status: SubmissionStatus;
  invoice_sent_at: string | null;
  source: SubmissionSource;

  first_name: string;
  last_name: string;
  email: string;
  phone: string;

  inquiry_id: number | null;
  invite_token: string | null;

  event_date: string | null;
  event_type: string | null;
  venue: string | null;
  guest_count: number | null;
  consultation_pref: ConsultationPref | null;
  client_note: string | null;

  /** JSON-stringified BuilderSelections from compute.ts. */
  selections_json: string;
  fixed_subtotal_cents: number;
  /** JSON-stringified CustomQuotedItem[] from compute.ts. */
  custom_quoted_json: string | null;
  /** JSON-stringified BuilderWarning[] from compute.ts. */
  warnings_json: string | null;

  notes: string | null;

  /** Structured venue address (from Google Places autocomplete). */
  venue_street_address: string | null;
  venue_city: string | null;
  venue_state: string | null;
  venue_postal_code: string | null;
  venue_country: string | null;
  venue_latitude: number | null;
  venue_longitude: number | null;
}

/**
 * Insert input — every field a caller must (or may) supply. `status`,
 * `invoice_sent_at`, `notes`, `id`, and `created_at` are server-managed
 * and never accepted from the caller.
 */
export interface PackageBuilderSubmissionInput {
  source: SubmissionSource;

  first_name: string;
  last_name: string;
  email: string;
  phone: string;

  inquiry_id: number | null;
  invite_token: string | null;

  event_date: string | null;
  event_type: string | null;
  venue: string | null;
  guest_count: number | null;
  consultation_pref: ConsultationPref | null;
  client_note: string | null;

  selections_json: string;
  fixed_subtotal_cents: number;
  custom_quoted_json: string | null;
  warnings_json: string | null;

  /** Optional venue address fields (from Places autocomplete). */
  venue_street_address?: string | null;
  venue_city?: string | null;
  venue_state?: string | null;
  venue_postal_code?: string | null;
  venue_country?: string | null;
  venue_latitude?: number | null;
  venue_longitude?: number | null;
}

export function insertSubmission(
  db: Database.Database,
  input: PackageBuilderSubmissionInput,
): { id: number; createdAt: string } {
  const result = db
    .prepare(
      `INSERT INTO package_builder_submissions (
        source,
        first_name, last_name, email, phone,
        inquiry_id, invite_token,
        event_date, event_type, venue, guest_count,
        consultation_pref, client_note,
        selections_json, fixed_subtotal_cents,
        custom_quoted_json, warnings_json,
        venue_street_address, venue_city, venue_state, venue_postal_code,
        venue_country, venue_latitude, venue_longitude
      ) VALUES (
        @source,
        @first_name, @last_name, @email, @phone,
        @inquiry_id, @invite_token,
        @event_date, @event_type, @venue, @guest_count,
        @consultation_pref, @client_note,
        @selections_json, @fixed_subtotal_cents,
        @custom_quoted_json, @warnings_json,
        @venue_street_address, @venue_city, @venue_state, @venue_postal_code,
        @venue_country, @venue_latitude, @venue_longitude
      )`,
    )
    .run({
      ...input,
      venue_street_address: input.venue_street_address ?? null,
      venue_city: input.venue_city ?? null,
      venue_state: input.venue_state ?? null,
      venue_postal_code: input.venue_postal_code ?? null,
      venue_country: input.venue_country ?? null,
      venue_latitude: input.venue_latitude ?? null,
      venue_longitude: input.venue_longitude ?? null,
    });

  const id = Number(result.lastInsertRowid);
  const row = db
    .prepare<[number], { created_at: string }>(
      "SELECT created_at FROM package_builder_submissions WHERE id = ?",
    )
    .get(id);
  return { id, createdAt: row?.created_at ?? new Date().toISOString() };
}

export function getSubmission(
  db: Database.Database,
  id: number,
): PackageBuilderSubmissionRow | undefined {
  return db
    .prepare("SELECT * FROM package_builder_submissions WHERE id = ?")
    .get(id) as PackageBuilderSubmissionRow | undefined;
}

export function getAllSubmissions(db: Database.Database): PackageBuilderSubmissionRow[] {
  return db
    .prepare("SELECT * FROM package_builder_submissions ORDER BY created_at DESC, id DESC")
    .all() as PackageBuilderSubmissionRow[];
}

/**
 * Flip status. Side effect: setting status to `invoice_sent` stamps
 * `invoice_sent_at = CURRENT_TIMESTAMP`; reverting to `new` clears it.
 * Returns false if no row matches the id.
 */
export function updateSubmissionStatus(
  db: Database.Database,
  id: number,
  status: SubmissionStatus,
): boolean {
  if (status === "invoice_sent") {
    const r = db
      .prepare(
        `UPDATE package_builder_submissions
         SET status = 'invoice_sent', invoice_sent_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(id);
    return r.changes > 0;
  }
  const r = db
    .prepare(
      `UPDATE package_builder_submissions
       SET status = 'new', invoice_sent_at = NULL
       WHERE id = ?`,
    )
    .run(id);
  return r.changes > 0;
}

export function updateSubmissionNotes(
  db: Database.Database,
  id: number,
  notes: string,
): boolean {
  const r = db
    .prepare("UPDATE package_builder_submissions SET notes = ? WHERE id = ?")
    .run(notes, id);
  return r.changes > 0;
}

/**
 * Soft-link lookup for cold submissions. Returns the id of the most recently
 * created `inquiries` row whose email matches (case-sensitive — matches the
 * existing inquiries-table convention), or null if none.
 */
export function findInquiryIdByEmail(
  db: Database.Database,
  email: string,
): number | null {
  const row = db
    .prepare<[string], { id: number }>(
      "SELECT id FROM inquiries WHERE email = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .get(email);
  return row?.id ?? null;
}

/* ============================================================================
 * Convenience aliases consumed by Cluster D (API endpoints) and Cluster F
 * (admin pages). These wrap the canonical names above so callers can use the
 * semantic verbs the inter-cluster contracts prescribed without forcing this
 * module's public API to change. Keep both names; they're equivalent.
 * ========================================================================== */

export const listSubmissions = getAllSubmissions;

export function markInvoiceSent(db: Database.Database, id: number): boolean {
  return updateSubmissionStatus(db, id, "invoice_sent");
}

export function revertToNew(db: Database.Database, id: number): boolean {
  return updateSubmissionStatus(db, id, "new");
}
