/**
 * /api/v1/* — every request goes to the router generated from the operation
 * registry (src/api/registry). Auth, scopes, errors, rate limits and paging
 * all live there; this file only hands the request over.
 */

import type { APIRoute } from "astro";
import { clientIp } from "@/lib/auth";
import { getRouter } from "@/api/registry/index";

export const prerender = false;

export const ALL: APIRoute = async (context) => {
  let clientAddress = clientIp(context.request);
  if (clientAddress === "unknown") {
    try {
      clientAddress = context.clientAddress;
    } catch {
      // Adapter could not tell; keep "unknown".
    }
  }
  return getRouter()(context.request, { clientAddress });
};
