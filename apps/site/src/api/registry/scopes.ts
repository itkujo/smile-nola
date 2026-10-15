/**
 * The scope catalog. A token carries a list of these; an operation names the
 * one it needs (or null when it is public, or "any" when any credential will
 * do). `write:x` includes `read:x`. The admin session cookie acts as every
 * scope.
 *
 * Later units add a resource here when they add its operations.
 */

export const SCOPE_RESOURCES = {
  inquiries: "inquiries",
  builder: "package builder submissions and invites",
  portfolio: "the video portfolio",
  testimonials: "testimonials",
  settings: "site settings",
} as const;

/** Scopes that are not a read/write pair. */
export const SPECIAL_SCOPES = {
  admin: "Manage API tokens and other admin-only settings.",
} as const;

function buildCatalog(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [res, noun] of Object.entries(SCOPE_RESOURCES)) {
    out[`read:${res}`] = `Read ${noun}.`;
    out[`write:${res}`] = `Create and change ${noun}.`;
  }
  return { ...out, ...SPECIAL_SCOPES };
}

/** Every scope name and its one-line description, in display order. */
export const SCOPES: Readonly<Record<string, string>> = buildCatalog();

export const SCOPE_NAMES = Object.keys(SCOPES);

export function isKnownScope(s: string): boolean {
  return Object.prototype.hasOwnProperty.call(SCOPES, s);
}

/** Special requirement: any valid credential (token with any scopes, or the session). */
export const ANY = "any";

/**
 * What an operation requires:
 *   null   — public, no credential.
 *   "any"  — any valid credential.
 *   string — that scope (write:x also satisfies read:x).
 */
export type ScopeRequirement = string | null;

/** True iff `granted` satisfies `required`. */
export function hasScope(granted: readonly string[], required: string): boolean {
  if (required === ANY) return true;
  if (granted.includes(required)) return true;
  if (required.startsWith("read:")) {
    return granted.includes(`write:${required.slice("read:".length)}`);
  }
  return false;
}
