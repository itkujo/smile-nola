/**
 * VSCO Workspace push orchestration.
 *
 * Bridges our database to the VSCO API. All exported functions are
 * fire-and-forget: they swallow every error, record an audit row to
 * `vsco_pushes`, and never block or throw to the caller. This mirrors the
 * pattern of `sendInquiryNotification` from email.ts.
 *
 * Gating: every push checks two preconditions before talking to VSCO:
 *   1. `VSCO_ENABLED` must be truthy (env flag).
 *   2. The inquiry must have `qualified_at` set (admin "Mark Qualified").
 * When either is false, the push records a 'skipped' verdict and returns.
 *
 * Idempotency: every push checks `vsco_entities` for an existing VSCO ULID
 * before creating a new entity. The `external_uuid` from the inquiries
 * table is the canonical key.
 */

import type { InquiryRow } from '@/lib/db'
import type { PackageBuilderSubmissionRow } from '@/lib/builder/submissions'
import {
  getInquiry,
  getVscoEntityId,
  recordVscoEntities,
  recordVscoPush,
  type VscoEntityKind,
  type VscoPushTrigger,
} from '@/lib/db'
import { VscoClient, VscoError } from './client.ts'
import { loadVscoConfig, type VscoConfig } from './config.ts'
import {
  builderToJobUpdate,
  builderToOrder,
  inquiryToJobWorksheet,
  type ConcreteJobWorksheet,
} from './mappings.ts'
import type {
  ContactRead,
  JobRead,
  JobWorksheetResponse,
  JobWrite,
  OrderRead,
  OrderWrite,
} from './types.ts'

// ──────────────────────────────────────────────────────────────────────
// Env / readiness
// ──────────────────────────────────────────────────────────────────────

function isEnabled(): boolean {
  const v = process.env.VSCO_ENABLED
  if (!v) return false
  const lc = v.toLowerCase()
  return lc === '1' || lc === 'true' || lc === 'yes' || lc === 'on'
}

function siteBase(): string {
  return process.env.SITE_PUBLIC_URL || 'https://smilenola.com'
}

let clientSingleton: VscoClient | null = null

export function getVscoClient(): VscoClient {
  if (clientSingleton) return clientSingleton
  const apiKey = process.env.VSCO_API_KEY
  if (!apiKey) {
    throw new Error('VSCO_API_KEY is not set')
  }
  const baseUrl =
    process.env.VSCO_API_BASE || 'https://workspace.vsco.co/api/v2'
  clientSingleton = new VscoClient({ apiKey, baseUrl })
  return clientSingleton
}

/** Test seam — clear the cached client so tests can swap fetch. */
export function resetVscoClient(): void {
  clientSingleton = null
}

// ──────────────────────────────────────────────────────────────────────
// Audit helpers
// ──────────────────────────────────────────────────────────────────────

interface AuditCtx {
  trigger: VscoPushTrigger
  externalUuid?: string | null
  inquiryId?: number | null
  builderId?: number | null
}

function recordSkipped(ctx: AuditCtx, reason: string): void {
  recordVscoPush({
    trigger: ctx.trigger,
    verdict: 'skipped',
    external_uuid: ctx.externalUuid,
    inquiry_id: ctx.inquiryId,
    builder_id: ctx.builderId,
    notes: reason,
  })
}

function recordOk(ctx: AuditCtx, durationMs: number, notes?: string): void {
  recordVscoPush({
    trigger: ctx.trigger,
    verdict: 'ok',
    external_uuid: ctx.externalUuid,
    inquiry_id: ctx.inquiryId,
    builder_id: ctx.builderId,
    duration_ms: durationMs,
    notes: notes ?? null,
  })
}

function recordFailure(ctx: AuditCtx, durationMs: number, err: unknown): void {
  let httpStatus: number | null = null
  let body: string | null = null
  let message = String((err as Error)?.message || err)
  if (err instanceof VscoError) {
    httpStatus = err.status
    body = err.body ? JSON.stringify(err.body) : null
  }
  recordVscoPush({
    trigger: ctx.trigger,
    verdict: 'failed',
    external_uuid: ctx.externalUuid,
    inquiry_id: ctx.inquiryId,
    builder_id: ctx.builderId,
    http_status: httpStatus,
    error_body: body,
    duration_ms: durationMs,
    notes: message.slice(0, 500),
  })
}

