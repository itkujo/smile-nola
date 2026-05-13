# VSCO Workspace Integration

How Smile NOLA mirrors leads, projects, and orders into VSCO Workspace
(formerly Táve) via the OpenAPI v2 endpoints at
`https://workspace.vsco.co/api/v2`.

## Architecture

```
Inquiry forms (site + booth)
        │
        ▼  insertInquiry() with crypto.randomUUID() external_uuid
   SQLite `inquiries` table
        │
        ▼  Admin presses "Mark Qualified" in /admin/inquiries/<id>
   inquiries.qualified_at = CURRENT_TIMESTAMP
        │
        ▼  pushQualifiedToVsco() — fire-and-forget
   POST /job/-/worksheet
   creates Job + Contacts + Event atomically
        │
        ▼  records IDs in vsco_entities
        ▼  audit row in vsco_pushes

Builder submission (qualified inquiry only)
        │
        ▼  pushBuilderToVsco() — fire-and-forget
   GET /job/<id>     (read)
   PUT /job/<id>     (refined event details, lead status -> sent-quote)
   POST /job/<id>/order  (line items + dueDate -> auto-invoice)
        │
        ▼  records order ID in vsco_entities
        ▼  audit row in vsco_pushes
```

## Source of truth

- **Pre-qualification**: SQLite is canonical. Forms write here directly; no
  VSCO traffic. The marketing site, booth iPad, and admin all read from this
  database.
- **Post-qualification**: SQLite + VSCO. The admin Mark Qualified button
  is the handoff point. After that, both systems are kept in sync via
  fire-and-forget push calls from API routes.

## What lives where

| Layer | File | Purpose |
| --- | --- | --- |
| Types | `apps/site/src/lib/vsco/types.ts` | Hand-rolled TS types for Job, Contact, Order, etc. — only the fields we read or write. |
| API client | `apps/site/src/lib/vsco/client.ts` | Tiny `fetch` wrapper, `X-API-KEY` header, 429 retry honoring Retry-After. |
| Config | `apps/site/src/lib/vsco/config.ts` | Loads `vsco-config.json`, typed accessors. |
| Mapping | `apps/site/src/lib/vsco/mappings.ts` | Pure functions InquiryRow / BuilderSubmissionRow → API bodies. |
| Push | `apps/site/src/lib/vsco/push.ts` | Orchestration: gating, idempotency, audit logging. |
| Bootstrap | `apps/site/scripts/vsco-bootstrap.ts` | One-shot script that names Job Types, creates custom fields, etc. |
| Schema | `apps/site/src/lib/db.ts` | `qualified_at`, `vsco_entities`, `vsco_pushes` migrations + helpers. |
| Admin UI | `apps/site/src/pages/admin/inquiries/[id].astro` | Mark Qualified button + sync history. |
| Qualify API | `apps/site/src/pages/api/admin/inquiries/[id]/qualify.ts` | The button's POST endpoint. |

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `VSCO_API_KEY` | yes | — | Per-studio API key from https://workspace.vsco.co/settings/api |
| `VSCO_API_BASE` | no | `https://workspace.vsco.co/api/v2` | Override only if VSCO publishes a new base URL. The legacy `tave.io/v2` works but is unsupported. |
| `VSCO_ENABLED` | yes | `0` (off) | Master kill switch. Set to `1`, `true`, `yes`, or `on` to allow outbound API calls. Until then, every push records a "skipped" audit row and returns without making any network calls. |
| `SITE_PUBLIC_URL` | yes | `https://smilenola.com` | Public origin used in admin URLs included as `externalMappings.url`. |
| `VSCO_CONFIG_PATH` | no | `<cwd>/vsco-config.json` | Override the config file path (handy for tests / CI). |

The API key is stored in `apps/site/.env` (gitignored). In production it
goes in Coolify's environment variable UI for the site app.

## First-time setup

1. **Get the API key**. https://workspace.vsco.co/settings/api → create a key
   with at least read + write scopes. Paste into `apps/site/.env`:
   ```env
   VSCO_API_KEY=...
   VSCO_API_BASE=https://workspace.vsco.co/api/v2
   VSCO_ENABLED=0
   SITE_PUBLIC_URL=https://smilenola.com
   ```

2. **Bootstrap the studio**. From `apps/site/`:
   ```sh
   pnpm vsco:bootstrap:dry      # preview only — no live writes
   pnpm vsco:bootstrap           # apply: rename job types, create custom fields, etc.
   ```
   This populates `apps/site/vsco-config.json` (gitignored) with the
   resolved ULIDs. The script is idempotent — re-running on an already
   configured studio is a no-op.

3. **Configure invoice automation in the VSCO UI**. The API generates
   invoices via `Order.dueDate` but does NOT email them. Set up a
   Workspace Automation that emails the invoice when a new Order is
   created in `lead status = sent-quote` (or whatever trigger you prefer).

4. **Configure a Tax Group** in the VSCO UI if you want sales tax on
   invoices. The bootstrap script warns if no Tax Group is configured —
   it's not blocking but invoices will have no tax until you create one.

