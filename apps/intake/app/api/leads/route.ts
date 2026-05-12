import { NextResponse } from "next/server";
import { getAllLeads } from "@/lib/db";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthed(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthenticated" },
      { status: 401 },
    );
  }
  const leads = getAllLeads();
  return NextResponse.json({ ok: true, leads, count: leads.length });
}
