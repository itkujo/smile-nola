/**
 * Call a registered API operation in-process, as the signed-in admin.
 *
 * Astro pages (and layouts/components) render on the server and must not
 * read the database themselves: they go through the same operations the HTTP
 * API serves. This runs the operation's input check, handler and output check
 * exactly like the router does, minus the HTTP hop, auth and rate limit —
 * the caller is trusted server code (admin pages are behind the middleware).
 *
 * Errors surface as ApiError, same as over HTTP.
 */

import type { z } from "zod";
import { getOperations } from "@/api/registry/index";
import { ResponseExtras } from "@/api/registry/define";
import { ApiError, fromZodError } from "@/api/registry/errors";

export async function callOperation<T = any>( // eslint-disable-line @typescript-eslint/no-explicit-any
  id: string,
  input: Record<string, unknown> = {},
  opts: { request?: Request } = {},
): Promise<T> {
  const op = getOperations().find((o) => o.id === id);
  if (!op) throw new Error(`callOperation: no operation "${id}"`);
  const parsed = (op.input as z.ZodTypeAny).safeParse(input);
  if (!parsed.success) throw fromZodError(parsed.error);
  const request =
    opts.request ?? new Request(`http://internal.invalid/api/v1${op.path}`, { method: op.method });
  const answer = await op.handler({
    input: parsed.data,
    auth: { kind: "session" },
    request,
    requestId: "in-process",
    clientAddress: "internal",
  });
  const value = answer instanceof ResponseExtras ? answer.value : answer;
  const out = (op.output as z.ZodTypeAny).safeParse(value);
  if (!out.success) {
    throw new Error(`operation ${op.id} answered outside its output schema: ${out.error.message}`);
  }
  return out.data as T;
}

/** Like callOperation, but answers null when the operation says not_found. */
export async function callOrNull<T = any>( // eslint-disable-line @typescript-eslint/no-explicit-any
  id: string,
  input: Record<string, unknown> = {},
  opts: { request?: Request } = {},
): Promise<T | null> {
  try {
    return await callOperation<T>(id, input, opts);
  } catch (err) {
    if (err instanceof ApiError && err.code === "not_found") return null;
    throw err;
  }
}
