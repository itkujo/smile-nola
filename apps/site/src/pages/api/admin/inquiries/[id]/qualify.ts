/**
 * POST /api/admin/inquiries/<id>/qualify
 *
 * Sets inquiries.qualified_at = CURRENT_TIMESTAMP (idempotent — re-qualifying
 * a row is a no-op). Triggers a fire-and-forget push to VSCO Workspace.
 *
 * Behind the admin middleware guard like all /api/admin routes.
 */

import type { APIRoute } from 'astro'
import { getInquiry, markInquiryQualified } from '@/lib/db'
import { pushQualifiedToVsco } from '@/lib/vsco/push'

export const prerender = false

export const POST: APIRoute = async ({ params }) => {
  const id = Number(params.id)
  if (!Number.isFinite(id) || id <= 0) {
    return json(400, { error: 'Invalid id' })
  }
  const inquiry = getInquiry(id)
  if (!inquiry) {
    return json(404, { error: 'Inquiry not found' })
  }

  let qualified_at: string | null
  if (inquiry.qualified_at) {
    // Already qualified — treat as success and let the caller decide what to
    // show. We still re-trigger the push so a transient earlier failure can
    // be retried by clicking the button again.
    qualified_at = inquiry.qualified_at
  } else {
    qualified_at = markInquiryQualified(id)
    if (!qualified_at) {
      return json(500, { error: 'Could not mark qualified' })
    }
  }

  // Re-read so we have the freshly-stamped qualified_at on the row we push
  const updated = getInquiry(id)
  if (updated) {
    void pushQualifiedToVsco(updated)
  }

  return json(200, { ok: true, qualified_at })
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}