5. **Flip the master switch**. After verifying everything by qualifying
   a test inquiry with `VSCO_ENABLED=0` (which records a "skipped" audit
   row but creates no VSCO data), set `VSCO_ENABLED=1` and re-deploy.

## Smoke test (read-only)

Verify your config + API key work before flipping the switch:

```sh
cd apps/site
node --experimental-strip-types -e "
import('./src/lib/vsco/client.ts').then(async ({ VscoClient }) => {
  const c = new VscoClient({
    apiKey: process.env.VSCO_API_KEY,
    baseUrl: process.env.VSCO_API_BASE || 'https://workspace.vsco.co/api/v2',
  });
  const lookups = await c.get('/lead-source?pageSize=5');
  console.log('OK', lookups.meta);
});
"
```

If you get a `VscoError: 401`, the API key is invalid or missing scopes.
If you get a network error, the workstation can't reach VSCO.

## End-to-end smoke (writes data — use a test inquiry)

1. Submit a test inquiry through `/contact` or `/collections/smile`.
2. Visit `/admin/inquiries/<new-id>`.
3. Confirm the "VSCO Workspace" section shows "Not yet qualified".
4. Click **Mark Qualified**. The page reloads after ~1.5s.
5. Refresh the sync history `<details>` block; you should see one
   `ok` entry with `inquiry-create` trigger.
6. In VSCO Workspace, navigate to Jobs and confirm the Job exists with
   the inquiry's name + the right Lead Source.
7. (Optional) Submit a builder proposal pointed at that inquiry. After
   submission the sync history should show a second `ok` entry with
   `builder-create` trigger, and Workspace should show a new Order
   attached to the Job.

## Failure modes

All failures are recorded in `vsco_pushes` and never propagate to the
client. Common cases:

| Verdict | Cause | Where to look |
| --- | --- | --- |
| `skipped` + `notes: VSCO_ENABLED is not truthy` | Master switch off. | `apps/site/.env` |
| `skipped` + `notes: inquiry not yet qualified` | Push attempted before Mark Qualified. | Admin button. |
| `skipped` + `notes: no VSCO job exists for inquiry` | Builder push before inquiry qualified. | Qualify the inquiry first. |
| `failed` + `http_status: 401` | API key wrong/expired/lacks scope. | Rotate key. |
| `failed` + `http_status: 429` | Rate limited. Client retries automatically up to 5x; if still failing, VSCO is hammering us. | Throttle. |
| `failed` + `http_status: 500` | VSCO server error. | Click Mark Qualified again to retry. |
| `failed` + no `http_status` | Network unreachable / DNS / timeout. | Coolify network. |

The admin page's collapsible **Sync history** shows the last 20 entries
per inquiry. Older entries are still in the `vsco_pushes` table for
forensic queries:

```sql
SELECT * FROM vsco_pushes
  WHERE verdict = 'failed' AND created_at > '2026-05-01'
  ORDER BY created_at DESC LIMIT 50;
```

## Re-running operations

- **Re-qualify an inquiry**: clicking Mark Qualified on an already-qualified
  inquiry re-triggers `pushQualifiedToVsco`, which hits the UPDATE path
  (read-modify-write PUT). Useful to retry after a transient failure.
- **Replace an existing Job**: not exposed in the UI. To force a fresh
  Job, manually DELETE the row from `vsco_entities`
  (`WHERE external_uuid = ? AND kind = 'job'`) and re-qualify. The next
  push will go via CREATE.
- **Resend an invoice**: not supported by the API. Use the Workspace UI's
  Send button on the invoice. The `pushBuilderToVsco` function refuses
  to create a second order for the same inquiry (returns `skipped` with
  `notes: order ${id} already exists`) so you won't accidentally
  double-bill.

## API limitations to keep in mind

1. **No `send invoice` endpoint** — the API generates invoices when
   `Order.dueDate` is set, but sending them is UI / Automation only.
2. **No `order.created` webhook** — only `order.booked` fires (after
   client signs). We don't subscribe to webhooks at the moment.
3. **No `job.updated` webhook** — manual edits in the VSCO UI don't
   trigger anything on our side. The integration is one-way (us → VSCO).
4. **PUT not PATCH** — every update is a full-document write. The push
   layer does read-modify-write to preserve fields it doesn't know about.
5. **Money is integer minor units** — `1850000` = $18,500.00. The
   catalog's `priceCents` values flow through unchanged.
6. **No idempotency-key header** — we use `externalMappings[].id` with
   the inquiry's `external_uuid` for de-dup. The push layer also checks
   `vsco_entities` before creating anything, so duplicate creation
   shouldn't happen even on retry.

## Testing

```sh
cd apps/site
pnpm test                                                  # 188 tests including all VSCO units
pnpm vitest run src/lib/vsco/                              # VSCO-only
pnpm vitest run src/lib/vsco/__tests__/push.test.ts        # push layer integration
```

The push tests use a temp `SMILE_NOLA_DB_DIR` and mock `globalThis.fetch`
so they never touch the real API. The bootstrap script's behavior on the
live API is verified manually via `pnpm vsco:bootstrap:dry`.
