import { z } from "zod";
import { defineOperation } from "@/api/registry/define";
import { ApiError, notFound } from "@/api/registry/errors";
import { PagingInput, pageOf, paginate } from "@/api/registry/paging";
import { rateLimit } from "@/lib/auth";
import { LeadSchema } from "@/lib/booth/schema";
import { insertBoothLead, listBoothInquiries, softDeleteBoothInquiry } from "@/lib/booth/store";
import { ensureSyncLoop } from "@/lib/booth/sync";

// Booth mode starts its drain loop the first time the API router loads
// (Astro has no server-start hook). A no-op in prod mode.
ensureSyncLoop();

/** Submissions per address per minute, on top of the router's general limit. */
export const BOOTH_SUBMIT_MAX_PER_MINUTE = 30;

export const BoothInquirySchema = z.object({
  id: z.number().int(),
  externalUuid: z.string().nullable(),
  createdAt: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  phone: z.string(),
  relationship: z.string().nullable(),
  preferredContact: z.string().nullable(),
  partner1Name: z.string().nullable(),
  partner2Name: z.string().nullable(),
  eventDate: z.string().nullable(),
  venue: z.string().nullable(),
  venueStreetAddress: z.string().nullable(),
  venueCity: z.string().nullable(),
  venueState: z.string().nullable(),
  venuePostalCode: z.string().nullable(),
  venueCountry: z.string().nullable(),
  venueLatitude: z.number().nullable(),
  venueLongitude: z.number().nullable(),
  setting: z.string().nullable(),
  collections: z.array(z.string()),
  notes: z.string().nullable(),
  syncedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
});

export const boothInquiriesSubmit = defineOperation({
  id: "booth_inquiries_submit",
  summary: "Submit a booth inquiry",
  description:
    "What the /booth kiosk calls when a visitor finishes the form. Public, rate limited per address. " +
    "The row is stored with source 'booth-expo' and a random external_uuid.",
  tag: "booth",
  method: "POST",
  path: "/booth/inquiries",
  scope: null,
  successStatus: 201,
  input: LeadSchema,
  output: z.object({
    id: z.number().int(),
    externalUuid: z.string(),
    createdAt: z.string(),
  }),
  handler({ input, clientAddress }) {
    const limit = rateLimit("booth-submit", clientAddress, { windowMs: 60_000, max: BOOTH_SUBMIT_MAX_PER_MINUTE });
    if (!limit.allowed) {
      throw new ApiError("rate_limited", `Too many submissions. Wait ${limit.retryAfter} seconds.`, {
        "Retry-After": String(limit.retryAfter),
      });
    }
    return insertBoothLead(input);
  },
});

export const boothInquiriesList = defineOperation({
  id: "booth_inquiries_list",
  summary: "Booth inquiries",
  description: "Booth-expo captures that are not deleted, newest first.",
  tag: "booth",
  method: "GET",
  path: "/booth/inquiries",
  scope: "read:booth",
  input: PagingInput,
  output: pageOf(BoothInquirySchema),
  handler({ input }) {
    return paginate(input, {
      cursor: z.number().int().positive(),
      fetch: (beforeId, take) => listBoothInquiries({ take, beforeId }),
      cursorOf: (r) => r.id,
    });
  },
});

export const boothInquiriesDelete = defineOperation({
  id: "booth_inquiries_delete",
  summary: "Delete a booth inquiry",
  description:
    "Soft delete: the row stays in the database with deleted_at set, and is no longer listed, exported or synced.",
  tag: "booth",
  method: "DELETE",
  path: "/booth/inquiries/{id}",
  scope: "write:booth",
  input: z.object({ id: z.coerce.number().int("must be a whole number").positive("must be positive") }),
  output: BoothInquirySchema,
  handler({ input }) {
    const row = softDeleteBoothInquiry(input.id);
    if (!row) throw notFound(`No booth inquiry with id ${input.id}.`);
    return row;
  },
});
