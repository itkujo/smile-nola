/**
 * The one error shape every /api/v1 answer uses:
 *
 *   { "error": { "code": "<code>", "message": "<for a person>" } }
 *
 * Codes and statuses are HQ's, verbatim. Handlers throw `ApiError`; the
 * router turns it (and anything else thrown) into this shape.
 */

import { z } from "zod";

export const ERROR_CODES = {
  bad_request: {
    status: 400,
    description: "The request is malformed or fails validation; the message names the field.",
  },
  unauthorized: {
    status: 401,
    description: "No valid credential: send Authorization: Bearer <token>, or sign in.",
  },
  token_expired: {
    status: 401,
    description: "The token is past its expiry. Make a new one.",
  },
  insufficient_scope: {
    status: 403,
    description: "The token lacks the scope this operation needs; the message names it.",
  },
  forbidden: {
    status: 403,
    description: "This is not allowed, or a signed-in request came from another site.",
  },
  not_found: {
    status: 404,
    description: "No such endpoint, or no such object for this caller.",
  },
  method_not_allowed: {
    status: 405,
    description: "The path exists, but not for this method. See the Allow header.",
  },
  conflict: {
    status: 409,
    description: "The object is not in a state that allows this.",
  },
  unsupported_media_type: {
    status: 415,
    description: "Request bodies must be JSON (Content-Type: application/json).",
  },
  rate_limited: {
    status: 429,
    description: "Too many requests. Wait for Retry-After seconds.",
  },
  internal_error: {
    status: 500,
    description: "Something failed on our side. Quote the X-Request-Id when reporting it.",
  },
  unavailable: {
    status: 503,
    description: "A service the site depends on could not answer. Try again shortly.",
  },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export const ERROR_CODE_NAMES = Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]];

export const ErrorBodySchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODE_NAMES),
    message: z.string(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Extra response headers (Allow, Retry-After, ...). */
  readonly headers: Record<string, string>;

  constructor(code: ErrorCode, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = ERROR_CODES[code].status;
    this.headers = headers;
  }

  toBody(): ErrorBody {
    return { error: { code: this.code, message: this.message } };
  }
}

/** Shorthands so handlers read like prose. */
export const badRequest = (message: string) => new ApiError("bad_request", message);
export const notFound = (message = "No such object.") => new ApiError("not_found", message);
export const conflict = (message: string) => new ApiError("conflict", message);
export const forbidden = (message: string) => new ApiError("forbidden", message);
export const unavailable = (message: string) => new ApiError("unavailable", message);

/**
 * Turn a ZodError into a bad_request whose message names the first failing
 * field, e.g. `label: Required` or `scopes.1: Unknown scope "read:nope"`.
 */
export function fromZodError(err: z.ZodError, fallbackField = "body"): ApiError {
  const issue = err.issues[0];
  const field = issue && issue.path.length > 0 ? issue.path.join(".") : fallbackField;
  const message = issue ? issue.message : "Invalid input";
  return badRequest(`${field}: ${message}`);
}
