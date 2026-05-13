import { describe, expect, it } from 'vitest'
import type { InquiryRow } from '@/lib/db'
import type { PackageBuilderSubmissionRow } from '@/lib/builder/submissions'
import type { VscoConfig } from '../config.ts'
import {
  inquiryToJobWorksheet,
  builderToJobUpdate,
  builderToOrder,
  parseBudgetRangeToCents,
  jobTypeKeyForInquiry,
  leadSourceKeyForInquiry,
  reservedPackageDisplay,
  noEmailPlaceholder,
} from '../mappings.ts'

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

const cfg: VscoConfig = {
  generatedAt: '2026-05-13T04:00:00.000Z',
  studioBrandId: 'BRAND',
  leadSources: {
    'website-contact': 'LS_WEB_CONTACT',
    'website-collection-smile': 'LS_WEB_SMILE',
    'website-collection-visionary': 'LS_WEB_VISIONARY',
    'website-collection-digital-atelier': 'LS_WEB_DA',
    'website-collection-aurora': 'LS_WEB_AURORA',
    'website-collection-resonance': 'LS_WEB_RESONANCE',
    'booth-expo': 'LS_BOOTH',
    referral: 'LS_REFERRAL',
    other: 'LS_OTHER',
  },
  leadStatuses: {
    new: 'ST_NEW',
    contacted: 'ST_CONTACTED',
    'follow-up': 'ST_FU',
    'meeting-scheduled': 'ST_MTG',
    'sent-quote': 'ST_QUOTE',
    'waiting-on-customer': 'ST_WAIT',
    stale: 'ST_STALE',
  },
  jobTypes: {
    wedding: 'JT_WEDDING',
    reception: 'JT_RECEPTION',
    'engagement-rehearsal': 'JT_ENG',
    corporate: 'JT_CORP',
    gala: 'JT_GALA',
    milestone: 'JT_MILESTONE',
    anniversary: 'JT_ANNIV',
    birthday: 'JT_BDAY',
    'bar-bat-mitzvah': 'JT_BBM',
    charity: 'JT_CHARITY',
    graduation: 'JT_GRAD',
    holiday: 'JT_HOLIDAY',
    other: 'JT_OTHER',
  },
  eventTypes: {
    ceremony: 'ET_CEREMONY',
    reception: 'ET_RECEPTION',
    'main-event': 'ET_MAIN',
    consultation: 'ET_CONSULT',
    walkthrough: 'ET_WALK',
    setup: 'ET_SETUP',
    meeting: 'ET_MEETING',
    call: 'ET_CALL',
  },
  jobRoles: {
    'partner-a': 'JR_PA',
    'partner-b': 'JR_PB',
    planner: 'JR_PLANNER',
    'primary-contact': 'JR_PRIMARY',
    'secondary-contact': 'JR_SECONDARY',
    'organizer-client': 'JR_ORG_CLIENT',
    venue: 'JR_VENUE',
    'parent-a': 'JR_PARENT_A',
    'parent-b': 'JR_PARENT_B',
    organization: 'JR_ORG',
    'main-subject': 'JR_MAIN',
  },
  customFields: {
    'interested-smile': 'CF_INT_SMILE',
    'interested-visionary': 'CF_INT_VISIONARY',
    'interested-digital-atelier': 'CF_INT_DA',
    'interested-aurora': 'CF_INT_AURORA',
    'interested-resonance': 'CF_INT_RESONANCE',
    'reserved-package': 'CF_RESERVED_PKG',
    'event-setting': 'CF_EVENT_SETTING',
    'consultation-preference': 'CF_CONSULT_PREF',
    'builder-submission-link': 'CF_BUILDER_LINK',
  },
}

const siteBase = 'https://smilenola.com'

function makeInquiry(overrides: Partial<InquiryRow> = {}): InquiryRow {
  return {
    id: 1,
    created_at: '2026-05-12T18:00:00.000Z',
    source: 'contact',
    status: 'new',
    first_name: 'Sarah',
    last_name: 'Beaumont',
    email: 'sarah@example.com',
    phone: '+15045551234',
    preferred_contact: 'Email',
    event_date: '2026-10-12',
    event_type: 'Wedding',
    venue: 'Ace Hotel',
    guest_count: 140,
    event_start: null,
    event_end: null,
    planner: null,
    budget_range: null,
    message: null,
    referral: null,
    collections_interested: null,
    collection_fields_json: null,
    notes: null,
    partner1_name: null,
    partner2_name: null,
    event_setting: null,
    poc_relationship: null,
    external_uuid: 'uuid-1',
    synced_at: null,
    source_legacy_id: null,
    deleted_at: null,
    qualified_at: null,
    ...overrides,
  }
}

