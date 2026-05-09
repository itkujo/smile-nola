import { getAllLeads } from "@/lib/db";
import { csvFilename, leadsToHoneybookCsv } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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
