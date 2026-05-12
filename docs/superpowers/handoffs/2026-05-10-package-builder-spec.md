# Spec: "Build Your Smile NOLA Event Experience" Package Builder

**Date:** 2026-05-10
**Companion to:** `2026-05-10-marketing-site-kickoff.md`
**Status:** Approved spec, ready to plan and build after the marketing site shell exists

---

## Context

This is a **second feature** of the marketing site project. Build the marketing site shell first (home + collection pages + about + standard inquiry routes per the brand brief §8.1). The package builder is **the conversion engine** that sits on top of that shell.

Daniel has decided to **build this in-house** rather than buy Qwilr ($708/year). The configurator gives Smile NOLA a one-of-one tool that perfectly fits the brand, integrates with the existing booth data layer, and avoids ongoing SaaS lock-in. Estimated 4-5 weeks of focused work for full Phase 1+2+3 delivery; the first usable MVP can ship in ~1-2 weeks.

---

## Replaces: Qwilr (decided 2026-05-10)

Reasons we're not using Qwilr:
- $59-89/user/month ongoing cost
- Less brand control than building our own
- Doesn't integrate with the booth + marketing site data layer we're building
- Daniel wants to own this surface

This means we are building our own interactive proposal/configurator tool. It is NOT a full CRM (we stick with HoneyBook for ops + mobile) but it IS the experience layer between marketing site → signed proposal.

---

## Suggested URL

`smile-nola.com/build-your-experience` (or `/package-builder`)

Daniel's preference: `/build-your-experience` reads better in outreach emails. Use that unless he requests otherwise.

---

## Required reading before building

In this order:
1. `docs/superpowers/handoffs/2026-05-10-marketing-site-kickoff.md` — the marketing-site handoff (this spec presumes the site is being built)
2. `/home/phoenix/Downloads/Smile_NOLA_Website_and_Forms_Brand_Brief_for_OpenCode.md` — brand brief (canon)
3. `docs/superpowers/specs/2026-05-09-smile-nola-intake-form-design.md` — booth intake spec (the design patterns we already established for forms in this project)
4. **This file**

---

## Critical: brand decisions locked in 2026-05-10

These were resolved between Daniel and a previous agent **before** this builder is built. The fresh agent must honor:

### Color palette (the original from brand brief §6, plus three additions)

```css
:root {
  /* From brand brief — primary palette (already in apps/intake/app/globals.css) */
  --sn-black: #050505;          /* Obsidian Black — primary background */
  --sn-soft-black: #111111;     /* Soft Black — cards, overlays */
  --sn-gold: #D4AF37;           /* Rich Gold — primary accent */
  --sn-antique-gold: #B8860B;   /* Antique Gold — gradients, hovers */
  --sn-champagne: #F6E7C8;      /* Champagne — soft luxury highlight */
  --sn-ivory: #F8F4EA;          /* Ivory — light text on dark */
  --sn-amber: #FFB23F;          /* Warm Amber — glow, light */
  --sn-muted-stone: #B8B2A5;    /* Muted Stone — secondary text */

  /* ADDED 2026-05-10 — Daniel approved these from a refinement pass */
  --sn-deep-brown-black: #1A120A;  /* Deeper brown-black for certain panels */
  --sn-warm-taupe: #9C8A6A;        /* Editorial accent / warm neutral text */
  --sn-soft-coral: #D65A5A;        /* Warning / alert accent only */
}
```

Use the **original primary palette as canonical**. Use the three additions sparingly and intentionally:
- `--sn-deep-brown-black` only where the standard `--sn-soft-black` feels too flat (e.g., a feature panel that needs slightly more warmth)
- `--sn-warm-taupe` for body copy that needs to feel slightly editorial/muted but isn't a hard secondary like `--sn-muted-stone`
- `--sn-soft-coral` exclusively for warning states (the Aurora $2,000 minimum warning, etc.) — never decorative

### Typography (three fonts — Daniel reaffirmed)

