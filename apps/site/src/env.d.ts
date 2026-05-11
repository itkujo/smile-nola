/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Admin password (single shared) — required for /admin routes. */
  readonly ADMIN_PASSWORD?: string;
  /** Secret used to sign the admin session cookie. */
  readonly ADMIN_SESSION_SECRET?: string;
  /** Email recipient for inquiry notifications. */
  readonly NOTIFY_EMAIL?: string;
  readonly SMTP_HOST?: string;
  readonly SMTP_PORT?: string;
  readonly SMTP_USER?: string;
  readonly SMTP_PASS?: string;
  /** Optional override for where leads.db lives (used by tests / non-default layouts). */
  readonly SMILE_NOLA_DB_DIR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
