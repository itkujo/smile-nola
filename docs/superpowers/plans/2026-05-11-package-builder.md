# Package Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the "Build Your Smile NOLA Event Experience" package builder as a v1 qualify-stage
self-service quote tool, plus the Resend email migration it depends on, on the existing Astro
marketing site without touching `apps/intake/`.

**Architecture:** Astro 5 SSR with a single React island for the interactive builder. Submissions
land in a new `package_builder_submissions` SQLite table alongside the existing `inquiries`.
Server-side recompute against a canonical pricing catalog (`apps/site/src/lib/builder/catalog.ts`)
prevents tamper. Resend replaces nodemailer for all outbound mail.

**Tech Stack:** Astro 5, React 18 (island only, `client:load`), TypeScript, Zod, better-sqlite3,
Resend SDK, Tailwind v4. No Framer Motion in v1 (CSS transitions only).

**Companion spec:** `docs/superpowers/specs/2026-05-11-package-builder-design.md`. Read it before
starting. Pricing tables come from `docs/superpowers/handoffs/2026-05-10-package-builder-spec.md`.

**Branch:** All work happens on `feature/package-builder` (already created, ahead of `main` by
one commit holding the spec). Push to `origin` only after the user gives the green light.

---

## Execution rules

- **Do not push to `origin`.** Local commits only until the user says ship it.
- **Do not touch `apps/intake/`.** Production booth app. Off-limits.
- **Run `pnpm typecheck` from `apps/site/`** before declaring any non-trivial task done. The
  expected output is `0 errors`. Don't claim success on a typecheck-broken tree.
- **The Resend API key was pasted in chat** and lives in `apps/site/.env` (gitignored). Treat it
  as compromised — the user has been asked to rotate it. Implementations should read
  `RESEND_API_KEY` from env and never log its value.
- **Database writes during local dev** must NOT touch the production `data/leads.db` rows. Use
  the table-creation idempotency (`CREATE TABLE IF NOT EXISTS`) — new tables only, never alter
  existing ones. Test submissions are fine; they're tagged with `source = 'cold-builder'` or
  `'invited-builder'` and easy to delete from `/admin/package-builder` later.
- **No emoji in source code or commits.** Brand convention.
- **Frequent commits.** Each task ends with a `git commit` step. Conventional-commit prefixes:
  `feat(builder)`, `fix(builder)`, `refactor(email)`, `test(builder)`, `chore(builder)`, etc.
- **Stop at task boundaries for review.** The user wants checkpoint review between clusters.

---

## File map (created or modified by this plan)

```
apps/site/
├── astro.config.mjs                         [MODIFY] add @astrojs/react
├── package.json                             [MODIFY] +react, +react-dom, +@astrojs/react,
│                                                     +resend; remove nodemailer
├── .env.example                             [N/A — already updated in spec commit]
├── public/build/
│   └── (no static assets — React handles UI)
└── src/
    ├── pages/
    │   ├── build.astro                      [CREATE] hosts the React island
    │   ├── api/
    │   │   ├── package-builder.ts           [CREATE] POST submission
    │   │   ├── package-builder/invite.ts    [CREATE] POST admin invite-create
    │   │   └── package-builder/invite/
    │   │       └── [token].ts               [CREATE] GET invite prefill
    │   └── admin/
    │       ├── package-builder/
    │       │   ├── index.astro              [CREATE] list page
    │       │   └── [id].astro               [CREATE] detail page + status actions
    │       └── inquiries/
    │           └── [id].astro               [MODIFY] add "Copy invite link" button
    ├── lib/
    │   ├── builder/
    │   │   ├── catalog.ts                   [CREATE] canonical pricing
    │   │   ├── catalog.test.ts              [CREATE] shape sanity tests
    │   │   ├── compute.ts                   [CREATE] server-side recompute + warnings
    │   │   ├── compute.test.ts              [CREATE] pricing + warning unit tests
    │   │   ├── invites.ts                   [CREATE] CRUD for builder_invites
    │   │   ├── submissions.ts               [CREATE] CRUD for package_builder_submissions
    │   │   └── readable-summary.ts          [CREATE] structured -> human-readable string
    │   ├── db.ts                            [MODIFY] add two new CREATE TABLEs + row types
    │   ├── schema.ts                        [MODIFY] add BuilderSubmissionSchema
    │   ├── auth.ts                          [MODIFY] extract generic rateLimit()
    │   ├── email.ts                         [REWRITE] Resend transport; add
    │   │                                                sendBuilderSubmissionNotification()
    │   └── env.ts                           [N/A — already provides getEnv()]
    └── components/
        └── builder/                         [CREATE]
            ├── Builder.tsx                  React island root (client:load)
            ├── BuilderHeader.tsx
            ├── CollectionChips.tsx
            ├── CollectionSection.tsx
            ├── PackageCard.tsx
            ├── AddonRow.tsx
            ├── QtyStepper.tsx
            ├── EventDetails.tsx
            ├── ConsultationPreference.tsx
            ├── ContactBlock.tsx
            ├── InvestmentRail.tsx
            ├── MobileRailBar.tsx
            ├── SuccessCard.tsx
            ├── useBuilderState.ts            hook: selections + totals + persistence
            └── builder.css                   scoped styles for the island
```

---

## Task ordering rationale

Tasks are grouped into clusters. Each cluster ends in a state where `pnpm typecheck` is clean and
the work can be reviewed independently.

1. **Cluster A — Plumbing.** Install React, set up the catalog file, write the pure compute
   function with unit tests. No UI, no DB.
2. **Cluster B — Persistence.** Database schema, submission CRUD, invite CRUD. Still no UI.
3. **Cluster C — Email migration.** Resend rollout. Replaces nodemailer for the contact form
   first (low-risk regression target) and adds the builder notification helper.
4. **Cluster D — Server endpoints.** Wire the API routes that the React island will call.
5. **Cluster E — Builder UI.** React island, components, state, persistence.
6. **Cluster F — Admin surfaces.** Invite trigger + submission list + detail + status actions.
7. **Cluster G — Verification.** Manual test matrix from spec §13.1.

---

## Cluster A — Plumbing

### Task A1: Install React + @astrojs/react

**Files:**
- Modify: `apps/site/package.json`
- Modify: `apps/site/astro.config.mjs`

- [ ] **Step 1: Install React and the Astro integration**

Run from `apps/site/`:
```bash
pnpm add react@^18.3.1 react-dom@^18.3.1 @astrojs/react@^4.2.0
pnpm add -D @types/react@^18.3.5 @types/react-dom@^18.3.0
```

Expected: lockfile updates, no errors. `pnpm-lock.yaml` shows the four new entries.

- [ ] **Step 2: Register the integration in `astro.config.mjs`**

Edit `apps/site/astro.config.mjs`. Add `import react from "@astrojs/react";` at the top with the
other imports, then add `integrations: [react()],` to the config object.

After editing, the file should read (relevant parts):
```js
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [react()],
  // ... rest unchanged
});
```

- [ ] **Step 3: Typecheck**

Run from `apps/site/`:
```bash
pnpm typecheck
```
Expected: `0 errors, 0 warnings, 0 hints`. If errors, fix before committing.

- [ ] **Step 4: Commit**

```bash
cd /home/phoenix/code/smile-nola
git add apps/site/package.json apps/site/pnpm-lock.yaml apps/site/astro.config.mjs
git commit -m "chore(site): add React island support for package builder

React + @astrojs/react are installed exclusively for the upcoming /build
page's interactive island. Marketing pages stay zero-JS — React ships
only on routes that use a React component."
```

---

### Task A2: Add `getRequiredEnv` helper

The Resend transport needs a strict env var read that throws when missing (so misconfiguration
fails loudly during boot, not silently when the first email tries to send). Existing `getEnv()`
returns empty string on missing — keep that for soft reads (NOTIFY_EMAIL etc.) and add a new
strict variant.

**Files:**
- Modify: `apps/site/src/lib/env.ts`

- [ ] **Step 1: Read the current file**

```bash
cat apps/site/src/lib/env.ts
```
Confirm it exports `getEnv(name: string): string` and nothing else (or note what else it has).

- [ ] **Step 2: Add `getRequiredEnv`**

Append to `apps/site/src/lib/env.ts`:

```ts
/**
 * Strict env read — throws if the variable is missing or empty.
 * Use for transports/secrets where a silent fallback would mask a real
 * configuration bug (e.g. RESEND_API_KEY, ADMIN_SESSION_SECRET).
 */
export function getRequiredEnv(name: string): string {
  const v = getEnv(name).trim();
  if (!v) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Set it in apps/site/.env locally and in the Coolify env UI for production.`
    );
  }
  return v;
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/lib/env.ts
git commit -m "feat(env): add getRequiredEnv strict reader

Throws on missing/empty values. Used by the Resend transport so a
missing RESEND_API_KEY surfaces immediately at first use instead of
silently failing every email send."
```

---

### Task A3: Create the canonical pricing catalog

The most important data file in the feature. Pricing tables come verbatim from
`docs/superpowers/handoffs/2026-05-10-package-builder-spec.md` §"Collection data and pricing".
Both the React island and the server endpoint import from this module.

**Files:**
- Create: `apps/site/src/lib/builder/catalog.ts`

- [ ] **Step 1: Create the directory and write the catalog**

```bash
mkdir -p apps/site/src/lib/builder
```

Create `apps/site/src/lib/builder/catalog.ts` with the following content:

```ts
/**
 * Canonical pricing catalog for the package builder.
 *
 * Single source of truth for both the React island (client-side rendering and
 * tentative totals) and the server endpoint (authoritative recompute). Edit
 * this file to change prices; nothing else in the codebase should hard-code
 * a builder price.
 *
 * Units: cents (integers). Display layer formats to dollars.
 *
 * Source data: docs/superpowers/handoffs/2026-05-10-package-builder-spec.md
 * §"Collection data and pricing — canonical".
 */

export type PriceType = "fixed" | "starting" | "custom";

export interface AddonConfig {
  id: string;
  name: string;
  /** Cents per unit. null when priceType is "custom" (quoted later). */
  priceCents: number | null;
  priceType: PriceType;
  /** When true the UI renders a quantity stepper. */
  qty?: boolean;
  /** Optional cap on the quantity stepper (e.g., LED expansion max 4). */
  qtyMax?: number;
  /** Short caption rendered next to the price (e.g., "client keeps after event"). */
  note?: string;
}

export interface PackageConfig {
  id: string;
  name: string;
  priceCents: number;
  duration?: string;
  description?: string;
  includes?: string[];
}

export type CollectionId =
  | "smile"
  | "visionary"
  | "digital-atelier"
  | "aurora"
  | "resonance";

export interface CollectionConfig {
  id: CollectionId;
  displayName: string;
  shortDescription: string;
  /** Rendering order across the builder; lower = higher on the page. */
  displayOrder: number;
  rules: {
    /** Smile / Visionary: must pick exactly one base package. */
    requireOneBasePackage?: boolean;
    /** Digital Atelier: may pick one or more services as "packages". */
    allowMultiplePackages?: boolean;
    /** Aurora: 200_000 cents = $2,000 project minimum, evaluated against TOTAL spend. */
    projectMinimumCents?: number;
    /** Resonance: the $2,000 minimum has a single exception (ceremony speaker). */
    minimumExceptionAddonIds?: string[];
  };
  packages: PackageConfig[];
  addons: AddonConfig[];
}

export const COLLECTIONS: CollectionConfig[] = [
  // ============================================================
  // 1. THE SMILE COLLECTION — photo experiences
  // ============================================================
  {
    id: "smile",
    displayName: "The Smile Collection",
    shortDescription:
      "Photo experiences designed to feel like part of the event — polished, guest-friendly, layered into the overall design.",
    displayOrder: 1,
    rules: { requireOneBasePackage: true },
    packages: [
      {
        id: "memory-booth",
        name: "The Memory Booth",
        priceCents: 69500,
        duration: "3 hours",
        description:
          "Refined 3-hour photo experience with custom overlay design, on-site attendant, guest sharing via text/email/QR/gallery, digital gallery.",
      },
      {
        id: "mirror-me",
        name: "The Mirror Me Experience",
        priceCents: 89500,
        duration: "3 hours",
        description:
          "Premium 3-hour interactive mirror booth with branded prints, polished guest flow, custom overlay design, guest sharing, attendant support.",
      },
      {
        id: "mirror-me-all-night",
        name: "The Mirror Me Experience, All Night",
        priceCents: 119500,
        duration: "full event",
        description:
          "Mirror Me for the full event — ideal when you want the booth active throughout.",
      },
    ],
    addons: [
      { id: "smile-additional-hour",  name: "Additional Service Time", priceCents: 15000, priceType: "fixed", qty: true, note: "per hour" },
      { id: "audio-guest-book",       name: "Audio Guest Book — Cherish the Beep", priceCents: 27500, priceType: "fixed" },
      { id: "scrapbook-service",      name: "Scrapbook Service + Album", priceCents: 15000, priceType: "fixed" },
      { id: "backdrop-hedge",         name: "Hedge Wall Backdrop", priceCents: 30000, priceType: "fixed", note: "inventory — stays with Smile NOLA" },
      { id: "backdrop-bayou",         name: "Bayou Fairy Tale Backdrop", priceCents: 25000, priceType: "fixed", note: "inventory — stays with Smile NOLA" },
      { id: "backdrop-basic",         name: "Basic Black or White Backdrop", priceCents: 20000, priceType: "fixed", note: "inventory — stays with Smile NOLA" },
      { id: "custom-props-pack",      name: "Custom Props / Signs — Pack of 5", priceCents: 10000, priceType: "fixed" },
      { id: "red-carpet",             name: "Red Carpet & Stanchions", priceCents: 15000, priceType: "fixed" },
      { id: "booth-uplighting",       name: "Photo Booth Area Uplighting", priceCents: 17500, priceType: "fixed" },
      { id: "backdrop-vinyl",         name: "Custom 8×8 Vinyl Backdrop", priceCents: 30000, priceType: "fixed", note: "client keeps after event" },
      { id: "backdrop-tension",       name: "Custom 8×8 Tension-Fabric Backdrop", priceCents: 45000, priceType: "fixed", note: "client keeps after event" },
    ],
  },

  // ============================================================
  // 2. THE VISIONARY SUITE — cinematic videography
  // ============================================================
  {
    id: "visionary",
    displayName: "The Visionary Suite",
    shortDescription:
      "Cinematic videography for weddings and events that deserve to be remembered with emotion, movement, and intention.",
    displayOrder: 2,
    rules: { requireOneBasePackage: true },
    packages: [
      {
        id: "visionary-highlight",
        name: "Visionary Highlight Film",
        priceCents: 150000,
        description:
          "Cinematic highlight film with founder-led capture, gimbal-stabilized movement, and color-graded delivery — without stepping into full luxury multi-videographer territory.",
        includes: [
          "Founder-led wedding/event day capture",
          "Single videographer coverage",
          "Gimbal-stabilized camera movement",
          "Ceremony and toast audio capture when practical/scoped",
          "Cinematic highlight film",
          "Teaser video",
          "Color-graded delivery",
          "Online delivery link",
        ],
      },
      {
        id: "visionary-signature",
        name: "Visionary Signature Film",
        priceCents: 250000,
        description:
          "Stronger cinematic coverage for events that need more angles, reactions, and a more complete emotional story.",
        includes: [
          "Everything in Visionary Highlight Film",
          "Second shooter",
          "Expanded ceremony/reception coverage",
          "More guest, detail, and reaction coverage",
          "Stronger multi-angle storytelling",
        ],
      },
    ],
    addons: [
      { id: "rehearsal-coverage", name: "Rehearsal Dinner Coverage", priceCents: 50000, priceType: "fixed" },
      { id: "visionary-travel",   name: "Travel Fee", priceCents: null,       priceType: "custom", note: "per travel rules" },
    ],
  },

  // ============================================================
  // 3. THE DIGITAL ATELIER — web + design
  // ============================================================
  {
    id: "digital-atelier",
    displayName: "The Digital Atelier",
    shortDescription:
      "Event websites, RSVP systems, branding, and guest-facing digital design.",
    displayOrder: 3,
    rules: { allowMultiplePackages: true },
    packages: [
      {
        id: "event-logo-brand",
        name: "Event Logo & Brand Design",
        priceCents: 50000,
        description:
          "Custom event logo, monogram, or visual mark for weddings, celebrations, private events, and branded experiences.",
        includes: [
          "Custom event logo / monogram / mark",
          "Basic event color direction",
          "Font / style direction",
          "Digital logo files for event use",
          "Designed for invitations, signage, websites, printed details",
        ],
      },
      {
        id: "event-website-rsvp",
        name: "Event Website & RSVP",
        priceCents: 150000,
        description: "Polished event website + RSVP experience.",
        includes: [
          "Custom event website",
          "Mobile-friendly design",
          "Event details page",
          "RSVP or guest information form",
          "Schedule / location / hotel / registry sections as needed",
          "Launch support",
        ],
      },
      {
        id: "premium-event-experience",
        name: "Premium Event Website & Guest Experience",
        priceCents: 250000,
        description:
          "More complete digital guest experience with expanded design, guest information collection, and stronger event branding integration.",
        includes: [
          "Everything in Event Website & RSVP",
          "Expanded page/section structure",
          "More refined visual design",
          "Custom integration setup",
          "Guest information collection",
          "Custom event branding integration",
          "Post-launch support window",
        ],
      },
    ],
    addons: [
      { id: "extra-page",          name: "Additional website page / section", priceCents: 25000, priceType: "fixed", qty: true },
      { id: "custom-integration",  name: "Custom Integration Setup",          priceCents: 35000, priceType: "fixed" },
      { id: "custom-domain-setup", name: "Custom domain setup",               priceCents: 15000, priceType: "fixed" },
      { id: "digital-invite",      name: "Digital invitation design",         priceCents: 35000, priceType: "fixed" },
      { id: "printed-invite",      name: "Printed invitation design file",    priceCents: 35000, priceType: "fixed" },
      { id: "menu-design",         name: "Menu design",                       priceCents: 15000, priceType: "fixed" },
      { id: "program-design",      name: "Program design",                    priceCents: 25000, priceType: "fixed" },
      { id: "seating-chart",       name: "Seating chart design",              priceCents: 25000, priceType: "fixed" },
      { id: "welcome-sign",        name: "Welcome sign design",               priceCents: 15000, priceType: "fixed" },
      { id: "bar-sign",            name: "Bar / signature drink sign design", priceCents: 12500, priceType: "fixed" },
      { id: "rush-launch",         name: "Rush launch",                       priceCents: 50000, priceType: "fixed" },
      { id: "post-event-gallery",  name: "Post-event gallery page",           priceCents: 35000, priceType: "fixed" },
      { id: "extra-revision",      name: "Additional design revision round",  priceCents: 15000, priceType: "fixed", qty: true },
    ],
  },

  // ============================================================
  // 4. THE AURORA COLLECTION — lighting + LED + staging
  // ============================================================
  {
    id: "aurora",
    displayName: "The Aurora Collection",
    shortDescription:
      "Lighting, LED video walls, staging, and luminous atmosphere. Requires a $2,000 total Smile NOLA project minimum.",
    displayOrder: 4,
    rules: { projectMinimumCents: 200000 },
    packages: [],
    addons: [
      // LED wall
      { id: "led-wall-experience", name: "LED Video Wall Experience",                                         priceCents: 300000, priceType: "fixed",   note: "up to 10 panels · 500mm × 1000mm each" },
      { id: "led-wall-expansion",  name: "LED Wall Expansion",                                                priceCents: 50000,  priceType: "fixed", qty: true, qtyMax: 4, note: "per panel · adds beyond 10" },
      { id: "led-wall-full",       name: "Full LED Wall Experience",                                          priceCents: 500000, priceType: "fixed",   note: "full 14-panel config with expanded support" },

      // Lighting & visual
      { id: "uplighting-apelabs",  name: "ApeLabs Wireless Uplighting",                                       priceCents: 5000,   priceType: "fixed", qty: true, note: "per fixture" },
      { id: "pin-spot-apelabs",    name: "ApeLabs Pin Spot Lighting",                                         priceCents: 7500,   priceType: "fixed", qty: true, note: "per fixture · cakes, florals, sweetheart tables" },
      { id: "neon-pix-apelabs",    name: "ApeLabs Neon Pix",                                                  priceCents: 5000,   priceType: "fixed", qty: true, note: "per fixture · accents, texture" },
      { id: "monogram-projection", name: "Interactive Monogram Projection",                                   priceCents: 50000,  priceType: "starting", note: "advanced effects quoted separately" },
      { id: "dance-floor-lighting",name: "Dance Floor Lighting Package",                                      priceCents: 75000,  priceType: "fixed",   note: "haze/lasers/moving-head upgrades quoted separately" },
      { id: "hazer",               name: "Hazers",                                                            priceCents: 25000,  priceType: "fixed", qty: true, note: "each · subject to venue approval" },
      { id: "lasers",              name: "Lasers",                                                            priceCents: 75000,  priceType: "starting", note: "depends on venue / safety / programming" },
      { id: "moving-head-single",  name: "Moving Heads",                                                      priceCents: 15000,  priceType: "fixed", qty: true, note: "per fixture" },
      { id: "moving-head-4pkg",    name: "Moving Heads Package — 4 Fixtures",                                 priceCents: 50000,  priceType: "fixed" },
      { id: "moving-head-8pkg",    name: "Moving Heads Package — 8 Fixtures",                                 priceCents: 90000,  priceType: "fixed" },

      // Staging
      { id: "stage-section",       name: "Staging — 4×8 Section",                                             priceCents: 12500,  priceType: "fixed", qty: true, note: "per section · final pricing may vary" },
      { id: "stage-steps",         name: "Stage Steps",                                                       priceCents: 7500,   priceType: "fixed" },
      { id: "stage-skirting",      name: "Stage Skirting",                                                    priceCents: 200,    priceType: "fixed", qty: true, note: "per linear foot" },

      // Content & production add-ons
      { id: "custom-visual-loop",  name: "Custom Visual Loop",                                                priceCents: 50000,  priceType: "fixed" },
      { id: "slideshow-build",     name: "Slideshow Build",                                                   priceCents: 35000,  priceType: "fixed" },
      { id: "logo-loop",           name: "Logo Loop / Branded Motion Background",                             priceCents: 35000,  priceType: "fixed" },
      { id: "extra-operator-hour", name: "Extra Operator Hour",                                               priceCents: 12500,  priceType: "fixed", qty: true, note: "per hour" },
      { id: "early-setup",         name: "Additional Load-In / Early Setup",                                  priceCents: 25000,  priceType: "fixed" },
      { id: "outdoor-complexity",  name: "Outdoor / Covered Setup Complexity",                                priceCents: null,   priceType: "custom" },
      { id: "power-distribution",  name: "Power Distribution Support",                                        priceCents: null,   priceType: "custom" },
    ],
  },

  // ============================================================
  // 5. THE RESONANCE SERIES — concert-grade sound
  // ============================================================
  {
    id: "resonance",
    displayName: "The Resonance Series",
    shortDescription:
      "Concert-grade sound for celebrations. Every Resonance proposal begins with a planning conversation; pricing starts at $2,000 except the ceremony-speaker exception.",
    displayOrder: 5,
    rules: { minimumExceptionAddonIds: ["ceremony-speaker", "ceremony-wireless-mic"] },
    packages: [],
    addons: [
      { id: "resonance-minimum",       name: "Resonance Minimum Spend",                                 priceCents: 200000, priceType: "fixed", note: "starting point · planning conversation required" },
      { id: "ceremony-speaker",        name: "Ceremony Speaker À La Carte",                             priceCents: 35000,  priceType: "fixed", note: "the only Resonance item available below the $2,000 minimum" },
      { id: "ceremony-wireless-mic",   name: "Optional wireless microphone",                            priceCents: 15000,  priceType: "fixed", qty: true, note: "add-on to Ceremony Speaker · per mic" },
    ],
  },
];

/* ============================================================================
 * Lookup helpers — both client and server import these.
 * ========================================================================== */

const _collectionById = new Map<CollectionId, CollectionConfig>();
for (const c of COLLECTIONS) _collectionById.set(c.id, c);

export function getCollection(id: string): CollectionConfig | undefined {
  return _collectionById.get(id as CollectionId);
}

export function getPackage(
  collectionId: string,
  packageId: string,
): PackageConfig | undefined {
  return getCollection(collectionId)?.packages.find((p) => p.id === packageId);
}

export function getAddon(
  collectionId: string,
  addonId: string,
): AddonConfig | undefined {
  return getCollection(collectionId)?.addons.find((a) => a.id === addonId);
}

/** All collection ids, in display order. Useful for rendering. */
export const COLLECTION_DISPLAY_ORDER: CollectionId[] = [...COLLECTIONS]
  .sort((a, b) => a.displayOrder - b.displayOrder)
  .map((c) => c.id);
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/site/src/lib/builder/catalog.ts
git commit -m "feat(builder): canonical pricing catalog

Single source of truth for every collection, package, and add-on the
package builder offers. Prices in cents (integers). Both the React
island and the server endpoint import from this module — server
recompute reads canonical prices to defeat tampering.

Verbatim from docs/superpowers/handoffs/2026-05-10-package-builder-spec.md
§'Collection data and pricing — canonical'."
```

---

### Task A4: Write unit tests for the catalog shape

Lightweight invariant tests. Catches typos like duplicate ids or negative prices before they bite
in production.

**Files:**
- Create: `apps/site/src/lib/builder/catalog.test.ts`

> **Test framework note:** The site does not currently have a test runner. We'll add `vitest`
> with this task — it's the standard pairing for Astro + Vite projects and reuses the same Vite
> config. If the user has a strong preference for a different framework, ask before installing.

- [ ] **Step 1: Install vitest**

Run from `apps/site/`:
```bash
pnpm add -D vitest@^2.1.0
```

- [ ] **Step 2: Add the `test` script to `apps/site/package.json`**

Add to the `scripts` block (keep all existing scripts):
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Write the failing test**

Create `apps/site/src/lib/builder/catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COLLECTIONS, getAddon, getCollection, getPackage } from "./catalog";

