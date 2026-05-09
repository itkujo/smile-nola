# Smile NOLA — Conference Intake Form

**Status:** Approved & implemented (initial build)
**Date:** 2026-05-09
**Event:** New Orleans Bridal & Wedding Expo (next day)
**Project location:** `apps/intake/`

## Goal

A kiosk-style, multi-step inquiry form running on the host Linux machine, served to an iPad over Wi-Fi, that captures wedding leads at the New Orleans Bridal & Wedding Expo with cinematic Gatsby-luxury polish and exports a HoneyBook-ready CSV.

## Decisions locked during brainstorming

| Decision | Choice |
|---|---|
| Stack | Next.js 15 + React 19 + TypeScript + Tailwind v4 + Framer Motion + react-hook-form + Zod + better-sqlite3 |
| Form structure | Multi-step with cinematic transitions (5 steps: Welcome → POC → Celebration → Vision → Thank You) |
| Couple labels | Partner 1 / Partner 2 (inclusive) |
| Additional fields | POC relationship, preferred contact, services interested (collections multi-select). Skipped: guest count, venue city, budget. |
| Required fields | Strict minimum — partner 2, venue, notes are optional |
| Data flow | SQLite (`data/leads.db`) + HoneyBook CSV download via `/api/export` |
| Booth iPad usage | Kiosk-only; admin from laptop only |
| Post-submit | Cinematic Holimount thank-you with names, auto-reset after ~9s |
| Fonts | Holimount + Broadway from dafont (downloaded into `public/fonts/`); Poppins from Google Fonts |
| Source tag | "New Orleans Bridal and Wedding Expo" auto-applied to every submission |

## Field schema (single source of truth: `lib/schema.ts`)

Required:
- POC: name, email, phone, relationship (chip), preferred contact (chip)
- Celebration: Partner 1 name, event date
- Vision: setting (chip), at least one collection (multi-select cards)

Optional:
- Partner 2 name, venue name, notes

Auto-captured:
- `capturedAt` (server timestamp), `source` (the expo)

## Architecture

```
smile-nola/
├── apps/intake/                ← Next.js app
│   ├── app/
│   │   ├── page.tsx            ← Form (kiosk view)
│   │   ├── admin/page.tsx      ← Lead list + CSV export
│   │   └── api/                ← submit, export, leads CRUD
│   ├── components/
│   │   ├── form/               ← IntakeForm, steps, fields
│   │   └── brand/              ← LogoMark, DecoCorner, GoldDivider
│   ├── lib/
│   │   ├── schema.ts           ← Zod schema, single source of truth
│   │   ├── db.ts               ← better-sqlite3 singleton
│   │   ├── csv.ts              ← HoneyBook CSV serializer
│   │   └── motion.ts           ← Framer Motion presets
│   ├── public/fonts/           ← Holimount.otf, Broadway.ttf
│   ├── scripts/start-booth.sh  ← LAN launcher with QR code
│   ├── BOOTH_SETUP.md
│   └── styles → app/globals.css with brand tokens
└── data/leads.db               ← SQLite (gitignored)
```

## Brand implementation

CSS tokens directly from Brand Brief §6 in `app/globals.css`:

- `--sn-black`, `--sn-soft-black`, `--sn-gold`, `--sn-antique-gold`, `--sn-champagne`, `--sn-ivory`, `--sn-amber`, `--sn-muted-stone`
- `--font-signature` (Holimount), `--font-deco` (Broadway), `--font-body` (Poppins)

Type rules honored:
- Broadway only on display headlines and collection names (Brand Brief §5)
- Poppins on all forms, labels, buttons, body
- Holimount reserved for the **single** thank-you moment ("the champagne pour")

Visual rules honored:
- Black and soft-black backgrounds; gold as borders, accents, and headlines (never fill)
- Art Deco corner brackets at form-card corners and selected collection cards
- Subtle ambient amber radial glow on welcome and thank-you screens
- Light-sweep gold gradient behind step headlines on entry
- Compositor-only motion (transform/opacity)

## Motion language

- **Step transitions:** content slides up 28px + fades + 6px blur exit/enter, 550ms cubic-bezier(0.16, 1, 0.3, 1)
- **Headline reveal:** character-level stagger, 25ms apart, with blur and y-translation
- **Field stagger:** 70ms apart with 180ms initial delay
- **Light sweep:** 1400ms gradient translate at step entry
- **Chip select:** scale 0.97 → 1 on tap; gold fill + amber glow on selected
- **Progress bar:** thin gold rail with Art Deco corner brackets, smooth fill animation
- **Reduced-motion** media query overrides everything to short fades

## Data flow

1. Form fields validated client-side via react-hook-form + Zod resolver
2. `POST /api/submit` re-validates with the same Zod schema, inserts into SQLite
3. `GET /api/export` returns HoneyBook-friendly CSV with BOM (Excel UTF-8)
4. `GET /api/leads` powers the admin list
5. `DELETE /api/leads/:id` soft-deletes (sets `deleted_at`)

## CSV columns (HoneyBook-friendly)

```
First Name, Last Name, Email, Phone, Project Name, Event Date,
Event Type, Source, Setting, Preferred Contact, POC Relationship,
Venue, Services Interested, Notes, Captured At
```

POC name is split on first space → First/Last. Project name = `[Partner 1] & [Partner 2] Wedding` (omits the `&` if no Partner 2). All values RFC 4180 escaped (commas, quotes, newlines).

## Booth networking

`scripts/start-booth.sh`:
1. Detects LAN IPv4
2. Builds production bundle if `.next` is missing
3. Prints URLs and a terminal QR code
4. Starts `next start` bound to `0.0.0.0:3000`

iPad workflow:
1. Scan QR → open in Safari
2. Share → Add to Home Screen → launch fullscreen
3. (Optional) Settings → Accessibility → Guided Access for hard kiosk lock

PWA manifest sets `display: standalone`, dark theme, brand icons.

## Out of scope (intentionally deferred)

- Five collection-specific deep inquiry forms (separate marketing-site project)
- Marketing pages, navigation, public site
- Authentication / multi-user admin
- Direct HoneyBook webhook (manual CSV import was requested)
- Email notifications
- Analytics

## Known follow-ups (post-event)

- Replace placeholder Smile NOLA wordmark in `LogoMark.tsx` with actual gold script artwork once Daniel provides the file
- Verify HoneyBook's exact CSV column names against current import flow during first import; tweak `lib/csv.ts` if needed
- Consider building the Astro marketing site as `apps/site/` (separate project from the brand brief's broader scope)
- Convert OTF/TTF fonts to subset .woff2 for performance once not under time pressure
