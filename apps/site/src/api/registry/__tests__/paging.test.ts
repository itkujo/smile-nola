import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "../errors";
import { PagingInput, decodeCursor, encodeCursor, pageOf, paginate } from "../paging";

const items = Array.from({ length: 7 }, (_, i) => ({ id: i + 1 }));
const fetch = (after: number | undefined, take: number) =>
  items.filter((x) => after === undefined || x.id > after).slice(0, take);
const run = (q: Record<string, string>) =>
  paginate(PagingInput.parse(q), { cursor: z.number().int(), fetch, cursorOf: (x) => x.id });

describe("PagingInput", () => {
  it("defaults limit to 25 and coerces strings", () => {
    expect(PagingInput.parse({})).toEqual({ limit: 25 });
    expect(PagingInput.parse({ limit: "10", cursor: "abc" })).toEqual({ limit: 10, cursor: "abc" });
  });
  it("rejects limits outside 1..100", () => {
    expect(PagingInput.safeParse({ limit: "0" }).success).toBe(false);
    expect(PagingInput.safeParse({ limit: "101" }).success).toBe(false);
    expect(PagingInput.safeParse({ limit: "2.5" }).success).toBe(false);
  });
});

describe("paginate", () => {
  it("walks every page and ends with nextCursor null", () => {
    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = run(cursor ? { limit: "3", cursor } : { limit: "3" });
      seen.push(...page.data.map((x) => x.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pages).toBe(3);
  });

  it("an exact final page has no next cursor", () => {
    const page = run({ limit: "7" });
    expect(page.data).toHaveLength(7);
    expect(page.nextCursor).toBeNull();
  });

  it("rejects a cursor it did not give out", () => {
    expect(() => run({ cursor: "!!!" })).toThrow(ApiError);
    expect(() => decodeCursor(encodeCursor("text"), z.number())).toThrow(/cursor/);
  });

  it("pageOf shapes { data, nextCursor }", () => {
    const S = pageOf(z.object({ id: z.number() }));
    expect(S.parse({ data: [{ id: 1 }], nextCursor: null })).toEqual({ data: [{ id: 1 }], nextCursor: null });
  });
});
