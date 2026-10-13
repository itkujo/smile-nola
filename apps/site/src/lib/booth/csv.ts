import type Database from "better-sqlite3";
import { inquiriesToCsv } from "@/lib/csv";
import { allBoothRows } from "./store";

/** The booth export: same HoneyBook-shaped columns as the site export, booth rows only. */
export function boothCsv(db?: Database.Database): { csv: string; count: number } {
  const rows = allBoothRows(db);
  return { csv: inquiriesToCsv(rows), count: rows.length };
}

export function boothCsvFilename(now: Date = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `smile-nola-booth-${yyyy}-${mm}-${dd}.csv`;
}
