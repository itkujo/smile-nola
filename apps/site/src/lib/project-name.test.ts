/**
 * Pins the project-name format used by:
 *   - Email subjects (Zapier filter triggers off them)
 *   - Email body anchor block (Zapier extract-field step)
 *   - Admin UI headers
 *   - HoneyBook CSV "Project Name" column
 *
 * Changing any of these strings is a contract change that Zapier rules
 * downstream will care about. Keep failing tests visible.
 */

import { describe, expect, it } from "vitest";
import {
  builderProjectName,
  builderSubject,
  inquiryProjectName,
  inquirySubject,
  projectAnchorBlock,
} from "./project-name";

function inquiryFixture(
  overrides: Partial<Parameters<typeof inquiryProjectName>[0]> = {},
) {
  return {
    id: 1,
    first_name: "Thibault",
    last_name: "Kopp",
    event_date: "2026-11-07",
    event_type: "wedding",
    partner1_name: "Thibault Kopp",
    partner2_name: "Sarah Smith",
    ...overrides,
  };
}

function submissionFixture(
  overrides: Partial<Parameters<typeof builderProjectName>[0]> = {},
) {
  return {
    id: 42,
    first_name: "Thibault",
    last_name: "Kopp",
    event_date: "2026-11-07",
    event_type: "wedding",
    inquiry_id: 1,
    ...overrides,
  };
}

const DOT = " \u00b7 "; // mirror lib constant so test failure messages are readable

describe("inquiryProjectName (body form, used in HoneyBook project name)", () => {
  it("formats a booth-origin wedding with both partners + date + id", () => {
    expect(inquiryProjectName(inquiryFixture())).toBe(
      `Wedding${DOT}Thibault Kopp & Sarah Smith${DOT}2026-11-07 #1`,
    );
  });

  it("drops the second partner when only partner1 is set", () => {
    expect(
      inquiryProjectName(inquiryFixture({ partner2_name: null })),
    ).toBe(`Wedding${DOT}Thibault Kopp${DOT}2026-11-07 #1`);
  });

  it("falls back to first_name + last_name when no partner columns set (site contact form)", () => {
    expect(
      inquiryProjectName(
        inquiryFixture({ partner1_name: null, partner2_name: null }),
      ),
    ).toBe(`Wedding${DOT}Thibault Kopp${DOT}2026-11-07 #1`);
  });

  it("uses 'TBD' when event_date is missing", () => {
    expect(inquiryProjectName(inquiryFixture({ event_date: null }))).toBe(
      `Wedding${DOT}Thibault Kopp & Sarah Smith${DOT}TBD #1`,
    );
  });

  it("uses 'Event' when event_type is missing", () => {
    expect(inquiryProjectName(inquiryFixture({ event_type: null }))).toBe(
      `Event${DOT}Thibault Kopp & Sarah Smith${DOT}2026-11-07 #1`,
    );
  });

  it("capitalizes the event_type (booth stores 'wedding' lowercase)", () => {
    expect(
      inquiryProjectName(inquiryFixture({ event_type: "corporate" })),
    ).toBe(`Corporate${DOT}Thibault Kopp & Sarah Smith${DOT}2026-11-07 #1`);
  });

  it("worst case: all human fields missing still produces a row identifiable by id", () => {
    expect(
      inquiryProjectName(
        inquiryFixture({
          id: 847,
          event_type: null,
          event_date: null,
          first_name: "",
          last_name: "",
          partner1_name: null,
          partner2_name: null,
        }),
      ),
    ).toBe(`Event${DOT}(unknown)${DOT}TBD #847`);
  });
});

