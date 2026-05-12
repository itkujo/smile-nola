/**
 * Best-effort Resend notifications for inquiries and package builder submissions.
 *
 * Submissions are ALWAYS persisted to SQLite before this is invoked — email is
 * a courtesy, never a blocker. If RESEND_API_KEY is missing OR NOTIFY_EMAIL is
 * missing, the helpers fall back to a console log and return silently. They
 * NEVER throw. The caller fire-and-forgets and continues.
 *
 * Subject + body shape is the CRM contract with Zapier:
 *
 *   Subject: <-Lead-|-Builder-> #<id> · <Type> · <Names> · <Date>
 *   Body header:
 *     Project ID: <id>
 *     Project Name: <Type> · <Names> · <Date> #<id>
 *
 * See `lib/project-name.ts` for full format docs. Zapier filters on the
 * subject prefix, extracts Project ID from the body, then updates a HoneyBook
 * project whose external_id matches that id. The same anchor shape works for
 * both inquiry and builder emails so one Zap can route both.
 *
 * Sender defaults to "Smile NOLA <onboarding@resend.dev>" (Resend's shared
 * sandbox sender) so local dev without a verified domain still works. Production
 * sets RESEND_FROM to "Smile NOLA <no-reply@mail.smile-nola.com>".
 *
 * The Resend client is lazy-built on first send so a missing key during module
 * load doesn't blow up the import graph.
 */

import { Resend } from "resend";
import type { InquiryRow } from "@/lib/db";
import type { PackageBuilderSubmissionRow } from "@/lib/builder/submissions";
import type { ComputeResult } from "@/lib/builder/compute";
import { getEnv, getRequiredEnv } from "@/lib/env";
import {
  builderProjectName,
  builderSubject,
  inquiryProjectName,
  inquirySubject,
  projectAnchorBlock,
} from "@/lib/project-name";
import {
  renderSubmissionSummaryHtml,
  renderSubmissionSummaryText,
} from "@/lib/builder/readable-summary";

const DEFAULT_FROM = "Smile NOLA <onboarding@resend.dev>";

interface SendEnv {
  apiKey: string;
  from: string;
  to: string;
}

function readEnv(): SendEnv | null {
  const to = getEnv("NOTIFY_EMAIL").trim();
  if (!to) return null;
  let apiKey: string;
  try {
    apiKey = getRequiredEnv("RESEND_API_KEY");
  } catch {
    return null;
  }
  const from = getEnv("RESEND_FROM").trim() || DEFAULT_FROM;
  return { apiKey, from, to };
}

let _client: Resend | null = null;
function client(apiKey: string): Resend {
  if (_client) return _client;
  _client = new Resend(apiKey);
  return _client;
}

/* ============================================================================
 * Shared HTML helpers
 * ========================================================================== */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render a value or em-dash for missing/null/empty. We DO render every Phase 1
 * field unconditionally — even empty ones — so the email body has a stable
 * shape regardless of source. That lets Zapier read every field by name without
 * conditional templates.
 */
function fieldValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return String(value);
  const trimmed = value.trim();
  return trimmed || "—";
}

function row(label: string, value: string | number | null | undefined): string {
  const rendered = fieldValue(value);
  return `<tr><td style="padding:6px 18px 6px 0;color:#B8B2A5;font-size:12px;letter-spacing:.18em;text-transform:uppercase;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:6px 0;color:#F8F4EA;font-size:15px">${escapeHtml(rendered)}</td></tr>`;
}

function textLine(label: string, value: string | number | null | undefined): string {
  return `${label.padEnd(20)}${fieldValue(value)}`;
}

/* ============================================================================
 * Inquiry notification (signature unchanged)
 * ========================================================================== */