// ──────────────────────────────────────────────────────────────────────
// Core: push an inquiry to VSCO (only when qualified + enabled)
// ──────────────────────────────────────────────────────────────────────

/**
 * Push an inquiry to VSCO. Decides between CREATE (no entities recorded yet)
 * and UPDATE (Job already exists) automatically. Returns a promise that
 * NEVER rejects — failures are logged and recorded; the resolved value
 * indicates outcome.
 */
export async function pushInquiryToVsco(
  inquiry: InquiryRow,
  options: { trigger?: VscoPushTrigger } = {},
): Promise<{ ok: boolean; jobId?: string; reason?: string }> {
  const trigger = options.trigger ?? 'inquiry-update'
  const ctx: AuditCtx = {
    trigger,
    externalUuid: inquiry.external_uuid,
    inquiryId: inquiry.id,
  }

  if (!isEnabled()) {
    recordSkipped(ctx, 'VSCO_ENABLED is not truthy')
    return { ok: false, reason: 'disabled' }
  }
  if (!inquiry.qualified_at) {
    recordSkipped(ctx, 'inquiry not yet qualified')
    return { ok: false, reason: 'not-qualified' }
  }
  if (!inquiry.external_uuid) {
    recordSkipped(ctx, 'inquiry missing external_uuid')
    return { ok: false, reason: 'no-external-uuid' }
  }

  const config = loadVscoConfig()
  const start = Date.now()
  try {
    const existingJobId = getVscoEntityId(inquiry.external_uuid, 'job')
    if (existingJobId) {
      // UPDATE path
      await updateJobFromInquiry(existingJobId, inquiry, config)
      recordOk(ctx, Date.now() - start, `updated job ${existingJobId}`)
      return { ok: true, jobId: existingJobId }
    }

    // CREATE path: atomic worksheet
    const worksheet = inquiryToJobWorksheet(inquiry, {
      config,
      siteBase: siteBase(),
    })
    const client = getVscoClient()
    const response = await client.post<JobWorksheetResponse>(
      '/job/-/worksheet',
      worksheet,
    )
    // The worksheet response is flat — the Job's fields are at the top level,
    // not nested under a `job` key (spec is misleading; verified live).
    const jobId = response.id
    const contacts = response.contacts ?? []

    // Record the new entities
    const entities = collectEntitiesFromWorksheet(
      worksheet,
      response,
      jobId,
      contacts,
      config,
    )
    recordVscoEntities(inquiry.external_uuid, entities)

    recordOk(ctx, Date.now() - start, `created job ${jobId}`)
    return { ok: true, jobId }
  } catch (err) {
    recordFailure(ctx, Date.now() - start, err)
    // eslint-disable-next-line no-console
    console.error('[vsco] pushInquiryToVsco failed', err)
    return { ok: false, reason: 'error' }
  }
}

/**
 * Classify the response's contacts[] entries by CONTENT (kind + roles),
 * not by position. VSCO's worksheet response may reorder contacts
 * relative to the order we sent them — verified live: I sent POC then
 * venue, got back venue at index 0 and POC at index 1. Position-based
 * indexing produced swapped (contact-poc, venue) entity rows; only the
 * self-heal (which is content-based) recovered the correct mapping.
 *
 * Shape (verified 2026-05-13 against live API):
 *   contacts[i] = JobContact join record:
 *     { id, client, jobRoles[], contact: { id, kind, ... } }
 *   - `id` is the JobContact id (a join row — not what we want)
 *   - `contact.id` is the Contact id (the Person/Location entity)
 *   - We always want `contact.id` for vsco_entities; using JobContact id
 *     as a recipientId on an Order create produces a 400.
 *
 * Classification (most specific role wins):
 *   - contact.kind === 'location'        → venue
 *   - jobRoles contains 'partner-a'      → contact-partner-a
 *   - jobRoles contains 'partner-b'      → contact-partner-b
 *   - jobRoles contains 'venue' (defensive — usually paired with kind=location) → venue
 *   - jobRoles contains 'primary-contact' OR client:true → contact-poc
 *   - else: skip (don't record random extras as POC)
 */
