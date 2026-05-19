/**
 * POST /api/admin/inquiries/<id>/vsco-clear
 *
 * Admin debug helper: clears recorded vsco_entities rows for an
 * inquiry. Used during testing / recovery when an entity in VSCO was
 * deleted or voided server-side and we need our code to re-attempt
 * creating it on the next push.
 *
 * Body: { kind: 'order' | 'event-main' | 'contact-poc' | ... }
 *   - Provide one kind at a time for safety.
 *
 * Behind admin auth like all /api/admin routes. Never deletes the Job
 * entity (too risky — wipes the whole vsco mapping). Use vsco-debug
 * first to see what's there.
 */

import type { APIRoute } from 'astro'
import { getDb, getInquiry } from '@/lib/db'

export const prerender = false

const ALLOWED_KINDS = [
  'order',
  'event-main',
  'contact-poc',
  'contact-partner-a',
  'contact-partner-b',
  'venue',
] as const

export const POST: APIRoute = async ({ params, request }) => {
  const id = Number(params.id)
  if (!Number.isFinite(id) || id <= 0) {
    return json(400, { error: 'Invalid id' })
  }
  const inquiry = getInquiry(id)
  if (!inquiry) {
    return json(404, { error: 'Inquiry not found' })
  }
  if (!inquiry.external_uuid) {
    return json(400, { error: 'Inquiry has no external_uuid' })
  }

  let body: { kind?: unknown }
  try {
    body = await request.json()
  } catch {
    return json(400, { error: 'Body must be valid JSON' })
  }

  const kind = typeof body.kind === 'string' ? body.kind : ''
  if (!ALLOWED_KINDS.includes(kind as (typeof ALLOWED_KINDS)[number])) {
    return json(400, {
      error: `kind must be one of: ${ALLOWED_KINDS.join(', ')}`,
    })
  }

  const result = getDb()
    .prepare('DELETE FROM vsco_entities WHERE external_uuid = ? AND kind = ?')
    .run(inquiry.external_uuid, kind)

  return json(200, {
    ok: true,
    deletedCount: result.changes,
    external_uuid: inquiry.external_uuid,
    kind,
  })
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}
