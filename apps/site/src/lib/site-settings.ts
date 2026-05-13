/**
 * Site-wide admin-managed settings (currently: announcement banner).
 *
 * Backed by the SQLite `site_settings` KV table — one row per setting,
 * value column holds an opaque JSON blob validated by Zod on read and
 * write. Keeping the schema generic means the next single-flag toggle
 * (maintenance mode, intake pause, sale countdown) doesn't need its own
 * migration; we just pick a new key.
 *
 * Banner contract (key = "banner"):
 *   enabled    boolean        — master on/off
 *   message    string         — the line the visitor reads (plain text)
 *   linkUrl    string | null  — optional CTA URL (absolute or root-relative)
 *   linkLabel  string | null  — optional CTA label (rendered if linkUrl set)
 *   variant    "gold" | "champagne" | "coral"
 *                              — visual tone (announcement / sale / urgent)
 *
 * Read path is intentionally tolerant: any malformed row (bad JSON, schema
 * drift) returns the disabled default rather than 500-ing the marketing
 * site. Loud failure mode is fine in admin; silent-safe on the public side.
 */

import { z } from "zod";
import { getDb } from "@/lib/db";

const BANNER_KEY = "banner";

export const BannerVariantSchema = z.enum(["gold", "champagne", "coral"]);
export type BannerVariant = z.infer<typeof BannerVariantSchema>;

export const BannerSettingsSchema = z.object({
  enabled: z.boolean(),
  // 240 chars keeps the banner to one or two visual lines on desktop and
  // prevents a runaway hero-replacement use case.
  message: z.string().trim().max(240),
  linkUrl: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .refine(
      (v) =>
        v === null ||
        v === "" ||
        v.startsWith("/") ||
        v.startsWith("http://") ||
        v.startsWith("https://") ||
        v.startsWith("mailto:") ||
        v.startsWith("tel:"),
      { message: "linkUrl must be root-relative or absolute http(s)/mailto/tel" },
    ),
  linkLabel: z.string().trim().max(40).nullable(),
  variant: BannerVariantSchema,
});

export type BannerSettings = z.infer<typeof BannerSettingsSchema>;

export const DEFAULT_BANNER: BannerSettings = {
  enabled: false,
  message: "",
  linkUrl: null,
  linkLabel: null,
  variant: "gold",
};

/**
 * Read the banner state. Returns DEFAULT_BANNER if the row is missing or
 * the stored JSON fails validation — never throws, never returns null, so
 * SSR templates can render unconditionally.
 */
export function getBannerSettings(): BannerSettings {
  try {
    const db = getDb();
    const row = db
      .prepare<[string], { value: string }>(
        "SELECT value FROM site_settings WHERE key = ?",
      )
      .get(BANNER_KEY);
    if (!row) return DEFAULT_BANNER;

    const parsed = BannerSettingsSchema.safeParse(JSON.parse(row.value));
    if (!parsed.success) {
      // eslint-disable-next-line no-console
      console.warn(
        "[site-settings] banner row failed schema validation; using default",
        parsed.error.issues,
      );
      return DEFAULT_BANNER;
    }
    return parsed.data;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[site-settings] getBannerSettings failed", err);
    return DEFAULT_BANNER;
  }
}

/**
 * Upsert the banner row. Caller is responsible for auth (admin middleware
 * gates the only POST endpoint that reaches this function).
 *
 * Empty linkLabel / linkUrl pairs are normalized to nulls so the read side
 * doesn't need to special-case empty strings.
 */
export function setBannerSettings(input: BannerSettings): void {
  // Normalize blank link fields so downstream code can rely on truthy =
  // "link present, render the CTA."
  const normalized: BannerSettings = {
    ...input,
    linkUrl: input.linkUrl && input.linkUrl.trim().length > 0 ? input.linkUrl.trim() : null,
    linkLabel:
      input.linkLabel && input.linkLabel.trim().length > 0 ? input.linkLabel.trim() : null,
  };
  // If we have a label but no URL (or vice versa), drop both — a label
  // without a target is dead UI, a URL without a label is unfriendly.
  if (!normalized.linkUrl || !normalized.linkLabel) {
    normalized.linkUrl = null;
    normalized.linkLabel = null;
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO site_settings (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = CURRENT_TIMESTAMP`,
  ).run(BANNER_KEY, JSON.stringify(normalized));
}

/**
 * Stable short hash of the banner message + variant, used as the dismiss
 * key on the client. When the admin changes the message, the hash
 * changes, and previously-dismissed visitors see the new banner again.
 *
 * djb2 — small, fast, fine for our purposes (we just need a different
 * string when the content differs; not a security primitive).
 */
export function bannerContentHash(b: BannerSettings): string {
  const payload = `${b.message}|${b.variant}|${b.linkUrl ?? ""}|${b.linkLabel ?? ""}`;
  let h = 5381;
  for (let i = 0; i < payload.length; i++) {
    h = ((h << 5) + h + payload.charCodeAt(i)) | 0;
  }
  // Convert to unsigned 32-bit and base36 for a short readable token.
  return (h >>> 0).toString(36);
}
