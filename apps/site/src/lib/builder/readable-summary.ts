/**
 * Renders a package builder submission + its recomputed ComputeResult into the
 * plain-text and HTML email bodies the notification helper sends. Pure
 * functions — safe to unit test and to call from anywhere.
 *
 * Field grouping mirrors the admin detail page: contact → event → consultation
 * → selections (grouped by collection) → starting investment → custom-quoted
 * items → warnings → client note → admin link.
 */

import type { PackageBuilderSubmissionRow } from "@/lib/builder/submissions";
import type {
  ComputeResult,
  BuilderSelections,
  SelectedAddon,
  SelectedPackage,
} from "@/lib/builder/compute";
import { COLLECTIONS, getAddon, getCollection, getPackage } from "@/lib/builder/catalog";

const ADMIN_BASE = "https://smile-nola.com/admin/package-builder";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function parseSelections(submission: PackageBuilderSubmissionRow): BuilderSelections {
  try {
    return JSON.parse(submission.selections_json) as BuilderSelections;
  } catch {
    return { collections: [], packages: [], addons: [] };
  }
}

interface GroupedLineItem {
  label: string;
  detail: string; // e.g. "$695.00" or "qty 3 × $50.00 = $150.00" or "starts at $500"
}

interface GroupedCollection {
  collectionId: string;
  collectionName: string;
  packages: GroupedLineItem[];
  addons: GroupedLineItem[];
}

/**
 * Group a submission's selections by collection, in canonical display order,
 * resolving every id against the catalog so labels and prices are authoritative.
 * Unknown ids are skipped silently (they shouldn't survive server validation,
 * but if they do, the email still renders).
 */
function groupSelections(sel: BuilderSelections): GroupedCollection[] {
  const order = COLLECTIONS.slice().sort((a, b) => a.displayOrder - b.displayOrder);
  const selectedSet = new Set(sel.collections);
  const out: GroupedCollection[] = [];

  for (const c of order) {
    if (!selectedSet.has(c.id)) continue;
    const group: GroupedCollection = {
      collectionId: c.id,
      collectionName: c.displayName,
      packages: [],
      addons: [],
    };

    for (const sp of sel.packages as SelectedPackage[]) {
      if (sp.collectionId !== c.id) continue;
      const pkg = getPackage(sp.collectionId, sp.packageId);
      if (!pkg) continue;
      // Mirror the builder UI: "starting" packages render as "starts at $X"
      // in the ops summary so daniel sees the same nuance the client did.
      const detail =
        pkg.priceType === "starting"
          ? `starts at ${dollars(pkg.priceCents)}`
          : dollars(pkg.priceCents);
      group.packages.push({ label: pkg.name, detail });
    }

    for (const sa of sel.addons as SelectedAddon[]) {
      if (sa.collectionId !== c.id) continue;
      const a = getAddon(sa.collectionId, sa.addonId);
      if (!a) continue;
      let detail: string;
      if (a.priceType === "fixed" && a.priceCents !== null) {
        if (sa.qty > 1) {
          detail = `qty ${sa.qty} × ${dollars(a.priceCents)} = ${dollars(a.priceCents * sa.qty)}`;
        } else {
          detail = dollars(a.priceCents);
        }
      } else if (a.priceType === "starting" && a.priceCents !== null) {
        detail = `starts at ${dollars(a.priceCents)}${sa.qty > 1 ? ` (qty ${sa.qty})` : ""}`;
      } else {
        detail = `custom quoted${sa.qty > 1 ? ` (qty ${sa.qty})` : ""}`;
      }
      group.addons.push({ label: a.name, detail });
    }

    if (group.packages.length > 0 || group.addons.length > 0) {
      out.push(group);
    }
  }
  return out;
}

function consultationLabel(pref: PackageBuilderSubmissionRow["consultation_pref"]): string {
  switch (pref) {
    case "video":     return "Quick video call — we'll send a Google Meet link.";
    case "in_person": return "In-person walkthrough — for complex production setups.";
    case "none":      return "No call needed — details above are enough.";
    default:          return "Not specified.";
  }
}

/* ============================================================================
 * Plain text
 * ========================================================================== */

