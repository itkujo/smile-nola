# Spec: Smile NOLA Package Builder (v1)

**Date:** 2026-05-11
**Status:** Approved design, ready for implementation plan
**Companion:** `docs/superpowers/handoffs/2026-05-10-package-builder-spec.md` (canonical product
requirements). This document supersedes that handoff's "Suggested implementation" sections where
they conflict. Pricing, conditional logic, brand rules, and the data dictionary in the handoff
remain authoritative.

---

## 1. Goals

Ship a self-service configurator that turns a qualified Smile NOLA lead into a structured,
itemized, pre-quote submission Daniel can act on inside HoneyBook. The builder is the
**qualify-stage tool**, not a public top-of-funnel:

- Lead → `/contact` form → admin triage → invite link → builder → submission → manual HoneyBook
  invoice → "Mark Invoice Sent" in admin.
- Public cold visitors can also reach the builder directly. Their submissions are first-class
  but tagged as such and soft-linked to an existing inquiry when their email matches.

### Why we are building this (and not buying Qwilr)

Per the handoff, this is the conversion engine that makes outreach worth doing. Owning the
surface gives Smile NOLA a one-of-one tool that fits the brand, integrates with the existing
data layer, and avoids ongoing SaaS lock-in.

### Out of scope (Phase 1)

- E-signature on submission.
- Stripe deposit collection.
- HoneyBook API sync (manual invoice handoff is acceptable for v1).
- Server-side draft persistence (localStorage only; spec calls this acceptable).
- PDF export.
- Slack notifications.
- Admin sorting/filtering beyond status + recency.
- Motion polish beyond entrance fades.

Each of the above is documented as a Phase 2/3 follow-up but is **not** required to ship.

---

## 2. Surface area

### 2.1 Public routes (added to `apps/site/`)

| Route                            | Purpose                                                           |
|----------------------------------|-------------------------------------------------------------------|
| `GET /build`                     | Astro page rendering the React island.                            |
| `GET /build?invite=<token>`      | Same page, pre-filled from the linked inquiry.                    |
| `POST /api/package-builder`      | Endpoint that validates + persists + notifies on submission.      |
| `GET /api/package-builder/invite/<token>` | Resolves a token to a pre-fill payload (name/email/phone/event*). |

### 2.2 Admin routes (added to `apps/site/src/pages/admin/`)

| Route                                | Purpose                                                   |
|--------------------------------------|-----------------------------------------------------------|
| `GET /admin/package-builder`         | List of submissions: name, date, total, status, source.   |
| `GET /admin/package-builder/[id]`    | Detail page with full readable summary + status actions.  |
| `POST /admin/package-builder/[id]`   | Mutates `status` (`new` → `invoice_sent`).                |

Authentication: same `auth.ts` cookie gate used by the existing admin. Same `clientIp` /
`loginRateLimit` patterns.

### 2.3 Modification to existing `/admin/inquiries/[id]`

Add a **"Copy invite link"** button. On click:
1. POSTs to a new endpoint `POST /api/package-builder/invite` with the inquiry id.
2. Server generates a token (random URL-safe 24 bytes), stores it in a new `builder_invites`
   table, returns the full URL.
3. Client copies `https://smile-nola.com/build?invite=<token>` to clipboard, shows a toast.

This is the only edit to an existing admin page in v1.

---

## 3. Data model (Shape B — denormalized)

We deliberately do **not** introduce a `contacts` table. Each submission carries its own
contact fields and a hard FK to the originating inquiry when invited, plus we resolve a soft
link by email match at read time. Rationale: avoids migrating the live `inquiries` table for a
funnel-linkage problem the invite token already solves cleanly.

A future migration to normalized contacts is acceptable when (a) a third source of contact
records appears or (b) admin needs structured "history per person" beyond what an email-match
query can deliver. We are deliberately deferring.

### 3.1 New tables (added to `bootstrapSchema` in `apps/site/src/lib/db.ts`)

