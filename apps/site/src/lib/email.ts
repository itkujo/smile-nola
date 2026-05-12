/**
 * Best-effort Resend notifications for inquiries and package builder submissions.
 *
 * Submissions are ALWAYS persisted to SQLite before this is invoked — email is
 * a courtesy, never a blocker. If RESEND_API_KEY is missing OR NOTIFY_EMAIL is
 * missing, the helpers fall back to a console log and return silently. They
 * NEVER throw. The caller fire-and-forgets and continues.
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

function row(label: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const v = typeof value === "number" ? String(value) : value;
  return `<tr><td style="padding:6px 18px 6px 0;color:#B8B2A5;font-size:12px;letter-spacing:.18em;text-transform:uppercase;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:6px 0;color:#F8F4EA;font-size:15px">${escapeHtml(v)}</td></tr>`;
}

/* ============================================================================
 * Inquiry notification (unchanged contract — same export, same row type)
 * ========================================================================== */

function inquiryBodyText(inquiry: InquiryRow): string {
  const lines = [
    `New inquiry — Smile NOLA`,
    `Captured: ${inquiry.created_at}`,
    `Source:   ${inquiry.source}`,
    ``,
    `Name:        ${inquiry.first_name} ${inquiry.last_name}`,
    `Email:       ${inquiry.email}`,
    `Phone:       ${inquiry.phone}`,
  ];
  if (inquiry.event_date)  lines.push(`Event date:  ${inquiry.event_date}`);
  if (inquiry.event_type)  lines.push(`Event type:  ${inquiry.event_type}`);
  if (inquiry.venue)       lines.push(`Venue:       ${inquiry.venue}`);
  if (inquiry.guest_count) lines.push(`Guest count: ${inquiry.guest_count}`);
  if (inquiry.budget_range)lines.push(`Budget:      ${inquiry.budget_range}`);
  if (inquiry.collections_interested)
    lines.push(`Collections: ${inquiry.collections_interested}`);
  if (inquiry.message) {
    lines.push(``, `Message:`, inquiry.message);
  }
  lines.push(``, `Inquiry #${inquiry.id}. View at: https://smile-nola.com/admin/inquiries/${inquiry.id}`);
  return lines.join("\n");
}

function inquiryBodyHtml(inquiry: InquiryRow): string {
  return `<!doctype html>
<html><body style="margin:0;padding:32px;background:#050505;color:#F8F4EA;font-family:Poppins,system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#111111;border:1px solid #D4AF37;padding:32px">
    <div style="color:#D4AF37;font-size:11px;letter-spacing:.4em;text-transform:uppercase;margin-bottom:6px">— new inquiry —</div>
    <div style="color:#D4AF37;font-size:24px;line-height:1.1;margin-bottom:24px">${escapeHtml(`${inquiry.first_name} ${inquiry.last_name}`)}</div>
    <table style="border-collapse:collapse;width:100%">
      ${row("Email", inquiry.email)}
      ${row("Phone", inquiry.phone)}
      ${row("Source", inquiry.source)}
      ${row("Event date", inquiry.event_date)}
      ${row("Event type", inquiry.event_type)}
      ${row("Venue", inquiry.venue)}
      ${row("Guest count", inquiry.guest_count)}
      ${row("Budget", inquiry.budget_range)}
      ${row("Collections", inquiry.collections_interested)}
    </table>
    ${inquiry.message ? `<div style="margin-top:24px;padding-top:24px;border-top:1px solid #D4AF3733">
      <div style="color:#D4AF37;font-size:11px;letter-spacing:.3em;text-transform:uppercase;margin-bottom:8px">Message</div>
      <div style="color:#F6E7C8;line-height:1.6;white-space:pre-wrap">${escapeHtml(inquiry.message)}</div>
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
 * Signature is UNCHANGED from the previous nodemailer implementation so
 * existing callers (api/contact.ts, api/inquiry.ts) work as-is.
 */
export async function sendInquiryNotification(inquiry: InquiryRow): Promise<void> {
  const env = readEnv();
  if (!env) {
    console.log(
      `[inquiry] Resend not configured — would have notified about #${inquiry.id} (${inquiry.email}). Submission saved.`
    );
    return;
  }
  try {
    const result = await client(env.apiKey).emails.send({
      from: env.from,
      to: env.to,
      subject: `New inquiry: ${inquiry.first_name} ${inquiry.last_name} · ${inquiry.source}`,
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
 * Package builder submission notification (new)
 * ========================================================================== */

/**
 * Send the package builder submission notification. Returns nothing; logs but
 * never throws.
 *
 * Takes both the persisted row and the recomputed ComputeResult so it can
 * include canonical totals, custom-quoted items, and warnings without
 * re-parsing the JSON columns.
 *
 * If `computed.ok === false` we fall back to a minimal "selections present
 * but failed server validation" notice — this branch shouldn't happen in
 * practice because the endpoint refuses to persist unvalidated submissions,
 * but keeping the helper total prevents surprise crashes.
 */
export async function sendBuilderSubmissionNotification(
  submission: PackageBuilderSubmissionRow,
  computed: ComputeResult,
): Promise<void> {
  const env = readEnv();
  if (!env) {
    console.log(
      `[builder] Resend not configured — would have notified about submission #${submission.id} (${submission.email}). Saved.`
    );
    return;
  }
  try {
    const dollars =
      computed.ok
        ? `$${(computed.fixedSubtotalCents / 100).toLocaleString("en-US")}`
        : "—";
    const subject = `New package builder submission — ${submission.first_name} ${submission.last_name} · ${dollars} starting`;
    const text = renderSubmissionSummaryText(submission, computed);
    const html = renderSubmissionSummaryHtml(submission, computed);
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
