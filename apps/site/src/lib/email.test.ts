/**
 * Smoke test for the post-Resend-migration email module.
 *
 * Confirms sendInquiryNotification still honors its legacy contract:
 *   - reads NOTIFY_EMAIL + RESEND_API_KEY from env
 *   - falls back to console.log (no throw) when either is missing
 *   - calls Resend with the right from/to/replyTo/subject when configured
 *   - never throws, even when Resend itself errors
 *
 * We mock the SDK at the module level so no network traffic happens.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Resend } from "resend";
import type { InquiryRow } from "@/lib/db";

const sendMock = vi.fn();

// We mock the Resend SDK at module scope so no network ever happens. The
// `Resend` constructor's mockImplementation is re-applied in beforeEach
// because `vi.restoreAllMocks()` in afterEach (used to clean up the console
// spies each test sets up) also strips implementations off vi.fn() mocks.
vi.mock("resend", () => ({
  Resend: vi.fn(),
}));
const ResendMock = vi.mocked(Resend);

function buildInquiry(overrides: Partial<InquiryRow> = {}): InquiryRow {
  return {
    id: 42,
    created_at: "2026-05-11T00:00:00.000Z",
    source: "contact",
    status: "new",
    first_name: "Test",
    last_name: "Person",
    email: "test@example.com",
    phone: "504-555-0100",
    preferred_contact: null,
    event_date: "2026-09-12",
    event_type: "wedding",
    venue: "The Civic Theatre",
    guest_count: 150,
    event_start: null,
    event_end: null,
    planner: null,
    budget_range: null,
    message: "Hello.",
    referral: null,
    collections_interested: null,
    collection_fields_json: null,
    notes: null,
    ...overrides,
  };
}

describe("sendInquiryNotification (post-Resend migration)", () => {
  beforeEach(async () => {
    sendMock.mockReset();
    // Re-apply implementation every test — restoreAllMocks() in afterEach
    // strips it, and the lazy _client cache inside email.ts means the
    // implementation must be present the FIRST time `new Resend(...)` runs
    // after a module reset.
    ResendMock.mockImplementation(
      () =>
        ({
          emails: { send: sendMock },
        }) as unknown as Resend,
    );
    // Drop the email module's cached _client so each test starts fresh.
    vi.resetModules();
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
    delete process.env.NOTIFY_EMAIL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to console.log when NOTIFY_EMAIL is missing (no throw, no SDK call)", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { sendInquiryNotification } = await import("@/lib/email");

    await expect(sendInquiryNotification(buildInquiry())).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  it("falls back to console.log when RESEND_API_KEY is missing", async () => {
    process.env.NOTIFY_EMAIL = "ops@smile-nola.com";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { sendInquiryNotification } = await import("@/lib/email");

    await expect(sendInquiryNotification(buildInquiry())).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  it("calls Resend with the right envelope when both env vars are set", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NOTIFY_EMAIL = "ops@smile-nola.com";
    process.env.RESEND_FROM = "Smile NOLA <no-reply@mail.smile-nola.com>";
    sendMock.mockResolvedValue({ data: { id: "msg_123" }, error: null });

    const { sendInquiryNotification } = await import("@/lib/email");
    await sendInquiryNotification(buildInquiry());

    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0]![0];
    expect(arg.from).toBe("Smile NOLA <no-reply@mail.smile-nola.com>");
    expect(arg.to).toBe("ops@smile-nola.com");
    expect(arg.replyTo).toBe("test@example.com");
    expect(arg.subject).toContain("Test Person");
    expect(arg.subject).toContain("contact");
    expect(arg.text).toContain("Test Person");
    expect(arg.html).toContain("Test Person");
  });

  it("uses the onboarding@resend.dev default when RESEND_FROM is unset", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NOTIFY_EMAIL = "ops@smile-nola.com";
    sendMock.mockResolvedValue({ data: { id: "msg_123" }, error: null });

    const { sendInquiryNotification } = await import("@/lib/email");
    await sendInquiryNotification(buildInquiry());

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0]![0].from).toBe("Smile NOLA <onboarding@resend.dev>");
  });

  it("never throws when Resend rejects the send", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NOTIFY_EMAIL = "ops@smile-nola.com";
    sendMock.mockResolvedValue({ data: null, error: { message: "domain not verified" } });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { sendInquiryNotification } = await import("@/lib/email");
    await expect(sendInquiryNotification(buildInquiry())).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });

  it("never throws when the SDK itself throws", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NOTIFY_EMAIL = "ops@smile-nola.com";
    sendMock.mockRejectedValue(new Error("network down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { sendInquiryNotification } = await import("@/lib/email");
    await expect(sendInquiryNotification(buildInquiry())).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });
});