function collectEntitiesFromWorksheet(
  _ws: ConcreteJobWorksheet,
  response: JobWorksheetResponse,
  jobId: string,
  contacts: ContactRead[],
  config: VscoConfig,
): Array<{ kind: VscoEntityKind; vscoId: string }> {
  const entities: Array<{ kind: VscoEntityKind; vscoId: string }> = [
    { kind: 'job', vscoId: jobId },
  ]

  const partnerAId = config.jobRoles['partner-a']
  const partnerBId = config.jobRoles['partner-b']
  const primaryContactId = config.jobRoles['primary-contact']
  const venueRoleId = config.jobRoles.venue

  type JobContactItem = {
    id?: string
    client?: boolean
    jobRoles?: string[]
    contact?: { id?: string; kind?: 'person' | 'company' | 'location' }
  }

  for (const respContact of contacts as unknown as JobContactItem[]) {
    const contactId = respContact.contact?.id ?? respContact.id
    if (!contactId) continue
    const roles = new Set(respContact.jobRoles ?? [])
    const kind = respContact.contact?.kind

    // Location contacts are always venue regardless of role
    if (kind === 'location' || roles.has(venueRoleId)) {
      entities.push({ kind: 'venue', vscoId: contactId })
      continue
    }
    if (kind === 'person' || kind === undefined) {
      // Prefer partner roles over POC so the more specific role wins.
      if (roles.has(partnerAId)) {
        entities.push({ kind: 'contact-partner-a', vscoId: contactId })
      } else if (roles.has(partnerBId)) {
        entities.push({ kind: 'contact-partner-b', vscoId: contactId })
      } else if (roles.has(primaryContactId) || respContact.client) {
        entities.push({ kind: 'contact-poc', vscoId: contactId })
      }
      // Unknown person without a recognized role: skip.
    }
  }

  // Event (if created)
  if (response.events && response.events.length > 0) {
    const firstEvent = response.events[0] as { id?: string } | undefined
    if (firstEvent?.id) {
      entities.push({ kind: 'event-main', vscoId: firstEvent.id })
    }
  }

  return entities
}

// ──────────────────────────────────────────────────────────────────────
// Update path (read-modify-write) + self-healing of vsco_entities
// ──────────────────────────────────────────────────────────────────────

async function updateJobFromInquiry(
  jobId: string,
  inquiry: InquiryRow,
  config: VscoConfig,
): Promise<void> {
  const client = getVscoClient()
  const current = await client.get<JobRead>(`/job/${encodeURIComponent(jobId)}`)
  // Reuse the worksheet mapping to build the patch (drop contacts/events)
  const ws = inquiryToJobWorksheet(inquiry, {
    config,
    siteBase: siteBase(),
  })

  const next: JobWrite = {
    ...current,
    eventDate: ws.eventDate ?? current.eventDate,
    guestCount: ws.guestCount ?? current.guestCount,
    leadMaxBudget: ws.leadMaxBudget ?? current.leadMaxBudget,
    leadNotes: ws.leadNotes ?? current.leadNotes,
    jobTypeId: ws.jobTypeId ?? current.jobTypeId,
    leadSourceId: ws.leadSourceId ?? current.leadSourceId,
    customFields: mergeCustomFields(current.customFields, ws.customFields),
    externalMappings: current.externalMappings ?? ws.externalMappings,
  }
  await client.put<JobRead>(`/job/${encodeURIComponent(jobId)}`, next)

  // Self-heal vsco_entities: re-read the live JobContacts and refresh our
  // mapping. Cheap (one extra GET) and fixes:
  //   - Past bugs that recorded wrong IDs (e.g. JobContact id vs Contact id)
  //   - Drift from manual VSCO UI changes (contact replaced/edited)
  //   - Missing entity rows when a previous push partially succeeded
  if (inquiry.external_uuid) {
    await refreshContactEntities(inquiry.external_uuid, jobId, config).catch(
      (err) => {
        // Don't fail the whole update because of a heal step. Log + swallow.
        // eslint-disable-next-line no-console
        console.warn('[vsco] refreshContactEntities failed:', err)
      },
    )
  }
}

