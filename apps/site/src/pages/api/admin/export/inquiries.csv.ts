/**
 * GET /api/admin/export/inquiries.csv
 *
 * Returns the entire inquiries table as a HoneyBook-importable CSV.
 * Protected by the middleware — unauthed callers get 401 / 302.
 *
 * Optional `?status=new|contacted|closed` filter narrows the export.
 */

import type { APIRoute } from "astro";
import { getAllInquiries } from "@/lib/db";
import { csvFilename, inquiriesToCsv } from "@/lib/csv";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const status = url.searchParams.get("status");
  const all = getAllInquiries();
  const rows =
    status === "new" || status === "contacted" || status === "closed"
      ? all.filter((r) => r.status === status)
      : all;

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
