/**
 * VSCO Workspace (Táve) API — hand-rolled TypeScript types.
 *
 * These cover only the entities and fields we actually read/write.
 * Source spec: https://workspace.vsco.co/api/v2/openapi.json (OpenAPI 3.0).
 *
 * Conventions:
 * - All IDs are ULIDs (26-char base32 strings); we type them as `Ulid` aliases
 *   for readability without runtime overhead.
 * - All money values are integers in MINOR units (cents). 1850000 = $18,500.00.
 *   The spec's `MoneyAmount` schema is `type: integer, max: 99999999999`.
 *   We brand it loosely as `Cents` for clarity at call sites.
 * - Dates are ISO 8601 strings (YYYY-MM-DD for date-only, full timestamp where
 *   the spec requires datetime).
 * - We deliberately omit every `readOnly` field from the WRITE shapes below.
 *   The READ shapes (suffixed `Response`) include them where we need to read
 *   them back.
 * - Discriminated unions use `kind` as the discriminator, matching the spec's
 *   `discriminator: { propertyName: 'kind' }`.
 */

/** A 26-character base32 ULID. Branded for readability; no runtime check. */
export type Ulid = string;

/** Integer minor units. 1850000 = $18,500.00. */
export type Cents = number;

/** ISO 8601 date-only string (YYYY-MM-DD). */
export type IsoDate = string;

/** ISO 8601 timestamp (with offset or Z). */
export type IsoDateTime = string;

/* ============================================================================
 * Phone & Address — shared value objects
 * ========================================================================= */

/**
 * The API represents phone numbers as an object with `e164` (E.164 string).
 * The spec also has fields for parsed parts, but `e164` alone is sufficient
 * for writes.
 */
export interface Phone {
  /** Full E.164 string, e.g. "+15045551234". */
  e164: string;
}

