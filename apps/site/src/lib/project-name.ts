/**
 * Canonical project-name formatter.
 *
 * Used as the human-readable identifier for an inquiry / builder
 * submission across every surface:
 *
 *   1. Email subjects (Zapier filters trigger off these)
 *   2. Admin UI page headers (so the operator sees the same string
 *      they'll later see in HoneyBook)
 *   3. The HoneyBook CSV export's "Project Name" column
 *
 * Subject format:  <Prefix> #<id> · <ProjectType> · <PartnerNames> · <Date>
 * Body format:     Project ID: <id>
 *                  Project Name: <ProjectType> · <PartnerNames> · <Date> #<id>
 *
 * Why id leads:
 *   The id is the only field that is guaranteed unique, non-empty, and
 *   non-spoofable across every source. Booth attendees mistype names,
 *   leave the partner fields blank, and skip the event date. Putting
 *   the id immediately after the routing prefix means Zapier can ALWAYS
 *   identify the record even when every other field is missing or
 *   garbled. The body restates the id on its own line ('Project ID: N')
 *   so Zapier can extract it without regex-parsing the subject \u2014 lets
 *   you thread emails to existing HoneyBook projects by id.
 *
 * Examples:
 *   -Lead- #1 \u00b7 Wedding \u00b7 Thibault Kopp & Sarah Smith \u00b7 2026-11-07
 *   -Builder- #42 \u00b7 Wedding Build \u00b7 Thibault Kopp \u00b7 TBD
 *   -Lead- #847 \u00b7 Event \u00b7 (unknown) \u00b7 TBD   (worst-case fallback)
 *
 * Partner names:
 *   - Prefer partner1_name + ' & ' + partner2_name when both present
 *     (these are populated by booth captures from the kiosk flow).
 *   - Single partner: just partner1_name.
 *   - No partner fields populated (site contact-form path): fall back
 *     to first_name + last_name.
 *   - Everything else: '(unknown)'.
 *
 * Date:
 *   - event_date when present (YYYY-MM-DD verbatim).
 *   - 'TBD' when missing.
 *
 * Project Type:
 *   - Capitalized event_type (Wedding / Corporate / Private / Other).
 *   - 'Event' when event_type is missing.
 *   - For builder submissions append ' Build' so the operator can
 *     visually distinguish the configurator artifact from the
 *     originating lead.
 *
 * Separator:
 *   - U+00B7 MIDDLE DOT (\u00b7). Hyphens collide with hyphenated names
 *     (Mary-Jane) making subjects visually noisy.
 */

interface InquiryShape {
  id: number;
  first_name: string;
  last_name: string;
  event_date: string | null;
  event_type: string | null;
  partner1_name: string | null;
  partner2_name: string | null;
}

interface SubmissionShape {
  id: number;
  first_name: string;
  last_name: string;
  event_date: string | null;
  event_type: string | null;
  inquiry_id: number | null;
}

export const SUBJECT_PREFIX_LEAD = "-Lead-";
export const SUBJECT_PREFIX_BUILDER = "-Builder-";
const SEP = " \u00b7 "; // U+00B7 middle dot, surrounded by spaces

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function partnerString(
  partner1: string | null,
  partner2: string | null,
  firstName: string,
  lastName: string,
): string {
  const p1 = (partner1 ?? "").trim();
  const p2 = (partner2 ?? "").trim();
  if (p1 && p2) return `${p1} & ${p2}`;
  if (p1) return p1;
  const contact = [firstName, lastName].filter(Boolean).join(" ").trim();
  return contact || "(unknown)";
}

function dateString(eventDate: string | null): string {
  const d = (eventDate ?? "").trim();
  return d || "TBD";
}

function projectTypeForInquiry(eventType: string | null): string {
  const t = (eventType ?? "").trim();
  return t ? capitalize(t) : "Event";
}

function projectTypeForBuilder(eventType: string | null): string {
  return `${projectTypeForInquiry(eventType)} Build`;
}

/**
 * Body-facing project name (no routing prefix, no leading id). Used in
 * the email body as the value Zapier should write to HoneyBook's
 * project name field. The id still appears at the end as `#N` so the
 * resulting HoneyBook project name is also self-identifying.
 */
export function inquiryProjectName(inquiry: InquiryShape): string {
  const projectType = projectTypeForInquiry(inquiry.event_type);
  const partners = partnerString(
    inquiry.partner1_name,
    inquiry.partner2_name,
    inquiry.first_name,
    inquiry.last_name,
  );
  return `${projectType}${SEP}${partners}${SEP}${dateString(inquiry.event_date)} #${inquiry.id}`;
}

export function builderProjectName(
  submission: SubmissionShape,
  linkedInquiry: InquiryShape | null,
): string {
  const projectType = projectTypeForBuilder(submission.event_type);
  const partners = linkedInquiry
    ? partnerString(
        linkedInquiry.partner1_name,
        linkedInquiry.partner2_name,
        linkedInquiry.first_name,
        linkedInquiry.last_name,
      )
    : partnerString(null, null, submission.first_name, submission.last_name);
  return `${projectType}${SEP}${partners}${SEP}${dateString(submission.event_date)} #${submission.id}`;
}

/**
 * Email subject for an inquiry notification. ID leads so Zapier can
 * always identify the record even when every other field is missing.
 */
export function inquirySubject(inquiry: InquiryShape): string {
  const projectType = projectTypeForInquiry(inquiry.event_type);
  const partners = partnerString(
    inquiry.partner1_name,
    inquiry.partner2_name,
    inquiry.first_name,
    inquiry.last_name,
  );
  const date = dateString(inquiry.event_date);
  return `${SUBJECT_PREFIX_LEAD} #${inquiry.id}${SEP}${projectType}${SEP}${partners}${SEP}${date}`;
}

export function builderSubject(
  submission: SubmissionShape,
  linkedInquiry: InquiryShape | null,
): string {
  const projectType = projectTypeForBuilder(submission.event_type);
  const partners = linkedInquiry
    ? partnerString(
        linkedInquiry.partner1_name,
        linkedInquiry.partner2_name,
        linkedInquiry.first_name,
        linkedInquiry.last_name,
      )
    : partnerString(null, null, submission.first_name, submission.last_name);
  const date = dateString(submission.event_date);
  return `${SUBJECT_PREFIX_BUILDER} #${submission.id}${SEP}${projectType}${SEP}${partners}${SEP}${date}`;
}

/**
 * Machine-parsable header for the email body. Zapier extracts:
 *   - `Project ID: (\d+)`    canonical record id
 *   - `Project Name: (.+)$`  string to write into HoneyBook project name
 *
 * Both inquiry and builder notifications emit this same shape so a
 * single Zapier "extract field" step works for both.
 */
export function projectAnchorBlock(
  recordId: number,
  projectName: string,
): string {
  return `Project ID: ${recordId}\nProject Name: ${projectName}`;
}
