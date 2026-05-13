# VSCO Workspace (Táve) CRM Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace HoneyBook + Zapier with a direct, full-fidelity VSCO Workspace integration that auto-creates a Job from each inquiry, updates the same Job (and creates an Order with auto-generated invoice) when the package builder is submitted, while keeping SQLite as the pre-qualification source of truth and VSCO as the post-qualification source of truth.

**Architecture:** Three thin layers added to `apps/site`. (1) A typed VSCO API client wrapping the OpenAPI 3.0 spec with retry/backoff/idempotency. (2) A mapping layer that translates `InquiryRow` and `PackageBuilderSubmissionRow` into VSCO request bodies, using native fields wherever possible and 9 explicit custom fields. (3) A push layer that calls the right endpoint at the right moment (fire-and-forget alongside the existing Resend email), keyed on `external_uuid` for idempotency. Plus a one-time `pnpm vsco:bootstrap` script that creates the lookups (Lead Sources, Job Types, Event Types) and custom fields in the studio and emits a `vsco-config.json` of resolved IDs. A `qualified` flag on inquiries marks the SQLite→VSCO source-of-truth handoff.

**Tech Stack:** TypeScript, Astro 5 SSR, Node 22, `better-sqlite3`, `zod`, `vitest`. No new runtime dependencies — VSCO API access is via `fetch`. No build-time deps beyond what's already in `apps/site`.

---

## Decisions locked from the brainstorming round

| Decision | Choice | Why |
|---|---|---|
| API surface | VSCO Workspace OpenAPI v2 (`https://workspace.vsco.co/api/v2`) | Same product as Táve; OpenAPI 3.0 spec exists |
| Source of truth (pre-qualified leads) | SQLite | Booth offline tolerance, full schema control, fast admin |
| Source of truth (post-qualified) | VSCO Workspace | Where invoices, payments, contracts, automation live |
| Handoff trigger | Admin button "Mark Qualified" on each inquiry; sets `qualified_at` and freezes pushes from SQLite | Explicit, intentional, irreversible-feeling without being destructive |
| Invoice send | VSCO native Automation (one-time UI config inside Workspace) | No API endpoint exists; this is the intended Workspace pattern |
| Products catalog sync | NOT initially | `OrderItem` has no `productId` field — line items are standalone — so syncing Products provides no benefit to API-built orders. `catalog.ts` stays the only price source |
| Partner names | Two `Person` contacts both `client: true` | Native VSCO pattern; works for any couple shape |
| POC relationship (booth) | `JobContact.jobRoles[]` referencing a Job Role | More semantic than a custom field |
| Per-collection deep Q&A | Appended to `Job.leadNotes` as readable text | Avoids exploding dozens of custom fields for rarely-queried data |
| API key delete privilege | NOT granted | We never delete; soft-mark via stage/status only |
| Custom fields | 9 fields (see Task 3) | Justified one-by-one; native fields used everywhere possible |
| Feature flag | `VSCO_ENABLED=1` env var | Allows dark-launch and fast disable |
| Failure mode | Fire-and-forget; log on failure; never block form response | Matches existing Resend email pattern in `email.ts` |

## File Structure

**New files (all under `apps/site`):**

| Path | Responsibility |
|---|---|
| `apps/site/src/lib/vsco/client.ts` | Typed `fetch` wrapper. Auth, retries with `Retry-After`, JSON encode/decode, error normalization. ~150 LOC. |
| `apps/site/src/lib/vsco/types.ts` | Hand-written TypeScript types for the entities we touch: `Job`, `Contact (Person\|Company\|Location)`, `Event`, `Order`, `OrderItem`, `CustomField`, `CustomFieldValue`, `JobWorksheet`, `LeadSource`, `LeadStatus`, `JobType`, `EventType`, `JobRole`, lookup collections. ~250 LOC. |
| `apps/site/src/lib/vsco/config.ts` | Loads `vsco-config.json` (resolved lookup IDs from bootstrap). Provides typed accessors `leadSourceId('website-contact')`, `customFieldId('reserved-package')`, etc. ~80 LOC. |
| `apps/site/src/lib/vsco/mapping.ts` | Pure functions: `inquiryToJobWorksheet(inquiry, config)`, `builderToJobUpdate(builder, inquiry, config)`, `builderToOrder(builder, contactId, config)`. No I/O. ~300 LOC. |
| `apps/site/src/lib/vsco/push.ts` | Side-effectful: `pushInquiryToVsco(inquiry)`, `pushBuilderToVsco(builder)`, `pushQualifiedToVsco(inquiry)`. Reads config, calls client, logs results to `vsco_pushes` table. ~200 LOC. |
| `apps/site/src/lib/vsco/index.ts` | Public barrel. Re-exports the three `push*` functions. ~10 LOC. |
| `apps/site/scripts/vsco-bootstrap.ts` | One-time CLI: creates Lead Sources, Lead Statuses, Job Types, Event Types, Job Roles, Custom Fields if missing. Writes `vsco-config.json` next to the script. Idempotent — running twice does nothing. ~350 LOC. |
| `apps/site/vsco-config.json` | Generated. Resolved IDs from the studio. **Gitignored**. Reference at boot. |
| `apps/site/vsco-config.example.json` | Committed. Schema reference + empty defaults. |
| `apps/site/src/lib/vsco/__tests__/mapping.test.ts` | Unit tests for the pure mapping functions. |
| `apps/site/src/lib/vsco/__tests__/client.test.ts` | Tests for retry/backoff/idempotency using a fake fetch. |
| `apps/site/src/pages/api/admin/inquiries/[id]/qualify.ts` | POST endpoint that sets `qualified_at` and (if VSCO enabled) calls `pushQualifiedToVsco`. |

**Modified files:**

| Path | Lines | Reason |
|---|---|---|
| `apps/site/src/lib/db.ts` | +schema migration | Add `qualified_at TEXT` to `inquiries`. Add new `vsco_pushes` audit table. Add new `vsco_entities` lookup table mapping `external_uuid` → `{job_id, primary_contact_id, secondary_contact_id, venue_id, order_id, invoice_id}`. |
| `apps/site/src/pages/api/inquiry.ts` | +5 lines | After Resend send, call `pushInquiryToVsco(row).catch(logVscoError)`. |
| `apps/site/src/pages/api/contact.ts` | +5 lines | Same. |
| `apps/site/src/pages/api/sync/inquiries.ts` | +5 lines | Same — only for fresh inserts (we already detect that). |
| `apps/site/src/pages/api/package-builder.ts` | +5 lines | After Resend send, call `pushBuilderToVsco(submission).catch(logVscoError)`. |
| `apps/site/src/pages/admin/inquiries/[id].astro` | +button | "Mark as Qualified" button. POSTs to the new qualify endpoint. Disables if already qualified. |
| `apps/site/package.json` | +scripts | `"vsco:bootstrap": "tsx scripts/vsco-bootstrap.ts"`, `"vsco:test": "tsx scripts/vsco-bootstrap.ts --dry-run"`. |
| `apps/site/.env.example` | +3 vars | `VSCO_API_KEY=`, `VSCO_API_BASE=https://workspace.vsco.co/api/v2`, `VSCO_ENABLED=0`. |
| `apps/site/.gitignore` | +1 line | `vsco-config.json` |

---

## Task 1: Environment, types, and dependency setup

**Files:**
- Create: `apps/site/src/lib/vsco/types.ts`
- Modify: `apps/site/.env.example`
- Modify: `apps/site/.gitignore`
- Modify: `apps/site/package.json` (only `scripts` section)

- [ ] **Step 1: Add env vars to `.env.example`**

