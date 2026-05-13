/**
 * Push-layer tests. Uses a temp DB directory and a mocked fetch so the
 * VSCO client never hits the network. The push functions are tested
 * end-to-end including the audit log and entity recording.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'

// Set env BEFORE importing db.ts so the singleton picks up our test dir.
const testDir = mkdtempSync(join(tmpdir(), 'vsco-push-test-'))
process.env.SMILE_NOLA_DB_DIR = testDir
process.env.VSCO_API_KEY = 'test-api-key'
process.env.VSCO_API_BASE = 'https://test.vsco/api/v2'
process.env.SITE_PUBLIC_URL = 'https://test.smilenola.com'
process.env.VSCO_CONFIG_PATH = join(testDir, 'vsco-config.json')

// Stable, minimal config for tests
const minimalConfig = {
  generatedAt: '2026-05-13T00:00:00.000Z',
  studioBrandId: 'BRAND',
  leadSources: {
    'website-contact': 'LS_WC',
    'website-collection-smile': 'LS_S',
    'website-collection-visionary': 'LS_V',
    'website-collection-digital-atelier': 'LS_DA',
    'website-collection-aurora': 'LS_A',
    'website-collection-resonance': 'LS_R',
    'booth-expo': 'LS_BOOTH',
    referral: 'LS_REF',
    other: 'LS_OTHER',
  },
  leadStatuses: {
    new: 'ST_NEW',
    contacted: 'ST_C',
    'follow-up': 'ST_FU',
    'meeting-scheduled': 'ST_MTG',
    'sent-quote': 'ST_Q',
    'waiting-on-customer': 'ST_W',
    stale: 'ST_S',
  },
  jobTypes: {
    'photo-booth': 'JT_PB',
    videography: 'JT_VID',
    production: 'JT_PROD',
  },
  workflows: {
    'photo-booth': 'WF_PB',
    videography: 'WF_VID',
    production: 'WF_PROD',
  },
  eventTypes: {
    ceremony: 'ET_C',
    reception: 'ET_R',
    'main-event': 'ET_M',
    consultation: 'ET_CON',
    walkthrough: 'ET_W',
    setup: 'ET_S',
    meeting: 'ET_MTG',
    call: 'ET_CALL',
  },
  jobRoles: {
    'partner-a': 'JR_PA',
    'partner-b': 'JR_PB',
    planner: 'JR_PLAN',
    'primary-contact': 'JR_PRI',
    'secondary-contact': 'JR_SEC',
    'organizer-client': 'JR_OC',
    venue: 'JR_V',
    'parent-a': 'JR_PaA',
    'parent-b': 'JR_PaB',
    organization: 'JR_ORG',
    'main-subject': 'JR_MS',
  },
  customFields: {
    'interested-smile': 'CF_S',
    'interested-visionary': 'CF_V',
    'interested-digital-atelier': 'CF_DA',
    'interested-aurora': 'CF_A',
    'interested-resonance': 'CF_R',
    'reserved-package': 'CF_RP',
    'event-setting': 'CF_ES',
    'consultation-preference': 'CF_CP',
    'builder-submission-link': 'CF_BL',
    'event-occasion': 'CF_OCC',
  },
}

writeFileSync(process.env.VSCO_CONFIG_PATH, JSON.stringify(minimalConfig))

// Now imports — db.ts will use SMILE_NOLA_DB_DIR=testDir
const dbMod = await import('@/lib/db')
const pushMod = await import('../push.ts')
const { VscoClient } = await import('../client.ts')
const { resetVscoConfigCache } = await import('../config.ts')

let fakeFetch: any

beforeAll(() => {
  // Inject a controllable fetch into the VscoClient singleton.
  // We replace the client's internal client by resetting + overriding.
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  delete process.env.VSCO_ENABLED
  resetVscoConfigCache()
  pushMod.resetVscoClient()
  // Reset DB tables — order matters because of foreign keys
  const db = dbMod.getDb()
  db.exec('DELETE FROM vsco_pushes')
  db.exec('DELETE FROM vsco_entities')
  db.exec('DELETE FROM builder_invites')
  db.exec('DELETE FROM package_builder_submissions')
  db.exec('DELETE FROM inquiries')
  fakeFetch = undefined
})

function setFakeFetch(handler: (input: string, init?: RequestInit) => Response | Promise<Response>) {
  fakeFetch = handler
  // Monkey-patch the client singleton's fetch by re-creating with our fake.
  pushMod.resetVscoClient()
  ;(globalThis as any).__vscoTestFetch = handler
  // Hijack getVscoClient by setting the env so it constructs with our fetch.
  // Simpler: replace globalThis.fetch for the duration of the test.
  ;(globalThis as any).fetch = handler
}

function insertQualifiedInquiry(): {
  id: number
  externalUuid: string
} {
  const externalUuid = `uuid-${Math.random().toString(36).slice(2)}`
  const db = dbMod.getDb()
  // Insert directly with external_uuid + qualified_at set
  const stmt = db.prepare(
    `INSERT INTO inquiries (
       source, first_name, last_name, email, phone,
       event_date, event_type, venue, guest_count,
       external_uuid, qualified_at
     ) VALUES (
       'contact', 'Sarah', 'Beaumont', 'sarah@example.com', '+15045551234',
       '2026-10-12', 'Wedding', 'Ace Hotel', 140,
       ?, CURRENT_TIMESTAMP
     )`,
  )
  const r = stmt.run(externalUuid)
  return { id: Number(r.lastInsertRowid), externalUuid }
}

describe('pushInquiryToVsco — gating', () => {
  it('records skipped when VSCO_ENABLED is unset', async () => {
    const { id } = insertQualifiedInquiry()
    const inq = dbMod.getInquiry(id)!
    const result = await pushMod.pushInquiryToVsco(inq, { trigger: 'inquiry-create' })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('disabled')
    const pushes = dbMod.getVscoPushesForInquiry(id)
    expect(pushes).toHaveLength(1)
    expect(pushes[0]!.verdict).toBe('skipped')
    expect(pushes[0]!.notes).toMatch(/VSCO_ENABLED/i)
  })

  it('records skipped when inquiry is not qualified', async () => {
    process.env.VSCO_ENABLED = '1'
    const db = dbMod.getDb()
    db.exec(
      `INSERT INTO inquiries (source, first_name, last_name, email, phone, external_uuid)
       VALUES ('contact', 'P', 'Q', 'p@q.com', '+1555', 'uuid-not-qual')`,
    )
    const inq = db
      .prepare('SELECT * FROM inquiries WHERE external_uuid = ?')
      .get('uuid-not-qual') as any
    const result = await pushMod.pushInquiryToVsco(inq, { trigger: 'inquiry-create' })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('not-qualified')
    const pushes = dbMod.getVscoPushesForInquiry(inq.id)
    expect(pushes[0]!.verdict).toBe('skipped')
    expect(pushes[0]!.notes).toMatch(/not yet qualified/i)
  })

  it('records skipped when external_uuid is missing', async () => {
    process.env.VSCO_ENABLED = '1'
    const db = dbMod.getDb()
    db.exec(
      `INSERT INTO inquiries (source, first_name, last_name, email, phone, qualified_at)
       VALUES ('contact', 'P', 'Q', 'p@q.com', '+1555', CURRENT_TIMESTAMP)`,
    )
    const inq = db.prepare('SELECT * FROM inquiries ORDER BY id DESC LIMIT 1').get() as any
    const result = await pushMod.pushInquiryToVsco(inq, { trigger: 'inquiry-create' })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no-external-uuid')
  })
})

describe('pushInquiryToVsco — happy path (create)', () => {
  it('posts /job/-/worksheet, records entities, returns ok', async () => {
    process.env.VSCO_ENABLED = '1'
    const { id, externalUuid } = insertQualifiedInquiry()
    const inq = dbMod.getInquiry(id)!

    setFakeFetch(async (url: string, init?: any) => {
      if (url.includes('/job/-/worksheet') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            // Flat shape: Job fields at top level. The `contacts` array
            // contains JobContact join records, NOT raw Contacts — the
            // actual Contact entity (with its id) is nested under
            // `contact`. Verified live on 2026-05-13.
            id: 'JOB_001',
            created: '',
            modified: '',
            title: 'X',
            contacts: [
              {
                id: 'JOBCONT_POC', // JobContact join record id
                client: true,
                roleKinds: ['client'],
                contact: {
                  id: 'CONT_POC', // <-- the actual Contact id we want
                  kind: 'person',
                  firstName: 'Sarah',
                  lastName: 'Beaumont',
                  email: 'sarah@example.com',
                },
              },
              {
                id: 'JOBCONT_VENUE',
                roleKinds: ['venue'],
                contact: {
                  id: 'CONT_VENUE',
                  kind: 'location',
                  name: 'Ace Hotel',
                },
              },
            ],
            events: [{ id: 'EVT_001' }],
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`unexpected request: ${init?.method} ${url}`)
    })

    const result = await pushMod.pushInquiryToVsco(inq, { trigger: 'inquiry-create' })
    expect(result.ok).toBe(true)
    expect(result.jobId).toBe('JOB_001')

    // Audit
    const pushes = dbMod.getVscoPushesForInquiry(id)
    expect(pushes[0]!.verdict).toBe('ok')
    expect(pushes[0]!.duration_ms).toBeGreaterThanOrEqual(0)

    // Entities recorded — these MUST be the nested contact.id values
    // (the Contact entity id), NOT the top-level JobContact id.
    // recipientId on Order requires a Contact id, not a JobContact id.
    expect(dbMod.getVscoEntityId(externalUuid, 'job')).toBe('JOB_001')
    expect(dbMod.getVscoEntityId(externalUuid, 'contact-poc')).toBe('CONT_POC')
    expect(dbMod.getVscoEntityId(externalUuid, 'venue')).toBe('CONT_VENUE')
    expect(dbMod.getVscoEntityId(externalUuid, 'event-main')).toBe('EVT_001')
  })

  it('idempotent: second push with same external_uuid hits UPDATE path', async () => {
    process.env.VSCO_ENABLED = '1'
    const { id, externalUuid } = insertQualifiedInquiry()
    const inq = dbMod.getInquiry(id)!

    // Pre-record the job entity (simulating a prior successful push)
    dbMod.recordVscoEntities(externalUuid, [
      { kind: 'job', vscoId: 'JOB_PRE_EXISTING' },
    ])

    let getCalled = false
    let putCalled = false
    let healGetCalled = false
    setFakeFetch(async (url: string, init?: any) => {
      if (init?.method === 'GET' && url.includes('/job/JOB_PRE_EXISTING')) {
        getCalled = true
        return new Response(
          JSON.stringify({
            id: 'JOB_PRE_EXISTING',
            title: 'X',
            created: '',
            modified: '',
            stage: 'lead',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (init?.method === 'PUT' && url.includes('/job/JOB_PRE_EXISTING')) {
        putCalled = true
        return new Response(
          JSON.stringify({ id: 'JOB_PRE_EXISTING', title: 'X', created: '', modified: '' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (
        init?.method === 'GET' &&
        url.includes('/job-contact') &&
        url.includes('jobId=JOB_PRE_EXISTING')
      ) {
        // Self-heal GET — return empty (no contacts to heal in this test)
        healGetCalled = true
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      throw new Error(`unexpected: ${init?.method} ${url}`)
    })

    const result = await pushMod.pushInquiryToVsco(inq, { trigger: 'inquiry-update' })
    expect(result.ok).toBe(true)
    expect(result.jobId).toBe('JOB_PRE_EXISTING')
    expect(getCalled).toBe(true)
    expect(putCalled).toBe(true)
    expect(healGetCalled).toBe(true)
  })

  it('UPDATE path self-heals corrupted contact-poc entity from live JobContacts', async () => {
    process.env.VSCO_ENABLED = '1'
    const { id, externalUuid } = insertQualifiedInquiry()
    const inq = dbMod.getInquiry(id)!

    // Pre-record entities including a WRONG contact-poc id (simulating
    // the JobContact-id-vs-Contact-id bug from a prior buggy push)
    dbMod.recordVscoEntities(externalUuid, [
      { kind: 'job', vscoId: 'JOB_HEAL' },
      { kind: 'contact-poc', vscoId: 'BAD_JOBCONTACT_ID' }, // <-- wrong
    ])

    setFakeFetch(async (url: string, init?: any) => {
      if (init?.method === 'GET' && url.includes('/job/JOB_HEAL') && !url.includes('/job-contact')) {
        return new Response(
          JSON.stringify({ id: 'JOB_HEAL', title: 'X', created: '', modified: '', stage: 'lead' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (init?.method === 'PUT' && url.includes('/job/JOB_HEAL')) {
        return new Response(
          JSON.stringify({ id: 'JOB_HEAL', title: 'X', created: '', modified: '' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (init?.method === 'GET' && url.includes('/job-contact') && url.includes('jobId=JOB_HEAL')) {
        // Self-heal payload: /job-contact returns FLAT JobContacts —
        // `contactId` is the actual Contact id, no nested contact object.
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'JOBCONT_HEAL_001',
                contactId: 'CORRECT_CONTACT_ID', // <-- flat contactId
                client: true,
                jobRoles: ['JR_PRI'], // primary-contact role from test config
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`unexpected: ${init?.method} ${url}`)
    })

    const result = await pushMod.pushInquiryToVsco(inq, { trigger: 'inquiry-update' })
    expect(result.ok).toBe(true)

    // Heal should have replaced the bad id with the correct one
    expect(dbMod.getVscoEntityId(externalUuid, 'contact-poc')).toBe('CORRECT_CONTACT_ID')
  })
})

describe('pushInquiryToVsco — failure handling', () => {
  it('records failed when VSCO returns 500, never throws', async () => {
    process.env.VSCO_ENABLED = '1'
    const { id } = insertQualifiedInquiry()
    const inq = dbMod.getInquiry(id)!

    setFakeFetch(async () => {
      return new Response(JSON.stringify({ type: 'oops', message: 'Server kaboom' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    })

    const result = await pushMod.pushInquiryToVsco(inq, { trigger: 'inquiry-create' })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('error')

    const pushes = dbMod.getVscoPushesForInquiry(id)
    expect(pushes[0]!.verdict).toBe('failed')
    expect(pushes[0]!.http_status).toBe(500)
    expect(pushes[0]!.error_body).toContain('Server kaboom')
  })
})

describe('pushBuilderToVsco', () => {
  it('skips when inquiry has no VSCO job yet', async () => {
    process.env.VSCO_ENABLED = '1'
    const { id } = insertQualifiedInquiry()
    const db = dbMod.getDb()
    const subResult = db
      .prepare(
        `INSERT INTO package_builder_submissions (
           source, first_name, last_name, email, phone,
           inquiry_id, selections_json, fixed_subtotal_cents
         ) VALUES ('invited-builder', 'Sarah', 'B', 's@x.com', '+15555550000', ?, '{}', 89500)`,
      )
      .run(id)
    const sub = db
      .prepare('SELECT * FROM package_builder_submissions WHERE id = ?')
      .get(subResult.lastInsertRowid) as any

    const result = await pushMod.pushBuilderToVsco(sub)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no-job')
  })

  it('creates Order with line items when prerequisites are met', async () => {
    process.env.VSCO_ENABLED = '1'
    const { id, externalUuid } = insertQualifiedInquiry()

    dbMod.recordVscoEntities(externalUuid, [
      { kind: 'job', vscoId: 'JOB_AAA' },
      { kind: 'contact-poc', vscoId: 'CONT_POC_AAA' },
    ])

    const db = dbMod.getDb()
    const subInsert = db.prepare(
      `INSERT INTO package_builder_submissions (
         source, first_name, last_name, email, phone,
         inquiry_id, event_date, event_type, venue, guest_count,
         consultation_pref, selections_json, fixed_subtotal_cents
       ) VALUES ('invited-builder', 'Sarah', 'B', 's@x.com', '+15555550000', ?, ?, ?, ?, ?, 'video', ?, ?)`,
    )
    const selections = JSON.stringify({
      collections: ['smile'],
      packages: [{ collectionId: 'smile', packageId: 'mirror-me' }],
      addons: [{ collectionId: 'smile', addonId: 'audio-guest-book', qty: 1 }],
    })
    const subId = subInsert.run(
      id,
      '2026-10-12',
      'Wedding',
      'Ace Hotel',
      140,
      selections,
      117000,
    ).lastInsertRowid
    const sub = db
      .prepare('SELECT * FROM package_builder_submissions WHERE id = ?')
      .get(subId) as any

    let postBody: any = null
    setFakeFetch(async (url: string, init?: any) => {
      if (init?.method === 'GET' && url.includes('/job/JOB_AAA')) {
        return new Response(
          JSON.stringify({
            id: 'JOB_AAA',
            title: 'X',
            created: '',
            modified: '',
            stage: 'lead',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (init?.method === 'PUT' && url.includes('/job/JOB_AAA')) {
        return new Response(
          JSON.stringify({ id: 'JOB_AAA', title: 'X', created: '', modified: '' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (init?.method === 'POST' && url.includes('/job/JOB_AAA/order')) {
        postBody = JSON.parse(init.body)
        return new Response(
          JSON.stringify({
            id: 'ORD_001',
            status: 'draft',
            lineItems: postBody.lineItems,
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`unexpected: ${init?.method} ${url}`)
    })

    const result = await pushMod.pushBuilderToVsco(sub)
    expect(result.ok).toBe(true)
    expect(result.orderId).toBe('ORD_001')
    expect(postBody.recipientId).toBe('CONT_POC_AAA')
    expect(postBody.lineItems.length).toBeGreaterThan(0)
    expect(postBody.dueDate).toBeDefined()

    expect(dbMod.getVscoEntityId(externalUuid, 'order')).toBe('ORD_001')
  })
})