function inquiryBodyText(inquiry: InquiryRow): string {
  const projectName = inquiryProjectName(inquiry);
  const lines = [
    // Machine-parsable anchor for Zapier — keep at the top.
    projectAnchorBlock(inquiry.id, projectName),
    ``,
    `New lead — Smile NOLA`,
    `Captured:            ${inquiry.created_at}`,
    `Source:              ${inquiry.source}`,
    ``,
    `--- CONTACT ---`,
    textLine(`Name:`, `${inquiry.first_name} ${inquiry.last_name}`.trim()),
    textLine(`Email:`, inquiry.email),
    textLine(`Phone:`, inquiry.phone),
    textLine(`Preferred contact:`, inquiry.preferred_contact),
    ``,
    `--- EVENT ---`,
    textLine(`Event date:`, inquiry.event_date),
    textLine(`Event type:`, inquiry.event_type),
    textLine(`Venue:`, inquiry.venue),
    textLine(`Guest count:`, inquiry.guest_count),
    textLine(`Event start:`, inquiry.event_start),
    textLine(`Event end:`, inquiry.event_end),
    textLine(`Planner:`, inquiry.planner),
    textLine(`Budget:`, inquiry.budget_range),
    textLine(`Collections:`, inquiry.collections_interested),
    ``,
    `--- BOOTH FIELDS ---`,
    textLine(`Partner 1:`, inquiry.partner1_name),
    textLine(`Partner 2:`, inquiry.partner2_name),
    textLine(`Event setting:`, inquiry.event_setting),
    textLine(`POC relationship:`, inquiry.poc_relationship),
    ``,
    `--- INTERNAL ---`,
    textLine(`External UUID:`, inquiry.external_uuid),
    textLine(`Synced at:`, inquiry.synced_at),
    textLine(`Source legacy id:`, inquiry.source_legacy_id),
    textLine(`Referral:`, inquiry.referral),
  ];
  if (inquiry.message) {
    lines.push(``, `--- MESSAGE ---`, inquiry.message);
  }
  if (inquiry.notes) {
    lines.push(``, `--- NOTES ---`, inquiry.notes);
  }
  lines.push(
    ``,
    `View in admin: https://smile-nola.com/admin/inquiries/${inquiry.id}`,
  );
  return lines.join("\n");
}

function inquiryBodyHtml(inquiry: InquiryRow): string {
  const projectName = inquiryProjectName(inquiry);
  const displayName =
    [inquiry.first_name, inquiry.last_name].filter(Boolean).join(" ").trim() ||
    "(unknown)";
  return `<!doctype html>
<html><body style="margin:0;padding:32px;background:#050505;color:#F8F4EA;font-family:Poppins,system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:620px;margin:0 auto;background:#111111;border:1px solid #D4AF37;padding:32px">
    <pre style="margin:0 0 22px;padding:14px 16px;background:#050505;border:1px solid #D4AF3744;color:#F6E7C8;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-word">Project ID: ${inquiry.id}\nProject Name: ${escapeHtml(projectName)}</pre>
    <div style="color:#D4AF37;font-size:11px;letter-spacing:.4em;text-transform:uppercase;margin-bottom:6px">— new lead —</div>
    <div style="color:#D4AF37;font-size:24px;line-height:1.1;margin-bottom:24px">${escapeHtml(displayName)}</div>

    <div style="color:#B8B2A5;font-size:11px;letter-spacing:.3em;text-transform:uppercase;margin:0 0 6px">Contact</div>
    <table style="border-collapse:collapse;width:100%;margin-bottom:18px">
      ${row("Email", inquiry.email)}
      ${row("Phone", inquiry.phone)}
      ${row("Preferred contact", inquiry.preferred_contact)}
    </table>

    <div style="color:#B8B2A5;font-size:11px;letter-spacing:.3em;text-transform:uppercase;margin:0 0 6px">Event</div>
    <table style="border-collapse:collapse;width:100%;margin-bottom:18px">
      ${row("Event date", inquiry.event_date)}
      ${row("Event type", inquiry.event_type)}
      ${row("Venue", inquiry.venue)}
      ${row("Guest count", inquiry.guest_count)}
      ${row("Event start", inquiry.event_start)}
      ${row("Event end", inquiry.event_end)}
      ${row("Planner", inquiry.planner)}
      ${row("Budget", inquiry.budget_range)}
      ${row("Collections", inquiry.collections_interested)}
    </table>

    <div style="color:#B8B2A5;font-size:11px;letter-spacing:.3em;text-transform:uppercase;margin:0 0 6px">Booth fields</div>
    <table style="border-collapse:collapse;width:100%;margin-bottom:18px">
      ${row("Partner 1", inquiry.partner1_name)}
      ${row("Partner 2", inquiry.partner2_name)}
      ${row("Event setting", inquiry.event_setting)}
      ${row("POC relationship", inquiry.poc_relationship)}
    </table>

    <div style="color:#B8B2A5;font-size:11px;letter-spacing:.3em;text-transform:uppercase;margin:0 0 6px">Internal</div>
    <table style="border-collapse:collapse;width:100%">
      ${row("Source", inquiry.source)}
      ${row("External UUID", inquiry.external_uuid)}
      ${row("Synced at", inquiry.synced_at)}
      ${row("Source legacy id", inquiry.source_legacy_id)}
      ${row("Referral", inquiry.referral)}
    </table>

    ${inquiry.message ? `<div style="margin-top:24px;padding-top:24px;border-top:1px solid #D4AF3733">
      <div style="color:#D4AF37;font-size:11px;letter-spacing:.3em;text-transform:uppercase;margin-bottom:8px">Message</div>
      <div style="color:#F6E7C8;line-height:1.6;white-space:pre-wrap">${escapeHtml(inquiry.message)}</div>
    </div>` : ""}
    ${inquiry.notes ? `<div style="margin-top:18px;padding-top:18px;border-top:1px solid #D4AF3733">
      <div style="color:#D4AF37;font-size:11px;letter-spacing:.3em;text-transform:uppercase;margin-bottom:8px">Notes</div>
      <div style="color:#F6E7C8;line-height:1.6;white-space:pre-wrap">${escapeHtml(inquiry.notes)}</div>
    </div>` : ""}

    <div style="margin-top:28px;padding-top:20px;border-top:1px solid #D4AF3733;color:#B8B2A5;font-size:12px">
      Inquiry #${inquiry.id} · ${escapeHtml(inquiry.created_at)}<br>
      <a href="https://smile-nola.com/admin/inquiries/${inquiry.id}" style="color:#D4AF37">View in admin →</a>
    </div>
  </div>
</body></html>`;
}