// ──────────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────────

describe('parseBudgetRangeToCents', () => {
  it.each([
    ['Under $1,000', 100_000],
    ['$1,000 — $5,000', 500_000],
    ['$5,000 — $15,000', 1_500_000],
    ['$15,000 — $25,000', 2_500_000],
    ['$25,000+', 2_500_000],
    ['$1k - $5k', 500_000],
  ])('parses %s → %i cents (upper bound)', (input, expected) => {
    expect(parseBudgetRangeToCents(input)).toBe(expected)
  })

  it('returns null for nullish/empty input', () => {
    expect(parseBudgetRangeToCents(null)).toBeNull()
    expect(parseBudgetRangeToCents('')).toBeNull()
    expect(parseBudgetRangeToCents('Not sure')).toBeNull()
  })
})

describe('jobTypeKeyForInquiry', () => {
  it.each([
    ['Wedding', 'wedding'],
    ['Reception', 'reception'],
    ['Engagement / Rehearsal', 'engagement-rehearsal'],
    ['Engagement/Rehearsal', 'engagement-rehearsal'],
    ['Corporate', 'corporate'],
    ['Gala', 'gala'],
    ['Milestone', 'milestone'],
    ['Other', 'other'],
    [null, 'other'],
    ['unknown weird string', 'other'],
  ])('%s → %s', (input, expected) => {
    expect(jobTypeKeyForInquiry(input)).toBe(expected)
  })

  it('booth event_type "wedding" maps to wedding', () => {
    expect(jobTypeKeyForInquiry('wedding')).toBe('wedding')
  })
})

describe('leadSourceKeyForInquiry', () => {
  it.each([
    ['contact', 'website-contact'],
    ['collection-smile', 'website-collection-smile'],
    ['collection-visionary', 'website-collection-visionary'],
    ['collection-digital-atelier', 'website-collection-digital-atelier'],
    ['collection-aurora', 'website-collection-aurora'],
    ['collection-resonance', 'website-collection-resonance'],
    ['booth-expo', 'booth-expo'],
    ['weird-source', 'other'],
  ])('%s → %s', (input, expected) => {
    expect(leadSourceKeyForInquiry(input)).toBe(expected)
  })
})

describe('reservedPackageDisplay', () => {
  it.each([
    ['memory', 'Memory Booth'],
    ['memory-booth', 'Memory Booth'],
    ['mirror', 'Mirror Me Experience'],
    ['mirror-me', 'Mirror Me Experience'],
    ['mirror-all-night', 'Mirror Me All Night'],
    ['mirror-me-all-night', 'Mirror Me All Night'],
  ])('%s → %s', (input, expected) => {
    expect(reservedPackageDisplay(input)).toBe(expected)
  })

  it('returns null for unknown slugs', () => {
    expect(reservedPackageDisplay('unknown')).toBeNull()
    expect(reservedPackageDisplay(undefined)).toBeNull()
  })
})

describe('noEmailPlaceholder', () => {
  it('builds a deterministic placeholder using the external_uuid', () => {
    expect(noEmailPlaceholder('abc-123')).toBe(
      'no-email+abc-123@noemail.smilenola.com',
    )
  })

  it('falls back to an inquiry id when uuid is missing', () => {
    expect(noEmailPlaceholder(null, 42)).toBe(
      'no-email+inq-42@noemail.smilenola.com',
    )
  })
})

// ──────────────────────────────────────────────────────────────────────
// inquiryToJobWorksheet — the big mapping
// ──────────────────────────────────────────────────────────────────────

