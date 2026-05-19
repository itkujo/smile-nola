/**
 * GET /api/admin/export/inquiries.csv
 *
 * Returns the inquiries table as a HoneyBook-importable CSV. Protected
 * by the middleware — unauthed callers get 401 / 302.
 *
 * Optional `?status=` filter narrows the export. Recognized values:
 *   new | contacted | closed   → exact-match status filter
 *   open                       → matches new + contacted (the daily-
 *                                workflow view; mirrors the admin list)
 *   all (or omitted)           → no filter, every row
 *
 * The CSV follows the visible admin list: pick a chip, click Export,
 * download what you see.
 */

import type { APIRoute } from "astro";
import { getAllInquiries } from "@/lib/db";
import { csvFilename, inquiriesToCsv } from "@/lib/csv";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const status = url.searchParams.get("status");
  const all = getAllInquiries();
  let rows = all;

  if (status === "new" || status === "contacted" || status === "closed") {
    rows = all.filter((r) => r.status === status);
  } else if (status === "open") {
    // "open" is a synthetic filter mirroring the admin list — any row
    // that's NOT closed counts as still needing action.
    rows = all.filter((r) => r.status !== "closed");
  }
  // status === "all" or null → no filter, fall through with full set.

  const csv = inquiriesToCsv(rows);
  const filename = csvFilename();
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
};