/**
 * Send the inquiry notification. Returns nothing; logs but never throws.
 *
 * Signature is UNCHANGED from the previous implementation so existing callers
 * (api/contact.ts, api/inquiry.ts, api/sync/inquiries.ts) work as-is.
 */
export async function sendInquiryNotification(inquiry: InquiryRow): Promise<void> {
  const env = readEnv();
  if (!env) {
    console.log(
      `[inquiry] Resend not configured — would have notified about #${inquiry.id} (${inquiry.email}). Submission saved.`,
    );
    return;
  }
  try {
    const result = await client(env.apiKey).emails.send({
      from: env.from,
      to: env.to,
      subject: inquirySubject(inquiry),
      text: inquiryBodyText(inquiry),
      html: inquiryBodyHtml(inquiry),
      replyTo: inquiry.email,
    });
    if (result.error) {
      console.error(`[inquiry] Resend rejected send for #${inquiry.id}:`, result.error);
      return;
    }
    console.log(`[inquiry] Notified ${env.to} about #${inquiry.id} (id=${result.data?.id ?? "?"}).`);
  } catch (err) {
    console.error(`[inquiry] Email send failed for #${inquiry.id}:`, err);
  }
}

/* ============================================================================
 * Package builder submission notification
 * ========================================================================== */

/**
 * Compose a "Linked inquiry context" block for the builder email. Returns
 * empty strings when no inquiry is linked (cold-flow submissions). The block
 * gives Zapier (and the operator reading the email) access to the booth-side
 * fields that the builder form doesn't capture — partner names, event
 * setting, POC relationship, plus the inquiry's original message and notes.
 */
function linkedInquiryTextBlock(inquiry: InquiryRow | null): string {
  if (!inquiry) return "";
  const lines = [
    ``,
    `--- LINKED INQUIRY (#${inquiry.id}) ---`,
    textLine(`Captured:`, inquiry.created_at),
    textLine(`Source:`, inquiry.source),
    textLine(`Partner 1:`, inquiry.partner1_name),
    textLine(`Partner 2:`, inquiry.partner2_name),
    textLine(`Event setting:`, inquiry.event_setting),
    textLine(`POC relationship:`, inquiry.poc_relationship),
    textLine(`Preferred contact:`, inquiry.preferred_contact),
    textLine(`Referral:`, inquiry.referral),
    textLine(`External UUID:`, inquiry.external_uuid),
  ];
  if (inquiry.message) {
    lines.push(``, `Inquiry message:`, inquiry.message);
  }
  if (inquiry.notes) {
    lines.push(``, `Inquiry notes:`, inquiry.notes);
  }
  return lines.join("\n");
}

function linkedInquiryHtmlBlock(inquiry: InquiryRow | null): string {
  if (!inquiry) return "";
  return `<div style="margin-top:24px;padding-top:24px;border-top:1px solid #D4AF3733">
    <div style="color:#D4AF37;font-size:11px;letter-spacing:.3em;text-transform:uppercase;margin-bottom:8px">Linked inquiry #${inquiry.id}</div>
    <table style="border-collapse:collapse;width:100%">
      ${row("Captured", inquiry.created_at)}
      ${row("Source", inquiry.source)}
      ${row("Partner 1", inquiry.partner1_name)}
      ${row("Partner 2", inquiry.partner2_name)}
      ${row("Event setting", inquiry.event_setting)}
      ${row("POC relationship", inquiry.poc_relationship)}
      ${row("Preferred contact", inquiry.preferred_contact)}
      ${row("Referral", inquiry.referral)}
      ${row("External UUID", inquiry.external_uuid)}
    </table>
    ${inquiry.message ? `<div style="margin-top:12px"><div style="color:#B8B2A5;font-size:11px;letter-spacing:.3em;text-transform:uppercase;margin-bottom:4px">Inquiry message</div><div style="color:#F6E7C8;line-height:1.6;white-space:pre-wrap">${escapeHtml(inquiry.message)}</div></div>` : ""}
    ${inquiry.notes ? `<div style="margin-top:12px"><div style="color:#B8B2A5;font-size:11px;letter-spacing:.3em;text-transform:uppercase;margin-bottom:4px">Inquiry notes</div><div style="color:#F6E7C8;line-height:1.6;white-space:pre-wrap">${escapeHtml(inquiry.notes)}</div></div>` : ""}
  </div>`;
}

