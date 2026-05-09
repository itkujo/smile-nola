import { collectionLabel, type HydratedLead } from "./schema";

/**
 * HoneyBook CSV exporter.
 *
 * HoneyBook accepts CSV imports for contacts. Their canonical contact import
 * fields (verified against current import flow): First Name, Last Name, Email,
 * Phone, plus arbitrary additional columns that pass through as notes-style
 * data. We map our richer shape into a clean import-friendly format and
 * collapse the rest into a structured Notes field that's easy to read in
 * HoneyBook's contact view.
 *
 * If HoneyBook's column names change, only this file needs to update.
 */

interface Row {
  "First Name": string;
  "Last Name": string;
  Email: string;
  Phone: string;
  "Project Name": string;
  "Event Date": string;
  "Event Type": string;
  Source: string;
  Setting: string;
  "Preferred Contact": string;
  "POC Relationship": string;
  Venue: string;
  "Services Interested": string;
  Notes: string;
  "Captured At": string;
}

const COLUMNS: (keyof Row)[] = [
  "First Name",
  "Last Name",
  "Email",
  "Phone",
  "Project Name",
  "Event Date",
  "Event Type",
  "Source",
  "Setting",
  "Preferred Contact",
  "POC Relationship",
  "Venue",
  "Services Interested",
  "Notes",
  "Captured At",
];

function splitName(full: string): [string, string] {
  const cleaned = full.trim().replace(/\s+/g, " ");
  if (!cleaned) return ["", ""];
  const parts = cleaned.split(" ");
  if (parts.length === 1) return [parts[0], ""];
  const first = parts[0];
  const last = parts.slice(1).join(" ");
  return [first, last];
}

function escapeField(value: string): string {
  // RFC 4180: wrap in quotes if contains comma, quote, CR, or LF; double-up quotes.
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function projectName(p1: string, p2: string | null | undefined): string {
  const left = p1.trim();
  const right = (p2 ?? "").trim();
  if (right) return `${left} & ${right} Wedding`;
  return `${left} Wedding`;
}

function leadToRow(lead: HydratedLead): Row {
  const [first, last] = splitName(lead.pocName);
  const services = lead.collectionsInterested.map(collectionLabel).join(", ");
  return {
    "First Name": first,
    "Last Name": last,
    Email: lead.pocEmail,
    Phone: lead.pocPhone,
    "Project Name": projectName(lead.partner1Name, lead.partner2Name),
    "Event Date": lead.eventDate,
    "Event Type": "Wedding",
    Source: lead.source,
    Setting: lead.setting,
    "Preferred Contact": lead.preferredContact,
    "POC Relationship": lead.pocRelationship,
    Venue: lead.venueName ?? "",
    "Services Interested": services,
    Notes: lead.notes ?? "",
    "Captured At": lead.capturedAt,
  };
}

/** Render an array of leads as a HoneyBook-friendly CSV string. */
export function leadsToHoneybookCsv(leads: HydratedLead[]): string {
  const header = COLUMNS.map(escapeField).join(",");
  const lines = leads.map((lead) => {
    const row = leadToRow(lead);
    return COLUMNS.map((c) => escapeField(String(row[c] ?? ""))).join(",");
  });
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