export interface Address {
  streetAddress?: string | null;
  streetAddress2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

/* ============================================================================
 * External Mappings — our idempotency / dedupe mechanism
 *
 * Every Job, Contact, Event, etc. can carry an array of `externalMappings`
 * where we stamp our own stable IDs. We use the inquiry's `external_uuid`
 * as the mapping ID, and the admin URL as the mapping URL.
 *
 * Used for: GET /job?externalMappingId=<uuid> to look up by our ID.
 * ========================================================================= */

export interface ExternalMapping {
  /** Our stable identifier. We use `external_uuid` from the inquiries table. */
  id: string;
  /** Human-friendly URL. We use the admin detail page URL. */
  url?: string;
}

/* ============================================================================
 * Custom Fields
 * ========================================================================= */

/**
 * The kinds of custom fields supported by the API.
 * Note: spec uses these exact capitalized strings.
 */
export type CustomFieldKind =
  | 'TextField'
  | 'TextBox'
  | 'DropDown'
  | 'Number'
  | 'Decimal'
  | 'Money'
  | 'Date'
  | 'Time'
  | 'Checkbox';

export type CustomFieldAppliesTo = 'Job' | 'Contact';

export type CustomFieldClientAccess = 'None' | 'Visible' | 'Editable';

/** Write shape for POST /custom-field. */
export interface CustomFieldCreate {
  canApplyTo: CustomFieldAppliesTo;
  kind: CustomFieldKind;
  name: string;
  /** Required for kind="DropDown". */
  choices?: string[];
  /** Optional shorter label shown to clients. */
  clientLabel?: string | null;
  clientAccess?: CustomFieldClientAccess;
  /** Merge-token used in email templates etc. */
  token?: string | null;
}

/** Read shape returned from the API. */
export interface CustomField extends CustomFieldCreate {
  id: Ulid;
  created?: IsoDateTime;
  modified?: IsoDateTime;
}

/**
 * The value placed on a Job or Contact.
 *
 * IMPORTANT: per spec, `value` is always serialized as a string — even for
 * Date, Money, Number, Checkbox kinds. The mapping layer is responsible for
 * typed → string serialization:
 *   Checkbox  → "true" | "false"
 *   Date      → "YYYY-MM-DD"
 *   Money     → integer cents as string, e.g. "1850000"
 *   Number    → numeric string
 *   DropDown  → one of the configured choices (exact match)
 *   TextField/TextBox → the string itself
 */
export interface CustomFieldValue {
  fieldId: Ulid;
  value: string | null;
}

/* ============================================================================
 * Contacts — Person / Company / Location (discriminated union by `kind`)
 * ========================================================================= */

/** Common base of every contact kind. */
interface ContactBase {
  /** Set on writes only when updating; omit on POST. */
  id?: Ulid;
  /** Brand association (if the studio has multiple brands). */
  brandId?: Ulid | null;
  customFields?: CustomFieldValue[];
  externalMappings?: ExternalMapping[];
  /** Free-form notes attached to the contact. */
  notes?: string | null;
  /** GDPR — whether they consented to marketing. */
  privacyOptIn?: boolean | null;
  /** GDPR strict-privacy flag. */
  requireStrictPrivacy?: boolean | null;
}

export type ContactPreference = 'Email' | 'Phone' | 'Text' | null;

export interface PersonWrite extends ContactBase {
  kind: 'person';
  firstName?: string | null;
  lastName?: string | null;
  /** Primary email. Note: spec does not mark required, but Workspace features
   *  (client portal, invoice send, email merges) effectively require it.
   *  When we don't have one, the mapping layer fills a fake no-email address. */
  email?: string | null;
  secondaryEmail?: string | null;
  cellPhone?: Phone | null;
  homePhone?: Phone | null;
  workPhone?: Phone | null;
  companyName?: string | null;
  jobTitle?: string | null;
  mailingAddress?: Address | null;
  salutation?: string | null;
  gender?: string | null;
  birthdate?: IsoDate | null;
  anniversary?: IsoDate | null;
  previousClient?: boolean | null;
  bestDayToCall?: string | null;
  bestTimeToCall?: string | null;
  contactPreference?: ContactPreference;
}

export interface CompanyWrite extends ContactBase {
  kind: 'company';
  /** Required by API for companies. */
  name: string;
  phone?: Phone | null;
  tollFree?: Phone | null;
  primaryContactFirstName?: string | null;
  primaryContactLastName?: string | null;
  mailingAddress?: Address | null;
  accountNumber?: string | null;
}

export interface LocationWrite extends ContactBase {
  kind: 'location';
  /** Required by API for locations. We use it for venue name. */
  name: string;
  phone?: Phone | null;
  mailingAddress?: Address | null;
}

export type ContactWrite = PersonWrite | CompanyWrite | LocationWrite;

/** Read variant of a contact — includes server-assigned fields. */
export type ContactRead = ContactWrite & {
  id: Ulid;
  created: IsoDateTime;
  modified: IsoDateTime;
};

/* ============================================================================
 * Job Contacts — the join entity that attaches a Contact to a Job
 *
 * A Person becomes a "client" on a job via JobContact{ client: true }.
 * Job roles let us mark e.g. "Planner", "Family" — used by booth submissions
 * for the POC relationship.
 * ========================================================================= */

export interface JobContactWrite {
  contactId: Ulid;
  jobId?: Ulid;
  /** Marks this contact as a booking client (gets portal access, invoices). */
  client?: boolean;
  /** Optional Job Role IDs (e.g. Planner, Family, POC). */
  jobRoles?: Ulid[];
}

/* ============================================================================
 * Events — sessions/ceremonies/etc. attached to a Job
 * ========================================================================= */

/** Event kinds per spec. */
export type EventKind = 'call' | 'meeting' | 'other' | 'session';

export interface EventWrite {
  id?: Ulid;
  name?: string | null;
  typeId?: Ulid | null;
  startDate?: IsoDate | null;
  /** HH:MM:SS or HH:MM, per spec. */
  startTime?: string | null;
  endDate?: IsoDate | null;
  endTime?: string | null;
  /** Optional location — references an existing Location contact. */
  locationId?: Ulid | null;
  /** Attendees — references existing Contacts via JobContact records. */
  attendees?: Ulid[];
  customFields?: CustomFieldValue[];
  externalMappings?: ExternalMapping[];
  notes?: string | null;
}

/* ============================================================================
 * Job — the project / engagement
 *
 * This write shape includes ONLY writable fields. The spec also returns many
 * readOnly fields (id, created, modified, title, totals, etc.); we model those
 * in `JobRead` below.
 * ========================================================================= */

export type JobStage = 'lead' | 'booked' | 'fulfillment' | 'completed';

export type LeadConfidence = 'low' | 'medium' | 'high' | null;

export interface JobWrite {
  /** When updating, include the ID. Omit on POST. */
  id?: Ulid;
  /** When omitted, server auto-generates a title from job type + names. */
  name?: string | null;
  stage?: JobStage;
  /** References a Job Type — pre-created in the studio. */
  jobTypeId?: Ulid | null;
  brandId?: Ulid | null;
  /** Lead Source — required by us for analytics; optional in spec. */
  leadSourceId?: Ulid | null;
  leadStatusId?: Ulid | null;
  leadConfidence?: LeadConfidence;
  /** Star rating, 1-5. */
  leadRating?: number | null;
  /** Max budget in cents. */
  leadMaxBudget?: Cents | null;
  /** Free-form notes. Up to 1GB per spec. */
  leadNotes?: string | null;
  leadDecisionExpectedByDate?: IsoDate | null;
  /** Date of the event itself. */
  eventDate?: IsoDate | null;
  /** Date the contract was signed. */
  bookingDate?: IsoDate | null;
  fulfillmentDate?: IsoDate | null;
  completedDate?: IsoDate | null;
  inquiryDate?: IsoDate | null;
  guestCount?: number | null;
  /** Flag identifying website-sourced leads (vs. manually-added). */
  webLead?: boolean;
  /** Optional internal contact-form ID. */
  contactFormId?: Ulid | null;
  /** Attach an automated workflow. */
  workflowId?: Ulid | null;
  closed?: boolean;
  closedReasonId?: Ulid | null;
  closedDate?: IsoDate | null;
  customFields?: CustomFieldValue[];
  externalMappings?: ExternalMapping[];
}

/** Read shape — what we get back from GET /job/{id}. */
export interface JobRead extends JobWrite {
  id: Ulid;
  created: IsoDateTime;
  modified: IsoDateTime;
  /** Server-computed title (auto if `name` not set). */
  title: string;
  accountBalance?: Cents;
  creditBalance?: Cents;
  totalCost?: Cents;
  totalProfit?: Cents;
  totalRevenue?: Cents;
  closedReasonName?: string | null;
  jobTypeName?: string | null;
  leadSourceName?: string | null;
  leadStatusName?: string | null;
  leadStatusChangedAt?: IsoDateTime | null;
  lastClientActivity?: IsoDateTime | null;
  nextInteractionDate?: IsoDate | null;
  previousInteractionDate?: IsoDate | null;
  staleDate?: IsoDate | null;
  workflowName?: string | null;
  pinned?: boolean;
  sample?: boolean;
}

/* ============================================================================
 * Job Worksheet — the atomic "create everything at once" endpoint
 *
 * POST /job/-/worksheet creates a Job + its Contacts (with JobContact links)
 * + its Events in a single transaction. Any failure rolls back the entire
 * request. This is the entry point we use for inquiry submissions.
 * ========================================================================= */

/** Entry in `JobWorksheet.contacts[]`. Carries the JobContact flags inline. */
export interface JobWorksheetContact {
  /** Marks this contact as a client (gets portal access). */
  client?: boolean;
  /** Job role IDs (Planner, Family, POC, etc.). */
  jobRoles?: Ulid[];
  /** The contact itself — Person/Company/Location. */
  contact: ContactWrite;
}

/** The full Worksheet body. Extends JobWrite with contacts/events. */
export interface JobWorksheet extends JobWrite {
  /** Will become JobContact records linked to the new Job. */
  contacts?: JobWorksheetContact[];
  /** Will become Event records linked to the new Job. */
  events?: EventWrite[];
}

/**
 * Worksheet response shape.
 *
 * IMPORTANT (verified empirically against live API on 2026-05-13):
 * The actual response is FLAT — the Job's fields are at the top level,
 * with `contacts: []` and `events: [...]` arrays nested directly on it.
 * NOT the spec's nominal { job: {...}, contacts: [], events: [] } shape.
 *
 * So a successful POST to /job/-/worksheet returns something like:
 *   { id: "01...", stage: "lead", name: "...", ..., contacts: [...], events: [...] }
 */
export interface JobWorksheetResponse extends JobRead {
  contacts: ContactRead[];
  events?: EventWrite[];
}

/* ============================================================================
 * Orders — quotes / booking proposals / invoices
 *
 * Order belongs to a Job. POST /job/{jobId}/order creates one.
 * Setting `dueDate` on creation triggers automatic invoice generation.
 * ========================================================================= */

export type OrderStatus = 'draft' | 'open' | 'paid-in-full' | 'completed' | 'voided';

export type OrderItemSelectability = 'required' | 'suggested' | 'optional';

export type DiscountKind = 'amount' | 'percent';

/** Line item — supports nested children for package + add-on hierarchies. */
export interface OrderItemWrite {
  /** Required: 1-128 chars. */
  name: string;
  /** HTML description. Up to 16MB per spec. */
  descriptionHtml?: string | null;
  /** Per-unit price in cents. */
  pricePerUnit?: Cents;
  /** Pre-discount price. */
  basePricePerUnit?: Cents;
  /** Internal cost (for margin tracking). */
  costPerUnit?: Cents;
  baseCostPerUnit?: Cents;
  /** Quantity. */
  units?: number;
  taxable?: boolean;
  /** Marks this line as a discount line (negative price OK). */
  discount?: boolean;
  discountKind?: DiscountKind;
  /** UX hint: required/suggested/optional in a quote builder. */
  selectability?: OrderItemSelectability;
  /** Whether the item is currently in the order. */
  selected?: boolean;
  /** Nested sub-items (e.g. add-ons under a package). */
  children?: OrderItemWrite[];
}

export interface OrderWrite {
  /** Auto-titled if omitted. */
  name?: string | null;
  /** The contact who receives the invoice. */
  recipientId?: Ulid | null;
  /** Tax group — pre-configured in studio. */
  taxGroupId?: Ulid | null;
  paymentTermsId?: Ulid | null;
  /**
   * Setting `dueDate` on order CREATION auto-generates a single invoice for
   * this order with the given due date. This is the only API knob for
   * invoice creation. Spec annotates this field as `writeOnly` and:
   *   "Auto create a single invoice for this order using this due date"
   */
  dueDate?: IsoDate | null;
  lineItems?: OrderItemWrite[];
  customFields?: CustomFieldValue[];
  externalMappings?: ExternalMapping[];
}

/** Order read — includes computed status, totals, etc. */
export interface OrderRead extends OrderWrite {
  id: Ulid;
  jobId: Ulid;
  status: OrderStatus;
  total: Cents;
  subtotal: Cents;
  balance: Cents;
  bookedElectronically?: boolean;
  bookedFromQuote?: boolean;
  bookedOn?: IsoDateTime | null;
  referenceCode?: string;
  created: IsoDateTime;
  modified: IsoDateTime;
}

/* ============================================================================
 * Lookups — Lead Sources, Lead Statuses, Job Types, Event Types, Job Roles
 *
 * These are studio-level configurations. We list them once at boot, cache the
 * ID→key mapping, and reference by ID when writing Jobs/Events.
 * ========================================================================= */

export interface LeadSource {
  id: Ulid;
  name: string;
  parentId?: Ulid | null;
  created?: IsoDateTime;
  modified?: IsoDateTime;
}

export type LeadStatusKind = 'general' | 'new' | 'stale';

export interface LeadStatus {
  id: Ulid;
  name: string;
  kind?: LeadStatusKind;
  color?: string | null;
  sortPosition?: number;
  transitionToId?: Ulid | null;
  transitionInterval?: number | null;
  transitionIntervalUnit?: string | null;
  afterDocumentSentTransitionToId?: Ulid | null;
  afterEmailSentTransitionToId?: Ulid | null;
  afterEventScheduledTransitionToId?: Ulid | null;
  afterFormSentTransitionToId?: Ulid | null;
  afterQuoteSentTransitionToId?: Ulid | null;
  transitionClosedReasonId?: Ulid | null;
  created?: IsoDateTime;
  modified?: IsoDateTime;
}

export interface JobType {
  id: Ulid;
  name: string;
  profitCenterId?: Ulid | null;
  workflowId?: Ulid | null;
  initialLeadStatusId?: Ulid | null;
  primarySessionRequired?: boolean;
  created?: IsoDateTime;
  modified?: IsoDateTime;
}

export interface EventType {
  id: Ulid;
  name: string;
  kind?: EventKind;
  color?: string | null;
  defaultDuration?: number | null;
  defaultLocationId?: Ulid | null;
  tokenPrefix?: string | null;
  created?: IsoDateTime;
  modified?: IsoDateTime;
}

export interface JobRole {
  id: Ulid;
  name: string;
  created?: IsoDateTime;
  modified?: IsoDateTime;
}

/* ============================================================================
 * Collection (list) wrapper
 *
 * The API wraps list responses in a `Collection` envelope. Verified from
 * live API responses (the spec is not entirely literal about the shape).
 * Real shape: { meta: { currentPage, totalPages, totalItems, rows },
 *               type: "<entity>-collection", items: T[] }
 *
 * Some items also carry a `links` object with HATEOAS-style hrefs and a
 * `hidden: boolean` flag (entities can be soft-hidden in Workspace) — both
 * of which we ignore here.
 * ========================================================================= */

export interface CollectionMeta {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  /** Rows returned on this page (≤ pageSize). */
  rows: number;
}

export interface Collection<T> {
  meta: CollectionMeta;
  /** Always present; some endpoints use it (e.g. "jobtype-collection"). */
  type?: string;
  items: T[];
}

/* ============================================================================
 * Error response body (RFC 7807-ish)
 * ========================================================================= */

export interface VscoErrorBody {
  type?: string;
  title?: string;
  detail?: string;
  /** Some endpoints return field-level validation errors. */
  errors?: Array<{ field?: string; message?: string }>;
}