/**
 * Fetch JobContacts for a Job and re-write vsco_entities mappings for
 * contact-poc / contact-partner-a / contact-partner-b / venue based on
 * the current server-side state. Idempotent.
 *
 * Shape note (verified live on 2026-05-13):
 *   GET /job-contact?jobId=<id> returns items with FLAT fields:
 *     - id (the JobContact join row id — NOT what we want)
 *     - contactId (the actual Contact id — what we want)
 *     - jobRoles (string[] of role ULIDs)
 *     - client (boolean)
 *     - roleKinds (string[] of denormalized role kinds: 'client'|'subject'|...)
 *   No nested 'contact' object. Contact kind isn't returned here — we'd
 *   need a separate /address-book/{id} GET to know if it's a person vs
 *   location. So we classify purely on role IDs.
 *
 * Role-based classification (most specific wins):
 *   - jobRoles contains 'partner-a' → contact-partner-a
 *   - jobRoles contains 'partner-b' → contact-partner-b
 *   - jobRoles contains 'venue'     → venue
 *   - jobRoles contains 'primary-contact' OR client:true → contact-poc
 *   - otherwise: skip (don't overwrite a good entry with a random extra)
 */
async function refreshContactEntities(
  externalUuid: string,
  jobId: string,
  config: VscoConfig,
): Promise<void> {
  const client = getVscoClient()
  const partnerAId = config.jobRoles['partner-a']
  const partnerBId = config.jobRoles['partner-b']
  const primaryContactId = config.jobRoles['primary-contact']
  const venueRoleId = config.jobRoles.venue

  type JobContactItem = {
    id?: string
    contactId?: string
    client?: boolean
    jobRoles?: string[]
  }
  const resp = await client.get<{ items: JobContactItem[] }>(
    `/job-contact?jobId=${encodeURIComponent(jobId)}&pageSize=50`,
  )
  const items = resp?.items ?? []

  const updates: Array<{ kind: VscoEntityKind; vscoId: string }> = []

  for (const jc of items) {
    const contactId = jc.contactId
    if (!contactId) continue
    const roles = new Set(jc.jobRoles ?? [])

    if (roles.has(partnerAId)) {
      updates.push({ kind: 'contact-partner-a', vscoId: contactId })
    } else if (roles.has(partnerBId)) {
      updates.push({ kind: 'contact-partner-b', vscoId: contactId })
    } else if (roles.has(venueRoleId)) {
      updates.push({ kind: 'venue', vscoId: contactId })
    } else if (roles.has(primaryContactId) || jc.client) {
      updates.push({ kind: 'contact-poc', vscoId: contactId })
    }
    // No recognized role: skip
  }

  if (updates.length > 0) {
    recordVscoEntities(externalUuid, updates)
  }
}

function mergeCustomFields<
  T extends { fieldId: string; value: string | null },
>(
  current: T[] | undefined,
  next: T[] | undefined,
): T[] {
  const map = new Map<string, T>()
  for (const c of current ?? []) map.set(c.fieldId, c)
  for (const n of next ?? []) map.set(n.fieldId, n)
  return Array.from(map.values())
}

// ──────────────────────────────────────────────────────────────────────
// Builder push: update Job + create Order
// ──────────────────────────────────────────────────────────────────────

/**
 * Push a builder submission to VSCO. Two steps:
 *   1. Update the Job (refined event details, consultation pref, etc.).
 *   2. Create an Order with line items; setting dueDate triggers invoice gen.
 *
 * Skips when:
 *   - VSCO_ENABLED is false
 *   - The linked inquiry isn't qualified (or no inquiry is linked)
 *   - No Job entity has been pushed yet for that inquiry
 */