```sql
CREATE TABLE IF NOT EXISTS package_builder_submissions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at          TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status              TEXT    NOT NULL DEFAULT 'new',     -- 'new' | 'invoice_sent'
  invoice_sent_at     TEXT,                                -- set when status flips
  source              TEXT    NOT NULL,                    -- 'invited-builder' | 'cold-builder'

  -- Contact (owned by this row; no FK to contacts table)
  first_name          TEXT    NOT NULL,
  last_name           TEXT    NOT NULL,
  email               TEXT    NOT NULL,
  phone               TEXT    NOT NULL,

  -- Funnel linkage
  inquiry_id          INTEGER REFERENCES inquiries(id),    -- nullable; set when invited
  invite_token        TEXT,                                -- the consumed token (for audit)

  -- Event details
  event_date          TEXT,
  event_type          TEXT,
  venue               TEXT,
  guest_count         INTEGER,
  consultation_pref   TEXT,                                -- 'video' | 'in_person' | 'none'
  client_note         TEXT,

  -- Builder payload (canonical record of what they picked)
  selections_json     TEXT    NOT NULL,
  fixed_subtotal_cents INTEGER NOT NULL,
  custom_quoted_json  TEXT,                                -- JSON array of "starts at" items
  warnings_json       TEXT,                                -- JSON array of triggered warnings

  -- Admin
  notes               TEXT
);
CREATE INDEX IF NOT EXISTS idx_pbs_created_at ON package_builder_submissions(created_at);
CREATE INDEX IF NOT EXISTS idx_pbs_status     ON package_builder_submissions(status);
CREATE INDEX IF NOT EXISTS idx_pbs_email      ON package_builder_submissions(email);
CREATE INDEX IF NOT EXISTS idx_pbs_inquiry    ON package_builder_submissions(inquiry_id);

CREATE TABLE IF NOT EXISTS builder_invites (
  token        TEXT    PRIMARY KEY,                       -- URL-safe random
  inquiry_id   INTEGER NOT NULL REFERENCES inquiries(id),
  created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   TEXT,                                       -- nullable = never expires
  consumed_at  TEXT,                                       -- nullable; first submission stamps it
  created_by   TEXT                                        -- 'admin' for v1
);
CREATE INDEX IF NOT EXISTS idx_bi_inquiry ON builder_invites(inquiry_id);
```

### 3.2 `selections_json` schema

The shape persisted to the database mirrors the client form state, but is **always recomputed
server-side** for totals. Field-level layout:

```jsonc
{
  "collections": ["smile", "aurora"],
  "packages":   [{ "collectionId": "smile", "packageId": "mirror-me" }],
  "addons": [
    { "collectionId": "smile",  "addonId": "audio-guest-book", "qty": 1 },
    { "collectionId": "aurora", "addonId": "uplighting-apelabs", "qty": 12 },
    { "collectionId": "aurora", "addonId": "dance-floor-lighting", "qty": 1 }
  ]
}
```

`fixed_subtotal_cents` is what the server recomputes from `selections_json` + the canonical
`COLLECTIONS` config (see §6). The client-submitted total is **discarded** — server is the
truth.

`custom_quoted_json` is an array of `{ collectionId, addonId, label, startingPriceCents | null }`
for items the user picked that have a "starting at" or "custom quoted" price (these never
contribute to `fixed_subtotal_cents`).

`warnings_json` is the array of warning strings the server's recompute determined should be
shown — used by the admin page to surface the same warnings the lead saw.

### 3.3 Soft-link semantics on cold submissions

When a cold submission arrives (no token) and its email matches an existing inquiry:

1. `inquiry_id` is set to the matched inquiry.
2. `source` is still `cold-builder` (not `invited-builder`) — the distinction matters for funnel
   analytics.
3. The admin list shows a small "matched to inquiry #N" badge on the row.

If multiple inquiries match the same email, link to the most recent one. (Inquiry duplicates
already exist in production; this preserves the established behavior.)

---

## 4. UX flow — single long page (Option A)

Validated against a side-by-side visual companion mockup, 2026-05-11.

### 4.1 Layout

Desktop ≥ 1024px:

