/**
 * Booth mode configuration, read from the environment on every call so tests
 * (and a restart-free .env tweak in dev) see current values.
 *
 *   SMILE_NOLA_MODE         "booth" | "prod" (default "prod")
 *   BOOTH_PROD_API_URL      origin of the prod site, e.g. https://smile-nola.com
 *   BOOTH_PROD_API_TOKEN    an sn_ token holding write:sync
 *   BOOTH_SYNC_INTERVAL_MS  ms between automatic drains; default 30000, 0 = manual
 */

import { getEnv } from "@/lib/env";

export const DEFAULT_SYNC_INTERVAL_MS = 30_000;
export const SYNC_PATH = "/api/v1/sync/inquiries";

export type SiteMode = "booth" | "prod";

export interface BoothConfig {
  mode: SiteMode;
  prodApiUrl: string;
  prodApiToken: string;
  syncIntervalMs: number;
}

export function readBoothConfig(): BoothConfig {
  const mode: SiteMode = getEnv("SMILE_NOLA_MODE").trim().toLowerCase() === "booth" ? "booth" : "prod";
  const rawInterval = getEnv("BOOTH_SYNC_INTERVAL_MS").trim();
  let syncIntervalMs = DEFAULT_SYNC_INTERVAL_MS;
  if (rawInterval !== "") {
    const n = Number.parseInt(rawInterval, 10);
    if (Number.isFinite(n) && n >= 0) syncIntervalMs = n;
  }
  return {
    mode,
    prodApiUrl: getEnv("BOOTH_PROD_API_URL").trim().replace(/\/+$/, ""),
    prodApiToken: getEnv("BOOTH_PROD_API_TOKEN").trim(),
    syncIntervalMs,
  };
}

/** The full URL the drain posts to, or null when no prod URL is set. */
export function syncEndpoint(cfg: BoothConfig): string | null {
  return cfg.prodApiUrl ? `${cfg.prodApiUrl}${SYNC_PATH}` : null;
}

export function isSyncConfigured(cfg: BoothConfig): boolean {
  return cfg.prodApiUrl !== "" && cfg.prodApiToken !== "";
}