describe("builderProjectName (body form, used in HoneyBook project name)", () => {
  it("appends ' Build' to the event type", () => {
    const inquiry = inquiryFixture();
    expect(builderProjectName(submissionFixture(), inquiry)).toBe(
      `Wedding Build${DOT}Thibault Kopp & Sarah Smith${DOT}2026-11-07 #42`,
    );
  });

  it("prefers linked-inquiry partner names over submission contact name", () => {
    const inquiry = inquiryFixture({
      first_name: "X",
      last_name: "Y",
      partner1_name: "Alice",
      partner2_name: "Bob",
    });
    expect(builderProjectName(submissionFixture(), inquiry)).toBe(
      `Wedding Build${DOT}Alice & Bob${DOT}2026-11-07 #42`,
    );
  });

  it("falls back to submission contact name when there's no linked inquiry (cold flow)", () => {
    expect(builderProjectName(submissionFixture(), null)).toBe(
      `Wedding Build${DOT}Thibault Kopp${DOT}2026-11-07 #42`,
    );
  });
});

describe("subject helpers (ID leads so Zapier can always identify the record)", () => {
  it("inquirySubject puts id immediately after -Lead-", () => {
    expect(inquirySubject(inquiryFixture())).toBe(
      `-Lead- #1${DOT}Wedding${DOT}Thibault Kopp & Sarah Smith${DOT}2026-11-07`,
    );
  });

  it("builderSubject puts id immediately after -Builder-", () => {
    expect(builderSubject(submissionFixture(), inquiryFixture())).toBe(
      `-Builder- #42${DOT}Wedding Build${DOT}Thibault Kopp & Sarah Smith${DOT}2026-11-07`,
    );
  });

  it("Zapier filter: -Lead- prefix is exactly the first 6 chars", () => {
    expect(inquirySubject(inquiryFixture()).startsWith("-Lead- ")).toBe(true);
  });

  it("Zapier filter: -Builder- prefix is exactly the first 9 chars", () => {
    expect(
      builderSubject(submissionFixture(), inquiryFixture()).startsWith(
        "-Builder- ",
      ),
    ).toBe(true);
  });

  it("Zapier extract: id is parseable from the second token", () => {
    const subject = inquirySubject(inquiryFixture({ id: 12345 }));
    const m = subject.match(/^-Lead- #(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(12345);
  });

  it("worst-case subject still identifies the record by id even when every other field is empty", () => {
    const subject = inquirySubject(
      inquiryFixture({
        id: 999,
        event_type: null,
        event_date: null,
        first_name: "",
        last_name: "",
        partner1_name: null,
        partner2_name: null,
      }),
    );
    expect(subject).toBe(`-Lead- #999${DOT}Event${DOT}(unknown)${DOT}TBD`);
    expect(subject.match(/^-Lead- #(\d+)/)![1]).toBe("999");
  });
});

describe("projectAnchorBlock (machine-parsable body header)", () => {
  it("emits the two-line Zapier-friendly anchor", () => {
    const inquiry = inquiryFixture();
    expect(projectAnchorBlock(inquiry.id, inquiryProjectName(inquiry))).toBe(
      `Project ID: 1\nProject Name: Wedding${DOT}Thibault Kopp & Sarah Smith${DOT}2026-11-07 #1`,
    );
  });

  it("Project ID line is grep-able with /^Project ID: (\\d+)$/m", () => {
    const block = projectAnchorBlock(847, "anything");
    const m = block.match(/^Project ID: (\d+)$/m);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(847);
  });

  it("Project Name line is grep-able with /^Project Name: (.+)$/m", () => {
    const block = projectAnchorBlock(
      1,
      `Wedding${DOT}Thibault Kopp${DOT}2026-11-07 #1`,
    );
    const m = block.match(/^Project Name: (.+)$/m);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(`Wedding${DOT}Thibault Kopp${DOT}2026-11-07 #1`);
  });

  it("works equally for builder records (same anchor shape)", () => {
    const submission = submissionFixture();
    const inquiry = inquiryFixture();
    expect(
      projectAnchorBlock(submission.id, builderProjectName(submission, inquiry)),
    ).toBe(
      `Project ID: 42\nProject Name: Wedding Build${DOT}Thibault Kopp & Sarah Smith${DOT}2026-11-07 #42`,
    );
  });
});