describe("catalog invariants", () => {
  it("has all five collections", () => {
    const ids = COLLECTIONS.map((c) => c.id).sort();
    expect(ids).toEqual(["aurora", "digital-atelier", "resonance", "smile", "visionary"]);
  });

  it("has no duplicate package ids within a collection", () => {
    for (const c of COLLECTIONS) {
      const ids = c.packages.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("has no duplicate addon ids within a collection", () => {
    for (const c of COLLECTIONS) {
      const ids = c.addons.map((a) => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("packages all have positive integer cent prices", () => {
    for (const c of COLLECTIONS) {
      for (const p of c.packages) {
        expect(Number.isInteger(p.priceCents)).toBe(true);
        expect(p.priceCents).toBeGreaterThan(0);
      }
    }
  });

  it("fixed addons have a positive priceCents; custom addons have null", () => {
    for (const c of COLLECTIONS) {
      for (const a of c.addons) {
        if (a.priceType === "custom") {
          expect(a.priceCents).toBeNull();
        } else {
          expect(a.priceCents).not.toBeNull();
          expect(Number.isInteger(a.priceCents)).toBe(true);
          expect(a.priceCents).toBeGreaterThan(0);
        }
      }
    }
  });

  it("Aurora has a $2,000 project minimum", () => {
    const aurora = getCollection("aurora");
    expect(aurora?.rules.projectMinimumCents).toBe(200000);
  });

  it("Resonance ceremony speaker is the minimum exception", () => {
    const res = getCollection("resonance");
    expect(res?.rules.minimumExceptionAddonIds).toContain("ceremony-speaker");
  });

  it("LED wall expansion is qty-capped at 4", () => {
    const exp = getAddon("aurora", "led-wall-expansion");
    expect(exp?.qty).toBe(true);
    expect(exp?.qtyMax).toBe(4);
  });

  it("getPackage / getAddon return undefined for unknown ids", () => {
    expect(getPackage("smile", "nonexistent")).toBeUndefined();
    expect(getAddon("aurora", "nonexistent")).toBeUndefined();
    expect(getCollection("nonexistent")).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test
```
Expected: all 9 tests PASS. If a test fails, fix the catalog (most likely a duplicate id or a
wrong price); don't loosen the test.

- [ ] **Step 5: Commit**

```bash
git add apps/site/package.json apps/site/pnpm-lock.yaml apps/site/src/lib/builder/catalog.test.ts
git commit -m "test(builder): vitest + catalog invariant tests

Vitest installed as the test runner (reuses Astro's Vite config).
Tests cover the catalog shape — duplicate-id detection, price-type
consistency, the Aurora minimum, the Resonance ceremony-speaker
exception, and the LED-wall-expansion cap."
```

---

### Task A5: Write the pure server-side recompute function

The function the API endpoint will call to recompute totals and warnings from a submitted
selections payload. **Pure** — takes selections + catalog, returns totals + warnings. No I/O.
TDD: tests first, then implementation.

**Files:**
- Create: `apps/site/src/lib/builder/compute.test.ts`
- Create: `apps/site/src/lib/builder/compute.ts`

- [ ] **Step 1: Define the types and write the failing tests**

Create `apps/site/src/lib/builder/compute.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeSubmission } from "./compute";
import type { BuilderSelections } from "./compute";

function sel(partial: Partial<BuilderSelections> = {}): BuilderSelections {
  return {
    collections: [],
    packages: [],
    addons: [],
    ...partial,
  };
}

describe("computeSubmission — Smile basics", () => {
  it("sums Memory Booth + Audio Guest Book", () => {
    const r = computeSubmission(
      sel({
        collections: ["smile"],
        packages: [{ collectionId: "smile", packageId: "memory-booth" }],
        addons:    [{ collectionId: "smile", addonId: "audio-guest-book", qty: 1 }],
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixedSubtotalCents).toBe(69500 + 27500); // $970.00
    expect(r.warnings).toEqual([]);
    expect(r.customQuoted).toEqual([]);
  });

  it("multiplies quantities correctly", () => {
    const r = computeSubmission(
      sel({
        collections: ["smile"],
        packages: [{ collectionId: "smile", packageId: "mirror-me" }],
        addons:    [{ collectionId: "smile", addonId: "smile-additional-hour", qty: 3 }],
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixedSubtotalCents).toBe(89500 + 15000 * 3);
  });
});

describe("computeSubmission — Aurora minimum warning", () => {
  it("triggers warning at $1,999.99", () => {
    const r = computeSubmission(
      sel({
        collections: ["aurora"],
        // 39 uplighting fixtures × $50 = $1,950 ($1,999.99 isn't reachable with these prices,
        // so we pick a sub-$2k combo and verify the warning fires).
        addons: [{ collectionId: "aurora", addonId: "uplighting-apelabs", qty: 39 }],
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixedSubtotalCents).toBe(5000 * 39);
    expect(r.warnings).toContainEqual(
      expect.objectContaining({ code: "aurora-minimum-not-met" })
    );
  });

  it("does NOT trigger when total >= $2,000", () => {
    const r = computeSubmission(
      sel({
        collections: ["aurora"],
        addons: [{ collectionId: "aurora", addonId: "led-wall-experience", qty: 1 }],
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixedSubtotalCents).toBe(300000);
    expect(r.warnings.find((w) => w.code === "aurora-minimum-not-met")).toBeUndefined();
  });

  it("counts spend from OTHER collections toward the Aurora minimum (total scope)", () => {
    const r = computeSubmission(
      sel({
        collections: ["smile", "aurora"],
        // Mirror Me $895 + 23 uplighting × $50 = $895 + $1150 = $2045
        packages: [{ collectionId: "smile",  packageId: "mirror-me" }],
        addons:   [{ collectionId: "aurora", addonId: "uplighting-apelabs", qty: 23 }],
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixedSubtotalCents).toBe(89500 + 5000 * 23);
    expect(r.warnings.find((w) => w.code === "aurora-minimum-not-met")).toBeUndefined();
  });
});

describe("computeSubmission — Resonance ceremony exception", () => {
  it("Ceremony Speaker only — no minimum warning", () => {
    const r = computeSubmission(
      sel({
        collections: ["resonance"],
        addons: [{ collectionId: "resonance", addonId: "ceremony-speaker", qty: 1 }],
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixedSubtotalCents).toBe(35000);
    expect(r.warnings.find((w) => w.code === "resonance-planning-required")).toBeUndefined();
  });

  it("Ceremony Speaker + wireless mic — still no minimum warning", () => {
    const r = computeSubmission(
      sel({
        collections: ["resonance"],
        addons: [
          { collectionId: "resonance", addonId: "ceremony-speaker", qty: 1 },
          { collectionId: "resonance", addonId: "ceremony-wireless-mic", qty: 2 },
        ],
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.find((w) => w.code === "resonance-planning-required")).toBeUndefined();
  });

  it("Full Resonance Minimum Spend — triggers planning-conversation warning", () => {
    const r = computeSubmission(
      sel({
        collections: ["resonance"],
        addons: [{ collectionId: "resonance", addonId: "resonance-minimum", qty: 1 }],
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toContainEqual(
      expect.objectContaining({ code: "resonance-planning-required" })
    );
  });
});

describe("computeSubmission — custom-quoted items", () => {
  it("excludes 'starting at' addons from the subtotal", () => {
    const r = computeSubmission(
      sel({
        collections: ["aurora"],
        addons: [
          { collectionId: "aurora", addonId: "led-wall-experience", qty: 1 },
          { collectionId: "aurora", addonId: "monogram-projection", qty: 1 }, // "starting"
        ],
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Starting-priced items contribute their startingPriceCents to the customQuoted list,
    // not to fixedSubtotalCents.
    expect(r.fixedSubtotalCents).toBe(300000);
    expect(r.customQuoted).toContainEqual(
      expect.objectContaining({ addonId: "monogram-projection", startingPriceCents: 50000 })
    );
  });

  it("excludes 'custom' addons from the subtotal", () => {
    const r = computeSubmission(
      sel({
        collections: ["aurora"],
        addons: [
          { collectionId: "aurora", addonId: "led-wall-experience", qty: 1 },
          { collectionId: "aurora", addonId: "power-distribution",  qty: 1 }, // "custom"
        ],
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixedSubtotalCents).toBe(300000);
    expect(r.customQuoted).toContainEqual(
      expect.objectContaining({ addonId: "power-distribution", startingPriceCents: null })
    );
  });
});

describe("computeSubmission — validation errors", () => {
  it("rejects unknown collection", () => {
    const r = computeSubmission(sel({ collections: ["bogus"] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("unknown_collection");
  });

  it("rejects unknown package", () => {
    const r = computeSubmission(
      sel({
        collections: ["smile"],
        packages: [{ collectionId: "smile", packageId: "bogus" }],
      })
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("unknown_selection");
  });

  it("rejects unknown addon", () => {
    const r = computeSubmission(
      sel({
        collections: ["smile"],
        packages: [{ collectionId: "smile", packageId: "memory-booth" }],
        addons:    [{ collectionId: "smile", addonId: "bogus", qty: 1 }],
      })
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("unknown_selection");
  });

  it("rejects qty exceeding qtyMax", () => {
    const r = computeSubmission(
      sel({
        collections: ["aurora"],
        addons: [{ collectionId: "aurora", addonId: "led-wall-expansion", qty: 5 }],
      })
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("qty_exceeds_max");
  });

  it("rejects qty less than 1", () => {
    const r = computeSubmission(
      sel({
        collections: ["smile"],
        addons: [{ collectionId: "smile", addonId: "audio-guest-book", qty: 0 }],
      })
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("invalid_qty");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test
```
Expected: every catalog test still passes; every compute test fails (module not found). That's
the red phase.

- [ ] **Step 3: Implement `compute.ts`**

Create `apps/site/src/lib/builder/compute.ts`:

```ts
/**
 * Server-authoritative recompute of a package builder submission.
 *
 * Pure function: takes the client's selections, walks the canonical catalog,
 * returns the recomputed subtotal, the list of "starting at" / "custom quoted"
 * items, and the array of warnings that should be displayed.
 *
 * Critical: the server NEVER trusts client-supplied totals. This is the source
 * of truth.
 */

import {
  getAddon,
  getCollection,
  getPackage,
  type AddonConfig,
  type CollectionConfig,
  type PackageConfig,
} from "./catalog";

export interface SelectedPackage {
  collectionId: string;
  packageId: string;
}

export interface SelectedAddon {
  collectionId: string;
  addonId: string;
  qty: number;
}

export interface BuilderSelections {
  collections: string[];
  packages: SelectedPackage[];
  addons: SelectedAddon[];
}

export interface CustomQuotedItem {
  collectionId: string;
  addonId: string;
  label: string;
  /** Cents — null for purely-custom items, number for "starting at" items. */
  startingPriceCents: number | null;
}

export type WarningCode =
  | "aurora-minimum-not-met"
  | "resonance-planning-required";

export interface BuilderWarning {
  code: WarningCode;
  message: string;
}

export type ComputeError =
  | "unknown_collection"
  | "unknown_selection"
  | "qty_exceeds_max"
  | "invalid_qty";

export type ComputeResult =
  | {
      ok: true;
      fixedSubtotalCents: number;
      customQuoted: CustomQuotedItem[];
      warnings: BuilderWarning[];
    }
  | {
      ok: false;
      error: ComputeError;
      details?: string;
    };

const AURORA_MIN_WARNING: BuilderWarning = {
  code: "aurora-minimum-not-met",
  message:
    "Aurora requires a $2,000 total Smile NOLA project minimum before lighting or visual production is deployed.",
};

const RESONANCE_PLANNING_WARNING: BuilderWarning = {
  code: "resonance-planning-required",
  message:
    "Resonance requires a planning conversation before final scope is confirmed.",
};

export function computeSubmission(input: BuilderSelections): ComputeResult {
  // ---- 1. Validate every collection id ----
  const collections: CollectionConfig[] = [];
  for (const id of input.collections) {
    const c = getCollection(id);
    if (!c) {
      return { ok: false, error: "unknown_collection", details: id };
    }
    collections.push(c);
  }
  const selectedCollectionIds = new Set(collections.map((c) => c.id));

  // ---- 2. Validate packages and accumulate fixed cents ----
  let fixedSubtotalCents = 0;

  for (const sp of input.packages) {
    if (!selectedCollectionIds.has(sp.collectionId as CollectionConfig["id"])) {
      return {
        ok: false,
        error: "unknown_selection",
        details: `package ${sp.packageId} belongs to unselected collection ${sp.collectionId}`,
      };
    }
    const pkg: PackageConfig | undefined = getPackage(sp.collectionId, sp.packageId);
    if (!pkg) {
      return { ok: false, error: "unknown_selection", details: `package ${sp.packageId}` };
    }
    fixedSubtotalCents += pkg.priceCents;
  }

  // ---- 3. Validate addons + compute fixed cents + collect custom-quoted ----
  const customQuoted: CustomQuotedItem[] = [];

  for (const sa of input.addons) {
    if (!selectedCollectionIds.has(sa.collectionId as CollectionConfig["id"])) {
      return {
        ok: false,
        error: "unknown_selection",
        details: `addon ${sa.addonId} belongs to unselected collection ${sa.collectionId}`,
      };
    }
    const a: AddonConfig | undefined = getAddon(sa.collectionId, sa.addonId);
    if (!a) {
      return { ok: false, error: "unknown_selection", details: `addon ${sa.addonId}` };
    }
    if (!Number.isInteger(sa.qty) || sa.qty < 1) {
      return { ok: false, error: "invalid_qty", details: `${sa.addonId} qty=${sa.qty}` };
    }
    if (a.qtyMax !== undefined && sa.qty > a.qtyMax) {
      return {
        ok: false,
        error: "qty_exceeds_max",
        details: `${sa.addonId} qty=${sa.qty} max=${a.qtyMax}`,
      };
    }

    if (a.priceType === "fixed") {
      fixedSubtotalCents += (a.priceCents ?? 0) * sa.qty;
    } else {
      // starting | custom — never contributes to fixed subtotal
      customQuoted.push({
        collectionId: sa.collectionId,
        addonId: sa.addonId,
        label: a.name,
        startingPriceCents: a.priceCents, // null for "custom"
      });
    }
  }

  // ---- 4. Warnings ----
  const warnings: BuilderWarning[] = [];

  // Aurora minimum — evaluated against TOTAL fixedSubtotalCents (across all collections)
  if (selectedCollectionIds.has("aurora")) {
    const aurora = getCollection("aurora")!;
    const min = aurora.rules.projectMinimumCents ?? 0;
    if (fixedSubtotalCents < min) {
      warnings.push(AURORA_MIN_WARNING);
    }
  }

  // Resonance planning warning — fires when Resonance is selected AND any addon OTHER than
  // the exception list is selected.
  if (selectedCollectionIds.has("resonance")) {
    const resonance = getCollection("resonance")!;
    const exceptionIds = new Set(resonance.rules.minimumExceptionAddonIds ?? []);
    const hasNonExceptionResonanceAddon = input.addons.some(
      (sa) => sa.collectionId === "resonance" && !exceptionIds.has(sa.addonId),
    );
    if (hasNonExceptionResonanceAddon) {
      warnings.push(RESONANCE_PLANNING_WARNING);
    }
  }

  return { ok: true, fixedSubtotalCents, customQuoted, warnings };
}
```

- [ ] **Step 4: Run tests to verify everything passes**

```bash
pnpm test
```
Expected: all catalog tests pass; all compute tests pass. If a compute test fails, the
implementation has a bug — fix the implementation, don't loosen the test.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/lib/builder/compute.ts apps/site/src/lib/builder/compute.test.ts
git commit -m "feat(builder): server-authoritative recompute function

Pure function — takes selections + catalog, returns fixed subtotal,
custom-quoted items, and warnings. The API endpoint calls this on
every submission and discards the client's claimed total.

Unit tests cover the spec's matrix: Smile basics, quantity
multiplication, Aurora minimum boundary (with cross-collection
spend counting toward it), Resonance ceremony exception, custom-
quoted exclusion from subtotal, and every validation rejection."
```

---

### Cluster A — Review checkpoint

Stop here. Verify:

- `pnpm test` passes (catalog + compute, ~20 tests).
- `pnpm typecheck` clean.
- `git log --oneline -6` shows the five commits above on `feature/package-builder`.

Next cluster (B) adds the database schema. No UI or API yet — still safe.

---

## Inter-cluster contracts (locked here, referenced everywhere)

These are the canonical type and shape definitions that later clusters consume. Lock them now so
the API endpoint, the React island, and the admin pages all agree.

### Submission row shape (Cluster B owns; Cluster D, F consume)

```ts
// apps/site/src/lib/builder/submissions.ts
export type SubmissionStatus = "new" | "invoice_sent";
export type SubmissionSource = "invited-builder" | "cold-builder";
export type ConsultationPref = "video" | "in_person" | "none";

export interface PackageBuilderSubmissionRow {
  id: number;
  created_at: string;
  status: SubmissionStatus;
  invoice_sent_at: string | null;
  source: SubmissionSource;

  first_name: string;
  last_name:  string;
  email:      string;
  phone:      string;

  inquiry_id:   number | null;
  invite_token: string | null;

  event_date:        string | null;
  event_type:        string | null;
  venue:             string | null;
  guest_count:       number | null;
  consultation_pref: ConsultationPref | null;
  client_note:       string | null;

  /** JSON-stringified BuilderSelections from compute.ts. */
  selections_json: string;
  fixed_subtotal_cents: number;
  /** JSON-stringified CustomQuotedItem[] from compute.ts. */
  custom_quoted_json: string | null;
  /** JSON-stringified BuilderWarning[] from compute.ts. */
  warnings_json: string | null;

  notes: string | null;
}
```

### API request body shape (Cluster D owns; Cluster E consumes)

```ts
// apps/site/src/lib/schema.ts — BuilderSubmissionSchema (Cluster D defines)
{
  invite?: string;           // present iff invited
  client: {
    firstName: string;
    lastName:  string;
    email:     string;       // email format
    phone:     string;
  };
  event: {
    date?:       string | null;   // yyyy-mm-dd
    type?:       string | null;
    venue?:      string | null;
    guestCount?: number | null;
    note?:       string | null;
  };
  consultationPref: "video" | "in_person" | "none";
  selections: BuilderSelections;   // imported from compute.ts
}
```

### Invite row shape (Cluster B owns; Cluster D, F consume)

```ts
// apps/site/src/lib/builder/invites.ts
export interface BuilderInviteRow {
  token: string;
  inquiry_id: number;
  created_at: string;
  expires_at: string | null;
  consumed_at: string | null;
  created_by: string;
}
```

### Invite prefill response (Cluster D owns; Cluster E consumes)

```ts
// GET /api/package-builder/invite/<token> response, success branch
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
```

### React island props (Cluster E owns)

The Astro page hydrates the island with this single prop object:

```ts
// apps/site/src/components/builder/Builder.tsx
export interface BuilderProps {
  /** Pre-fill data — present iff ?invite=<token> resolved successfully. */
  invite: {
    token: string;
    inquiryId: number;
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
  } | null;
}
```

When `invite === null` the island renders the cold-visitor flow (contact block shown, no
eyebrow). When `invite !== null` the island skips the contact block and renders the eyebrow
with the prefilled name.

---

## Cluster E — Builder UI (React island)

The interactive surface. Implements every component referenced in §"File map" under
`src/components/builder/` plus the host `build.astro` page. State is local to the island
(useReducer), persisted to localStorage with a 250ms debounce, and submitted as JSON to
`POST /api/package-builder`. The client renders a tentative subtotal by calling the same pure
`computeSubmission` function the server uses — the rail is for UX only; the server's recompute
remains authoritative.

No Framer Motion. No external state libraries. No `any`. Brand canon §5 honored verbatim:
Broadway only on the headline, Poppins everywhere else, no Holimount on the builder.

### Task E1: Scaffold the host Astro page

**Files:**
- Create: `apps/site/src/pages/build.astro`

- [ ] **Step 1: Confirm Cluster D's invite-resolution endpoint exists**

```bash
ls apps/site/src/pages/api/package-builder/invite/
```
Expected: `[token].ts` listed. If absent, Cluster D has not landed yet — stop and resolve
ordering before proceeding.

- [ ] **Step 2: Create the page**

Create `apps/site/src/pages/build.astro` with the following content:

```astro
---
/**
 * /build — host page for the package builder React island.
 *
 * Resolves an optional ?invite=<token> server-side by calling the internal
 * /api/package-builder/invite/<token> handler. On success the prefill payload
 * is passed to the island as the `invite` prop; on failure (404/410/network)
 * we silently fall back to the cold flow per spec §4.5. The token resolution
 * happens here (not in the island) so the page renders with hydrated identity
 * on first paint — no client-side fetch flash.
 */

import Layout from "@/layouts/Layout.astro";
import { Builder } from "@/components/builder/Builder";
import type { BuilderProps } from "@/components/builder/Builder";

const token = Astro.url.searchParams.get("invite")?.trim() ?? "";

let invite: BuilderProps["invite"] = null;

if (token) {
  try {
    const url = new URL(`/api/package-builder/invite/${encodeURIComponent(token)}`, Astro.url);
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.ok) {
      const body = (await res.json()) as {
        ok: true;
        prefill: BuilderProps["invite"] extends infer T
          ? T extends { prefill: infer P } ? P : never
          : never;
        inquiryId: number;
      };
      if (body.ok) {
        invite = { token, inquiryId: body.inquiryId, prefill: body.prefill };
      }
    }
    // Non-ok statuses (404 invite_not_found, 410 invite_expired) silently fall
    // through to the cold flow — visitor still gets a working builder.
  } catch (err) {
    // Network hiccup talking to ourselves — log and degrade to cold flow.
    // eslint-disable-next-line no-console
    console.warn("[build.astro] invite resolution failed", err);
  }
}
---

<Layout title="Build Your Smile NOLA Event Experience">
  <main id="main" class="build-shell">
    <Builder client:load invite={invite} />
  </main>
</Layout>

<style>
  .build-shell {
    position: relative;
    min-height: 100vh;
    padding: clamp(48px, 6vw, 96px) 0 clamp(64px, 8vw, 128px);
    background-color: var(--sn-black);
  }
  .build-shell::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background:
      radial-gradient(60% 40% at 20% 10%, var(--sn-amber-20), transparent 70%),
      radial-gradient(50% 40% at 90% 85%, var(--sn-gold-12), transparent 70%);
  }
</style>
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors. Typecheck will fail with "Cannot find module '@/components/builder/Builder'"
if E2 isn't done yet — that's fine, but commit only after E2 lands. Skip this typecheck until
E2 is complete.

- [ ] **Step 4: Defer commit**

The page references `Builder` which doesn't exist yet. Commit at the end of E2 together with
the island root. Move on.

---

### Task E2: Builder island root + props shape

**Files:**
- Create: `apps/site/src/components/builder/Builder.tsx`
- Create: `apps/site/src/components/builder/builder.css`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p apps/site/src/components/builder
```

- [ ] **Step 2: Create the scoped stylesheet (initial shell only — later tasks append)**

Create `apps/site/src/components/builder/builder.css`:

```css
/*
 * Builder island — scoped styles.
 *
 * Reuses brand tokens from globals.css (--sn-*, .font-deco, .sn-field-wrap,
 * .btn-gold). Only adds what's specific to the builder. No animations beyond
 * 200ms CSS transitions on hover/focus.
 */

.builder {
  position: relative;
  z-index: 1;
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 clamp(20px, 4vw, 48px);
  display: grid;
  gap: clamp(32px, 4vw, 56px);
}

@media (min-width: 1024px) {
  .builder {
    grid-template-columns: minmax(0, 1fr) 280px;
    align-items: start;
  }
  .builder__main {
    min-width: 0;
  }
  .builder__rail {
    position: sticky;
    top: 96px;
    align-self: start;
  }
  .builder__mobile-bar {
    display: none;
  }
}

@media (max-width: 1023px) {
  .builder__rail {
    display: none;
  }
}

.builder__main {
  display: flex;
  flex-direction: column;
  gap: clamp(28px, 3.5vw, 44px);
}

.builder__eyebrow {
  font-family: var(--font-body);
  font-size: 0.72rem;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--sn-gold);
  margin: 0;
}

.builder__headline {
  font-family: var(--font-deco);
  text-transform: lowercase;
  letter-spacing: 0.04em;
  color: var(--sn-gold);
  font-size: clamp(40px, 6vw, 72px);
  line-height: 1.05;
  margin: 0;
  text-shadow: 0 0 32px var(--sn-amber-20);
}

.builder__intro {
  color: var(--sn-muted-stone);
  font-size: 1rem;
  line-height: 1.7;
  max-width: 64ch;
  margin: 0;
}

.builder__error-banner {
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid var(--sn-gold);
  border-radius: 2px;
  padding: 16px 20px;
  color: var(--sn-champagne);
  font-size: 0.92rem;
  line-height: 1.6;
  box-shadow: 0 0 28px var(--sn-amber-20);
}

.builder__welcome-toast {
  background: var(--sn-soft-black);
  border: 1px solid var(--sn-gold-24);
  border-radius: 2px;
  padding: 12px 16px;
  color: var(--sn-champagne);
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.builder__welcome-toast button {
  background: transparent;
  border: 0;
  color: var(--sn-muted-stone);
  cursor: pointer;
  font-size: 0.75rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}
.builder__welcome-toast button:hover {
  color: var(--sn-gold);
}

.builder__submit-row {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
}
.builder__submit-row .btn-gold {
  align-self: stretch;
  max-width: 360px;
}
```

- [ ] **Step 3: Create the island root**

Create `apps/site/src/components/builder/Builder.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import type { BuilderSelections } from "@/lib/builder/compute";
import { computeSubmission } from "@/lib/builder/compute";
import { COLLECTIONS } from "@/lib/builder/catalog";
import { useBuilderState } from "./useBuilderState";
import { CollectionChips } from "./CollectionChips";
import { CollectionSection } from "./CollectionSection";
import { EventDetails } from "./EventDetails";
import { ConsultationPreference } from "./ConsultationPreference";
import { ContactBlock } from "./ContactBlock";
import { InvestmentRail } from "./InvestmentRail";
import { MobileRailBar } from "./MobileRailBar";
import { SuccessCard } from "./SuccessCard";
import "./builder.css";

export interface BuilderProps {
  invite: {
    token: string;
    inquiryId: number;
    prefill: {
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      event: {
        date: string | null;
        type: string | null;
        venue: string | null;
        guestCount: number | null;
      };
    };
  } | null;
}

type SubmitState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "error"; message: string }
  | { kind: "success"; firstName: string };

export function Builder({ invite }: BuilderProps) {
  const state = useBuilderState(invite);
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });
  const [welcomeBackVisible, setWelcomeBackVisible] = useState(state.restored);

  useEffect(() => {
    if (state.restored) setWelcomeBackVisible(true);
  }, [state.restored]);

  // Client-side tentative compute — same function the server uses.
  const preview = useMemo(() => {
    const selections: BuilderSelections = {
      collections: state.collections,
      packages: state.packages,
      addons: state.addons,
    };
    return computeSubmission(selections);
  }, [state.collections, state.packages, state.addons]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitState.kind === "sending") return;

    setSubmitState({ kind: "sending" });

    const firstName = invite ? invite.prefill.firstName : state.contact.firstName;
    const lastName = invite ? invite.prefill.lastName : state.contact.lastName;
    const email = invite ? invite.prefill.email : state.contact.email;
    const phone = invite ? invite.prefill.phone : state.contact.phone;

    const body = {
      invite: invite?.token,
      client: { firstName, lastName, email, phone },
      event: {
        date: state.event.date || null,
        type: state.event.type || null,
        venue: state.event.venue || null,
        guestCount: state.event.guestCount ?? null,
        note: state.event.note || null,
      },
      consultationPref: state.consultationPref,
      selections: {
        collections: state.collections,
        packages: state.packages,
        addons: state.addons,
      },
    };

    try {
      const res = await fetch("/api/package-builder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.error("[Builder] submit failed", res.status, await res.text().catch(() => ""));
        setSubmitState({
          kind: "error",
          message:
            "Something went wrong on our end. Your selections are saved — give it another try in a moment, or email daniel@smile-nola.com.",
        });
        return;
      }
      state.clearPersisted();
      setSubmitState({ kind: "success", firstName });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[Builder] submit threw", err);
      setSubmitState({
        kind: "error",
        message:
          "Something went wrong on our end. Your selections are saved — give it another try in a moment, or email daniel@smile-nola.com.",
      });
    }
  }

  if (submitState.kind === "success") {
    return (
      <div className="builder">
        <div className="builder__main">
          <SuccessCard firstName={submitState.firstName} />
        </div>
      </div>
    );
  }

  const eyebrowText = invite
    ? `building for ${invite.prefill.firstName} ${invite.prefill.lastName} · ${
        invite.prefill.event.date || invite.prefill.event.type || "your event"
      }`
    : null;

  return (
    <form className="builder" onSubmit={handleSubmit} noValidate>
      <div className="builder__main">
        {eyebrowText && <p className="builder__eyebrow">{eyebrowText}</p>}

        <h1 className="builder__headline">build your smile nola event experience</h1>

        <p className="builder__intro">
          Tell us what you're imagining — collection by collection, layer by layer. Pick the
          experiences that fit, add the details that matter, and we'll come back with a
          consultative proposal within 24 hours. Nothing here is a commitment; this is the
          shape of the night, sketched together.
        </p>

        {welcomeBackVisible && (
          <div className="builder__welcome-toast" role="status">
            <span>Welcome back. Your selections are saved.</span>
            <button type="button" onClick={() => setWelcomeBackVisible(false)}>
              dismiss
            </button>
          </div>
        )}

        <CollectionChips
          selected={state.collections}
          onToggle={state.toggleCollection}
        />

        {COLLECTIONS.filter((c) => state.collections.includes(c.id))
          .sort((a, b) => a.displayOrder - b.displayOrder)
          .map((c) => (
            <CollectionSection
              key={c.id}
              collection={c}
              selectedPackages={state.packages.filter((p) => p.collectionId === c.id)}
              selectedAddons={state.addons.filter((a) => a.collectionId === c.id)}
              onSelectPackage={state.selectPackage}
              onTogglePackage={state.togglePackage}
              onToggleAddon={state.toggleAddon}
              onSetAddonQty={state.setAddonQty}
            />
          ))}

        <EventDetails
          value={state.event}
          onChange={state.setEvent}
        />

        <ConsultationPreference
          value={state.consultationPref}
          onChange={state.setConsultationPref}
        />

        {invite === null && (
          <ContactBlock
            value={state.contact}
            onChange={state.setContact}
          />
        )}

        {submitState.kind === "error" && (
          <div className="builder__error-banner" role="alert">
            {submitState.message}
          </div>
        )}

        <div className="builder__submit-row">
          <button
            type="submit"
            className="btn-gold"
            disabled={submitState.kind === "sending"}
          >
            {submitState.kind === "sending" ? "Sending…" : "Send My Selections"}
          </button>
        </div>
      </div>

      <aside className="builder__rail" role="complementary" aria-label="Investment summary">
        <InvestmentRail
          state={state}
          preview={preview}
        />
      </aside>

      <MobileRailBar
        state={state}
        preview={preview}
      />
    </form>
  );
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```
Expected: errors for missing sibling component modules (CollectionChips, useBuilderState, etc.).
That's fine — they land in subsequent tasks. Do not commit yet.

- [ ] **Step 5: Defer commit**

The island depends on E3–E12. Commit at the end of E12 when the island compiles.

---

### Task E3: useBuilderState hook (state + persistence)

The single source of truth for the React island. Uses `useReducer` for the selection ops and a
debounced localStorage write. Restores on mount when a matching key exists.

**Files:**
- Create: `apps/site/src/components/builder/useBuilderState.ts`

- [ ] **Step 1: Create the hook**

Create `apps/site/src/components/builder/useBuilderState.ts`:

```ts
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type {
  BuilderSelections,
  SelectedAddon,
  SelectedPackage,
} from "@/lib/builder/compute";
import type { BuilderProps } from "./Builder";

export type ConsultationPref = "video" | "in_person" | "none";

export interface EventDetailsValue {
  date: string;        // yyyy-mm-dd or ""
  type: string;        // "wedding" | "corporate" | "private" | "other" | ""
  venue: string;
  guestCount: number | null;
  note: string;
}

export interface ContactValue {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface BuilderStateShape extends BuilderSelections {
  event: EventDetailsValue;
  consultationPref: ConsultationPref;
  contact: ContactValue;
}

interface PersistedShape extends BuilderStateShape {
  /** Schema version bump = invalidate stale drafts on breaking changes. */
  _v: 1;
}

type Action =
  | { type: "toggle-collection"; id: string }
  | { type: "select-package"; collectionId: string; packageId: string }
  | { type: "toggle-package"; collectionId: string; packageId: string }
  | { type: "toggle-addon"; collectionId: string; addonId: string; defaultQty: number }
  | { type: "set-addon-qty"; collectionId: string; addonId: string; qty: number }
  | { type: "set-event"; patch: Partial<EventDetailsValue> }
  | { type: "set-consultation"; value: ConsultationPref }
  | { type: "set-contact"; patch: Partial<ContactValue> }
  | { type: "restore"; state: BuilderStateShape }
  | { type: "clear" };

const STORAGE_PREFIX = "sn-builder-v1:";
const DEBOUNCE_MS = 250;

function emptyState(invite: BuilderProps["invite"]): BuilderStateShape {
  return {
    collections: [],
    packages: [],
    addons: [],
    event: {
      date: invite?.prefill.event.date ?? "",
      type: invite?.prefill.event.type ?? "",
      venue: invite?.prefill.event.venue ?? "",
      guestCount: invite?.prefill.event.guestCount ?? null,
      note: "",
    },
    consultationPref: "none",
    contact: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
    },
  };
}

function reducer(state: BuilderStateShape, action: Action): BuilderStateShape {
  switch (action.type) {
    case "toggle-collection": {
      const has = state.collections.includes(action.id);
      if (has) {
        // Removing a collection also drops its packages and addons.
        return {
          ...state,
          collections: state.collections.filter((c) => c !== action.id),
          packages: state.packages.filter((p) => p.collectionId !== action.id),
          addons: state.addons.filter((a) => a.collectionId !== action.id),
        };
      }
      return { ...state, collections: [...state.collections, action.id] };
    }
    case "select-package": {
      // Single-select within a collection (radio behavior).
      const others = state.packages.filter((p) => p.collectionId !== action.collectionId);
      return {
        ...state,
        packages: [...others, { collectionId: action.collectionId, packageId: action.packageId }],
      };
    }
    case "toggle-package": {
      // Multi-select within a collection (Digital Atelier).
      const idx = state.packages.findIndex(
        (p) => p.collectionId === action.collectionId && p.packageId === action.packageId,
      );
      if (idx >= 0) {
        return { ...state, packages: state.packages.filter((_, i) => i !== idx) };
      }
      return {
        ...state,
        packages: [
          ...state.packages,
          { collectionId: action.collectionId, packageId: action.packageId },
        ],
      };
    }
    case "toggle-addon": {
      const idx = state.addons.findIndex(
        (a) => a.collectionId === action.collectionId && a.addonId === action.addonId,
      );
      if (idx >= 0) {
        return { ...state, addons: state.addons.filter((_, i) => i !== idx) };
      }
      return {
        ...state,
        addons: [
          ...state.addons,
          {
            collectionId: action.collectionId,
            addonId: action.addonId,
            qty: action.defaultQty,
          },
        ],
      };
    }
    case "set-addon-qty": {
      return {
        ...state,
        addons: state.addons.map((a) =>
          a.collectionId === action.collectionId && a.addonId === action.addonId
            ? { ...a, qty: action.qty }
            : a,
        ),
      };
    }
    case "set-event":
      return { ...state, event: { ...state.event, ...action.patch } };
    case "set-consultation":
      return { ...state, consultationPref: action.value };
    case "set-contact":
      return { ...state, contact: { ...state.contact, ...action.patch } };
    case "restore":
      return action.state;
    case "clear":
      return emptyState(null);
  }
}

function readPersisted(key: string): BuilderStateShape | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedShape;
    if (parsed._v !== 1) return null;
    // Shallow shape guard — defensive against hand-edited storage.
    if (!Array.isArray(parsed.collections)) return null;
    if (!Array.isArray(parsed.packages)) return null;
    if (!Array.isArray(parsed.addons)) return null;
    const { _v: _ignore, ...rest } = parsed;
    return rest;
  } catch {
    return null;
  }
}

/**
 * Storage key resolution per spec §4.4:
 *   invited → sn-builder-v1:{token}
 *   cold    → sn-builder-v1:{sessionId} (sessionId generated client-side, persisted)
 */
function resolveStorageKey(invite: BuilderProps["invite"]): string | null {
  if (typeof window === "undefined") return null;
  if (invite) return `${STORAGE_PREFIX}${invite.token}`;
  const sessKey = `${STORAGE_PREFIX}__sessionId__`;
  let sid = window.localStorage.getItem(sessKey);
  if (!sid) {
    sid = window.crypto.randomUUID();
    window.localStorage.setItem(sessKey, sid);
  }
  return `${STORAGE_PREFIX}${sid}`;
}

export interface UseBuilderStateReturn extends BuilderStateShape {
  /** True iff the initial mount restored a draft from localStorage. */
  restored: boolean;
  toggleCollection: (id: string) => void;
  selectPackage: (collectionId: string, packageId: string) => void;
  togglePackage: (collectionId: string, packageId: string) => void;
  toggleAddon: (collectionId: string, addonId: string, defaultQty?: number) => void;
  setAddonQty: (collectionId: string, addonId: string, qty: number) => void;
  setEvent: (patch: Partial<EventDetailsValue>) => void;
  setConsultationPref: (value: ConsultationPref) => void;
  setContact: (patch: Partial<ContactValue>) => void;
  clearPersisted: () => void;
}

export function useBuilderState(
  invite: BuilderProps["invite"],
): UseBuilderStateReturn {
  const [state, dispatch] = useReducer(reducer, invite, emptyState);
  const [restored, setRestored] = useState(false);
  const storageKeyRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didRestoreRef = useRef(false);

  // Resolve key + restore on mount.
  useEffect(() => {
    const key = resolveStorageKey(invite);
    storageKeyRef.current = key;
    if (!key) return;
    const persisted = readPersisted(key);
    if (persisted) {
      dispatch({ type: "restore", state: persisted });
      setRestored(true);
    }
    didRestoreRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on change (debounced 250ms), but only AFTER the initial restore
  // pass — otherwise we'd overwrite the saved draft with the empty seed.
  useEffect(() => {
    if (!didRestoreRef.current) return;
    const key = storageKeyRef.current;
    if (!key) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        const payload: PersistedShape = { _v: 1, ...state };
        window.localStorage.setItem(key, JSON.stringify(payload));
      } catch {
        // Quota or privacy mode — non-fatal; drafts just won't survive.
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [state]);

  const toggleCollection = useCallback(
    (id: string) => dispatch({ type: "toggle-collection", id }),
    [],
  );
  const selectPackage = useCallback(
    (collectionId: string, packageId: string) =>
      dispatch({ type: "select-package", collectionId, packageId }),
    [],
  );
  const togglePackage = useCallback(
    (collectionId: string, packageId: string) =>
      dispatch({ type: "toggle-package", collectionId, packageId }),
    [],
  );
  const toggleAddon = useCallback(
    (collectionId: string, addonId: string, defaultQty: number = 1) =>
      dispatch({ type: "toggle-addon", collectionId, addonId, defaultQty }),
    [],
  );
  const setAddonQty = useCallback(
    (collectionId: string, addonId: string, qty: number) =>
      dispatch({ type: "set-addon-qty", collectionId, addonId, qty }),
    [],
  );
  const setEvent = useCallback(
    (patch: Partial<EventDetailsValue>) => dispatch({ type: "set-event", patch }),
    [],
  );
  const setConsultationPref = useCallback(
    (value: ConsultationPref) => dispatch({ type: "set-consultation", value }),
    [],
  );
  const setContact = useCallback(
    (patch: Partial<ContactValue>) => dispatch({ type: "set-contact", patch }),
    [],
  );
  const clearPersisted = useCallback(() => {
    const key = storageKeyRef.current;
    if (key) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
  }, []);

  return {
    ...state,
    restored,
    toggleCollection,
    selectPackage,
    togglePackage,
    toggleAddon,
    setAddonQty,
    setEvent,
    setConsultationPref,
    setContact,
    clearPersisted,
  };
}

// Re-export the selection types for callers that don't want to import from
// compute.ts directly. Keeps component prop signatures readable.
export type { SelectedAddon, SelectedPackage };
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```
Expected: still has missing-module errors for sibling components (E4+). The hook itself should
have no TS errors. If the hook reports errors, fix before moving on.

- [ ] **Step 3: Defer commit**

Continues in E12.

---

### Task E4: CollectionChips component

Five horizontal chips, toggle on/off. Selected chip = filled gold; unselected = ghost.

**Files:**
- Create: `apps/site/src/components/builder/CollectionChips.tsx`

- [ ] **Step 1: Create the component**

Create `apps/site/src/components/builder/CollectionChips.tsx`:

```tsx
import { COLLECTIONS, type CollectionId } from "@/lib/builder/catalog";

interface Props {
  selected: string[];
  onToggle: (id: string) => void;
}

const ORDERED_IDS: CollectionId[] = [...COLLECTIONS]
  .sort((a, b) => a.displayOrder - b.displayOrder)
  .map((c) => c.id);

export function CollectionChips({ selected, onToggle }: Props) {
  return (
    <section
      className="cc"
      role="region"
      aria-labelledby="cc-heading"
    >
      <h2 id="cc-heading" className="cc__label">
        01 · Choose your collections
      </h2>
      <p className="cc__hint">
        Tap any combination — each opens its own configuration below.
      </p>
      <div className="cc__row" role="group" aria-label="Collection toggles">
        {ORDERED_IDS.map((id) => {
          const c = COLLECTIONS.find((cc) => cc.id === id)!;
          const isOn = selected.includes(id);
          return (
            <button
              key={id}
              type="button"
              className={`cc__chip${isOn ? " cc__chip--on" : ""}`}
              aria-pressed={isOn}
              onClick={() => onToggle(id)}
            >
              {c.displayName}
            </button>
          );
        })}
      </div>

      <style>{`
        .cc { display: flex; flex-direction: column; gap: 10px; }
        .cc__label {
          font-family: var(--font-body);
          font-size: 0.72rem;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          color: var(--sn-gold);
          margin: 0;
          font-weight: 500;
        }
        .cc__hint {
          color: var(--sn-muted-stone);
          font-size: 0.88rem;
          margin: 0 0 8px;
        }
        .cc__row {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }
        .cc__chip {
          font-family: var(--font-body);
          font-size: 0.78rem;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          background: transparent;
          color: var(--sn-ivory);
          border: 1px solid var(--sn-gold-40);
          border-radius: 999px;
          padding: 10px 18px;
          cursor: pointer;
          transition:
            background-color 200ms ease,
            border-color 200ms ease,
            color 200ms ease,
            box-shadow 200ms ease;
        }
        .cc__chip:hover {
          border-color: var(--sn-gold);
          color: var(--sn-gold);
        }
        .cc__chip--on {
          background: var(--sn-gold);
          color: var(--sn-black);
          border-color: var(--sn-gold);
          box-shadow: 0 0 18px var(--sn-amber-40);
        }
        .cc__chip--on:hover {
          color: var(--sn-black);
        }
      `}</style>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```
Expected: still missing-module errors for E5+. The chips file itself should compile.

- [ ] **Step 3: Defer commit**

Continues in E12.

---

### Task E5: CollectionSection (packages + addons per collection)

Wraps one collection's packages and addons. Implements the "More lighting & visual options"
disclosure for Aurora (spec §4.2 step 5) — addons not in the always-visible whitelist start
collapsed unless they're selected.

**Files:**
- Create: `apps/site/src/components/builder/CollectionSection.tsx`

- [ ] **Step 1: Create the component**

Create `apps/site/src/components/builder/CollectionSection.tsx`:

```tsx
import { useState } from "react";
import type {
  AddonConfig,
  CollectionConfig,
  PackageConfig,
} from "@/lib/builder/catalog";
import type { SelectedAddon, SelectedPackage } from "@/lib/builder/compute";
import { PackageCard } from "./PackageCard";
import { AddonRow } from "./AddonRow";

interface Props {
  collection: CollectionConfig;
  selectedPackages: SelectedPackage[];
  selectedAddons: SelectedAddon[];
  onSelectPackage: (collectionId: string, packageId: string) => void;
  onTogglePackage: (collectionId: string, packageId: string) => void;
  onToggleAddon: (collectionId: string, addonId: string, defaultQty?: number) => void;
  onSetAddonQty: (collectionId: string, addonId: string, qty: number) => void;
}

/**
 * Per spec §4.2 step 5: Aurora's "full lighting menu" is collapsed under a
 * "More lighting & visual options" disclosure on first render. Only the
 * IDs listed here are visible by default; the rest reveal on disclosure
 * click OR if they're currently selected.
 */
const AURORA_DEFAULT_VISIBLE: ReadonlySet<string> = new Set([
  "led-wall-experience",
  "uplighting-apelabs",
  "dance-floor-lighting",
  "monogram-projection",
]);

export function CollectionSection({
  collection,
  selectedPackages,
  selectedAddons,
  onSelectPackage,
  onTogglePackage,
  onToggleAddon,
  onSetAddonQty,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const isMulti = collection.rules.allowMultiplePackages === true;
  const requiresOne = collection.rules.requireOneBasePackage === true;
  const headingId = `coll-${collection.id}-heading`;

  // Aurora: split addons into "always shown" and "behind disclosure".
  const hasDisclosure = collection.id === "aurora";
  const selectedAddonIds = new Set(selectedAddons.map((a) => a.addonId));

  const visibleAddons: AddonConfig[] = hasDisclosure
    ? collection.addons.filter(
        (a) => AURORA_DEFAULT_VISIBLE.has(a.id) || selectedAddonIds.has(a.id),
      )
    : collection.addons;

  const hiddenAddons: AddonConfig[] = hasDisclosure
    ? collection.addons.filter(
        (a) => !AURORA_DEFAULT_VISIBLE.has(a.id) && !selectedAddonIds.has(a.id),
      )
    : [];

  return (
    <section
      className="cs"
      role="region"
      aria-labelledby={headingId}
    >
      <header className="cs__header">
        <h2 id={headingId} className="cs__title">
          {collection.displayName}
        </h2>
        <p className="cs__desc">{collection.shortDescription}</p>
      </header>

      {collection.packages.length > 0 && (
        <div className="cs__packages">
          {collection.packages.map((pkg: PackageConfig) => {
            const isSelected = selectedPackages.some((sp) => sp.packageId === pkg.id);
            return (
              <PackageCard
                key={pkg.id}
                pkg={pkg}
                selected={isSelected}
                groupName={`pkg-${collection.id}`}
                inputType={isMulti ? "checkbox" : "radio"}
                requiredHint={requiresOne ? "Choose one to continue" : undefined}
                onSelect={() =>
                  isMulti
                    ? onTogglePackage(collection.id, pkg.id)
                    : onSelectPackage(collection.id, pkg.id)
                }
              />
            );
          })}
        </div>
      )}

      {visibleAddons.length > 0 && (
        <div className="cs__addons">
          <h3 className="cs__addons-label">Add-ons</h3>
          {visibleAddons.map((addon) => {
            const sel = selectedAddons.find((a) => a.addonId === addon.id);
            return (
              <AddonRow
                key={addon.id}
                collectionId={collection.id}
                addon={addon}
                checked={Boolean(sel)}
                qty={sel?.qty ?? 1}
                onToggle={() => onToggleAddon(collection.id, addon.id, 1)}
                onQtyChange={(q) => onSetAddonQty(collection.id, addon.id, q)}
              />
            );
          })}

          {hasDisclosure && hiddenAddons.length > 0 && (
            <div className="cs__disclosure">
              {!expanded ? (
                <button
                  type="button"
                  className="cs__disclosure-btn"
                  onClick={() => setExpanded(true)}
                  aria-expanded={false}
                >
                  More lighting & visual options ({hiddenAddons.length})
                </button>
              ) : (
                <>
                  {hiddenAddons.map((addon) => {
                    const sel = selectedAddons.find((a) => a.addonId === addon.id);
                    return (
                      <AddonRow
                        key={addon.id}
                        collectionId={collection.id}
                        addon={addon}
                        checked={Boolean(sel)}
                        qty={sel?.qty ?? 1}
                        onToggle={() => onToggleAddon(collection.id, addon.id, 1)}
                        onQtyChange={(q) =>
                          onSetAddonQty(collection.id, addon.id, q)
                        }
                      />
                    );
                  })}
                  <button
                    type="button"
                    className="cs__disclosure-btn"
                    onClick={() => setExpanded(false)}
                    aria-expanded={true}
                  >
                    Show fewer options
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <style>{`
        .cs {
          display: flex;
          flex-direction: column;
          gap: 18px;
          padding: clamp(20px, 3vw, 32px);
          background: var(--sn-soft-black);
          border: 1px solid var(--sn-gold-24);
          border-radius: 2px;
        }
        .cs__header { display: flex; flex-direction: column; gap: 6px; }
        .cs__title {
          font-family: var(--font-body);
          font-size: 1.25rem;
          letter-spacing: 0.04em;
          color: var(--sn-gold);
          margin: 0;
          font-weight: 500;
        }
        .cs__desc {
          color: var(--sn-muted-stone);
          font-size: 0.92rem;
          line-height: 1.6;
          margin: 0;
          max-width: 60ch;
        }
        .cs__packages {
          display: grid;
          gap: 12px;
        }
        .cs__addons {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-top: 8px;
        }
        .cs__addons-label {
          font-family: var(--font-body);
          font-size: 0.72rem;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: var(--sn-muted-stone);
          margin: 0 0 6px;
          font-weight: 500;
        }
        .cs__disclosure {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-top: 4px;
        }
        .cs__disclosure-btn {
          align-self: flex-start;
          background: transparent;
          border: 1px solid var(--sn-gold-24);
          border-radius: 999px;
          padding: 8px 16px;
          color: var(--sn-muted-stone);
          font-family: var(--font-body);
          font-size: 0.78rem;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          cursor: pointer;
          transition:
            border-color 200ms ease,
            color 200ms ease;
        }
        .cs__disclosure-btn:hover {
          border-color: var(--sn-gold);
          color: var(--sn-gold);
        }
      `}</style>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```
Expected: still missing-module errors for PackageCard, AddonRow. Section itself should compile.

- [ ] **Step 3: Defer commit**

Continues in E12.

---

### Task E6: PackageCard (radio-card)

A selectable card per package. Visual: gold border when selected, soft-gold border when not.
Per spec §4 Option A: title + price + duration + description.

**Files:**
- Create: `apps/site/src/components/builder/PackageCard.tsx`

- [ ] **Step 1: Create the component**

Create `apps/site/src/components/builder/PackageCard.tsx`:

```tsx
import type { PackageConfig } from "@/lib/builder/catalog";

interface Props {
  pkg: PackageConfig;
  selected: boolean;
  groupName: string;
  inputType: "radio" | "checkbox";
  requiredHint?: string;
  onSelect: () => void;
}

function formatDollars(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString("en-US")}`;
}

export function PackageCard({
  pkg,
  selected,
  groupName,
  inputType,
  requiredHint,
  onSelect,
}: Props) {
  const inputId = `pkg-${groupName}-${pkg.id}`;
  return (
    <label
      htmlFor={inputId}
      className={`pc${selected ? " pc--on" : ""}`}
    >
      <input
        id={inputId}
        type={inputType}
        name={groupName}
        checked={selected}
        onChange={onSelect}
        className="pc__input"
      />
      <div className="pc__body">
        <div className="pc__row">
          <span className="pc__name">{pkg.name}</span>
          <span className="pc__price">{formatDollars(pkg.priceCents)}</span>
        </div>
        {pkg.duration && <span className="pc__duration">{pkg.duration}</span>}
        {pkg.description && <p className="pc__desc">{pkg.description}</p>}
        {requiredHint && !selected && (
          <span className="pc__hint">{requiredHint}</span>
        )}
      </div>

      <style>{`
        .pc {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          padding: 16px 18px;
          background: rgba(0, 0, 0, 0.22);
          border: 1px solid var(--sn-gold-24);
          border-radius: 2px;
          cursor: pointer;
          transition:
            border-color 200ms ease,
            background-color 200ms ease,
            box-shadow 200ms ease;
        }
        .pc:hover {
          border-color: var(--sn-gold-40);
        }
        .pc--on {
          border-color: var(--sn-gold);
          background: rgba(212, 175, 55, 0.05);
          box-shadow: 0 0 20px var(--sn-amber-20);
        }
        .pc__input {
          margin-top: 4px;
          accent-color: var(--sn-gold);
          flex-shrink: 0;
        }
        .pc__body {
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
          min-width: 0;
        }
        .pc__row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
        }
        .pc__name {
          font-family: var(--font-body);
          font-size: 1rem;
          font-weight: 500;
          color: var(--sn-ivory);
        }
        .pc__price {
          font-family: var(--font-body);
          font-size: 1rem;
          font-weight: 600;
          color: var(--sn-gold);
          letter-spacing: 0.02em;
        }
        .pc__duration {
          font-size: 0.78rem;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--sn-muted-stone);
        }
        .pc__desc {
          color: var(--sn-muted-stone);
          font-size: 0.88rem;
          line-height: 1.6;
          margin: 4px 0 0;
        }
        .pc__hint {
          color: var(--sn-amber);
          font-size: 0.74rem;
          letter-spacing: 0.14em;
          margin-top: 4px;
        }
      `}</style>
    </label>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```
Expected: card file itself compiles. Other sibling imports still missing.

- [ ] **Step 3: Defer commit**

Continues in E12.

---

### Task E7: AddonRow + QtyStepper

Checkbox row per addon with optional inline qty stepper. Renders `"starts at $X"` for
`starting` price type and `"custom quoted"` for `custom` per spec §4.3.

**Files:**
- Create: `apps/site/src/components/builder/QtyStepper.tsx`
- Create: `apps/site/src/components/builder/AddonRow.tsx`

- [ ] **Step 1: Create QtyStepper**

Create `apps/site/src/components/builder/QtyStepper.tsx`:

```tsx
interface Props {
  value: number;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
  ariaLabel: string;
}

export function QtyStepper({
  value,
  min = 1,
  max,
  onChange,
  ariaLabel,
}: Props) {
  const canDec = value > min;
  const canInc = max === undefined || value < max;

  return (
    <div
      className="qs"
      role="group"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        className="qs__btn"
        aria-label="Decrease quantity"
        disabled={!canDec}
        onClick={() => canDec && onChange(value - 1)}
      >
        −
      </button>
      <span className="qs__value" aria-live="polite">{value}</span>
      <button
        type="button"
        className="qs__btn"
        aria-label="Increase quantity"
        disabled={!canInc}
        onClick={() => canInc && onChange(value + 1)}
      >
        +
      </button>

      <style>{`
        .qs {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          border: 1px solid var(--sn-gold-24);
          border-radius: 999px;
          padding: 2px;
          background: rgba(0, 0, 0, 0.3);
        }
        .qs__btn {
          width: 28px;
          height: 28px;
          background: transparent;
          border: 0;
          color: var(--sn-gold);
          font-family: var(--font-body);
          font-size: 1rem;
          line-height: 1;
          cursor: pointer;
          border-radius: 999px;
          transition: background-color 200ms ease, color 200ms ease;
        }
        .qs__btn:hover:not(:disabled) {
          background: var(--sn-gold-12);
        }
        .qs__btn:disabled {
          color: var(--sn-muted-stone);
          opacity: 0.4;
          cursor: not-allowed;
        }
        .qs__value {
          min-width: 22px;
          text-align: center;
          color: var(--sn-ivory);
          font-family: var(--font-body);
          font-size: 0.9rem;
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Create AddonRow**

Create `apps/site/src/components/builder/AddonRow.tsx`:

```tsx
import type { AddonConfig } from "@/lib/builder/catalog";
import { QtyStepper } from "./QtyStepper";

interface Props {
  collectionId: string;
  addon: AddonConfig;
  checked: boolean;
  qty: number;
  onToggle: () => void;
  onQtyChange: (next: number) => void;
}

function formatDollars(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString("en-US")}`;
}

function renderPrice(addon: AddonConfig): string {
  if (addon.priceType === "custom") return "custom quoted";
  if (addon.priceType === "starting") {
    return addon.priceCents !== null
      ? `starts at ${formatDollars(addon.priceCents)}`
      : "starts at custom";
  }
  return addon.priceCents !== null ? formatDollars(addon.priceCents) : "—";
}

export function AddonRow({
  collectionId,
  addon,
  checked,
  qty,
  onToggle,
  onQtyChange,
}: Props) {
  const id = `addon-${collectionId}-${addon.id}`;
  const showStepper = checked && addon.qty === true;
  const isCustom = addon.priceType !== "fixed";

  return (
    <div className={`ar${checked ? " ar--on" : ""}`}>
      <label htmlFor={id} className="ar__label">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="ar__check"
        />
        <span className="ar__body">
          <span className="ar__name">{addon.name}</span>
          {addon.note && <span className="ar__note">{addon.note}</span>}
        </span>
        <span className={`ar__price${isCustom ? " ar__price--soft" : ""}`}>
          {renderPrice(addon)}
        </span>
      </label>
      {showStepper && (
        <div className="ar__qty">
          <QtyStepper
            value={qty}
            min={1}
            max={addon.qtyMax}
            onChange={onQtyChange}
            ariaLabel={`${addon.name} quantity`}
          />
        </div>
      )}

      <style>{`
        .ar {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 10px 12px;
          border-radius: 2px;
          transition: background-color 200ms ease;
        }
        .ar:hover { background: rgba(212, 175, 55, 0.04); }
        .ar--on { background: rgba(212, 175, 55, 0.06); }
        .ar__label {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 12px;
          align-items: start;
          cursor: pointer;
        }
        .ar__check {
          margin-top: 4px;
          accent-color: var(--sn-gold);
          flex-shrink: 0;
        }
        .ar__body {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .ar__name {
          font-family: var(--font-body);
          font-size: 0.95rem;
          color: var(--sn-ivory);
        }
        .ar__note {
          font-size: 0.78rem;
          color: var(--sn-muted-stone);
          font-style: italic;
        }
        .ar__price {
          font-family: var(--font-body);
          font-size: 0.95rem;
          color: var(--sn-gold);
          font-weight: 500;
          white-space: nowrap;
        }
        .ar__price--soft {
          color: var(--sn-muted-stone);
          font-style: italic;
          font-weight: 400;
        }
        .ar__qty {
          padding-left: 28px;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```
Expected: AddonRow + QtyStepper compile. Remaining missing modules: EventDetails,
ConsultationPreference, ContactBlock, InvestmentRail, MobileRailBar, SuccessCard.

- [ ] **Step 4: Defer commit**

Continues in E12.

---

### Task E8: EventDetails

Date, type chip group, venue, guest count, note textarea.

**Files:**
- Create: `apps/site/src/components/builder/EventDetails.tsx`

- [ ] **Step 1: Create the component**

Create `apps/site/src/components/builder/EventDetails.tsx`:

```tsx
import type { EventDetailsValue } from "./useBuilderState";

interface Props {
  value: EventDetailsValue;
  onChange: (patch: Partial<EventDetailsValue>) => void;
}

const TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "wedding",     label: "Wedding" },
  { value: "corporate",   label: "Corporate" },
  { value: "private",     label: "Private celebration" },
  { value: "other",       label: "Other" },
];

export function EventDetails({ value, onChange }: Props) {
  return (
    <section
      className="ed"
      role="region"
      aria-labelledby="ed-heading"
    >
      <h2 id="ed-heading" className="ed__label">
        Event details
      </h2>

      <div className="ed__grid">
        <label className="sn-field-wrap">
          <span className="sn-field-label">Event date</span>
          <input
            type="date"
            value={value.date}
            onChange={(e) => onChange({ date: e.target.value })}
          />
          <span className="sn-underline" />
          <span className="sn-underline-glow" />
        </label>

        <fieldset className="ed__types">
          <legend className="sn-field-label">Event type</legend>
          <div className="ed__chips">
            {TYPE_OPTIONS.map((opt) => {
              const on = value.type === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={`ed__chip${on ? " ed__chip--on" : ""}`}
                  aria-pressed={on}
                  onClick={() => onChange({ type: on ? "" : opt.value })}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="sn-field-wrap ed__span2">
          <span className="sn-field-label">Venue or location</span>
          <input
            type="text"
            value={value.venue}
            onChange={(e) => onChange({ venue: e.target.value })}
            autoComplete="off"
          />
          <span className="sn-underline" />
          <span className="sn-underline-glow" />
        </label>

        <label className="sn-field-wrap">
          <span className="sn-field-label">Estimated guest count</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={value.guestCount ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              onChange({ guestCount: raw === "" ? null : Number.parseInt(raw, 10) });
            }}
          />
          <span className="sn-underline" />
          <span className="sn-underline-glow" />
        </label>

        <label className="sn-field-wrap ed__span2">
          <span className="sn-field-label">
            Tell us about the moment you want to create
          </span>
          <textarea
            rows={4}
            value={value.note}
            onChange={(e) => onChange({ note: e.target.value })}
            placeholder="Setting, mood, the feeling you're chasing…"
          />
        </label>
      </div>

      <style>{`
        .ed {
          display: flex;
          flex-direction: column;
          gap: 18px;
          padding: clamp(20px, 3vw, 32px);
          background: var(--sn-soft-black);
          border: 1px solid var(--sn-gold-24);
          border-radius: 2px;
        }
        .ed__label {
          font-family: var(--font-body);
          font-size: 1.05rem;
          letter-spacing: 0.04em;
          color: var(--sn-gold);
          margin: 0;
          font-weight: 500;
        }
        .ed__grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 22px 18px;
        }
        .ed__span2 { grid-column: 1 / -1; }
        @media (max-width: 640px) {
          .ed__grid { grid-template-columns: 1fr; }
          .ed__span2 { grid-column: auto; }
        }
        .ed__types {
          border: 0;
          padding: 0;
          margin: 0;
          grid-column: 1 / -1;
        }
        .ed__chips {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 6px;
        }
        .ed__chip {
          font-family: var(--font-body);
          font-size: 0.78rem;
          letter-spacing: 0.14em;
          background: transparent;
          color: var(--sn-ivory);
          border: 1px solid var(--sn-gold-40);
          border-radius: 999px;
          padding: 8px 16px;
          cursor: pointer;
          transition:
            background-color 200ms ease,
            border-color 200ms ease,
            color 200ms ease;
        }
        .ed__chip:hover {
          border-color: var(--sn-gold);
          color: var(--sn-gold);
        }
        .ed__chip--on {
          background: var(--sn-gold);
          color: var(--sn-black);
          border-color: var(--sn-gold);
        }
        .ed__chip--on:hover { color: var(--sn-black); }
      `}</style>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```
Expected: EventDetails compiles. Remaining missing: ConsultationPreference, ContactBlock,
InvestmentRail, MobileRailBar, SuccessCard.

- [ ] **Step 3: Defer commit**

Continues in E12.

---

### Task E9: ConsultationPreference + ContactBlock

Exact copy per spec §4.2 step 7 + step 8.

**Files:**
- Create: `apps/site/src/components/builder/ConsultationPreference.tsx`
- Create: `apps/site/src/components/builder/ContactBlock.tsx`

- [ ] **Step 1: Create ConsultationPreference**

Create `apps/site/src/components/builder/ConsultationPreference.tsx`:

```tsx
import type { ConsultationPref } from "./useBuilderState";

interface Props {
  value: ConsultationPref;
  onChange: (next: ConsultationPref) => void;
}

interface Option {
  value: ConsultationPref;
  label: string;
  caption: string;
}

const OPTIONS: ReadonlyArray<Option> = [
  {
    value: "video",
    label: "A quick video call would be great",
    caption: "We'll send a Google Meet link.",
  },
  {
    value: "in_person",
    label: "An in-person walkthrough makes sense for this event",
    caption: "For complex production setups.",
  },
  {
    value: "none",
    label: "No call needed — the details above are enough",
    caption: "",
  },
];

export function ConsultationPreference({ value, onChange }: Props) {
  return (
    <section
      className="cp"
      role="region"
      aria-labelledby="cp-heading"
    >
      <h2 id="cp-heading" className="cp__label">
        Consultation preference
      </h2>

      <div role="radiogroup" aria-labelledby="cp-heading" className="cp__group">
        {OPTIONS.map((opt) => {
          const id = `cp-${opt.value}`;
          const on = value === opt.value;
          return (
            <label
              key={opt.value}
              htmlFor={id}
              className={`cp__opt${on ? " cp__opt--on" : ""}`}
            >
              <input
                id={id}
                type="radio"
                name="consultationPref"
                value={opt.value}
                checked={on}
                onChange={() => onChange(opt.value)}
                className="cp__radio"
              />
              <span className="cp__body">
                <span className="cp__title">{opt.label}</span>
                {opt.caption && <span className="cp__caption">{opt.caption}</span>}
              </span>
            </label>
          );
        })}
      </div>

      <p className="cp__caveat">We'll confirm based on project needs.</p>

      <style>{`
        .cp {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: clamp(20px, 3vw, 32px);
          background: var(--sn-soft-black);
          border: 1px solid var(--sn-gold-24);
          border-radius: 2px;
        }
        .cp__label {
          font-family: var(--font-body);
          font-size: 1.05rem;
          letter-spacing: 0.04em;
          color: var(--sn-gold);
          margin: 0;
          font-weight: 500;
        }
        .cp__group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .cp__opt {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 12px;
          align-items: start;
          padding: 12px 14px;
          background: rgba(0, 0, 0, 0.22);
          border: 1px solid var(--sn-gold-24);
          border-radius: 2px;
          cursor: pointer;
          transition: border-color 200ms ease, background-color 200ms ease;
        }
        .cp__opt:hover { border-color: var(--sn-gold-40); }
        .cp__opt--on {
          border-color: var(--sn-gold);
          background: rgba(212, 175, 55, 0.05);
        }
        .cp__radio {
          margin-top: 3px;
          accent-color: var(--sn-gold);
        }
        .cp__body {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .cp__title {
          font-size: 0.95rem;
          color: var(--sn-ivory);
        }
        .cp__caption {
          font-size: 0.8rem;
          color: var(--sn-muted-stone);
        }
        .cp__caveat {
          font-size: 0.78rem;
          color: var(--sn-muted-stone);
          font-style: italic;
          margin: 0;
        }
      `}</style>
    </section>
  );
}
```

- [ ] **Step 2: Create ContactBlock**

Create `apps/site/src/components/builder/ContactBlock.tsx`:

```tsx
import type { ContactValue } from "./useBuilderState";

interface Props {
  value: ContactValue;
  onChange: (patch: Partial<ContactValue>) => void;
}

export function ContactBlock({ value, onChange }: Props) {
  return (
    <section
      className="cb"
      role="region"
      aria-labelledby="cb-heading"
    >
      <h2 id="cb-heading" className="cb__label">
        Your contact details
      </h2>
      <p className="cb__hint">
        So Daniel can follow up directly with your proposal.
      </p>

      <div className="cb__grid">
        <label className="sn-field-wrap">
          <span className="sn-field-label">First name *</span>
          <input
            type="text"
            required
            value={value.firstName}
            onChange={(e) => onChange({ firstName: e.target.value })}
            autoComplete="given-name"
          />
          <span className="sn-underline" />
          <span className="sn-underline-glow" />
        </label>

        <label className="sn-field-wrap">
          <span className="sn-field-label">Last name *</span>
          <input
            type="text"
            required
            value={value.lastName}
            onChange={(e) => onChange({ lastName: e.target.value })}
            autoComplete="family-name"
          />
          <span className="sn-underline" />
          <span className="sn-underline-glow" />
        </label>

        <label className="sn-field-wrap">
          <span className="sn-field-label">Email *</span>
          <input
            type="email"
            required
            value={value.email}
            onChange={(e) => onChange({ email: e.target.value })}
            autoComplete="email"
            inputMode="email"
          />
          <span className="sn-underline" />
          <span className="sn-underline-glow" />
        </label>

        <label className="sn-field-wrap">
          <span className="sn-field-label">Phone *</span>
          <input
            type="tel"
            required
            value={value.phone}
            onChange={(e) => onChange({ phone: e.target.value })}
            autoComplete="tel"
            inputMode="tel"
          />
          <span className="sn-underline" />
          <span className="sn-underline-glow" />
        </label>
      </div>

      <style>{`
        .cb {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: clamp(20px, 3vw, 32px);
          background: var(--sn-soft-black);
          border: 1px solid var(--sn-gold-24);
          border-radius: 2px;
        }
        .cb__label {
          font-family: var(--font-body);
          font-size: 1.05rem;
          letter-spacing: 0.04em;
          color: var(--sn-gold);
          margin: 0;
          font-weight: 500;
        }
        .cb__hint {
          color: var(--sn-muted-stone);
          font-size: 0.88rem;
          margin: 0;
        }
        .cb__grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 22px 18px;
        }
        @media (max-width: 540px) {
          .cb__grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </section>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```
Expected: both files compile. Remaining missing: InvestmentRail, MobileRailBar, SuccessCard.

- [ ] **Step 4: Defer commit**

Continues in E12.

---

### Task E10: InvestmentRail (desktop sticky rail)

Reads the preview compute result and renders selections, custom-quoted items, warnings, and
subtotal. The Send button mirrors the bottom submit (it submits the parent form via
`form="..."` or by submitting any button in the form — we use a `type="submit"` button which
naturally submits the enclosing `<form>` in `Builder.tsx`).

**Files:**
- Create: `apps/site/src/components/builder/InvestmentRail.tsx`

- [ ] **Step 1: Create the component**

Create `apps/site/src/components/builder/InvestmentRail.tsx`:

```tsx
import { COLLECTIONS, getAddon, getPackage } from "@/lib/builder/catalog";
import type { ComputeResult } from "@/lib/builder/compute";
import type { BuilderStateShape } from "./useBuilderState";

interface Props {
  state: BuilderStateShape;
  preview: ComputeResult;
}

function formatDollars(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString("en-US")}`;
}

interface DisplayLine {
  key: string;
  collectionName: string;
  label: string;
  qtySuffix: string;
  priceLabel: string;
  isSoft: boolean;
}

function buildLines(state: BuilderStateShape): DisplayLine[] {
  const lines: DisplayLine[] = [];
  for (const collection of COLLECTIONS) {
    if (!state.collections.includes(collection.id)) continue;

    for (const sp of state.packages) {
      if (sp.collectionId !== collection.id) continue;
      const pkg = getPackage(sp.collectionId, sp.packageId);
      if (!pkg) continue;
      lines.push({
        key: `pkg-${sp.collectionId}-${sp.packageId}`,
        collectionName: collection.displayName,
        label: pkg.name,
        qtySuffix: "",
        priceLabel: formatDollars(pkg.priceCents),
        isSoft: false,
      });
    }

    for (const sa of state.addons) {
      if (sa.collectionId !== collection.id) continue;
      const addon = getAddon(sa.collectionId, sa.addonId);
      if (!addon) continue;
      let priceLabel: string;
      let isSoft = false;
      if (addon.priceType === "custom") {
        priceLabel = "custom quoted";
        isSoft = true;
      } else if (addon.priceType === "starting") {
        priceLabel =
          addon.priceCents !== null
            ? `starts at ${formatDollars(addon.priceCents)}`
            : "starts at custom";
        isSoft = true;
      } else {
        priceLabel = formatDollars((addon.priceCents ?? 0) * sa.qty);
      }
      const qtySuffix =
        addon.qty === true && sa.qty > 1 ? ` × ${sa.qty}` : "";
      lines.push({
        key: `addon-${sa.collectionId}-${sa.addonId}`,
        collectionName: collection.displayName,
        label: addon.name,
        qtySuffix,
        priceLabel,
        isSoft,
      });
    }
  }
  return lines;
}

export function InvestmentRail({ state, preview }: Props) {
  const lines = buildLines(state);
  const isEmpty = lines.length === 0;
  const subtotalCents = preview.ok ? preview.fixedSubtotalCents : 0;
  const warnings = preview.ok ? preview.warnings : [];

  return (
    <div className="ir">
      <h2 className="ir__eyebrow">Your selections</h2>

      {isEmpty ? (
        <p className="ir__empty">
          Pick a collection to begin shaping your event.
        </p>
      ) : (
        <ul className="ir__list">
          {lines.map((line) => (
            <li key={line.key} className="ir__row">
              <span className="ir__name">
                {line.label}
                {line.qtySuffix && (
                  <span className="ir__qty">{line.qtySuffix}</span>
                )}
              </span>
              <span className={`ir__price${line.isSoft ? " ir__price--soft" : ""}`}>
                {line.priceLabel}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="ir__divider" aria-hidden="true" />

      <div className="ir__subtotal">
        <span className="ir__subtotal-label">Starting</span>
        <span className="ir__subtotal-value">
          {formatDollars(subtotalCents)}
        </span>
      </div>

      {warnings.length > 0 && (
        <ul className="ir__warnings" aria-live="polite">
          {warnings.map((w) => (
            <li
              key={w.code}
              className={`ir__warning ir__warning--${
                w.code === "aurora-minimum-not-met" ? "coral" : "gold"
              }`}
            >
              {w.message}
            </li>
          ))}
        </ul>
      )}

      <button type="submit" className="btn-gold ir__send">
        Send Selections
      </button>

      <style>{`
        .ir {
          background: rgba(20, 14, 8, 0.85);
          border: 1px solid var(--sn-gold-24);
          border-radius: 2px;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          color: var(--sn-ivory);
        }
        .ir__eyebrow {
          font-family: var(--font-body);
          font-size: 0.7rem;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          color: var(--sn-gold);
          margin: 0;
          font-weight: 500;
        }
        .ir__empty {
          color: var(--sn-muted-stone);
          font-size: 0.85rem;
          font-style: italic;
          margin: 0;
        }
        .ir__list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .ir__row {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          font-size: 0.85rem;
          line-height: 1.4;
        }
        .ir__name { color: var(--sn-ivory); flex: 1; min-width: 0; }
        .ir__qty { color: var(--sn-muted-stone); margin-left: 4px; }
        .ir__price {
          color: var(--sn-gold);
          font-weight: 500;
          white-space: nowrap;
        }
        .ir__price--soft {
          color: var(--sn-muted-stone);
          font-style: italic;
          font-weight: 400;
        }
        .ir__divider {
          height: 1px;
          background: var(--sn-gold-24);
        }
        .ir__subtotal {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
        }
        .ir__subtotal-label {
          font-size: 0.7rem;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: var(--sn-muted-stone);
        }
        .ir__subtotal-value {
          font-family: var(--font-body);
          font-size: 1.4rem;
          font-weight: 600;
          color: var(--sn-gold);
          letter-spacing: 0.02em;
        }
        .ir__warnings {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .ir__warning {
          padding: 10px 12px;
          font-size: 0.78rem;
          line-height: 1.5;
          color: var(--sn-champagne);
          border-radius: 2px;
          background: rgba(0, 0, 0, 0.3);
        }
        .ir__warning--coral {
          border-left: 2px solid #d97a6e;
        }
        .ir__warning--gold {
          border-left: 2px solid var(--sn-gold-40);
        }
        .ir__send {
          margin-top: 4px;
          width: 100%;
          padding: 14px 20px;
          font-size: 0.72rem;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```
Expected: rail compiles. Remaining missing: MobileRailBar, SuccessCard.

- [ ] **Step 3: Defer commit**

Continues in E12.

---

### Task E11: MobileRailBar + SuccessCard

Mobile bottom bar with collapsible sheet, and the success confirmation card per spec §4.5.

**Files:**
- Create: `apps/site/src/components/builder/MobileRailBar.tsx`
- Create: `apps/site/src/components/builder/SuccessCard.tsx`

- [ ] **Step 1: Create MobileRailBar**

Create `apps/site/src/components/builder/MobileRailBar.tsx`:

```tsx
import { useState } from "react";
import { InvestmentRail } from "./InvestmentRail";
import type { ComputeResult } from "@/lib/builder/compute";
import type { BuilderStateShape } from "./useBuilderState";

interface Props {
  state: BuilderStateShape;
  preview: ComputeResult;
}

function formatDollars(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString("en-US")}`;
}

export function MobileRailBar({ state, preview }: Props) {
  const [open, setOpen] = useState(false);
  const subtotalCents = preview.ok ? preview.fixedSubtotalCents : 0;

  return (
    <div className="mrb">
      {open && (
        <div className="mrb__sheet" role="dialog" aria-label="Selection summary">
          <button
            type="button"
            className="mrb__close"
            onClick={() => setOpen(false)}
            aria-label="Close summary"
          >
            ×
          </button>
          <div className="mrb__sheet-inner">
            <InvestmentRail state={state} preview={preview} />
          </div>
        </div>
      )}
      <div className="mrb__bar">
        <button
          type="button"
          className="mrb__toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Toggle selection summary"
        >
          <span className="mrb__starting">Starting</span>
          <strong className="mrb__total">{formatDollars(subtotalCents)}</strong>
          <span className="mrb__chev" aria-hidden="true">
            {open ? "▾" : "▴"}
          </span>
        </button>
        <button type="submit" className="btn-gold mrb__send">
          Send
        </button>
      </div>

      <style>{`
        .mrb {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 30;
          pointer-events: none;
        }
        @media (min-width: 1024px) {
          .mrb { display: none; }
        }
        .mrb__bar {
          pointer-events: auto;
          display: flex;
          align-items: stretch;
          gap: 12px;
          padding: 12px 16px;
          background: rgba(5, 5, 5, 0.94);
          border-top: 1px solid var(--sn-gold-24);
          backdrop-filter: blur(8px);
        }
        .mrb__toggle {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 1;
          background: transparent;
          border: 1px solid var(--sn-gold-24);
          border-radius: 999px;
          padding: 10px 16px;
          color: var(--sn-ivory);
          cursor: pointer;
          font-family: var(--font-body);
        }
        .mrb__starting {
          font-size: 0.7rem;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: var(--sn-muted-stone);
        }
        .mrb__total {
          color: var(--sn-gold);
          font-size: 1.05rem;
          font-weight: 600;
        }
        .mrb__chev {
          margin-left: auto;
          color: var(--sn-gold);
        }
        .mrb__send {
          padding: 12px 22px;
          font-size: 0.68rem;
        }
        .mrb__sheet {
          pointer-events: auto;
          position: absolute;
          left: 0;
          right: 0;
          bottom: 100%;
          max-height: 70vh;
          overflow-y: auto;
          background: var(--sn-black);
          border-top: 1px solid var(--sn-gold-24);
          padding: 16px 16px 12px;
          transition: transform 200ms ease;
        }
        .mrb__sheet-inner {
          padding-right: 4px;
        }
        .mrb__close {
          position: absolute;
          top: 8px;
          right: 12px;
          background: transparent;
          border: 0;
          color: var(--sn-gold);
          font-size: 1.5rem;
          line-height: 1;
          cursor: pointer;
          z-index: 1;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Create SuccessCard**

Create `apps/site/src/components/builder/SuccessCard.tsx`:

```tsx
interface Props {
  firstName: string;
}

export function SuccessCard({ firstName }: Props) {
  const safeName = firstName.trim() || "there";
  return (
    <div className="sc" role="status" aria-live="polite">
      <h2 className="sc__title font-deco">thank you, {safeName}.</h2>
      <p className="sc__body">
        Daniel will review your selections and reach out personally within 24 hours.
      </p>

      <style>{`
        .sc {
          max-width: 640px;
          margin: 0 auto;
          padding: clamp(36px, 6vw, 64px);
          background: var(--sn-soft-black);
          border: 1px solid var(--sn-gold);
          border-radius: 2px;
          text-align: center;
          box-shadow: 0 0 36px var(--sn-amber-20);
        }
        .sc__title {
          color: var(--sn-gold);
          font-size: clamp(32px, 5vw, 48px);
          line-height: 1.1;
          margin: 0 0 16px;
        }
        .sc__body {
          color: var(--sn-champagne);
          font-size: 1rem;
          line-height: 1.7;
          margin: 0;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors. Every Builder import now resolves.

- [ ] **Step 4: Defer commit**

Continues in E12 — single atomic commit for the whole island.

---

### Task E12: Smoke-test the island in dev and commit

Final cluster step: boot the dev server, hit `/build`, verify the island renders, then commit
the whole island as a single feature commit.

**Files:**
- None (verification + commit only).

- [ ] **Step 1: Typecheck the whole site**

```bash
pnpm typecheck
```
Expected: `0 errors`. If errors, stop and fix.

- [ ] **Step 2: Run the dev server and load /build**

From `apps/site/`:
```bash
pnpm dev
```
Open `http://localhost:4321/build` in a browser. Verify:
- Page renders without console errors.
- Headline "build your smile nola event experience" displays in Broadway, lowercase, gold.
- Five collection chips display. Clicking a chip opens its section below.
- Selecting Smile → Memory Booth updates the right-rail subtotal to `$695`.
- Adding Audio Guest Book updates subtotal to `$970`.
- Selecting Aurora alone with no items shows the coral "Aurora requires…" warning.
- LED Wall Expansion qty stepper caps at 4 (the + button disables).
- Event date / type chip / venue / guest count / textarea all wire to state.
- Consultation preference defaults to "No call needed".
- Contact block renders (no `?invite=` token in dev).
- Refresh the page; selections restore and "Welcome back" toast appears.
- Resize to 375px width; sticky bottom bar appears, expand sheet works.

- [ ] **Step 3: Stop the dev server**

Ctrl-C in the dev terminal.

- [ ] **Step 4: Commit the island**

```bash
cd /home/phoenix/code/smile-nola
git add apps/site/src/pages/build.astro apps/site/src/components/builder/
git commit -m "feat(builder): React island for /build configurator

The interactive surface for the package builder, hydrated client:load on
/build. Resolves ?invite=<token> server-side in the Astro page so the
eyebrow renders identity on first paint. Cold visitors get the contact
block; invited visitors skip it.

State lives in useBuilderState (useReducer + debounced localStorage).
Drafts persist under sn-builder-v1:{tokenOrSessionId} and restore on
mount with a one-time 'Welcome back' toast. Successful submission
clears the key.

Tentative subtotal in the rail comes from computeSubmission — the same
pure function the server endpoint calls — so client and server never
disagree about what the prices are. The server still owns the
authoritative recompute.

No Framer Motion. No external state libraries. CSS transitions only.
Brand canon honored: Broadway only on the headline (.font-deco
.lowercase), Poppins everywhere else, no Holimount.

Components: Builder, CollectionChips, CollectionSection, PackageCard,
AddonRow, QtyStepper, EventDetails, ConsultationPreference,
ContactBlock, InvestmentRail, MobileRailBar, SuccessCard, plus the
useBuilderState hook and scoped builder.css."
```

- [ ] **Step 5: Verify the commit**

```bash
git log --oneline -1
git status
```
Expected: the new commit at HEAD, working tree clean.

---

### Cluster E — Review checkpoint

Stop here. Verify:

- `pnpm typecheck` clean from `apps/site/`.
- `pnpm test` still passes (catalog + compute tests from Cluster A unchanged).
- `pnpm dev` boots and `/build` renders the island without console errors.
- Smoke-test checklist in E12 step 2 all green.
- `git log --oneline` shows the Cluster E commit on `feature/package-builder`.

Known limitations entering Cluster F (admin surfaces):
- The submit endpoint (`POST /api/package-builder`) is wired up in Cluster D; if Cluster D is not
  yet merged into this branch, submissions will 404. The error banner copy already accounts for
  this — the island degrades gracefully.
- The invite endpoint (`GET /api/package-builder/invite/<token>`) is also Cluster D. Without it,
  `?invite=` always falls through to the cold flow (per spec §4.5 silent fallback). This is the
  intended behavior; no separate "invite invalid" UI exists.

Next cluster (F) builds the admin surfaces: list, detail, status actions, and the
"Copy invite link" trigger on the existing inquiry detail page.
---

## Cluster F — Admin surfaces

This cluster delivers the operator-facing surfaces: a submissions list, a submission detail
page with status actions, and a "Copy package builder link" button on the existing inquiries
detail page. Cluster B's `PackageBuilderSubmissionRow` and `listSubmissions` / `getSubmission`
helpers are the entire data dependency. Cluster D's `POST /api/package-builder/invite` is the
endpoint the new button calls.

The existing middleware (`apps/site/src/middleware.ts`) already gates everything under
`/admin/*` via `url.pathname.startsWith("/admin")`, so no middleware edit is required for the
new `/admin/package-builder` routes. Cluster F verifies that in Task F0 before doing anything
else.

### Task F0: Verify middleware coverage and widen AdminLayout's section type

The new admin pages need `AdminLayout`'s `section` prop to accept a new key
(`"package-builder"`) for active-nav highlighting. We also confirm the middleware needs no
change.

**Files:**
- Modify: `apps/site/src/layouts/AdminLayout.astro`

- [ ] **Step 1: Confirm middleware coverage**

```bash
grep -n "startsWith" apps/site/src/middleware.ts
```
Expected: the line `url.pathname.startsWith("/admin") || url.pathname.startsWith("/api/admin")`.
This proves `/admin/package-builder` and `/admin/package-builder/<id>` are already protected.
No edit to `middleware.ts` is needed. Document that decision in the commit message.

- [ ] **Step 2: Widen the `section` prop union and add the nav entry**

Open `apps/site/src/layouts/AdminLayout.astro`. Change the `Props` interface and the `NAV`
array to include a package-builder entry. The relevant lines (top of the frontmatter) become:

```ts
interface Props {
  title: string;
  /** Section name highlighted in the admin nav. */
  section?:
    | "dashboard"
    | "inquiries"
    | "package-builder"
    | "portfolio"
    | "testimonials";
}
const { title, section } = Astro.props;

const NAV = [
  { href: "/admin",                  label: "Dashboard",        key: "dashboard"       },
  { href: "/admin/inquiries",        label: "Inquiries",        key: "inquiries"       },
  { href: "/admin/package-builder",  label: "Package Builder",  key: "package-builder" },
  { href: "/admin/portfolio",        label: "Video Portfolio",  key: "portfolio"       },
  { href: "/admin/testimonials",     label: "Testimonials",     key: "testimonials"    },
] as const;
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```
Expected: `0 errors`. Every existing `<AdminLayout section="...">` call still type-checks
because the union widened.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/layouts/AdminLayout.astro
git commit -m "feat(admin): add Package Builder section to admin nav

Widens AdminLayout's section prop union with 'package-builder' and
adds the new nav entry between Inquiries and Video Portfolio.

The existing middleware already guards every path under /admin/*
via startsWith('/admin'), so /admin/package-builder is protected
without a middleware edit."
```

---

### Task F1: Build the submissions list page

`/admin/package-builder` — newest-first table with status filter chips and the columns from
spec §11.1. Empty-state copy verbatim from the spec.

**Files:**
- Create: `apps/site/src/pages/admin/package-builder/index.astro`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p apps/site/src/pages/admin/package-builder
```

- [ ] **Step 2: Write the list page**

Create `apps/site/src/pages/admin/package-builder/index.astro`:

```astro
---
/**
 * /admin/package-builder — newest-first list of every package builder
 * submission with status filter chips and a quick "starting" subtotal column.
 *
 * Spec: docs/superpowers/specs/2026-05-11-package-builder-design.md §11.1
 */
import AdminLayout from "@/layouts/AdminLayout.astro";
import { listSubmissions } from "@/lib/builder/submissions";
import type { PackageBuilderSubmissionRow } from "@/lib/builder/submissions";

const status = Astro.url.searchParams.get("status") ?? "all";

const allRows: PackageBuilderSubmissionRow[] = listSubmissions();
const filtered = allRows.filter((r) =>
  status === "all" ? true : r.status === status
);

const FILTERS = [
  { value: "all",          label: "All",          count: allRows.length },
  { value: "new",          label: "New",          count: allRows.filter((r) => r.status === "new").length },
  { value: "invoice_sent", label: "Invoice Sent", count: allRows.filter((r) => r.status === "invoice_sent").length },
] as const;

function shortDate(iso: string): string {
  const d = new Date(iso.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function sourceLabel(source: PackageBuilderSubmissionRow["source"]): string {
  return source === "invited-builder" ? "invited" : "cold";
}
---

<AdminLayout title="Package Builder" section="package-builder">
  <header class="head">
    <div>
      <p class="eyebrow">— admin · package builder —</p>
      <h1 class="font-deco">submissions in flight.</h1>
    </div>
  </header>

  <div class="toolbar">
    <div class="chips">
      {FILTERS.map((f) => (
        <a
          href={f.value === "all" ? "/admin/package-builder" : `/admin/package-builder?status=${f.value}`}
          class:list={["chip", { "is-active": status === f.value }]}
        >
          {f.label} <span class="ct">{f.count}</span>
        </a>
      ))}
    </div>
  </div>

  {filtered.length === 0 ? (
    <div class="empty">
      <p>No package builder submissions yet. Send an invite link from an inquiry to get started.</p>
    </div>
  ) : (
    <div class="table-wrap">
      <table class="rows">
        <thead>
          <tr>
            <th>Status</th>
            <th>Submitted</th>
            <th>Name</th>
            <th>Email</th>
            <th>Event date</th>
            <th>Subtotal</th>
            <th>Source</th>
            <th aria-label="Open"></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr>
              <td>
                <span class={`status-pill is-${r.status}`}>
                  {r.status === "invoice_sent" ? "invoice sent" : "new"}
                </span>
              </td>
              <td class="dim">{shortDate(r.created_at)}</td>
              <td>
                <a href={`/admin/package-builder/${r.id}`} class="name">
                  {r.first_name} {r.last_name}
                </a>
              </td>
              <td class="contact">
                <a href={`mailto:${r.email}`}>{r.email}</a>
              </td>
              <td class="dim">{r.event_date || "—"}</td>
              <td class="subtotal">{formatDollars(r.fixed_subtotal_cents)}</td>
              <td class="dim source">{sourceLabel(r.source)}</td>
              <td><a href={`/admin/package-builder/${r.id}`} class="open" aria-label="Open">→</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )}
</AdminLayout>

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 32px;
  }
  .head .eyebrow {
    color: var(--sn-gold);
    font-size: 0.7rem;
    letter-spacing: 0.4em;
    text-transform: uppercase;
    margin: 0;
  }
  .head h1 {
    font-weight: 400;
    font-size: clamp(28px, 3.6vw, 44px);
    color: var(--sn-ivory);
    margin: 6px 0 0;
    line-height: 1.05;
  }

  .toolbar { margin-bottom: 28px; }
  .chips { display: flex; gap: 10px; flex-wrap: wrap; }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border: 1px solid var(--sn-gold-24);
    border-radius: 999px;
    color: var(--sn-ivory);
    font-size: 0.78rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    transition: all 200ms ease;
  }
  .chip:hover { border-color: var(--sn-gold); }
  .chip.is-active {
    background-color: var(--sn-gold);
    color: var(--sn-black);
    border-color: var(--sn-gold);
  }
  .chip .ct {
    background: rgba(0, 0, 0, 0.18);
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 0.7rem;
  }
  .chip:not(.is-active) .ct {
    background: var(--sn-gold-12);
    color: var(--sn-gold);
  }

  .empty {
    background: var(--sn-soft-black);
    border: 1px dashed var(--sn-gold-24);
    color: var(--sn-muted-stone);
    padding: 32px;
    text-align: center;
  }

  .table-wrap {
    overflow-x: auto;
    background: var(--sn-soft-black);
    border: 1px solid var(--sn-gold-24);
  }
  table.rows {
    width: 100%;
    border-collapse: collapse;
    min-width: 820px;
  }
  table.rows th {
    text-align: left;
    padding: 14px 16px;
    color: var(--sn-gold);
    font-weight: 400;
    font-size: 0.68rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    border-bottom: 1px solid var(--sn-gold-24);
    background: rgba(212, 175, 55, 0.04);
  }
  table.rows td {
    padding: 14px 16px;
    border-bottom: 1px solid var(--sn-gold-12);
    vertical-align: top;
    font-size: 0.92rem;
  }
  table.rows tr:last-child td { border-bottom: 0; }
  table.rows tr:hover td { background: rgba(212, 175, 55, 0.04); }

  .dim { color: var(--sn-muted-stone); font-size: 0.85rem; }
  .name { color: var(--sn-ivory); font-weight: 500; transition: color 200ms ease; }
  .name:hover { color: var(--sn-gold); }
  .contact a { color: var(--sn-champagne); }
  .contact a:hover { color: var(--sn-gold); }
  .source { font-size: 0.78rem; letter-spacing: 0.06em; }
  .subtotal { color: var(--sn-gold); font-variant-numeric: tabular-nums; }

  .status-pill {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 0.66rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    border: 1px solid;
    white-space: nowrap;
  }
  .status-pill.is-new          { color: var(--sn-amber); border-color: var(--sn-amber); background: rgba(255, 178, 63, 0.08); }
  .status-pill.is-invoice_sent { color: var(--sn-gold);  border-color: var(--sn-gold-40); background: rgba(212, 175, 55, 0.08); }

  .open {
    color: var(--sn-gold);
    font-size: 1rem;
    transition: transform 200ms ease;
    display: inline-block;
  }
  .open:hover { transform: translateX(3px); }
</style>
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```
Expected: `0 errors`. If `listSubmissions` or `PackageBuilderSubmissionRow` are not yet
exported by Cluster B, this task is blocked — return to Cluster B first.

- [ ] **Step 4: Smoke-render in dev**

```bash
pnpm dev
```
Visit `http://localhost:4321/admin/package-builder` while logged in. With zero rows, expect
the empty-state card with the exact copy: `"No package builder submissions yet. Send an
invite link from an inquiry to get started."` Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/pages/admin/package-builder/index.astro
git commit -m "feat(admin): package builder submissions list page

Newest-first table with All / New / Invoice Sent filter chips and
the column set from spec section 11.1: status badge, submitted
(relative), name, email, event date, subtotal, source, view link.

Reads via listSubmissions() from lib/builder/submissions (Cluster B).
Auth comes free from the existing /admin/* middleware guard."
```

---

### Task F2: Build the submission detail page (read-only content)

`/admin/package-builder/<id>` — left column with full readable selections, right column with
status badge and metadata. Status actions land in Task F3.

**Files:**
- Create: `apps/site/src/pages/admin/package-builder/[id].astro`

- [ ] **Step 1: Write the detail page skeleton (GET path only)**

Create `apps/site/src/pages/admin/package-builder/[id].astro`:

```astro
---
/**
 * /admin/package-builder/<id> — single submission view with status actions.
 *
 * GET   renders the full submission summary.
 * POST  flips status:
 *         action=mark_invoice_sent → status='invoice_sent', invoice_sent_at=now
 *         action=revert            → status='new',         invoice_sent_at=null
 *
 * Form actions post back to this same URL (progressive enhancement — they
 * work without JavaScript). The "Copy invite link" button below is the only
 * piece that requires JS, and it degrades gracefully (it stays inert).
 *
 * Spec: docs/superpowers/specs/2026-05-11-package-builder-design.md §11.2
 */
import AdminLayout from "@/layouts/AdminLayout.astro";
import {
  getSubmission,
  markInvoiceSent,
  revertToNew,
} from "@/lib/builder/submissions";
import { getCollection, getPackage, getAddon } from "@/lib/builder/catalog";
import type {
  BuilderSelections,
  BuilderWarning,
  CustomQuotedItem,
} from "@/lib/builder/compute";

const id = Number(Astro.params.id);
const submission = Number.isFinite(id) ? getSubmission(id) : undefined;
if (!submission) {
  return new Response("Submission not found", { status: 404 });
}

// ----- POST handler: status flip --------------------------------------------
if (Astro.request.method === "POST") {
  const form = await Astro.request.formData();
  const action = String(form.get("action") ?? "");
  if (action === "mark_invoice_sent") {
    markInvoiceSent(submission.id);
    return Astro.redirect(`/admin/package-builder/${submission.id}`, 303);
  }
  if (action === "revert") {
    revertToNew(submission.id);
    return Astro.redirect(`/admin/package-builder/${submission.id}`, 303);
  }
  return new Response("Unknown action", { status: 400 });
}

// ----- Decode JSON columns --------------------------------------------------
let selections: BuilderSelections = { collections: [], packages: [], addons: [] };
try {
  const parsed = JSON.parse(submission.selections_json);
  if (parsed && typeof parsed === "object") selections = parsed as BuilderSelections;
} catch { /* leave defaults */ }

let customQuoted: CustomQuotedItem[] = [];
try {
  if (submission.custom_quoted_json) {
    const parsed = JSON.parse(submission.custom_quoted_json);
    if (Array.isArray(parsed)) customQuoted = parsed as CustomQuotedItem[];
  }
} catch { /* leave defaults */ }

let warnings: BuilderWarning[] = [];
try {
  if (submission.warnings_json) {
    const parsed = JSON.parse(submission.warnings_json);
    if (Array.isArray(parsed)) warnings = parsed as BuilderWarning[];
  }
} catch { /* leave defaults */ }

// ----- Helpers --------------------------------------------------------------
function formatDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso.replace(" ", "T") + "Z").getTime();
  if (Number.isNaN(t)) return iso;
  const diffMs = Date.now() - t;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// Group selections by collection for the readable list.
interface DisplayLine {
  label: string;
  qty: number;
  priceText: string;
}
interface DisplayGroup {
  collectionId: string;
  collectionName: string;
  lines: DisplayLine[];
}

const groups: DisplayGroup[] = selections.collections.map((cid) => {
  const c = getCollection(cid);
  const lines: DisplayLine[] = [];

  for (const sp of selections.packages.filter((p) => p.collectionId === cid)) {
    const pkg = getPackage(cid, sp.packageId);
    if (!pkg) continue;
    lines.push({
      label: pkg.name,
      qty: 1,
      priceText: formatDollars(pkg.priceCents),
    });
  }
  for (const sa of selections.addons.filter((a) => a.collectionId === cid)) {
    const a = getAddon(cid, sa.addonId);
    if (!a) continue;
    if (a.priceType === "fixed" && a.priceCents !== null) {
      lines.push({
        label: a.name,
        qty: sa.qty,
        priceText:
          sa.qty > 1
            ? `${formatDollars(a.priceCents)} × ${sa.qty} = ${formatDollars(a.priceCents * sa.qty)}`
            : formatDollars(a.priceCents),
      });
    } else if (a.priceType === "starting" && a.priceCents !== null) {
      lines.push({
        label: a.name,
        qty: sa.qty,
        priceText: `starts at ${formatDollars(a.priceCents)}`,
      });
    } else {
      lines.push({
        label: a.name,
        qty: sa.qty,
        priceText: "custom quoted",
      });
    }
  }

  return {
    collectionId: cid,
    collectionName: c?.displayName ?? cid,
    lines,
  };
});
---

<AdminLayout title={`Submission #${submission.id}`} section="package-builder">
  <p class="back-link"><a href="/admin/package-builder">← All submissions</a></p>

  <header class="head">
    <div>
      <p class="eyebrow">— submission #{submission.id} —</p>
      <h1 class="font-deco">{submission.first_name} {submission.last_name}</h1>
      <p class="head-meta">
        <a href={`mailto:${submission.email}`}>{submission.email}</a> ·
        <a href={`tel:${submission.phone.replace(/[^0-9+]/g, "")}`}>{submission.phone}</a> ·
        <span class="muted">received {submission.created_at}</span>
      </p>
    </div>
    <span class={`status-pill is-${submission.status}`}>
      {submission.status === "invoice_sent" ? "invoice sent" : "new"}
    </span>
  </header>

  <div class="layout">
    <div class="col-main">
      <section class="block">
        <h2>Contact</h2>
        <dl class="kv">
          <div><dt>Name</dt><dd>{submission.first_name} {submission.last_name}</dd></div>
          <div><dt>Email</dt><dd><a href={`mailto:${submission.email}`}>{submission.email}</a></dd></div>
          <div><dt>Phone</dt><dd><a href={`tel:${submission.phone.replace(/[^0-9+]/g, "")}`}>{submission.phone}</a></dd></div>
          {submission.inquiry_id !== null && (
            <div>
              <dt>Linked inquiry</dt>
              <dd>
                <a href={`/admin/inquiries/${submission.inquiry_id}`} class="link-badge">
                  linked to inquiry #{submission.inquiry_id}
                </a>
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section class="block">
        <h2>Event</h2>
        <dl class="kv">
          <div><dt>Date</dt><dd>{submission.event_date || "—"}</dd></div>
          <div><dt>Type</dt><dd>{submission.event_type || "—"}</dd></div>
          <div><dt>Venue</dt><dd>{submission.venue || "—"}</dd></div>
          <div><dt>Guest count</dt><dd>{submission.guest_count ?? "—"}</dd></div>
        </dl>
      </section>

      <section class="block">
        <h2>Consultation preference</h2>
        <p class="pref">
          {submission.consultation_pref === "video"     && "Quick video call — Google Meet"}
          {submission.consultation_pref === "in_person" && "In-person walkthrough"}
          {submission.consultation_pref === "none"      && "No call needed"}
          {!submission.consultation_pref                && "—"}
        </p>
      </section>

      <section class="block">
        <h2>Selections</h2>
        {groups.length === 0 ? (
          <p class="muted">No selections recorded.</p>
        ) : (
          <div class="groups">
            {groups.map((g) => (
              <div class="group">
                <h3>{g.collectionName}</h3>
                {g.lines.length === 0 ? (
                  <p class="muted">No items selected from this collection.</p>
                ) : (
                  <ul class="line-list">
                    {g.lines.map((line) => (
                      <li>
                        <span class="line-label">{line.label}</span>
                        <span class="line-price">{line.priceText}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}

        <p class="subtotal-line">
          <span class="subtotal-label">Starting subtotal</span>
          <span class="subtotal-amount">{formatDollars(submission.fixed_subtotal_cents)}</span>
        </p>
      </section>

      {customQuoted.length > 0 && (
        <section class="block">
          <h2>Custom quoted items</h2>
          <ul class="line-list">
            {customQuoted.map((q) => (
              <li>
                <span class="line-label">{q.label}</span>
                <span class="line-price">
                  {q.startingPriceCents !== null
                    ? `starts at ${formatDollars(q.startingPriceCents)}`
                    : "custom quoted"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {warnings.length > 0 && (
        <section class="block warnings">
          <h2>Warnings shown to client</h2>
          <ul class="warning-list">
            {warnings.map((w) => <li>{w.message}</li>)}
          </ul>
        </section>
      )}

      {submission.client_note && (
        <section class="block">
          <h2>Client note</h2>
          <div class="message">{submission.client_note}</div>
        </section>
      )}

      <section class="block">
        <h2>Admin notes</h2>
        <p class="muted">Note editing lives on the inquiries detail page when this submission is linked to one. For unlinked submissions, capture notes in HoneyBook.</p>
      </section>
    </div>

    <aside class="col-side">
      <section class="side-block">
        <h2>Status</h2>
        <p class={`status-pill is-${submission.status}`}>
          {submission.status === "invoice_sent" ? "invoice sent" : "new"}
        </p>

        {submission.status === "new" ? (
          <form method="POST" class="action-form">
            <input type="hidden" name="action" value="mark_invoice_sent" />
            <button type="submit" class="btn-gold full">Mark Invoice Sent</button>
          </form>
        ) : (
          <div class="invoice-sent-row">
            <p class="invoice-sent-meta">
              Invoice sent {relativeTime(submission.invoice_sent_at)}
            </p>
            <form method="POST" class="undo-form">
              <input type="hidden" name="action" value="revert" />
              <button type="submit" class="btn-ghost small">undo</button>
            </form>
          </div>
        )}

        {submission.inquiry_id !== null && (
          <div class="invite-row">
            <button
              type="button"
              class="btn-ghost full"
              data-copy-invite
              data-inquiry-id={submission.inquiry_id}
            >Copy invite link</button>
            <span class="copy-toast" aria-live="polite"></span>
          </div>
        )}
      </section>

      <section class="side-block">
        <h2>Metadata</h2>
        <dl class="kv side-kv">
          <div><dt>ID</dt><dd>#{submission.id}</dd></div>
          <div><dt>Source</dt><dd>{submission.source === "invited-builder" ? "invited" : "cold"}</dd></div>
          <div><dt>Created</dt><dd>{submission.created_at}</dd></div>
          {submission.invite_token && (
            <div><dt>Invite token</dt><dd class="token">{submission.invite_token}</dd></div>
          )}
        </dl>
      </section>
    </aside>
  </div>
</AdminLayout>

<script>
  /**
   * Copy invite link — admin-only. POSTs to /api/package-builder/invite,
   * gets back a URL, copies it to clipboard, shows a small toast.
   */
  document.querySelectorAll<HTMLButtonElement>("[data-copy-invite]").forEach((btn) => {
    const toast = btn.parentElement?.querySelector<HTMLSpanElement>(".copy-toast");
    btn.addEventListener("click", async () => {
      const inquiryId = Number(btn.dataset.inquiryId);
      if (!Number.isFinite(inquiryId)) return;
      btn.setAttribute("disabled", "true");
      const originalLabel = btn.textContent ?? "Copy invite link";
      btn.textContent = "Copying…";
      try {
        const res = await fetch("/api/package-builder/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inquiryId }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Server responded ${res.status}`);
        }
        const data = (await res.json()) as { url: string };
        await navigator.clipboard.writeText(data.url);
        if (toast) {
          toast.textContent = "Invite link copied.";
          toast.style.color = "var(--sn-gold)";
        }
      } catch (err) {
        if (toast) {
          toast.textContent = err instanceof Error ? err.message : "Copy failed.";
          toast.style.color = "var(--sn-amber)";
        }
      } finally {
        btn.removeAttribute("disabled");
        btn.textContent = originalLabel;
      }
    });
  });
</script>

<style>
  .back-link {
    margin: 0 0 18px;
    font-size: 0.8rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .back-link a {
    color: var(--sn-muted-stone);
    transition: color 200ms ease;
  }
  .back-link a:hover { color: var(--sn-gold); }

  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 18px;
    flex-wrap: wrap;
    margin-bottom: 36px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--sn-gold-12);
  }
  .head .eyebrow {
    color: var(--sn-gold);
    font-size: 0.7rem;
    letter-spacing: 0.4em;
    text-transform: uppercase;
    margin: 0;
  }
  .head h1 {
    font-weight: 400;
    font-size: clamp(28px, 3.8vw, 44px);
    color: var(--sn-ivory);
    margin: 8px 0 8px;
    line-height: 1.05;
  }
  .head-meta { color: var(--sn-champagne); font-size: 0.92rem; margin: 0; }
  .head-meta a { color: var(--sn-champagne); transition: color 200ms ease; }
  .head-meta a:hover { color: var(--sn-gold); }
  .head-meta .muted { color: var(--sn-muted-stone); font-size: 0.85rem; }

  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 28px;
  }
  @media (min-width: 1024px) {
    .layout { grid-template-columns: minmax(0, 1fr) 320px; }
  }

  .block,
  .side-block {
    margin-bottom: 28px;
    padding: 24px;
    background: var(--sn-soft-black);
    border: 1px solid var(--sn-gold-24);
  }
  .side-block { margin-bottom: 20px; }
  .block.warnings { border-left: 2px solid var(--sn-soft-coral, #d18b7d); }

  h2 {
    color: var(--sn-gold);
    font-family: var(--font-body);
    font-size: 0.72rem;
    letter-spacing: 0.4em;
    text-transform: uppercase;
    font-weight: 500;
    margin: 0 0 18px;
  }
  h3 {
    color: var(--sn-gold);
    font-size: 0.78rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    font-weight: 500;
    margin: 0 0 12px;
  }

  .kv {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 18px 24px;
    margin: 0;
  }
  .side-kv {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  .kv > div { min-width: 0; }
  dt {
    color: var(--sn-muted-stone);
    font-size: 0.65rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    margin-bottom: 4px;
  }
  dd {
    color: var(--sn-ivory);
    margin: 0;
    font-size: 0.95rem;
    word-break: break-word;
  }
  dd a { color: var(--sn-champagne); }
  dd a:hover { color: var(--sn-gold); }
  .token { font-family: ui-monospace, monospace; font-size: 0.78rem; color: var(--sn-muted-stone); }

  .link-badge {
    display: inline-block;
    padding: 3px 10px;
    border: 1px solid var(--sn-gold-40);
    border-radius: 999px;
    color: var(--sn-gold);
    font-size: 0.78rem;
    letter-spacing: 0.06em;
  }

  .status-pill {
    display: inline-block;
    padding: 6px 14px;
    border-radius: 999px;
    font-size: 0.7rem;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    border: 1px solid;
    white-space: nowrap;
    margin: 0 0 18px;
  }
  .status-pill.is-new          { color: var(--sn-amber); border-color: var(--sn-amber); background: rgba(255, 178, 63, 0.08); }
  .status-pill.is-invoice_sent { color: var(--sn-gold);  border-color: var(--sn-gold-40); background: rgba(212, 175, 55, 0.08); }

  .groups { display: flex; flex-direction: column; gap: 22px; }
  .group {
    padding: 16px 18px;
    background: var(--sn-black);
    border-left: 2px solid var(--sn-gold-40);
  }
  .line-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .line-list li {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 16px;
    padding: 6px 0;
    border-bottom: 1px dashed var(--sn-gold-12);
    font-size: 0.92rem;
  }
  .line-list li:last-child { border-bottom: 0; }
  .line-label  { color: var(--sn-ivory); }
  .line-price  { color: var(--sn-gold); font-variant-numeric: tabular-nums; white-space: nowrap; }

  .subtotal-line {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin: 22px 0 0;
    padding-top: 18px;
    border-top: 1px solid var(--sn-gold-24);
  }
  .subtotal-label {
    color: var(--sn-muted-stone);
    font-size: 0.7rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
  }
  .subtotal-amount {
    color: var(--sn-gold);
    font-size: 1.4rem;
    font-variant-numeric: tabular-nums;
  }

  .warning-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    color: var(--sn-champagne);
    font-size: 0.92rem;
    line-height: 1.5;
  }

  .pref { color: var(--sn-ivory); margin: 0; }
  .message { color: var(--sn-champagne); font-size: 1rem; line-height: 1.7; white-space: pre-wrap; }
  .muted { color: var(--sn-muted-stone); font-size: 0.85rem; margin: 0; }

  .action-form { margin: 0; }
  .btn-gold.full,
  .btn-ghost.full { width: 100%; }
  .btn-ghost.small {
    padding: 4px 10px;
    font-size: 0.7rem;
    letter-spacing: 0.12em;
  }
  .invoice-sent-row {
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;
  }
  .invoice-sent-meta {
    margin: 0;
    color: var(--sn-muted-stone);
    font-size: 0.85rem;
  }
  .invite-row {
    margin-top: 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .copy-toast {
    font-size: 0.78rem;
    letter-spacing: 0.04em;
    min-height: 1em;
  }
</style>
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```
Expected: `0 errors`. If `getSubmission`, `markInvoiceSent`, or `revertToNew` are not yet
exported by Cluster B's `submissions.ts`, this task is blocked — return to Cluster B.

- [ ] **Step 3: Smoke-render in dev**

```bash
pnpm dev
```
Manually insert one fake submission (via `sqlite3 data/leads.db` or by submitting through the
builder UI once Cluster E lands) and visit `http://localhost:4321/admin/package-builder/1`.
Confirm the left/right layout renders, the selections list groups by collection, and the
right rail shows the status pill plus a primary "Mark Invoice Sent" button. Stop the dev
server.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/pages/admin/package-builder/\[id\].astro
git commit -m "feat(admin): package builder submission detail page

Two-column layout per spec section 11.2. Left column: contact (with
linked-inquiry badge when inquiry_id is set), event, consultation
preference, selections grouped by collection with line-item prices,
starting subtotal, custom-quoted items, warnings, client note.
Right column: status pill, status metadata.

The POST handler for the status-flip actions is added in Task F3 —
this commit lands the GET path only."
```

---

### Task F3: Wire the "Mark Invoice Sent" and "Revert" actions

The detail page already contains the form markup and the POST handler scaffolding from
Task F2's commit. This task verifies the DB writes work end-to-end and adds a small smoke
test.

**Files:**
- (No new files; verifies Task F2's POST handler + Cluster B's `markInvoiceSent` /
  `revertToNew` helpers.)

- [ ] **Step 1: Confirm Cluster B exports the helpers**

```bash
grep -n "markInvoiceSent\|revertToNew" apps/site/src/lib/builder/submissions.ts
```
Expected output: both function names appear as `export function`. If they don't, this task
is blocked on Cluster B finishing its CRUD task.

- [ ] **Step 2: Manual round-trip test**

Run `pnpm dev`. With at least one submission in the DB:

1. Visit `/admin/package-builder/<id>`.
2. Click **Mark Invoice Sent**. Page refreshes (303 redirect to same URL).
3. Confirm the status pill flips to `invoice sent` and the gold button is replaced by
   `"Invoice sent Xm ago"` plus an `undo` ghost button.
4. Click **undo**. Page refreshes.
5. Confirm the status pill returns to `new` and the gold button reappears.

If any of those steps fail, debug `markInvoiceSent` / `revertToNew` in Cluster B's
`submissions.ts` — the page is just a thin form.

- [ ] **Step 3: Confirm the buttons work without JavaScript**

In Chrome DevTools, open the Command Menu (Cmd+Shift+P / Ctrl+Shift+P), run
`Disable JavaScript`, reload the detail page, and repeat the round-trip from Step 2. Both
form submissions must still work — they are progressive-enhancement-friendly POSTs to the
same route. Re-enable JavaScript when done.

- [ ] **Step 4: No commit**

Task F3 is verification-only. The handler code shipped in Task F2's commit. Move on.

---

### Task F4: Add "Copy package builder link" button to the inquiry detail page

Modify the existing `apps/site/src/pages/admin/inquiries/[id].astro` to render the new button
row above the notes section. Match the existing fetch + toast pattern used by the status save
form.

**Files:**
- Modify: `apps/site/src/pages/admin/inquiries/[id].astro`

- [ ] **Step 1: Add the button row markup above the status-block form's notes textarea**

In `apps/site/src/pages/admin/inquiries/[id].astro`, locate the `<section class="status-block">`
block. Inside it, immediately above the `<label class="notes-wrap sn-field-wrap">` line, insert
the following markup:

```astro
      <div class="invite-row">
        <button
          type="button"
          class="btn-ghost"
          data-copy-builder-invite
          data-inquiry-id={inquiry.id}
        >Copy package builder link</button>
        <span class="invite-toast" aria-live="polite"></span>
      </div>
```

- [ ] **Step 2: Add the click handler at the bottom of the existing `<script>` block**

In the same file, locate the existing `<script define:vars={{ inquiryId: inquiry.id }}>`
block. Append the following inside that script block (after the existing submit handler):

```js
  // Copy package builder invite link — POSTs to /api/package-builder/invite,
  // copies the returned URL, shows a toast.
  document.querySelectorAll("[data-copy-builder-invite]").forEach((btn) => {
    const toast = btn.parentElement?.querySelector(".invite-toast");
    btn.addEventListener("click", async () => {
      if (!toast) return;
      const originalLabel = btn.textContent ?? "Copy package builder link";
      btn.setAttribute("disabled", "true");
      btn.textContent = "Copying…";
      toast.textContent = "";
      try {
        const res = await fetch("/api/package-builder/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inquiryId }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Server responded ${res.status}`);
        }
        const data = await res.json();
        await navigator.clipboard.writeText(data.url);
        toast.textContent = "Invite link copied. Send it from your inbox.";
        toast.style.color = "var(--sn-gold)";
      } catch (err) {
        toast.textContent = err instanceof Error ? err.message : "Copy failed.";
        toast.style.color = "var(--sn-amber)";
      } finally {
        btn.removeAttribute("disabled");
        btn.textContent = originalLabel;
      }
    });
  });
```

- [ ] **Step 3: Add scoped styles for the new row**

In the same file, append the following rules to the `<style>` block (just before the closing
`</style>`):

```css
  .invite-row {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    margin: 0 0 22px;
    padding: 14px 16px;
    border: 1px dashed var(--sn-gold-24);
    border-radius: 4px;
    background: var(--sn-black);
  }
  .invite-toast {
    font-size: 0.82rem;
    letter-spacing: 0.04em;
    min-height: 1em;
  }
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```
Expected: `0 errors`.

- [ ] **Step 5: Manual smoke test**

Run `pnpm dev`. Visit `/admin/inquiries/<an existing id>`. Click the new
**Copy package builder link** button. Expected:

1. Button briefly says `Copying…`, then returns to its original label.
2. Toast text reads `"Invite link copied. Send it from your inbox."` in gold.
3. Paste into a text field — the URL should be `http://localhost:4321/build?invite=<token>`.

Click the button a second time. Confirm the API returns the SAME token (Cluster D's invite
endpoint reuses outstanding invites per spec §11.3).

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/pages/admin/inquiries/\[id\].astro
git commit -m "feat(admin): copy package builder invite link from inquiry detail

Adds a 'Copy package builder link' button row above the notes
textarea on /admin/inquiries/<id>. POSTs to
/api/package-builder/invite, copies the returned URL to clipboard,
shows an inline toast. Reuses the existing fetch + toast pattern.

The endpoint already de-duplicates outstanding invites per spec
section 11.3, so re-clicking simply re-copies the same URL."
```

---

### Cluster F — Review checkpoint

Stop here. Verify:

- `pnpm typecheck` clean.
- `pnpm test` still passes (this cluster adds no tests, but nothing should have regressed).
- `git log --oneline -5` shows the four Cluster F commits on `feature/package-builder`
  (Tasks F0, F1, F2, and F4 each contribute one commit; F3 is verification-only).
- `/admin/package-builder` renders with the empty state when no rows exist.
- `/admin/package-builder/<id>` renders the two-column layout for an existing submission,
  and the **Mark Invoice Sent** / **undo** round-trip works both with and without JavaScript.
- The new **Copy package builder link** button on `/admin/inquiries/<id>` copies a working
  URL and reuses the existing outstanding invite on a second click.

Next cluster (G) is the manual verification matrix from spec §13.1 — end-to-end smoke
through the entire feature.
---

## Cluster C — Email migration (Resend)

Replaces the nodemailer transport in `apps/site/src/lib/email.ts` with the Resend SDK, keeps the
existing `sendInquiryNotification(row)` contract intact so `api/contact.ts` and `api/inquiry.ts`
keep working without edits, and adds a new `sendBuilderSubmissionNotification(submission, computed)`
helper the upcoming `/api/package-builder` endpoint (Cluster D) will call. A small readable-summary
module renders the multi-line plain-text + HTML body for builder notifications.

**Preconditions:**
- Cluster A has landed (`apps/site/src/lib/builder/compute.ts` exports `ComputeResult` and
  `BuilderSelections`; vitest is installed).
- Cluster B has landed (`apps/site/src/lib/builder/submissions.ts` exports
  `PackageBuilderSubmissionRow`).

**Env vars consumed:**
- `RESEND_API_KEY` — required at runtime to actually send. Missing = console fallback (matches
  current SMTP behavior; submissions never blocked).
- `RESEND_FROM` — optional. Defaults to `Smile NOLA <onboarding@resend.dev>` (Resend's shared
  sandbox sender) when unset, so local dev without verified domains still works. Production sets
  this to `Smile NOLA <no-reply@mail.smile-nola.com>` per the spec.
- `NOTIFY_EMAIL` — recipient. Unchanged from the current module.

---

### Task C1: Swap nodemailer for resend in package.json

**Files:**
- Modify: `apps/site/package.json`

- [ ] **Step 1: Add `resend` and remove `nodemailer` + its types in a single pnpm transaction**

Run from `apps/site/`:
```bash
pnpm remove nodemailer @types/nodemailer
pnpm add resend@^4.0.0
```

Expected: `package.json` no longer contains `nodemailer` or `@types/nodemailer` under any
dependency block; `dependencies` gains `"resend": "^4.x.x"`. Lockfile updates.

- [ ] **Step 2: Confirm nodemailer is gone from the dependency graph**

```bash
pnpm why nodemailer
```
Expected: exits non-zero with a message that nodemailer is not in the dependency tree, OR
prints nothing under `apps/site`. If anything in `apps/site` still depends on it, the next task
will fail to typecheck — investigate before continuing.

- [ ] **Step 3: Typecheck (will FAIL — that is expected)**

```bash
pnpm typecheck
```
Expected: errors in `apps/site/src/lib/email.ts` because `import nodemailer from "nodemailer"`
no longer resolves. We will fix this in Task C2 in the same commit-pair.

Do NOT commit yet. Task C2 lands the email.ts rewrite in the same logical change so the tree
stays buildable between commits.

- [ ] **Step 4: Stage the package changes (do not commit yet)**

```bash
git add apps/site/package.json apps/site/pnpm-lock.yaml
```

Hold the stage until C2's code change is also ready, then commit both together in C2 Step 6.

---

### Task C2: Rewrite `email.ts` to use Resend

Keep the exported `sendInquiryNotification(inquiry: InquiryRow): Promise<void>` signature
byte-for-byte identical so `api/contact.ts:16` and `api/inquiry.ts:22` need zero edits. Add a new
export `sendBuilderSubmissionNotification(submission, computed): Promise<void>` for Cluster D.

**Files:**
- Modify: `apps/site/src/lib/email.ts` (full rewrite)

- [ ] **Step 1: Replace the file contents in full**

Overwrite `apps/site/src/lib/email.ts` with:

```ts
/**
 * Best-effort Resend notifications for inquiries and package builder submissions.
 *
 * Submissions are ALWAYS persisted to SQLite before this is invoked — email is
 * a courtesy, never a blocker. If RESEND_API_KEY is missing OR NOTIFY_EMAIL is
 * missing, the helpers fall back to a console log and return silently. They
 * NEVER throw. The caller fire-and-forgets and continues.
 *
 * Sender defaults to "Smile NOLA <onboarding@resend.dev>" (Resend's shared
 * sandbox sender) so local dev without a verified domain still works. Production
 * sets RESEND_FROM to "Smile NOLA <no-reply@mail.smile-nola.com>".
 *
 * The Resend client is lazy-built on first send so a missing key during module
 * load doesn't blow up the import graph.
 */

import { Resend } from "resend";
import type { InquiryRow } from "@/lib/db";
import type { PackageBuilderSubmissionRow } from "@/lib/builder/submissions";
import type { ComputeResult } from "@/lib/builder/compute";
import { getEnv, getRequiredEnv } from "@/lib/env";
import {
  renderSubmissionSummaryHtml,
  renderSubmissionSummaryText,
} from "@/lib/builder/readable-summary";

const DEFAULT_FROM = "Smile NOLA <onboarding@resend.dev>";

interface SendEnv {
  apiKey: string;
  from: string;
  to: string;
}

function readEnv(): SendEnv | null {
  const to = getEnv("NOTIFY_EMAIL").trim();
  if (!to) return null;
  let apiKey: string;
  try {
    apiKey = getRequiredEnv("RESEND_API_KEY");
  } catch {
    return null;
  }
  const from = getEnv("RESEND_FROM").trim() || DEFAULT_FROM;
  return { apiKey, from, to };
}

let _client: Resend | null = null;
function client(apiKey: string): Resend {
  if (_client) return _client;
  _client = new Resend(apiKey);
  return _client;
}

/* ============================================================================
 * Shared HTML helpers
 * ========================================================================== */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function row(label: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const v = typeof value === "number" ? String(value) : value;
  return `<tr><td style="padding:6px 18px 6px 0;color:#B8B2A5;font-size:12px;letter-spacing:.18em;text-transform:uppercase;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:6px 0;color:#F8F4EA;font-size:15px">${escapeHtml(v)}</td></tr>`;
}

/* ============================================================================
 * Inquiry notification (unchanged contract — same export, same row type)
 * ========================================================================== */

function inquiryBodyText(inquiry: InquiryRow): string {
  const lines = [
    `New inquiry — Smile NOLA`,
    `Captured: ${inquiry.created_at}`,
    `Source:   ${inquiry.source}`,
    ``,
    `Name:        ${inquiry.first_name} ${inquiry.last_name}`,
    `Email:       ${inquiry.email}`,
    `Phone:       ${inquiry.phone}`,
  ];
  if (inquiry.event_date)  lines.push(`Event date:  ${inquiry.event_date}`);
  if (inquiry.event_type)  lines.push(`Event type:  ${inquiry.event_type}`);
  if (inquiry.venue)       lines.push(`Venue:       ${inquiry.venue}`);
  if (inquiry.guest_count) lines.push(`Guest count: ${inquiry.guest_count}`);
  if (inquiry.budget_range)lines.push(`Budget:      ${inquiry.budget_range}`);
  if (inquiry.collections_interested)
    lines.push(`Collections: ${inquiry.collections_interested}`);
  if (inquiry.message) {
    lines.push(``, `Message:`, inquiry.message);
  }
  lines.push(``, `Inquiry #${inquiry.id}. View at: https://smile-nola.com/admin/inquiries/${inquiry.id}`);
  return lines.join("\n");
}

function inquiryBodyHtml(inquiry: InquiryRow): string {
  return `<!doctype html>
<html><body style="margin:0;padding:32px;background:#050505;color:#F8F4EA;font-family:Poppins,system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#111111;border:1px solid #D4AF37;padding:32px">
    <div style="color:#D4AF37;font-size:11px;letter-spacing:.4em;text-transform:uppercase;margin-bottom:6px">— new inquiry —</div>
    <div style="color:#D4AF37;font-size:24px;line-height:1.1;margin-bottom:24px">${escapeHtml(`${inquiry.first_name} ${inquiry.last_name}`)}</div>
    <table style="border-collapse:collapse;width:100%">
      ${row("Email", inquiry.email)}
      ${row("Phone", inquiry.phone)}
      ${row("Source", inquiry.source)}
      ${row("Event date", inquiry.event_date)}
      ${row("Event type", inquiry.event_type)}
      ${row("Venue", inquiry.venue)}
      ${row("Guest count", inquiry.guest_count)}
      ${row("Budget", inquiry.budget_range)}
      ${row("Collections", inquiry.collections_interested)}
    </table>
    ${inquiry.message ? `<div style="margin-top:24px;padding-top:24px;border-top:1px solid #D4AF3733">
      <div style="color:#D4AF37;font-size:11px;letter-spacing:.3em;text-transform:uppercase;margin-bottom:8px">Message</div>
      <div style="color:#F6E7C8;line-height:1.6;white-space:pre-wrap">${escapeHtml(inquiry.message)}</div>
    </div>` : ""}
    <div style="margin-top:28px;padding-top:20px;border-top:1px solid #D4AF3733;color:#B8B2A5;font-size:12px">
      Inquiry #${inquiry.id} · ${escapeHtml(inquiry.created_at)}<br>
      <a href="https://smile-nola.com/admin/inquiries/${inquiry.id}" style="color:#D4AF37">View in admin →</a>
    </div>
  </div>
</body></html>`;
}

/**
 * Send the inquiry notification. Returns nothing; logs but never throws.
 *
 * Signature is UNCHANGED from the previous nodemailer implementation so
 * existing callers (api/contact.ts, api/inquiry.ts) work as-is.
 */
export async function sendInquiryNotification(inquiry: InquiryRow): Promise<void> {
  const env = readEnv();
  if (!env) {
    console.log(
      `[inquiry] Resend not configured — would have notified about #${inquiry.id} (${inquiry.email}). Submission saved.`
    );
    return;
  }
  try {
    const result = await client(env.apiKey).emails.send({
      from: env.from,
      to: env.to,
      subject: `New inquiry: ${inquiry.first_name} ${inquiry.last_name} · ${inquiry.source}`,
      text: inquiryBodyText(inquiry),
      html: inquiryBodyHtml(inquiry),
      replyTo: inquiry.email,
    });
    if (result.error) {
      console.error(`[inquiry] Resend rejected send for #${inquiry.id}:`, result.error);
      return;
    }
    console.log(`[inquiry] Notified ${env.to} about #${inquiry.id} (id=${result.data?.id ?? "?"}).`);
  } catch (err) {
    console.error(`[inquiry] Email send failed for #${inquiry.id}:`, err);
  }
}

/* ============================================================================
 * Package builder submission notification (new)
 * ========================================================================== */

/**
 * Send the package builder submission notification. Returns nothing; logs but
 * never throws.
 *
 * Takes both the persisted row and the recomputed ComputeResult so it can
 * include canonical totals, custom-quoted items, and warnings without
 * re-parsing the JSON columns.
 *
 * If `computed.ok === false` we fall back to a minimal "selections present
 * but failed server validation" notice — this branch shouldn't happen in
 * practice because the endpoint refuses to persist unvalidated submissions,
 * but keeping the helper total prevents surprise crashes.
 */
export async function sendBuilderSubmissionNotification(
  submission: PackageBuilderSubmissionRow,
  computed: ComputeResult,
): Promise<void> {
  const env = readEnv();
  if (!env) {
    console.log(
      `[builder] Resend not configured — would have notified about submission #${submission.id} (${submission.email}). Saved.`
    );
    return;
  }
  try {
    const dollars =
      computed.ok
        ? `$${(computed.fixedSubtotalCents / 100).toLocaleString("en-US")}`
        : "—";
    const subject = `New package builder submission — ${submission.first_name} ${submission.last_name} · ${dollars} starting`;
    const text = renderSubmissionSummaryText(submission, computed);
    const html = renderSubmissionSummaryHtml(submission, computed);
    const result = await client(env.apiKey).emails.send({
      from: env.from,
      to: env.to,
      subject,
      text,
      html,
      replyTo: submission.email,
    });
    if (result.error) {
      console.error(`[builder] Resend rejected send for submission #${submission.id}:`, result.error);
      return;
    }
    console.log(`[builder] Notified ${env.to} about submission #${submission.id} (id=${result.data?.id ?? "?"}).`);
  } catch (err) {
    console.error(`[builder] Email send failed for submission #${submission.id}:`, err);
  }
}
```

- [ ] **Step 2: Verify no callers of `email.ts` need updates**

```bash
rg "sendInquiryNotification" apps/site/src
```
Expected output: three references — the export in `lib/email.ts`, and two imports in
`pages/api/contact.ts` and `pages/api/inquiry.ts`. Their call sites (`sendInquiryNotification(row)`)
still match the new signature exactly — do NOT edit them.

- [ ] **Step 3: Verify no leftover nodemailer references**

```bash
rg "nodemailer" apps/site
```
Expected: zero matches.

- [ ] **Step 4: Typecheck**

The file imports `renderSubmissionSummaryText` / `renderSubmissionSummaryHtml` which don't exist
yet — they land in Task C3. Typecheck WILL fail here. That is expected; we commit the staged
package changes together with C3.

For sanity, run anyway:
```bash
pnpm typecheck
```
Expected: errors only about the missing `readable-summary` module. If you see other errors (e.g.
incompatible Resend SDK signature), stop and investigate — likely the SDK shape changed and
`result.error` / `result.data` need adjusting.

- [ ] **Step 5: Stage the rewrite (still no commit)**

```bash
git add apps/site/src/lib/email.ts
```

- [ ] **Step 6: Defer commit to C3**

Hold here. The tree is intentionally broken (missing `readable-summary.ts`) until C3 lands.
Commit happens at the end of C3 so every commit on `main` builds.

---

### Task C3: Build the readable-summary helper

The plain-text + HTML body the builder notification email shows. Mirrors the visual language of
the inquiry email (gold-on-obsidian, Poppins, tracked uppercase eyebrows). Pure rendering — no
I/O, no Resend imports.

**Files:**
- Create: `apps/site/src/lib/builder/readable-summary.ts`

- [ ] **Step 1: Create the file**

Create `apps/site/src/lib/builder/readable-summary.ts`:

```ts
/**
 * Renders a package builder submission + its recomputed ComputeResult into the
 * plain-text and HTML email bodies the notification helper sends. Pure
 * functions — safe to unit test and to call from anywhere.
 *
 * Field grouping mirrors the admin detail page: contact → event → consultation
 * → selections (grouped by collection) → starting investment → custom-quoted
 * items → warnings → client note → admin link.
 */

import type { PackageBuilderSubmissionRow } from "@/lib/builder/submissions";
import type {
  ComputeResult,
  BuilderSelections,
  SelectedAddon,
  SelectedPackage,
} from "@/lib/builder/compute";
import { COLLECTIONS, getAddon, getCollection, getPackage } from "@/lib/builder/catalog";

const ADMIN_BASE = "https://smile-nola.com/admin/package-builder";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function parseSelections(submission: PackageBuilderSubmissionRow): BuilderSelections {
  try {
    return JSON.parse(submission.selections_json) as BuilderSelections;
  } catch {
    return { collections: [], packages: [], addons: [] };
  }
}

interface GroupedLineItem {
  label: string;
  detail: string; // e.g. "$695.00" or "qty 3 × $50.00 = $150.00" or "starts at $500"
}

interface GroupedCollection {
  collectionId: string;
  collectionName: string;
  packages: GroupedLineItem[];
  addons: GroupedLineItem[];
}

/**
 * Group a submission's selections by collection, in canonical display order,
 * resolving every id against the catalog so labels and prices are authoritative.
 * Unknown ids are skipped silently (they shouldn't survive server validation,
 * but if they do, the email still renders).
 */
function groupSelections(sel: BuilderSelections): GroupedCollection[] {
  const order = COLLECTIONS.slice().sort((a, b) => a.displayOrder - b.displayOrder);
  const selectedSet = new Set(sel.collections);
  const out: GroupedCollection[] = [];

  for (const c of order) {
    if (!selectedSet.has(c.id)) continue;
    const group: GroupedCollection = {
      collectionId: c.id,
      collectionName: c.displayName,
      packages: [],
      addons: [],
    };

    for (const sp of sel.packages as SelectedPackage[]) {
      if (sp.collectionId !== c.id) continue;
      const pkg = getPackage(sp.collectionId, sp.packageId);
      if (!pkg) continue;
      group.packages.push({ label: pkg.name, detail: dollars(pkg.priceCents) });
    }

    for (const sa of sel.addons as SelectedAddon[]) {
      if (sa.collectionId !== c.id) continue;
      const a = getAddon(sa.collectionId, sa.addonId);
      if (!a) continue;
      let detail: string;
      if (a.priceType === "fixed" && a.priceCents !== null) {
        if (sa.qty > 1) {
          detail = `qty ${sa.qty} × ${dollars(a.priceCents)} = ${dollars(a.priceCents * sa.qty)}`;
        } else {
          detail = dollars(a.priceCents);
        }
      } else if (a.priceType === "starting" && a.priceCents !== null) {
        detail = `starts at ${dollars(a.priceCents)}${sa.qty > 1 ? ` (qty ${sa.qty})` : ""}`;
      } else {
        detail = `custom quoted${sa.qty > 1 ? ` (qty ${sa.qty})` : ""}`;
      }
      group.addons.push({ label: a.name, detail });
    }

    if (group.packages.length > 0 || group.addons.length > 0) {
      out.push(group);
    }
  }
  return out;
}

function consultationLabel(pref: PackageBuilderSubmissionRow["consultation_pref"]): string {
  switch (pref) {
    case "video":     return "Quick video call — we'll send a Google Meet link.";
    case "in_person": return "In-person walkthrough — for complex production setups.";
    case "none":      return "No call needed — details above are enough.";
    default:          return "Not specified.";
  }
}

/* ============================================================================
 * Plain text
 * ========================================================================== */

export function renderSubmissionSummaryText(
  submission: PackageBuilderSubmissionRow,
  computed: ComputeResult,
): string {
  const sel = parseSelections(submission);
  const groups = groupSelections(sel);
  const lines: string[] = [];

  lines.push(`New package builder submission — Smile NOLA`);
  lines.push(`Captured: ${submission.created_at}`);
  lines.push(`Source:   ${submission.source}`);
  lines.push(``);
  lines.push(`Name:        ${submission.first_name} ${submission.last_name}`);
  lines.push(`Email:       ${submission.email}`);
  lines.push(`Phone:       ${submission.phone}`);
  if (submission.inquiry_id !== null) {
    lines.push(`Linked to:   inquiry #${submission.inquiry_id}`);
  }
  lines.push(``);
  lines.push(`-- Event --`);
  if (submission.event_date)  lines.push(`Event date:  ${submission.event_date}`);
  if (submission.event_type)  lines.push(`Event type:  ${submission.event_type}`);
  if (submission.venue)       lines.push(`Venue:       ${submission.venue}`);
  if (submission.guest_count) lines.push(`Guest count: ${submission.guest_count}`);
  lines.push(`Consultation: ${consultationLabel(submission.consultation_pref)}`);
  lines.push(``);
  lines.push(`-- Selected experience --`);
  if (groups.length === 0) {
    lines.push(`(no selections)`);
  } else {
    for (const g of groups) {
      lines.push(``);
      lines.push(`[${g.collectionName}]`);
      for (const p of g.packages) lines.push(`  · ${p.label} — ${p.detail}`);
      for (const a of g.addons)   lines.push(`  · ${a.label} — ${a.detail}`);
    }
  }
  lines.push(``);
  if (computed.ok) {
    lines.push(`Starting investment: ${dollars(computed.fixedSubtotalCents)}`);
    if (computed.customQuoted.length > 0) {
      lines.push(``);
      lines.push(`-- Quoted separately --`);
      for (const q of computed.customQuoted) {
        lines.push(
          `  · ${q.label} — ${q.startingPriceCents !== null ? `starts at ${dollars(q.startingPriceCents)}` : "custom quoted"}`,
        );
      }
    }
    if (computed.warnings.length > 0) {
      lines.push(``);
      lines.push(`-- Warnings --`);
      for (const w of computed.warnings) lines.push(`  · ${w.message}`);
    }
  } else {
    lines.push(`Starting investment: (recompute failed — ${computed.error})`);
  }
  if (submission.client_note) {
    lines.push(``);
    lines.push(`-- Note from client --`);
    lines.push(submission.client_note);
  }
  lines.push(``);
  lines.push(`Submission #${submission.id}. View at: ${ADMIN_BASE}/${submission.id}`);
  return lines.join("\n");
}

/* ============================================================================
 * HTML
 * ========================================================================== */

function htmlMetaRow(label: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const v = typeof value === "number" ? String(value) : value;
  return `<tr><td style="padding:6px 18px 6px 0;color:#B8B2A5;font-size:12px;letter-spacing:.18em;text-transform:uppercase;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:6px 0;color:#F8F4EA;font-size:15px">${escapeHtml(v)}</td></tr>`;
}

function htmlGroupBlock(g: GroupedCollection): string {
  const items = [
    ...g.packages.map(
      (p) =>
        `<li style="padding:4px 0;color:#F8F4EA;font-size:14px"><span>${escapeHtml(p.label)}</span> <span style="color:#9C8A6A">— ${escapeHtml(p.detail)}</span></li>`,
    ),
    ...g.addons.map(
      (a) =>
        `<li style="padding:4px 0;color:#F8F4EA;font-size:14px"><span>${escapeHtml(a.label)}</span> <span style="color:#9C8A6A">— ${escapeHtml(a.detail)}</span></li>`,
    ),
  ].join("");
  return `<div style="margin-top:18px">
  <div style="color:#D4AF37;font-size:11px;letter-spacing:.3em;text-transform:uppercase;margin-bottom:6px">${escapeHtml(g.collectionName)}</div>
  <ul style="list-style:none;margin:0;padding:0">${items}</ul>
</div>`;
}

export function renderSubmissionSummaryHtml(
  submission: PackageBuilderSubmissionRow,
  computed: ComputeResult,
): string {
  const sel = parseSelections(submission);
  const groups = groupSelections(sel);

  const groupsHtml =
    groups.length === 0
      ? `<div style="margin-top:18px;color:#B8B2A5;font-size:14px">(no selections)</div>`
      : groups.map(htmlGroupBlock).join("");

  const investmentHtml = computed.ok
    ? `<div style="margin-top:24px;padding-top:20px;border-top:1px solid #D4AF3733">
        <div style="color:#D4AF37;font-size:11px;letter-spacing:.3em;text-transform:uppercase;margin-bottom:6px">Starting investment</div>
        <div style="color:#D4AF37;font-size:22px">${escapeHtml(dollars(computed.fixedSubtotalCents))}</div>
      </div>`
    : `<div style="margin-top:24px;padding-top:20px;border-top:1px solid #D4AF3733;color:#FF7A7A;font-size:13px">Server recompute failed: ${escapeHtml(computed.error)}</div>`;

  const customHtml =
    computed.ok && computed.customQuoted.length > 0
      ? `<div style="margin-top:20px">
          <div style="color:#9C8A6A;font-size:11px;letter-spacing:.3em;text-transform:uppercase;margin-bottom:6px">Quoted separately</div>
          <ul style="list-style:none;margin:0;padding:0">${computed.customQuoted
            .map(
              (q) =>
                `<li style="padding:4px 0;color:#F8F4EA;font-size:14px">${escapeHtml(q.label)} <span style="color:#9C8A6A">— ${escapeHtml(q.startingPriceCents !== null ? `starts at ${dollars(q.startingPriceCents)}` : "custom quoted")}</span></li>`,
            )
            .join("")}</ul>
        </div>`
      : "";

  const warningsHtml =
    computed.ok && computed.warnings.length > 0
      ? `<div style="margin-top:20px;padding:14px 16px;border-left:3px solid #E07A6B;background:#1a0e0c;color:#F6E7C8;font-size:13px;line-height:1.5">${computed.warnings
          .map((w) => `<div>${escapeHtml(w.message)}</div>`)
          .join("")}</div>`
      : "";

  const noteHtml = submission.client_note
    ? `<div style="margin-top:24px;padding-top:24px;border-top:1px solid #D4AF3733">
        <div style="color:#D4AF37;font-size:11px;letter-spacing:.3em;text-transform:uppercase;margin-bottom:8px">Note from client</div>
        <div style="color:#F6E7C8;line-height:1.6;white-space:pre-wrap">${escapeHtml(submission.client_note)}</div>
      </div>`
    : "";

  return `<!doctype html>
<html><body style="margin:0;padding:32px;background:#050505;color:#F8F4EA;font-family:Poppins,system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:620px;margin:0 auto;background:#111111;border:1px solid #D4AF37;padding:32px">
    <div style="color:#D4AF37;font-size:11px;letter-spacing:.4em;text-transform:uppercase;margin-bottom:6px">— new package builder submission —</div>
    <div style="color:#D4AF37;font-size:24px;line-height:1.1;margin-bottom:24px">${escapeHtml(`${submission.first_name} ${submission.last_name}`)}</div>
    <table style="border-collapse:collapse;width:100%">
      ${htmlMetaRow("Email", submission.email)}
      ${htmlMetaRow("Phone", submission.phone)}
      ${htmlMetaRow("Source", submission.source)}
      ${submission.inquiry_id !== null ? htmlMetaRow("Linked inquiry", `#${submission.inquiry_id}`) : ""}
      ${htmlMetaRow("Event date", submission.event_date)}
      ${htmlMetaRow("Event type", submission.event_type)}
      ${htmlMetaRow("Venue", submission.venue)}
      ${htmlMetaRow("Guest count", submission.guest_count)}
      ${htmlMetaRow("Consultation", consultationLabel(submission.consultation_pref))}
    </table>
    ${groupsHtml}
    ${investmentHtml}
    ${customHtml}
    ${warningsHtml}
    ${noteHtml}
    <div style="margin-top:28px;padding-top:20px;border-top:1px solid #D4AF3733;color:#B8B2A5;font-size:12px">
      Submission #${submission.id} · ${escapeHtml(submission.created_at)}<br>
      <a href="${ADMIN_BASE}/${submission.id}" style="color:#D4AF37">View in admin →</a>
    </div>
  </div>
</body></html>`;
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors. The previous task's broken state is now resolved. If errors remain, the most
likely cause is a drift between this file's imports and Cluster A/B types — re-read
`apps/site/src/lib/builder/compute.ts` and `apps/site/src/lib/builder/submissions.ts` and
reconcile.

- [ ] **Step 3: Run the existing test suite (no new tests yet — C4 adds them)**

```bash
pnpm test
```
Expected: every test from Clusters A and B still passes. We haven't regressed anything.

- [ ] **Step 4: Stage the new file**

```bash
git add apps/site/src/lib/builder/readable-summary.ts
```

- [ ] **Step 5: Commit C1 + C2 + C3 as a single coherent change**

```bash
git commit -m "refactor(email): migrate from nodemailer to Resend; add builder notification

- Replaces nodemailer with the Resend SDK. The sendInquiryNotification()
  export keeps its exact signature so api/contact.ts and api/inquiry.ts
  call sites are unchanged.
- Adds sendBuilderSubmissionNotification(submission, computed) for the
  upcoming /api/package-builder endpoint.
- Adds lib/builder/readable-summary.ts which renders the plain-text and
  HTML bodies grouped by collection, with starting investment, custom-
  quoted items, and warnings — mirrors the spec's email layout.
- Reads RESEND_API_KEY (required for actual sends) and RESEND_FROM
  (optional; defaults to onboarding@resend.dev so dev without a verified
  domain still works). Missing key = console fallback, no exceptions
  propagate. replyTo is set to the submitter's email on every message."
```

---

### Task C4: Smoke test the inquiry notification path

The contact form is the highest-traffic mail caller. Add a focused test that mocks the Resend
SDK, calls `sendInquiryNotification`, and asserts the helper called Resend with the right
shape — proves the rewrite preserves the legacy contract.

**Files:**
- Create: `apps/site/src/lib/email.test.ts`

- [ ] **Step 1: Write the test**

Create `apps/site/src/lib/email.test.ts`:

```ts
/**
 * Smoke test for the post-Resend-migration email module.
 *
 * Confirms sendInquiryNotification still honors its legacy contract:
 *   - reads NOTIFY_EMAIL + RESEND_API_KEY from env
 *   - falls back to console.log (no throw) when either is missing
 *   - calls Resend with the right from/to/replyTo/subject when configured
 *   - never throws, even when Resend itself errors
 *
 * We mock the SDK at the module level so no network traffic happens.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InquiryRow } from "@/lib/db";

const sendMock = vi.fn();

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
}));

function buildInquiry(overrides: Partial<InquiryRow> = {}): InquiryRow {
  return {
    id: 42,
    created_at: "2026-05-11T00:00:00.000Z",
    source: "contact",
    first_name: "Test",
    last_name: "Person",
    email: "test@example.com",
    phone: "504-555-0100",
    preferred_contact: null,
    event_date: "2026-09-12",
    event_type: "wedding",
    venue: "The Civic Theatre",
    guest_count: 150,
    event_start: null,
    event_end: null,
    planner: null,
    budget_range: null,
    message: "Hello.",
    referral: null,
    collections_interested: null,
    collection_fields: null,
    ...overrides,
  } as unknown as InquiryRow;
}

describe("sendInquiryNotification (post-Resend migration)", () => {
  beforeEach(() => {
    sendMock.mockReset();
    vi.resetModules();
    // Clear any env vars from previous tests
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
    delete process.env.NOTIFY_EMAIL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to console.log when NOTIFY_EMAIL is missing (no throw, no SDK call)", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { sendInquiryNotification } = await import("@/lib/email");

    await expect(sendInquiryNotification(buildInquiry())).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  it("falls back to console.log when RESEND_API_KEY is missing", async () => {
    process.env.NOTIFY_EMAIL = "ops@smile-nola.com";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { sendInquiryNotification } = await import("@/lib/email");

    await expect(sendInquiryNotification(buildInquiry())).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  it("calls Resend with the right envelope when both env vars are set", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NOTIFY_EMAIL = "ops@smile-nola.com";
    process.env.RESEND_FROM = "Smile NOLA <no-reply@mail.smile-nola.com>";
    sendMock.mockResolvedValue({ data: { id: "msg_123" }, error: null });

    const { sendInquiryNotification } = await import("@/lib/email");
    await sendInquiryNotification(buildInquiry());

    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0]![0];
    expect(arg.from).toBe("Smile NOLA <no-reply@mail.smile-nola.com>");
    expect(arg.to).toBe("ops@smile-nola.com");
    expect(arg.replyTo).toBe("test@example.com");
    expect(arg.subject).toContain("Test Person");
    expect(arg.subject).toContain("contact");
    expect(arg.text).toContain("Test Person");
    expect(arg.html).toContain("Test Person");
  });

  it("uses the onboarding@resend.dev default when RESEND_FROM is unset", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NOTIFY_EMAIL = "ops@smile-nola.com";
    sendMock.mockResolvedValue({ data: { id: "msg_123" }, error: null });

    const { sendInquiryNotification } = await import("@/lib/email");
    await sendInquiryNotification(buildInquiry());

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0]![0].from).toBe("Smile NOLA <onboarding@resend.dev>");
  });

  it("never throws when Resend rejects the send", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NOTIFY_EMAIL = "ops@smile-nola.com";
    sendMock.mockResolvedValue({ data: null, error: { message: "domain not verified" } });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { sendInquiryNotification } = await import("@/lib/email");
    await expect(sendInquiryNotification(buildInquiry())).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });

  it("never throws when the SDK itself throws", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NOTIFY_EMAIL = "ops@smile-nola.com";
    sendMock.mockRejectedValue(new Error("network down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { sendInquiryNotification } = await import("@/lib/email");
    await expect(sendInquiryNotification(buildInquiry())).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the new test**

```bash
pnpm test
```
Expected: all previous tests still pass; the six new tests in `email.test.ts` pass.

If a test fails, the most common causes:
- `InquiryRow` shape drifted — open `apps/site/src/lib/db.ts`, update the test fixture to match.
- The Resend SDK response shape changed in your installed version — open
  `node_modules/resend/dist/index.d.ts`, verify the `emails.send` return type, and adjust.

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/lib/email.test.ts
git commit -m "test(email): smoke-test inquiry notification after Resend migration

Mocks the Resend SDK and verifies sendInquiryNotification:
  - falls back to console.log when NOTIFY_EMAIL or RESEND_API_KEY is missing
  - calls Resend with the right from/to/replyTo/subject when configured
  - honors the onboarding@resend.dev default sender when RESEND_FROM is unset
  - never throws when Resend rejects or the SDK itself throws

The legacy contract (api/contact.ts and api/inquiry.ts call sites unchanged)
is the most important regression target — these tests lock it in."
```

---

### Cluster C — Review checkpoint

Stop here. Verify:

- `pnpm test` passes (catalog + compute from Cluster A, submissions/invites from Cluster B,
  email smoke test from C4 — roughly 25+ tests total).
- `pnpm typecheck` clean.
- `rg "nodemailer" apps/site` returns zero matches.
- `git log --oneline -2` shows the two commits from this cluster:
  `refactor(email): migrate from nodemailer to Resend...` and `test(email): smoke-test...`.
- `apps/site/.env` locally has `RESEND_API_KEY` set; remind the user the key was pasted in chat
  earlier and should be rotated in the Resend dashboard before any production deploy.

If you want to do a hand-confirmed dry run: set `NOTIFY_EMAIL=your-personal@example.com` in
`apps/site/.env`, start the dev server with `pnpm dev`, submit the existing `/contact` form
once, and confirm an email lands in your inbox with the new from-address. This is optional —
the unit tests cover the contract; the manual send only confirms the live Resend account works.

Next cluster (D) wires the API endpoints and calls `sendBuilderSubmissionNotification` from the
new `POST /api/package-builder` route.
---

## Cluster B — Persistence

Adds the two new SQLite tables and a typed CRUD layer for them. No HTTP, no UI yet. Tests run
against an in-memory `better-sqlite3` instance so they never touch `data/leads.db`.

The cluster is ordered so the lowest-level change (refactoring `bootstrapSchema` to be
test-injectable) lands first, then the two CRUD modules land independently with TDD.

### Task B1: Refactor `bootstrapSchema` to accept any Database + register new tables

`bootstrapSchema` is currently a private function inside `db.ts` that takes the singleton's
Database instance. The CRUD test suites need to point it at `new Database(':memory:')`, so the
function must be exported and parameterized. While we're in there, we also add the two new
`CREATE TABLE IF NOT EXISTS` blocks for `package_builder_submissions` and `builder_invites`
exactly as specified in spec §3.1.

The refactor is mechanical and idempotent — existing tables and their migrations are not
touched.

**Files:**
- Modify: `apps/site/src/lib/db.ts`

- [ ] **Step 1: Export `bootstrapSchema` and add the new CREATE TABLE blocks**

Open `apps/site/src/lib/db.ts`. Change the signature of `bootstrapSchema` from `function` (no
keyword) to `export function`, and append the two new tables to the `db.exec(...)` call inside
it. Do NOT touch the existing `CREATE TABLE` blocks or the two migration helpers.

Replace the existing block:

```ts
/**
 * Create the marketing-site tables if they're missing. Safe to call on every
 * cold start — `CREATE TABLE IF NOT EXISTS` is idempotent.
 */
function bootstrapSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inquiries (
```

with:

```ts
/**
 * Create the marketing-site tables if they're missing. Safe to call on every
 * cold start — `CREATE TABLE IF NOT EXISTS` is idempotent.
 *
 * Exported so unit tests can bootstrap a `:memory:` Database without going
 * through the file-backed singleton in `getDb()`.
 */
export function bootstrapSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inquiries (
```

Then find the closing line of the existing `db.exec` call inside `bootstrapSchema`:

```ts
    CREATE INDEX IF NOT EXISTS idx_ts_featured ON testimonials(featured);
  `);

  migratePortfolioToMultiCollection(db);
  migratePortfolioAddGalleryUrlAndNullableUrl(db);
}
```

Replace it with the same block plus a second `db.exec(...)` for the builder tables (placed
BEFORE the migration helpers so the new tables exist before anything else touches them):

```ts
    CREATE INDEX IF NOT EXISTS idx_ts_featured ON testimonials(featured);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS package_builder_submissions (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at           TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status               TEXT    NOT NULL DEFAULT 'new',
      invoice_sent_at      TEXT,
      source               TEXT    NOT NULL,

      first_name           TEXT    NOT NULL,
      last_name            TEXT    NOT NULL,
      email                TEXT    NOT NULL,
      phone                TEXT    NOT NULL,

      inquiry_id           INTEGER REFERENCES inquiries(id),
      invite_token         TEXT,

      event_date           TEXT,
      event_type           TEXT,
      venue                TEXT,
      guest_count          INTEGER,
      consultation_pref    TEXT,
      client_note          TEXT,

      selections_json      TEXT    NOT NULL,
      fixed_subtotal_cents INTEGER NOT NULL,
      custom_quoted_json   TEXT,
      warnings_json        TEXT,

      notes                TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pbs_created_at ON package_builder_submissions(created_at);
    CREATE INDEX IF NOT EXISTS idx_pbs_status     ON package_builder_submissions(status);
    CREATE INDEX IF NOT EXISTS idx_pbs_email      ON package_builder_submissions(email);
    CREATE INDEX IF NOT EXISTS idx_pbs_inquiry    ON package_builder_submissions(inquiry_id);

    CREATE TABLE IF NOT EXISTS builder_invites (
      token        TEXT    PRIMARY KEY,
      inquiry_id   INTEGER NOT NULL REFERENCES inquiries(id),
      created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at   TEXT,
      consumed_at  TEXT,
      created_by   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_bi_inquiry ON builder_invites(inquiry_id);
  `);

  migratePortfolioToMultiCollection(db);
  migratePortfolioAddGalleryUrlAndNullableUrl(db);
}
```

Nothing else in `db.ts` changes.

- [ ] **Step 2: Typecheck**

Run from `apps/site/`:
```bash
pnpm typecheck
```
Expected: `0 errors`. The two existing usages of `bootstrapSchema` (just the one call from
`open()`) continue to work — exporting a function is non-breaking.

- [ ] **Step 3: Smoke test by running the dev server briefly**

Run from `apps/site/`:
```bash
timeout 5 pnpm dev || true
```
Expected: server starts, no SQL errors on boot. The two new tables are created on the existing
dev database silently (idempotent). Kill the process once you see "ready in Xms".

Optional verification — query the dev DB schema:
```bash
sqlite3 ../../data/leads.db ".tables"
```
Expected output includes `package_builder_submissions` and `builder_invites` alongside the
existing tables.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/lib/db.ts
git commit -m "refactor(db): export bootstrapSchema and add builder tables

bootstrapSchema is now exported so unit tests can bootstrap an in-memory
better-sqlite3 instance without touching data/leads.db.

Adds two new tables for the package builder:
  - package_builder_submissions (with indices on created_at, status,
    email, inquiry_id)
  - builder_invites (with index on inquiry_id)

Both use CREATE TABLE IF NOT EXISTS — existing databases pick them up
on next boot, no migration step required. Existing tables are
untouched."
```

---

### Task B2: Submission CRUD with unit tests

TDD: write the test suite first against an in-memory database, watch it fail, then implement
the module. The test file imports `bootstrapSchema` directly (Task B1's export) and never
touches the production DB.

The row interface is the locked `PackageBuilderSubmissionRow` from "Inter-cluster contracts" —
copy it verbatim into the module.

**Files:**
- Create: `apps/site/src/lib/builder/submissions.test.ts`
- Create: `apps/site/src/lib/builder/submissions.ts`

- [ ] **Step 1: Write the failing test suite**

Create `apps/site/src/lib/builder/submissions.test.ts`:

```ts
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { bootstrapSchema } from "@/lib/db";
import {
  findInquiryIdByEmail,
  getAllSubmissions,
  getSubmission,
  insertSubmission,
  updateSubmissionNotes,
  updateSubmissionStatus,
  type PackageBuilderSubmissionInput,
} from "./submissions";

let db: Database.Database;

function freshDb(): Database.Database {
  const d = new Database(":memory:");
  d.pragma("foreign_keys = ON");
  bootstrapSchema(d);
  return d;
}

function seedInquiry(email: string): number {
  const r = db
    .prepare(
      `INSERT INTO inquiries (source, first_name, last_name, email, phone)
       VALUES ('contact-form', 'Test', 'User', ?, '5555550100')`,
    )
    .run(email);
  return Number(r.lastInsertRowid);
}

function sampleInput(
  overrides: Partial<PackageBuilderSubmissionInput> = {},
): PackageBuilderSubmissionInput {
  return {
    source: "cold-builder",
    first_name: "Jamie",
    last_name: "Lee",
    email: "jamie@example.com",
    phone: "5555550199",
    inquiry_id: null,
    invite_token: null,
    event_date: "2026-09-12",
    event_type: "wedding",
    venue: "The Chicory",
    guest_count: 120,
    consultation_pref: "video",
    client_note: null,
    selections_json: JSON.stringify({ collections: ["smile"], packages: [], addons: [] }),
    fixed_subtotal_cents: 89500,
    custom_quoted_json: null,
    warnings_json: null,
    ...overrides,
  };
}

describe("submissions CRUD", () => {
  beforeEach(() => {
    db = freshDb();
  });

  it("insertSubmission returns id + createdAt and persists every column", () => {
    const r = insertSubmission(db, sampleInput());
    expect(r.id).toBeGreaterThan(0);
    expect(r.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}/);

    const row = getSubmission(db, r.id);
    expect(row).toBeDefined();
    expect(row?.first_name).toBe("Jamie");
    expect(row?.status).toBe("new");
    expect(row?.fixed_subtotal_cents).toBe(89500);
    expect(row?.consultation_pref).toBe("video");
  });

  it("getAllSubmissions returns newest first", () => {
    const a = insertSubmission(db, sampleInput({ first_name: "Alpha" }));
    // SQLite CURRENT_TIMESTAMP is second-precision; force ordering by sleeping is overkill.
    // Instead bump created_at directly to guarantee an ordering gap.
    db.prepare(
      "UPDATE package_builder_submissions SET created_at = '2025-01-01 00:00:00' WHERE id = ?",
    ).run(a.id);
    const b = insertSubmission(db, sampleInput({ first_name: "Beta" }));

    const rows = getAllSubmissions(db);
    expect(rows.map((r) => r.first_name)).toEqual(["Beta", "Alpha"]);
    expect(rows[0].id).toBe(b.id);
  });

  it("updateSubmissionStatus to invoice_sent stamps invoice_sent_at", () => {
    const r = insertSubmission(db, sampleInput());
    const ok = updateSubmissionStatus(db, r.id, "invoice_sent");
    expect(ok).toBe(true);

    const row = getSubmission(db, r.id);
    expect(row?.status).toBe("invoice_sent");
    expect(row?.invoice_sent_at).not.toBeNull();
  });

  it("updateSubmissionStatus reverting to new clears invoice_sent_at", () => {
    const r = insertSubmission(db, sampleInput());
    updateSubmissionStatus(db, r.id, "invoice_sent");
    updateSubmissionStatus(db, r.id, "new");

    const row = getSubmission(db, r.id);
    expect(row?.status).toBe("new");
    expect(row?.invoice_sent_at).toBeNull();
  });

  it("updateSubmissionStatus on a missing id returns false", () => {
    expect(updateSubmissionStatus(db, 999, "invoice_sent")).toBe(false);
  });

  it("updateSubmissionNotes persists the value", () => {
    const r = insertSubmission(db, sampleInput());
    expect(updateSubmissionNotes(db, r.id, "Daniel called — sending invoice tomorrow.")).toBe(
      true,
    );
    const row = getSubmission(db, r.id);
    expect(row?.notes).toBe("Daniel called — sending invoice tomorrow.");
  });

  it("findInquiryIdByEmail returns the most recent matching inquiry id", () => {
    const oldId = seedInquiry("repeat@example.com");
    // Force the older row to have an older timestamp.
    db.prepare("UPDATE inquiries SET created_at = '2024-01-01 00:00:00' WHERE id = ?").run(
      oldId,
    );
    const newId = seedInquiry("repeat@example.com");

    expect(findInquiryIdByEmail(db, "repeat@example.com")).toBe(newId);
  });

  it("findInquiryIdByEmail returns null when no match", () => {
    expect(findInquiryIdByEmail(db, "nobody@example.com")).toBeNull();
  });

  it("persists JSON columns verbatim (round-trip)", () => {
    const selections = { collections: ["smile", "aurora"], packages: [], addons: [] };
    const customQuoted = [{ collectionId: "aurora", addonId: "lasers", startingPriceCents: 75000 }];
    const warnings = [{ code: "aurora-minimum-not-met", message: "..." }];

    const r = insertSubmission(
      db,
      sampleInput({
        selections_json: JSON.stringify(selections),
        custom_quoted_json: JSON.stringify(customQuoted),
        warnings_json: JSON.stringify(warnings),
      }),
    );
    const row = getSubmission(db, r.id);
    expect(JSON.parse(row!.selections_json)).toEqual(selections);
    expect(JSON.parse(row!.custom_quoted_json!)).toEqual(customQuoted);
    expect(JSON.parse(row!.warnings_json!)).toEqual(warnings);
  });
});
```

- [ ] **Step 2: Run tests to verify failure (red phase)**

Run from `apps/site/`:
```bash
pnpm test
```
Expected: catalog + compute suites still pass; the submissions suite fails with "Cannot find
module './submissions'". That's the expected red state.

- [ ] **Step 3: Implement `submissions.ts`**

Create `apps/site/src/lib/builder/submissions.ts`:

```ts
/**
 * CRUD for the `package_builder_submissions` table.
 *
 * Every function takes the Database instance explicitly so unit tests can
 * inject an in-memory DB. Production callers use `getDb()` from `@/lib/db`.
 */

import type Database from "better-sqlite3";

export type SubmissionStatus = "new" | "invoice_sent";
export type SubmissionSource = "invited-builder" | "cold-builder";
export type ConsultationPref = "video" | "in_person" | "none";

export interface PackageBuilderSubmissionRow {
  id: number;
  created_at: string;
  status: SubmissionStatus;
  invoice_sent_at: string | null;
  source: SubmissionSource;

  first_name: string;
  last_name: string;
  email: string;
  phone: string;

  inquiry_id: number | null;
  invite_token: string | null;

  event_date: string | null;
  event_type: string | null;
  venue: string | null;
  guest_count: number | null;
  consultation_pref: ConsultationPref | null;
  client_note: string | null;

  /** JSON-stringified BuilderSelections from compute.ts. */
  selections_json: string;
  fixed_subtotal_cents: number;
  /** JSON-stringified CustomQuotedItem[] from compute.ts. */
  custom_quoted_json: string | null;
  /** JSON-stringified BuilderWarning[] from compute.ts. */
  warnings_json: string | null;

  notes: string | null;
}

/**
 * Insert input — every field a caller must (or may) supply. `status`,
 * `invoice_sent_at`, `notes`, `id`, and `created_at` are server-managed
 * and never accepted from the caller.
 */
export interface PackageBuilderSubmissionInput {
  source: SubmissionSource;

  first_name: string;
  last_name: string;
  email: string;
  phone: string;

  inquiry_id: number | null;
  invite_token: string | null;

  event_date: string | null;
  event_type: string | null;
  venue: string | null;
  guest_count: number | null;
  consultation_pref: ConsultationPref | null;
  client_note: string | null;

  selections_json: string;
  fixed_subtotal_cents: number;
  custom_quoted_json: string | null;
  warnings_json: string | null;
}

export function insertSubmission(
  db: Database.Database,
  input: PackageBuilderSubmissionInput,
): { id: number; createdAt: string } {
  const result = db
    .prepare(
      `INSERT INTO package_builder_submissions (
        source,
        first_name, last_name, email, phone,
        inquiry_id, invite_token,
        event_date, event_type, venue, guest_count,
        consultation_pref, client_note,
        selections_json, fixed_subtotal_cents,
        custom_quoted_json, warnings_json
      ) VALUES (
        @source,
        @first_name, @last_name, @email, @phone,
        @inquiry_id, @invite_token,
        @event_date, @event_type, @venue, @guest_count,
        @consultation_pref, @client_note,
        @selections_json, @fixed_subtotal_cents,
        @custom_quoted_json, @warnings_json
      )`,
    )
    .run(input);

  const id = Number(result.lastInsertRowid);
  const row = db
    .prepare<[number], { created_at: string }>(
      "SELECT created_at FROM package_builder_submissions WHERE id = ?",
    )
    .get(id);
  return { id, createdAt: row?.created_at ?? new Date().toISOString() };
}

export function getSubmission(
  db: Database.Database,
  id: number,
): PackageBuilderSubmissionRow | undefined {
  return db
    .prepare("SELECT * FROM package_builder_submissions WHERE id = ?")
    .get(id) as PackageBuilderSubmissionRow | undefined;
}

export function getAllSubmissions(db: Database.Database): PackageBuilderSubmissionRow[] {
  return db
    .prepare("SELECT * FROM package_builder_submissions ORDER BY created_at DESC, id DESC")
    .all() as PackageBuilderSubmissionRow[];
}

/**
 * Flip status. Side effect: setting status to `invoice_sent` stamps
 * `invoice_sent_at = CURRENT_TIMESTAMP`; reverting to `new` clears it.
 * Returns false if no row matches the id.
 */
export function updateSubmissionStatus(
  db: Database.Database,
  id: number,
  status: SubmissionStatus,
): boolean {
  if (status === "invoice_sent") {
    const r = db
      .prepare(
        `UPDATE package_builder_submissions
         SET status = 'invoice_sent', invoice_sent_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(id);
    return r.changes > 0;
  }
  const r = db
    .prepare(
      `UPDATE package_builder_submissions
       SET status = 'new', invoice_sent_at = NULL
       WHERE id = ?`,
    )
    .run(id);
  return r.changes > 0;
}

export function updateSubmissionNotes(
  db: Database.Database,
  id: number,
  notes: string,
): boolean {
  const r = db
    .prepare("UPDATE package_builder_submissions SET notes = ? WHERE id = ?")
    .run(notes, id);
  return r.changes > 0;
}

/**
 * Soft-link lookup for cold submissions. Returns the id of the most recently
 * created `inquiries` row whose email matches (case-sensitive — matches the
 * existing inquiries-table convention), or null if none.
 */
export function findInquiryIdByEmail(
  db: Database.Database,
  email: string,
): number | null {
  const row = db
    .prepare<[string], { id: number }>(
      "SELECT id FROM inquiries WHERE email = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .get(email);
  return row?.id ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass (green phase)**

```bash
pnpm test
```
Expected: every catalog + compute + submissions test passes. If a submissions test fails, fix
the implementation, never the test.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```
Expected: `0 errors`.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/lib/builder/submissions.ts apps/site/src/lib/builder/submissions.test.ts
git commit -m "feat(builder): submissions CRUD with in-memory test suite

Typed CRUD against package_builder_submissions:
  - insertSubmission
  - getSubmission / getAllSubmissions (newest first)
  - updateSubmissionStatus (stamps invoice_sent_at; reverts clear it)
  - updateSubmissionNotes
  - findInquiryIdByEmail (most-recent match, null on miss)

Every function takes Database explicitly so the test suite can inject a
:memory: instance via the now-exported bootstrapSchema. Production
callers will pass the singleton from getDb().

Locked row shape PackageBuilderSubmissionRow matches the inter-cluster
contract verbatim — Cluster D and F can import it directly."
```

---

### Task B3: Invite CRUD with unit tests

Same shape as B2 — TDD, in-memory DB, explicit Database injection. Token generation uses
`crypto.randomBytes(24).toString('base64url')` per spec §2.2.

`createOrGetActiveInvite` is the key behavioral piece: the admin "Copy invite link" button
re-uses an existing unconsumed invite for the same inquiry instead of generating fresh tokens
on every click (spec §11.3). That keeps Daniel's outbox tidy and ensures `invite_token` audit
trails are predictable.

**Files:**
- Create: `apps/site/src/lib/builder/invites.test.ts`
- Create: `apps/site/src/lib/builder/invites.ts`

- [ ] **Step 1: Write the failing test suite**

Create `apps/site/src/lib/builder/invites.test.ts`:

```ts
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { bootstrapSchema } from "@/lib/db";
import {
  createOrGetActiveInvite,
  getInvite,
  markInviteConsumed,
} from "./invites";

let db: Database.Database;

function freshDb(): Database.Database {
  const d = new Database(":memory:");
  d.pragma("foreign_keys = ON");
  bootstrapSchema(d);
  return d;
}

function seedInquiry(email = "lead@example.com"): number {
  const r = db
    .prepare(
      `INSERT INTO inquiries (source, first_name, last_name, email, phone)
       VALUES ('contact-form', 'Lead', 'Person', ?, '5555550100')`,
    )
    .run(email);
  return Number(r.lastInsertRowid);
}

describe("invites CRUD", () => {
  beforeEach(() => {
    db = freshDb();
  });

  it("createOrGetActiveInvite creates a fresh row on first call", () => {
    const inquiryId = seedInquiry();
    const inv = createOrGetActiveInvite(db, inquiryId);

    expect(inv.token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url charset
    expect(inv.token.length).toBeGreaterThanOrEqual(32); // 24 bytes -> 32 chars
    expect(inv.inquiry_id).toBe(inquiryId);
    expect(inv.consumed_at).toBeNull();
    expect(inv.created_at).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("createOrGetActiveInvite returns the SAME row on a second call for the same inquiry", () => {
    const inquiryId = seedInquiry();
    const first = createOrGetActiveInvite(db, inquiryId);
    const second = createOrGetActiveInvite(db, inquiryId);
    expect(second.token).toBe(first.token);

    // And there should only be one row in the table.
    const count = db
      .prepare<[], { n: number }>(
        "SELECT COUNT(*) AS n FROM builder_invites WHERE inquiry_id = ?",
      )
      .get(inquiryId)?.n;
    expect(count).toBe(1);
  });

  it("createOrGetActiveInvite creates a NEW row after the previous is consumed", () => {
    const inquiryId = seedInquiry();
    const first = createOrGetActiveInvite(db, inquiryId);
    markInviteConsumed(db, first.token);

    const second = createOrGetActiveInvite(db, inquiryId);
    expect(second.token).not.toBe(first.token);

    const count = db
      .prepare<[], { n: number }>(
        "SELECT COUNT(*) AS n FROM builder_invites WHERE inquiry_id = ?",
      )
      .get(inquiryId)?.n;
    expect(count).toBe(2);
  });

  it("getInvite returns the row by token", () => {
    const inquiryId = seedInquiry();
    const created = createOrGetActiveInvite(db, inquiryId);
    const row = getInvite(db, created.token);
    expect(row?.token).toBe(created.token);
    expect(row?.inquiry_id).toBe(inquiryId);
  });

  it("getInvite returns undefined for unknown token", () => {
    expect(getInvite(db, "not-a-real-token")).toBeUndefined();
  });

  it("markInviteConsumed stamps consumed_at and is idempotent", () => {
    const inquiryId = seedInquiry();
    const inv = createOrGetActiveInvite(db, inquiryId);

    expect(markInviteConsumed(db, inv.token)).toBe(true);
    const row1 = getInvite(db, inv.token);
    expect(row1?.consumed_at).not.toBeNull();

    // Second consume on the same token is a no-op (consumed_at unchanged, returns false).
    const consumedAt1 = row1?.consumed_at;
    expect(markInviteConsumed(db, inv.token)).toBe(false);
    const row2 = getInvite(db, inv.token);
    expect(row2?.consumed_at).toBe(consumedAt1);
  });

  it("markInviteConsumed on unknown token returns false", () => {
    expect(markInviteConsumed(db, "bogus")).toBe(false);
  });

  it("two different inquiries get two different tokens", () => {
    const a = createOrGetActiveInvite(db, seedInquiry("a@example.com"));
    const b = createOrGetActiveInvite(db, seedInquiry("b@example.com"));
    expect(a.token).not.toBe(b.token);
  });
});
```

- [ ] **Step 2: Run tests to verify failure (red phase)**

```bash
pnpm test
```
Expected: every other suite still passes; the invites suite fails with "Cannot find module
'./invites'". Expected red state.

- [ ] **Step 3: Implement `invites.ts`**

Create `apps/site/src/lib/builder/invites.ts`:

```ts
/**
 * CRUD for the `builder_invites` table.
 *
 * An invite is a URL-safe token an admin generates from an inquiry. The
 * recipient opens `/build?invite=<token>` and the page prefills from the
 * linked inquiry. First successful submission stamps `consumed_at` so the
 * admin UI can show "already used" badges.
 *
 * `createOrGetActiveInvite` is the canonical way to issue an invite — it
 * reuses any unconsumed invite for the same inquiry instead of churning
 * tokens. New tokens are minted only after the previous one is consumed.
 *
 * Every function takes the Database instance explicitly so unit tests can
 * inject an in-memory DB.
 */

import crypto from "node:crypto";
import type Database from "better-sqlite3";

export interface BuilderInviteRow {
  token: string;
  inquiry_id: number;
  created_at: string;
  expires_at: string | null;
  consumed_at: string | null;
  created_by: string;
}

/** 24 random bytes encoded as URL-safe base64 → 32 chars, no padding. */
function newToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * Return the inquiry's active (unconsumed) invite if one exists; otherwise
 * mint a new one. V1 invites never expire; `expires_at` is always null.
 * `created_by` defaults to "admin" — every v1 invite is admin-issued.
 */
export function createOrGetActiveInvite(
  db: Database.Database,
  inquiryId: number,
  createdBy: string = "admin",
): BuilderInviteRow {
  const existing = db
    .prepare(
      `SELECT * FROM builder_invites
       WHERE inquiry_id = ? AND consumed_at IS NULL
       ORDER BY created_at DESC, token ASC
       LIMIT 1`,
    )
    .get(inquiryId) as BuilderInviteRow | undefined;
  if (existing) return existing;

  const token = newToken();
  db.prepare(
    `INSERT INTO builder_invites (token, inquiry_id, expires_at, created_by)
     VALUES (?, ?, NULL, ?)`,
  ).run(token, inquiryId, createdBy);

  const row = db
    .prepare("SELECT * FROM builder_invites WHERE token = ?")
    .get(token) as BuilderInviteRow | undefined;
  if (!row) {
    // Should never happen — INSERT succeeded but SELECT couldn't find it.
    throw new Error("createOrGetActiveInvite: failed to read back inserted row");
  }
  return row;
}

export function getInvite(
  db: Database.Database,
  token: string,
): BuilderInviteRow | undefined {
  return db
    .prepare("SELECT * FROM builder_invites WHERE token = ?")
    .get(token) as BuilderInviteRow | undefined;
}

/**
 * Stamp `consumed_at` on first consumption. Returns true if the row was
 * updated (was unconsumed and existed); false if the token is unknown or
 * already consumed. Safe to call multiple times — idempotent semantics.
 */
export function markInviteConsumed(
  db: Database.Database,
  token: string,
): boolean {
  const r = db
    .prepare(
      `UPDATE builder_invites
       SET consumed_at = CURRENT_TIMESTAMP
       WHERE token = ? AND consumed_at IS NULL`,
    )
    .run(token);
  return r.changes > 0;
}
```

- [ ] **Step 4: Run tests to verify they pass (green phase)**

```bash
pnpm test
```
Expected: every catalog + compute + submissions + invites test passes. If an invites test
fails, fix the implementation; do not loosen the test.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```
Expected: `0 errors`.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/lib/builder/invites.ts apps/site/src/lib/builder/invites.test.ts
git commit -m "feat(builder): invite CRUD with reuse-active semantics

Typed CRUD against builder_invites:
  - createOrGetActiveInvite (returns the inquiry's existing unconsumed
    invite, or mints a new one — admin clicks 'Copy invite link' twice
    and gets the same token)
  - getInvite (lookup by token)
  - markInviteConsumed (stamps consumed_at; idempotent, returns false
    if the token is unknown or already consumed)

Tokens are 24 random bytes encoded base64url (32 URL-safe chars).
V1 invites never expire (expires_at = NULL); per-token expiry is a
Phase 2 admin control.

Locked row shape BuilderInviteRow matches the inter-cluster contract
verbatim — Cluster D's invite endpoints and Cluster F's admin pages
can import it directly."
```

---

### Cluster B — Review checkpoint

Stop here. Verify:

- `pnpm test` from `apps/site/` runs all four suites (catalog, compute, submissions, invites)
  and reports 0 failures.
- `pnpm typecheck` from `apps/site/` reports `0 errors`.
- `git log --oneline -3` shows the three Cluster B commits on `feature/package-builder`:
  `refactor(db)`, `feat(builder): submissions CRUD`, `feat(builder): invite CRUD`.
- `apps/site/src/lib/db.ts` exports `bootstrapSchema` and the two new `CREATE TABLE` blocks
  are present.
- `apps/site/src/lib/builder/` contains `submissions.ts`, `submissions.test.ts`, `invites.ts`,
  `invites.test.ts` alongside the Cluster A files.
- Dev DB at `data/leads.db` has the new tables (`sqlite3 data/leads.db ".tables"` shows
  `package_builder_submissions` and `builder_invites`). Production `data/leads.db` rows in
  existing tables are untouched.
- No production code path imports the test files (vitest picks them up by filename pattern
  `*.test.ts`, not via app imports).

Next cluster (C) migrates the contact form's email sending from nodemailer to Resend and adds
the builder-submission notification helper. No DB changes; the rate limiter helper extraction
lands in Cluster D alongside the server endpoints that consume it.

---

## Cluster D — Server endpoints

Wires the four HTTP routes that connect the React island (Cluster E) and the admin UI
(Cluster F) to the persistence layer (Cluster B), the recompute function (Cluster A), and the
notification helper (Cluster C). All routes follow the conventions established by
`apps/site/src/pages/api/contact.ts`: `export const prerender = false`, JSON-first parsing,
save-before-notify ordering, and a tiny local `jsonResponse` helper. Error responses match the
spec section 8.1 shape verbatim: `{ ok: false, error: <code>, ... }` with the exact codes
`validation_failed`, `unknown_selection`, `invalid_invite`, `rate_limited`, `server_error`.

Cluster D depends on:
- Cluster A: `computeSubmission`, `ComputeResult`, `BuilderSelections` from
  `@/lib/builder/compute`.
- Cluster B: `insertSubmission`, `getSubmission`, `findInquiryIdByEmail`, `markInvoiceSent`,
  `revertToNew` from `@/lib/builder/submissions`; `createOrGetActiveInvite`, `getInvite`,
  `markInviteConsumed` from `@/lib/builder/invites`.
- Cluster C: `sendBuilderSubmissionNotification(submission, computed)` from `@/lib/email`.

If any of those exports are missing when a task asks you to import them, stop and unblock the
upstream cluster — do not add stubs.

### Task D1: Extract a generic `rateLimit` helper from `auth.ts`

The existing `loginRateLimit(ip)` hard-codes a single bucket, a 5-minute window, and a max of
5 attempts. The builder endpoint needs its OWN bucket (10-minute window, max 5) so a hammered
admin login can't lock out real lead submissions and vice versa. We refactor the bucket logic
into a parameterized `rateLimit(bucketKey, ip, opts)` helper and keep `loginRateLimit` as a
thin wrapper that preserves its current API and limits byte-for-byte.

**Files:**
- Modify: `apps/site/src/lib/auth.ts`
- Create: `apps/site/src/lib/auth.test.ts`

- [ ] **Step 1: Write the failing test suite (red phase)**

Create `apps/site/src/lib/auth.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loginRateLimit, rateLimit, resetRateLimit } from "./auth";

describe("rateLimit (generic)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to max within the window and blocks the next", () => {
    const ip = "10.0.0.1";
    const opts = { windowMs: 60_000, max: 3 };
    expect(rateLimit("test-a", ip, opts).allowed).toBe(true);
    expect(rateLimit("test-a", ip, opts).allowed).toBe(true);
    const third = rateLimit("test-a", ip, opts);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const blocked = rateLimit("test-a", ip, opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("isolates buckets — exhausting one does not affect another", () => {
    const ip = "10.0.0.2";
    const opts = { windowMs: 60_000, max: 1 };
    expect(rateLimit("bucket-a", ip, opts).allowed).toBe(true);
    expect(rateLimit("bucket-a", ip, opts).allowed).toBe(false);
    // Different bucket key — still fresh.
    expect(rateLimit("bucket-b", ip, opts).allowed).toBe(true);
  });

  it("isolates IPs within the same bucket", () => {
    const opts = { windowMs: 60_000, max: 1 };
    expect(rateLimit("bucket-c", "10.0.0.3", opts).allowed).toBe(true);
    expect(rateLimit("bucket-c", "10.0.0.3", opts).allowed).toBe(false);
    expect(rateLimit("bucket-c", "10.0.0.4", opts).allowed).toBe(true);
  });

  it("resets after the window elapses", () => {
    const ip = "10.0.0.5";
    const opts = { windowMs: 60_000, max: 1 };
    expect(rateLimit("bucket-d", ip, opts).allowed).toBe(true);
    expect(rateLimit("bucket-d", ip, opts).allowed).toBe(false);

    vi.advanceTimersByTime(61_000);
    expect(rateLimit("bucket-d", ip, opts).allowed).toBe(true);
  });
});

describe("loginRateLimit (wrapper, unchanged API)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("still allows 5 attempts per 5-minute window per IP", () => {
    const ip = "10.0.1.1";
    for (let i = 0; i < 5; i++) {
      expect(loginRateLimit(ip).allowed).toBe(true);
    }
    expect(loginRateLimit(ip).allowed).toBe(false);
  });

  it("login bucket is isolated from the builder bucket", () => {
    const ip = "10.0.1.2";
    // Exhaust the login bucket.
    for (let i = 0; i < 5; i++) loginRateLimit(ip);
    expect(loginRateLimit(ip).allowed).toBe(false);
    // The builder bucket on the same IP is unaffected.
    const r = rateLimit("builder-submit", ip, { windowMs: 600_000, max: 5 });
    expect(r.allowed).toBe(true);
  });

  it("resetRateLimit clears the login bucket only", () => {
    const ip = "10.0.1.3";
    for (let i = 0; i < 5; i++) loginRateLimit(ip);
    expect(loginRateLimit(ip).allowed).toBe(false);
    resetRateLimit(ip);
    expect(loginRateLimit(ip).allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to confirm red**

Run from `apps/site/`:
```bash
pnpm test
```
Expected: every previous suite passes; the new `auth.test.ts` fails on imports because
`rateLimit` is not yet exported.

- [ ] **Step 3: Refactor `auth.ts`**

Open `apps/site/src/lib/auth.ts`. Replace the entire "Rate limit" section (everything from the
section banner `/* ===... Rate limit ... === */` through the end of `resetRateLimit`) with the
following. The `clientIp` helper stays untouched.

```ts
/* ============================================================================
 * Rate limit — in-memory, per-(bucket, IP), sliding window
 * ========================================================================== */

interface RateBucket {
  count: number;
  /** Unix ms when the bucket was created. */
  start: number;
}

/**
 * Buckets are keyed by `${bucketKey}::${ip}` so different routes get isolated
 * counters on the same IP. A hammered `/admin/login` cannot lock out
 * `/api/package-builder` and vice versa.
 */
const buckets = new Map<string, RateBucket>();

const LOGIN_BUCKET = "login";
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

/**
 * Returns the IP address to use as the rate-limit key. Honors common proxy
 * headers but falls back to a sentinel when nothing's available.
 */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/**
 * Generic sliding-window rate limiter. Returns `allowed: true` and decrements
 * `remaining` while under the threshold; returns `allowed: false` with a
 * `retryAfter` (seconds) once exceeded.
 *
 * @param bucketKey  Logical bucket (e.g. "login", "builder-submit"). Buckets
 *                   are isolated — exhausting one does not affect another.
 * @param ip         Client IP from {@link clientIp}.
 * @param opts       `windowMs` is the sliding-window length in ms;
 *                   `max` is the maximum number of allowed calls per window.
 *
 * Side effect: prunes expired buckets on each call (cheap O(n) sweep).
 */
export function rateLimit(
  bucketKey: string,
  ip: string,
  opts: { windowMs: number; max: number },
): { allowed: boolean; remaining: number; retryAfter: number } {
  const now = Date.now();
  // Prune across ALL buckets — cheap.
  for (const [k, v] of buckets) {
    if (now - v.start > opts.windowMs) buckets.delete(k);
  }

  const key = `${bucketKey}::${ip}`;
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.start > opts.windowMs) {
    buckets.set(key, { count: 1, start: now });
    return { allowed: true, remaining: opts.max - 1, retryAfter: 0 };
  }

  bucket.count += 1;
  if (bucket.count > opts.max) {
    const retryAfter = Math.max(1, Math.ceil((opts.windowMs - (now - bucket.start)) / 1000));
    return { allowed: false, remaining: 0, retryAfter };
  }
  return { allowed: true, remaining: Math.max(0, opts.max - bucket.count), retryAfter: 0 };
}

/**
 * Login-specific wrapper. Preserves the original (single-arg) API exactly so
 * `/api/admin/login` keeps working without edits. 5 attempts per 5 minutes.
 */
export function loginRateLimit(
  ip: string,
): { allowed: boolean; remaining: number; retryAfter: number } {
  return rateLimit(LOGIN_BUCKET, ip, {
    windowMs: LOGIN_WINDOW_MS,
    max: LOGIN_MAX_ATTEMPTS,
  });
}

/** Reset the login bucket for an IP — call after a successful login. */
export function resetRateLimit(ip: string): void {
  buckets.delete(`${LOGIN_BUCKET}::${ip}`);
}
```

- [ ] **Step 4: Run tests to confirm green**

```bash
pnpm test
```
Expected: every suite passes including the new `auth.test.ts`. Pruning notice: the prune pass
uses the caller's `opts.windowMs`, which is conservative — buckets only get pruned by a caller
whose window matches or exceeds theirs. That is fine for v1; both windows are minutes-long and
in-memory. Add a TODO comment only if you want; do not over-engineer.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```
Expected: `0 errors`. `/api/admin/login.ts` should still compile because `loginRateLimit`'s
signature is byte-identical.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/lib/auth.ts apps/site/src/lib/auth.test.ts
git commit -m "refactor(auth): extract generic rateLimit helper

Pulls the sliding-window logic out of loginRateLimit into a
parameterized rateLimit(bucketKey, ip, opts) helper. Buckets are
keyed by '\${bucketKey}::\${ip}' so different routes get isolated
counters on the same IP — exhausting the login bucket no longer
blocks /api/package-builder, and vice versa.

loginRateLimit keeps its single-argument signature and original
5-per-5-minute limit so /api/admin/login compiles unchanged.

Tests cover: per-bucket isolation, per-IP isolation, window
expiry, and login wrapper backward compatibility."
```

---

### Task D2: Add `BuilderSubmissionSchema` to `lib/schema.ts`

The Zod schema validates the `POST /api/package-builder` request body. The shape is locked in
the "Inter-cluster contracts" section — implement it verbatim. Reuse the existing `trim` and
`optionalTrim` helpers from `schema.ts` for consistent error messages. Selection sub-schemas
validate ids as non-empty strings; per-id existence is checked by `computeSubmission` (Cluster
A), not Zod, because the catalog is the only authority on which ids are valid.

**Files:**
- Modify: `apps/site/src/lib/schema.ts`
- Create: `apps/site/src/lib/schema.test.ts`

- [ ] **Step 1: Write the failing test suite (red phase)**

Create `apps/site/src/lib/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BuilderSubmissionSchema } from "./schema";

function validBody() {
  return {
    client: {
      firstName: "Jamie",
      lastName: "Lee",
      email: "jamie@example.com",
      phone: "5555550199",
    },
    event: {
      date: "2026-09-12",
      type: "wedding",
      venue: "The Chicory",
      guestCount: 120,
      note: "Outdoor ceremony moves indoors if it rains.",
    },
    consultationPref: "video" as const,
    selections: {
      collections: ["smile"],
      packages: [{ collectionId: "smile", packageId: "mirror-me" }],
      addons: [
        { collectionId: "smile", addonId: "audio-guest-book", qty: 1 },
      ],
    },
  };
}

describe("BuilderSubmissionSchema", () => {
  it("accepts a well-formed cold-path body (no invite token)", () => {
    const r = BuilderSubmissionSchema.safeParse(validBody());
    expect(r.success).toBe(true);
  });

  it("accepts an invited-path body (invite token present)", () => {
    const body = { ...validBody(), invite: "abc123def456" };
    const r = BuilderSubmissionSchema.safeParse(body);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.invite).toBe("abc123def456");
  });

  it("accepts an empty selections set (zero collections)", () => {
    const body = validBody();
    body.selections = { collections: [], packages: [], addons: [] };
    const r = BuilderSubmissionSchema.safeParse(body);
    expect(r.success).toBe(true);
  });

  it("trims whitespace on client and event string fields", () => {
    const body = validBody();
    body.client.firstName = "  Jamie  ";
    body.event.venue = "  The Chicory  ";
    const r = BuilderSubmissionSchema.safeParse(body);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.client.firstName).toBe("Jamie");
      expect(r.data.event.venue).toBe("The Chicory");
    }
  });

  it("rejects a body with an invalid email", () => {
    const body = validBody();
    body.client.email = "not-an-email";
    const r = BuilderSubmissionSchema.safeParse(body);
    expect(r.success).toBe(false);
  });

  it("rejects a body missing required client fields", () => {
    const body = validBody();
    // @ts-expect-error — intentional bad shape
    delete body.client.firstName;
    const r = BuilderSubmissionSchema.safeParse(body);
    expect(r.success).toBe(false);
  });

  it("rejects a body with an unknown consultationPref", () => {
    const body = validBody();
    // @ts-expect-error — intentional bad shape
    body.consultationPref = "carrier-pigeon";
    const r = BuilderSubmissionSchema.safeParse(body);
    expect(r.success).toBe(false);
  });

  it("rejects an addon with qty < 1", () => {
    const body = validBody();
    body.selections.addons = [
      { collectionId: "smile", addonId: "audio-guest-book", qty: 0 },
    ];
    const r = BuilderSubmissionSchema.safeParse(body);
    expect(r.success).toBe(false);
  });

  it("rejects an addon with non-integer qty", () => {
    const body = validBody();
    body.selections.addons = [
      { collectionId: "smile", addonId: "audio-guest-book", qty: 1.5 },
    ];
    const r = BuilderSubmissionSchema.safeParse(body);
    expect(r.success).toBe(false);
  });

  it("rejects a package selection with an empty packageId", () => {
    const body = validBody();
    body.selections.packages = [{ collectionId: "smile", packageId: "" }];
    const r = BuilderSubmissionSchema.safeParse(body);
    expect(r.success).toBe(false);
  });

  it("coerces missing event sub-fields to null/undefined", () => {
    const body = validBody();
    // @ts-expect-error — intentional minimum event payload
    body.event = {};
    const r = BuilderSubmissionSchema.safeParse(body);
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to confirm red**

```bash
pnpm test
```
Expected: every other suite passes; `schema.test.ts` fails on import — `BuilderSubmissionSchema`
does not yet exist.

- [ ] **Step 3: Append `BuilderSubmissionSchema` to `apps/site/src/lib/schema.ts`**

At the very bottom of `apps/site/src/lib/schema.ts`, append:

```ts
/* ---- Package builder submission (POST /api/package-builder) --------------- */

/**
 * Request body for the package builder. Shape locked by the inter-cluster
 * contract in `docs/superpowers/plans/2026-05-11-package-builder.md`.
 *
 * The schema validates structure only. Per-id existence checks (does this
 * packageId actually live in this collection?) live in `computeSubmission`
 * from `@/lib/builder/compute`, which is the only authority on the catalog.
 *
 * Numbers in `event.guestCount` and `selections.addons[].qty` are coerced
 * from strings so the same schema works for a JSON body or a form-data
 * fallback if a future caller needs one.
 */

const builderClientSchema = z.object({
  firstName: trim(80).min(1, "Please share your first name"),
  lastName:  trim(80).min(1, "Please share your last name"),
  email:     z.string().trim().min(1, "Please share an email").email("That email looks off"),
  phone:     trim(40).min(7, "Please share a phone number"),
});

const builderEventSchema = z.object({
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date")
    .nullish()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  type:  optionalTrim(80).transform((v) => v ?? null),
  venue: optionalTrim(160).transform((v) => v ?? null),
  guestCount: z.coerce.number().int().min(0).max(100000).nullish().transform((v) => v ?? null),
  note: optionalTrim(4000).transform((v) => v ?? null),
});

const builderSelectedPackageSchema = z.object({
  collectionId: trim(40).min(1),
  packageId:    trim(80).min(1),
});

const builderSelectedAddonSchema = z.object({
  collectionId: trim(40).min(1),
  addonId:      trim(80).min(1),
  qty: z.coerce.number().int().min(1, "Quantity must be at least 1"),
});

const builderSelectionsSchema = z.object({
  collections: z.array(trim(40).min(1)),
  packages:    z.array(builderSelectedPackageSchema),
  addons:      z.array(builderSelectedAddonSchema),
});

export const BuilderSubmissionSchema = z.object({
  /** Present iff the visitor arrived via an invite link. */
  invite: optionalTrim(120),
  client: builderClientSchema,
  event:  builderEventSchema,
  consultationPref: z.enum(["video", "in_person", "none"]),
  selections: builderSelectionsSchema,
});

export type BuilderSubmissionInput = z.infer<typeof BuilderSubmissionSchema>;
```

- [ ] **Step 4: Run tests to confirm green**

```bash
pnpm test
```
Expected: every suite passes including `schema.test.ts` (11 cases).

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```
Expected: `0 errors`.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/lib/schema.ts apps/site/src/lib/schema.test.ts
git commit -m "feat(schema): BuilderSubmissionSchema for /api/package-builder

Zod schema covering the locked inter-cluster contract: optional
invite token, required client block (firstName/lastName/email/
phone), optional event sub-fields coerced to null, consultation
preference enum, and a selections sub-schema for collections,
packages, and addons with integer qty >= 1.

Per-id existence checks are deliberately NOT here — those live in
computeSubmission, which is the only authority on the catalog.

Unit tests cover well-formed cold and invited bodies, whitespace
trimming, every required-field rejection, the consultationPref
enum, qty validation (zero, non-integer), and the empty-selections
edge case."
```

---

### Task D3: `POST /api/package-builder` endpoint

The submission endpoint. Pipeline: parse JSON body → rate-limit by IP via the new
`rateLimit('builder-submit', ip, { windowMs: 600_000, max: 5 })` → Zod validate via
`BuilderSubmissionSchema` → call `computeSubmission` (server-authoritative recompute, discards
any client total) → resolve invite token (if present) → soft-link by email (cold path) → insert
the row via `insertSubmission` → fire-and-forget `sendBuilderSubmissionNotification` → respond
`201 { ok: true, id, createdAt }`. Error codes match spec section 8.1 exactly.

**Files:**
- Create: `apps/site/src/pages/api/package-builder.ts`

- [ ] **Step 1: Confirm upstream exports exist**

```bash
grep -n "^export function computeSubmission\|^export function insertSubmission\|^export function findInquiryIdByEmail\|^export function getInvite\|^export function markInviteConsumed\|^export function getSubmission\|^export async function sendBuilderSubmissionNotification" \
  apps/site/src/lib/builder/compute.ts \
  apps/site/src/lib/builder/submissions.ts \
  apps/site/src/lib/builder/invites.ts \
  apps/site/src/lib/email.ts
```
Expected: every name in the grep appears at least once. If any are missing, the prerequisite
cluster (A, B, or C) is incomplete — stop and unblock it. Do not stub.

- [ ] **Step 2: Create the endpoint**

Create `apps/site/src/pages/api/package-builder.ts`:

```ts
/**
 * POST /api/package-builder
 *
 * Receives a JSON body matching BuilderSubmissionSchema, validates and
 * recomputes server-side against the canonical pricing catalog, resolves
 * the optional invite token, persists the submission, and fires off the
 * Resend notification (never awaited — save-before-notify ordering).
 *
 * Error codes follow spec section 8.1 exactly:
 *   400  validation_failed | unknown_selection | invalid_invite
 *   429  rate_limited
 *   500  server_error
 *
 * The endpoint NEVER trusts a client-submitted total. `computeSubmission`
 * is the only authority on the dollar number that gets persisted.
 */

import type { APIRoute } from "astro";
import type { z } from "zod";
import { BuilderSubmissionSchema } from "@/lib/schema";
import { computeSubmission } from "@/lib/builder/compute";
import {
  findInquiryIdByEmail,
  getSubmission,
  insertSubmission,
} from "@/lib/builder/submissions";
import { getInvite, markInviteConsumed } from "@/lib/builder/invites";
import { sendBuilderSubmissionNotification } from "@/lib/email";
import { clientIp, rateLimit } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const prerender = false;

const RATE_OPTS = { windowMs: 600_000, max: 5 } as const; // 5 per 10 minutes per IP

export const POST: APIRoute = async ({ request }) => {
  // ---- 1. Rate limit (cheap; do this before body parse) -----------------
  const ip = clientIp(request);
  const gate = rateLimit("builder-submit", ip, RATE_OPTS);
  if (!gate.allowed) {
    return jsonResponse(429, {
      ok: false,
      error: "rate_limited",
      retryAfter: gate.retryAfter,
    });
  }

  // ---- 2. Body parse -----------------------------------------------------
  let raw: unknown;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return jsonResponse(415, { ok: false, error: "validation_failed" });
    }
    raw = await request.json();
  } catch {
    return jsonResponse(400, { ok: false, error: "validation_failed" });
  }

  // ---- 3. Zod validate ---------------------------------------------------
  const parsed = BuilderSubmissionSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonResponse(400, {
      ok: false,
      error: "validation_failed",
      details: flattenZod(parsed.error),
    });
  }
  const data = parsed.data;

  // ---- 4. Server-authoritative recompute ---------------------------------
  // computeSubmission validates every id against the catalog and computes the
  // canonical subtotal, custom-quoted list, and warnings. We discard whatever
  // the client may have claimed for those values.
  const computed = computeSubmission(data.selections);
  if (!computed.ok) {
    return jsonResponse(400, {
      ok: false,
      error: "unknown_selection",
      details: computed.details ?? computed.error,
    });
  }

  // ---- 5. Invite resolution (invited path) -------------------------------
  const db = getDb();
  let inquiryId: number | null = null;
  let inviteToken: string | null = null;
  let source: "invited-builder" | "cold-builder" = "cold-builder";

  if (data.invite) {
    const invite = getInvite(db, data.invite);
    if (!invite) {
      return jsonResponse(400, { ok: false, error: "invalid_invite" });
    }
    if (invite.expires_at) {
      const expMs = Date.parse(invite.expires_at.replace(" ", "T") + "Z");
      if (Number.isFinite(expMs) && expMs < Date.now()) {
        return jsonResponse(400, { ok: false, error: "invalid_invite" });
      }
    }
    inquiryId = invite.inquiry_id;
    inviteToken = invite.token;
    source = "invited-builder";
    // Stamp consumed_at — idempotent, fine to call on an already-consumed token.
    markInviteConsumed(db, invite.token);
  } else {
    // Cold path — soft-link by email if a matching inquiry exists.
    inquiryId = findInquiryIdByEmail(db, data.client.email);
  }

  // ---- 6. Persist --------------------------------------------------------
  let saved: { id: number; createdAt: string };
  try {
    saved = insertSubmission(db, {
      source,
      first_name: data.client.firstName,
      last_name:  data.client.lastName,
      email:      data.client.email,
      phone:      data.client.phone,
      inquiry_id:   inquiryId,
      invite_token: inviteToken,
      event_date:        data.event.date,
      event_type:        data.event.type,
      venue:             data.event.venue,
      guest_count:       data.event.guestCount,
      consultation_pref: data.consultationPref,
      client_note:       data.event.note,
      selections_json:      JSON.stringify(data.selections),
      fixed_subtotal_cents: computed.fixedSubtotalCents,
      custom_quoted_json:   computed.customQuoted.length > 0
        ? JSON.stringify(computed.customQuoted)
        : null,
      warnings_json: computed.warnings.length > 0
        ? JSON.stringify(computed.warnings)
        : null,
    });
  } catch (err) {
    console.error("[/api/package-builder] DB insert failed:", err);
    return jsonResponse(500, { ok: false, error: "server_error" });
  }

  // ---- 7. Fire-and-forget notification (NEVER awaited) -------------------
  const row = getSubmission(db, saved.id);
  if (row) {
    void sendBuilderSubmissionNotification(row, computed);
  }

  // ---- 8. Respond --------------------------------------------------------
  return jsonResponse(201, {
    ok: true,
    id: saved.id,
    createdAt: saved.createdAt,
  });
};

/* ============================================================================
 * Helpers (local to this endpoint, same shape as /api/contact.ts)
 * ============================================================================ */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function flattenZod(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    out[issue.path.join(".") || "_"] = issue.message;
  }
  return out;
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```
Expected: `0 errors`. If `getDb` is unfamiliar, confirm it exists with
`grep -n "export function getDb" apps/site/src/lib/db.ts`.

- [ ] **Step 4: Smoke test with `curl`**

Run `pnpm dev` from `apps/site/` in one terminal. In another:

```bash
curl -sS -X POST http://localhost:4321/api/package-builder \
  -H 'Content-Type: application/json' \
  -d '{
    "client": {"firstName":"Smoke","lastName":"Test","email":"smoke@example.com","phone":"5555550100"},
    "event":  {"date":"2026-12-31","type":"wedding","venue":"Test","guestCount":50,"note":null},
    "consultationPref": "none",
    "selections": {"collections":["smile"],"packages":[],"addons":[]}
  }' | jq .
```
Expected: `{ "ok": true, "id": <num>, "createdAt": "..." }` with HTTP 201. The empty-selections
case produces a $0 fixed subtotal and no warnings — that is acceptable per spec section 13 case 15.

Then verify rate limiting kicks in. Run the same curl six times in quick succession; the sixth
should produce `{ "ok": false, "error": "rate_limited", "retryAfter": <secs> }` with HTTP 429.

Tamper test: replace the `addons` array with a fake id and confirm a 400 response with
`error: "unknown_selection"`.

Stop the dev server when done. Delete the smoke-test rows from `/admin/package-builder` later.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/pages/api/package-builder.ts
git commit -m "feat(api): POST /api/package-builder submission endpoint

Server-authoritative pipeline: rate-limit by IP (5 per 10 minutes
on the dedicated 'builder-submit' bucket), parse JSON, validate
with BuilderSubmissionSchema, recompute via computeSubmission
(client-submitted totals are discarded), resolve invite token or
soft-link by email, insert the row, then fire-and-forget the
Resend notification.

Error responses follow spec section 8.1 exactly:
  400 validation_failed | unknown_selection | invalid_invite
  429 rate_limited (with retryAfter seconds)
  500 server_error

Save-before-notify ordering matches /api/contact.ts: the
sendBuilderSubmissionNotification call is voided, never awaited."
```

---

### Task D4: `POST /api/package-builder/invite` (admin-only)

Mints (or re-uses) an invite token for an inquiry. Admin-only — gated by an explicit
`isAuthed(request)` check because this endpoint lives under `/api/package-builder/` (not under
`/api/admin/`), so the middleware does not cover it. Body: `{ inquiryId: number }`. Response
includes the full clickable URL the caller's clipboard handler will copy.

**Files:**
- Create: `apps/site/src/pages/api/package-builder/invite.ts`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p apps/site/src/pages/api/package-builder
```

- [ ] **Step 2: Create the endpoint**

Create `apps/site/src/pages/api/package-builder/invite.ts`:

```ts
/**
 * POST /api/package-builder/invite
 *
 * Admin-only. Body: { inquiryId: number }. Mints an invite token for the
 * given inquiry, or re-uses the existing unconsumed invite if one is already
 * active (so clicking "Copy invite link" twice gives the same URL — spec
 * section 11.3).
 *
 * Returns: { ok: true, url, token, expiresAt }.
 *
 * This endpoint lives under /api/package-builder/ — NOT under /api/admin/ —
 * so the global admin middleware does not cover it. We gate explicitly with
 * isAuthed(request).
 */

import type { APIRoute } from "astro";
import { isAuthed } from "@/lib/auth";
import { createOrGetActiveInvite } from "@/lib/builder/invites";
import { getDb } from "@/lib/db";

export const prerender = false;

interface InviteRequestBody {
  inquiryId?: unknown;
}

export const POST: APIRoute = async ({ request }) => {
  // ---- 1. Auth ----------------------------------------------------------
  if (!isAuthed(request)) {
    return jsonResponse(401, { ok: false, error: "unauthenticated" });
  }

  // ---- 2. Parse body ----------------------------------------------------
  let raw: InviteRequestBody;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return jsonResponse(415, { ok: false, error: "validation_failed" });
    }
    raw = (await request.json()) as InviteRequestBody;
  } catch {
    return jsonResponse(400, { ok: false, error: "validation_failed" });
  }

  const inquiryId = Number(raw.inquiryId);
  if (!Number.isInteger(inquiryId) || inquiryId < 1) {
    return jsonResponse(400, { ok: false, error: "validation_failed" });
  }

  // ---- 3. Mint or re-use invite -----------------------------------------
  let invite: { token: string; inquiry_id: number; expires_at: string | null };
  try {
    invite = createOrGetActiveInvite(getDb(), inquiryId, "admin");
  } catch (err) {
    console.error("[/api/package-builder/invite] createOrGetActiveInvite failed:", err);
    return jsonResponse(500, { ok: false, error: "server_error" });
  }

  // ---- 4. Build the URL (origin from the inbound request) ---------------
  // In production this evaluates to https://smile-nola.com/build?invite=…;
  // locally it stays on http://localhost:4321 so dev testing works without
  // hard-coded hosts.
  const base = new URL(request.url).origin;
  const url = `${base}/build?invite=${encodeURIComponent(invite.token)}`;

  return jsonResponse(200, {
    ok: true,
    url,
    token: invite.token,
    expiresAt: invite.expires_at,
  });
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```
Expected: `0 errors`. If `createOrGetActiveInvite` is not yet exported, Cluster B is blocked.

- [ ] **Step 4: Smoke test**

Run `pnpm dev`. Log in at `/admin/login`. Note the session cookie value. From a separate
terminal:

```bash
# Replace <COOKIE> with the actual sn_admin cookie value.
curl -sS -X POST http://localhost:4321/api/package-builder/invite \
  -H 'Content-Type: application/json' \
  -H 'Cookie: sn_admin=<COOKIE>' \
  -d '{"inquiryId": 1}' | jq .
```
Expected: HTTP 200, body `{ "ok": true, "url": "http://localhost:4321/build?invite=...", "token": "...", "expiresAt": null }`. Run the same curl again — the token in the response should be IDENTICAL (re-use of the active invite per Cluster B's `createOrGetActiveInvite`).

Confirm 401 when unauthenticated:
```bash
curl -sS -i -X POST http://localhost:4321/api/package-builder/invite \
  -H 'Content-Type: application/json' \
  -d '{"inquiryId": 1}' | head -5
```
Expected: `HTTP/1.1 401`.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/pages/api/package-builder/invite.ts
git commit -m "feat(api): POST /api/package-builder/invite admin invite endpoint

Mints (or re-uses) an invite token for an inquiry. Admin-gated
via isAuthed because this path is not under /api/admin/ and so
the global admin middleware does not cover it.

Response includes the full clickable URL built from the inbound
request's origin — production resolves to smile-nola.com, local
dev resolves to localhost:4321, no hard-coded hosts.

Re-clicking 'Copy invite link' returns the same active token
thanks to Cluster B's createOrGetActiveInvite, keeping admin
outboxes tidy and the audit trail predictable."
```

---

### Task D5: `GET /api/package-builder/invite/[token]` (prefill resolver)

Resolves a token to a prefill payload for the `/build` page's server-rendered hydration. Looks
up the invite, dereferences the linked inquiry, and returns name/email/phone/event data per
the inter-cluster contract. Public endpoint — no auth gate. Unknown tokens get 404, expired
tokens get 410.

**Files:**
- Create: `apps/site/src/pages/api/package-builder/invite/[token].ts`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p apps/site/src/pages/api/package-builder/invite
```

- [ ] **Step 2: Create the endpoint**

Create `apps/site/src/pages/api/package-builder/invite/[token].ts`:

```ts
/**
 * GET /api/package-builder/invite/<token>
 *
 * Public — resolves an invite token to a prefill payload for the /build page.
 * Returns 404 for unknown tokens and 410 for expired ones. Successful
 * responses match the "Invite prefill response" inter-cluster contract.
 *
 * The /build page calls this server-side during render so the hydrated React
 * island lands with prefilled identity on first paint (no client fetch flash).
 */

import type { APIRoute } from "astro";
import { getInvite } from "@/lib/builder/invites";
import { getInquiry, getDb } from "@/lib/db";

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const token = (params.token ?? "").trim();
  if (!token) {
    return jsonResponse(404, { ok: false, error: "invite_not_found" });
  }

  const db = getDb();
  const invite = getInvite(db, token);
  if (!invite) {
    return jsonResponse(404, { ok: false, error: "invite_not_found" });
  }

  // Expiry check — null means "never expires" (the v1 default per spec section 8.3).
  if (invite.expires_at) {
    const expMs = Date.parse(invite.expires_at.replace(" ", "T") + "Z");
    if (Number.isFinite(expMs) && expMs < Date.now()) {
      return jsonResponse(410, { ok: false, error: "invite_expired" });
    }
  }

  const inquiry = getInquiry(invite.inquiry_id);
  if (!inquiry) {
    // The invite points at a deleted inquiry. Per spec section 4.5 the public
    // page silently degrades to the cold flow; from the API's perspective we
    // also return 404 so the caller hits the same fallback path.
    return jsonResponse(404, { ok: false, error: "invite_not_found" });
  }

  return jsonResponse(200, {
    ok: true,
    inquiryId: inquiry.id,
    prefill: {
      firstName: inquiry.first_name,
      lastName:  inquiry.last_name,
      email:     inquiry.email,
      phone:     inquiry.phone,
      event: {
        date:       inquiry.event_date ?? null,
        type:       inquiry.event_type ?? null,
        venue:      inquiry.venue ?? null,
        guestCount: inquiry.guest_count ?? null,
      },
    },
  });
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```
Expected: `0 errors`.

- [ ] **Step 4: Smoke test**

Run `pnpm dev`. Use the token returned by Task D4's smoke test:

```bash
curl -sS -i http://localhost:4321/api/package-builder/invite/<TOKEN> | head -20
```
Expected: HTTP 200, JSON matches the contract — `ok: true`, an `inquiryId` matching the source
inquiry, and a `prefill` block with the inquiry's contact and event fields.

```bash
curl -sS -i http://localhost:4321/api/package-builder/invite/not-a-real-token | head -5
```
Expected: HTTP 404, body `{ "ok": false, "error": "invite_not_found" }`.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/pages/api/package-builder/invite/\[token\].ts
git commit -m "feat(api): GET /api/package-builder/invite/<token> prefill resolver

Public endpoint that hydrates the /build page's invite eyebrow on
first paint. Looks up the invite, dereferences the linked inquiry,
and returns the prefill payload per the inter-cluster contract.

Unknown tokens → 404 invite_not_found.
Expired tokens (expires_at < now) → 410 invite_expired.
Invite pointing at a deleted inquiry → 404 invite_not_found, so
the /build page falls back to the cold flow per spec section 4.5.

No auth gate — invite tokens are bearer credentials; possession of
the URL is the authorization."
```

---

### Task D6: Wire status-flip actions on `/admin/package-builder/[id]`

Cluster F's detail page (Task F2) ships the form markup for "Mark Invoice Sent" and "undo".
The POST handler that turns those form submissions into DB writes belongs in the same Astro
file but depends on Cluster B exports (`markInvoiceSent`, `revertToNew`), so it is wired here
in Cluster D after both Cluster B and Cluster F have landed.

The path lives under `/admin/*`, so the global admin middleware already gates it — no
additional `isAuthed` call is needed inside the handler. Successful actions return a 303 to
the same URL so the page re-renders with the new status; the browser back button does the
right thing.

**Files:**
- Modify: `apps/site/src/pages/admin/package-builder/[id].astro`

- [ ] **Step 1: Confirm the prerequisite state**

```bash
grep -n "Astro.request.method === \"POST\"\|markInvoiceSent\|revertToNew" \
  apps/site/src/pages/admin/package-builder/\[id\].astro
```

Possible outcomes:

- **A.** The grep already shows a POST handler that calls `markInvoiceSent(submission.id)` and
  `revertToNew(submission.id)` returning `Astro.redirect(..., 303)`. Cluster F2 already wired
  it. Skip to Step 4 (verification) — no edit needed in this task.
- **B.** The grep shows the imports and helpers but no POST handler branch. Continue with
  Step 2.
- **C.** Neither imports nor handler are present. Cluster F2 has not landed — stop here and
  finish Cluster F before this task.

- [ ] **Step 2: Add the imports (only if Step 1 outcome was B)**

In `apps/site/src/pages/admin/package-builder/[id].astro`, locate the existing import line for
submissions. Replace it (or augment it) so the import block reads:

```ts
import {
  getSubmission,
  markInvoiceSent,
  revertToNew,
} from "@/lib/builder/submissions";
```

- [ ] **Step 3: Insert the POST handler branch (only if Step 1 outcome was B)**

Immediately AFTER the `if (!submission) { return new Response("Submission not found", { status: 404 }); }`
block in the frontmatter, and BEFORE any JSON-decoding of the `selections_json` column, insert:

```ts
// ----- POST handler: status flip ------------------------------------------
// Auth: this route lives under /admin/* so the global middleware already
// requires a valid admin session cookie. No extra isAuthed() needed.
if (Astro.request.method === "POST") {
  const form = await Astro.request.formData();
  const action = String(form.get("action") ?? "");
  if (action === "mark_invoice_sent") {
    markInvoiceSent(submission.id);
    return Astro.redirect(`/admin/package-builder/${submission.id}`, 303);
  }
  if (action === "revert") {
    revertToNew(submission.id);
    return Astro.redirect(`/admin/package-builder/${submission.id}`, 303);
  }
  return new Response("Unknown action", { status: 400 });
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```
Expected: `0 errors`. If `markInvoiceSent` or `revertToNew` are not exported from
`@/lib/builder/submissions`, Cluster B is incomplete — stop and unblock it. Do not stub.

- [ ] **Step 5: Manual round-trip verification**

Run `pnpm dev`. With at least one submission in the DB (use Task D3's smoke-test row, or
submit a real builder body):

1. Visit `/admin/package-builder/<id>`.
2. Click **Mark Invoice Sent**. Page reloads (303). Confirm the status pill flips to
   `invoice sent` and the "Invoice sent Xm ago" + `undo` row appears.
3. Click **undo**. Page reloads. Confirm the pill returns to `new` and the gold "Mark Invoice
   Sent" button reappears.

Repeat with JavaScript disabled in DevTools — both clicks must still work because the form is a
plain `method="POST"` to the same route. Re-enable JS when done.

Stop the dev server.

- [ ] **Step 6: Commit (only if Step 1 outcome was B; otherwise no commit)**

```bash
git add apps/site/src/pages/admin/package-builder/\[id\].astro
git commit -m "feat(admin): wire status-flip actions on package-builder detail

Adds the Astro.request.method === 'POST' branch to the detail page
so 'Mark Invoice Sent' and 'undo' flow through to Cluster B's
markInvoiceSent and revertToNew helpers, then 303-redirect back
to the same URL.

The route lives under /admin/* and is gated by the existing
middleware — no additional isAuthed call is needed inside the
handler. Forms work without JavaScript (progressive enhancement)."
```

If Step 1 outcome was A (handler already shipped in Cluster F2), this task contributes no
commit — Cluster F2's commit already covers it. Document that in your Cluster D review notes.

---

### Cluster D — Review checkpoint

Stop here. Verify:

- `pnpm test` from `apps/site/` passes every suite, including the two new ones (`auth.test.ts`,
  `schema.test.ts`).
- `pnpm typecheck` from `apps/site/` reports `0 errors`.
- `git log --oneline -6` shows the Cluster D commits on `feature/package-builder` in order:
  `refactor(auth)`, `feat(schema)`, `feat(api): POST /api/package-builder`,
  `feat(api): POST /api/package-builder/invite`, `feat(api): GET /api/package-builder/invite/<token>`,
  and (conditionally) `feat(admin): wire status-flip actions` if Task D6 needed to commit.
- A live `pnpm dev` smoke shows all five HTTP paths working:
  - `POST /api/package-builder` accepts a well-formed body and returns 201 with an id.
  - The same path returns 400 `unknown_selection` on a fake addon id and 429 `rate_limited`
    after six rapid calls from the same IP.
  - `POST /api/package-builder/invite` returns 401 without a session cookie and 200 with the
    same token on repeated authenticated calls.
  - `GET /api/package-builder/invite/<token>` returns the prefill payload for a real token and
    404 for a fabricated one.
  - The admin detail page's **Mark Invoice Sent** / **undo** round-trip works both with and
    without JavaScript.
- Submissions written during the smoke have `source` correctly set: `cold-builder` when no
  invite token was sent, `invited-builder` when one was. Inspect with
  `sqlite3 data/leads.db "SELECT id, source, inquiry_id, invite_token FROM package_builder_submissions ORDER BY id DESC LIMIT 5;"`.

Next cluster (G) is verification — the manual test matrix from spec §13.1 that gates declaring
v1 done. No new code; runs the live application against the spec's acceptance criteria.

---

## Cluster G — Verification

This cluster contains no new feature work. It exists to satisfy the
`verification-before-completion` rule: the v1 build is not "done" until every scenario in spec
§13.1 has been executed against the real running app and the result documented.

The agent or human executing this cluster runs `pnpm dev` from `apps/site/`, opens the
listed routes in a real browser, and checks the boxes. If a scenario fails, file a bug task,
fix it on `feature/package-builder`, and re-run the affected scenarios before moving on.

### Task G1: Boot and smoke-check

**Files:** none (verification only).

- [ ] **Step 1: Clean install and full test pass**

```bash
cd /home/phoenix/code/smile-nola/apps/site
pnpm install
pnpm typecheck
pnpm test
```
Expected: `pnpm typecheck` shows `0 errors`. `pnpm test` shows all suites green
(`catalog.test.ts`, `compute.test.ts`, `submissions.test.ts`, `invites.test.ts`,
`email.test.ts`, plus the D1 generic rate limit test and D2 schema test).

- [ ] **Step 2: Start dev server**

```bash
pnpm dev
```
Expected: Astro reports `Local http://localhost:4321/`. No errors in the console.

- [ ] **Step 3: Hit `/build` cold**

In a browser: open `http://localhost:4321/build`. Verify the React island hydrates, the
headline reads "build your smile nola event experience" in Broadway lowercase, the five
collection chips render, the contact block at the bottom is visible (cold-visitor mode), no
console errors.

- [ ] **Step 4: Hit admin and create a test invite**

In an incognito window: log in at `http://localhost:4321/admin/login` with the configured
password. Navigate to `/admin/inquiries` and open any existing inquiry. Click "Copy package
builder link". Verify the toast appears and the clipboard contains a URL of the form
`http://localhost:4321/build?invite=<token>`.

- [ ] **Step 5: Open the invite link**

Paste the copied URL into a fresh tab. Verify the invite eyebrow appears at the top of the
builder reading "building for <FirstName> <LastName>" (the inquiry's name). The cold-visitor
contact block at the bottom is NOT rendered. Form fields prefilled per spec §4.2.

---

### Task G2: Run the spec §13.1 manual matrix

Each scenario below maps 1:1 to a spec §13.1 test. Check the box only after running it end-to-
end against the live dev server and confirming the expected outcome. Use the in-page DB
inspector at `/admin/package-builder` to verify persisted rows.

#### Scenarios

- [ ] **G2-01: Smile only, base + add-on.** Select Smile chip. Pick "The Memory Booth" radio.
  Check "Audio Guest Book". Fill event details, consultation = `none`, submit. Expected:
  success card; admin row exists with `fixed_subtotal_cents = 97000` (= $970.00),
  `source = 'cold-builder'` (or `invited-builder` if you used an invite link),
  `selections_json` round-trips correctly. Email arrives at `NOTIFY_EMAIL` (or console log if
  Resend not configured).

- [ ] **G2-02: Smile + Visionary only.** Toggle Smile + Visionary chips. Verify Aurora /
  Resonance / Digital Atelier sections are NOT rendered anywhere on the page.

- [ ] **G2-03: Aurora minimum boundary.** Select only Aurora. Add 1× ApeLabs Uplighting
  ($50). Verify the rail shows the coral Aurora-minimum warning. Add items until subtotal
  ≥ $2,000; verify warning disappears. Remove items back under $2,000; verify warning
  reappears.

- [ ] **G2-04: Aurora LED wall.** Select Aurora. Pick LED Video Wall Experience. Verify
  $3,000 added. Pick LED Wall Expansion qty 3. Verify $1,500 added (3 × $500). Attempt to
  set qty to 5 in the stepper. Verify the stepper caps at 4 (qtyMax enforcement).

- [ ] **G2-05: Resonance Ceremony Speaker only.** Select only Resonance. Pick Ceremony
  Speaker À La Carte. Verify NO planning-conversation warning in rail. Verify NO Aurora
  warning (Aurora isn't selected). Add 2× wireless mics. Verify still no warning. Submit.
  Verify $350 + 2 × $150 = $650 row in admin.

- [ ] **G2-06: Resonance full plan.** Select Resonance. Pick "Resonance Minimum Spend". Verify
  the planning-conversation warning appears in the rail.

- [ ] **G2-07: Cold submission, no email match.** Submit from a fresh email never seen in the
  `inquiries` table. Verify the new submission row has `inquiry_id = NULL`,
  `source = 'cold-builder'`, no "matched to inquiry" badge in admin.

- [ ] **G2-08: Cold submission, email matches existing inquiry.** Find an email present in
  the existing `inquiries` table (use the admin list). Open `/build` directly (no invite),
  fill the contact block with the same email, submit. Verify the new submission row has
  `inquiry_id` set to the matched inquiry, `source = 'cold-builder'` (NOT invited-builder),
  admin detail page shows "linked to inquiry #N" badge.

- [ ] **G2-09: Invited submission.** From an inquiry's detail page, copy invite link. Open in
  incognito. Submit the builder. Verify the row has `source = 'invited-builder'`,
  `inquiry_id` set, `invite_token` set, the `builder_invites` row for that token has
  `consumed_at` stamped.

- [ ] **G2-10: Reuse invite.** Open the same invite link in another incognito window. Submit
  with different selections. Expected per the design: prefill still works, second submission
  creates another row with the same `invite_token`. Invites are NOT single-use in v1.

- [ ] **G2-11: localStorage persistence.** On a cold visit, fill the form half-way (3
  collections selected, some addons, partial contact info). Refresh the page. Verify
  selections and contact fields restore. Verify the small "Welcome back. Your selections are
  saved." toast appears once and is dismissible.

- [ ] **G2-12: Mobile at iPhone SE width (375px).** Use browser devtools responsive mode set
  to 375 × 667. Verify: no horizontal scroll on any state of the form; the sticky desktop
  rail is replaced by a bottom bar showing "Starting · $X,XXX  ▾  Send Selections"; tapping
  the chevron expands a sheet showing the full breakdown; all CTAs reachable.

- [ ] **G2-13: Keyboard nav.** Reload `/build` fresh. Press Tab repeatedly. Verify focus
  order matches visual order (chips → packages → addons → event details → consultation →
  contact → send). Verify every chip toggles with Space; every radio cycles with Arrow keys;
  every checkbox toggles with Space; the quantity stepper increments/decrements with
  Arrow keys or +/- buttons; the submit button activates with Enter.

- [ ] **G2-14: Server-side tamper #1 — unknown addon id.** Use browser devtools
  Network → "Edit and replay" on a real submission. Change one of the `addons[i].addonId`
  values to `"nonexistent-addon"` and replay. Expected: 400 response with
  `{ ok: false, error: 'unknown_selection' }`. No row inserted (verify via admin list count
  unchanged).

- [ ] **G2-15: Server-side tamper #2 — qty over max.** Replay a submission setting LED Wall
  Expansion qty to 7. Expected: 400 response with `{ ok: false, error: 'qty_exceeds_max' }`.

- [ ] **G2-16: Server-side tamper #3 — client-supplied total ignored.** Submit normally, then
  capture the server response and the DB row. Verify `fixed_subtotal_cents` in the DB matches
  the server's recompute, NOT any value the client could have shipped. (The client's POST
  body has no `total` field at all per the API contract, but verifying the recompute
  invariant against a sample row is the spirit of the test.)

- [ ] **G2-17: Mark Invoice Sent.** Open a `new` submission in `/admin/package-builder/[id]`.
  Click "Mark Invoice Sent". Verify the status pill flips to `invoice_sent`, the button
  replaces with "Invoice sent <time> ago" plus an undo link, and the DB has
  `invoice_sent_at IS NOT NULL`. Click undo. Verify status returns to `new` and
  `invoice_sent_at` is cleared.

- [ ] **G2-18: Mark Invoice Sent works without JavaScript.** Disable JS in the browser
  devtools, refresh the detail page. Click "Mark Invoice Sent". Verify the same outcome via
  the standard form POST + 303 redirect pattern.

- [ ] **G2-19: Resend kill switch.** Stop the dev server. Unset `RESEND_API_KEY` in
  `apps/site/.env` (comment it out). Restart dev server. Submit a fresh builder submission.
  Expected: row persists; console log shows the fallback message; no 5xx error returned to
  the client; the success card still renders.

- [ ] **G2-20: Email render quality.** Re-enable Resend. Submit a complex submission (Smile
  Mirror Me + Aurora 12 uplighting + dance floor lighting). Open the email in Daniel's
  inbox. Verify: subject line includes name and total; body shows the gold-on-black brand
  card; every selected item appears with its price; subtotal in gold; custom-quoted items
  separated; warnings (if any) in coral; consultation preference visible; admin link works.

- [ ] **G2-21: 404 on bad invite token.** Visit `/build?invite=garbage-token-that-doesnt-exist`.
  Expected: page renders in cold-visitor mode (no eyebrow, contact block visible). The
  `GET /api/package-builder/invite/garbage` call from `build.astro` returns 404 silently;
  the user-facing page does not show an error.

- [ ] **G2-22: Admin link in nav.** Log in. Verify the admin nav includes a link to
  `/admin/package-builder` and clicking it lands on the list page.

- [ ] **G2-23: Empty state on list.** Delete all rows from `package_builder_submissions`
  (use `sqlite3 data/leads.db "DELETE FROM package_builder_submissions"`). Refresh
  `/admin/package-builder`. Verify the empty-state copy renders: "No package builder
  submissions yet. Send an invite link from an inquiry to get started."

---

### Task G3: Production preflight checks

Before merging `feature/package-builder` into `main` and deploying:

- [ ] **Step 1: Rotate the Resend API key.** The key `re_QEJyq3z3_HSf9A5hCz7L57ASVmwZeo4PQ`
  was pasted in a chat session and must be treated as compromised. In the Resend dashboard:
  delete that key, generate a new one, paste it into `apps/site/.env` (local) and the
  Coolify environment variables (production).

- [ ] **Step 2: Confirm production env vars.** In Coolify, verify these are set on the site
  service:
  - `ADMIN_PASSWORD` (existing)
  - `ADMIN_SESSION_SECRET` (existing — strong random, ≥ 32 chars)
  - `RESEND_API_KEY` (the rotated production key)
  - `RESEND_FROM=Smile NOLA <no-reply@mail.smile-nola.com>`
  - `NOTIFY_EMAIL=daniel.f.velez@gmail.com` (or wherever submission notifications should land)
  - `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` — these can be **cleared**; the
    Resend rewrite no longer reads them.

- [ ] **Step 3: Production typecheck and build.**

```bash
cd /home/phoenix/code/smile-nola/apps/site
pnpm typecheck
pnpm build
```
Expected: 0 typecheck errors. `pnpm build` produces a clean `dist/` with no errors or
warnings about missing chunks.

- [ ] **Step 4: Inspect the bundle.** Verify the React island is only shipped on `/build`:

```bash
ls dist/client/_astro/ | head
```
The React runtime + island chunks should be present. Confirm `index.astro` (homepage)
HTML does NOT reference them.

- [ ] **Step 5: Verify migrations are idempotent on a real DB copy.**

```bash
cp data/leads.db /tmp/leads-test.db
SMILE_NOLA_DB_DIR=/tmp pnpm dev &
sleep 5
sqlite3 /tmp/leads.db ".tables"
```
Expected: existing tables (`inquiries`, `leads`, `portfolio_items`, `testimonials`) untouched;
new tables (`package_builder_submissions`, `builder_invites`) present. Stop the dev server,
delete the temp DB.

- [ ] **Step 6: Final lint of the git history.**

```bash
git log main..feature/package-builder --oneline
```
Expected: a clean linear series of commits, each one self-contained, each compiling and
passing tests if checked out individually (except where the plan explicitly defers commits
within a cluster — e.g. Cluster E commits at E12 only). Squash or rebase if the history is
noisy before opening the PR.

- [ ] **Step 7: Open the PR.**

```bash
git push -u origin feature/package-builder
gh pr create --base main --title "feat: package builder v1" --body "$(cat <<'EOF'
## Summary

- Adds the qualify-stage Build Your Smile NOLA Event Experience configurator at `/build`.
- New admin surface at `/admin/package-builder` with two-state lifecycle (new → invoice_sent).
- Adds a "Copy package builder link" action to `/admin/inquiries/[id]`.
- Migrates the contact form's email transport from nodemailer to Resend
  (mail.smile-nola.com already verified on the Smile NOLA Resend account).
- Two new SQLite tables: `package_builder_submissions` and `builder_invites`. Existing
  `inquiries` and booth `leads` tables untouched.

## Spec

`docs/superpowers/specs/2026-05-11-package-builder-design.md`

## Plan

`docs/superpowers/plans/2026-05-11-package-builder.md`

## Verification

Manual matrix from spec §13.1 / plan Cluster G executed against local dev and a copy of
production data. All 23 scenarios pass. Resend key rotated. Coolify env updated. Bundle
inspected — React island is `/build`-only.
EOF
)"
```

Do NOT run `git push` or `gh pr create` until the user explicitly approves. The plan ends
here with the PR-creation gate.

---

### Cluster G — Review checkpoint

Stop here. Verify:

- All G2 scenarios checked off.
- All G3 production preflight steps complete.
- The Resend key has been rotated.
- The PR exists on GitHub awaiting review.

If any G2 scenario failed and was fixed, re-run the affected scenarios before the final PR.

---

## Plan complete

This plan covers Clusters A → G inclusive. Execution order: A, B, C, D, E, F, G in that
order (alphabetical), regardless of where each cluster physically sits in this file (the
clusters were written by parallel agents and the file order is A, contracts, E, F, C, B, D,
G — but every cluster is self-contained and references the locked "Inter-cluster contracts"
section).

### Quick task count

| Cluster | Tasks | Approximate effort |
|---------|-------|-------------------|
| A. Plumbing | A1–A5 (5 tasks) | half day |
| B. Persistence | B1–B3 (3 tasks) | half day |
| C. Email migration | C1–C4 (4 tasks) | half day |
| D. Server endpoints | D1–D6 (6 tasks) | 1 day |
| E. Builder UI | E1–E12 (12 tasks) | 2–3 days |
| F. Admin surfaces | F0–F4 (5 tasks) | half day |
| G. Verification | G1–G3 (3 tasks) | half day |

Total: ~38 tasks, estimated 5–7 days of focused work for a single executor. Parallelizable
across Clusters B / C / E / F once A and the contracts are locked.