Append to `apps/site/.env.example`:
```
# VSCO Workspace (Táve) API — see https://workspace.vsco.co/settings/api
VSCO_API_KEY=
VSCO_API_BASE=https://workspace.vsco.co/api/v2
VSCO_ENABLED=0
```

- [ ] **Step 2: Add `vsco-config.json` to `.gitignore`**

Append to `apps/site/.gitignore`:
```
vsco-config.json
```

- [ ] **Step 3: Add npm scripts**

In `apps/site/package.json` `"scripts"`, add:
```json
"vsco:bootstrap": "tsx scripts/vsco-bootstrap.ts",
"vsco:bootstrap:dry": "tsx scripts/vsco-bootstrap.ts --dry-run"
```

If `tsx` is not already in `devDependencies`, add it: `pnpm add -D tsx`.

- [ ] **Step 4: Write `apps/site/src/lib/vsco/types.ts`**

Hand-rolled types matching the OpenAPI spec — only the entities we actually use. Include:
- `MoneyAmount = number` (integer cents) with a branded type or just a documented number
- `ULID = string` (alias for clarity)
- `Phone = { e164: string }` (the API's phone object shape)
- `Address` (the API's address object)
- `Person`, `Company`, `Location` with discriminator `kind: 'person' | 'company' | 'location'`
- `CustomFieldValue = { fieldId: ULID; value: string | null }`
- `Job` (writable subset only; all readOnly fields omitted)
- `Event` (writable subset)
- `JobContact = { contactId: ULID; jobId?: ULID; client?: boolean; jobRoles?: ULID[] }`
- `JobWorksheet = Pick<Job, ...> & { contacts: { client?: boolean; contact: Person | Company | Location }[]; events?: Event[] }`
- `OrderItem` (writable subset, including recursive `children?: OrderItem[]`)
- `Order` (writable subset, including `dueDate: string | null`)
- `CustomField`, `LeadSource`, `LeadStatus`, `JobType`, `EventType`, `JobRole`
- `Collection<T>` generic wrapper for list endpoints (per OpenAPI: `{ items: T[]; total: number; pageSize: number; page: number }` — exact shape to be confirmed against spec, see Task 2 step 2)
- `VscoErrorBody = { type?: string; title?: string; detail?: string }` (RFC 7807-ish per spec's `Error` schema)

Don't import this file from anywhere yet — Task 2 will start using it.

- [ ] **Step 5: Commit**

```sh
git add apps/site/.env.example apps/site/.gitignore apps/site/package.json apps/site/src/lib/vsco/types.ts
git commit -m "feat(vsco): scaffold env vars, types, and npm scripts for VSCO Workspace integration"
```

---

## Task 2: VSCO API client (`client.ts`) — with retry, idempotency, and typed errors

**Files:**
- Create: `apps/site/src/lib/vsco/client.ts`
- Create: `apps/site/src/lib/vsco/__tests__/client.test.ts`

- [ ] **Step 1: Write the failing test for happy-path GET**

Create `apps/site/src/lib/vsco/__tests__/client.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { VscoClient } from '../client';

describe('VscoClient', () => {
  it('GETs with X-API-KEY header and parses JSON', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'abc' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const c = new VscoClient({ apiKey: 'k1', baseUrl: 'https://api.test', fetch: fakeFetch });
    const result = await c.get<{ id: string }>('/job/abc');
    expect(result).toEqual({ id: 'abc' });
    expect(fakeFetch).toHaveBeenCalledWith(
      'https://api.test/job/abc',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'X-API-KEY': 'k1', accept: 'application/json' }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
cd apps/site && pnpm vitest run src/lib/vsco/__tests__/client.test.ts
```
Expected: FAIL (cannot find module `../client`).

- [ ] **Step 3: Write minimal `client.ts` to pass**

Create `apps/site/src/lib/vsco/client.ts`:
```ts
export interface VscoClientOptions {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
  maxRetries?: number;
  retryBaseMs?: number;
}

export class VscoError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
    this.name = 'VscoError';
  }
}

export class VscoClient {
  private apiKey: string;
  private baseUrl: string;
  private fetchImpl: typeof fetch;
  private maxRetries: number;
  private retryBaseMs: number;

  constructor(opts: VscoClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.maxRetries = opts.maxRetries ?? 5;
    this.retryBaseMs = opts.retryBaseMs ?? 500;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : '/' + path}`;
    const headers: Record<string, string> = {
      'X-API-KEY': this.apiKey,
      accept: 'application/json',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const init: RequestInit = { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined };

    let attempt = 0;
    while (true) {
      const res = await this.fetchImpl(url, init);
      if (res.status === 429 && attempt < this.maxRetries) {
        const retryAfter = parseRetryAfter(res.headers.get('retry-after')) ?? this.retryBaseMs * Math.pow(2, attempt);
        await sleep(retryAfter);
        attempt++;
        continue;
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => undefined);
        throw new VscoError(res.status, errBody, `VSCO ${method} ${path} → ${res.status}`);
      }
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }
  }
}

function parseRetryAfter(h: string | null): number | null {
  if (!h) return null;
  const n = Number(h);
  if (!Number.isNaN(n)) return n * 1000;
  const dateMs = Date.parse(h);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
```

- [ ] **Step 4: Verify happy-path test passes**

```sh
cd apps/site && pnpm vitest run src/lib/vsco/__tests__/client.test.ts
```
Expected: PASS.

- [ ] **Step 5: Add failing test for 429 + Retry-After**

Append to `client.test.ts`:
```ts
it('retries on 429 honoring Retry-After (seconds)', async () => {
  const fakeFetch = vi.fn()
    .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '0' } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
  const c = new VscoClient({ apiKey: 'k', baseUrl: 'https://api.test', fetch: fakeFetch, retryBaseMs: 0 });
  const result = await c.get<{ ok: boolean }>('/x');
  expect(result).toEqual({ ok: true });
  expect(fakeFetch).toHaveBeenCalledTimes(2);
});

it('throws VscoError with body on 4xx', async () => {
  const fakeFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ title: 'Bad' }), { status: 400, headers: { 'content-type': 'application/json' } }));
  const c = new VscoClient({ apiKey: 'k', baseUrl: 'https://api.test', fetch: fakeFetch });
  await expect(c.get('/x')).rejects.toMatchObject({ name: 'VscoError', status: 400, body: { title: 'Bad' } });
});