/**
 * Send the package builder submission notification. Returns nothing; logs but
 * never throws.
 *
 * @param submission   Persisted builder submission row
 * @param computed     Recomputed ComputeResult (selections, totals, warnings)
 * @param linkedInquiry  Linked inquiry row when submission.inquiry_id is set;
 *                       null for cold-flow submissions. Used to compose
 *                       partner-name segments of the subject + the "Linked
 *                       inquiry" body block. When omitted (legacy callers),
 *                       defaults to null — the subject still works because
 *                       builderSubject falls back to the submission's own
 *                       contact name.
 */
export async function sendBuilderSubmissionNotification(
  submission: PackageBuilderSubmissionRow,
  computed: ComputeResult,
  linkedInquiry: InquiryRow | null = null,
): Promise<void> {
  const env = readEnv();
  if (!env) {
    console.log(
      `[builder] Resend not configured — would have notified about submission #${submission.id} (${submission.email}). Saved.`,
    );
    return;
  }
  try {
    const subject = builderSubject(submission, linkedInquiry);
    const projectName = builderProjectName(submission, linkedInquiry);
    const anchor = projectAnchorBlock(submission.id, projectName);

    const dollars = computed.ok
      ? `$${(computed.fixedSubtotalCents / 100).toLocaleString("en-US")}`
      : "—";

    const summaryText = renderSubmissionSummaryText(submission, computed);
    const summaryHtml = renderSubmissionSummaryHtml(submission, computed);

    // Compose final body: anchor first (Zapier reads from top), then the
    // existing rich summary, then the linked-inquiry context block.
    const text = [
      anchor,
      ``,
      `Starting investment: ${dollars}`,
      ``,
      summaryText,
      linkedInquiryTextBlock(linkedInquiry),
    ]
      .filter((s) => s !== "")
      .join("\n");

    // The summary HTML is a full document. We can't just prepend to it
    // without rendering a second `<!doctype>`. Instead, splice the anchor +
    // linked-inquiry block in between body opening and the summary's main
    // content. The summary returns a full `<!doctype>...</html>` string;
    // we wrap it with an envelope that holds our anchor + linked block.
    const html = `<!doctype html>
<html><body style="margin:0;padding:32px;background:#050505;color:#F8F4EA;font-family:Poppins,system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:680px;margin:0 auto;background:#111111;border:1px solid #D4AF37;padding:32px">
    <pre style="margin:0 0 22px;padding:14px 16px;background:#050505;border:1px solid #D4AF3744;color:#F6E7C8;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-word">Project ID: ${submission.id}\nProject Name: ${escapeHtml(projectName)}</pre>
    <div style="color:#D4AF37;font-size:11px;letter-spacing:.4em;text-transform:uppercase;margin-bottom:6px">— builder submission · ${escapeHtml(dollars)} starting —</div>
    <div style="font-size:14px;color:#F6E7C8;margin-bottom:18px">
      ${summaryHtml}
    </div>
    ${linkedInquiryHtmlBlock(linkedInquiry)}
    <div style="margin-top:28px;padding-top:20px;border-top:1px solid #D4AF3733;color:#B8B2A5;font-size:12px">
      Submission #${submission.id} · ${escapeHtml(submission.created_at)}<br>
      <a href="https://smile-nola.com/admin/package-builder/${submission.id}" style="color:#D4AF37">View in admin →</a>
    </div>
  </div>
</body></html>`;

    const result = await client(env.apiKey).emails.send({
      from: env.from,
      to: env.to,
      subject,
      text,
      html,
      replyTo: submission.email,
    });
    if (result.error) {
      console.error(`[builder] Resend rejected send for submission #${submission.id}:`, result.error);
      return;
    }
    console.log(`[builder] Notified ${env.to} about submission #${submission.id} (id=${result.data?.id ?? "?"}).`);
  } catch (err) {
    console.error(`[builder] Email send failed for submission #${submission.id}:`, err);
  }
}
