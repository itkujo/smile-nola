/**
 * VSCO API shape probe.
 *
 * Hits every endpoint we read or write and reports the actual response
 * shape. The goal is to surface mismatches between our hand-rolled types
 * (or the OpenAPI spec) and the live API BEFORE they bite us in prod.
 *
 * This script is READ-ONLY (no creates, no updates, no deletes). It uses
 * existing IDs from your studio. Safe to run anytime.
 *
 * Usage:
 *   pnpm vsco:probe                  # human-readable report
 *   pnpm vsco:probe --json           # machine-readable JSON output
 *
 * Reads VSCO_API_KEY + VSCO_API_BASE from apps/site/.env.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ──────────────────────────────────────────────────────────────────────
// Env loading (minimal: don't pull in dotenv as a dep)
// ──────────────────────────────────────────────────────────────────────

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const raw = readFileSync(path, 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const k = trimmed.slice(0, eq).trim()
      let v = trimmed.slice(eq + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      out[k] = v
    }
  } catch {
    /* missing .env is fine — we'll fall back to process.env */
  }
  return out
}

const envFromFile = loadEnv(join(__dirname, '..', '.env'))
const VSCO_API_KEY = process.env.VSCO_API_KEY || envFromFile.VSCO_API_KEY || ''
const VSCO_API_BASE =
  process.env.VSCO_API_BASE ||
  envFromFile.VSCO_API_BASE ||
  'https://workspace.vsco.co/api/v2'

if (!VSCO_API_KEY) {
  console.error('ERROR: VSCO_API_KEY not set in env or apps/site/.env')
  process.exit(1)
}

const args = process.argv.slice(2)
const jsonMode = args.includes('--json')

// ──────────────────────────────────────────────────────────────────────
// HTTP helper
// ──────────────────────────────────────────────────────────────────────

interface ProbeResult {
  name: string
  method: string
  url: string
  status: number
  ok: boolean
  topLevelKeys: string[] | null
  itemKeys: string[] | null
  itemCount: number | null
  notes: string[]
  raw?: unknown
}

async function probe(
  name: string,
  method: string,
  path: string,
  expectations: { mustHaveTopLevelKeys?: string[]; mustHaveItemKeys?: string[] } = {},
): Promise<ProbeResult> {
  const url = `${VSCO_API_BASE}${path}`
  const notes: string[] = []
  let status = 0
  let body: unknown = null
  try {
    const res = await fetch(url, {
      method,
      headers: { 'X-API-KEY': VSCO_API_KEY, accept: 'application/json' },
    })
    status = res.status
    const text = await res.text()
    try {
      body = JSON.parse(text)
    } catch {
      notes.push(`response is not JSON (first 80 chars): ${text.slice(0, 80)}`)
    }
  } catch (err) {
    notes.push(`network error: ${(err as Error).message}`)
  }

  const ok = status >= 200 && status < 300
  if (!ok) notes.push(`non-2xx status ${status}`)

  // Infer shape
  let topLevelKeys: string[] | null = null
  let itemKeys: string[] | null = null
  let itemCount: number | null = null

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    topLevelKeys = Object.keys(body).sort()
    const items = (body as Record<string, unknown>).items
    if (Array.isArray(items)) {
      itemCount = items.length
      if (items.length > 0 && typeof items[0] === 'object' && items[0]) {
        itemKeys = Object.keys(items[0] as Record<string, unknown>).sort()
      }
    }
  }

  // Apply expectations
  for (const k of expectations.mustHaveTopLevelKeys ?? []) {
    if (!topLevelKeys?.includes(k)) {
      notes.push(`MISSING expected top-level key: ${k}`)
    }
  }
  for (const k of expectations.mustHaveItemKeys ?? []) {
    if (!itemKeys?.includes(k)) {
      notes.push(`MISSING expected item key: ${k}`)
    }
  }

  return {
    name,
    method,
    url,
    status,
    ok,
    topLevelKeys,
    itemKeys,
    itemCount,
    notes,
    raw: body,
  }
}

// ──────────────────────────────────────────────────────────────────────
// Lookups for finding IDs we need to probe more endpoints
// ──────────────────────────────────────────────────────────────────────

async function pickAnyId(path: string): Promise<string | null> {
  const url = `${VSCO_API_BASE}${path}`
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'X-API-KEY': VSCO_API_KEY },
  })
  if (!res.ok) return null
  const body = (await res.json()) as { items?: Array<{ id?: string }> }
  return body.items?.[0]?.id ?? null
}