```
┌─────────────────────────────────────────────────────────────────┐
│                       Site header (existing)                    │
├─────────────────────────────────────────────────┬───────────────┤
│                                                 │  Sticky rail  │
│  Builder content (single column, scrolls)       │  (right side, │
│                                                 │   220px wide) │
│  · Invite eyebrow (when ?invite=)               │               │
│  · Headline + intro                             │  · Selections │
│  · 01 Collection chips                          │  · Subtotal   │
│  · For each selected collection (in order):     │  · Warnings   │
│      · Packages (radio cards)                   │  · "Send"     │
│      · Add-ons (checkbox rows with qty)         │               │
│  · Event details                                │  Sticks to    │
│  · Consultation preference                      │  viewport top │
│  · Cold-visitor contact block (if no invite)    │  with offset  │
│  · Send My Selections                           │               │
├─────────────────────────────────────────────────┴───────────────┤
│                       Site footer (existing)                    │
└─────────────────────────────────────────────────────────────────┘
```

Mobile < 1024px: rail collapses into a sticky bottom bar showing
"Starting **$2,695** ▾  Send Selections" — tap chevron expands the full breakdown as a sheet.

### 4.2 Section order and behavior

1. **Invite eyebrow** (only when `?invite=` resolved): small line at top reading
   `"building for {firstName} {lastName} · {eventDateOrEventType}"`. Not editable inline; if
   the visitor wants to change identity they re-submit from cold. (Cold submit doesn't render
   this eyebrow at all.)
2. **Headline:** `build your smile nola event experience` (Broadway, `.lowercase`, gold,
   ambient amber glow per existing brand pattern).
3. **Intro copy:** the exact two paragraphs from the handoff doc §"User experience".
4. **Step 01 — Collection chips:** five horizontal chips. Toggle on/off. Each selected
   collection injects its config section below in canonical order: Smile → Visionary →
   Digital Atelier → Aurora → Resonance. No "next/back" wizard — order is fixed.