it('POSTs with JSON body and content-type', async () => {
  const fakeFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: '1' }), { status: 201, headers: { 'content-type': 'application/json' } }));
  const c = new VscoClient({ apiKey: 'k', baseUrl: 'https://api.test', fetch: fakeFetch });
  await c.post('/job', { name: 'X' });
  expect(fakeFetch).toHaveBeenCalledWith('https://api.test/job', expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({ name: 'X' }),
    headers: expect.objectContaining({ 'content-type': 'application/json' }),
  }));
});
```

- [ ] **Step 6: Run all client tests**

```sh
cd apps/site && pnpm vitest run src/lib/vsco/__tests__/client.test.ts
```
Expected: all PASS.

- [ ] **Step 7: Commit**

```sh
git add apps/site/src/lib/vsco/client.ts apps/site/src/lib/vsco/__tests__/client.test.ts
git commit -m "feat(vsco): typed API client with 429/Retry-After backoff and VscoError"
```

---

## Task 3: Bootstrap script — creates lookups and custom fields, writes `vsco-config.json`

**Files:**
- Create: `apps/site/scripts/vsco-bootstrap.ts`
- Create: `apps/site/vsco-config.example.json`

This is the highest-leverage piece. Run it once, get back a config file we reference forever after.

- [ ] **Step 1: Write `vsco-config.example.json`**

```json
{
  "generatedAt": null,
  "leadSources": {
    "website-contact": null,
    "website-collection-smile": null,
    "website-collection-visionary": null,
    "website-collection-digital-atelier": null,
    "website-collection-aurora": null,
    "website-collection-resonance": null,
    "booth-expo": null,
    "referral": null,
    "other": null
  },
  "leadStatuses": {
    "new": null,
    "contacted": null,
    "qualified": null,
    "builder-sent": null,
    "proposal-sent": null,
    "booked": null,
    "lost": null
  },
  "jobTypes": {
    "wedding": null,
    "reception": null,
    "engagement-rehearsal": null,
    "corporate": null,
    "gala": null,
    "milestone": null,
    "other": null
  },
  "eventTypes": {
    "ceremony": null,
    "reception": null,
    "cocktail-hour": null,
    "rehearsal": null,
    "setup": null,
    "strike": null,
    "consultation": null
  },
  "jobRoles": {
    "one-of-the-couple": null,
    "planner": null,
    "family": null,
    "other-poc": null
  },
  "customFields": {
    "interested-smile": null,
    "interested-visionary": null,
    "interested-digital-atelier": null,
    "interested-aurora": null,
    "interested-resonance": null,
    "reserved-package": null,
    "event-setting": null,
    "consultation-preference": null,
    "builder-submission-link": null
  }
}
```

- [ ] **Step 2: Write `scripts/vsco-bootstrap.ts`**

The script does this, in order, transactionally per lookup type:

1. Load `.env` (`VSCO_API_KEY`, `VSCO_API_BASE`). Abort with helpful message if missing.
2. Construct `VscoClient`.
3. For each lookup category (LeadSource, LeadStatus, JobType, EventType, JobRole), `GET /lead-source` etc., build a `name → id` map.
4. For each desired entry in our schema (see step 1), if a matching name exists in the studio map, record the ID. Otherwise `POST` to create it and record the new ID.
5. For each Custom Field in the desired schema, `GET /custom-field` filtered by name; create with `POST /custom-field` if missing.
6. Print a summary table.
7. Write the resolved JSON to `apps/site/vsco-config.json`.

Definitions to encode in the script (the "desired state"):

```ts
const DESIRED_LEAD_SOURCES = [
  { key: 'website-contact',                  name: 'Website — Contact Form' },
  { key: 'website-collection-smile',         name: 'Website — Smile Collection' },
  { key: 'website-collection-visionary',     name: 'Website — Visionary Suite' },
  { key: 'website-collection-digital-atelier', name: 'Website — Digital Atelier' },
  { key: 'website-collection-aurora',        name: 'Website — Aurora Collection' },
  { key: 'website-collection-resonance',     name: 'Website — Resonance Series' },
  { key: 'booth-expo',                       name: 'Booth — Expo' },
  { key: 'referral',                         name: 'Referral' },
  { key: 'other',                            name: 'Other' },
];

const DESIRED_LEAD_STATUSES = [
  { key: 'new',            name: 'New',           kind: 'new' },
  { key: 'contacted',      name: 'Contacted',     kind: 'general' },
  { key: 'qualified',      name: 'Qualified',     kind: 'general' },
  { key: 'builder-sent',   name: 'Builder Sent',  kind: 'general' },
  { key: 'proposal-sent',  name: 'Proposal Sent', kind: 'general' },
  { key: 'booked',         name: 'Booked',        kind: 'general' },
  { key: 'lost',           name: 'Lost',          kind: 'general' },
];

const DESIRED_JOB_TYPES = [
  { key: 'wedding',              name: 'Wedding' },
  { key: 'reception',            name: 'Reception' },
  { key: 'engagement-rehearsal', name: 'Engagement / Rehearsal' },
  { key: 'corporate',            name: 'Corporate Event' },
  { key: 'gala',                 name: 'Gala' },
  { key: 'milestone',            name: 'Milestone Celebration' },
  { key: 'other',                name: 'Other' },
];

const DESIRED_EVENT_TYPES = [
  { key: 'ceremony',     name: 'Ceremony',     kind: 'session' },
  { key: 'reception',    name: 'Reception',    kind: 'session' },
  { key: 'cocktail-hour', name: 'Cocktail Hour', kind: 'session' },
  { key: 'rehearsal',    name: 'Rehearsal',    kind: 'session' },
  { key: 'setup',        name: 'Setup',        kind: 'other' },
  { key: 'strike',       name: 'Strike',       kind: 'other' },
  { key: 'consultation', name: 'Consultation', kind: 'meeting' },
];

const DESIRED_JOB_ROLES = [
  { key: 'one-of-the-couple', name: 'One of the Couple' },
  { key: 'planner',           name: 'Planner' },
  { key: 'family',            name: 'Family' },
  { key: 'other-poc',         name: 'Other Point of Contact' },
];

const DESIRED_CUSTOM_FIELDS = [
  { key: 'interested-smile',           name: 'Interested: Smile Booth',          canApplyTo: 'Job', kind: 'Checkbox' },
  { key: 'interested-visionary',       name: 'Interested: Visionary Video',      canApplyTo: 'Job', kind: 'Checkbox' },
  { key: 'interested-digital-atelier', name: 'Interested: Digital Atelier',      canApplyTo: 'Job', kind: 'Checkbox' },
  { key: 'interested-aurora',          name: 'Interested: Aurora Lighting',      canApplyTo: 'Job', kind: 'Checkbox' },
  { key: 'interested-resonance',       name: 'Interested: Resonance Sound',      canApplyTo: 'Job', kind: 'Checkbox' },
  { key: 'reserved-package',           name: 'Reserved Package',                 canApplyTo: 'Job', kind: 'DropDown',
    choices: ['Memory Booth', 'Mirror Me Experience', 'Mirror Me All Night'] },
  { key: 'event-setting',              name: 'Event Setting',                    canApplyTo: 'Job', kind: 'DropDown',
    choices: ['Indoor', 'Outdoor — Covered', 'Outdoor — Uncovered', 'Not sure yet'] },
  { key: 'consultation-preference',    name: 'Consultation Preference',          canApplyTo: 'Job', kind: 'DropDown',
    choices: ['Video', 'In-Person', 'None'] },
  { key: 'builder-submission-link',    name: 'Builder Submission Link',          canApplyTo: 'Job', kind: 'TextField' },
];
```

The script supports two CLI flags:
- `--dry-run`: list what would be created without writing anything.
- (no flag): write changes.

Output format: a clean, columnar table per category, marking `OK (existing)` or `CREATED ${id}`. Total summary at the bottom: "Resolved N entries — wrote vsco-config.json".

Behavior notes for the implementation:
- Use `pageSize=100` and (if needed) follow pagination on the list endpoints.
- For Lead Status, after creating, **skip configuring transitions** — those are UI-only details that depend on the studio's workflow.
- For Custom Field, the `kind` casing in the spec uses values like `TextField` / `DropDown` / `Checkbox` — use those exactly.
- If a creation 4xx's due to "name already exists", treat as success and try to look up the ID by re-fetching.
- Write `vsco-config.json` only at the end, atomically (`writeFileSync` to `vsco-config.json.tmp` then `renameSync`). On any thrown error, do not write the file.
- Print final message: `vsco-config.json written. You can now set VSCO_ENABLED=1 in your .env.`

- [ ] **Step 3: Run the dry-run against the live studio**

```sh
cd apps/site && pnpm vsco:bootstrap:dry
```
Expected: clean output listing every entry as either present or to-be-created. No file write.

- [ ] **Step 4: Run the real bootstrap**

```sh
cd apps/site && pnpm vsco:bootstrap
```
Expected: file `apps/site/vsco-config.json` written with all IDs populated (no `null` values remain except possibly `generatedAt` which becomes a timestamp).

- [ ] **Step 5: Sanity-check the file**

```sh
cd apps/site && cat vsco-config.json | python3 -m json.tool | head -40
```
Confirm every entry has an ID. Confirm `generatedAt` is an ISO timestamp.

- [ ] **Step 6: Commit**

Note: we commit only the script and the example file, NOT the generated `vsco-config.json`.

```sh
git add apps/site/scripts/vsco-bootstrap.ts apps/site/vsco-config.example.json
git commit -m "feat(vsco): bootstrap script for lookups and custom fields"
```

---

## Task 4: Config loader (`config.ts`) — typed accessors for `vsco-config.json`

**Files:**
- Create: `apps/site/src/lib/vsco/config.ts`
- Create: `apps/site/src/lib/vsco/__tests__/config.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { VscoConfig } from '../config';

