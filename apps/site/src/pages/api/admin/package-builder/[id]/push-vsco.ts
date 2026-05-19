/**
 * POST /api/admin/package-builder/<id>/push-vsco
 *
 * Manually retry the builder → VSCO Order push for a single submission.
 * Fire-and-forget: the response returns 200 as soon as the push function
 * is invoked; the actual outcome (success / skip / failure) is recorded
 * to vsco_pushes for the admin UI to display.
 *
 * Mirrors the inquiry-side `/qualify` endpoint pattern. Behind the admin
 * middleware guard like all /api/admin routes.
 *
 * The push gates the same way it does at submission time:
 *   - VSCO_ENABLED must be truthy
 *   - submission.inquiry_id must point to a real, qualified inquiry
 *   - that inquiry must have a VSCO Job entity already pushed
 *   - no Order entity for that inquiry can exist yet (idempotency)
 * When any gate fails, the push records a 'skipped' audit row and
 * returns — the admin can see the reason in the sync history.
 */

import type { APIRoute } from 'astro'
import { getDb } from '@/lib/db'
import { getSubmission } from '@/lib/builder/submissions'
import { pushBuilderToVsco } from '@/lib/vsco/push'

export const prerender = false

export const POST: APIRoute = async ({ params }) => {
  const id = Number(params.id)
  if (!Number.isFinite(id) || id <= 0) {
    return json(400, { error: 'Invalid id' })
  }

  const submission = getSubmission(getDb(), id)
  if (!submission) {
    return json(404, { error: 'Submission not found' })
  }

  // Fire-and-forget so the response doesn't block on the VSCO round-trip.
  // The push records its own audit row on completion; the admin UI polls
  // the audit history (well, reloads) to see the result.
  void pushBuilderToVsco(submission, { trigger: 'manual' })

  return json(200, { ok: true })
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}
