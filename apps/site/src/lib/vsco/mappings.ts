/**
 * Pure mapping functions: our database rows → VSCO Workspace API bodies.
 *
 * These functions never call the network and never touch the database.
 * They take a row + the resolved studio config and return a ready-to-POST
 * (or PUT) payload. This keeps the orchestration layer (push.ts) thin and
 * the mapping logic easy to unit-test.
 */

import type { InquiryRow } from '@/lib/db'
import type { PackageBuilderSubmissionRow } from '@/lib/builder/submissions'
import { getAddon, getCollection, getPackage } from '@/lib/builder/catalog'
import type {
  CustomFieldValue,
  ExternalMapping,
  JobWorksheet,
  JobWorksheetContact,
  JobWrite,
  OrderItemWrite,
  OrderWrite,
  PersonWrite,
} from './types.ts'
import type {
  CustomFieldKey,
  JobTypeKey,
  LeadSourceKey,
  VscoConfig,
} from './config.ts'

export interface MappingContext {
  config: VscoConfig
  /** Public site origin, e.g. "https://smilenola.com". Used for admin URLs. */
  siteBase: string
}

// ──────────────────────────────────────────────────────────────────────
// Small helpers
// ──────────────────────────────────────────────────────────────────────

const NO_EMAIL_DOMAIN = 'noemail.smilenola.com'

export function noEmailPlaceholder(
  externalUuid: string | null | undefined,
  inquiryId?: number,
  suffix?: string,
): string {
  const seed = externalUuid && externalUuid.length > 0
    ? externalUuid
    : inquiryId != null
      ? `inq-${inquiryId}`
      : `unknown-${Date.now()}`
  const tag = suffix ? `${seed}-${suffix}` : seed
  return `no-email+${tag}@${NO_EMAIL_DOMAIN}`
}

function splitName(full: string | null | undefined): { firstName: string; lastName: string } {
  const t = (full || '').trim()
  if (!t) return { firstName: '', lastName: '' }
  const idx = t.indexOf(' ')
  if (idx === -1) return { firstName: t, lastName: '' }
  return { firstName: t.slice(0, idx), lastName: t.slice(idx + 1).trim() }
}

function isSamePerson(
  a: { firstName: string; lastName: string },
  b: { firstName: string; lastName: string },
): boolean {
  const norm = (s: string) => s.trim().toLowerCase()
  return norm(a.firstName) === norm(b.firstName) && norm(a.lastName) === norm(b.lastName)
}

