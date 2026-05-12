import { collectionLabel, type HydratedLead } from "./schema";

/**
 * HoneyBook CSV exporter.
 *
 * One column per data point. We keep auto-derived columns (split First/Last
 * name, "[Partner 1] & [Partner 2] Wedding" project name, joined Services
 * Interested) AS WELL AS the raw underlying columns so you can map either
 * one to HoneyBook custom fields without losing fidelity.
 *
 * Easy to extend: add a new column to COLUMN_DEFS and the export updates.
 */

interface ColumnDef {
  /** Column header as it appears in the CSV. */
  header: string;
  /** How to derive the cell value from a hydrated lead. */
  value: (lead: HydratedLead) => string;
}

function splitName(full: string): [string, string] {
  const cleaned = full.trim().replace(/\s+/g, " ");
  if (!cleaned) return ["", ""];
  const parts = cleaned.split(" ");
  if (parts.length === 1) return [parts[0], ""];
  const first = parts[0];
  const last = parts.slice(1).join(" ");
  return [first, last];
}

/**
 * Canonical project-name format for HoneyBook. MUST match the format
 * emitted by apps/site/src/lib/project-name.ts so the same string
 * appears in:
 *   - Email subjects (Zapier filter)
 *   - Admin detail pages
 *   - This CSV's "Project Name" column
 *
 * Format: Wedding \u00b7 Partner1 & Partner2 \u00b7 YYYY-MM-DD #<id>
 *
 * Falls back gracefully when partners are blank (uses the poc name)
 * and when event_date is empty (writes 'TBD'). The id always renders
 * so even the worst data still produces a uniquely identifiable row.
 */
function projectName(lead: HydratedLead): string {
  const p1 = lead.partner1Name.trim();
  const p2 = (lead.partner2Name ?? "").trim();
  let partners: string;
  if (p1 && p2) partners = `${p1} & ${p2}`;
  else if (p1) partners = p1;
  else {
    const poc = lead.pocName.trim();
    partners = poc || "(unknown)";
  }
  const date = lead.eventDate.trim() || "TBD";
  return `Wedding \u00b7 ${partners} \u00b7 ${date} #${lead.id}`;
}

function escapeField(value: string): string {
  // RFC 4180: wrap in quotes if contains comma, quote, CR, or LF; double-up quotes.
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const COLUMN_DEFS: ColumnDef[] = [
  // --- Identity / contact ----------------------------------------------------
  { header: "POC Name", value: (l) => l.pocName },
  { header: "First Name", value: (l) => splitName(l.pocName)[0] },
  { header: "Last Name", value: (l) => splitName(l.pocName)[1] },
  { header: "Email", value: (l) => l.pocEmail },
  { header: "Phone", value: (l) => l.pocPhone },
  { header: "POC Relationship", value: (l) => l.pocRelationship },
  { header: "Preferred Contact", value: (l) => l.preferredContact },

  // --- The couple ------------------------------------------------------------
  { header: "Partner 1", value: (l) => l.partner1Name },
  { header: "Partner 2", value: (l) => l.partner2Name ?? "" },

  // --- The event -------------------------------------------------------------
  { header: "Project Name", value: (l) => projectName(l) },
  // The canonical id is the ANCHOR for cross-platform identification.
  // Zapier writes it into HoneyBook's external_id; HoneyBook displays it
  // in the project name; this column lets a human-run import preserve it.
  { header: "Project ID", value: (l) => String(l.id) },
  { header: "Event Date", value: (l) => l.eventDate },
  { header: "Event Type", value: () => "Wedding" },
  { header: "Venue", value: (l) => l.venueName ?? "" },
  { header: "Setting", value: (l) => l.setting },

  // --- Vision ----------------------------------------------------------------
  {
    header: "Services Interested",
    value: (l) => l.collectionsInterested.map(collectionLabel).join(", "),
  },
  { header: "Notes", value: (l) => l.notes ?? "" },

  // --- Provenance ------------------------------------------------------------
  { header: "Source", value: (l) => l.source },
  { header: "Captured At", value: (l) => l.capturedAt },
];

/** Render an array of leads as a HoneyBook-friendly CSV string. */
export function leadsToHoneybookCsv(leads: HydratedLead[]): string {
  const header = COLUMN_DEFS.map((c) => escapeField(c.header)).join(",");
  const lines = leads.map((lead) =>
    COLUMN_DEFS.map((c) => escapeField(String(c.value(lead) ?? ""))).join(","),
  );
  // BOM helps Excel detect UTF-8
  return "\uFEFF" + [header, ...lines].join("\r\n") + "\r\n";
}

/** Filename like smile-nola-leads-2026-05-09.csv */
export function csvFilename(now: Date = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `smile-nola-leads-${yyyy}-${mm}-${dd}.csv`;
}
