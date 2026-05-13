/**
 * /api/admin/site-banner — PUT (full upsert) only.
 *
 * Behind the admin middleware. The banner is a single global record, so
 * there's no list / get / delete — one PUT replaces the whole state. The
 * admin form posts the entire BannerSettings shape; we validate with the
 * same Zod schema the read path uses and write it back via setBannerSettings.
 *
 * "Disabling" the banner is just PUT with `enabled: false`; the row stays
 * in the table (so the admin form can keep showing the last message they
 * had in case they want to flip it back on later).
 */

import type { APIRoute } from "astro";
import { z } from "zod";
import {
  BannerSettingsSchema,
  getBannerSettings,
  setBannerSettings,
} from "@/lib/site-settings";

export const prerender = false;

export const PUT: APIRoute = async ({ request }) => {
  const body = await readJson(request);
  if (!body) return json(400, { error: "Body must be valid JSON" });

  const parsed = BannerSettingsSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  setBannerSettings(parsed.data);
  return json(200, { ok: true, banner: getBannerSettings() });
};

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function validationError(error: z.ZodError): Response {
  const details: Record<string, string> = {};
  for (const issue of error.issues) {
    details[issue.path.join(".") || "_"] = issue.message;
  }
  return json(400, { error: "Validation failed", details });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