function isoDateOnly(d: string | Date): string {
  if (typeof d === 'string') {
    // If already YYYY-MM-DD-ish, keep first 10 chars
    return d.slice(0, 10)
  }
  return d.toISOString().slice(0, 10)
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// ──────────────────────────────────────────────────────────────────────
// Budget range parser
// ──────────────────────────────────────────────────────────────────────

/**
 * Parses a free-form budget range string into cents (upper bound).
 *
 * Accepts the strings produced by our deep-form select:
 *   "Under $1,000", "$1,000 — $5,000", "$5,000 — $15,000",
 *   "$15,000 — $25,000", "$25,000+", plus loose variants ("$1k - $5k").
 *
 * Returns null for unrecognized or empty input.
 */
export function parseBudgetRangeToCents(input: string | null | undefined): number | null {
  if (!input) return null
  const lowered = input.toLowerCase().replace(/,/g, '').trim()
  if (!lowered) return null

  // Extract every numeric run that looks like a dollar amount
  // (with optional 'k' suffix for thousands).
  const matches = Array.from(
    lowered.matchAll(/\$?(\d+(?:\.\d+)?)(k)?/g),
  )
  if (matches.length === 0) return null

  const valuesCents = matches.map((m) => {
    const num = Number.parseFloat(m[1]!)
    const isThousands = m[2] === 'k'
    const dollars = isThousands ? num * 1000 : num
    return Math.round(dollars * 100)
  })

  // For "Under $X" or "$X+" return that single value.
  // For "$X — $Y" return the upper bound (Y).
  return Math.max(...valuesCents)
}

/**
 * VSCO's `leadMaxBudget` field stores DOLLARS, not cents — they multiply
 * by 100 internally. This is inconsistent with Order/OrderItem which use
 * cents, but it's what the live API does (verified 2026-05-13 with a
 * probe job: sent 100, read back 10000). Use this helper to convert our
 * cents value to whatever the leadMaxBudget endpoint wants.
 */
export function budgetCentsToDollars(cents: number | null): number | null {
  if (cents === null) return null
  return Math.round(cents / 100)
}

// ──────────────────────────────────────────────────────────────────────
// Source → leadSourceKey mapping
// ──────────────────────────────────────────────────────────────────────

const SOURCE_TO_LEADSOURCE: Record<string, LeadSourceKey> = {
  contact: 'website-contact',
  'collection-smile': 'website-collection-smile',
  'collection-visionary': 'website-collection-visionary',
  'collection-digital-atelier': 'website-collection-digital-atelier',
  'collection-aurora': 'website-collection-aurora',
  'collection-resonance': 'website-collection-resonance',
  'booth-expo': 'booth-expo',
}

export function leadSourceKeyForInquiry(source: string | null | undefined): LeadSourceKey {
  if (!source) return 'other'
  return SOURCE_TO_LEADSOURCE[source] ?? 'other'
}

// ──────────────────────────────────────────────────────────────────────
// Collection interest → Job Type (Model B)
//
// Routing rules (highest priority wins):
//   1. interested in 'visionary' → 'videography' (and the videography workflow)
//   2. else interested in 'smile' → 'photo-booth' (and the photo-booth workflow)
//   3. else                       → 'production' (Aurora-only / Digital-
//                                   Atelier-only / Resonance-only / fallback)
//
// Videography is the priority service: any inquiry mentioning visionary
// gets routed through Videography even if they also picked smile/aurora.
// The interested-* custom field checkboxes still capture every collection,
// so nothing is lost.
// ──────────────────────────────────────────────────────────────────────

export function jobTypeKeyForCollections(
  collectionsInterested: string[] | null | undefined,
): JobTypeKey {
  const set = new Set(collectionsInterested ?? [])
  if (set.has('visionary')) return 'videography'
  if (set.has('smile')) return 'photo-booth'
  return 'production'
}

// ──────────────────────────────────────────────────────────────────────
// Event type → Event Occasion DropDown value
//
// Maps free-form inquiry.event_type strings to one of the DropDown
// choices in the 'event-occasion' custom field. Unknown values fall
// back to 'Other Event'.
// ──────────────────────────────────────────────────────────────────────

const EVENT_OCCASION_CHOICES: Array<[RegExp, string]> = [
  [/wedding/i, 'Wedding'],
  [/reception/i, 'Reception'],
  [/engagement|rehearsal/i, 'Engagement / Rehearsal'],
  [/corporate/i, 'Corporate Event'],
  [/gala/i, 'Gala'],
  [/milestone/i, 'Milestone Celebration'],
  [/anniversary/i, 'Anniversary'],
  [/birthday/i, 'Birthday'],
  [/bar.?bat|mitzvah/i, 'Bar / Bat Mitzvah'],
  [/charity/i, 'Charity Event'],
  [/graduation/i, 'Graduation'],
  [/holiday/i, 'Holiday Party'],
]

export function eventOccasionForType(eventType: string | null | undefined): string {
  if (!eventType) return 'Other Event'
  for (const [re, label] of EVENT_OCCASION_CHOICES) {
    if (re.test(eventType)) return label
  }
  return 'Other Event'
}

// ──────────────────────────────────────────────────────────────────────
// Reserved package slug → display string
// ──────────────────────────────────────────────────────────────────────

const RESERVED_PACKAGE_DISPLAY: Record<string, string> = {
  memory: 'Memory Booth',
  'memory-booth': 'Memory Booth',
  mirror: 'Mirror Me Experience',
  'mirror-me': 'Mirror Me Experience',
  'mirror-all-night': 'Mirror Me All Night',
  'mirror-me-all-night': 'Mirror Me All Night',
}

export function reservedPackageDisplay(slug: string | null | undefined): string | null {
  if (!slug) return null
  return RESERVED_PACKAGE_DISPLAY[slug.toLowerCase()] ?? null
}

// ──────────────────────────────────────────────────────────────────────
// Consultation preference display
// ──────────────────────────────────────────────────────────────────────

const CONSULT_PREF_DISPLAY: Record<string, string> = {
  video: 'Video',
  in_person: 'In-Person',
  none: 'None',
}

// ──────────────────────────────────────────────────────────────────────
// Lead notes composition
// ──────────────────────────────────────────────────────────────────────

const COLLECTION_LABELS: Record<string, string> = {
  smile: 'Smile',
  visionary: 'Visionary',
  'digital-atelier': 'Digital Atelier',
  aurora: 'Aurora',
  resonance: 'Resonance',
}

function formatKeyAsLabel(key: string): string {
  // turn snake/kebab/camel into readable
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
}

function composeLeadNotes(inquiry: InquiryRow): string {
  const parts: string[] = []

  if (inquiry.message) parts.push(inquiry.message.trim())

  if (inquiry.referral) parts.push(`Referral: ${inquiry.referral}`)
  if (inquiry.planner) parts.push(`Planner: ${inquiry.planner}`)
  if (inquiry.poc_relationship) parts.push(`POC relationship: ${inquiry.poc_relationship}`)
  if (inquiry.preferred_contact) parts.push(`Preferred contact: ${inquiry.preferred_contact}`)
  if (inquiry.event_start || inquiry.event_end) {
    const t = [inquiry.event_start, inquiry.event_end].filter(Boolean).join(' – ')
    parts.push(`Event time: ${t}`)
  }

  // Parse collection_fields_json for per-collection Q&A
  const fields = parseJsonObject(inquiry.collection_fields_json)
  if (fields) {
    for (const [collectionId, raw] of Object.entries(fields)) {
      if (!raw || typeof raw !== 'object') continue
      const collectionLabel = COLLECTION_LABELS[collectionId] || formatKeyAsLabel(collectionId)
      const inner = raw as Record<string, unknown>
      const lines: string[] = []
      for (const [k, v] of Object.entries(inner)) {
        if (k === 'selected_package') continue // captured separately as custom field
        if (v === null || v === undefined || v === '') continue
        const display = Array.isArray(v) ? v.join(', ') : String(v)
        lines.push(`  ${formatKeyAsLabel(k)}: ${display}`)
      }
      if (lines.length > 0) {
        parts.push(`${collectionLabel}:\n${lines.join('\n')}`)
      }
    }
  }

  return parts.join('\n\n')
}

function parseJsonObject(s: string | null | undefined): Record<string, unknown> | null {
  if (!s) return null
  try {
    const parsed = JSON.parse(s) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    /* swallow — we just won't include the deep notes */
  }
  return null
}

function parseJsonArray(s: string | null | undefined): unknown[] | null {
  if (!s) return null
  try {
    const parsed = JSON.parse(s) as unknown
    if (Array.isArray(parsed)) return parsed
  } catch {
    /* swallow */
  }
  return null
}

// ──────────────────────────────────────────────────────────────────────
// Custom-field builders
// ──────────────────────────────────────────────────────────────────────

function cfv(cfg: VscoConfig, key: CustomFieldKey, value: string | null): CustomFieldValue {
  return { fieldId: cfg.customFields[key], value }
}

function buildInterestedCheckboxes(
  cfg: VscoConfig,
  interested: string[],
): CustomFieldValue[] {
  const set = new Set(interested)
  return [
    cfv(cfg, 'interested-smile', set.has('smile') ? 'true' : 'false'),
    cfv(cfg, 'interested-visionary', set.has('visionary') ? 'true' : 'false'),
    cfv(cfg, 'interested-digital-atelier', set.has('digital-atelier') ? 'true' : 'false'),
    cfv(cfg, 'interested-aurora', set.has('aurora') ? 'true' : 'false'),
    cfv(cfg, 'interested-resonance', set.has('resonance') ? 'true' : 'false'),
  ]
}

// ──────────────────────────────────────────────────────────────────────
// inquiryToJobWorksheet
// ──────────────────────────────────────────────────────────────────────

const POC_RELATIONSHIP_TO_ROLE: Record<string, 'planner' | 'organizer-client' | null> = {
  planner: 'planner',
  Planner: 'planner',
  'one of the couple': 'organizer-client',
  'One of the couple': 'organizer-client',
  // anything else → null (POC just gets primary-contact)
}

/**
 * Return type with non-optional fields we always set, simplifying caller
 * code (and tests) by avoiding unnecessary nullability checks.
 */
export type ConcreteJobWorksheet = JobWorksheet & {
  contacts: JobWorksheetContact[]
  customFields: CustomFieldValue[]
  events: NonNullable<JobWorksheet['events']>
}

export function inquiryToJobWorksheet(
  inquiry: InquiryRow,
  ctx: MappingContext,
): ConcreteJobWorksheet {
  const { config, siteBase } = ctx

  // ---- Basic Job fields ----
  const leadSourceKey = leadSourceKeyForInquiry(inquiry.source)
  const externalMappings: ExternalMapping[] = []
  if (inquiry.external_uuid) {
    externalMappings.push({
      id: inquiry.external_uuid,
      url: `${siteBase}/admin/inquiries/${inquiry.id}`,
    })
  }

  // Parse collections_interested early — needed for both custom fields
  // AND the Job Type routing decision.
  const interested = (parseJsonArray(inquiry.collections_interested) ?? []).filter(
    (x): x is string => typeof x === 'string',
  )

  // Model B routing: collections drive the Job Type + Workflow.
  // 'visionary' wins over 'smile' wins over anything else.
  const jobTypeKey = jobTypeKeyForCollections(interested)

  // ---- Custom fields ----
  const fields = parseJsonObject(inquiry.collection_fields_json)
  const smileFields = fields?.smile as Record<string, unknown> | undefined
  const reservedSlug =
    typeof smileFields?.selected_package === 'string' ? smileFields.selected_package : null
  const reservedDisplay = reservedPackageDisplay(reservedSlug)

  const customFields: CustomFieldValue[] = [
    ...buildInterestedCheckboxes(config, interested),
    // Event occasion captures the KIND of event (Wedding, Corporate, etc.)
    // since Job Type now carries the service line. Always set so the
    // custom field has a value (DropDown choices include 'Other Event').
    cfv(config, 'event-occasion', eventOccasionForType(inquiry.event_type)),
  ]
  if (reservedDisplay) {
    customFields.push(cfv(config, 'reserved-package', reservedDisplay))
  }
  if (inquiry.event_setting) {
    customFields.push(cfv(config, 'event-setting', inquiry.event_setting))
  }

  // ---- Contacts ----
  const contacts: JobWorksheetContact[] = []

  // 1. The POC / inquirer — always client:true
  const pocEmail = inquiry.email && inquiry.email.length > 0
    ? inquiry.email
    : noEmailPlaceholder(inquiry.external_uuid, inquiry.id)

  const pocRoles: string[] = [config.jobRoles['primary-contact']]

  // Map POC relationship → extra role
  if (inquiry.poc_relationship) {
    const lc = inquiry.poc_relationship.toLowerCase().trim()
    if (lc.includes('planner')) {
      pocRoles.push(config.jobRoles.planner)
    } else if (lc.includes('one of the couple') || lc.includes('couple')) {
      pocRoles.push(config.jobRoles['organizer-client'])
    } else if (lc.includes('family')) {
      pocRoles.push(config.jobRoles['parent-a'])
    }
  }

  const pocPerson: PersonWrite = {
    kind: 'person',
    firstName: inquiry.first_name || null,
    lastName: inquiry.last_name || null,
    email: pocEmail,
    cellPhone: inquiry.phone ? { e164: inquiry.phone } : null,
    contactPreference: normalizeContactPreference(inquiry.preferred_contact),
    externalMappings: inquiry.external_uuid
      ? [
          {
            id: `${inquiry.external_uuid}-poc`,
            url: `${siteBase}/admin/inquiries/${inquiry.id}`,
          },
        ]
      : undefined,
  }

  const pocNames = { firstName: pocPerson.firstName || '', lastName: pocPerson.lastName || '' }

  // 2. Partner A / Partner B if present (booth flow). May dedupe with POC.
  const partner1 = inquiry.partner1_name ? splitName(inquiry.partner1_name) : null
  const partner2 = inquiry.partner2_name ? splitName(inquiry.partner2_name) : null

  let pocCoversPartnerA = false
  let pocCoversPartnerB = false
  if (partner1 && isSamePerson(partner1, pocNames)) {
    pocRoles.push(config.jobRoles['partner-a'])
    pocCoversPartnerA = true
  }
  if (partner2 && isSamePerson(partner2, pocNames)) {
    pocRoles.push(config.jobRoles['partner-b'])
    pocCoversPartnerB = true
  }

  contacts.push({
    client: true,
    jobRoles: pocRoles,
    contact: pocPerson,
  })

  if (partner1 && !pocCoversPartnerA && partner1.firstName) {
    contacts.push({
      client: true,
      jobRoles: [config.jobRoles['partner-a']],
      contact: {
        kind: 'person',
        firstName: partner1.firstName,
        lastName: partner1.lastName || null,
        email: noEmailPlaceholder(inquiry.external_uuid, inquiry.id, 'partner-a'),
      } satisfies PersonWrite,
    })
  }
  if (partner2 && !pocCoversPartnerB && partner2.firstName) {
    contacts.push({
      client: true,
      jobRoles: [config.jobRoles['partner-b']],
      contact: {
        kind: 'person',
        firstName: partner2.firstName,
        lastName: partner2.lastName || null,
        email: noEmailPlaceholder(inquiry.external_uuid, inquiry.id, 'partner-b'),
      } satisfies PersonWrite,
    })
  }

  // 3. Venue (Location contact) if known
  if (inquiry.venue && inquiry.venue.trim()) {
    // If the user picked the venue from Google Places autocomplete we
    // have at least one address field set. In that case, attach a
    // mailingAddress block so VSCO's Schedule section can pin the
    // location on its map. For free-text-only venues, we still create
    // the Location contact but omit mailingAddress entirely.
    const hasAddress = Boolean(
      inquiry.venue_street_address ||
        inquiry.venue_city ||
        inquiry.venue_state ||
        inquiry.venue_postal_code ||
        inquiry.venue_country,
    )
    contacts.push({
      jobRoles: [config.jobRoles.venue],
      contact: {
        kind: 'location',
        name: inquiry.venue.trim(),
        ...(hasAddress && {
          mailingAddress: {
            streetAddress: inquiry.venue_street_address || null,
            city: inquiry.venue_city || null,
            state: inquiry.venue_state || null,
            postalCode: inquiry.venue_postal_code || null,
            country: inquiry.venue_country || null,
          },
        }),
      },
    })
  }

  // ---- Events ----
  const events: JobWorksheet['events'] = []
  if (inquiry.event_date) {
    events.push({
      name: 'Main Event',
      typeId: config.eventTypes['main-event'],
      startDate: inquiry.event_date,
      startTime: inquiry.event_start || null,
      endTime: inquiry.event_end || null,
    })
  }

  const ws: ConcreteJobWorksheet = {
    stage: 'lead',
    webLead: true,
    jobTypeId: config.jobTypes[jobTypeKey],
    // Set workflowId explicitly. JobType.workflowId default would also
    // apply this, but being explicit is defensive: if the Job Type's
    // default ever drifts in the UI, our code still attaches the
    // correct workflow.
    workflowId: config.workflows[jobTypeKey],
    leadSourceId: config.leadSources[leadSourceKey],
    leadStatusId: config.leadStatuses.new,
    brandId: config.studioBrandId,
    eventDate: inquiry.event_date || null,
    guestCount: inquiry.guest_count ?? null,
    inquiryDate: isoDateOnly(inquiry.created_at),
    // leadMaxBudget is in DOLLARS, not cents — verified live on 2026-05-13.
    // VSCO multiplies by 100 internally to store as cents. The spec
    // marks all money fields as `integer` with the same min/max range, but
    // the leadMaxBudget interpretation differs from Order/OrderItem totals
    // (those ARE in cents). One of those VSCO quirks our parser handles
    // by dividing our cents value by 100 before sending.
    leadMaxBudget: budgetCentsToDollars(parseBudgetRangeToCents(inquiry.budget_range)),
    leadNotes: composeLeadNotes(inquiry),
    customFields,
    externalMappings,
    contacts,
    events,
  }

  return ws
}

function normalizeContactPreference(p: string | null | undefined): 'Email' | 'Phone' | 'Text' | null {
  if (!p) return null
  const lc = p.toLowerCase()
  if (lc.startsWith('email')) return 'Email'
  if (lc.startsWith('phone')) return 'Phone'
  if (lc.startsWith('text') || lc.startsWith('sms')) return 'Text'
  return null
}

// ──────────────────────────────────────────────────────────────────────
// builderToJobUpdate
// ──────────────────────────────────────────────────────────────────────

/**
 * Returns a partial Job patch reflecting the new data from a builder
 * submission. Caller is expected to merge this with the result of a
 * GET /job/{id} (read-modify-write) before PUTting.
 */
export function builderToJobUpdate(
  sub: PackageBuilderSubmissionRow,
  ctx: MappingContext,
): Partial<JobWrite> {
  const { config, siteBase } = ctx

  const customFields: CustomFieldValue[] = [
    cfv(
      config,
      'builder-submission-link',
      `${siteBase}/admin/builder-submissions/${sub.id}`,
    ),
  ]

  if (sub.consultation_pref) {
    customFields.push(
      cfv(config, 'consultation-preference', CONSULT_PREF_DISPLAY[sub.consultation_pref] || sub.consultation_pref),
    )
  }

  // Refresh event-occasion from the builder's event.type, in case the
  // client updated it in the builder (the builder form lets them pick
  // 'Wedding', 'Corporate', etc. independently of what the original
  // inquiry said).
  if (sub.event_type) {
    customFields.push(cfv(config, 'event-occasion', eventOccasionForType(sub.event_type)))
  }

  const patch: Partial<JobWrite> = {
    eventDate: sub.event_date || null,
    guestCount: sub.guest_count ?? null,
    leadStatusId: config.leadStatuses['sent-quote'],
    customFields,
  }

  // NOTE: we intentionally DO NOT change Job.jobTypeId or Job.workflowId
  // in the builder push. The service line (Photo Booth / Videography /
  // Production) was determined at qualify time from collections_interested
  // and shouldn't shift mid-pipeline. The builder may add/drop a
  // collection in selections, but the workflow that's been running
  // since qualify stays put.

  return patch
}

// ──────────────────────────────────────────────────────────────────────
// builderToOrder
// ──────────────────────────────────────────────────────────────────────

export interface BuilderToOrderContext extends MappingContext {
  recipientId: string
}

interface ParsedSelection {
  collectionId: string
  packageIds: string[]
  addons: Array<{ addonId: string; qty: number }>
}

function parseSelections(json: string): {
  collections: string[]
  packages: Array<{ collectionId: string; packageId: string }>
  addons: Array<{ collectionId: string; addonId: string; qty: number }>
} {
  try {
    return JSON.parse(json)
  } catch {
    return { collections: [], packages: [], addons: [] }
  }
}

function groupSelections(json: string): ParsedSelection[] {
  const parsed = parseSelections(json)
  const byCollection = new Map<string, ParsedSelection>()
  for (const c of parsed.collections) {
    byCollection.set(c, { collectionId: c, packageIds: [], addons: [] })
  }
  for (const p of parsed.packages) {
    const entry = byCollection.get(p.collectionId)
    if (entry) entry.packageIds.push(p.packageId)
  }
  for (const a of parsed.addons) {
    const entry = byCollection.get(a.collectionId)
    if (entry) entry.addons.push({ addonId: a.addonId, qty: a.qty })
  }
  return Array.from(byCollection.values())
}

function addonToLineItem(
  collectionId: string,
  addonId: string,
  qty: number,
): OrderItemWrite | null {
  const addon = getAddon(collectionId, addonId)
  if (!addon) return null

  const isCustom = addon.priceType === 'custom'
  const isStarting = addon.priceType === 'starting'

  const name = isCustom
    ? `${addon.name} — quoted separately`
    : isStarting
      ? `${addon.name} (starting price — final TBD)`
      : addon.name

  return {
    name,
    pricePerUnit: isCustom ? 0 : addon.priceCents ?? 0,
    units: qty,
    taxable: true,
    selectability: 'optional',
    selected: true,
  }
}

/**
 * Build the Order body from a builder submission.
 *
 * IMPORTANT (verified live on 2026-05-13): VSCO's Order.total computation
 * EXCLUDES the pricePerUnit of line items that have children. A parent
 * with children acts as a presentational container, not a billed line —
 * only the children contribute to the total. This bit us in the first
 * smoke test: the order total was $1,775 instead of $2,670 because the
 * $895 Mirror Me parent (which had a $275 Audio Guest Book child) was
 * silently dropped from the total. Children were billed; parent wasn't.
 *
 * Solution: emit every package and every add-on as a TOP-LEVEL line
 * item. No nesting. This matches what existing real orders in the
 * studio look like (verified by inspecting a half-dozen completed
 * wedding orders). Mild downside: invoices won't visually group
 * add-ons under their parent package, but they'll be priced correctly,
 * which is what actually matters.
 *
 * Order of line items: for each collection (in selection order), all
 * its packages first, then all its add-ons. Aurora-style collections
 * with no packages just emit their add-ons.
 *
 * Custom-priced items (priceType: 'custom') keep pricePerUnit=0 with
 * a name suffix explaining the line will be quoted separately.
 *
 * Starting-priced items (priceType: 'starting') ship at their listed
 * starting cents with a name suffix so the operator knows to revise.
 */
export function builderToOrder(
  sub: PackageBuilderSubmissionRow,
  ctx: BuilderToOrderContext,
): OrderWrite & { lineItems: OrderItemWrite[] } {
  const { recipientId } = ctx
  const groups = groupSelections(sub.selections_json)

  const lineItems: OrderItemWrite[] = []

  for (const group of groups) {
    const collection = getCollection(group.collectionId)
    if (!collection) continue

    // 1. Packages first (each as its own top-level line item)
    for (const pkgId of group.packageIds) {
      const pkg = getPackage(group.collectionId, pkgId)
      if (!pkg) continue
      const isStarting = pkg.priceType === 'starting'
      const name = isStarting
        ? `${pkg.name} (starting price — final TBD)`
        : pkg.name
      const description = pkg.description
        ? `<p>${escapeHtml(pkg.description)}</p>`
        : null

      lineItems.push({
        name,
        descriptionHtml: description,
        pricePerUnit: pkg.priceCents,
        units: 1,
        taxable: true,
        selectability: 'required',
        selected: true,
      })
    }

    // 2. Add-ons next (each as its own top-level line item).
    //    Aurora flow (packageIds = []) hits this directly.
    for (const a of group.addons) {
      const item = addonToLineItem(group.collectionId, a.addonId, a.qty)
      if (item) lineItems.push(item)
    }
  }

  // Due date = created_at + 14 days
  const created = isoDateOnly(sub.created_at)
  const dueDate = addDays(created, 14)

  return {
    name: null,
    recipientId,
    dueDate,
    lineItems,
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
