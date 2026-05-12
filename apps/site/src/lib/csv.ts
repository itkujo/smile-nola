/**
 * CSV export for the marketing-site inquiries table.
 *
 * Columns are deliberately shaped to be HoneyBook-importable: First Name /
 * Last Name / Email / Phone / Event Date / Event Type / Venue / Project
 * Name / Notes are the canonical HoneyBook headers. Marketing-site extras
 * (Source, Status, Guest Count, Budget Range, Collections Interested,
 * Referral, Admin Notes, Captured At) are appended and ignored by
 * HoneyBook's importer.
 *
 * The booth intake at apps/intake/lib/csv.ts uses the same shape — same
 * leading columns — so admin tooling can treat both stores uniformly.
 */

import type { InquiryRow } from "@/lib/db";
import { inquiryProjectName } from "@/lib/project-name";

interface Column {
  header: string;
  value: (row: InquiryRow) => string;
}

function escape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseJsonArray(raw: string | null): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.join(", ") : "";
  } catch {
    return "";
  }
}

function summarizeCollectionFields(raw: string | null): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return "";
    const lines: string[] = [];
    for (const [slug, fields] of Object.entries(parsed as Record<string, unknown>)) {
      if (!fields || typeof fields !== "object") continue;
      const inner: string[] = [];
      for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
        if (v === null || v === undefined || v === "") continue;
        inner.push(`${k}: ${String(v)}`);
      }
      if (inner.length > 0) {
        lines.push(`[${slug}] ${inner.join("; ")}`);
      }
    }
    return lines.join(" | ");
  } catch {
    return "";
  }
}

const COLUMNS: Column[] = [
  // ---- HoneyBook canonical columns ---------------------------------------
  { header: "First Name",     value: (r) => r.first_name },
  { header: "Last Name",      value: (r) => r.last_name },
  { header: "Email",          value: (r) => r.email },
  { header: "Phone",          value: (r) => r.phone },
  // Canonical project name shared with email subjects, admin UI, and the
  // booth CSV. Same string lands in HoneyBook's project name field whether
  // the row comes in via Zapier or a manual CSV import.
  { header: "Project Name",   value: (r) => inquiryProjectName(r) },
  // The canonical id. Zapier writes it as HoneyBook external_id; CSV
  // imports preserve it so later cross-references still match.
  { header: "Project ID",     value: (r) => String(r.id) },
  { header: "Event Date",     value: (r) => r.event_date ?? "" },
  { header: "Event Type",     value: (r) => r.event_type ?? "" },
  { header: "Venue",          value: (r) => r.venue ?? "" },
  { header: "Notes",          value: (r) => r.message ?? "" },

  // ---- Booth-origin columns (NULL on non-booth rows, identical headers
  // ---- as apps/intake/lib/csv.ts so unified mapping works) ----------------
  { header: "Partner 1",        value: (r) => r.partner1_name ?? "" },
  { header: "Partner 2",        value: (r) => r.partner2_name ?? "" },
  { header: "Event Setting",    value: (r) => r.event_setting ?? "" },
  { header: "POC Relationship", value: (r) => r.poc_relationship ?? "" },

  // ---- Smile NOLA marketing-site extras ----------------------------------
  { header: "Source",                value: (r) => r.source },
  { header: "Status",                value: (r) => r.status },
  { header: "Preferred Contact",     value: (r) => r.preferred_contact ?? "" },
  { header: "Guest Count",           value: (r) => (r.guest_count == null ? "" : String(r.guest_count)) },
  { header: "Event Start",           value: (r) => r.event_start ?? "" },
  { header: "Event End",             value: (r) => r.event_end ?? "" },
  { header: "Planner",               value: (r) => r.planner ?? "" },
  { header: "Budget Range",          value: (r) => r.budget_range ?? "" },
  { header: "Collections Interested", value: (r) => parseJsonArray(r.collections_interested) },
  { header: "Collection Detail",      value: (r) => summarizeCollectionFields(r.collection_fields_json) },
  { header: "Referral",              value: (r) => r.referral ?? "" },
  { header: "Admin Notes",           value: (r) => r.notes ?? "" },
  { header: "External UUID",         value: (r) => r.external_uuid ?? "" },
  { header: "Captured At",           value: (r) => r.created_at },
  { header: "Inquiry ID",            value: (r) => String(r.id) },
];

/** Render the rows as a HoneyBook-friendly CSV string (RFC 4180 + UTF-8 BOM). */
export function inquiriesToCsv(rows: InquiryRow[]): string {
  const header = COLUMNS.map((c) => escape(c.header)).join(",");
  const lines = rows.map((row) =>
    COLUMNS.map((c) => escape(c.value(row))).join(",")
  );
  return "\uFEFF" + [header, ...lines].join("\r\n") + "\r\n";
}

/** Filename like smile-nola-inquiries-2026-05-10.csv */
export function csvFilename(now: Date = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `smile-nola-inquiries-${yyyy}-${mm}-${dd}.csv`;
}