export function renderSubmissionSummaryText(
  submission: PackageBuilderSubmissionRow,
  computed: ComputeResult,
): string {
  const sel = parseSelections(submission);
  const groups = groupSelections(sel);
  const lines: string[] = [];

  lines.push(`New package builder submission — Smile NOLA`);
  lines.push(`Captured: ${submission.created_at}`);
  lines.push(`Source:   ${submission.source}`);
  lines.push(``);
  lines.push(`Name:        ${submission.first_name} ${submission.last_name}`);
  lines.push(`Email:       ${submission.email}`);
  lines.push(`Phone:       ${submission.phone}`);
  if (submission.inquiry_id !== null) {
    lines.push(`Linked to:   inquiry #${submission.inquiry_id}`);
  }
  lines.push(``);
  lines.push(`-- Event --`);
  if (submission.event_date)  lines.push(`Event date:  ${submission.event_date}`);
  if (submission.event_type)  lines.push(`Event type:  ${submission.event_type}`);
  if (submission.venue)       lines.push(`Venue:       ${submission.venue}`);
  if (submission.guest_count) lines.push(`Guest count: ${submission.guest_count}`);
  lines.push(`Consultation: ${consultationLabel(submission.consultation_pref)}`);
  lines.push(``);
  lines.push(`-- Selected experience --`);
  if (groups.length === 0) {
    lines.push(`(no selections)`);
  } else {
    for (const g of groups) {
      lines.push(``);
      lines.push(`[${g.collectionName}]`);
      for (const p of g.packages) lines.push(`  · ${p.label} — ${p.detail}`);
      for (const a of g.addons)   lines.push(`  · ${a.label} — ${a.detail}`);
    }
  }
  lines.push(``);
  if (computed.ok) {
    lines.push(`Starting investment: ${dollars(computed.fixedSubtotalCents)}`);
    if (computed.customQuoted.length > 0) {
      lines.push(``);
      lines.push(`-- Quoted separately --`);
      for (const q of computed.customQuoted) {
        lines.push(
          `  · ${q.label} — ${q.startingPriceCents !== null ? `starts at ${dollars(q.startingPriceCents)}` : "custom quoted"}`,
        );
      }
    }
    if (computed.warnings.length > 0) {
      lines.push(``);
      lines.push(`-- Warnings --`);
      for (const w of computed.warnings) lines.push(`  · ${w.message}`);
    }
  } else {
    lines.push(`Starting investment: (recompute failed — ${computed.error})`);
  }
  if (submission.client_note) {
    lines.push(``);
    lines.push(`-- Note from client --`);
    lines.push(submission.client_note);
  }
  lines.push(``);
  lines.push(`Submission #${submission.id}. View at: ${ADMIN_BASE}/${submission.id}`);
  return lines.join("\n");
}

/* ============================================================================
 * HTML
 * ========================================================================== */

function htmlMetaRow(label: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const v = typeof value === "number" ? String(value) : value;
  return `<tr><td style="padding:6px 18px 6px 0;color:#B8B2A5;font-size:12px;letter-spacing:.18em;text-transform:uppercase;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:6px 0;color:#F8F4EA;font-size:15px">${escapeHtml(v)}</td></tr>`;
}

function htmlGroupBlock(g: GroupedCollection): string {
  const items = [
    ...g.packages.map(
      (p) =>
        `<li style="padding:4px 0;color:#F8F4EA;font-size:14px"><span>${escapeHtml(p.label)}</span> <span style="color:#9C8A6A">— ${escapeHtml(p.detail)}</span></li>`,
    ),
    ...g.addons.map(
      (a) =>
        `<li style="padding:4px 0;color:#F8F4EA;font-size:14px"><span>${escapeHtml(a.label)}</span> <span style="color:#9C8A6A">— ${escapeHtml(a.detail)}</span></li>`,
    ),
  ].join("");
  return `<div style="margin-top:18px">
  <div style="color:#D4AF37;font-size:11px;letter-spacing:.3em;text-transform:uppercase;margin-bottom:6px">${escapeHtml(g.collectionName)}</div>
  <ul style="list-style:none;margin:0;padding:0">${items}</ul>
</div>`;
}

