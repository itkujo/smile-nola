import { z } from "zod";
import { defineOperation, withResponse } from "@/api/registry/define";
import { boothCsv, boothCsvFilename } from "@/lib/booth/csv";

export const boothExportCsv = defineOperation({
  id: "booth_export_csv",
  summary: "Export booth inquiries as CSV",
  description:
    "Every booth-expo capture that is not deleted, as a HoneyBook-importable CSV (same columns as the inquiries export). " +
    "Answers text/csv with a download filename.",
  tag: "booth",
  method: "GET",
  path: "/booth/export.csv",
  scope: "read:booth",
  text: { contentType: "text/csv; charset=utf-8" },
  input: z.object({}),
  output: z.string(),
  handler() {
    const { csv } = boothCsv();
    return withResponse(csv, {
      headers: { "Content-Disposition": `attachment; filename="${boothCsvFilename()}"` },
    });
  },
});
