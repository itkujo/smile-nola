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

/**
 * Plausible analytics tracker. Injected via a deferred <script> on
 * production hosts (see BaseLayout.astro). The queue-shim snippet creates
 * the function before the real script loads, so calls made early are
 * buffered and flushed when the tracker is ready.
 *
 * Optional in the type: any code that calls it must guard with
 * `if (typeof window !== 'undefined' && window.plausible)` (or `?.()`)
 * so dev / preview hosts where the script is not injected don't crash.
 */
type PlausibleEventOptions = {
  callback?: () => void;
  props?: Record<string, string | number | boolean>;
};

interface Window {
  plausible?: ((eventName: string, options?: PlausibleEventOptions) => void) & {
    q?: IArguments[];
  };
}
