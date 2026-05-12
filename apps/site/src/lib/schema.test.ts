import { describe, expect, it } from "vitest";
import { BuilderSubmissionSchema } from "./schema";

function validBody() {
  return {
    client: {
      firstName: "Jamie",
      lastName: "Lee",
      email: "jamie@example.com",
      phone: "5555550199",
    },
    event: {
      date: "2026-09-12",
      type: "wedding",
      venue: "The Chicory",
      guestCount: 120,
      note: "Outdoor ceremony moves indoors if it rains.",
    },
    consultationPref: "video" as const,
    selections: {
      collections: ["smile"],
      packages: [{ collectionId: "smile", packageId: "mirror-me" }],
      addons: [
        { collectionId: "smile", addonId: "audio-guest-book", qty: 1 },
      ],
    },
  };
}

describe("BuilderSubmissionSchema", () => {
  it("accepts a well-formed cold-path body (no invite token)", () => {
    const r = BuilderSubmissionSchema.safeParse(validBody());
    expect(r.success).toBe(true);
  });

  it("accepts an invited-path body (invite token present)", () => {
    const body = { ...validBody(), invite: "abc123def456" };
    const r = BuilderSubmissionSchema.safeParse(body);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.invite).toBe("abc123def456");
  });

  it("accepts an empty selections set (zero collections)", () => {
    const body = validBody();
    body.selections = { collections: [], packages: [], addons: [] };
    const r = BuilderSubmissionSchema.safeParse(body);
    expect(r.success).toBe(true);
  });

  it("trims whitespace on client and event string fields", () => {
    const body = validBody();
    body.client.firstName = "  Jamie  ";
    body.event.venue = "  The Chicory  ";
    const r = BuilderSubmissionSchema.safeParse(body);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.client.firstName).toBe("Jamie");
      expect(r.data.event.venue).toBe("The Chicory");
    }
  });

  it("rejects a body with an invalid email", () => {
    const body = validBody();
    body.client.email = "not-an-email";
    const r = BuilderSubmissionSchema.safeParse(body);
    expect(r.success).toBe(false);
  });

  it("rejects a body missing required client fields", () => {
    const body = validBody();
    // @ts-expect-error — intentional bad shape
    delete body.client.firstName;
    const r = BuilderSubmissionSchema.safeParse(body);
    expect(r.success).toBe(false);
  });

  it("rejects a body with an unknown consultationPref", () => {
    const body = validBody();
    // @ts-expect-error — intentional bad shape
    body.consultationPref = "carrier-pigeon";
    const r = BuilderSubmissionSchema.safeParse(body);
    expect(r.success).toBe(false);
  });

  it("rejects an addon with qty < 1", () => {
    const body = validBody();
    body.selections.addons = [
      { collectionId: "smile", addonId: "audio-guest-book", qty: 0 },
    ];
    const r = BuilderSubmissionSchema.safeParse(body);
    expect(r.success).toBe(false);
  });

  it("rejects an addon with non-integer qty", () => {
    const body = validBody();
    body.selections.addons = [
      { collectionId: "smile", addonId: "audio-guest-book", qty: 1.5 },
    ];
    const r = BuilderSubmissionSchema.safeParse(body);
    expect(r.success).toBe(false);
  });

  it("rejects a package selection with an empty packageId", () => {
    const body = validBody();
    body.selections.packages = [{ collectionId: "smile", packageId: "" }];
    const r = BuilderSubmissionSchema.safeParse(body);
    expect(r.success).toBe(false);
  });

  it("coerces missing event sub-fields to null/undefined", () => {
    const body = validBody();
    // @ts-expect-error — intentional minimum event payload
    body.event = {};
    const r = BuilderSubmissionSchema.safeParse(body);
    expect(r.success).toBe(true);
  });
});
