import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { bootstrapSchema } from "@/lib/db";
import {
  findInquiryIdByEmail,
  getAllSubmissions,
  getSubmission,
  insertSubmission,
  updateSubmissionNotes,
  updateSubmissionStatus,
  type PackageBuilderSubmissionInput,
} from "./submissions";

let db: Database.Database;

function freshDb(): Database.Database {
  const d = new Database(":memory:");
  d.pragma("foreign_keys = ON");
  bootstrapSchema(d);
  return d;
}

function seedInquiry(email: string): number {
  const r = db
    .prepare(
      `INSERT INTO inquiries (source, first_name, last_name, email, phone)
       VALUES ('contact-form', 'Test', 'User', ?, '5555550100')`,
    )
    .run(email);
  return Number(r.lastInsertRowid);
}

function sampleInput(
  overrides: Partial<PackageBuilderSubmissionInput> = {},
): PackageBuilderSubmissionInput {
  return {
    source: "cold-builder",
    first_name: "Jamie",
    last_name: "Lee",
    email: "jamie@example.com",
    phone: "5555550199",
    inquiry_id: null,
    invite_token: null,
    event_date: "2026-09-12",
    event_type: "wedding",
    venue: "The Chicory",
    guest_count: 120,
    consultation_pref: "video",
    client_note: null,
    selections_json: JSON.stringify({ collections: ["smile"], packages: [], addons: [] }),
    fixed_subtotal_cents: 89500,
    custom_quoted_json: null,
    warnings_json: null,
    ...overrides,
  };
}

describe("submissions CRUD", () => {
  beforeEach(() => {
    db = freshDb();
  });

  it("insertSubmission returns id + createdAt and persists every column", () => {
    const r = insertSubmission(db, sampleInput());
    expect(r.id).toBeGreaterThan(0);
    expect(r.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}/);

    const row = getSubmission(db, r.id);
    expect(row).toBeDefined();
    expect(row?.first_name).toBe("Jamie");
    expect(row?.status).toBe("new");
    expect(row?.fixed_subtotal_cents).toBe(89500);
    expect(row?.consultation_pref).toBe("video");
  });

  it("getAllSubmissions returns newest first", () => {
    const a = insertSubmission(db, sampleInput({ first_name: "Alpha" }));
    // SQLite CURRENT_TIMESTAMP is second-precision; force ordering by sleeping is overkill.
    // Instead bump created_at directly to guarantee an ordering gap.
    db.prepare(
      "UPDATE package_builder_submissions SET created_at = '2025-01-01 00:00:00' WHERE id = ?",
    ).run(a.id);
    const b = insertSubmission(db, sampleInput({ first_name: "Beta" }));

    const rows = getAllSubmissions(db);
    expect(rows.map((r) => r.first_name)).toEqual(["Beta", "Alpha"]);
    expect(rows[0].id).toBe(b.id);
  });

  it("updateSubmissionStatus to invoice_sent stamps invoice_sent_at", () => {
    const r = insertSubmission(db, sampleInput());
    const ok = updateSubmissionStatus(db, r.id, "invoice_sent");
    expect(ok).toBe(true);

    const row = getSubmission(db, r.id);
    expect(row?.status).toBe("invoice_sent");
    expect(row?.invoice_sent_at).not.toBeNull();
  });

  it("updateSubmissionStatus reverting to new clears invoice_sent_at", () => {
    const r = insertSubmission(db, sampleInput());
    updateSubmissionStatus(db, r.id, "invoice_sent");
    updateSubmissionStatus(db, r.id, "new");

    const row = getSubmission(db, r.id);
    expect(row?.status).toBe("new");
    expect(row?.invoice_sent_at).toBeNull();
  });

  it("updateSubmissionStatus on a missing id returns false", () => {
    expect(updateSubmissionStatus(db, 999, "invoice_sent")).toBe(false);
  });

  it("updateSubmissionNotes persists the value", () => {
    const r = insertSubmission(db, sampleInput());
    expect(updateSubmissionNotes(db, r.id, "Daniel called — sending invoice tomorrow.")).toBe(
      true,
    );
    const row = getSubmission(db, r.id);
    expect(row?.notes).toBe("Daniel called — sending invoice tomorrow.");
  });

  it("findInquiryIdByEmail returns the most recent matching inquiry id", () => {
    const oldId = seedInquiry("repeat@example.com");
    // Force the older row to have an older timestamp.
    db.prepare("UPDATE inquiries SET created_at = '2024-01-01 00:00:00' WHERE id = ?").run(
      oldId,
    );
    const newId = seedInquiry("repeat@example.com");

    expect(findInquiryIdByEmail(db, "repeat@example.com")).toBe(newId);
  });

  it("findInquiryIdByEmail returns null when no match", () => {
    expect(findInquiryIdByEmail(db, "nobody@example.com")).toBeNull();
  });

  it("persists JSON columns verbatim (round-trip)", () => {
    const selections = { collections: ["smile", "aurora"], packages: [], addons: [] };
    const customQuoted = [{ collectionId: "aurora", addonId: "lasers", startingPriceCents: 75000 }];
    const warnings = [{ code: "aurora-minimum-not-met", message: "..." }];

    const r = insertSubmission(
      db,
      sampleInput({
        selections_json: JSON.stringify(selections),
        custom_quoted_json: JSON.stringify(customQuoted),
        warnings_json: JSON.stringify(warnings),
      }),
    );
    const row = getSubmission(db, r.id);
    expect(JSON.parse(row!.selections_json)).toEqual(selections);
    expect(JSON.parse(row!.custom_quoted_json!)).toEqual(customQuoted);
    expect(JSON.parse(row!.warnings_json!)).toEqual(warnings);
  });
});
