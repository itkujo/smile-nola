/**
 * Best-effort SMTP notification for new inquiries.
 *
 * Submissions are ALWAYS saved to SQLite before this is invoked — email is
 * a courtesy, never a blocker. If any SMTP env var is missing, this falls
 * back to a console log and returns silently.
 *
 * The first SMTP send may stall briefly (TLS handshake, DNS, etc.) — the
 * caller should NOT await this on the request-response critical path. The
 * inquiry endpoint fires-and-forgets.
 */

import nodemailer from "nodemailer";
import type { InquiryRow } from "@/lib/db";
import { getEnv } from "@/lib/env";

interface SmtpEnv {
  host: string;
  port: number;
  user: string;
  pass: string;
  to: string;
}

function readEnv(): SmtpEnv | null {
  const host = getEnv("SMTP_HOST").trim();
  const portStr = getEnv("SMTP_PORT").trim();
  const user = getEnv("SMTP_USER").trim();
  const pass = getEnv("SMTP_PASS").trim();
  const to = getEnv("NOTIFY_EMAIL").trim();
  if (!host || !portStr || !user || !pass || !to) return null;
  const port = Number(portStr);
  if (!Number.isFinite(port) || port <= 0) return null;
  return { host, port, user, pass, to };
}

// Lazy-build the transporter on first use.
let _transporter: nodemailer.Transporter | null = null;
function transporter(env: SmtpEnv): nodemailer.Transporter {
  if (_transporter) return _transporter;
  _transporter = nodemailer.createTransport({
    host: env.host,
    port: env.port,
    secure: env.port === 465,
    auth: { user: env.user, pass: env.pass },
  });
  return _transporter;
}

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

function bodyText(inquiry: InquiryRow): string {
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

function bodyHtml(inquiry: InquiryRow): string {
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
 * Send the notification. Returns nothing; logs but never throws.
 */
export async function sendInquiryNotification(inquiry: InquiryRow): Promise<void> {
  const env = readEnv();
  if (!env) {
    console.log(
      `[inquiry] SMTP not configured — would have notified about #${inquiry.id} (${inquiry.email}). Submission saved.`
    );
    return;
  }
  try {
    await transporter(env).sendMail({
      from: `"Smile NOLA Inquiries" <${env.user}>`,
      to: env.to,
      subject: `New inquiry: ${inquiry.first_name} ${inquiry.last_name} · ${inquiry.source}`,
      text: bodyText(inquiry),
      html: bodyHtml(inquiry),
      replyTo: inquiry.email,
    });
    console.log(`[inquiry] Notified ${env.to} about #${inquiry.id}.`);
  } catch (err) {
    console.error(`[inquiry] Email send failed for #${inquiry.id}:`, err);
  }
}
