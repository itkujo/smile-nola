/**
 * Tiny env helper.
 *
 * In production (Docker / Coolify) env vars come from the container runtime
 * and live on `process.env`. In dev, Astro loads `.env` into `import.meta.env`
 * but does NOT mirror those into `process.env` (only public PUBLIC_*
 * variables are exposed). This helper reads from both so the same code path
 * works in both environments.
 *
 * Returns `""` (not undefined) when missing — callers explicitly check for
 * empty strings.
 */
export function getEnv(key: string): string {
  // import.meta.env is statically resolved by Vite at build time; lookups
  // against an unknown key just return undefined.
  const fromMeta = (import.meta.env as Record<string, unknown>)[key];
  if (typeof fromMeta === "string" && fromMeta.length > 0) return fromMeta;

  const fromProc = process.env[key];
  if (typeof fromProc === "string" && fromProc.length > 0) return fromProc;

  return "";
}

export function getEnvBool(key: string, fallback = false): boolean {
  const v = getEnv(key).toLowerCase();
  if (!v) return fallback;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Strict env read — throws if the variable is missing or empty.
 * Use for transports/secrets where a silent fallback would mask a real
 * configuration bug (e.g. RESEND_API_KEY, ADMIN_SESSION_SECRET).
 */
export function getRequiredEnv(name: string): string {
  const v = getEnv(name).trim();
  if (!v) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Set it in apps/site/.env locally and in the Coolify env UI for production.`
    );
  }
  return v;
}