Stay strict to brand brief §5:
- **Holimount** — signature/accent only (couple names in thank-you moments, rare luxury closing phrases). Never body.
- **Broadway** — Art Deco display headings. **Always write source text in lowercase** and apply `lowercase` CSS class. Broadway has only decorative caps; combining with `text-transform: uppercase` makes glyphs double-decorate badly. (Discovered during booth build.)
- **Poppins** — body, buttons, forms, labels, pricing, all functional text.

**NO Cormorant Garamond Italic.** A previous draft of this spec suggested adding it for editorial italic accents; Daniel decided against. Use *italic Poppins* where italic emphasis is needed.

### Storage decision

Single SQLite database at `data/leads.db` (already exists, holds the 48 booth captures in a `leads` table).

**Add new tables, do NOT merge into the existing `leads` table.** Daniel wants to track the funnel:

```
visitor lands on site
  → fills out contact form          → `contacts` table (new)
  → builds a package configuration  → `package_builder_submissions` table (new)
  → approves package                → `package_builder_submissions.approved_at` set
```

**Critical funnel requirement:** when a visitor fills out the contact form AND later the package builder, **the system must link them as the same person** (probably via email match — Daniel needs to see "this lead converted to a package builder submission"). Design the contacts/submissions relation explicitly.

Suggested schema sketch (the fresh agent should refine):

```sql
-- The existing booth table, untouched
CREATE TABLE leads (... existing ...);

-- New: a generic 'contact' that can be referenced by anything
CREATE TABLE contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  -- ... other lightweight contact fields ...
  first_seen_at TEXT NOT NULL,
  source TEXT NOT NULL,         -- 'marketing-inquiry' | 'package-builder' | 'expo-booth-migrated'
  UNIQUE (email)
);

CREATE TABLE package_builder_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  submitted_at TEXT NOT NULL,
  -- The full structured payload from the builder
  selections_json TEXT NOT NULL,
  fixed_subtotal_cents INTEGER NOT NULL,
  custom_quoted_items_json TEXT,
  warnings_json TEXT,
  event_date TEXT,
  event_type TEXT,
  venue TEXT,
  guest_count INTEGER,
  note TEXT,
  approved_at TEXT,             -- null until Daniel marks it accepted
  status TEXT NOT NULL DEFAULT 'submitted',
  source TEXT NOT NULL DEFAULT 'package-builder'
);
```

This lets the admin page show **per-contact history** including all package submissions, who approved when, conversion timestamps, etc.

---

## The full functional spec (from Daniel's authoring pass)

Daniel wrote a complete and detailed authoring pass on the package builder. **Treat the section below as the canonical product requirements.** Implement it faithfully. The corrections above this section (color, fonts, storage, repo location) override anywhere this section conflicts.

---

### Objective

Build a custom interactive **"Build Your Smile NOLA Event Experience"** form/package builder that lives on the Smile NOLA website. This replaces the idea of using Qwilr because the experience needs conditional logic, selectable collections, dynamic add-ons, and a clean submission workflow.

The form should allow a client to choose one or more Smile NOLA collections, select the relevant packages/add-ons only for those collections, see an estimated starting investment summary, and submit the selected package details to Smile NOLA. The submitted data should be structured so it can later be sent to any CRM, HoneyBook, email notification, database, or invoice workflow.

The experience should feel like a guided consultation, not a price sheet and not a rental catalog.

### Brand position

Smile NOLA is a cinematic event production company based in New Orleans.
Core thesis: **"we design experiences, not rentals."**
Smile NOLA provides photo experiences, cinematic videography, event websites and design, lighting, LED video walls, staging, and concert-grade sound.

### Brand rules

