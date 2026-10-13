/**
 * A Model Context Protocol server (spec 2025-06-18) over the operation
 * registry, on the Streamable HTTP transport in its simplest legal form:
 *
 *   POST /api/v1/mcp   one JSON-RPC message in, one JSON answer out
 *   anything else      405 (no GET event stream, no sessions to delete)
 *
 * No session ids, no SSE, no CORS. Tools come only from the registry:
 * operations marked `agent: true`, shown to a token only when its scopes
 * allow running them. Methods: initialize, notifications/initialized, ping,
 * tools/list, tools/call.
 */

import crypto from "node:crypto";
import { authenticate } from "../../registry/auth";
import type { AnyOperation, AuthContext } from "../../registry/define";
import { ResponseExtras } from "../../registry/define";
import { ApiError, fromZodError } from "../../registry/errors";
import { apiRateLimiter, rateLimitHeaders, type RateLimiter } from "../../registry/ratelimit";
import { ANY, hasScope } from "../../registry/scopes";
import { publicOrigin } from "../../registry/openapi";
import { toolInputSchema } from "./schema";

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const SERVER_INFO = { name: "smilenola", title: "Smile NOLA", version: "1.0.0" };

const RPC = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  /** Implementation-defined: the operation answered with an API error. */
  api: -32000,
  /** Implementation-defined: the token may not run this tool. */
  insufficientScope: -32003,
} as const;

type Id = string | number | null;
interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

class RpcFailure extends Error {
  constructor(
    readonly rpc: RpcError,
  ) {
    super(rpc.message);
  }
}
const fail = (code: number, message: string, data?: unknown) =>
  new RpcFailure({ code, message, ...(data === undefined ? {} : { data }) });

export interface McpOptions {
  operations: readonly AnyOperation[];
  limiter?: RateLimiter;
  logger?: Pick<Console, "warn" | "error">;
}

export type McpHandler = (request: Request, meta?: { clientAddress?: string }) => Promise<Response>;

const BASE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

/** Can this credential run this operation? Mirrors authorize() without throwing. */
function allowed(op: AnyOperation, auth: AuthContext): boolean {
  if (op.scope === null || op.scope === ANY) return true;
  if (auth.kind === "session") return true;
  if (auth.kind === "token") return hasScope(auth.scopes, op.scope);
  return false;
}

