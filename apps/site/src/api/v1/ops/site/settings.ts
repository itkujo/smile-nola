/**
 * Site settings: the announcement banner. One global record, so there is a
 * read and one PUT that replaces it (disable it with `enabled: false`).
 * Moved from src/pages/api/admin/site-banner.ts.
 */

import { z } from "zod";
import { defineOperation } from "@/api/registry/define";
import { BannerSettingsSchema, getBannerSettings, setBannerSettings } from "@/lib/site-settings";

export const settingsBannerGet = defineOperation({
  id: "settings_banner_get",
  summary: "Read the site banner",
  tag: "settings",
  method: "GET",
  path: "/settings/site-banner",
  scope: "read:settings",
  agent: true,
  input: z.object({}),
  output: BannerSettingsSchema,
  handler: () => getBannerSettings(),
});

export const settingsBannerPut = defineOperation({
  id: "settings_banner_put",
  summary: "Replace the site banner",
  description: "Sends the whole banner. `enabled: false` hides it but keeps the message for later.",
  tag: "settings",
  method: "PUT",
  path: "/settings/site-banner",
  scope: "write:settings",
  input: BannerSettingsSchema,
  output: z.object({ ok: z.literal(true), banner: BannerSettingsSchema }),
  handler({ input }) {
    setBannerSettings(input);
    return { ok: true as const, banner: getBannerSettings() };
  },
});
