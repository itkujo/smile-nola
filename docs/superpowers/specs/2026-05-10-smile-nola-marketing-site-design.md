# Smile NOLA Marketing Site — Design Spec

**Date:** 2026-05-10
**Owner:** Daniel Velez
**Status:** Draft, pending owner approval

This is the design contract for the Smile NOLA marketing site at `apps/site/`.
It is intentionally tight and ship-focused. The implementation plan that
follows will derive from this document.

---

## 1. Goal and constraints

Build a complete, brand-finished marketing site for Smile NOLA in a single
working day so the owner can send cold-outreach emails to a real, polished
destination by end of day.

Hard constraints:

- Visual language and typography canon from the Brand Brief (`~/Downloads/Smile_NOLA_Website_and_Forms_Brand_Brief_for_OpenCode.md`) are inviolable.
  - Holimount used only as signature accent (one or two words per page).
  - Broadway used only in lowercase source text with a `lowercase` class.
  - Poppins for everything functional (body, UI, buttons, forms, labels).
  - Black + gold luxury palette. No other accent colors.
  - No "PHOTO/VIDEO BOOTH" text anywhere — Smile NOLA is positioning as a production company.
  - Official logo artwork only; never type the brand name as a substitute.
- The existing booth intake app at `apps/intake/` is in production. The marketing site must not modify it. The two apps share `data/leads.db` but never share routes or processes.
- Site must be deployable to the owner's existing Coolify stack via Docker Compose.
- Admin must work with a single shared password (`SmileNola2585`) gated behind a signed cookie. Per-user accounts are out of scope.

Soft constraints:

- "Wow-factor" UX/UI is a priority. The owner cited meter.com motion and Runaway Vows structure as benchmarks.
- All content must be real or contextually appropriate. No Lorem ipsum, no example.com URLs.
- Imagery for v1 is logos + curated stock photography; real photography is added later by the owner.

---

## 2. Stack and project layout

```
smile-nola/
├── apps/
│   ├── intake/         ← booth intake, in production, untouched
│   └── site/           ← NEW marketing site
│       ├── astro.config.mjs
│       ├── package.json
│       ├── tsconfig.json
│       ├── Dockerfile
│       ├── public/
│       │   ├── fonts/                ← copied from apps/intake/public/fonts/
│       │   └── logos/                ← copied from apps/intake/public/logos/
│       └── src/
│           ├── components/
│           │   ├── brand/            ← LogoMark, DecoCorner, GoldDivider, HeroCycler, ParticleField
│           │   ├── cards/            ← CollectionCard, TestimonialCard, PortfolioCard
│           │   ├── forms/            ← InquiryFormShort, InquiryFormFull, AdminForm fields
│           │   └── layout/           ← SiteHeader, SiteFooter, BaseLayout
│           ├── content/
│           │   └── collections.ts    ← five-collection data model (see §7)
│           ├── lib/
│           │   ├── db.ts             ← SQLite connection + schema bootstrap
│           │   ├── auth.ts           ← admin cookie sign/verify, rate limit
│           │   ├── csv.ts            ← HoneyBook-compatible CSV export
│           │   └── oembed.ts         ← YouTube/Vimeo thumbnail fetch
│           ├── middleware.ts         ← admin route guard
│           ├── pages/
│           │   ├── index.astro
│           │   ├── about.astro
│           │   ├── contact.astro
│           │   ├── portfolio.astro
│           │   ├── collections/
│           │   │   ├── index.astro            ← overview
│           │   │   ├── aurora.astro
│           │   │   ├── resonance.astro
│           │   │   ├── visionary.astro
│           │   │   ├── atelier.astro
│           │   │   └── smile.astro
│           │   ├── admin/
│           │   │   ├── index.astro            ← dashboard
│           │   │   ├── login.astro
│           │   │   ├── inquiries/
│           │   │   │   ├── index.astro        ← table view
│           │   │   │   └── [id].astro         ← detail / edit status + notes
│           │   │   ├── portfolio.astro
│           │   │   └── testimonials.astro
│           │   └── api/
│           │       ├── inquiry.ts             ← POST: save lightweight inquiry
│           │       ├── contact.ts             ← POST: save deep contact form
│           │       ├── admin/
│           │       │   ├── login.ts           ← POST: verify password, set cookie
│           │       │   ├── logout.ts          ← POST: clear cookie
│           │       │   ├── portfolio.ts      ← POST/PUT/DELETE: portfolio CRUD
│           │       │   ├── testimonials.ts   ← POST/PUT/DELETE: testimonials CRUD
│           │       │   ├── inquiries.ts      ← PATCH: update inquiry status
│           │       │   └── export/
│           │       │       ├── inquiries.csv.ts
│           │       │       └── portfolio.json.ts
│           └── styles/
│               └── globals.css       ← brand tokens, ported from apps/intake/app/globals.css
└── docker-compose.yml                ← runs apps/site at smile-nola.com
```