function describeTool(op: AnyOperation) {
  return {
    name: op.id,
    title: op.summary,
    description: op.toolDescription ?? op.description ?? op.summary,
    inputSchema: toolInputSchema(op),
    annotations: { title: op.summary, readOnlyHint: op.method === "GET" },
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function createMcpHandler(opts: McpOptions): McpHandler {
  const tools = opts.operations.filter((o) => o.agent === true);
  const byName = new Map(tools.map((o) => [o.id, o]));
  const limiter = opts.limiter ?? apiRateLimiter;
  const logger = opts.logger ?? console;

  async function callTool(
    params: unknown,
    auth: AuthContext,
    request: Request,
    requestId: string,
    clientAddress: string,
  ) {
    if (!isPlainObject(params) || typeof params.name !== "string") {
      throw fail(RPC.invalidParams, "tools/call needs a tool name.");
    }
    const op = byName.get(params.name);
    if (!op) throw fail(RPC.invalidParams, `Unknown tool: ${params.name}.`);
    if (!allowed(op, auth)) {
      throw fail(
        RPC.insufficientScope,
        op.scope === ANY ? "This token cannot be used here." : `This token lacks the ${op.scope} scope.`,
        { code: "insufficient_scope", scope: op.scope },
      );
    }
    const args = params.arguments ?? {};
    if (!isPlainObject(args)) throw fail(RPC.invalidParams, "arguments must be an object.");
    const parsed = op.input.safeParse(args);
    if (!parsed.success) {
      const e = fromZodError(parsed.error, "arguments");
      throw fail(RPC.invalidParams, e.message, { code: e.code });
    }
    const answer = await op.handler({ input: parsed.data, auth, request, requestId, clientAddress });
    const value = answer instanceof ResponseExtras ? answer.value : answer;
    const out = op.output.safeParse(value);
    if (!out.success) {
      throw new Error(`operation ${op.id} answered outside its output schema: ${out.error.message}`);
    }
    const text = typeof out.data === "string" ? out.data : JSON.stringify(out.data);
    return {
      content: [{ type: "text", text }],
      ...(isPlainObject(out.data) ? { structuredContent: out.data } : {}),
      isError: false,
    };
  }

  async function dispatch(
    msg: Record<string, unknown>,
    auth: AuthContext,
    request: Request,
    requestId: string,
    clientAddress: string,
  ): Promise<unknown> {
    const params = msg.params;
    switch (msg.method) {
      case "initialize": {
        const asked = isPlainObject(params) ? params.protocolVersion : undefined;
        const version = (PROTOCOL_VERSIONS as readonly unknown[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0];
        return {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            "Smile NOLA's studio data. Tools shown here are the ones this token's scopes allow; a read-only token can look but not change anything.",
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return { tools: tools.filter((o) => allowed(o, auth)).map(describeTool) };
      case "tools/call":
        return callTool(params, auth, request, requestId, clientAddress);
      default:
        throw fail(RPC.methodNotFound, `Method not found: ${String(msg.method)}.`);
    }
  }

  return async function handle(request, meta = {}) {
    const requestId = crypto.randomUUID();
    const headers: Record<string, string> = { ...BASE_HEADERS, "X-Request-Id": requestId };
    const apiError = (err: ApiError) => {
      logger.warn(`[mcp] ${requestId} ${request.method} -> ${err.status} ${err.code}: ${err.message}`);
      return new Response(JSON.stringify(err.toBody()), {
        status: err.status,
        headers: { ...headers, ...err.headers },
      });
    };
    const rpc = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers });

    try {
      if (request.method.toUpperCase() !== "POST") {
        throw new ApiError(
          "method_not_allowed",
          `${request.method} is not allowed on /api/v1/mcp. Allowed: POST.`,
          { Allow: "POST" },
        );
      }

      // DNS-rebinding guard from the spec: a browser page on another origin may not call this.
      const origin = request.headers.get("origin");
      if (origin !== null) {
        let same = false;
        try {
          same = new URL(origin).origin === publicOrigin(request);
        } catch {
          same = false;
        }
        if (!same) throw new ApiError("forbidden", "This endpoint does not accept requests from another origin.");
      }

      // Identify. MCP is for access tokens: the admin cookie is not accepted here.
      const auth = authenticate(request);
      if (auth.kind !== "token") {
        throw new ApiError("unauthorized", "Send Authorization: Bearer <token>.");
      }

      const decision = limiter.consume(`token:${auth.tokenId}`);
      Object.assign(headers, rateLimitHeaders(decision));
      if (!decision.allowed) {
        throw new ApiError("rate_limited", `Too many requests. Wait ${decision.reset} seconds.`, {
          "Retry-After": String(decision.reset),
        });
      }

      let body: unknown;
      try {
        body = JSON.parse(await request.text());
      } catch {
        return rpc(400, { jsonrpc: "2.0", id: null, error: { code: RPC.parseError, message: "Body is not valid JSON." } });
      }
      if (!isPlainObject(body) || body.jsonrpc !== "2.0") {
        return rpc(400, {
          jsonrpc: "2.0",
          id: null,
          error: { code: RPC.invalidRequest, message: "Send one JSON-RPC 2.0 message per request (no batches)." },
        });
      }

      // A response from the client, or a notification: nothing to answer.
      const isRequest = typeof body.method === "string" && "id" in body && body.id !== undefined;
      if (typeof body.method !== "string" || !isRequest) {
        if (typeof body.method !== "string" && !("result" in body || "error" in body)) {
          return rpc(400, {
            jsonrpc: "2.0",
            id: null,
            error: { code: RPC.invalidRequest, message: "Not a JSON-RPC request, notification or response." },
          });
        }
        return new Response(null, { status: 202, headers: { "X-Request-Id": requestId } });
      }

      const id = body.id as Id;
      if (id !== null && typeof id !== "string" && typeof id !== "number") {
        return rpc(400, { jsonrpc: "2.0", id: null, error: { code: RPC.invalidRequest, message: "Bad request id." } });
      }
      try {
        const result = await dispatch(body, auth, request, requestId, meta.clientAddress ?? "unknown");
        return rpc(200, { jsonrpc: "2.0", id, result });
      } catch (err) {
        if (err instanceof RpcFailure) return rpc(200, { jsonrpc: "2.0", id, error: err.rpc });
        if (err instanceof ApiError) {
          logger.warn(`[mcp] ${requestId} ${String(body.method)} -> ${err.status} ${err.code}: ${err.message}`);
          return rpc(200, {
            jsonrpc: "2.0",
            id,
            error: { code: RPC.api, message: err.message, data: { code: err.code, status: err.status } },
          });
        }
        logger.error(`[mcp] ${requestId} ${String(body.method)} failed`, err);
        return rpc(200, {
          jsonrpc: "2.0",
          id,
          error: {
            code: RPC.internal,
            message: `Something failed on our side. Quote request id ${requestId} when reporting it.`,
          },
        });
      }
    } catch (err) {
      if (err instanceof ApiError) return apiError(err);
      logger.error(`[mcp] ${requestId} failed`, err);
      return apiError(
        new ApiError("internal_error", `Something failed on our side. Quote request id ${requestId} when reporting it.`),
      );
    }
  };
}

