/**
 * /api/v1/mcp — the Model Context Protocol endpoint (Streamable HTTP, JSON
 * answers). More specific than the [...path] catch-all, so it wins the route.
 * The tools are the registry's `agent: true` operations; see src/api/v1/mcp.
 */

import type { APIRoute } from "astro";
import { clientIp } from "@/lib/auth";
import { getOperations } from "@/api/registry/index";
import { createMcpHandler, type McpHandler } from "@/api/v1/mcp/server";

export const prerender = false;

let handler: McpHandler | null = null;

export const ALL: APIRoute = async (context) => {
  let clientAddress = clientIp(context.request);
  if (clientAddress === "unknown") {
    try {
      clientAddress = context.clientAddress;
    } catch {
      // Adapter could not tell; keep "unknown".
    }
  }
  handler ??= createMcpHandler({ operations: getOperations() });
  return handler(context.request, { clientAddress });
};