// ──────────────────────────────────────────────────────────────────────
// Run all probes
// ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const results: ProbeResult[] = []

  // 1. Collection endpoints — our types assume { meta, type, items } envelope
  results.push(
    await probe('lead-source list', 'GET', '/lead-source?pageSize=5', {
      mustHaveTopLevelKeys: ['items', 'meta'],
      mustHaveItemKeys: ['id', 'name'],
    }),
  )
  results.push(
    await probe('lead-status list', 'GET', '/lead-status?pageSize=5', {
      mustHaveTopLevelKeys: ['items', 'meta'],
      mustHaveItemKeys: ['id', 'name', 'kind'],
    }),
  )
  results.push(
    await probe('job-type list', 'GET', '/job-type?pageSize=5', {
      mustHaveTopLevelKeys: ['items', 'meta'],
      mustHaveItemKeys: ['id', 'name'],
    }),
  )
  results.push(
    await probe('event-type list', 'GET', '/event-type?pageSize=5', {
      mustHaveTopLevelKeys: ['items', 'meta'],
      mustHaveItemKeys: ['id', 'name'],
    }),
  )
  results.push(
    await probe('job-role list', 'GET', '/job-role?pageSize=5', {
      mustHaveTopLevelKeys: ['items', 'meta'],
      mustHaveItemKeys: ['id', 'name'],
    }),
  )
  results.push(
    await probe('custom-field list', 'GET', '/custom-field?pageSize=5', {
      mustHaveTopLevelKeys: ['items', 'meta'],
      mustHaveItemKeys: ['id', 'name', 'kind', 'canApplyTo'],
    }),
  )
  results.push(
    await probe('tax-group list', 'GET', '/tax-group?pageSize=5', {
      mustHaveTopLevelKeys: ['items', 'meta'],
    }),
  )
  results.push(
    await probe('brand list', 'GET', '/brand?pageSize=5', {
      mustHaveTopLevelKeys: ['items', 'meta'],
      mustHaveItemKeys: ['id', 'name'],
    }),
  )

  // 2. Job — single entity
  const jobId = await pickAnyId('/job?pageSize=1')
  if (jobId) {
    results.push(
      await probe(`job/{id} (existing job)`, 'GET', `/job/${jobId}`, {
        mustHaveTopLevelKeys: ['id', 'stage', 'title'],
      }),
    )

    // 3. Job's contacts — list endpoint (different shape than worksheet response)
    results.push(
      await probe(
        `job-contact?jobId=${jobId}`,
        'GET',
        `/job-contact?jobId=${jobId}`,
        {
          mustHaveTopLevelKeys: ['items', 'meta'],
          // NOTE: spec might say "contact" (nested) but live API returns "contactId" (flat)
          mustHaveItemKeys: ['id', 'contactId', 'jobRoles', 'client'],
        },
      ),
    )

    // 4. Job's orders
    results.push(
      await probe(`job/{id}/order`, 'GET', `/job/${jobId}/order?pageSize=5`, {
        mustHaveTopLevelKeys: ['items', 'meta'],
      }),
    )
  } else {
    results.push({
      name: 'job/{id}',
      method: 'GET',
      url: '(skipped)',
      status: 0,
      ok: false,
      topLevelKeys: null,
      itemKeys: null,
      itemCount: null,
      notes: ['no jobs found in studio — cannot probe job-related endpoints'],
    })
  }

  // 5. Address book — single contact
  const contactId = await pickAnyId('/address-book?pageSize=1')
  if (contactId) {
    results.push(
      await probe(`address-book/{id}`, 'GET', `/address-book/${contactId}`, {
        mustHaveTopLevelKeys: ['id', 'kind'],
      }),
    )
  }

  // 6. Order — single
  if (jobId) {
    // Get an order via job
    const ordersRes = await fetch(`${VSCO_API_BASE}/job/${jobId}/order?pageSize=1`, {
      headers: { 'X-API-KEY': VSCO_API_KEY },
    })
    if (ordersRes.ok) {
      const ordersBody = (await ordersRes.json()) as { items?: Array<{ id?: string }> }
      const orderId = ordersBody.items?.[0]?.id
      if (orderId) {
        results.push(
          await probe(`order/{id}`, 'GET', `/order/${orderId}`, {
            mustHaveTopLevelKeys: ['id', 'jobId', 'lineItems', 'status'],
          }),
        )
      }
    }
  }

  // 7. Rest hooks (we don't use yet, but if we ever do)
  results.push(
    await probe('rest-hook list', 'GET', '/rest-hook?pageSize=5', {
      mustHaveTopLevelKeys: ['items', 'meta'],
    }),
  )

  // ────────────────────────────────────────────────────────────────────
  // Print report
  // ────────────────────────────────────────────────────────────────────

  if (jsonMode) {
    console.log(JSON.stringify(results, null, 2))
    return
  }

  const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
  }

  console.log(`${C.bold}VSCO API shape probe${C.reset}`)
  console.log(`  base: ${VSCO_API_BASE}`)
  console.log()

  let mismatches = 0
  for (const r of results) {
    const tag = r.ok ? `${C.green}OK    ${C.reset}` : `${C.red}FAIL  ${C.reset}`
    const hasMismatch = r.notes.some((n) => n.startsWith('MISSING'))
    if (hasMismatch) mismatches++
    const marker = hasMismatch ? ` ${C.yellow}⚠${C.reset}` : ''
    console.log(`${tag} ${r.method} ${r.url}  [${r.status}]${marker}`)
    if (r.topLevelKeys) {
      console.log(`       ${C.dim}top-level keys:${C.reset} ${r.topLevelKeys.join(', ')}`)
    }
    if (r.itemKeys) {
      console.log(
        `       ${C.dim}items[0] keys:${C.reset} ${r.itemKeys.join(', ')} ${C.dim}(${r.itemCount} items)${C.reset}`,
      )
    }
    for (const n of r.notes) {
      const color = n.startsWith('MISSING') ? C.yellow : C.dim
      console.log(`       ${color}${n}${C.reset}`)
    }
    console.log()
  }

  if (mismatches === 0) {
    console.log(`${C.green}${C.bold}✓ No shape mismatches found across ${results.length} probes.${C.reset}`)
  } else {
    console.log(
      `${C.yellow}${C.bold}⚠ ${mismatches} probe(s) with missing expected keys. Review above.${C.reset}`,
    )
  }
}

main().catch((err) => {
  console.error('Probe failed:', err)
  process.exit(1)
})