describe('VscoConfig', () => {
  it('loads from object and returns typed IDs', () => {
    const cfg = new VscoConfig({
      generatedAt: '2026-05-12T00:00:00Z',
      leadSources: { 'website-contact': 'ls_1', 'booth-expo': 'ls_2', referral: null, 'other': null,
        'website-collection-smile': null, 'website-collection-visionary': null, 'website-collection-digital-atelier': null,
        'website-collection-aurora': null, 'website-collection-resonance': null },
      leadStatuses: { new: 'st_1', contacted: null, qualified: null, 'builder-sent': null, 'proposal-sent': null, booked: null, lost: null },
      jobTypes: { wedding: 'jt_1', reception: null, 'engagement-rehearsal': null, corporate: null, gala: null, milestone: null, other: null },
      eventTypes: { ceremony: 'et_1', reception: null, 'cocktail-hour': null, rehearsal: null, setup: null, strike: null, consultation: null },
      jobRoles: { 'one-of-the-couple': 'jr_1', planner: null, family: null, 'other-poc': null },
      customFields: { 'interested-smile': 'cf_1', 'interested-visionary': null, 'interested-digital-atelier': null,
        'interested-aurora': null, 'interested-resonance': null, 'reserved-package': null, 'event-setting': null,
        'consultation-preference': null, 'builder-submission-link': null },
    });
    expect(cfg.leadSourceId('website-contact')).toBe('ls_1');
    expect(cfg.leadStatusId('new')).toBe('st_1');
    expect(cfg.jobTypeId('wedding')).toBe('jt_1');
    expect(cfg.customFieldId('interested-smile')).toBe('cf_1');
  });

  it('throws a helpful error when accessing an unconfigured key', () => {
    const cfg = new VscoConfig({ /* all null */ } as any);
    expect(() => cfg.leadSourceId('booth-expo' as any)).toThrow(/booth-expo/);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```sh
cd apps/site && pnpm vitest run src/lib/vsco/__tests__/config.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `config.ts`**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type LeadSourceKey = 'website-contact' | 'website-collection-smile' | 'website-collection-visionary' |
  'website-collection-digital-atelier' | 'website-collection-aurora' | 'website-collection-resonance' |
  'booth-expo' | 'referral' | 'other';

export type LeadStatusKey = 'new' | 'contacted' | 'qualified' | 'builder-sent' | 'proposal-sent' | 'booked' | 'lost';

export type JobTypeKey = 'wedding' | 'reception' | 'engagement-rehearsal' | 'corporate' | 'gala' | 'milestone' | 'other';

export type EventTypeKey = 'ceremony' | 'reception' | 'cocktail-hour' | 'rehearsal' | 'setup' | 'strike' | 'consultation';

export type JobRoleKey = 'one-of-the-couple' | 'planner' | 'family' | 'other-poc';

export type CustomFieldKey = 'interested-smile' | 'interested-visionary' | 'interested-digital-atelier' |
  'interested-aurora' | 'interested-resonance' | 'reserved-package' | 'event-setting' |
  'consultation-preference' | 'builder-submission-link';

export interface VscoConfigShape {
  generatedAt: string | null;
  leadSources: Record<LeadSourceKey, string | null>;
  leadStatuses: Record<LeadStatusKey, string | null>;
  jobTypes: Record<JobTypeKey, string | null>;
  eventTypes: Record<EventTypeKey, string | null>;
  jobRoles: Record<JobRoleKey, string | null>;
  customFields: Record<CustomFieldKey, string | null>;
}

export class VscoConfig {
  constructor(private readonly data: VscoConfigShape) {}

  static loadFromDisk(path = resolve(process.cwd(), 'vsco-config.json')): VscoConfig {
    const raw = readFileSync(path, 'utf8');
    return new VscoConfig(JSON.parse(raw));
  }

  leadSourceId(k: LeadSourceKey): string {
    return required(this.data.leadSources[k], `leadSources.${k}`);
  }
  leadStatusId(k: LeadStatusKey): string {
    return required(this.data.leadStatuses[k], `leadStatuses.${k}`);
  }
  jobTypeId(k: JobTypeKey): string {
    return required(this.data.jobTypes[k], `jobTypes.${k}`);
  }
  eventTypeId(k: EventTypeKey): string {
    return required(this.data.eventTypes[k], `eventTypes.${k}`);
  }
  jobRoleId(k: JobRoleKey): string {
    return required(this.data.jobRoles[k], `jobRoles.${k}`);
  }
  customFieldId(k: CustomFieldKey): string {
    return required(this.data.customFields[k], `customFields.${k}`);
  }
}

function required(v: string | null | undefined, key: string): string {
  if (!v) throw new Error(`vsco-config.json is missing required ID for "${key}". Re-run \`pnpm vsco:bootstrap\`.`);
  return v;
}
```

- [ ] **Step 4: Verify tests pass**

```sh
cd apps/site && pnpm vitest run src/lib/vsco/__tests__/config.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add apps/site/src/lib/vsco/config.ts apps/site/src/lib/vsco/__tests__/config.test.ts
git commit -m "feat(vsco): typed config loader for resolved studio IDs"
```

---

## Task 5: Mapping layer — pure functions, no I/O

**Files:**
- Create: `apps/site/src/lib/vsco/mapping.ts`
- Create: `apps/site/src/lib/vsco/__tests__/mapping.test.ts`

The hardest task. Tests come first because the mapping is fiddly and the surface area is wide.

The mapping layer exports three functions:

```ts
inquiryToJobWorksheet(inquiry: InquiryRow, cfg: VscoConfig): JobWorksheet
builderToJobUpdate(builder: PackageBuilderSubmissionRow, currentJob: Job, cfg: VscoConfig): Partial<Job>
builderToOrder(builder: PackageBuilderSubmissionRow, recipientContactId: ULID, cfg: VscoConfig): Order
```

Each is pure and synchronous.

- [ ] **Step 1: Write failing test for `inquiryToJobWorksheet` — minimal short-form inquiry**

```ts
import { describe, it, expect } from 'vitest';
import { inquiryToJobWorksheet } from '../mapping';
import { VscoConfig } from '../config';

const cfg = new VscoConfig({
  generatedAt: '2026-05-12T00:00:00Z',
  leadSources: {
    'website-contact': 'ls_contact',
    'website-collection-smile': 'ls_smile',
    'website-collection-visionary': 'ls_visionary',
    'website-collection-digital-atelier': 'ls_da',
    'website-collection-aurora': 'ls_aurora',
    'website-collection-resonance': 'ls_resonance',
    'booth-expo': 'ls_booth', referral: 'ls_ref', other: 'ls_other',
  },
  leadStatuses: { new: 'st_new', contacted: 'st_c', qualified: 'st_q', 'builder-sent': 'st_bs',
    'proposal-sent': 'st_ps', booked: 'st_b', lost: 'st_l' },
  jobTypes: { wedding: 'jt_w', reception: 'jt_r', 'engagement-rehearsal': 'jt_er', corporate: 'jt_co',
    gala: 'jt_g', milestone: 'jt_m', other: 'jt_o' },
  eventTypes: { ceremony: 'et_c', reception: 'et_r', 'cocktail-hour': 'et_ch', rehearsal: 'et_reh',
    setup: 'et_s', strike: 'et_st', consultation: 'et_con' },
  jobRoles: { 'one-of-the-couple': 'jr_couple', planner: 'jr_p', family: 'jr_f', 'other-poc': 'jr_op' },
  customFields: { 'interested-smile': 'cf_is', 'interested-visionary': 'cf_iv', 'interested-digital-atelier': 'cf_ida',
    'interested-aurora': 'cf_iau', 'interested-resonance': 'cf_ir', 'reserved-package': 'cf_rp',
    'event-setting': 'cf_es', 'consultation-preference': 'cf_cp', 'builder-submission-link': 'cf_bsl' },
});

const baseInquiry = {
  id: 42,
  external_uuid: 'uuid-abc',
  source: 'collection-smile',
  created_at: '2026-05-12T14:30:00Z',
  first_name: 'Sarah', last_name: 'Beaumont',
  email: 'sarah@example.com', phone: '+15045551234',
  preferred_contact: 'Email',
  event_date: '2026-10-12',
  event_type: 'Wedding',
  venue: 'Ace Hotel New Orleans',
  guest_count: 140,
  event_start: null, event_end: null,
  planner: null,
  budget_range: '$15,000 — $25,000',
  message: 'Want jazz second-line + reception',
  referral: null,
  collections_interested: '["smile","visionary"]',
  collection_fields_json: JSON.stringify({ smile: { selected_package: 'mirror-me' } }),
  notes: null,
  partner1_name: null, partner2_name: null,
  event_setting: null,
  poc_relationship: null,
  status: 'new',
} as const;

describe('inquiryToJobWorksheet', () => {
  it('builds a Job + primary Person contact + venue Location for a short-form collection inquiry', () => {
    const ws = inquiryToJobWorksheet(baseInquiry as any, cfg);

    expect(ws.stage).toBe('lead');
    expect(ws.webLead).toBe(true);
    expect(ws.jobTypeId).toBe('jt_w');
    expect(ws.leadSourceId).toBe('ls_smile');
    expect(ws.leadStatusId).toBe('st_new');
    expect(ws.eventDate).toBe('2026-10-12');
    expect(ws.guestCount).toBe(140);
    expect(ws.inquiryDate).toBe('2026-05-12');
    expect(ws.leadMaxBudget).toBe(2500000); // upper bound of $15k-$25k bucket in cents

    expect(ws.externalMappings).toEqual([{ id: 'uuid-abc', url: expect.stringContaining('/admin/inquiries/42') }]);

    expect(ws.contacts).toHaveLength(2);
    expect(ws.contacts[0]).toMatchObject({
      client: true,
      contact: {
        kind: 'person',
        firstName: 'Sarah',
        lastName: 'Beaumont',
        email: 'sarah@example.com',
        cellPhone: { e164: '+15045551234' },
        contactPreference: 'Email',
      },
    });
    expect(ws.contacts[1]).toMatchObject({
      contact: { kind: 'location', name: 'Ace Hotel New Orleans' },
    });

    expect(ws.customFields).toEqual(expect.arrayContaining([
      { fieldId: 'cf_is', value: 'true' },
      { fieldId: 'cf_iv', value: 'true' },
      { fieldId: 'cf_rp', value: 'Mirror Me Experience' },
    ]));
  });

  it('omits venue contact when venue is null', () => {
    const inq = { ...baseInquiry, venue: null } as any;
    const ws = inquiryToJobWorksheet(inq, cfg);
    expect(ws.contacts).toHaveLength(1);
  });

  it('uses booth-expo lead source and adds POC role for booth submissions', () => {
    const inq = {
      ...baseInquiry,
      source: 'booth-expo',
      partner1_name: 'Alex Doe', partner2_name: 'Jamie Doe',
      poc_relationship: 'Planner',
      event_setting: 'Outdoor — Covered',
    } as any;
    const ws = inquiryToJobWorksheet(inq, cfg);
    expect(ws.leadSourceId).toBe('ls_booth');
    // Partner 2 becomes a second client contact
    expect(ws.contacts.filter(c => c.contact.kind === 'person')).toHaveLength(2);
    // Event setting custom field is set
    expect(ws.customFields).toEqual(expect.arrayContaining([
      { fieldId: 'cf_es', value: 'Outdoor — Covered' },
    ]));
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module not found)

```sh
cd apps/site && pnpm vitest run src/lib/vsco/__tests__/mapping.test.ts
```

- [ ] **Step 3: Implement `inquiryToJobWorksheet`**

Create `apps/site/src/lib/vsco/mapping.ts` with at minimum:

```ts
import type { VscoConfig, LeadSourceKey, JobTypeKey } from './config';
import type { JobWorksheet, Job, OrderItem, Order, Person, Location } from './types';

const SITE_BASE_URL = process.env.SITE_PUBLIC_URL ?? 'https://smilenola.com';

// Map your event_type strings to JobType keys
const EVENT_TYPE_TO_JOB_TYPE: Record<string, JobTypeKey> = {
  'Wedding': 'wedding',
  'Reception': 'reception',
  'Engagement / Rehearsal': 'engagement-rehearsal',
  'Engagement/Rehearsal': 'engagement-rehearsal',
  'Corporate': 'corporate',
  'Gala': 'gala',
  'Milestone': 'milestone',
  'Other': 'other',
};

// Map source strings to LeadSource keys
function leadSourceKeyFromSource(source: string): LeadSourceKey {
  if (source === 'contact') return 'website-contact';
  if (source === 'booth-expo') return 'booth-expo';
  if (source.startsWith('collection-smile'))            return 'website-collection-smile';
  if (source.startsWith('collection-visionary'))        return 'website-collection-visionary';
  if (source.startsWith('collection-digital-atelier'))  return 'website-collection-digital-atelier';
  if (source.startsWith('collection-aurora'))           return 'website-collection-aurora';
  if (source.startsWith('collection-resonance'))        return 'website-collection-resonance';
  return 'other';
}

// Budget bucket → upper bound in cents. "$15,000 — $25,000" → 2500000
function budgetRangeToMaxCents(s: string | null): number | undefined {
  if (!s) return undefined;
  const matches = [...s.matchAll(/\$([\d,]+)k?/gi)];
  if (matches.length === 0) return undefined;
  // Take the last (highest) dollar value, strip commas, multiply by 100
  const last = matches[matches.length - 1][1].replace(/,/g, '');
  const n = Number(last);
  if (Number.isNaN(n)) return undefined;
  return n * 100;
}

const RESERVED_PACKAGE_DISPLAY: Record<string, string> = {
  'memory':              'Memory Booth',
  'memory-booth':        'Memory Booth',
  'mirror':              'Mirror Me Experience',
  'mirror-me':           'Mirror Me Experience',
  'mirror-all-night':    'Mirror Me All Night',
  'mirror-me-all-night': 'Mirror Me All Night',
};

export function inquiryToJobWorksheet(inq: InquiryRow, cfg: VscoConfig): JobWorksheet {
  // ... implementation per the test expectations
}
```

Then implement the function to satisfy the tests. The implementation must:
- Set `stage: 'lead'`
- Set `webLead = source !== 'booth-expo'`
- Look up `jobTypeId` via `EVENT_TYPE_TO_JOB_TYPE[inq.event_type] ?? 'other'`
- Look up `leadSourceId` via `leadSourceKeyFromSource(inq.source)`
- Set `leadStatusId = cfg.leadStatusId('new')`
- Convert `event_date` (YYYY-MM-DD) directly; truncate `created_at` to date for `inquiryDate`
- Build `leadMaxBudget` from `budgetRangeToMaxCents(budget_range)` only when present
- Build `leadNotes` by concatenating `message`, `notes`, and a "--- Collection details ---" block parsing `collection_fields_json`
- Build `externalMappings` with `id = external_uuid` and `url = ${SITE_BASE_URL}/admin/inquiries/${id}`
- Build the primary `Person` contact from `first_name`/`last_name` (or booth `partner1_name` split into first/last on first space) — `client: true`
- For booth: if `partner2_name` present, build a second `Person` contact, also `client: true`. Split on first space; if no space, put it all in `firstName`
- For all sources: if `venue` non-null and non-empty, append a `Location` contact `{ kind: 'location', name: venue }` (NOT marked `client`)
- Build `customFields[]` containing:
  - One `{ fieldId: cfg.customFieldId('interested-smile'), value: 'true' }` entry for each interested collection (parse `collections_interested` JSON array)
  - Reserved package: parse `collection_fields_json`, find any `selected_package` value, look up via `RESERVED_PACKAGE_DISPLAY`, write to `cf.reserved-package` only if a match
  - `event_setting` → `cf.event-setting`
  - Consultation preference comes from builder, not inquiry — skip here
  - Builder submission link — only set during builder push, not inquiry

- [ ] **Step 4: Verify the inquiry test passes**

```sh
cd apps/site && pnpm vitest run src/lib/vsco/__tests__/mapping.test.ts
```
Expected: all `inquiryToJobWorksheet` tests PASS.

- [ ] **Step 5: Add failing test for `builderToOrder`**

```ts
import { builderToOrder } from '../mapping';

const baseBuilder = {
  id: 7,
  created_at: '2026-05-13T10:00:00Z',
  status: 'new',
  source: 'cold-builder',
  first_name: 'Sarah', last_name: 'Beaumont',
  email: 'sarah@example.com', phone: '+15045551234',
  inquiry_id: 42,
  invite_token: null,
  event_date: '2026-10-12',
  event_type: 'Wedding',
  venue: 'Ace Hotel New Orleans',
  guest_count: 140,
  consultation_pref: 'video',
  client_note: 'Allergic to oysters',
  selections_json: JSON.stringify({
    collections: ['smile', 'aurora'],
    packages: [
      { collectionId: 'smile', packageId: 'mirror-me' },
    ],
    addons: [
      { collectionId: 'smile', addonId: 'audio-guest-book', qty: 1 },
      { collectionId: 'aurora', addonId: 'uplighting-apelabs', qty: 8 },
    ],
  }),
  fixed_subtotal_cents: 89500 + 27500 + 8 * 5000,
  custom_quoted_json: null,
  warnings_json: null,
  notes: null,
} as const;

describe('builderToOrder', () => {
  it('builds an Order with nested children for each selected package + add-ons', () => {
    const order = builderToOrder(baseBuilder as any, 'contact_sarah', cfg);
    expect(order.recipientId).toBe('contact_sarah');
    expect(order.name).toContain('Beaumont');
    expect(order.dueDate).toBeTruthy(); // 14 days from created_at by default

    // Smile collection package becomes a parent line item with the audio guest book as a child
    const smilePkg = order.lineItems!.find(li => li.name?.includes('Mirror Me Experience'));
    expect(smilePkg).toBeDefined();
    expect(smilePkg!.pricePerUnit).toBe(89500);
    expect(smilePkg!.children).toContainEqual(expect.objectContaining({
      name: 'Audio Guest Book — Cherish the Beep',
      pricePerUnit: 27500,
      units: 1,
    }));

    // Aurora addons (no package) appear as top-level line items
    expect(order.lineItems!.find(li => li.name?.includes('ApeLabs Wireless Uplighting'))).toMatchObject({
      pricePerUnit: 5000, units: 8,
    });
  });

  it('marks custom-quoted items with units=1 and price 0 plus a clear name', () => {
    const builder = { ...baseBuilder,
      selections_json: JSON.stringify({
        collections: ['visionary'],
        packages: [{ collectionId: 'visionary', packageId: 'visionary-highlight' }],
        addons: [{ collectionId: 'visionary', addonId: 'visionary-travel', qty: 1 }],
      }),
    } as any;
    const order = builderToOrder(builder, 'contact_x', cfg);
    const travel = order.lineItems!.flatMap(li => [li, ...(li.children ?? [])]).find(li => li.name?.includes('Travel Fee'));
    expect(travel).toBeDefined();
    expect(travel!.pricePerUnit).toBe(0);
    expect(travel!.name).toMatch(/Travel Fee — quoted separately/);
  });
});
```

- [ ] **Step 6: Implement `builderToOrder`**

The function:
- Parses `selections_json`
- For each `collections[]` entry, finds packages and addons that belong to that collection
- Looks up names/prices from `apps/site/src/lib/builder/catalog.ts` via the existing `getCollection`, `getPackage`, `getAddon` helpers
- If the collection has a package selected, builds an `OrderItem` for the package with the matching addons as `children[]`
- If the collection has addons but no package (e.g. Aurora, Resonance ceremony-only), builds top-level `OrderItem` per addon
- Add-ons with `priceType === 'custom'` get `pricePerUnit: 0` and a name suffix `" — quoted separately"`
- All line items: `taxable: true`, `selected: true`, `selectability: 'optional'` (or `'required'` for the primary package)
- `name: \`${builder.event_type ?? 'Event'} — \${first_name} \${last_name} — Booking Proposal\``
- `dueDate`: 14 days after `builder.created_at` (configurable later)
- `recipientId`: the passed-in contact ID

- [ ] **Step 7: Verify all mapping tests pass**

```sh
cd apps/site && pnpm vitest run src/lib/vsco/__tests__/mapping.test.ts
```
Expected: all PASS.

- [ ] **Step 8: Add failing test for `builderToJobUpdate`**

```ts
import { builderToJobUpdate } from '../mapping';

describe('builderToJobUpdate', () => {
  it('refines event details on an existing job from the builder submission', () => {
    const currentJob = { id: 'job_42', externalMappings: [{ id: 'uuid-abc' }] } as any;
    const update = builderToJobUpdate(baseBuilder as any, currentJob, cfg);
    expect(update.eventDate).toBe('2026-10-12');
    expect(update.guestCount).toBe(140);
    expect(update.leadStatusId).toBe('st_bs'); // builder-sent
    expect(update.customFields).toEqual(expect.arrayContaining([
      { fieldId: 'cf_cp', value: 'Video' },
      { fieldId: 'cf_bsl', value: expect.stringContaining(`/admin/builder/7`) },
    ]));
    expect(update.leadNotes).toContain('Allergic to oysters');
  });
});
```

Implement to match. Note: this is partial update — only fields we're refining are returned.

- [ ] **Step 9: All mapping tests green**

```sh
cd apps/site && pnpm vitest run src/lib/vsco/__tests__/mapping.test.ts
```
Expected: PASS.

- [ ] **Step 10: Commit**

```sh
git add apps/site/src/lib/vsco/mapping.ts apps/site/src/lib/vsco/__tests__/mapping.test.ts
git commit -m "feat(vsco): mapping functions inquiryToJobWorksheet, builderToOrder, builderToJobUpdate"
```

---

## Task 6: SQLite schema migration — qualified flag + audit/mapping tables

**Files:**
- Modify: `apps/site/src/lib/db.ts`
- Create: `apps/site/src/lib/__tests__/db-vsco.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, recordVscoEntities, getVscoEntities, recordVscoPush, markInquiryQualified } from '../db';

describe('VSCO db helpers', () => {
  beforeEach(() => {
    // assume a test-DB fixture
  });

  it('records and retrieves VSCO entity mappings by external_uuid', () => {
    recordVscoEntities('uuid-abc', { jobId: 'job_1', primaryContactId: 'p_1' });
    const e = getVscoEntities('uuid-abc');
    expect(e?.jobId).toBe('job_1');
    expect(e?.primaryContactId).toBe('p_1');
  });

  it('records a push log row', () => {
    recordVscoPush({ inquiryId: 42, kind: 'inquiry', status: 'ok', responseBody: { id: 'job_1' } });
    // verify by querying directly
  });

  it('marks an inquiry qualified', () => {
    // assume an inquiry exists with id 42
    const r = markInquiryQualified(42);
    expect(r.qualified_at).toBeTruthy();
  });
});
```

- [ ] **Step 2: Migrate the schema**

In `apps/site/src/lib/db.ts`'s `bootstrapSchema` (and add a `migrateAddVscoTables()` migration function that runs after the existing migrations), add:

```sql
ALTER TABLE inquiries ADD COLUMN qualified_at TEXT;

CREATE TABLE IF NOT EXISTS vsco_entities (
  external_uuid TEXT PRIMARY KEY,
  job_id TEXT,
  primary_contact_id TEXT,
  secondary_contact_id TEXT,
  venue_id TEXT,
  order_id TEXT,
  invoice_id TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS vsco_pushes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  kind TEXT NOT NULL CHECK (kind IN ('inquiry','builder','qualify')),
  inquiry_id INTEGER,
  builder_id INTEGER,
  external_uuid TEXT,
  status TEXT NOT NULL CHECK (status IN ('ok','error','skipped')),
  http_status INTEGER,
  request_summary TEXT,
  response_body TEXT,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_vsco_pushes_inquiry ON vsco_pushes(inquiry_id);
CREATE INDEX IF NOT EXISTS idx_vsco_pushes_status_created ON vsco_pushes(status, created_at);
```

- [ ] **Step 3: Add the helper functions**

In `db.ts`, add and export:

```ts
export interface VscoEntities {
  jobId?: string; primaryContactId?: string; secondaryContactId?: string;
  venueId?: string; orderId?: string; invoiceId?: string;
}
export function recordVscoEntities(externalUuid: string, e: VscoEntities): void { /* upsert */ }
export function getVscoEntities(externalUuid: string): VscoEntities | null { /* select */ }
export function recordVscoPush(args: {
  kind: 'inquiry'|'builder'|'qualify';
  inquiryId?: number; builderId?: number; externalUuid?: string;
  status: 'ok'|'error'|'skipped';
  httpStatus?: number; requestSummary?: string;
  responseBody?: unknown; errorMessage?: string;
}): void { /* insert */ }
export function markInquiryQualified(id: number): { qualified_at: string } { /* update + return */ }
```

- [ ] **Step 4: All tests pass**

```sh
cd apps/site && pnpm vitest run src/lib/__tests__/db-vsco.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add apps/site/src/lib/db.ts apps/site/src/lib/__tests__/db-vsco.test.ts
git commit -m "feat(vsco): db migration for qualified_at and vsco_entities/vsco_pushes audit tables"
```

---

## Task 7: Push layer (`push.ts`) — orchestrate API calls and persist results

**Files:**
- Create: `apps/site/src/lib/vsco/push.ts`
- Create: `apps/site/src/lib/vsco/index.ts`
- Create: `apps/site/src/lib/vsco/__tests__/push.test.ts`

- [ ] **Step 1: Write failing test for `pushInquiryToVsco`**

Mock the client (`vi.mock('./client')`) and verify:
1. When `VSCO_ENABLED !== '1'`, the function logs a `skipped` push and returns without calling the client.
2. When enabled, it calls `POST /job/-/worksheet` with the mapped body, records `vsco_entities` with the returned `jobId` + contact IDs, and writes an `ok` push log.
3. On `VscoError`, it writes an `error` push log and does NOT throw (fire-and-forget).
4. On any other thrown error, same: writes `error` push log, does not throw.

- [ ] **Step 2: Implement `push.ts`**

```ts
import { VscoClient, VscoError } from './client';
import { VscoConfig } from './config';
import { inquiryToJobWorksheet, builderToOrder, builderToJobUpdate } from './mapping';
import { recordVscoEntities, recordVscoPush, getVscoEntities } from '../db';
import type { InquiryRow, PackageBuilderSubmissionRow } from '../types'; // adjust import

let _client: VscoClient | null = null;
let _config: VscoConfig | null = null;

function getClient(): VscoClient | null {
  if (process.env.VSCO_ENABLED !== '1') return null;
  if (!_client) {
    const apiKey = process.env.VSCO_API_KEY;
    const baseUrl = process.env.VSCO_API_BASE ?? 'https://workspace.vsco.co/api/v2';
    if (!apiKey) return null;
    _client = new VscoClient({ apiKey, baseUrl });
  }
  return _client;
}

function getConfig(): VscoConfig | null {
  if (!_config) {
    try { _config = VscoConfig.loadFromDisk(); } catch { return null; }
  }
  return _config;
}

export async function pushInquiryToVsco(inq: InquiryRow): Promise<void> {
  const client = getClient();
  const cfg = getConfig();
  if (!client || !cfg) {
    recordVscoPush({ kind: 'inquiry', inquiryId: inq.id, externalUuid: inq.external_uuid ?? undefined,
      status: 'skipped', errorMessage: client ? 'no config' : 'disabled' });
    return;
  }
  try {
    const worksheet = inquiryToJobWorksheet(inq, cfg);
    const result = await client.post<JobWorksheetResponse>('/job/-/worksheet', worksheet);
    // Extract IDs from response shape (need to verify in real call — Task 8 validates this)
    recordVscoEntities(inq.external_uuid!, {
      jobId: result.job?.id,
      primaryContactId: result.contacts?.[0]?.id,
      secondaryContactId: result.contacts?.[1]?.id, // booth couples only
      venueId: result.contacts?.find(c => c.kind === 'location')?.id,
    });
    recordVscoPush({ kind: 'inquiry', inquiryId: inq.id, externalUuid: inq.external_uuid ?? undefined,
      status: 'ok', responseBody: { jobId: result.job?.id } });
  } catch (err) {
    const status = err instanceof VscoError ? err.status : undefined;
    const body = err instanceof VscoError ? err.body : undefined;
    const msg = err instanceof Error ? err.message : String(err);
    recordVscoPush({ kind: 'inquiry', inquiryId: inq.id, externalUuid: inq.external_uuid ?? undefined,
      status: 'error', httpStatus: status, responseBody: body, errorMessage: msg });
    // never re-throw
  }
}

export async function pushBuilderToVsco(b: PackageBuilderSubmissionRow): Promise<void> {
  // Similar pattern:
  // 1. Look up the inquiry's external_uuid via b.inquiry_id; if absent, log skipped and bail
  // 2. Look up vsco_entities by external_uuid; if no jobId, log skipped (inquiry never pushed) and bail
  // 3. GET /job/{jobId} → current Job
  // 4. PUT /job/{jobId} with builderToJobUpdate(b, currentJob, cfg) merged into current
  // 5. POST /job/{jobId}/order with builderToOrder(b, primaryContactId, cfg)
  // 6. Record entities.orderId, write ok push
  // 7. On error: write error push, never throw
}

export async function pushQualifiedToVsco(inq: InquiryRow): Promise<void> {
  // 1. Look up vsco_entities; if no jobId, attempt to push inquiry first
  // 2. PUT /job/{jobId} with { leadStatusId: cfg.leadStatusId('qualified'), bookingDate: today }
  // 3. Write push log
}
```

- [ ] **Step 3: Implement `index.ts`**

```ts
export { pushInquiryToVsco, pushBuilderToVsco, pushQualifiedToVsco } from './push';
```

- [ ] **Step 4: All push tests pass**

```sh
cd apps/site && pnpm vitest run src/lib/vsco/__tests__/push.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add apps/site/src/lib/vsco/push.ts apps/site/src/lib/vsco/index.ts apps/site/src/lib/vsco/__tests__/push.test.ts
git commit -m "feat(vsco): push layer for inquiry, builder, and qualify flows"
```

---

## Task 8: Wire pushes into the existing API routes

**Files:**
- Modify: `apps/site/src/pages/api/inquiry.ts`
- Modify: `apps/site/src/pages/api/contact.ts`
- Modify: `apps/site/src/pages/api/sync/inquiries.ts`
- Modify: `apps/site/src/pages/api/package-builder.ts`

Each addition is the same 3-line pattern — fire-and-forget, never block the response, never throw.

- [ ] **Step 1: Add to `api/inquiry.ts` after Resend send**

Find the `sendInquiryNotification(row).catch(...)` line. Add immediately below:
```ts
import { pushInquiryToVsco } from '../../lib/vsco';
// ...
pushInquiryToVsco(row).catch(err => console.error('[vsco] inquiry push failed:', err));
```

- [ ] **Step 2: Same in `api/contact.ts`**

- [ ] **Step 3: Same in `api/sync/inquiries.ts`** (only for fresh inserts — the existing code already detects `inserted` vs duplicate)

- [ ] **Step 4: Add to `api/package-builder.ts`**

```ts
import { pushBuilderToVsco } from '../../lib/vsco';
// after sendBuilderSubmissionNotification call:
pushBuilderToVsco(submission).catch(err => console.error('[vsco] builder push failed:', err));
```

- [ ] **Step 5: Smoke test with `VSCO_ENABLED=0`**

Submit one of each form locally. Verify:
- Forms still respond normally and write to SQLite.
- `vsco_pushes` table has a `skipped` row for each.
- No errors in the dev console.

- [ ] **Step 6: Smoke test with `VSCO_ENABLED=1`**

Submit one inquiry, one builder. Verify:
- A `job` appears in the Workspace UI under https://workspace.vsco.co
- The contact, venue, event date, custom fields are all set
- A subsequent builder submission updates the same job and creates an order

- [ ] **Step 7: Commit**

```sh
git add apps/site/src/pages/api/inquiry.ts apps/site/src/pages/api/contact.ts apps/site/src/pages/api/sync/inquiries.ts apps/site/src/pages/api/package-builder.ts
git commit -m "feat(vsco): wire VSCO pushes into all four form endpoints"
```

---

## Task 9: Admin "Mark Qualified" button + endpoint

**Files:**
- Create: `apps/site/src/pages/api/admin/inquiries/[id]/qualify.ts`
- Modify: `apps/site/src/pages/admin/inquiries/[id].astro` (or wherever the inquiry detail page lives — check actual path)

- [ ] **Step 1: Find the actual inquiry detail page**

```sh
ls apps/site/src/pages/admin/ && grep -l "inquiry" apps/site/src/pages/admin/*.astro
```

- [ ] **Step 2: Create the qualify endpoint**

`apps/site/src/pages/api/admin/inquiries/[id]/qualify.ts`:
```ts
import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/auth';
import { getInquiry, markInquiryQualified } from '../../../../lib/db';
import { pushQualifiedToVsco } from '../../../../lib/vsco';

export const POST: APIRoute = async (ctx) => {
  await requireAdmin(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) return new Response('bad id', { status: 400 });
  const inq = getInquiry(id);
  if (!inq) return new Response('not found', { status: 404 });
  if (inq.qualified_at) return new Response(JSON.stringify({ ok: true, alreadyQualified: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  const result = markInquiryQualified(id);
  pushQualifiedToVsco({ ...inq, qualified_at: result.qualified_at }).catch(err => console.error('[vsco] qualify push failed:', err));
  return new Response(JSON.stringify({ ok: true, qualified_at: result.qualified_at }), { status: 200, headers: { 'content-type': 'application/json' } });
};
```

- [ ] **Step 3: Add the button to the admin page**

In the detail page, add a button that:
- Renders disabled with label "Already qualified — VSCO is source of truth" if `inquiry.qualified_at` is set
- Otherwise renders enabled with label "Mark as Qualified → VSCO source of truth"
- On click, `fetch('/api/admin/inquiries/' + id + '/qualify', { method: 'POST' })`; on success, reload the page

- [ ] **Step 4: Manual smoke test**

In the admin, find an inquiry, click "Mark as Qualified", verify:
- The button now shows "Already qualified"
- `qualified_at` is set in the DB
- A `qualify` row was written to `vsco_pushes`
- In Workspace, the corresponding job now has `leadStatusId` = Qualified

- [ ] **Step 5: Commit**

```sh
git add apps/site/src/pages/api/admin/inquiries/ apps/site/src/pages/admin/
git commit -m "feat(vsco): admin qualify button to hand off source-of-truth to VSCO"
```

---

## Task 10: End-to-end smoke test, docs, and feature flag dark-launch

- [ ] **Step 1: With `VSCO_ENABLED=0` deployed**

Confirm in production logs that `skipped` rows appear in `vsco_pushes` for every fresh inquiry, contact, builder, and qualify action. Confirm forms still work as before.

- [ ] **Step 2: Configure VSCO Automations in the Workspace UI**

This is a one-time manual UI step inside Workspace. Configure:
- When an Order is created on a Job in stage `lead` → send the invoice email to the recipient
- Optional: when a Job's leadStatusId changes to `qualified` → notify via Slack/email internally

This is the workaround for the "no API to send invoice" gap. **Test it by manually creating an Order in the UI on a test job and confirming the email goes out** before flipping the flag in production.

- [ ] **Step 3: Flip `VSCO_ENABLED=1` in production**

- [ ] **Step 4: Verify in production**

After the next real inquiry:
- Job appears in Workspace with all fields populated
- `vsco_pushes` row is `ok` with the new `jobId` in the response body

After the next real builder submission:
- Same Job is updated
- Order is created
- Workspace Automation sends the invoice email

- [ ] **Step 5: Write a short operational doc**

Create `apps/site/src/lib/vsco/README.md` covering:
- How to re-run the bootstrap (when adding new custom fields)
- How to disable in an emergency (`VSCO_ENABLED=0`)
- How to inspect `vsco_pushes` to debug a failed push
- How to manually retry a failed push (admin endpoint TBD if needed)

- [ ] **Step 6: Commit and tag**

```sh
git add apps/site/src/lib/vsco/README.md
git commit -m "docs(vsco): operational runbook"
git tag vsco-integration-v1
```

---

## Out of scope for this plan (future work)

- **Pulling VSCO updates back into SQLite for display.** Possible via Rest Hooks (`order.booked`, `payment.created`) — a separate plan.
- **Products catalog sync.** Documented as unnecessary above.
- **Retry queue for failed pushes.** Today: log to `vsco_pushes` with `status='error'`; admin can re-run by hand. A background drainer is a separate small project.
- **Schedulers (consultations booked via VSCO).** Private beta; requires explicit grants.
- **Two-way job edit sync.** No `job.updated` webhook exists; explicitly deferred.
