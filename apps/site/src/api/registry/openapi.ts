/**
 * OpenAPI 3.1 document, generated from the operation registry.
 *
 * Input split (see define.ts): {path} keys → path params; for GET/DELETE the
 * remaining keys → query params; for POST/PUT/PATCH → the JSON request body.
 * Security: each op's scope becomes a requirement on the bearerAuth scheme
 * (OpenAPI 3.1 allows scope lists on any scheme); the admin session cookie
 * is a second scheme that satisfies every scope.
 */

import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import type { AnyOperation } from "./define";
import { BODY_METHODS, pathParams } from "./define";
import { ERROR_CODES, ErrorBodySchema, type ErrorCode } from "./errors";
import { API_PREFIX } from "./router";
import { ANY, SCOPES } from "./scopes";
import { API_RATE_LIMIT } from "./ratelimit";

extendZodWithOpenApi(z);

export const API_TITLE = "Smile NOLA API";
export const API_VERSION = "1.0.0";

/** Unwrap refinements/effects to reach the underlying object schema. */
export function objectShapeOf(schema: z.ZodTypeAny): z.ZodObject<z.ZodRawShape> | null {
  let s: z.ZodTypeAny = schema;
  for (let i = 0; i < 10; i++) {
    if (s instanceof z.ZodObject) return s as z.ZodObject<z.ZodRawShape>;
    if (s instanceof z.ZodEffects) s = s.innerType();
    else if (s instanceof z.ZodDefault || s instanceof z.ZodOptional) s = s._def.innerType;
    else return null;
  }
  return null;
}

/** Split an op's input into path params and the rest (query or body). */
export function splitInput(op: AnyOperation): {
  params: z.ZodObject<z.ZodRawShape> | null;
  rest: z.ZodObject<z.ZodRawShape> | null;
} {
  const obj = objectShapeOf(op.input);
  if (!obj) return { params: null, rest: null };
  const names = pathParams(op.path);
  const shape = obj.shape;
  const paramShape: z.ZodRawShape = {};
  const restShape: z.ZodRawShape = {};
  for (const [k, v] of Object.entries(shape)) {
    if (names.includes(k)) paramShape[k] = v;
    else restShape[k] = v;
  }
  return {
    params: Object.keys(paramShape).length ? z.object(paramShape) : null,
    rest: Object.keys(restShape).length ? z.object(restShape) : null,
  };
}

function errorResponse(codes: ErrorCode[]) {
  return {
    description: codes.map((c) => `\`${c}\`: ${ERROR_CODES[c].description}`).join("\n\n"),
    content: { "application/json": { schema: ErrorBodySchema } },
  };
}

/** The error codes an operation can answer with, grouped by HTTP status. */
export function errorCodesFor(op: AnyOperation): Map<number, ErrorCode[]> {
  const codes: ErrorCode[] = ["bad_request"];
  if (op.scope !== null) codes.push("unauthorized", "token_expired", "insufficient_scope", "forbidden");
  if (pathParams(op.path).length) codes.push("not_found");
  if (BODY_METHODS.has(op.method)) codes.push("unsupported_media_type");
  codes.push("rate_limited", "internal_error");
  const byStatus = new Map<number, ErrorCode[]>();
  for (const c of codes) {
    const st = ERROR_CODES[c].status;
    byStatus.set(st, [...(byStatus.get(st) ?? []), c]);
  }
  return byStatus;
}

export function generateOpenApi(
  operations: readonly AnyOperation[],
  opts: { serverUrl?: string } = {},
): Record<string, unknown> {
  const registry = new OpenAPIRegistry();
  const errorRef = registry.register("Error", ErrorBodySchema);
  void errorRef;

  const scopeList = Object.entries(SCOPES)
    .map(([name, desc]) => `- \`${name}\`: ${desc}`)
    .join("\n");

  registry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description:
      "A token made at /admin/tokens, sent as `Authorization: Bearer sn_...`. " +
      "Each operation lists the scope it needs; `write:x` includes `read:x`.\n\nScopes:\n" +
      scopeList,
    // Machine-readable scope catalog.
    "x-scopes": { ...SCOPES },
  } as never);
  registry.registerComponent("securitySchemes", "sessionCookie", {
    type: "apiKey",
    in: "cookie",
    name: "sn_admin",
    description: "The admin sign-in. Acts as every scope.",
  });

  for (const op of operations) {
    const { params, rest } = splitInput(op);
    const isBody = BODY_METHODS.has(op.method);
    const status = op.successStatus ?? 200;

    const responses: Record<string, unknown> = {
      [String(status)]:
        status === 204
          ? { description: "Done." }
          : {
              description: "Success.",
              content: op.text
                ? { [op.text.contentType]: { schema: op.output } }
                : { "application/json": { schema: op.output } },
            },
    };
    for (const [st, codes] of errorCodesFor(op)) responses[String(st)] = errorResponse(codes);

    const security =
      op.scope === null
        ? []
        : [{ bearerAuth: op.scope === ANY ? [] : [op.scope] }, { sessionCookie: [] }];

    registry.registerPath({
      method: op.method.toLowerCase() as "get",
      path: op.path,
      operationId: op.id,
      summary: op.summary,
      description: op.description,
      tags: [op.tag],
      security,
      request: {
        ...(params ? { params } : {}),
        ...(rest && !isBody ? { query: rest } : {}),
        ...(rest && isBody
          ? {
              body: {
                required: true,
                content: {
                  "application/json": { schema: rest },
                  ...(op.multipart ? { "multipart/form-data": { schema: rest } } : {}),
                },
              },
            }
          : {}),
      },
      responses: responses as never,
      ...(op.scope !== null ? { "x-scope": op.scope } : {}),
      ...(op.agent ? { "x-agent": true } : {}),
    } as never);
  }

  const generator = new OpenApiGeneratorV31(registry.definitions);
  const doc = generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: API_TITLE,
      version: API_VERSION,
      description:
        `Everything Smile NOLA's admin does goes through this API. Bodies are JSON; ` +
        `errors are always { "error": { "code", "message" } }; every answer has an X-Request-Id; ` +
        `${API_RATE_LIMIT} requests a minute per token. No CORS: call it from a server.`,
    },
    servers: [{ url: opts.serverUrl ?? API_PREFIX }],
    tags: [...new Set(operations.map((o) => o.tag))].map((name) => ({ name })),
  });
  return doc as unknown as Record<string, unknown>;
}

/** The public origin a request came in on (honours the reverse proxy headers). */
export function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host") || url.host;
  return `${proto}://${host}`;
}
