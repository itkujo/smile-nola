/**
 * The /api/v1 router, built from a list of operations.
 *
 * Order of work for one request:
 *   1. request id; identify the caller (a bad token is remembered, not yet thrown)
 *   2. rate limit by token id, or by address
 *   3. match the path (404 not_found) and method (405 + Allow)
 *   4. raise the remembered auth error, then check the op's scope
 *   5. assemble input from path params + query + JSON body; validate with Zod
 *   6. run the handler; validate its answer against the output schema
 * Every answer is JSON, carries X-Request-Id, and errors use { error: { code, message } }.
 */

import crypto from "node:crypto";
import type { AnyOperation, AuthContext } from "./define";
import { BODY_METHODS, pathParams } from "./define";
import { authenticate, authorize } from "./auth";
import { ApiError, badRequest, fromZodError } from "./errors";
import { apiRateLimiter, rateLimitHeaders, type RateLimiter } from "./ratelimit";

export const API_PREFIX = "/api/v1";

interface CompiledRoute {
  op: AnyOperation;
  regex: RegExp;
  params: string[];
  staticSegments: number;
}

export type RouteMatch =
  | { kind: "ok"; op: AnyOperation; params: Record<string, string> }
  | { kind: "method_not_allowed"; allow: string[] }
  | { kind: "not_found" };

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compileRoutes(ops: readonly AnyOperation[]): CompiledRoute[] {
  return ops.map((op) => {
    const segments = op.path.split("/").filter(Boolean);
    const pattern = segments
      .map((seg) => (seg.startsWith("{") ? "([^/]+)" : escapeRe(seg)))
      .join("/");
    return {
      op,
      regex: new RegExp(`^/${pattern}$`),
      params: pathParams(op.path),
      staticSegments: segments.filter((s) => !s.startsWith("{")).length,
    };
  });
}

export function matchRoute(routes: readonly CompiledRoute[], method: string, path: string): RouteMatch {
  const hits: { route: CompiledRoute; values: string[] }[] = [];
  for (const route of routes) {
    const m = route.regex.exec(path);
    if (m) hits.push({ route, values: m.slice(1) });
  }
  if (hits.length === 0) return { kind: "not_found" };

  // The most specific template wins (/me/tokens/new beats /me/tokens/{id}).
  const best = Math.max(...hits.map((h) => h.route.staticSegments));
  const top = hits.filter((h) => h.route.staticSegments === best);
  const hit = top.find((h) => h.route.op.method === method);
  if (!hit) {
    const allow = [...new Set(top.map((h) => h.route.op.method))].sort();
    return { kind: "method_not_allowed", allow };
  }
  const params: Record<string, string> = {};
  hit.route.params.forEach((name, i) => {
    try {
      params[name] = decodeURIComponent(hit.values[i]);
    } catch {
      throw badRequest(`${name}: not a valid path segment`);
    }
  });
  return { kind: "ok", op: hit.route.op, params };
}

function isJsonContentType(ct: string | null): boolean {
  if (!ct) return false;
  const base = ct.split(";")[0].trim().toLowerCase();
  return base === "application/json" || (base.startsWith("application/") && base.endsWith("+json"));
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.trim() === "") return {};
  if (!isJsonContentType(request.headers.get("content-type"))) {
    throw new ApiError(
      "unsupported_media_type",
      "Request bodies must be JSON (Content-Type: application/json).",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw badRequest("body: not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw badRequest("body: must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function queryObject(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of url.searchParams) out[k] = v;
  return out;
}

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

export interface RouterOptions {
  operations: readonly AnyOperation[];
  limiter?: RateLimiter;
  /** Where errors are written. Defaults to console. */
  logger?: Pick<Console, "warn" | "error">;
}

export interface RequestMeta {
  /** The caller's address, for rate limiting anonymous calls. */
  clientAddress?: string;
}

export type ApiHandler = (request: Request, meta?: RequestMeta) => Promise<Response>;

export function createRouter(opts: RouterOptions): ApiHandler {
  const routes = compileRoutes(opts.operations);
  const limiter = opts.limiter ?? apiRateLimiter;
  const logger = opts.logger ?? console;

  return async function handle(request, meta = {}) {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    let path = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) : url.pathname;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    if (path === "") path = "/";

    const headers: Record<string, string> = { ...JSON_HEADERS, "X-Request-Id": requestId };

    try {
      // 1. Identify.
      let auth: AuthContext = { kind: "anonymous" };
      let authError: unknown = null;
      try {
        auth = authenticate(request);
      } catch (err) {
        authError = err;
      }

      // 2. Rate limit.
      const key =
        auth.kind === "token" ? `token:${auth.tokenId}` : `addr:${meta.clientAddress ?? "unknown"}`;
      const decision = limiter.consume(key);
      Object.assign(headers, rateLimitHeaders(decision));
      if (!decision.allowed) {
        throw new ApiError("rate_limited", `Too many requests. Wait ${decision.reset} seconds.`, {
          "Retry-After": String(decision.reset),
        });
      }

      // 3. Route.
      const match = matchRoute(routes, method, path);
      if (match.kind === "not_found") {
        throw new ApiError("not_found", `No endpoint at ${API_PREFIX}${path}.`);
      }
      if (match.kind === "method_not_allowed") {
        throw new ApiError(
          "method_not_allowed",
          `${method} is not allowed on ${API_PREFIX}${path}. Allowed: ${match.allow.join(", ")}.`,
          { Allow: match.allow.join(", ") },
        );
      }
      const { op, params } = match;

      // 4. Authorize.
      if (authError) throw authError;
      authorize(op, auth, request);

      // 5. Input.
      const body = BODY_METHODS.has(op.method) ? await readBody(request) : {};
      const raw = { ...queryObject(url), ...body, ...params };
      const parsed = op.input.safeParse(raw);
      if (!parsed.success) throw fromZodError(parsed.error);

      // 6. Handle.
      const result = await op.handler({ input: parsed.data, auth, request, requestId });
      const out = op.output.safeParse(result);
      if (!out.success) {
        throw new Error(`operation ${op.id} answered outside its output schema: ${out.error.message}`);
      }
      const status = op.successStatus ?? 200;
      if (status === 204) return new Response(null, { status, headers: { "X-Request-Id": requestId, ...rateHeadersOnly(headers) } });
      return new Response(JSON.stringify(out.data), { status, headers });
    } catch (err) {
      const apiErr =
        err instanceof ApiError
          ? err
          : new ApiError(
              "internal_error",
              `Something failed on our side. Quote request id ${requestId} when reporting it.`,
            );
      const line = `[api] ${requestId} ${method} ${url.pathname} -> ${apiErr.status} ${apiErr.code}: ${apiErr.message}`;
      if (apiErr.status >= 500) logger.error(line, err instanceof ApiError ? "" : err);
      else logger.warn(line);
      return new Response(JSON.stringify(apiErr.toBody()), {
        status: apiErr.status,
        headers: { ...headers, ...apiErr.headers },
      });
    }
  };
}

function rateHeadersOnly(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"]) {
    if (h[k]) out[k] = h[k];
  }
  return out;
}