export function renderSubmissionSummaryHtml(
  submission: PackageBuilderSubmissionRow,
  computed: ComputeResult,
): string {
  const sel = parseSelections(submission);
  const groups = groupSelections(sel);

  const groupsHtml =
    groups.length === 0
      ? `<div style="margin-top:18px;color:#B8B2A5;font-size:14px">(no selections)</div>`
      : groups.map(htmlGroupBlock).join("");

  const investmentHtml = computed.ok
    ? `<div style="margin-top:24px;padding-top:20px;border-top:1px solid #D4AF3733">
        <div style="color:#D4AF37;font-size:11px;letter-spacing:.3em;text-transform:uppercase;margin-bottom:6px">Starting investment</div>
        <div style="color:#D4AF37;font-size:22px">${escapeHtml(dollars(computed.fixedSubtotalCents))}</div>
      </div>`
    : `<div style="margin-top:24px;padding-top:20px;border-top:1px solid #D4AF3733;color:#FF7A7A;font-size:13px">Server recompute failed: ${escapeHtml(computed.error)}</div>`;

  const customHtml =
    computed.ok && computed.customQuoted.length > 0
      ? `<div style="margin-top:20px">
          <div style="color:#9C8A6A;font-size:11px;letter-spacing:.3em;text-transform:uppercase;margin-bottom:6px">Quoted separately</div>
          <ul style="list-style:none;margin:0;padding:0">${computed.customQuoted
            .map(
              (q) =>
                `<li style="padding:4px 0;color:#F8F4EA;font-size:14px">${escapeHtml(q.label)} <span style="color:#9C8A6A">— ${escapeHtml(q.startingPriceCents !== null ? `starts at ${dollars(q.startingPriceCents)}` : "custom quoted")}</span></li>`,
            )
            .join("")}</ul>
        </div>`
      : "";

  const warningsHtml =
    computed.ok && computed.warnings.length > 0
      ? `<div style="margin-top:20px;padding:14px 16px;border-left:3px solid #E07A6B;background:#1a0e0c;color:#F6E7C8;font-size:13px;line-height:1.5">${computed.warnings
          .map((w) => `<div>${escapeHtml(w.message)}</div>`)
          .join("")}</div>`
      : "";

  const noteHtml = submission.client_note
    ? `<div style="margin-top:24px;padding-top:24px;border-top:1px solid #D4AF3733">
        <div style="color:#D4AF37;font-size:11px;letter-spacing:.3em;text-transform:uppercase;margin-bottom:8px">Note from client</div>
        <div style="color:#F6E7C8;line-height:1.6;white-space:pre-wrap">${escapeHtml(submission.client_note)}</div>
      </div>`
    : "";

  return `<!doctype html>
<html><body style="margin:0;padding:32px;background:#050505;color:#F8F4EA;font-family:Poppins,system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:620px;margin:0 auto;background:#111111;border:1px solid #D4AF37;padding:32px">
    <div style="color:#D4AF37;font-size:11px;letter-spacing:.4em;text-transform:uppercase;margin-bottom:6px">— new package builder submission —</div>
    <div style="color:#D4AF37;font-size:24px;line-height:1.1;margin-bottom:24px">${escapeHtml(`${submission.first_name} ${submission.last_name}`)}</div>
    <table style="border-collapse:collapse;width:100%">
      ${htmlMetaRow("Email", submission.email)}
      ${htmlMetaRow("Phone", submission.phone)}
      ${htmlMetaRow("Source", submission.source)}
      ${submission.inquiry_id !== null ? htmlMetaRow("Linked inquiry", `#${submission.inquiry_id}`) : ""}
      ${htmlMetaRow("Event date", submission.event_date)}
      ${htmlMetaRow("Event type", submission.event_type)}
      ${htmlMetaRow("Venue", submission.venue)}
      ${htmlMetaRow("Guest count", submission.guest_count)}
      ${htmlMetaRow("Consultation", consultationLabel(submission.consultation_pref))}
    </table>
    ${groupsHtml}
    ${investmentHtml}
    ${customHtml}
    ${warningsHtml}
    ${noteHtml}
    <div style="margin-top:28px;padding-top:20px;border-top:1px solid #D4AF3733;color:#B8B2A5;font-size:12px">
      Submission #${submission.id} · ${escapeHtml(submission.created_at)}<br>
      <a href="${ADMIN_BASE}/${submission.id}" style="color:#D4AF37">View in admin →</a>
    </div>
  </div>
</body></html>`;
}
