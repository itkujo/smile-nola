/**
 * Cursor paging, the one way every list answers:
 *
 *   ?limit=1..100 (default 25) &cursor=<opaque>
 *   → { "data": [...], "nextCursor": "<opaque>" | null }
 *
 * Cursors are base64url JSON of whatever key the list sorts by (usually the
 * last id seen). Callers treat them as opaque.
 */

import { z } from "zod";
import { badRequest } from "./errors";

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

/** Spread into a list op's input: `input: PagingInput.extend({...})`. */
export const PagingInput = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1, "must be between 1 and 100")
    .max(MAX_LIMIT, "must be between 1 and 100")
    .default(DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});
export type PagingParams = z.infer<typeof PagingInput>;

/** Output schema for a page of `item`. */
export function pageOf<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: z.array(item), nextCursor: z.string().nullable() });
}

export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor<S extends z.ZodTypeAny>(cursor: string, schema: S): z.output<S> {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw badRequest("cursor: not a cursor this API gave out");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw badRequest("cursor: not a cursor this API gave out");
  return parsed.data;
}

/**
 * Run one page of a list.
 *
 * `fetch(after, take)` returns up to `take` items strictly after the decoded
 * cursor (undefined on the first page) in list order. The helper asks for
 * one extra item to know whether there is a next page.
 */
export function paginate<T, C extends z.ZodTypeAny>(
  params: PagingParams,
  opts: {
    cursor: C;
    fetch: (after: z.output<C> | undefined, take: number) => T[];
    cursorOf: (item: T) => z.input<C>;
  },
): { data: T[]; nextCursor: string | null } {
  const after = params.cursor === undefined ? undefined : decodeCursor(params.cursor, opts.cursor);
  const rows = opts.fetch(after, params.limit + 1);
  const hasMore = rows.length > params.limit;
  const data = hasMore ? rows.slice(0, params.limit) : rows;
  const last = data[data.length - 1];
  return {
    data,
    nextCursor: hasMore && last !== undefined ? encodeCursor(opts.cursorOf(last)) : null,
  };
}
