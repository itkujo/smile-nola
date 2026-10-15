/**
 * defineOperation — the single definition of an API operation.
 *
 * Everything else (the /api/v1 router, /api/v1/openapi.json, /developers and,
 * later, the MCP tool list) is generated from these definitions.
 *
 * Input is one Zod object. The router assembles it from:
 *   - path params ({id} in the path),
 *   - the query string (every method),
 *   - the JSON body (POST, PUT, PATCH).
 * In OpenAPI, path-template keys become path params; for GET/DELETE the other
 * keys are query params, for body methods they are the JSON request body.
 * Query strings and path params arrive as strings, so use z.coerce for numbers.
 */

import type { z } from "zod";
import type { ScopeRequirement } from "./scopes";

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type Method = (typeof METHODS)[number];
export const BODY_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH"]);

export type AuthContext =
  | { kind: "anonymous" }
  | { kind: "session" }
  | { kind: "token"; tokenId: number; label: string; scopes: string[] };

export interface HandlerContext<I> {
  input: I;
  auth: AuthContext;
  request: Request;
  requestId: string;
}

/** The marker the discovery step looks for on module exports. */
export const OPERATION = Symbol.for("smile-nola.api.operation");

/** Input must be an object schema (possibly refined/effected). */
type InputSchema = z.ZodTypeAny;
type OutputSchema = z.ZodTypeAny;

export interface OperationSpec<I extends InputSchema, O extends OutputSchema> {
  /** Stable id, snake_case: "tokens_create". Becomes the OpenAPI operationId and MCP tool name. */
  id: string;
  /** Short, for a person: "Make an access token". */
  summary: string;
  /** Longer description (optional). */
  description?: string;
  /** Groups endpoints on /developers and in OpenAPI. */
  tag: string;
  method: Method;
  /** Path under /api/v1, with {param} placeholders: "/me/tokens/{id}". */
  path: string;
  /** See ScopeRequirement in scopes.ts. */
  scope: ScopeRequirement;
  input: I;
  output: O;
  /** HTTP status on success. Default 200. */
  successStatus?: number;
  /** Offer this operation to AI agents (MCP) once that exists. */
  agent?: boolean;
  handler: (ctx: HandlerContext<z.output<I>>) => Promise<z.input<O>> | z.input<O>;
}

export type Operation<I extends InputSchema = InputSchema, O extends OutputSchema = OutputSchema> =
  OperationSpec<I, O> & { readonly [OPERATION]: true };

// The registry stores heterogeneous operations.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyOperation = Operation<any, any>;

const ID_RE = /^[a-z][a-z0-9_]*$/;
const SEGMENT = String.raw`(?:[a-z0-9._-]+|\{[a-zA-Z][a-zA-Z0-9]*\})`;
const PATH_RE = new RegExp(`^(?:/${SEGMENT})+$`);

export function defineOperation<I extends InputSchema, O extends OutputSchema>(
  spec: OperationSpec<I, O>,
): Operation<I, O> {
  if (!ID_RE.test(spec.id)) throw new Error(`operation id "${spec.id}" must be snake_case`);
  if (!PATH_RE.test(spec.path)) throw new Error(`operation ${spec.id}: bad path "${spec.path}"`);
  return Object.freeze({ ...spec, [OPERATION]: true as const });
}

export function isOperation(v: unknown): v is AnyOperation {
  return typeof v === "object" && v !== null && (v as Record<symbol, unknown>)[OPERATION] === true;
}

/** Names of the {params} in a path template, in order. */
export function pathParams(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}