- Do not describe Smile NOLA as a booth rental company.
- Do not use the phrase "PHOTO/VIDEO BOOTH."
- Do not make the experience feel like an equipment rental catalog.
- Do not type the Smile NOLA brand name in place of logo assets where logo use is appropriate.
- Use the existing Smile NOLA logo assets from `apps/intake/public/logos/` (copy or symlink into the site's public dir).
- Daniel leads Visionary capture, but the editing team builds the final film. Do not say Daniel personally edits the films.

### Visual direction

Luxury, warm, cinematic, Art Deco-inspired, black-tie, approachable, and polished.
The client should feel guided, not overwhelmed.

### User experience

The first screen should be simple.

**Opening headline:**
"build your smile nola event experience" (Broadway, lowercase source)

**Subtitle:**
"Five collections. One polished evening. Designed, not rented."

**Intro copy:**
"Every event has a feeling. Our job is to help shape that feeling through the details guests remember — the photo moments, the film, the lighting, the sound, the digital touchpoints, and the atmosphere of the room.

Start by choosing the collections that fit your event. You can select one collection or combine several into one custom Smile NOLA experience. We'll review your selections, confirm the right scope, and turn them into a polished final proposal."

### Step 1 — collection selection

Allow the client to choose one or more collections.

1. The Smile Collection — Photo booth experiences
2. The Visionary Suite — Cinematic videography
3. The Digital Atelier — Event websites and design
4. The Aurora Collection — Lighting, LED video walls, staging, and atmosphere
5. The Resonance Series — Concert-grade sound

**Critical behavior:** only show the options for the collections the user selects. Do not show every package and add-on at once. Use accordions, cards, toggles, or step-based conditional sections. Avoid overwhelming the client.

The form should support:
- Collection toggle on/off
- Package selection within each selected collection
- Add-on selection within each selected collection
- Quantity fields where appropriate
- Dynamic investment summary
- Custom quoted items
- Minimum-spend warnings
- Contact/event details
- Final submission

### Contact / event fields

Light lead-capture approach, not a heavy quote-stage interrogation.

**Required:**
- First name
- Last name
- Email
- Phone

**Optional:**
- Event date
- Event type
- Venue/location
- Estimated guest count
- Short note: "Tell us about the moment you want to create."

### Final submit

Button: **"Send My Selections"**

Success message:
"Thank you, {firstName}. Daniel will review your selections and reach out personally within 24 hours."

### Submission goal

POST `/api/package-builder` with structured payload:

```json
{
  "client": { "firstName": "...", "lastName": "...", "email": "...", "phone": "..." },
  "event":  { "date": "...", "type": "...", "venue": "...", "guestCount": 0, "note": "..." },
  "selections": {
    "collections": [],
    "packages":    [],
    "addons":      []
  },
  "totals": {
    "fixedSubtotal": 0,
    "customQuotedItems": [],
    "warnings": []
  },
  "source": "package-builder"
}
```

Also generate a readable summary string for email/admin review.

### Data model

Create a structured config object for collections, packages, and add-ons so pricing can be edited later without rewriting component logic.

Suggested structure per collection:
- `id`
- `displayName`
- `shortDescription`
- `rules`
- `packages[]`
- `addons[]`
- `minimums`
- `customQuotedNotes`

---

## Collection data and pricing — canonical

### 1. THE SMILE COLLECTION

Photo booth experiences designed to feel like part of the event — polished, guest-friendly, and easy to layer into the overall design.

**Behavior:** if selected, require one base package.

**Base packages:**

| Package | Price | Type | Duration | Description |
|---|---|---|---|---|
| The Memory Booth | $695 | fixed | 3 hours | Refined 3-hour photo experience with custom overlay design, on-site attendant, guest sharing via text/email/QR/gallery, digital gallery. |
| The Mirror Me Experience | $895 | fixed | 3 hours | Premium 3-hour interactive mirror booth with branded prints, polished guest flow, custom overlay design, guest sharing, attendant support. |
| The Mirror Me Experience, All Night | $1,195 | fixed | full event | Mirror Me for the full event — ideal when you want the booth active throughout. |

**Add-ons (any Smile package):**

| Add-on | Price | Notes |
|---|---|---|
| Additional Service Time | $150/hour | quantity enabled |
| Audio Guest Book — Cherish the Beep | $275 | |
| Scrapbook Service + Album | $150 | |
| Hedge Wall Backdrop | $300 | inventory backdrop — stays with Smile NOLA |
| Bayou Fairy Tale Backdrop | $250 | inventory backdrop — stays with Smile NOLA |
| Basic Black or White Backdrop | $200 | inventory backdrop — stays with Smile NOLA |
| Custom Props / Signs — Pack of 5 | $100 | |
| Red Carpet & Stanchions | $150 | |
| Photo Booth Area Uplighting | $175 | |
| Custom 8x8 Vinyl Backdrop | $300 | **client keeps after event** |
| Custom 8x8 Tension-Fabric Backdrop | $450 | **client keeps after event** |

**Do NOT include:** Guest 4x6 single photo print option.

### 2. THE VISIONARY SUITE

Cinematic videography for weddings and events that deserve to be remembered with emotion, movement, and intention.

**Behavior:** if selected, allow one package.

**Packages:**

#### Visionary Highlight Film — $1,500 (fixed)

A budget-friendly cinematic wedding/event film option for clients who want the feeling of the day captured beautifully without stepping into full luxury multi-videographer production territory.

Includes:
- Founder-led wedding/event day capture
- Single videographer coverage
- Gimbal-stabilized camera movement
- Ceremony and toast audio capture when practical/scoped
- Cinematic highlight film
- Teaser video
- Color-graded delivery
- Online delivery link

#### Visionary Signature Film — $2,500 (fixed)

Stronger cinematic coverage for weddings and events that need more angles, more guest reactions, and a more complete emotional story while still staying below full luxury multi-day production pricing.

Includes:
- Everything in Visionary Highlight Film
- Second shooter
- Expanded ceremony/reception coverage
- More guest, detail, and reaction coverage
- Stronger multi-angle storytelling
- Cinematic highlight film
- Teaser video
- Color-graded delivery
- Online delivery link

**Add-ons:**

| Add-on | Price | Notes |
|---|---|---|
| Rehearsal Dinner Coverage | $500 | |
| Travel Fee | custom | per travel rules |

**Important note:** Daniel leads the capture. The Smile NOLA editing team builds the final film. The Visionary Suite is designed as a more accessible cinematic option. Larger multi-day luxury productions may be referred to Smile NOLA's mentors at Legend + Luxe Films.

### 3. THE DIGITAL ATELIER

Event websites, RSVP systems, branding, and guest-facing digital design.

**Behavior:** if selected, allow one or more services.

**Services:**

#### Event Logo & Brand Design — $500 (fixed)

Custom event logo, monogram, or visual mark for weddings, celebrations, private events, and branded experiences.

Includes: custom event logo/monogram/mark, basic event color direction, font/style direction, digital logo files for event use, designed for invitations/signage/websites/printed details.

#### Event Website & RSVP — $1,500 (fixed)

Polished event website + RSVP experience.

Includes: custom event website, mobile-friendly design, event details page, RSVP or guest information form, schedule/location/hotel/registry sections as needed, launch support.

#### Premium Event Website & Guest Experience — $2,500 (fixed)

More complete digital guest experience with expanded design, guest information collection, and stronger event branding integration.

Includes: everything in Event Website & RSVP, plus expanded page/section structure, more refined visual design, custom integration setup, guest information collection, custom event branding integration, post-launch support window.

**Add-ons:**

| Add-on | Price | Notes |
|---|---|---|
| Additional website page / section | $250 | quantity enabled |
| Custom Integration Setup | $350 | |
| Custom domain setup | $150 | |
| Digital invitation design | $350 | |
| Printed invitation design file | $350 | |
| Menu design | $150 | |
| Program design | $250 | |
| Seating chart design | $250 | |
| Welcome sign design | $150 | |
| Bar / signature drink sign design | $125 | |
| Rush launch | $500 | |
| Post-event gallery page | $350 | |
| Additional design revision round | $150 | quantity enabled |

### 4. THE AURORA COLLECTION

Lighting, LED video walls, staging, and luminous atmosphere.

**Behavior:** if selected, show Aurora rules clearly. Allow lighting, LED wall, staging, and visual elements. Some fixed, some quantity, some custom quoted.

#### Critical rule — Aurora $2,000 project minimum

Aurora lighting and visual production requires a **$2,000 total Smile NOLA project minimum**. May be met through Aurora alone or combined with other Smile NOLA collections. If Aurora is added to another collection, the total selected Smile NOLA package must still reach $2,000 before Aurora lighting is deployed.

If Aurora is selected AND total estimated investment < $2,000, show warning:
> "Aurora requires a $2,000 total Smile NOLA project minimum before lighting or visual production is deployed."

#### Venue walkthrough

Included locally for Aurora productions inside the standard local service area. Walkthroughs outside the 30-mile local bubble may require mileage or travel fees.

#### LED wall options

| Option | Price | Type | Notes |
|---|---|---|---|
| LED Video Wall Experience | $3,000 | fixed | Up to 10 LED panels. Each panel 500mm × 1000mm. Final wall shape based on venue. |
| LED Wall Expansion | $500 / panel | quantity, max 4 | Expand beyond 10 panels. May require expanded trussing/support. |
| Full LED Wall Experience | $5,000 | fixed | Full 14-panel config with expanded support/trussing. Max system size: 14 panels. |

#### Lighting & visual

| Item | Price | Type | Notes |
|---|---|---|---|
| ApeLabs Wireless Uplighting | $50/fixture | quantity | Wireless uplighting for room/architecture. |
| ApeLabs Pin Spot Lighting | $75/fixture | quantity | Highlights cakes/florals/sweetheart tables/centerpieces/signage. |
| ApeLabs Neon Pix | $50/fixture | quantity | Wireless pixel lighting for accents/texture/atmosphere. |
| Interactive Monogram Projection | starts at $500 | starting/custom | Laser projection monogram. Advanced animation/multi-surface/interactive effects quoted separately. |
| Dance Floor Lighting Package | $750 | fixed | Focused dance floor lighting. Haze/lasers/moving-head upgrades quoted separately. |
| Hazers | $250 each | quantity | Subject to venue approval, fire alarm restrictions, local rules. |
| Lasers | starting at $750 | starting/custom | Final pricing depends on venue/safety/programming/operator. |
| Moving Heads | $150/fixture | quantity | Intelligent moving lights. |
| Moving Heads Package — 4 Fixtures | $500 | fixed | |
| Moving Heads Package — 8 Fixtures | $900 | fixed | |

#### Staging

| Item | Price | Type | Notes |
|---|---|---|---|
| Staging — 4x8 Section | $125/section | quantity | Final pricing may vary based on size/height/delivery/setup/stairs/skirting/outdoor leveling/safety. |
| Stage Steps | $75 | fixed/quantity optional | Recommended/required when stage height calls for access. |
| Stage Skirting | $2 / linear foot | quantity | Finishes the stage edge. |

#### Content & production add-ons

| Add-on | Price | Notes |
|---|---|---|
| Custom Visual Loop | $500 | |
| Slideshow Build | $350 | |
| Logo Loop / Branded Motion Background | $350 | |
| Extra Operator Hour | $125/hour | quantity enabled |
| Additional Load-In / Early Setup | $250 | |
| Outdoor / Covered Setup Complexity | custom quoted | |
| Power Distribution Support | custom quoted | |

### 5. THE RESONANCE SERIES

Concert-grade sound for celebrations.

**Behavior:** keep simple and consultative.

#### Client-facing rule

Outside of the Ceremony Speaker À La Carte exception, **Resonance requires a $2,000 minimum spend**.

Because sound is shaped by the room, guest count, event flow, speaker placement, power, ceremony/reception layout, DJ or band needs, and whether multiple areas need coverage, every Resonance proposal begins with a planning conversation. We'll confirm the right system, staffing, and final scope after we understand the experience being created.

#### Options

| Option | Price | Type | Notes |
|---|---|---|---|
| Resonance Minimum Spend | $2,000 | fixed/minimum | Concert-grade sound production starts at $2,000, requires planning conversation. |
| Ceremony Speaker À La Carte | $350 | fixed | Simple ceremony speaker setup. **The only Resonance item available below the $2,000 minimum.** |
| Optional wireless microphone | $150/mic | quantity | Add-on to Ceremony Speaker. |

**Do not show a long public menu of Resonance add-ons.** Keep Resonance simple and consultative.

---

## Travel

Show travel near the end of the flow, not as a major early section.

**Travel Fee:** Travel within 30 miles of New Orleans is included. Events beyond that range are billed at **$1.25 per mile round trip after the first 30 miles**, with a **$150 minimum travel fee**. Events more than two hours from New Orleans, destination events, or events requiring overnight lodging are quoted custom.

---

## Dynamic investment summary

Sticky or end-of-flow summary that updates as the client selects options.

Shows:
- Selected collections
- Selected base packages
- Selected add-ons
- Quantities
- Starting investment total
- Custom quoted items (do NOT include in numeric total unless they have a fixed starting price)
- Travel note
- Any minimum-spend warning

For custom quoted items, show "custom quoted" or "starting at" beside the item.

**Conditional warnings:**

- If Aurora is selected and total < $2,000:
  > "Aurora lighting and visual production requires a $2,000 total Smile NOLA project minimum."

- If Resonance is selected:
  > "Resonance requires a planning conversation before final scope is confirmed."

- If Ceremony Speaker À La Carte is the ONLY Resonance item selected, do NOT trigger the $2,000 Resonance minimum warning.

---

## Testing requirements

- Client can select only Smile Collection and submit.
- Client can select Smile + Visionary and see only those options (no Aurora/Resonance/Digital sections rendered).
- Client can select Aurora and receive minimum warning if subtotal < $2,000.
- Client can select Aurora LED wall and see correct totals.
- Client can select LED wall expansion with a max of 4 additional panels.
- Client can select Resonance Ceremony Speaker only without triggering the $2,000 Resonance minimum.
- Client can select Resonance Minimum and see planning note.
- Quantity add-ons calculate correctly.
- Custom quoted items appear in the summary but do not break subtotal calculation.
- Form validates required contact fields.
- Submission sends/saves correctly.

**Additional edge cases the fresh agent should test:**

- Toggle Aurora → add items beyond $2k → remove items dropping under $2k → warning re-appears.
- Select only Resonance Ceremony Speaker → add wireless mic → toggle to full Resonance plan → state transitions cleanly.
- Browser back button / refresh mid-flow — does state persist? (Decision: should it? Probably yes via localStorage so couples can come back.)
- Keyboard navigation — every toggle, checkbox, and input is reachable and operable via keyboard.
- Screen reader — every checkbox has a real `<label>`; collection sections use proper ARIA `region`/`group` semantics.
- Mobile portrait at iPhone SE width (375px) — fits, no horizontal scroll, all CTAs reachable.
- Email already exists in `contacts` table → submission links to existing contact, doesn't create a duplicate.

---

## Implementation suggestions

These are recommendations, not commands. The fresh agent should use best judgment.

### Architecture

- **Astro page at** `apps/site/src/pages/build-your-experience.astro` (or `package-builder.astro`)
- The interactive builder itself is a **React island** (Astro `client:load`) because of the heavy form state + dynamic recalculation
- API endpoint at `apps/site/src/pages/api/package-builder.ts` (Astro endpoint) — POST handler validates with Zod, writes to SQLite
- Reuse the Zod-as-source-of-truth pattern from `apps/intake/lib/schema.ts`

### Reuse from booth project

These are already battle-tested in `apps/intake/`:
- Brand color tokens → copy `:root` block from `apps/intake/app/globals.css` plus add the three new tokens from this doc
- Font face declarations → copy from same file
- Font files → at `apps/intake/public/fonts/` (copy to `apps/site/public/fonts/`)
- Logo SVGs → at `apps/intake/public/logos/` (copy to `apps/site/public/logos/`)
- `DecoCorner.tsx`, `GoldDivider.tsx`, `LogoMark.tsx` → port to the React-island portion of the package builder
- Motion presets (`apps/intake/lib/motion.ts`) — useful reference even if you write lighter motion for the marketing site
- Field components from `apps/intake/components/form/fields/` — `TextField`, `Textarea`, `ChipSelector` — directly reusable inside the React island

### State management

- React Hook Form for contact/event fields (same as booth)
- Local React state (or Zustand if it grows) for the dynamic builder state — selections, quantities, computed totals
- Persist builder state to `localStorage` keyed by something stable (e.g., a session UUID) so couples can return mid-flow

### Pricing config

Single source of truth: `apps/site/src/lib/collections.ts`. Define the full structure as a typed config so the React island and any server-side computation can both read it. Pricing changes = edit one file.

```ts
export const COLLECTIONS: CollectionConfig[] = [
  {
    id: 'smile',
    displayName: 'The Smile Collection',
    shortDescription: '...',
    rules: { requireOneBasePackage: true },
    packages: [
      { id: 'memory-booth', name: 'The Memory Booth', priceCents: 69500, type: 'fixed', duration: '3 hours', description: '...' },
      // ...
    ],
    addons: [ /* ... */ ],
    minimums: undefined,
    customQuotedNotes: undefined,
  },
  // ...
];
```

### Server-side validation

The API endpoint MUST re-validate everything client-side computed:
- Recompute the subtotal server-side from the submitted selections + the canonical config (don't trust client-supplied totals)
- Re-evaluate warnings server-side
- Reject any selection ID that doesn't match the canonical config (defense against tampering)

This matters because the submitted total drives Daniel's decision-making.

### Funnel linkage

When a submission arrives:
1. Look up `contacts.email` — if it exists, link `package_builder_submissions.contact_id` to that row
2. If not, create a new `contacts` row, then link
3. Update `contacts.last_seen_at` and any newer contact info (phone, name) from this submission

### Admin view (likely a follow-up phase)

- New admin route at `apps/site/src/pages/admin/submissions.astro` (gated, perhaps via env-var passcode like we discussed for the booth)
- Shows package builder submissions with contact info, total, status, link to view full payload
- "Mark approved" button updates `approved_at` timestamp

### Notifications

When a submission arrives:
- Email Daniel (Resend or Postmark — free tier covers this) at his Smile NOLA email with the readable summary
- Optionally Slack webhook if Daniel uses one

Defer this if scope is tight today — admin page refresh is acceptable for v1.

---

## Voice & copy rules (from brand brief §3)

| Use | Avoid | Why |
|---|---|---|
| experience, atmosphere, cinematic, polished, elevated, intentional | cheap, basic, rental, add-on, package dump, party props | The brand sells confidence/atmosphere/memory-making, not commodity equipment. |
| inquire, reserve, design the moment, build the experience | submit, book now only, order, checkout | Luxury service should feel consultative before transactional. |
| collection, suite, series, atelier, experience | category, item, SKU, product only | Naming makes each service feel curated and premium. |

"Send My Selections" is on-brand and is the approved submit copy. Don't change it without Daniel's say-so.

---

## Realistic phasing (5-week sketch)

**Phase 1 — MVP (Week 1-2):**
- Pricing config (`COLLECTIONS` typed object)
- React island with collection toggles, conditional package/add-on sections, quantity fields, dynamic summary
- Contact/event form fields with validation
- POST endpoint that writes to SQLite (new tables) and links to contacts table
- localStorage persistence
- Mobile-responsive
- Real submissions visible in a basic admin table

**Phase 2 — Polish + production (Week 3):**
- Motion polish (Framer Motion entrances, smooth conditional reveals)
- Server-side recompute + tamper protection
- Admin page with proper styling, sort/filter, approve flow
- Email notification to Daniel on each submission
- Real-device testing on iPhone + Android + iPad

**Phase 3 — Conversion enhancements (Week 4-5):**
- E-signature integration (DocuSeal, self-hosted, free) on the "approve" flow
- Stripe payment intent for deposit collection on approval
- HoneyBook sync (push approved deals as projects via Zapier or direct API)
- PDF export of the final proposal for client records

---

## Daniel's working style (reminder)

- Direct technical opinions over agreement-seeking
- Brainstorming-first for any creative work (per superpowers rules)
- Plan-mode-first when scope is real
- Verification before claiming "done" (the booth's CSV format was a post-event find — we don't want to repeat that)
- Honor existing brand decisions; don't re-litigate without explicit override
- He'll appreciate honest critique of his own specs (this doc represents one — multiple gaps and conflicts in his initial prompt were resolved before this canonical version was written)

Welcome to the project. Build something Smile NOLA's clients will brag about scrolling through.
