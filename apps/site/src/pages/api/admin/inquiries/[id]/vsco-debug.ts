/**
 * GET /api/admin/inquiries/<id>/vsco-debug
 *
 * Debug helper: returns the full vsco_pushes rows for an inquiry,
 * including error_body, so the operator can see exactly what VSCO
 * returned when a push failed.
 *
 * Useful while building / debugging the integration. Behind admin auth.
 */

import type { APIRoute } from 'astro'
import { getInquiry, getVscoEntities, getVscoPushesForInquiry } from '@/lib/db'

export const prerender = false

export const GET: APIRoute = async ({ params }) => {
  const id = Number(params.id)
  if (!Number.isFinite(id) || id <= 0) {
    return json(400, { error: 'Invalid id' })
  }
  const inquiry = getInquiry(id)
  if (!inquiry) {
    return json(404, { error: 'Inquiry not found' })
  }

  const pushes = getVscoPushesForInquiry(id)
  const entities = inquiry.external_uuid
    ? getVscoEntities(inquiry.external_uuid)
    : []

  return json(200, {
    inquiry: {
      id: inquiry.id,
      external_uuid: inquiry.external_uuid,
      qualified_at: inquiry.qualified_at,
    },
    entities,
    pushes,
  })
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}
