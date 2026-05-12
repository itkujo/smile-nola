import { NextResponse } from "next/server";
import { getAllLeads } from "@/lib/db";
import { csvFilename, leadsToHoneybookCsv } from "@/lib/csv";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!isAuthed(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthenticated" },
      { status: 401 },
    );
  }
  const leads = getAllLeads();
  const csv = leadsToHoneybookCsv(leads);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFilename()}"`,
      "Cache-Control": "no-store",
    },
  });
}