5. **Per-collection sections:** packages stack first (radio: required for Smile/Visionary,
   one-or-more for Digital Atelier, none required for Aurora/Resonance), then add-ons stack.
   Quantity controls render inline next to the checkbox for add-ons with `qty: true`.
   Disclosure of large/uncommon add-ons (Aurora's full lighting menu) defaults closed under
   a "More lighting & visual options" disclosure on first render. Selected items always
   render expanded.
6. **Event details:** event date, event type (chip group: wedding / corporate / private
   celebration / other), venue/location, estimated guest count, "Tell us about the moment
   you want to create" textarea (optional).
7. **Consultation preference:** radio group, exactly these three options in this order:
   - `"A quick video call would be great"` (value `video`) — caption: `"We'll send a Google Meet link."`
   - `"An in-person walkthrough makes sense for this event"` (value `in_person`) — caption: `"For complex production setups."`
   - `"No call needed — the details above are enough"` (value `none`, default selected)
   Soft caveat below: `"We'll confirm based on project needs."`
8. **Cold-visitor contact block** (only when `?invite=` not present or invalid):
   first name, last name, email, phone. All required, validated client-side and re-validated
   server-side via Zod.
9. **Send My Selections** button.

### 4.3 Sticky rail content

- Section: "Your selections" (eyebrow style, gold uppercase tracked).
- One line per selected package + per selected add-on, with quantity × multiplier resolved.
- Items with custom/starting pricing render with the price replaced by the literal text
  `"starts at $500"` or `"custom quoted"`. They do **not** contribute to the subtotal.
- Subtotal line: `Starting · $X,XXX`.
- Warning blocks (rendered in order):
  - **Aurora minimum unmet:** `--sn-soft-coral` left-border, copy:
    `"Aurora requires a $2,000 total Smile NOLA project minimum before lighting or visual production is deployed."`
  - **Resonance scope (full plan selected):** softer `--sn-gold-12` left-border, copy:
    `"Resonance requires a planning conversation before final scope is confirmed."`
  - **Ceremony Speaker exception:** if `ceremony-speaker` is the only Resonance item selected,
    no minimum warning is shown.
- "Send Selections" button mirrors the bottom submit (clicking either submits the form).

### 4.4 Persistence

LocalStorage key: `sn-builder-v1:{tokenOrSessionId}`. Saved on every selection change with a
250ms debounce. Submission clears the key on success. Cold visitors get a `crypto.randomUUID()`
sessionId persisted alongside.

### 4.5 Empty / loading / error states (required by global standards)

- **Initial load (invited):** server renders the eyebrow with hydrated name. If the invite
  token resolves but the inquiry has been deleted, fall back to the cold flow with a
  console-only warning (no public-facing error).
- **localStorage restore:** when a draft is found, render a small one-time toast above the
  rail: `"Welcome back. Your selections are saved."` Dismissible.
- **Submit pending:** "Send My Selections" disables, shows a small spinner + `"Sending..."`.
- **Submit error:** banner above the button, gold-bordered card, copy:
  `"Something went wrong on our end. Your selections are saved — give it another try in a moment, or email daniel@smile-nola.com."` Logs the actual error to `console.error`.
- **Submit success:** the entire form swaps to a centered confirmation card:
  `"Thank you, {firstName}. Daniel will review your selections and reach out personally within 24 hours."` localStorage cleared. No redirect.

### 4.6 Accessibility

- Every chip, checkbox, radio, and text input has a real `<label>`.
- Each collection section is a `<section role="region" aria-labelledby="...">`.
- The sticky rail is `role="complementary" aria-label="Investment summary"`.
- Keyboard order matches visual order (tab through chips → packages → addons → event details →
  consultation → contact → send).
- The mobile sticky bottom bar is keyboard-reachable and the expand-sheet has focus management.
- Color contrast: gold (`#D4AF37`) on obsidian (`#050505`) is 8.6:1, well past AA. The
  `--sn-warm-taupe` editorial captions are checked: `#9C8A6A` on `#050505` is 5.6:1, AA pass for
  small text.

---

## 5. Brand canon

All decisions from the brand brief §5 and the handoff doc are honored verbatim:

- **Broadway** for the headline only, lowercase source, `.font-deco` class.
- **Poppins** for everything else: section labels, package names, prices, buttons, body.
- **No Holimount in the builder.** Holimount is reserved for true signature moments (the
  `/about` page signature). The builder is a configurator, not a signature surface.
- **No fourth font.** Italic Poppins where italic emphasis is needed.
- **Color usage:**
  - Background: `--sn-black` with the existing ambient amber radial glows from
    `apps/site/src/styles/globals.css`.
  - Cards & rail: `--sn-soft-black` for package cards; `--sn-deep-brown-black` for the sticky
    rail to give it a hair more warmth than the cards.
  - Borders & rules: `--sn-gold-12` / `--sn-gold-24` / `--sn-gold-40` per the existing scale.
  - Warning block: `--sn-soft-coral` left border + transparent fill (warning state **only**).
  - Editorial captions and "starts at" labels: `--sn-warm-taupe`.
- **No "PHOTO/VIDEO BOOTH" anywhere.** All Smile Collection copy uses "photo experience" /
  "mirror booth experience" language.
- **No "rental" anywhere.** The submit copy is `"Send My Selections"` exactly.
- **Logo:** use existing `LogoMark` component if a small mark is wanted in the page; default
  is no logo on the builder page itself (it sits inside the site shell which has the header).

---

## 6. Canonical pricing config

Single source of truth: **`apps/site/src/lib/collections.ts`**.

Exports a typed `COLLECTIONS: CollectionConfig[]` whose data is the verbatim §"Collection
data and pricing — canonical" section of the handoff doc. Both the React island and the
server endpoint import from this module. Pricing change = one file, one PR.

```ts
// Sketch — full table values from the handoff doc.
export type PriceType = 'fixed' | 'starting' | 'custom';
export interface AddonConfig {
  id: string;
  name: string;
  priceCents: number | null;       // null for 'custom' priced items
  priceType: PriceType;
  qty?: boolean;                   // quantity-enabled?
  qtyMax?: number;                 // LED expansion is 4 max, etc.
  note?: string;                   // "client keeps after event", etc.
}
export interface PackageConfig {
  id: string;
  name: string;
  priceCents: number;
  duration?: string;
  description?: string;
  includes?: string[];             // bullet list for description disclosure
}
export interface CollectionConfig {
  id: 'smile' | 'visionary' | 'digital-atelier' | 'aurora' | 'resonance';
  displayName: string;
  shortDescription: string;
  rules: {
    requireOneBasePackage?: boolean;
    allowMultiplePackages?: boolean;
    projectMinimumCents?: number;            // Aurora: 200000
    projectMinimumScope?: 'collection' | 'total'; // Aurora: 'total'
    minimumException?: string[];             // Resonance: ['ceremony-speaker']
  };
  packages: PackageConfig[];
  addons: AddonConfig[];
}
```

The handoff doc's pricing tables are the source data. Implementation expands the sketch into
the full canonical object.

---

## 7. Server-side recompute & tamper protection

**Required for v1.** Cheap to implement, prevents trivial price manipulation.

On `POST /api/package-builder`:

1. Validate request body with Zod (see §8.1 for shape).
2. Walk `selections_json` and look up every `packageId` / `addonId` against `COLLECTIONS`. Any
   id not found → 400 `"unknown_selection"`.
3. Compute `fixed_subtotal_cents` from canonical prices × quantities. Discard any client-sent
   total.
4. Compute `custom_quoted_json` (items where `priceType === 'starting'` or `'custom'`).
5. Compute `warnings_json`:
   - Aurora minimum: if `aurora` in selected collections AND `fixed_subtotal_cents < 200000`.
   - Resonance: if `resonance` in selected collections AND any Resonance item OTHER than
     `ceremony-speaker` is selected → emit planning-conversation warning. If only
     `ceremony-speaker` (and optionally `ceremony-wireless-mic`) is selected → no warning.
6. Persist row.
7. Soft-link inquiry by email if cold and a match exists.
8. Fire-and-forget Resend notification (do not await on the response path).
9. Return `200 { ok: true, id }`.

The endpoint **never** trusts client-side totals or warnings.

---

## 8. API contracts

### 8.1 `POST /api/package-builder`

Request body (Zod schema lives in `apps/site/src/lib/schema.ts` extended):

```ts
{
  // For cold submissions only — null/absent for invited
  invite?: string;
  client: {
    firstName: string;
    lastName: string;
    email: string;   // email format
    phone: string;
  };
  event: {
    date?:        string | null;  // ISO yyyy-mm-dd or null
    type?:        string | null;
    venue?:       string | null;
    guestCount?:  number | null;
    note?:        string | null;
  };
  consultationPref: 'video' | 'in_person' | 'none';
  selections: {
    collections: string[];                                       // ids
    packages:    { collectionId: string; packageId: string }[];
    addons:      { collectionId: string; addonId: string; qty: number }[];
  };
}
```

Response:
```ts
// 200
{ ok: true; id: number; createdAt: string }
// 400
{ ok: false; error: 'validation_failed' | 'unknown_selection' | 'invalid_invite'; details?: unknown }
// 429
{ ok: false; error: 'rate_limited'; retryAfter: number }   // basic IP throttle (see §9)
// 500
{ ok: false; error: 'server_error' }
```

### 8.2 `GET /api/package-builder/invite/<token>`

Returns the pre-fill payload (no PII for unknown tokens):

```ts
// 200
{
  ok: true;
  prefill: {
    firstName: string;
    lastName:  string;
    email:     string;
    phone:     string;
    event: {
      date:       string | null;
      type:       string | null;
      venue:      string | null;
      guestCount: number | null;
    };
  };
  inquiryId: number;
}
// 404
{ ok: false; error: 'invite_not_found' }
// 410
{ ok: false; error: 'invite_expired' }   // when expires_at set and past
```

### 8.3 `POST /api/package-builder/invite`

Admin-only (verifies session via `isAuthed`). Body: `{ inquiryId: number }`. Returns:
```ts
{ ok: true; url: string; token: string; expiresAt: string | null }
```

For v1, invites never expire (`expires_at = null`). We can flip this on per-token in admin
later.

---

## 9. Rate limiting & abuse

- `POST /api/package-builder`: 5 submissions / 10 minutes per IP via the existing
  `loginRateLimit` pattern (parameterized into a generic rate limiter — see §10.3).
- `POST /api/package-builder/invite`: admin auth gate is enough; no separate limit.
- Email validation on the cold path: standard Zod `.email()` is the only check. Cold spam is
  acceptable risk for v1; if it becomes a problem we add a turnstile.

---

## 10. Email notifications (Resend)

### 10.1 Resend rollout

Both the contact form (existing `email.ts`) and the new builder notification migrate to Resend.

- Add `resend` dependency.
- Add `RESEND_API_KEY` and `RESEND_FROM` env vars. `mail.smile-nola.com` is already
  verified on the Smile NOLA Resend account (SPF + DKIM live), so the canonical sender is
  `"Smile NOLA <no-reply@mail.smile-nola.com>"`. Per-message `replyTo` is set to the
  submitter's email so Daniel can reply directly from his inbox.
- Refactor `apps/site/src/lib/email.ts`:
  - Rename to `mailer.ts` (or keep as `email.ts`, contents change).
  - Replace `nodemailer.createTransport(...)` with a `resend.emails.send(...)` call.
  - Keep the same `sendInquiryNotification(inquiry)` export signature.
  - Add `sendBuilderSubmissionNotification(submission)` export.
- Remove `nodemailer` dependency.

If `RESEND_API_KEY` is missing, the helpers fall back to a `console.log` exactly like the
current SMTP fallback. Submissions are never blocked by mail failure.

### 10.2 Notification email shape

Subject: `"New package builder submission — {firstName} {lastName} · ${total} starting"`

Body (HTML + text, matching the existing inquiry-notification visual language):

- Header block with name + email + phone.
- Event details block.
- "Selected experience" block listing every package and add-on with their price (quantities
  expanded), grouped by collection.
- "Starting investment" line in gold.
- Custom-quoted items block (if any) labeled "Quoted separately" with their "starts at" prices.
- Warnings block in coral (if any).
- Consultation preference line.
- Footer: link to `/admin/package-builder/<id>`.
- `replyTo` set to the submitter's email.

### 10.3 Generic rate limiter

Refactor `auth.ts:loginRateLimit` to a parameterized helper:

```ts
export function rateLimit(
  bucketKey: string,
  ip: string,
  opts: { windowMs: number; max: number }
): { allowed: boolean; remaining: number; retryAfter: number };
```

The existing `loginRateLimit` becomes a thin wrapper preserving its current API and limits.
The new builder endpoint calls `rateLimit('builder-submit', ip, { windowMs: 600_000, max: 5 })`.

---

## 11. Admin UI details

### 11.1 List page: `/admin/package-builder`

Columns (in order): **Status badge** · **Submitted** (relative time) · **Name** · **Email** ·
**Event date** · **Subtotal** · **Source** (`invited` / `cold`) · `→ View`.

Sort: newest first (created_at desc). Status filter via a simple chip row at top
(`All / New / Invoice Sent`). No search in v1 — the list is small.

Empty state copy: `"No package builder submissions yet. Send an invite link from an inquiry to get started."`

### 11.2 Detail page: `/admin/package-builder/[id]`

Layout: two columns on desktop (content left, sidebar right with status/actions); stacks on
mobile.

Content (left column):
- Contact block (name, email, phone, "linked to inquiry #N" if `inquiry_id` is set).
- Event block.
- Consultation preference.
- Selections rendered as a readable, gold-divided list (mirrors the rail content but
  expanded).
- Subtotal in gold.
- Custom-quoted items.
- Warnings (if any).
- Client note (if any).
- Notes field (admin-editable, like inquiries).

Sidebar (right column):
- Status badge.
- **"Mark Invoice Sent"** button — primary gold when status is `new`. On click POSTs to the
  same route with `{ action: 'mark_invoice_sent' }`. Page refreshes. Once flipped, button
  becomes a disabled `"Invoice sent {relativeTime}"` indicator with a small "undo" ghost
  link (POSTs `{ action: 'revert' }`).
- "Copy invite link" if `inquiry_id` is set (handy for re-sending).
- Submission metadata: id, source, created_at.

### 11.3 Invite trigger on `/admin/inquiries/[id]`

Add a new button row above the notes section: **"Copy package builder link"**.

- Disabled by default until clicked.
- On click → JS calls `POST /api/package-builder/invite { inquiryId }` → on 200, copies the
  returned URL to clipboard and shows an inline toast: `"Invite link copied. Send it from your inbox."`
- If the inquiry already has an outstanding (unconsumed) invite, the endpoint returns the
  existing one rather than creating a new one. This way reclicking just re-copies.

---

## 12. Implementation map (files to touch)

```
apps/site/
├── src/
│   ├── pages/
│   │   ├── build.astro                              [NEW] renders React island
│   │   ├── api/
│   │   │   ├── package-builder.ts                   [NEW] POST submission
│   │   │   └── package-builder/
│   │   │       ├── invite.ts                        [NEW] POST admin invite create
│   │   │       └── invite/[token].ts                [NEW] GET resolve invite prefill
│   │   └── admin/
│   │       ├── package-builder/
│   │       │   ├── index.astro                      [NEW] list
│   │       │   └── [id].astro                       [NEW] detail + actions
│   │       └── inquiries/[id].astro                 [EDIT] add "Copy invite" button
│   ├── lib/
│   │   ├── collections.ts                           [NEW] canonical config
│   │   ├── builder/
│   │   │   ├── compute.ts                           [NEW] server-side recompute + warnings
│   │   │   ├── invites.ts                           [NEW] CRUD for builder_invites
│   │   │   └── submissions.ts                       [NEW] CRUD for package_builder_submissions
│   │   ├── db.ts                                    [EDIT] add two new CREATE TABLEs
│   │   ├── auth.ts                                  [EDIT] extract generic rateLimit()
│   │   ├── email.ts                                 [EDIT/REWRITE] Resend transport + new helper
│   │   └── schema.ts                                [EDIT] add builder submission Zod schemas
│   └── components/
│       └── builder/                                 [NEW]
│           ├── Builder.tsx                          React island root
│           ├── CollectionChips.tsx
│           ├── PackageCard.tsx
│           ├── AddonRow.tsx
│           ├── EventDetails.tsx
│           ├── ConsultationPreference.tsx
│           ├── ContactBlock.tsx
│           ├── InvestmentRail.tsx
│           ├── MobileRailBar.tsx
│           └── useBuilderState.ts                   hook: selections, totals, persistence
├── package.json                                     [EDIT] +react, +react-dom, +resend, -nodemailer
└── astro.config.mjs                                 [EDIT] +@astrojs/react integration
```

Notes:
- React + React DOM + `@astrojs/react` integration must be added; the site is currently pure
  Astro with no React island.
- `@types/react` and `@types/react-dom` go in devDeps.
- No Framer Motion in v1 (defer all motion polish to Phase 2). CSS transitions on conditional
  reveals are sufficient.

---

## 13. Test plan

### 13.1 Manual scenarios (verification gates before claiming done)

Per the existing `verification-before-completion` rule. Test all of these on a real browser
before declaring v1 ready:

1. **Smile only, base + add-on.** Pick Memory Booth + Audio Guest Book. Submit. Verify
   subtotal = $970, single row in DB, email arrives, admin shows it.
2. **Smile + Visionary** — no other collections render in conditional sections.
3. **Aurora minimum trigger.** Add a single uplighting fixture ($50). Verify the soft-coral
   warning appears in rail. Add enough to cross $2k. Verify warning vanishes. Remove items
   back under $2k. Verify warning reappears.
4. **Aurora LED wall** — pick LED Video Wall Experience. Verify $3,000 added. Pick LED Wall
   Expansion with qty 3. Verify $1,500 added. Try qty 5 — control caps at 4 (qtyMax).
5. **Resonance — Ceremony Speaker only.** Pick Ceremony Speaker À La Carte. Verify NO minimum
   warning. Add wireless mic. Verify NO minimum warning. Submit successfully at $350 / $500.
6. **Resonance — full plan.** Pick the $2,000 Resonance Minimum. Verify the planning-
   conversation note appears.
7. **Cold submission with no email match.** Submit from a fresh email. Verify row, no
   `inquiry_id`, source = `cold-builder`.
8. **Cold submission with email match.** Submit from an email present in `inquiries`. Verify
   `inquiry_id` set, source still `cold-builder`, admin shows "matched to inquiry #N" badge.
9. **Invited submission.** From `/admin/inquiries/X`, copy invite link. Open in incognito.
   Verify pre-fill renders, eyebrow shows correct name. Submit. Verify
   `source = 'invited-builder'`, `inquiry_id = X`, `invite_token` set, `consumed_at` stamped.
10. **Reuse invite.** Open same invite link a second time in another incognito window. Verify
    behavior: pre-fill still works, second submission creates another row, same
    `invite_token` (we don't single-use; admin can revoke later).
11. **localStorage persistence.** Fill out half the form. Refresh. Verify selections restored,
    "Welcome back" toast shows.
12. **Mobile (iPhone SE width 375px).** Verify sticky bottom bar renders, expand-sheet works,
    no horizontal scroll, all CTAs reachable.
13. **Keyboard nav.** Tab through entire form. Verify focus order is sane and every control
    is operable.
14. **Server tamper.** Use DevTools to send a POST with a fake `addonId`. Verify 400
    `unknown_selection`.
15. **Server tamper #2.** Submit with `selections` totaling $0 of valid items. Verify server
    computes $0, accepts, no warnings.
16. **Mark Invoice Sent.** From admin detail, click. Verify status flips, button replaces
    with "Invoice sent Xm ago" + undo. Click undo. Verify revert.
17. **Resend kill switch.** Unset `RESEND_API_KEY`. Submit. Verify row persists, console
    shows fallback log, no error returned to client.
18. **Email render.** Submit. Verify the email body in Daniel's inbox renders correctly with
    the gold-on-black brand look.

### 13.2 Unit tests (lightweight; not required for ship)

- `compute.ts` — pure function. Test the recompute logic against fixtures:
  - Smile-only with various add-ons.
  - Aurora minimum boundary cases ($1,999 / $2,000 / $2,001).
  - Resonance Ceremony exception.
  - Quantity multiplication.
  - Custom-quoted items excluded from subtotal.

If TDD is comfortable, write these alongside `compute.ts`. If not, the manual matrix is the
gate.

---

## 14. Phase 2 / Phase 3 deferred work (explicit)

Recorded here so we don't lose track:

- **Slack webhook notifications** (in addition to Resend email).
- **PDF export** of a submission as a polished proposal-style document.
- **Server-side draft persistence** keyed by invite token (for cross-device return).
- **E-signature on a proposal-approve flow** (DocuSeal, self-hosted, free).
- **Stripe deposit collection** on approve.
- **HoneyBook sync** — push approved submissions as projects via Zapier or direct API.
- **Future contacts normalization** — migrate to a `contacts` table when a third source of
  contact records appears or admin needs richer per-person history.
- **Search/filter on admin list** — by name, email, event date range.
- **Motion polish** — Framer Motion entrance reveals on conditional sections, sticky-rail
  total count-up animation, light sweep on subtotal change.

---

## 15. Risk register

| Risk | Mitigation |
|------|------------|
| Resend sender outage / misconfiguration. | Builder can ship with `RESEND_API_KEY` unset — submissions persist, console-only fallback runs, admin sees rows on next page refresh. `mail.smile-nola.com` is already verified on the Smile NOLA Resend account so day-one sends are real-branded. |
| Adding React to a previously React-free Astro app inflates the bundle. | The React island is the only React on the site. Astro ships it only on `/build`. Marketing pages stay zero-JS. |
| localStorage key collision if a future feature also writes `sn-builder-*`. | Use the explicit `sn-builder-v1:` prefix and bump the version on breaking schema changes. |
| Soft email-match links the wrong inquiry when a household shares an email. | Acceptable for v1. Admin can manually re-link via the existing notes field. Document in admin help text. |
| Aurora rules evolve mid-build. | All pricing/rules in `collections.ts`. One file, one PR to change. |
| Spec drift between this doc and `2026-05-10-package-builder-spec.md`. | This doc supersedes implementation conflicts. Pricing and product rules in the older doc remain authoritative. |

---

## 16. Open question (none blocking)

None. All decisions resolved during the 2026-05-11 brainstorming session with Daniel.

---

## 17. Ready signal

This spec is complete. Next step per the brainstorming workflow: invoke `writing-plans` to
produce the implementation plan that breaks this into reviewable units of work with explicit
checkpoints.
