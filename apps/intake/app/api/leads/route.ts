import { NextResponse } from "next/server";
import { getAllLeads } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const leads = getAllLeads();
  return NextResponse.json({ ok: true, leads, count: leads.length });
}
