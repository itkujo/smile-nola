import { NextResponse } from "next/server";
import { softDeleteLead } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return NextResponse.json(
      { ok: false, error: "Invalid id" },
      { status: 400 },
    );
  }
  const ok = softDeleteLead(numId);
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Lead not found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
