/**
 * Tests for sendBuilderSubmissionNotification.
 *
 * Pins the Zapier contract for the builder-side email — separate from the
 * lead-side tests in email.test.ts because builder notifications also
 * exercise the "linked inquiry" code path and use builderSubject's
 * partner-name lookup from the inquiry row.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Resend } from "resend";
import type { InquiryRow } from "@/lib/db";
import type { PackageBuilderSubmissionRow } from "@/lib/builder/submissions";
import type { ComputeResult } from "@/lib/builder/compute";

const sendMock = vi.fn();

vi.mock("resend", () => ({
  Resend: vi.fn(),
}));
const ResendMock = vi.mocked(Resend);

function buildSubmission(
  overrides: Partial<PackageBuilderSubmissionRow> = {},
): PackageBuilderSubmissionRow {
  return {
    id: 100,
    created_at: "2026-05-11T00:00:00.000Z",
    status: "new",
    invoice_sent_at: null,
    source: "invited-builder",
    first_name: "Thibault",
    last_name: "Kopp",
    email: "client@example.com",
    phone: "504-555-0100",
    inquiry_id: 7,
    invite_token: "test-token",
    event_date: "2026-11-07",
    event_type: "wedding",
    venue: "The Civic Theatre",
    guest_count: 150,
    consultation_pref: "video",
    client_note: null,
    selections_json: "{}",
    fixed_subtotal_cents: 69500,
    custom_quoted_json: null,
    warnings_json: null,
    notes: null,
    ...overrides,
  };
}

function buildLinkedInquiry(
  overrides: Partial<InquiryRow> = {},
): InquiryRow {
  return {
    id: 7,
    created_at: "2026-05-10T00:00:00.000Z",
    source: "booth-expo",
    status: "new",
    first_name: "Thibault",
    last_name: "Kopp",
    email: "client@example.com",
    phone: "504-555-0100",
    preferred_contact: "email",
    event_date: "2026-11-07",
    event_type: "wedding",
    venue: "The Civic Theatre",
    guest_count: 150,
    event_start: null,
    event_end: null,
    planner: null,
    budget_range: null,
    message: "We're so excited to find a Smile booth!",
    referral: "Instagram",
    collections_interested: "Sweets",
    collection_fields_json: null,
    notes: null,
    partner1_name: "Thibault Kopp",
    partner2_name: "Sarah Smith",
    event_setting: "Outdoor — Covered",
    poc_relationship: "One of the couple",
    external_uuid: "abc1ef34-5678-4abc-9def-0123456789ab",
    synced_at: "2026-05-10T00:01:00.000Z",
    source_legacy_id: null,
    deleted_at: null,
    qualified_at: null,
    ...overrides,
  };
}

const computedOk: ComputeResult = {
  ok: true,
  fixedSubtotalCents: 69500,
  selections: {},
  customQuoted: [],
  warnings: [],
} as unknown as ComputeResult;

describe("sendBuilderSubmissionNotification", () => {
  beforeEach(() => {
    sendMock.mockReset();
    ResendMock.mockImplementation(
      () =>
        ({
          emails: { send: sendMock },
        }) as unknown as Resend,
    );
    vi.resetModules();
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
    delete process.env.NOTIFY_EMAIL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to console.log when env is incomplete", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { sendBuilderSubmissionNotification } = await import("@/lib/email");
    await expect(
      sendBuilderSubmissionNotification(buildSubmission(), computedOk),
    ).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  it("subject uses partner names from the LINKED INQUIRY (not from the submission contact fields)", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NOTIFY_EMAIL = "ops@smile-nola.com";
    sendMock.mockResolvedValue({ data: { id: "msg_b1" }, error: null });

    const { sendBuilderSubmissionNotification } = await import("@/lib/email");
    const submission = buildSubmission({
      id: 42,
      first_name: "Wrong",
      last_name: "Name",
    });
    const inquiry = buildLinkedInquiry({
      partner1_name: "Alice",
      partner2_name: "Bob",
    });
    await sendBuilderSubmissionNotification(submission, computedOk, inquiry);

    const arg = sendMock.mock.calls[0]![0];
    expect(arg.subject).toBe(
      "-Builder- #42 \u00b7 Wedding Build \u00b7 Alice & Bob \u00b7 2026-11-07",
    );
    expect(arg.text).toContain("Project ID: 42");
    expect(arg.text).toContain(
      "Project Name: Wedding Build \u00b7 Alice & Bob \u00b7 2026-11-07 #42",
    );
    expect(arg.replyTo).toBe("client@example.com");
  });

  it("cold-flow submission (no linked inquiry) falls back to submission contact name", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NOTIFY_EMAIL = "ops@smile-nola.com";
    sendMock.mockResolvedValue({ data: { id: "msg_b2" }, error: null });

    const { sendBuilderSubmissionNotification } = await import("@/lib/email");
    await sendBuilderSubmissionNotification(
      buildSubmission({
        id: 200,
        inquiry_id: null,
        source: "cold-builder",
        first_name: "Solo",
        last_name: "Builder",
      }),
      computedOk,
      null,
    );

    const arg = sendMock.mock.calls[0]![0];
    expect(arg.subject).toBe(
      "-Builder- #200 \u00b7 Wedding Build \u00b7 Solo Builder \u00b7 2026-11-07",
    );
  });

  it("includes the linked-inquiry context block (partner fields, message, notes) when an inquiry is passed", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NOTIFY_EMAIL = "ops@smile-nola.com";
    sendMock.mockResolvedValue({ data: { id: "msg_b3" }, error: null });

    const { sendBuilderSubmissionNotification } = await import("@/lib/email");
    await sendBuilderSubmissionNotification(
      buildSubmission({ id: 55 }),
      computedOk,
      buildLinkedInquiry({ id: 7 }),
    );

    const arg = sendMock.mock.calls[0]![0];
    expect(arg.text).toContain("--- LINKED INQUIRY (#7) ---");
    expect(arg.text).toContain("Partner 1:          Thibault Kopp");
    expect(arg.text).toContain("Partner 2:          Sarah Smith");
    expect(arg.text).toContain("Event setting:      Outdoor — Covered");
    expect(arg.text).toContain("POC relationship:   One of the couple");
    expect(arg.text).toContain("Inquiry message:");
    expect(arg.text).toContain("We're so excited");
    expect(arg.html).toContain("Linked inquiry #7");
  });

  it("does NOT include the linked-inquiry block on cold-flow submissions", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NOTIFY_EMAIL = "ops@smile-nola.com";
    sendMock.mockResolvedValue({ data: { id: "msg_b4" }, error: null });

    const { sendBuilderSubmissionNotification } = await import("@/lib/email");
    await sendBuilderSubmissionNotification(
      buildSubmission({ inquiry_id: null, source: "cold-builder" }),
      computedOk,
      null,
    );

    const arg = sendMock.mock.calls[0]![0];
    expect(arg.text).not.toContain("--- LINKED INQUIRY");
    expect(arg.html).not.toContain("Linked inquiry");
  });

  it("never throws when Resend rejects", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NOTIFY_EMAIL = "ops@smile-nola.com";
    sendMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { sendBuilderSubmissionNotification } = await import("@/lib/email");
    await expect(
      sendBuilderSubmissionNotification(
        buildSubmission(),
        computedOk,
        buildLinkedInquiry(),
      ),
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });
});