export async function pushBuilderToVsco(
  submission: PackageBuilderSubmissionRow,
): Promise<{ ok: boolean; orderId?: string; reason?: string }> {
  const ctx: AuditCtx = {
    trigger: 'builder-create',
    builderId: submission.id,
    inquiryId: submission.inquiry_id ?? null,
  }

  if (!isEnabled()) {
    recordSkipped(ctx, 'VSCO_ENABLED is not truthy')
    return { ok: false, reason: 'disabled' }
  }
  if (!submission.inquiry_id) {
    recordSkipped(ctx, 'builder has no linked inquiry')
    return { ok: false, reason: 'no-inquiry' }
  }
  const inquiry = getInquiry(submission.inquiry_id)
  if (!inquiry) {
    recordSkipped(ctx, 'linked inquiry not found')
    return { ok: false, reason: 'no-inquiry' }
  }
  if (!inquiry.qualified_at) {
    recordSkipped(ctx, 'inquiry not yet qualified')
    return { ok: false, reason: 'not-qualified' }
  }
  if (!inquiry.external_uuid) {
    recordSkipped(ctx, 'inquiry missing external_uuid')
    return { ok: false, reason: 'no-external-uuid' }
  }
  ctx.externalUuid = inquiry.external_uuid

  const jobId = getVscoEntityId(inquiry.external_uuid, 'job')
  if (!jobId) {
    recordSkipped(ctx, 'no VSCO job exists for inquiry')
    return { ok: false, reason: 'no-job' }
  }

  // Find the primary contact ULID for the recipientId
  const recipientId = getVscoEntityId(inquiry.external_uuid, 'contact-poc')
  if (!recipientId) {
    recordSkipped(ctx, 'no VSCO contact-poc for inquiry')
    return { ok: false, reason: 'no-recipient' }
  }

  const existingOrderId = getVscoEntityId(inquiry.external_uuid, 'order')
  if (existingOrderId) {
    // Don't recreate. Update would be possible but we treat builder submissions
    // as terminal: invoice goes out once.
    recordSkipped(ctx, `order ${existingOrderId} already exists`)
    return { ok: false, orderId: existingOrderId, reason: 'duplicate' }
  }

  const config = loadVscoConfig()
  const client = getVscoClient()
  const start = Date.now()

  try {
    // 1. Update job with builder patch
    const jobPatch = builderToJobUpdate(submission, {
      config,
      siteBase: siteBase(),
    })
    const currentJob = await client.get<JobRead>(
      `/job/${encodeURIComponent(jobId)}`,
    )
    const nextJob: JobWrite = {
      ...currentJob,
      ...jobPatch,
      customFields: mergeCustomFields(
        currentJob.customFields,
        jobPatch.customFields,
      ),
    }
    await client.put<JobRead>(`/job/${encodeURIComponent(jobId)}`, nextJob)

    // 2. Create order
    const orderBody: OrderWrite = builderToOrder(submission, {
      recipientId,
      config,
      siteBase: siteBase(),
    })
    const order = await client.post<OrderRead>(
      `/job/${encodeURIComponent(jobId)}/order`,
      orderBody,
    )
    const orderId = order.id

    recordVscoEntities(inquiry.external_uuid, [
      { kind: 'order', vscoId: orderId },
    ])
    recordOk(ctx, Date.now() - start, `order ${orderId}`)
    return { ok: true, orderId }
  } catch (err) {
    recordFailure(ctx, Date.now() - start, err)
    // eslint-disable-next-line no-console
    console.error('[vsco] pushBuilderToVsco failed', err)
    return { ok: false, reason: 'error' }
  }
}

// ──────────────────────────────────────────────────────────────────────
// Qualify push: called by the admin "Mark Qualified" endpoint
// ──────────────────────────────────────────────────────────────────────

/**
 * Triggered immediately after `markInquiryQualified()` succeeds. Creates
 * the Job in VSCO if it doesn't exist yet. Fire-and-forget.
 */
export async function pushQualifiedToVsco(
  inquiry: InquiryRow,
): Promise<{ ok: boolean; jobId?: string; reason?: string }> {
  return pushInquiryToVsco(inquiry, { trigger: 'qualify' })
}
