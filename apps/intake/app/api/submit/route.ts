import { NextResponse } from "next/server";
import { LeadSchema } from "@/lib/schema";
import { insertLead } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const parsed = LeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "Validation failed",
        issues: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  try {
    const result = insertLead(parsed.data);
    return NextResponse.json(
      { ok: true, id: result.id, capturedAt: result.capturedAt },
      { status: 200 },
    );
  } catch (err) {
    console.error("[submit] insert failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not save your inquiry. Please try again." },
      { status: 500 },
    );
  }
}
