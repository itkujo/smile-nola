/**
 * Who is calling, and may they run this operation?
 *
 *   Authorization: Bearer sn_...   → a token, with its scopes.
 *   sn_admin session cookie        → the signed-in admin, acting as every scope.
 *   neither                        → anonymous; only public (scope null) ops.
 *
 * A bad bearer token is an error even on a public op: a caller who sends a
 * credential should learn it does not work.
 */

import { isAuthed } from "@/lib/auth";
import type { AnyOperation, AuthContext } from "./define";
import { BODY_METHODS } from "./define";
import { ApiError } from "./errors";
import { ANY, hasScope } from "./scopes";
import { findTokenByValue, touchToken } from "./tokens";

export function authenticate(request: Request, now = new Date()): AuthContext {
  const header = request.headers.get("authorization");
  if (header !== null) {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
    if (!m) {
      throw new ApiError("unauthorized", "The Authorization header must be: Bearer <token>.");
    }
    const record = findTokenByValue(m[1]);
    if (!record || record.revokedAt) {
      throw new ApiError("unauthorized", "This token is not valid. It may have been revoked.");
    }
    if (record.expiresAt && Date.parse(record.expiresAt) <= now.getTime()) {
      throw new ApiError("token_expired", "This token is past its expiry. Make a new one.");
    }
    touchToken(record.id);
    return { kind: "token", tokenId: record.id, label: record.label, scopes: record.scopes };
  }
  if (isAuthed(request)) return { kind: "session" };
  return { kind: "anonymous" };
}

export function authorize(op: AnyOperation, auth: AuthContext, request: Request): void {
  if (op.scope === null) return;
  if (auth.kind === "anonymous") {
    throw new ApiError("unauthorized", "Send Authorization: Bearer <token>, or sign in.");
  }
  if (auth.kind === "session") {
    // A signed-in request that changes something must come from this site.
    // Tokens are never affected by this rule.
    if (BODY_METHODS.has(op.method) || op.method === "DELETE") {
      const site = request.headers.get("sec-fetch-site");
      if (site === "cross-site" || site === "same-site") {
        throw new ApiError("forbidden", "A signed-in request that changes something must come from this site.");
      }
    }
    return;
  }
  if (!hasScope(auth.scopes, op.scope)) {
    throw new ApiError(
      "insufficient_scope",
      op.scope === ANY ? "This token cannot be used here." : `This token lacks the ${op.scope} scope.`,
    );
  }
}

/** The scopes a caller effectively holds (the session holds every one). */
export function effectiveScopes(auth: AuthContext, all: readonly string[]): string[] {
  if (auth.kind === "session") return [...all];
  if (auth.kind === "token") return auth.scopes;
  return [];
}