**Astro config**: SSR mode (`output: 'server'`), `@astrojs/node` adapter in `standalone` mode, TypeScript strict mode, Tailwind v4 via the `@tailwindcss/vite` plugin (Tailwind v4's first-class Vite integration — the old `@astrojs/tailwind` is for Tailwind v3 and not used here).

**Runtime**: Node 22, port 3000 inside the container, exposed via Coolify on smile-nola.com.

**No pnpm workspaces.** Each app is independent. The site has its own `package.json` and `node_modules`. Acceptable trade-off for current monorepo simplicity.

---

## 3. Brand system in code

### 3.1 Tokens

`src/styles/globals.css` ports the entire `:root` block from `apps/intake/app/globals.css` verbatim (8 brand colors, alpha tints, font family declarations). Tailwind v4 `@theme inline` mapping is preserved so utility classes match.

### 3.2 Fonts

Copy `Holimount.otf` and `Broadway.ttf` from `apps/intake/public/fonts/` into `apps/site/public/fonts/`. `@font-face` declarations are duplicated in the site's globals.css with `font-display: swap`.

### 3.3 Logo

Copy all four official logo SVGs from `apps/intake/public/logos/`:
- `full-logo.svg` (currentColor)
- `full-logo-gold.svg` (pre-baked gold)
- `icon.svg` (submark)
- `wordmark.svg` (Holimount script only)

The site uses `full-logo-gold.svg` in the header (CSS-masked for the glow filter), `icon.svg` as favicon, and `wordmark.svg` in the footer.

### 3.4 Brand components (Astro)

| Component | Purpose | Notes |
|---|---|---|
| `<LogoMark variant="full"\|"icon"\|"wordmark" glow={true}>` | Renders any logo via CSS mask | Pure CSS, no JS |
| `<DecoCorner position="tl"\|"tr"\|"bl"\|"br" size={"sm"\|"md"\|"lg"}>` | Art Deco corner ornament | Pure CSS |
| `<GoldDivider>` | Thin gold rule with centered diamond | Pure CSS |
| `<HeroCycler words={[...]}>` | The cycling-word machinery from hero v5 | Small `<script>` island per page that uses it |
| `<ParticleField count={70}>` | Champagne particle canvas | Small `<script>` island. Honors `prefers-reduced-motion`. |
| `<AmbientGlow>` | Three-layer drifting radial gradients | Pure CSS animation |
| `<DecoOrnament rotate={true}>` | Slow-rotating SVG sunburst behind hero | Pure CSS animation |

All motion respects `prefers-reduced-motion: reduce`.

### 3.5 Type rules in code

- A `.lowercase` utility class is applied to every Broadway element. Never use `text-transform: uppercase` on Broadway — the font double-decorates.
- Body text uses Champagne (`#F6E7C8`) or Ivory (`#F8F4EA`) on dark backgrounds for AA contrast.
- Muted Stone (`#B8B2A5`) for low-emphasis text only — short labels and metadata.

---

## 4. Page-by-page design

### 4.1 Homepage (`/`)

| Section | Description |
|---|---|
| Hero | Locked design from visual companion v5: lowercase Broadway display headline "let's design `your` [moment\|wedding\|celebration\|gala\|milestone\|reception]." with Holimount script "your," left-to-right wipe cycle, gold light bar, 70-particle canvas, 3-layer ambient glow, slow-rotating Deco sunburst, light sweep on load, Art Deco corners. CTAs: "begin your inquiry" (primary), "explore collections" (ghost). Collection ticker + scroll cue at the bottom. |
| Trusted-by strip | Five neutral monochrome marks. v1 placeholder: hide if no admin-entered partners exist. |
| Brand promise | Centered, ~3 lines of lowercase Broadway display with one Holimount-script word. GoldDivider below. |
| The Five Collections | Five editorial cards stacked vertically, alternating image-left/image-right. Each: collection name (Broadway lowercase), tagline (Poppins small caps), 1-sentence philosophy from brief §13, "explore the collection →" link, "inquire →" link. Stock photo on the image side. DecoCorner top-left of each panel. Scroll-driven fade-in (Intersection Observer). |
| Visionary Moment | Auto-play-muted YouTube/Vimeo embed of the most recently `featured` portfolio item. Hide section if no featured item exists yet. |
| Testimonials | One large pull-quote (Broadway lowercase opening quote-mark, Poppins body text, attribution in small caps), with horizontal scroll-snap or auto-rotation for additional quotes. Pulls from `testimonials` table; hide section if empty. |
| Closing CTA | Mirrors the hero's cycler — "let's design `your` [cycling word]." with a single "begin your inquiry" button. Bookends the page. |
| Footer | Wordmark + quick links (Collections, Portfolio, About, Contact, Admin) + contact (phone, email, Instagram link) + NOLA location + © line. |

### 4.2 Collections overview (`/collections`)

A single page listing all five collections as larger editorial cards (richer than the homepage strip). Each card links to its collection page. Used as the destination for the "Collections" nav link.

### 4.3 Individual collection pages (`/collections/<slug>`)

Same template, content varies per collection (driven by `src/content/collections.ts`):

1. **Hero** — lighter than homepage hero. Collection name (Broadway lowercase) + tagline (Poppins) + single hero image. Static, no particles. DecoCorner accents.
2. **Philosophy** — 2-3 paragraph block. Brief §13 copy as the starting draft for each collection.
3. **What's Included** — 3-5 bullets describing what this collection delivers. Drafted by me, owner edits before launch.
4. **Portfolio** — grid of related videos for this collection (filtered from `portfolio_items` table by `collection` column). Empty state: "Portfolio coming soon — inquire to discuss your event."
5. **Inquiry Form** — lightweight collection-specific form (see §5).
6. **Other Collections** — strip of small cards linking to the other four.

### 4.4 Portfolio (`/portfolio`)

Grid view, 2-up desktop / 1-up mobile, sorted by `featured DESC, created_at DESC`. Filter chips at top: All / Aurora / Resonance / Visionary / Atelier / Smile. Each card: video thumbnail (from oEmbed), title, collection tag, optional 1-line description. Click → full embedded player (in-page expand, not modal — better mobile UX).

### 4.5 About (`/about`)

Single page, three sections:

1. **Intro** — Daniel Velez, founder, NOLA-based. One paragraph of brand-voice "why."
2. **Background** — bullet list translating LinkedIn credibility through the luxury-event lens: 15+ years tech leadership; multiple ventures including Smile NOLA and Animeniacs.shop; Army veteran with mission-critical reliability discipline; deep commercial A/V infrastructure background. Tone: discipline and reliability transferred to events, not cybersecurity/cloud detail.
3. **The Standard** — what working with Smile NOLA looks like: consultative inquiry, polished proposals, intentional design, end-to-end production.

Owner reviews and edits the draft before launch.

### 4.6 Contact (`/contact`)

Two states:

- **Default** — short intro + the deep contact form.
- **Confirmation** — replaces the form with a Holimount thank-you accent and the brand promise restated. "We'll be in touch within 24 hours."

The deep form is the long version (see §5.2). The "Other / Custom Inquiry" path uses the "Other" multi-select option that reveals a free-text "tell us about your event" field.

---

## 5. Inquiry forms

### 5.1 Lightweight form (collection pages)

Fields (5 visible + 1 hidden):

1. First name (required)
2. Last name (required)
3. Email (required, validated)
4. Phone (required, US-format soft-validation)
5. Event date (date input, optional but recommended)
6. Tell us about the moment you want to create (textarea, optional)
7. *hidden:* `collection` — auto-filled with the slug of the current collection page

Submit → POST `/api/inquiry` → save → confirmation state ("Thank you. We'll reach out within 24 hours.").

### 5.2 Deep form (`/contact`)

All common fields from Brief §10.1 + a "which collections interest you?" multi-select. Selected collections reveal their specific question blocks from Brief §10 (e.g. selecting Aurora reveals the video-wall fields). "Other" reveals a free-text additional-services field.

Submit → POST `/api/contact` → save → confirmation.

### 5.3 Storage

Both endpoints write to a single `inquiries` table:

```sql
CREATE TABLE inquiries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source          TEXT NOT NULL,  -- 'collection-aurora', 'collection-resonance', ..., 'contact'
  status          TEXT NOT NULL DEFAULT 'new',  -- 'new' | 'contacted' | 'closed'
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT NOT NULL,
  preferred_contact TEXT,
  event_date      TEXT,
  event_type      TEXT,
  venue           TEXT,
  guest_count     INTEGER,
  event_start     TEXT,
  event_end       TEXT,
  planner         TEXT,
  budget_range    TEXT,
  message         TEXT,
  referral        TEXT,
  collections_interested TEXT,    -- JSON array of slugs
  collection_fields_json TEXT,    -- JSON of any collection-specific answers
  notes           TEXT            -- admin-only
);
```

Bootstrap script runs on app start to create the table if missing.

### 5.4 Notification email

On submit, the server attempts to send an email to the owner at the address stored in env var `NOTIFY_EMAIL`. For v1, use a simple SMTP integration via `nodemailer` with credentials in env vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`). If any of these env vars are missing, the server logs the inquiry to stdout and continues silently. **Submissions are never lost — they always save to SQLite even if email fails.** The save-then-notify ordering is critical and must be enforced in code.

### 5.5 CSV export

`GET /admin/export/inquiries.csv` returns a download with columns matching the booth intake's HoneyBook-compatible shape (cross-reference `apps/intake/lib/csv.ts`). All fields exported. Sorted by `created_at DESC`.

---

## 6. Admin

### 6.1 Auth

- Single password in env: `ADMIN_PASSWORD=SmileNola2585`
- `POST /api/admin/login` accepts `{ password: string }` in body
- Constant-time compare against env password (`crypto.timingSafeEqual`)
- On success, sets a signed httpOnly cookie `admin_session` with 24h expiry. Cookie value is `<random-id>.<hmac-sha256>` using a server-side `ADMIN_SESSION_SECRET` env var.
- On failure, increment IP rate-limit counter (in-memory map, 5 attempts / 5 minutes / IP). After threshold, return 429 for the rest of the window.
- Middleware (`src/middleware.ts`) checks the cookie on every `/admin/*` route except `/admin/login`. Invalid/missing cookie → redirect to `/admin/login`.

### 6.2 Admin pages

| Route | Purpose |
|---|---|
| `/admin/login` | Single password field, gold submit button. On success, redirect to `/admin`. |
| `/admin` | Dashboard — counts of inquiries (new/contacted/closed), portfolio items, testimonials. Quick links to the three sections. |
| `/admin/inquiries` | Table view of all inquiries. Filter chips by status, search by email/name, click a row to view detail + update status + edit admin notes. CSV export button. |
| `/admin/portfolio` | List + Add/Edit/Delete portfolio items. Add form: video URL (YouTube/Vimeo), title, collection (select), description (optional), featured (checkbox), display_order (number). On save, server hits oEmbed to fetch thumbnail URL and stores it. |
| `/admin/testimonials` | List + Add/Edit/Delete testimonials. Fields: quote (text), attribution (e.g. "Sarah & Marcus · Wedding · April 2026"), featured (checkbox), display_order (number). |

### 6.3 Database tables

```sql
CREATE TABLE portfolio_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  collection      TEXT NOT NULL,   -- 'aurora' | 'resonance' | 'visionary' | 'atelier' | 'smile'
  title           TEXT NOT NULL,
  url             TEXT NOT NULL,   -- YouTube or Vimeo URL
  thumbnail_url   TEXT,            -- oEmbed-fetched on save
  embed_id        TEXT,            -- parsed video id
  provider        TEXT,            -- 'youtube' | 'vimeo'
  description     TEXT,
  featured        INTEGER NOT NULL DEFAULT 0,
  display_order   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE testimonials (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  quote           TEXT NOT NULL,
  attribution     TEXT NOT NULL,
  featured        INTEGER NOT NULL DEFAULT 0,
  display_order   INTEGER NOT NULL DEFAULT 0
);
```

---

## 7. Data model: collections

`src/content/collections.ts` exports a typed array used by every collection-related page:

```ts
export interface Collection {
  slug: 'aurora' | 'resonance' | 'visionary' | 'atelier' | 'smile';
  displayName: string;      // 'The Aurora Collection'
  shortName: string;        // 'Aurora'
  tagline: string;          // 'lighting, video walls, luminous environments'
  philosophy: string;       // 2-3 paragraph philosophy block (brief §13 as draft)
  whatsIncluded: string[];  // 3-5 bullet points
  inquiryFormFields: InquiryFieldSpec[];  // brief §10 per-collection field list
  heroImage: string;        // path under /images/collections/
  cta: string;              // 'Start Your Video Wall Inquiry'
  voice: string;            // short copy tone descriptor for AI-assisted drafting later
}
```

This single file is the canonical source. Every collection page, inquiry form, and overview card reads from it. No collection content is hard-coded in page files.

---

## 8. Motion language (carried from hero into the rest of the site)

| Element | Motion |
|---|---|
| Page load | 800ms slow fade for non-hero pages; hero pages get the full choreography. |
| Cycler | Locked: 1000ms left-to-right wipe with gold light bar, 2800ms dwell per word. |
| Particles | Locked: 70 particles, full-hero coverage, longer life and faster vy than v4. Hero pages only. |
| Section reveals on scroll | Intersection Observer with a single `is-visible` class; fades + slides up 24px over 800ms with cubic-bezier(0.16, 1, 0.3, 1) easing. |
| Card hovers | 200ms ease — slight `translateY(-2px)` + gold border `:hover` transition + amber glow box-shadow. |
| Button hovers | Identical to booth intake's `.btn-gold` (translateY(-1px) + amber glow). |
| Form field focus | The gold underline glow from the booth intake (`.sn-underline-glow`), ported verbatim. |
| All motion | Honors `prefers-reduced-motion: reduce` — disables transforms/animations, keeps content fully accessible. |

---

## 9. Accessibility and SEO baseline

- Semantic HTML throughout: `<main>`, `<nav>`, `<section>`, `<article>`, `<button>` for actions, `<a>` for navigation.
- Color contrast: Champagne and Ivory both exceed AA on Obsidian Black. Gold-on-black is reserved for headings and accents that pass AA at 18pt+.
- Every image has an `alt`. Decorative SVGs have `aria-hidden="true"` and an empty alt.
- Forms have visible labels (not placeholder-as-label). Required fields are explicit. Error states use `aria-invalid` and `role="alert"`.
- `prefers-reduced-motion` disables all non-essential motion.
- Astro's built-in `sitemap-xml` integration generates `/sitemap.xml`.
- `/robots.txt` allows all crawlers, disallows `/admin`.
- OpenGraph tags on every page: title, description, og:image (a generated dark-luxury OG card per page; can use a placeholder gold-logo-on-black image for v1).
- Structured data: `LocalBusiness` JSON-LD on the homepage and About page.

---

## 10. Deployment

### 10.1 Docker setup

`apps/site/Dockerfile`:
- Multi-stage build (base → deps → build → runtime)
- Stage 1: Node 22-alpine, install deps with frozen lockfile
- Stage 2: build with `pnpm build` (Astro outputs to `dist/`)
- Stage 3: copy `dist/`, `node_modules/`, `package.json` to a fresh Node 22-alpine, expose port 3000, CMD `node dist/server/entry.mjs`

`docker-compose.yml` lives at the **repo root** (not inside `apps/site/`) so it can mount the shared `./data/` directory and so Coolify points its Git pipeline at the repo root:
- Service `site` runs `apps/site`
- Mounts `./data` as a volume so SQLite persists across container restarts
- Env vars: `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `NOTIFY_EMAIL`
- Coolify labels for `smile-nola.com` (Traefik routing + automatic Let's Encrypt cert)
- Restart policy: `unless-stopped`

### 10.2 Coolify deployment

The owner deploys via Coolify's existing pipeline (Git pull + `docker compose up -d`). No CI/CD setup required for v1 — manual deploy is fine.

---

## 11. Scope realism

This is a large scope for one day. Honest sequencing to derisk: build vertically, not horizontally. Order of work that gets the owner *something deployable as fast as possible*:

1. Astro scaffold + brand tokens + globals + LogoMark + DecoCorner + AmbientGlow components.
2. Homepage hero (port v5 from visual companion).
3. SiteHeader + SiteFooter.
4. Five-collection data file + homepage collection cards.
5. Docker + Coolify deploy. **First public deploy at this point — the homepage alone is already a credible outreach destination.**
6. Collection pages template + the 5 instances.
7. Inquiry forms (lightweight + endpoint + SQLite + email).
8. About page draft.
9. Contact page + deep form.
10. Admin auth + login.
11. Admin inquiries view + CSV export.
12. Admin portfolio CRUD + public portfolio page.
13. Admin testimonials CRUD + homepage testimonial pull.
14. Lighthouse + cross-browser pass.

If time runs out, anything after step 5 can ship later in the day or the next day without breaking the outreach flow — the homepage stands on its own.

## 12. What ships today vs deferred

**Today's ship list:**

- All public pages (Home, 5 collection pages, Collections overview, Portfolio, About, Contact)
- Both inquiry forms (lightweight + deep) saving to SQLite
- Email notification to owner on inquiry submission (if SMTP env vars present)
- Public portfolio reads from DB (empty state shown if no items yet)
- Public testimonials read from DB (section hidden if empty)
- Admin login + dashboard
- Admin inquiries view + CSV export
- Admin portfolio CRUD
- Admin testimonials CRUD
- Docker Compose deploy to smile-nola.com via Coolify with TLS

**Explicitly deferred (post-launch):**

- Per-user admin accounts (single password is sufficient for v1)
- Direct HoneyBook API integration (CSV export covers the workflow)
- Real photography (stock placeholders until owner provides real shots)
- Pricing/process page
- Blog or editorial content
- Multilingual support
- Advanced analytics beyond what Astro provides out of the box

---

## 13. Content responsibilities

**I draft, owner reviews before launch:**

- About page (3 sections, ~400 words total)
- Brand promise text on homepage
- "What's Included" bullets for each of the 5 collections
- Confirmation page copy
- Footer copy
- Meta titles/descriptions for SEO

**Owner provides directly:**

- Real testimonials (1-3 quotes with attribution) — added via admin after launch
- Real portfolio video URLs (YouTube/Vimeo) — added via admin after launch
- Smile NOLA contact email, phone, Instagram URL
- Domain DNS confirmation (already confirmed: owns smile-nola.com)
- Real event photography (post-launch swap-in)

**Brand brief §13 supplies:**

- Starting drafts for collection philosophy blocks (verbatim where the brief provides them)

---

## 14. Definition of done

Site is "done" for today's outreach send when:

1. `smile-nola.com` resolves and serves HTTPS with no cert warnings.
2. Every public page renders with no console errors and no missing assets.
3. Submitting both forms (lightweight + deep) succeeds and the inquiry appears in `/admin/inquiries`.
4. Admin login, portfolio add/delete, and testimonial add/delete all work end to end.
5. CSV export downloads a valid file with the booth intake's column shape.
6. Lighthouse desktop score ≥ 90 on Performance, Accessibility, Best Practices, SEO (homepage).
7. The homepage works on iPhone Safari and recent Chrome/Firefox at desktop and mobile widths.
8. `apps/intake/` still runs untouched.
9. `git status` is clean and the work is committed with a clear message.

Verification is required for items 1-8 by manually executing each one before declaring done. No verification = not done.

---

## 15. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Outreach goes out before the site is up | Build in vertical slices: home + 1 collection deployed first; rest follow within hours. |
| SMTP credentials not available today | Graceful degrade: inquiries still save to DB. Email is a nice-to-have, not blocking. |
| Coolify deploy fails | Local Docker Compose run as a fallback (`docker compose up` on a personal VPS) buys time to fix Coolify. |
| Stock photo licensing concerns | Use Unsplash only (free for commercial), keep a `public/images/CREDITS.md` listing each photographer. |
| Broadway double-decorating | Enforced via the `.lowercase` utility on every Broadway element. Code review the spec before merge. |
| SQLite write contention with booth intake | Booth intake uses WAL mode (`apps/intake/lib/db.ts`). Confirm site uses the same connection config. |

---

## 16. Open questions (non-blocking)

These are intentionally not decided in this spec and will surface during implementation:

- Exact testimonial layout (single big quote vs. carousel) — will mock in dev server and iterate
- Whether the Visionary Moment auto-plays or requires a click — will test both in dev server
- Mobile nav pattern (hamburger drawer vs. bottom sheet vs. inline) — will mock in dev server
- Whether `/admin` uses dark luxury or a more utilitarian palette — leaning dark luxury for consistency, will check with owner during build

These are deliberately left to implementation taste because they're better resolved in code than on paper.

---

**End of spec.**