describe('inquiryToJobWorksheet', () => {
  it('maps a basic /contact inquiry to a worksheet with one client contact', () => {
    const inquiry = makeInquiry({ external_uuid: 'uuid-contact-1' })
    const ws = inquiryToJobWorksheet(inquiry, { config: cfg, siteBase })

    expect(ws.stage).toBe('lead')
    expect(ws.webLead).toBe(true)
    expect(ws.leadSourceId).toBe('LS_WEB_CONTACT')
    expect(ws.jobTypeId).toBe('JT_WEDDING')
    expect(ws.leadStatusId).toBe('ST_NEW')
    expect(ws.eventDate).toBe('2026-10-12')
    expect(ws.guestCount).toBe(140)
    expect(ws.inquiryDate).toBe('2026-05-12')

    // External mapping for idempotency
    expect(ws.externalMappings).toEqual([
      {
        id: 'uuid-contact-1',
        url: 'https://smilenola.com/admin/inquiries/1',
      },
    ])

    // Contacts: one person (the inquirer) marked client + a Location for the venue
    expect(ws.contacts).toHaveLength(2)
    const personEntry = ws.contacts.find(
      (c) => c.contact.kind === 'person',
    )!
    expect(personEntry.client).toBe(true)
    expect(personEntry.contact.kind).toBe('person')
    if (personEntry.contact.kind === 'person') {
      expect(personEntry.contact.firstName).toBe('Sarah')
      expect(personEntry.contact.lastName).toBe('Beaumont')
      expect(personEntry.contact.email).toBe('sarah@example.com')
      expect(personEntry.contact.cellPhone?.e164).toBe('+15045551234')
    }
    // Inquirer should get the primary-contact role. /contact form doesn't
    // collect partner names, so no partner-a role.
    expect(personEntry.jobRoles).toContain('JR_PRIMARY')
    expect(personEntry.jobRoles).not.toContain('JR_PA')

    const venueEntry = ws.contacts.find(
      (c) => c.contact.kind === 'location',
    )!
    expect(venueEntry.contact.kind).toBe('location')
    if (venueEntry.contact.kind === 'location') {
      expect(venueEntry.contact.name).toBe('Ace Hotel')
    }
    expect(venueEntry.client).toBeFalsy()
    expect(venueEntry.jobRoles).toContain('JR_VENUE')
  })

  it('skips venue contact when venue is null', () => {
    const inquiry = makeInquiry({ venue: null })
    const ws = inquiryToJobWorksheet(inquiry, { config: cfg, siteBase })
    expect(ws.contacts.find((c) => c.contact.kind === 'location')).toBeUndefined()
    expect(ws.contacts).toHaveLength(1)
  })

  it('booth: maps lead source, planner role, event_setting, interested checkboxes', () => {
    const inquiry = makeInquiry({
      source: 'booth-expo',
      first_name: 'Pam',
      last_name: 'Planner',
      email: 'pam@plans.com',
      phone: '+15045555555',
      event_type: 'wedding',
      partner1_name: 'Alex Martin',
      partner2_name: 'Riley Carter',
      event_setting: 'Outdoor — Covered',
      poc_relationship: 'Planner',
      collections_interested: JSON.stringify(['smile', 'aurora']),
      external_uuid: 'uuid-booth-1',
      id: 7,
    })
    const ws = inquiryToJobWorksheet(inquiry, { config: cfg, siteBase })

    expect(ws.leadSourceId).toBe('LS_BOOTH')
    expect(ws.jobTypeId).toBe('JT_WEDDING')

    const poc = ws.contacts.find((c) => c.contact.kind === 'person' && c.contact.email === 'pam@plans.com')
    expect(poc).toBeDefined()
    expect(poc!.jobRoles).toContain('JR_PLANNER')

    const cfMap = Object.fromEntries(ws.customFields.map((c) => [c.fieldId, c.value]))
    expect(cfMap['CF_EVENT_SETTING']).toBe('Outdoor — Covered')
    expect(cfMap['CF_INT_SMILE']).toBe('true')
    expect(cfMap['CF_INT_AURORA']).toBe('true')
    expect(cfMap['CF_INT_VISIONARY']).toBe('false')
  })

  it('booth: partner1+partner2 both distinct from POC create 3 contacts', () => {
    const inquiry = makeInquiry({
      source: 'booth-expo',
      first_name: 'Pam',
      last_name: 'Planner',
      email: 'pam@plans.com',
      partner1_name: 'Alex Martin',
      partner2_name: 'Riley Carter',
      event_type: 'wedding',
      poc_relationship: 'Planner',
      external_uuid: 'uuid-booth-2',
    })
    const ws = inquiryToJobWorksheet(inquiry, { config: cfg, siteBase })
    const persons = ws.contacts.filter((c) => c.contact.kind === 'person')
    expect(persons).toHaveLength(3)

    const partnerA = persons.find((p) => p.jobRoles?.includes('JR_PA'))
    const partnerB = persons.find((p) => p.jobRoles?.includes('JR_PB'))
    expect(partnerA).toBeDefined()
    expect(partnerB).toBeDefined()

    if (partnerA && partnerA.contact.kind === 'person') {
      expect(partnerA.contact.firstName).toBe('Alex')
      expect(partnerA.contact.lastName).toBe('Martin')
      expect(partnerA.contact.email).toBe(
        'no-email+uuid-booth-2-partner-a@noemail.smilenola.com',
      )
    }
    if (partnerB && partnerB.contact.kind === 'person') {
      expect(partnerB.contact.firstName).toBe('Riley')
      expect(partnerB.contact.lastName).toBe('Carter')
    }
  })

  it('booth: partner1 matching POC name dedupes (POC also gets partner-a role)', () => {
    const inquiry = makeInquiry({
      source: 'booth-expo',
      first_name: 'Casey',
      last_name: 'Boudreaux',
      email: 'casey@example.com',
      partner1_name: 'Casey Boudreaux',
      partner2_name: 'Jordan Smith',
      event_type: 'wedding',
      poc_relationship: 'One of the couple',
      external_uuid: 'uuid-booth-3',
    })
    const ws = inquiryToJobWorksheet(inquiry, { config: cfg, siteBase })
    const persons = ws.contacts.filter((c) => c.contact.kind === 'person')
    expect(persons).toHaveLength(2)

    const casey = persons.find((p) => {
      return p.contact.kind === 'person' && p.contact.email === 'casey@example.com'
    })
    expect(casey).toBeDefined()
    expect(casey!.client).toBe(true)
    // Casey is also partner-a (matched partner1_name)
    expect(casey!.jobRoles).toContain('JR_PA')
    expect(casey!.jobRoles).toContain('JR_PRIMARY')
  })

  it('sets the 5 interested-* custom fields based on collections_interested', () => {
    const inquiry = makeInquiry({
      collections_interested: JSON.stringify(['smile', 'aurora', 'visionary']),
    })
    const ws = inquiryToJobWorksheet(inquiry, { config: cfg, siteBase })
    const cfMap = Object.fromEntries(ws.customFields.map((c) => [c.fieldId, c.value]))
    expect(cfMap['CF_INT_SMILE']).toBe('true')
    expect(cfMap['CF_INT_VISIONARY']).toBe('true')
    expect(cfMap['CF_INT_AURORA']).toBe('true')
    expect(cfMap['CF_INT_DA']).toBe('false')
    expect(cfMap['CF_INT_RESONANCE']).toBe('false')
  })

  it('sets reserved-package from collection_fields_json.smile.selected_package', () => {
    const inquiry = makeInquiry({
      collections_interested: JSON.stringify(['smile']),
      collection_fields_json: JSON.stringify({
        smile: { selected_package: 'mirror-me-all-night' },
      }),
    })
    const ws = inquiryToJobWorksheet(inquiry, { config: cfg, siteBase })
    const cfMap = Object.fromEntries(ws.customFields.map((c) => [c.fieldId, c.value]))
    expect(cfMap['CF_RESERVED_PKG']).toBe('Mirror Me All Night')
  })

  it('sets event-setting from inquiry.event_setting (booth)', () => {
    const inquiry = makeInquiry({
      source: 'booth-expo',
      event_setting: 'Outdoor — Covered',
    })
    const ws = inquiryToJobWorksheet(inquiry, { config: cfg, siteBase })
    const cfMap = Object.fromEntries(ws.customFields.map((c) => [c.fieldId, c.value]))
    expect(cfMap['CF_EVENT_SETTING']).toBe('Outdoor — Covered')
  })

  it('parses budget_range into leadMaxBudget (cents, upper bound)', () => {
    const inquiry = makeInquiry({ budget_range: '$15,000 — $25,000' })
    const ws = inquiryToJobWorksheet(inquiry, { config: cfg, siteBase })
    expect(ws.leadMaxBudget).toBe(2_500_000)
  })

  it('appends collection_fields_json deep answers to leadNotes as readable text', () => {
    const inquiry = makeInquiry({
      message: 'Hi! Excited.',
      collection_fields_json: JSON.stringify({
        aurora: {
          video_wall_size: '24x14',
          desired_effects: 'lasers, haze, intelligent lighting',
        },
      }),
    })
    const ws = inquiryToJobWorksheet(inquiry, { config: cfg, siteBase })
    expect(ws.leadNotes).toContain('Hi! Excited.')
    expect(ws.leadNotes).toContain('Aurora:')
    expect(ws.leadNotes).toContain('24x14')
    expect(ws.leadNotes).toContain('lasers, haze, intelligent lighting')
  })

  it('creates a main-event Event when event_date is present', () => {
    const inquiry = makeInquiry({ event_date: '2026-10-12', venue: 'Ace Hotel' })
    const ws = inquiryToJobWorksheet(inquiry, { config: cfg, siteBase })
    expect(ws.events).toHaveLength(1)
    expect(ws.events[0]!.typeId).toBe('ET_MAIN')
    expect(ws.events[0]!.startDate).toBe('2026-10-12')
  })

  it('omits Event entirely when event_date is null', () => {
    const inquiry = makeInquiry({ event_date: null })
    const ws = inquiryToJobWorksheet(inquiry, { config: cfg, siteBase })
    expect(ws.events ?? []).toHaveLength(0)
  })

  it('uses no-email placeholder when client email is missing (defensive)', () => {
    // The schema requires email, but defensively: an empty string should not propagate.
    const inquiry = makeInquiry({ email: '', external_uuid: 'uuid-x' })
    const ws = inquiryToJobWorksheet(inquiry, { config: cfg, siteBase })
    const person = ws.contacts.find((c) => c.contact.kind === 'person')!
    if (person.contact.kind === 'person') {
      expect(person.contact.email).toBe(
        'no-email+uuid-x@noemail.smilenola.com',
      )
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// builderToJobUpdate — augment an existing Job with builder data
// ──────────────────────────────────────────────────────────────────────

function makeBuilder(overrides: Partial<PackageBuilderSubmissionRow> = {}): PackageBuilderSubmissionRow {
  return {
    id: 10,
    created_at: '2026-05-13T10:00:00.000Z',
    status: 'new',
    invoice_sent_at: null,
    source: 'invited-builder',
    first_name: 'Sarah',
    last_name: 'Beaumont',
    email: 'sarah@example.com',
    phone: '+15045551234',
    inquiry_id: 1,
    invite_token: 'tok-abc',
    event_date: '2026-10-12',
    event_type: 'Wedding',
    venue: 'Ace Hotel',
    guest_count: 140,
    consultation_pref: 'video',
    client_note: null,
    selections_json: JSON.stringify({
      collections: ['smile'],
      packages: [{ collectionId: 'smile', packageId: 'mirror-me-all-night' }],
      addons: [],
    }),
    fixed_subtotal_cents: 119500,
    custom_quoted_json: null,
    warnings_json: null,
    notes: null,
    ...overrides,
  }
}

describe('builderToJobUpdate', () => {
  it('builds a partial Job patch with refined event details and consultation preference', () => {
    const sub = makeBuilder()
    const patch = builderToJobUpdate(sub, { config: cfg, siteBase })
    expect(patch.eventDate).toBe('2026-10-12')
    expect(patch.guestCount).toBe(140)

    // builder-submission-link custom field points to admin builder page
    const link = patch.customFields?.find((c) => c.fieldId === 'CF_BUILDER_LINK')
    expect(link?.value).toBe('https://smilenola.com/admin/builder-submissions/10')

    // consultation-preference custom field set
    const pref = patch.customFields?.find((c) => c.fieldId === 'CF_CONSULT_PREF')
    expect(pref?.value).toBe('Video')
  })
})

// ──────────────────────────────────────────────────────────────────────
// builderToOrder — line items from selections
// ──────────────────────────────────────────────────────────────────────

describe('builderToOrder', () => {
  it('maps a single Smile package with addons as nested children[]', () => {
    const sub = makeBuilder({
      selections_json: JSON.stringify({
        collections: ['smile'],
        packages: [{ collectionId: 'smile', packageId: 'mirror-me' }],
        addons: [
          { collectionId: 'smile', addonId: 'audio-guest-book', qty: 1 },
          { collectionId: 'smile', addonId: 'smile-additional-hour', qty: 2 },
        ],
      }),
    })
    const recipientId = 'CONTACT_ULID_123'
    const order = builderToOrder(sub, {
      recipientId,
      config: cfg,
      siteBase,
    })

    // VSCO doesn't sum parents with children — everything ships FLAT so
    // every package and add-on contributes to the order total. Verified
    // live against multiple existing real orders in the studio.
    expect(order.recipientId).toBe(recipientId)
    expect(order.lineItems).toHaveLength(3)

    const pkg = order.lineItems.find((li) => li.name.includes('Mirror Me Experience'))!
    expect(pkg).toBeDefined()
    expect(pkg.pricePerUnit).toBe(89500)
    expect(pkg.units).toBe(1)
    expect(pkg.selectability).toBe('required')
    expect(pkg.selected).toBe(true)
    expect(pkg.children).toBeUndefined()

    const audioGuestBook = order.lineItems.find((li) => li.name.includes('Audio Guest Book'))!
    expect(audioGuestBook).toBeDefined()
    expect(audioGuestBook.pricePerUnit).toBe(27500)
    expect(audioGuestBook.selectability).toBe('optional')

    const ahour = order.lineItems.find((li) => li.name.includes('Additional Service Time'))!
    expect(ahour).toBeDefined()
    expect(ahour.units).toBe(2)
    expect(ahour.pricePerUnit).toBe(15000)
  })

  it('places Aurora addons (no packages) as top-level line items', () => {
    const sub = makeBuilder({
      selections_json: JSON.stringify({
        collections: ['aurora'],
        packages: [],
        addons: [
          { collectionId: 'aurora', addonId: 'led-wall-experience', qty: 1 },
        ],
      }),
    })
    const order = builderToOrder(sub, {
      recipientId: 'X',
      config: cfg,
      siteBase,
    })
    expect(order.lineItems.length).toBeGreaterThan(0)
    // No "Aurora — General Production" wrapper; addons stand alone
    expect(order.lineItems.every((li) => !li.children || li.children.length === 0)).toBe(true)
  })

  it('handles custom-priced addons by zeroing the price and tagging the name', () => {
    const sub = makeBuilder({
      selections_json: JSON.stringify({
        collections: ['visionary'],
        packages: [{ collectionId: 'visionary', packageId: 'visionary-highlight' }],
        addons: [
          { collectionId: 'visionary', addonId: 'visionary-travel', qty: 1 },
        ],
      }),
    })
    const order = builderToOrder(sub, {
      recipientId: 'X',
      config: cfg,
      siteBase,
    })
    // Travel fee is a top-level line item (flat shape, no children).
    const travel = order.lineItems.find((li) => li.name.includes('Travel'))!
    expect(travel).toBeDefined()
    expect(travel.pricePerUnit).toBe(0)
    expect(travel.name).toContain('quoted separately')
  })

  it('sets dueDate = created_at + 14 days (writeOnly: auto-creates invoice)', () => {
    const sub = makeBuilder({ created_at: '2026-05-13T10:00:00.000Z' })
    const order = builderToOrder(sub, {
      recipientId: 'X',
      config: cfg,
      siteBase,
    })
    expect(order.dueDate).toBe('2026-05-27')
  })

  it('emits package + addons as flat top-level line items', () => {
    // resonance with pa-package + ceremony-speaker. Both are TOP-LEVEL
    // line items (no nesting). Two items total, no children.
    const sub = makeBuilder({
      selections_json: JSON.stringify({
        collections: ['resonance'],
        packages: [{ collectionId: 'resonance', packageId: 'pa-package' }],
        addons: [{ collectionId: 'resonance', addonId: 'ceremony-speaker', qty: 1 }],
      }),
    })
    const order = builderToOrder(sub, {
      recipientId: 'X',
      config: cfg,
      siteBase,
    })
    expect(order.lineItems).toHaveLength(2)
    expect(order.lineItems.every((li) => !li.children)).toBe(true)

    const pkg = order.lineItems.find((li) => li.name.includes('PA'))!
    expect(pkg).toBeDefined()
    expect(pkg.selectability).toBe('required')

    const addon = order.lineItems.find((li) => li.name.includes('Ceremony Speaker'))!
    expect(addon).toBeDefined()
    expect(addon.selectability).toBe('optional')
    expect(addon.pricePerUnit).toBe(35000)
  })
})
