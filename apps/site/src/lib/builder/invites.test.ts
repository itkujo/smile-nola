import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { bootstrapSchema } from "@/lib/db";
import {
  createOrGetActiveInvite,
  getInvite,
  markInviteConsumed,
} from "./invites";

let db: Database.Database;

function freshDb(): Database.Database {
  const d = new Database(":memory:");
  d.pragma("foreign_keys = ON");
  bootstrapSchema(d);
  return d;
}

function seedInquiry(email = "lead@example.com"): number {
  const r = db
    .prepare(
      `INSERT INTO inquiries (source, first_name, last_name, email, phone)
       VALUES ('contact-form', 'Lead', 'Person', ?, '5555550100')`,
    )
    .run(email);
  return Number(r.lastInsertRowid);
}

describe("invites CRUD", () => {
  beforeEach(() => {
    db = freshDb();
  });

  it("createOrGetActiveInvite creates a fresh row on first call", () => {
    const inquiryId = seedInquiry();
    const inv = createOrGetActiveInvite(db, inquiryId);

    expect(inv.token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url charset
    expect(inv.token.length).toBeGreaterThanOrEqual(32); // 24 bytes -> 32 chars
    expect(inv.inquiry_id).toBe(inquiryId);
    expect(inv.consumed_at).toBeNull();
    expect(inv.created_at).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("createOrGetActiveInvite returns the SAME row on a second call for the same inquiry", () => {
    const inquiryId = seedInquiry();
    const first = createOrGetActiveInvite(db, inquiryId);
    const second = createOrGetActiveInvite(db, inquiryId);
    expect(second.token).toBe(first.token);

    // And there should only be one row in the table.
    const count = db
      .prepare<[number], { n: number }>(
        "SELECT COUNT(*) AS n FROM builder_invites WHERE inquiry_id = ?",
      )
      .get(inquiryId)?.n;
    expect(count).toBe(1);
  });

  it("createOrGetActiveInvite creates a NEW row after the previous is consumed", () => {
    const inquiryId = seedInquiry();
    const first = createOrGetActiveInvite(db, inquiryId);
    markInviteConsumed(db, first.token);

    const second = createOrGetActiveInvite(db, inquiryId);
    expect(second.token).not.toBe(first.token);

    const count = db
      .prepare<[number], { n: number }>(
        "SELECT COUNT(*) AS n FROM builder_invites WHERE inquiry_id = ?",
      )
      .get(inquiryId)?.n;
    expect(count).toBe(2);
  });

  it("getInvite returns the row by token", () => {
    const inquiryId = seedInquiry();
    const created = createOrGetActiveInvite(db, inquiryId);
    const row = getInvite(db, created.token);
    expect(row?.token).toBe(created.token);
    expect(row?.inquiry_id).toBe(inquiryId);
  });

  it("getInvite returns undefined for unknown token", () => {
    expect(getInvite(db, "not-a-real-token")).toBeUndefined();
  });

  it("markInviteConsumed stamps consumed_at and is idempotent", () => {
    const inquiryId = seedInquiry();
    const inv = createOrGetActiveInvite(db, inquiryId);

    expect(markInviteConsumed(db, inv.token)).toBe(true);
    const row1 = getInvite(db, inv.token);
    expect(row1?.consumed_at).not.toBeNull();

    // Second consume on the same token is a no-op (consumed_at unchanged, returns false).
    const consumedAt1 = row1?.consumed_at;
    expect(markInviteConsumed(db, inv.token)).toBe(false);
    const row2 = getInvite(db, inv.token);
    expect(row2?.consumed_at).toBe(consumedAt1);
  });

  it("markInviteConsumed on unknown token returns false", () => {
    expect(markInviteConsumed(db, "bogus")).toBe(false);
  });

  it("two different inquiries get two different tokens", () => {
    const a = createOrGetActiveInvite(db, seedInquiry("a@example.com"));
    const b = createOrGetActiveInvite(db, seedInquiry("b@example.com"));
    expect(a.token).not.toBe(b.token);
  });
});
