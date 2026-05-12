import { NextResponse } from "next/server";
import { softDeleteLead } from "@/lib/db";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAuthed(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthenticated" },
      { status: 401 },
    );
  }
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
