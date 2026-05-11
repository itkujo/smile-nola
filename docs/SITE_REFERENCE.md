# Smile NOLA — Site Reference

## What this document is

A complete reference of the marketing site at smile-nola.com — the live
architecture, every page's written content, all form copy, admin microcopy, and
the brand voice rules that govern it. Intended for briefing a branding AI or
onboarding new contributors. Every brand string in this document is copied
verbatim from the source files (Astro pages, components, content modules);
nothing is paraphrased.

- Last updated: 2026-05-11
- Live URL: https://smile-nola.com
- Repo: https://github.com/itkujo/smile-nola

The repo also contains the booth intake at `apps/intake/`, a separate Next.js
app used for in-person event capture at expos. It shares the SQLite database
with the marketing site but is **not** covered in detail here — this document
is exclusively about the public-facing marketing site at `apps/site/`.

## 1. Executive summary

The marketing site is an Astro 5 SSR application that renders five canonical
service "collections" (Smile photo booth, Visionary videography, Digital
Atelier web + design, Aurora lighting + video walls, Resonance concert-grade
sound), a public portfolio of video and photo work with multi-provider embeds
(YouTube, Vimeo, PicTime), manual thumbnail uploads, per-item gallery deep
links, and photo-only items for booth-only events. The contact surface is a
progressive-disclosure deep inquiry form on `/contact` plus lightweight
collection-scoped inquiry forms embedded on every `/collections/{slug}` page.
A password-gated admin CMS at `/admin/*` manages inquiries, portfolio items,
and testimonials. The whole thing is deployed on Coolify with Traefik
reverse-proxying TLS termination via Let's Encrypt.

**What's live (every visitor-facing route):**

- `/` — homepage with rotating hero, brand promise, five-collection stack,
  optional testimonials section, closing CTA.
- `/collections` — overview page with intro hero and the same five-collection
  stack.
- `/collections/smile` — Smile (photo booth) detail page.
- `/collections/visionary` — Visionary (videography) detail page.
- `/collections/digital-atelier` — Digital Atelier (web + design) detail page.
- `/collections/aurora` — Aurora (lighting + video walls) detail page.
- `/collections/resonance` — Resonance (concert-grade sound) detail page.
- `/portfolio` — public grid of video and photo portfolio items with
  per-collection filter chips and a modal video player.
- `/about` — Daniel Velez founder story, lineage block, the Smile NOLA
  Standard (five-step process), closing signature.
- `/contact` — deep inquiry form with collection chips, per-collection
  deep-dive blocks, and an optional disclosure for quote-stage detail.
- `/404` — branded not-found page (served for any unmatched route in SSR).
- `/admin/login` — single-password gate.
- `/admin` — dashboard.
- `/admin/inquiries` — sortable, filterable, searchable, CSV-exportable
  inquiry index.
- `/admin/inquiries/{id}` — inquiry detail with editable status and notes.
- `/admin/portfolio` — portfolio CRUD form + list.
- `/admin/testimonials` — testimonials CRUD form + list.

**What's NOT covered:** the booth intake at `apps/intake/` (separate Next.js
app for in-person expo capture); the legacy WordPress retirement on the old
Plesk server (pre-existing site, deprecated by this build).

## 2. Brand voice — hard rules

### Typography rules

Defined in `apps/site/src/styles/globals.css`:1-83.

- **Holimount (script)** — `--font-signature`. The signature accent. Used
  only for true signature moments: couple names on proposals, thank-yous, the
  founder's name closer on `/about`. Never body, never buttons, never headings.
  On the live site today, the only place it renders is the "Daniel Velez"
  signature at the bottom of `/about` (via the `.font-signature` utility).
- **Broadway (deco display)** — `--font-deco`. Applied through the
  `.font-deco` class. That class enforces `text-transform: lowercase`
  and `letter-spacing: 0.04em`. **Never apply `text-transform: uppercase` to
  Broadway** — its only caps are decorative, so uppercasing double-decorates
  and produces unreadable glyph soup. Always author the source text in
  lowercase and let `.font-deco` handle styling.
- **Cormorant Garamond italic** — `--font-italic-serif`. Editorial accent
  paired with Broadway in display headlines. Most visible use: the word
  "your" in the homepage hero, the closing CTA, and `/about`. Also styles
  "experiences," "one," "moment," "guests," "films," "event," "new orleans,"
  and the "starts at" anchor labels.
- **Poppins** — `--font-body`. All body, UI, buttons, form fields, labels,
  eyebrows, microcopy. Default for the whole document.

### Words and phrases to NEVER use

- **"PHOTO/VIDEO BOOTH"** as a subtitle anywhere. Smile NOLA is a production
  company, not a booth rental. Commit 36b2367 explicitly removed this
  subtitle from the Aurora image. Booth offerings are Smile Collection
  packages; the booth is a designed experience, not rented hardware.
- **Never type the brand name as text.** Use the SVG logo files in
  `apps/site/public/logos/`:
  - `full-logo.svg`
  - `full-logo-gold.svg`
  - `icon.svg`
  - `wordmark.svg`
- **Never claim Daniel personally edits the films.** The settled wording is
  captured in the Visionary collection's honesty block: "our editing team
  builds the final film." Daniel shoots; the team edits.

### Tonal patterns

- Direct, candid, honest. Pushback over agreement-seeking. The site does not
  hedge or sell.
- Operating thesis, found on the homepage brand-promise band, copied verbatim
  from `apps/site/src/pages/index.astro:94`:

  > we design experiences, not rentals.

- Founder framing, copied verbatim from `apps/site/src/pages/about.astro:84-88`:

  > Daniel founded Smile NOLA on a simple conviction: New Orleans clients
  > deserve a production company, not a rental catalog. The difference shows
  > up everywhere — in how the room sounds, how the light falls, how the
  > camera moves, how the inquiry is answered.

- Higher-budget productions are referred to Legend + Luxe Films (Ed Masters
  lineage). The Visionary collection's `honestyBlock.bodyHtml` says it
  explicitly — see section 3.
- Service decisions trigger from what the event needs, not what's in the
  category. The Smile NOLA Standard step 3 reads:

  > site visits, when they matter.
  >
  > First time at the venue, complex rig, unusual power, tight sightlines —
  > we walk it end to end. Repeat venues, simple setups, or events where
  > there's nothing to map — we save you the meeting and plan from your event
  > docs. Either way, no surprises on the day.

  (Verbatim from `apps/site/src/pages/about.astro:165-174`.)
- Forms emphasize lead-capture, not pre-quote interrogation. The deep
  inquiry form's default intro reads (verbatim from
  `apps/site/src/components/forms/InquiryFormDeep.astro:41`):

  > Just the basics to start the conversation. We'll reply within 24 hours
  > and gather everything we need for a real quote on the call.

- Booth-only buyers (the $695 Memory tier) are made to feel they belong:
  - The Smile collection page renders the explicit tier widget at
    $695 / $895 / $1,195 so a single-booth buyer sees real pricing rather
    than "starts at $1,500" framing they'd bounce off.
  - Clicking a Reserve CTA injects `?package=<slug>` into the URL; the
    inquiry form picks that up and adds a hidden `selected_package` field
    so the admin sees which tier triggered the inquiry.
  - The thank-you greets by first name and event date (rendered in
    Broadway-lowercase via `.font-deco`).
  - The `BUDGET_RANGES` array on `/contact` is anchored at "Under $1,000"
    so a real booth buyer doesn't feel out of place.

## 3. The five collections (canonical reference)

Source of truth: `apps/site/src/content/collections.ts`. Every public surface
that mentions a collection (homepage cards, /collections overview, each
`/collections/{slug}` page, the deep-form chips, the footer Discover column,
the admin portfolio/inquiry filters) reads from this single file.

Display order on every public surface (locked by the ordering rule in
`collections.ts:8-26`):

1. Smile (photo booth) — most-pushed
2. Visionary (videography) — second-pushed
3. Digital Atelier (web + design) — early in the customer journey
4. Aurora (lighting + video walls) — atmosphere
5. Resonance (concert-grade sound) — finishing layer

The slugs match the booth intake's collection IDs at
`apps/intake/lib/schema.ts` so inquiry data is portable across both apps.

### Smile (smile)

- **Slug:** `smile`
- **Display name:** The Smile Collection
- **Short name:** Smile
- **Tagline:** photo booth experiences · mirror booth · memory booth
- **CTA:** Start Your Smile Inquiry
- **Hero image:** `/images/collections/smile-landscape.png`
- **Portrait image:** `/images/collections/smile-portrait.png`
- **Starts at:** $695

**Philosophy (homepage card body):**

> The standout moment of your event — whether it's the Mirror Me activation
> as part of a larger production, or the single photo booth your guests can't
> stop talking about. Every booking includes custom overlay design and a live
> attendant. Nothing rented; everything produced.

**Philosophy long (collection page):**

> Photo experiences that don't feel like a county fair. The Smile Collection
> brings the Mirror Me Booth and the Memory Booth — premium, branded
> photo activations that look like part of your décor, not an afterthought
> rolled in on a luggage cart.
>
> Whether you're booking the photo booth as part of a full Smile NOLA
> production or as the single signature activation for the night, every Smile
> booking is designed end to end: custom overlay templates, brand-matched
> prints, guest sharing via text, email, QR, and a gallery your guests can
> keep returning to weeks after the night ends.

**What's included:**

- Mirror Me Booth (premium mirror-style touchscreen activation)
- Memory Booth (compact open-air social-first booth)
- Custom overlay template designed to match your event
- Unlimited prints + digital sharing (text, email, QR, gallery)
- On-site attendant for the full activation window

**Packages:**

1. `memory` — **The Memory** — from $695 · Memory Booth · 3 hours
   - Unlimited digital photos + prints
   - Custom overlay designed to match your event
   - On-site attendant for the activation window
   - Guest sharing via text, email, QR, and a digital gallery
2. `mirror` — **The Mirror** — from $895 · Mirror Me Booth · 3 hours
   - Premium mirror-style touchscreen activation
   - Everything in The Memory
   - Branded prints with your custom overlay
   - Animated touchscreen interactions
3. `mirror-all-night` — **The Mirror, All Night** — from $1,195 · Mirror Me Booth · full event
   - Mirror Me Booth running the full event
   - Everything in The Mirror
   - Extended attendant coverage
   - Designed to be the activation guests return to all night

**Honesty block:** none.

**Per-collection inquiry questions** (rendered inside the deep form's
service-specific section when the Smile chip is checked):

- `booth_preference` (Booth preference) — select: Mirror Me Booth · Memory Booth · Not sure — open to recommendation
- `backdrop_placement` (Desired backdrop or booth placement) — textarea
- `prints_needed` (Prints needed?) — select: Yes — unlimited · Yes — limited · Digital only
- `needs_custom_overlay` (Custom overlay / template needed?) — select: Yes · No · Not sure
- `guest_sharing` (Guest sharing needs) — textarea, placeholder "Text, email, QR, gallery, all of the above…"
- `setting` (Indoor or outdoor & power access) — textarea
- `activation_hours` (Preferred activation hours) — text, placeholder "e.g. 7pm-11pm during reception"

### Visionary (visionary)

- **Slug:** `visionary`
- **Display name:** The Visionary Suite
- **Short name:** Visionary
- **Tagline:** cinematic videography · storytelling · memory
- **CTA:** Start Your Visionary Inquiry
- **Hero image:** `/images/collections/visionary-landscape.png`
- **Portrait image:** `/images/collections/visionary-portrait.png`
- **Starts at:** $1,500

**Philosophy:**

> Cinematic storytelling for weddings and events that deserve to be
> remembered with emotion, movement, and intention.

**Philosophy long:**

> Photos catch the moment. Film catches the feeling. The Visionary Suite is
> for couples and clients who want their day told back to them with the
> pacing and emotional weight it actually had.
>
> We shoot with gimbal-stabilized cinema cameras, capture sync sound from
> ceremony and toasts, and edit with a narrative arc — not just a highlight
> reel of pretty shots, but a story that holds together end to end.

**What's included:**

- Multi-camera coverage (1-3 operators, scoped to your day)
- Cinema-grade gimbal + lens kit
- Sync sound for ceremony, toasts, first dance
- Highlight film (3-6 min) + optional full-feature edit
- Color graded and delivered in 4K

**Packages:** none. Visionary deliberately has no tier widget — videography
benefits from a real consultative conversation rather than self-service tiers.
The honesty block does the framing instead.

**Honesty block:**

- Headline: **Visionary starts at $1,500.**
- Body (verbatim HTML, two paragraphs):

  > Smile NOLA's videography is founder-led. Daniel shoots with cinema-grade
  > gimbals and Sony cameras; our editing team builds the final film with the
  > pacing and emotional weight every event deserves. Every project gets the
  > founder's attention end to end, at a price that reflects the personal
  > scale of the practice.
  >
  > For destination weddings, multi-day multi-camera productions, or the kind
  > of luxury cinematic film that calls for the largest team in the region,
  > we'll honestly recommend our mentors at [Legend + Luxe Films →](https://www.legendluxefilms.com/).
  > Otherwise — book us. We'll bring everything we have to your day.

  Important: the wording is "our editing team builds the final film" —
  Daniel does **not** personally edit films. The honesty block also names
  Legend + Luxe Films explicitly as the higher-budget referral path.

**Per-collection inquiry questions:**

- `coverage` (Coverage needed) — textarea, placeholder "Highlight film, ceremony, reception, full day, social clips…"
- `locations_count` (Number of locations on the day) — number
- `style_preference` (Preferred style) — select: Cinematic · Documentary · Social-first · Luxury editorial · Not sure yet
- `important_moments` (Important moments to capture) — textarea, placeholder "First look, vows, parents, special toasts, surprise moments…"
- `delivery_timeline` (Delivery timeline preference) — text, placeholder "e.g. teaser within 7 days, full film within 8 weeks"

### Digital Atelier (digital-atelier)

- **Slug:** `digital-atelier`
- **Display name:** The Digital Atelier
- **Short name:** Digital Atelier
- **Tagline:** event websites · branding · guest design
- **CTA:** Start Your Atelier Inquiry
- **Hero image:** `/images/collections/digital-atelier-landscape.png`
- **Portrait image:** `/images/collections/digital-atelier-portrait.png`
- **Starts at:** $500
- **Starts-at note:** Custom event websites + branded design.

**Philosophy:**

> Custom digital experiences, event websites, inquiry flows, and design
> touchpoints that make the guest journey feel seamless before the event
> even begins.

**Philosophy long:**

> The first thing your guests experience isn't the venue — it's the
> invitation, the RSVP, the wedding website, the map link they pull up at
> 11pm the night before. The Digital Atelier designs every one of those
> touchpoints with the same care you'd put into the day itself.
>
> We build event websites that match your aesthetic, RSVP systems that work,
> brand collateral for signage and print, and the small digital details that
> quietly elevate the whole experience.

**What's included:**

- Custom event website (single page or multi-page)
- RSVP and guest information collection
- Branded invitation suite and print collateral
- Logo and visual identity work
- Wedding-day signage, menu, and program design

**Packages:** none. No honesty block.

**Per-collection inquiry questions:**

- `project_type` (Project type) — textarea, placeholder "Event website, RSVP form, brand page, digital invitation, custom form, graphic design…"
- `launch_date` (Launch date needed) — text
- `required_pages` (Required pages or sections) — textarea
- `needs_rsvp` (Do you need RSVP / guest data collection?) — select: Yes · No · Not sure yet
- `brand_assets` (Brand assets available?) — select: Yes — full brand kit · Some logos and colors · Nothing yet — start from scratch
- `inspiration_links` (Inspiration links or notes) — textarea

### Aurora (aurora)

- **Slug:** `aurora`
- **Display name:** The Aurora Collection
- **Short name:** Aurora
- **Tagline:** lighting · video walls · luminous atmospheres
- **CTA:** Start Your Aurora Inquiry
- **Hero image:** `/images/collections/aurora-landscape.png`
- **Portrait image:** `/images/collections/aurora-portrait.png`
- **Starts at:** $2,000
- **Starts-at note:** Lighting design + LED video walls.

**Philosophy:**

> Immersive lighting and visual experiences designed to transform the room,
> frame the moment, and create a cinematic atmosphere your guests feel the
> second they arrive.

**Philosophy long:**

> Aurora is what people remember before the first toast. It's the wash of
> warm gold across the back wall, the seamless LED video wall behind the
> head table, the lighting cue that lifts the room at the perfect beat.
>
> Designed for couples and planners who think about the room the way a
> cinematographer thinks about a frame — every light placed with intent,
> every color in service of the story you're telling.

**What's included:**

- Programmable LED lighting design with on-site operator
- Seamless LED video wall (modular, indoor or covered outdoor)
- Uplighting, pin-spots, and architectural wash
- Custom content: slideshow, logo loop, video, live camera feed
- Pre-event lighting consult and venue walkthrough

**Packages:** none. No honesty block.

**Per-collection inquiry questions:**

- `video_wall_size` (Desired video wall size or visual goal) — textarea, placeholder "e.g. 16ft × 9ft behind the head table"
- `setting` (Indoor or outdoor setup) — select: Indoor · Outdoor — Covered · Outdoor — Uncovered · Not sure yet
- `content_source` (Content source(s)) — textarea, placeholder "Slideshow, logo loop, video playback, live camera feed, custom visuals…"
- `stage_or_backdrop` (Stage or backdrop use?) — text, placeholder "Behind a stage, ceremony backdrop, dance floor, etc."
- `load_in_time` (Available setup / load-in time) — text, placeholder "e.g. 4 hours before guests arrive"
- `power_notes` (Power availability (if known)) — text

### Resonance (resonance)

- **Slug:** `resonance`
- **Display name:** The Resonance Series
- **Short name:** Resonance
- **Tagline:** concert-grade sound · clarity · presence
- **CTA:** Start Your Resonance Inquiry
- **Hero image:** `/images/collections/resonance-landscape.png`
- **Portrait image:** `/images/collections/resonance-portrait.png`
- **Starts at:** $2,000
- **Starts-at note:** Concert-grade sound · includes an on-site sound engineer.

**Philosophy:**

> Concert-grade sound for celebrations that need more than volume. The
> Resonance Series is built for clarity, presence, and a polished audio
> experience from first toast to final song.

**Philosophy long:**

> Most events lose people at the toasts because no one can actually hear
> them. Resonance is built around that problem — designed so every word,
> every note, every moment lands the way it was meant to.
>
> Deployed with line-array PA, professional monitors, and an on-site engineer
> who tunes the room before doors. Whether it's a ceremony in a stone
> courtyard, a reception in a ballroom, or a live band closing the night, the
> system is sized and tuned for that exact space.

**What's included:**

- Line-array PA system sized to your venue
- On-site sound engineer for the full event
- Wireless microphones for ceremony, toasts, MC
- Stage monitors and front-of-house mix for live bands
- Pre-event audio consult with planner and venue

**Packages:** none. No honesty block.

**Per-collection inquiry questions:**

- `event_type_detail` (Event type) — select: Ceremony only · Reception only · Ceremony + reception · Live band · DJ · Corporate event · Speaking engagement · Other
- `performer_count` (Number of performers or speakers) — number
- `setting` (Indoor or outdoor) — select: Indoor · Outdoor — Covered · Outdoor — Uncovered · Mixed
- `audience_size` (Expected audience size) — number
- `needs_mics` (Need wireless microphones?) — select: Yes · No · Not sure
- `needs_engineer` (Want a sound engineer on-site?) — select: Yes — full event · Yes — partial · No
- `needs_monitors_foh` (Stage monitors or front-of-house system needed?) — textarea, placeholder "e.g. wedge monitors for the band, FOH for vocals…"

## 4. Pages — every visible string

### / — apps/site/src/pages/index.astro

**SEO meta:**

- Title: `Smile NOLA · cinematic event production`
- Description: `Smile NOLA designs cinematic event experiences — lighting, video walls, concert-grade sound, videography, and event web design — for celebrations in New Orleans.`

**Hero section:**

- Eyebrow: `cinematic event production · new orleans`
- Headline (Broadway lowercase + Cormorant italic on "your" + rotating noun):
  `let's design your <noun>` where `<noun>` cycles through the words below.
- Rotating words (HeroCycler component, `HERO_WORDS` constant): `moment`,
  `wedding`, `celebration`, `gala`, `milestone`, `reception`. (Each word
  appears in turn; the screen-reader fallback reads them all comma-separated.)
- Trailing punctuation: empty string (no period). Confirmed via the
  `trailing=""` prop passed to HeroCycler.
- Sub-body: `Lighting and video walls. Concert-grade sound. Cinematic videography. Event web design. Photo experiences. Five collections, engineered as one polished evening — designed, not rented.`
- Primary CTA: `Begin your inquiry` → `/contact`
- Secondary CTA: `Explore collections` → `/collections`
- Hero-bottom collection ticker: the five short names rendered with dot
  separators (`Smile · Visionary · Digital Atelier · Aurora · Resonance`).
- Scroll cue text: `scroll`.

**Brand promise band:**

- Eyebrow: `— the smile nola standard —`
- Headline (Broadway lowercase + Cormorant italic on "experiences,"):
  `we design experiences, not rentals.`
- Body: `Intentional. Cinematic. Premium — from the first inquiry to the final toast. Five collections, engineered as one polished evening, designed in New Orleans and delivered with the rigor of a production company, not the indifference of a rental catalog.`

**Five-collection stack header:**

- Eyebrow: `— the five collections —`
- Heading: `each collection is its own world.`
- Lede: `choose where to begin.`

Each card body (CollectionCard component, `apps/site/src/components/cards/CollectionCard.astro`)
draws the visible per-collection text from `collections.ts` — the short name,
the tagline, and the `philosophy` field. The static chrome around each card:

- Per-card eyebrow: `— collection 01 —` / `— collection 02 —` / ... padded
  by index (i.e. `String(index + 1).padStart(2, "0")`).
- Per-card heading: the collection's `shortName`.
- Per-card actions:
  - Primary: `explore the collection →` → `/collections/<slug>`
  - Secondary: `inquire →` → `/collections/<slug>#inquire`

**Testimonials section** (renders only when the testimonials table is
non-empty — no placeholders ever appear on the live site):

- Eyebrow: `— in their words —`
- Heading: `what clients say afterward.`
- Each card: a large lowercase Broadway quotation mark (`"`), the quote
  text from the testimonials table, and an attribution line preceded by
  an em-dash (`— {attribution}`).

**Closing CTA section:**

- Eyebrow: `— ready when you are —`
- Headline (rotating noun, same set as the hero but with slower 3200ms hold
  and a 400ms start delay): `let's design your <noun>`
- Body: `Share a few details about the moment you want to create. We'll be in touch within 24 hours with a consultative reply — not a generic quote.`
- CTA: `Begin your inquiry` → `/contact`

### /collections — apps/site/src/pages/collections/index.astro

**SEO meta:**

- Title: `Collections · Smile NOLA`
- Description: `Five collections, engineered as one polished evening: Smile photo booth, Visionary cinematic videography, Digital Atelier event web and design, Aurora lighting and video walls, and Resonance concert-grade sound.`

**Overview hero:**

- Eyebrow: `— the smile nola collections —`
- Title (Broadway lowercase + Cormorant italic on "one"):
  `five collections. one polished evening.`
- Body: `Smile NOLA designs cinematic event experiences end to end. Choose the collections that fit your day — or let us help you compose the full picture.`

Below the hero is the same five-collection stack as the homepage, in
canonical order.

### /collections/{slug} template — apps/site/src/pages/collections/[slug].astro

A single template handles all five collection pages. Every per-slug visible
string lives in `collections.ts` (see section 3); the static page chrome is
documented here.

**SEO meta:**

- Title: `${collection.displayName} · Smile NOLA`
- Description: `collection.philosophy` (the short paragraph)

**Page structure, in order:**

1. **Collection hero**
   - Eyebrow: `— the smile nola collections —`
   - Big Broadway title: `collection.shortName`
   - Display script line (Cormorant italic): the `displayName` with the
     leading "The " stripped and a period appended (e.g. "Smile Collection.").
   - Tagline: `collection.tagline`
   - Anchor line when `pricing.startsAt` is set: `starts at $<amount>`
     followed by the optional `startsAtNote` after a middle dot. Example
     for Smile: `starts at $695`. Example for Resonance: `starts at $2,000 · Concert-grade sound · includes an on-site sound engineer.`
   - Primary CTA: `Begin your inquiry` → `#inquire`
   - Secondary CTA: `What's included` → `#whats-included`
   - Side poster: the `portraitImage` rendered with `object-fit: contain`
     so the wordmark and collection name baked into the top stay visible.
2. **Philosophy section**
   - Eyebrow: `— philosophy —`
   - Heading: `why this collection exists.`
   - Body: `philosophyLong` split on `\n\n` into paragraphs.
3. **What's included section** (`id="whats-included"`)
   - Eyebrow: `— what's included —`
   - Heading: `designed end to end.`
   - Bullet list: `whatsIncluded` lines, each rendered with a gold diamond.
4. **Packages widget** — renders only when `pricing.packages` is non-empty.
   See section 3 for the per-collection tier list (Smile only today).
   - Widget eyebrow: `— packages —`
   - Widget heading: `three ways to bring the moment.`
   - Widget sub: `Designed as starting points. Every booking is still tailored — your venue, your event flow, your overlay design. Want something between tiers or beyond them? Inquire below.`
   - Middle (i === 1) card carries a `most popular` badge.
   - Each card price label: `from $<amount>`.
   - Each card CTA: `Reserve <tier.name>` (e.g. `Reserve The Mirror`),
     unless the tier specifies a custom `cta`. The CTA href is
     `#inquire?package=<tier.slug>` — JS lifts the package slug into a
     hidden field on the inquiry form.
5. **Honesty block** — renders only when `pricing.honestyBlock` is set
   (Visionary only today).
   - Eyebrow: `— the founder-led note —`
   - Heading: `pricing.honestyBlock.headline` (e.g. "Visionary starts at $1,500.")
   - Body: `pricing.honestyBlock.bodyHtml`.
6. **Portfolio teaser**
   - Eyebrow: `— portfolio —`
   - Heading: `recent <shortName lowercase> work.` (e.g. `recent smile work.`)
   - Empty state, when no portfolio items match this collection:
     > Films and case studies for this collection will appear here as they're added. In the meantime, inquire below — we'll share recent work that matches your event.
   - When the collection has more than 3 matching items, a "View all N
     films" CTA appears under the grid.
7. **Inquiry section** (`id="inquiry"`)
   - Eyebrow: `— begin your inquiry —`
   - Heading: `design the moment with us.`
   - Form: the short inquiry form (section 5). The dynamic intro passed
     to the form reads:
     `A few details about your event and we'll be in touch within 24 hours with thoughts on what <ShortName> can do for your day.`
8. **Other Collections strip** — section header:
   - Eyebrow: `— continue exploring —`
   - Heading: `other collections.`
   - Each card: large gold initial in Broadway, the short name, the first
     segment of the tagline (split on `·`), and an arrow.

### /portfolio — apps/site/src/pages/portfolio.astro

**SEO meta:**

- Title: `Video Portfolio · Smile NOLA`
- Description: `Recent Smile NOLA films across all five collections — wedding, event, and brand work from our videography team.`

Note: the page title and eyebrow are `Video Portfolio`, but the top
navigation label stays the shorter `Portfolio`. Reasoning: future portfolios
(photo, lighting, sound, web) are planned per-collection and the chrome
label should stay short.

**Hero:**

- Eyebrow: `— video portfolio —`
- Title (Broadway lowercase + Cormorant italic on "films,"):
  `recent films, across the collections.`
- Lede: `Films from Smile NOLA's most recent events. Browse all, or filter by collection. Photo, lighting, sound, and web portfolios are on the way.`

**Empty state** (rendered when the portfolio table is empty):

- Heading: `video portfolio coming soon.`
- Body: `We're curating the strongest recent work from our archives. In the meantime, inquire below — we'll share films and case studies that match the event you're planning.`
- CTA: `Begin your inquiry` → `/contact`

**Filter chips** (when items exist):

- `All` (default active)
- Then one chip per collection in canonical order:
  `Smile`, `Visionary`, `Digital Atelier`, `Aurora`, `Resonance` (using each
  collection's `shortName`).

**Card shapes:** the portfolio supports three kinds of cards:

1. **Video item:** clickable thumbnail opens the modal player with the
   embed URL; play icon overlay; if a `gallery_url` is set, a small
   `Gallery →` deep link renders below the description AND inside the modal.
2. **Still item with gallery URL:** thumbnail opens the gallery in a new
   tab; gallery-icon overlay (`↗`) instead of a play button.
3. **Still item without gallery URL:** decorative thumbnail only (rare; the
   API rejects items with neither URL nor thumbnail).

**Featured badge** on cards with `featured === 1`: `★ featured`.

**Per-card collection chip strip:** each tagged collection's short name in
gold uppercase letterspaced text, separated by middle dots.

**Per-card gallery deep link** (below the description, when `gallery_url`
is set): `Gallery →`.

**Modal video player:**

- Modal close button: `×`
- Modal-internal gallery link (visible only when the active video has a
  `gallery_url`): `View the full gallery →`

### /about — apps/site/src/pages/about.astro

**SEO meta:**

- Title: `About · Smile NOLA`
- Description: `Daniel Velez and the Smile NOLA studio — a luxury event production house in New Orleans designed around the discipline of cinematic production and the warmth of New Orleans hospitality.`

**Hero:**

- Eyebrow: `— about smile nola —`
- Headline (Broadway lowercase + Cormorant italic on "new orleans,"):
  `designed in new orleans, delivered with intent.`
- Lede: `Smile NOLA is a luxury event production house. Lighting, video walls, concert-grade sound, cinematic videography, event web design, and photo experiences — five collections, engineered as one polished evening.`

**Founder story:**

- Portrait alt text: `Daniel Velez, founder of Smile NOLA, in a forest-green suit and cream tie photographed in a tropical garden courtyard`
- Portrait caption (Broadway lowercase): `daniel velez`
- Section eyebrow: `— meet the founder —`
- Section heading: `daniel velez, founder.`
- Paragraph 1: `Daniel founded Smile NOLA on a simple conviction: New Orleans clients deserve a production company, not a rental catalog. The difference shows up everywhere — in how the room sounds, how the light falls, how the camera moves, how the inquiry is answered.`
- Paragraph 2: `His background is in commercial production at scale: fifteen years architecting audio, video, networking, and control systems for venues, restaurants, hotels, and student-housing campuses across the Gulf Coast. An Army veteran, a multi-time technology founder (RelentNet, FNIT, Animeniacs.shop), and a bilingual native of the New Orleans region — the kind of operator who's been responsible for things that absolutely had to work.`
- Paragraph 3: `Smile NOLA brings that same discipline to the part of the evening guests actually remember: the first dance, the toast, the camera's slow push toward the kiss. Every detail engineered. Nothing left to chance.`

**The lineage block (Ed Masters / Legend + Luxe Films):**

- Eyebrow: `— the lineage —`
- Heading: `learned from a master.`
- Body: `Smile NOLA's videography craft was shaped under the mentorship of Ed Masters of Legend + Luxe Films — one of the Greater New Orleans region's most respected wedding filmmakers. Ed's approach to cinematic storytelling — the discipline of capturing not just the events but the quiet, in-between moments — is the standard Smile NOLA's Visionary Suite is built around.` (Ed Masters renders bolded; "Legend + Luxe Films" is a link to https://www.legendluxefilms.com/.)
- Muted disclaimer: `Ed runs his own studio; he is a mentor and an inspiration, not a business partner. Our gratitude here is editorial, not commercial.`

**The Smile NOLA Standard — five steps:**

- Section eyebrow: `— the smile nola standard —`
- Section heading: `how working with us actually feels.`

Step 01 — `a real conversation, first.`
> Inquiry forms route to a real reply within 24 hours — never a generic
> quote, never a sales pipeline. We start by understanding what you're
> trying to create.

Step 02 — `a proposal, not a price sheet.`
> The proposal lays out exactly what we're delivering, why those choices
> matter for your event, and what the production day looks like end to end.
> Pricing is transparent; the conversation is consultative.

Step 03 — `site visits, when they matter.`
> First time at the venue, complex rig, unusual power, tight sightlines —
> we walk it end to end. Repeat venues, simple setups, or events where
> there's nothing to map — we save you the meeting and plan from your event
> docs. Either way, no surprises on the day.

(Step 3 was rewritten twice — see section 8 for the evolution. The settled
phrasing makes the trigger the event's need, not what's on the invoice.)

Step 04 — `a polished evening.`
> On the day, an on-site operator runs each system. Lighting cues hit on
> time, sound is tuned to the room, cameras move cinematically, the booth
> feels like part of the décor — and you get to be present at your own
> event.

Step 05 — `the lasting record.`
> Films, photos, and digital deliverables are color-corrected, branded, and
> delivered on a timeline you can rely on. Your event gets told back to you
> the way it actually felt.

**Closing section:**

- Eyebrow: `— ready when you are —`
- Headline (Broadway lowercase + Cormorant italic on "your guests"):
  `let's design something your guests won't forget.`
- CTA: `Begin your inquiry` → `/contact`
- Signature block:
  - Lead-in: `— with intention,`
  - Name (Holimount script): `Daniel Velez`
  - Role: `founder · smile nola`

### /contact — apps/site/src/pages/contact.astro

**SEO meta:**

- Title: `Contact · Smile NOLA`
- Description: `Begin your inquiry with Smile NOLA — luxury event production in New Orleans. Photo booth, videography, web design, lighting, video walls, and concert-grade sound.`

**Hero:**

- Eyebrow: `— let's design your moment —`
- Title (Broadway lowercase + Cormorant italic on "event"):
  `tell us about the event you're imagining.`
- Lede: `Five collections, one production house. The more you share below, the more tailored our reply will be. Daniel responds to every inquiry personally — typically within 24 hours.`

**Body:** The deep inquiry form (`InquiryFormDeep`) — see section 5 for
every label, placeholder, and microcopy string.

**Quiet closing line:**

> Prefer to start with a direct email or call? You can reach Daniel at
> smilenolainfo@gmail.com or 858-859-1851 — or send the form above and
> we'll route the conversation.

The email is a `mailto:` link; the phone is a `tel:+18588591851` link.

Optional `?collection=<slug>` query param on /contact deep-links and
auto-checks the matching service chip on page load.

### /404 — apps/site/src/pages/404.astro

**SEO meta:**

- Title: `Lost · Smile NOLA`
- Description: `That page isn't here. Let's get you back somewhere useful.`

**Body:**

- Eyebrow: `— 404 —`
- Headline (Broadway lowercase + Cormorant italic on "moment"):
  `that moment isn't here.`
- Body: `The page you're looking for either moved or never existed. Let's get you back somewhere useful.`
- Primary CTA: `Smile NOLA · home` → `/`
- Secondary CTA: `Explore collections` → `/collections`

(Astro emits this with `Astro.response.status = 404` so the response carries
the correct status, not a 200.)

### Global navigation (SiteHeader)

Source: `apps/site/src/components/layout/SiteHeader.astro`.

- Brand mark: the gold full-logo SVG, links to `/`, `aria-label`
  `Smile NOLA — home`.
- Primary nav (in order, exact labels):
  1. `Collections` → `/collections`
  2. `Portfolio` → `/portfolio`
  3. `About` → `/about`
  4. `Contact` → `/contact`
- Persistent CTA on the right: `Inquire` → `/contact`.

(Header acquires a frosted background after scrolling past 50% viewport
height.)

### Global footer (SiteFooter)

Source: `apps/site/src/components/layout/SiteFooter.astro`.

**Brand region:**

- Wordmark logo (gold).
- Tagline below the logo: `cinematic event production · new orleans`

**Three columns:**

1. **Discover**
   - `All Collections` → `/collections`
   - Then one link per collection in canonical order, labelled
     `<ShortName> · <first segment of tagline>`:
     - `Smile · photo booth experiences`
     - `Visionary · cinematic videography`
     - `Digital Atelier · event websites`
     - `Aurora · lighting`
     - `Resonance · concert-grade sound`
2. **Studio**
   - `About Smile NOLA` → `/about`
   - `Portfolio` → `/portfolio`
   - `Begin Your Inquiry` → `/contact`
3. **Contact**
   - `smilenolainfo@gmail.com` (mailto link)
   - `858-859-1851` (tel link to `+18588591851` after stripping non-digits)
   - Muted location line: `New Orleans · Louisiana`
   - Instagram link slot exists in the data structure but is currently
     `null` — a TODO marker pending the owner-supplied handle.

**Bottom strip:**

- Left: `© <year> Smile NOLA · cinematic event production · new orleans`
  where `<year>` is the current year from `new Date().getFullYear()`.
- Right (small, muted): `admin` link → `/admin` (the only entry point into
  the admin surface from public pages).

## 5. Form copy — every label, placeholder, helper, validation

### Short inquiry form

File: `apps/site/src/components/forms/InquiryFormShort.astro`.
Used on: each `/collections/{slug}` page (embedded in the page's inquiry
section, `id="inquire"`). Submits to `POST /api/inquiry` as JSON.

**Default props (overridden on every collection page by the parent):**

- Default title: `Begin your inquiry`
- Default intro: `Share a few details about the moment you want to create. We'll be in touch within 24 hours with a consultative reply.`

**Hidden fields (per form instance):**

- `collection` = the page's collection slug.
- `source` = `collection-<slug>` (e.g. `collection-smile`).
- `selected_package` (added by JS when the URL carries `?package=<slug>`,
  injected by a Reserve CTA on the packages widget).

**Honeypot:** off-screen `Company (leave blank)` field, `name="company"`,
`tabindex="-1"`, `autocomplete="off"`. Server-side at `/api/inquiry` silently
accepts-and-drops any submission where `company` is non-empty (returns 201
with id 0 so the bot thinks it succeeded).

**Visible fields:**

- `First name *` — text, required, autocomplete `given-name`.
- `Last name *` — text, required, autocomplete `family-name`.
- `Email *` — email, required, autocomplete `email`, inputmode `email`.
- `Phone *` — tel, required, autocomplete `tel`, inputmode `tel`.
- `Event date` — date input, optional. Spans both columns.
- `Tell us about the moment you want to create` — textarea, 4 rows,
  placeholder: `Setting, mood, the feeling you're chasing…`. Spans both
  columns.

**Submit row:**

- Button: `Send inquiry`. Becomes `Sending…` while in flight.
- Trust microcopy under the button: `Replies typically within 24 hours · no spam, ever`

**Personalized thank-you (replaces the form on success):**

- Greeting (Broadway lowercase, gold): `thank you, <firstName>.` —
  falls back to `thank you.` when the user didn't share a first name.
- Body line: `Daniel will reach out personally within 24 hours to confirm your event on <Month Day, Year>.` (Date is formatted from the `event_date`
  ISO string, displayed as e.g. "September 15, 2026" with the year bolded.)
  When `event_date` is missing or malformed, falls back to plain
  `Daniel will reach out personally within 24 hours.`

**Error region:** server-side errors render in a small region below the
submit row in `--sn-amber`. Defaults to hidden until populated.

### Deep inquiry form (the /contact form)

File: `apps/site/src/components/forms/InquiryFormDeep.astro`.
Submits to `POST /api/contact` as JSON.

**Default props:**

- Default title: `Begin your inquiry`
- Default intro: `Just the basics to start the conversation. We'll reply within 24 hours and gather everything we need for a real quote on the call.`

**Header:**

- Eyebrow: `— begin your inquiry —`
- Heading (Broadway lowercase, gold): the `title` prop default.
- Intro: the `intro` prop default.

**Hidden fields:**

- `source` = `contact`.

**Honeypot:** same `Company (leave blank)` field as the short form.

#### Fast path (visible by default — 7 fields)

**Block 1 — `— how to reach you —`**

- `First name *` (text, required, autocomplete `given-name`)
- `Last name *` (text, required, autocomplete `family-name`)
- `Email *` (email, required, autocomplete `email`)
- `Phone *` (tel, required, autocomplete `tel`)

**Block 2 — `— about the event —`**

- `Event date` (date, optional, spans both columns)
- Block help line above the chips: `What services are you considering?`
- Service chip grid — see "Service chips (dual-label)" below.
- `A short note (optional)` (textarea, 2 rows, spans both columns), placeholder:
  `What you're planning, anything you want us to know up front. Skip if you'd rather chat live.`

**Service chips (dual-label pattern, committed in 2286915):**

Each chip shows the plain-English service name in large Broadway lowercase
on top, and the brand collection name in small muted uppercase letterspaced
text below. Mapping (`SERVICE_NAMES` const, `InquiryFormDeep.astro:31-37`):

- `smile` → Plain English: `Photo Booth` · Brand tag: `Smile Collection`
- `visionary` → Plain English: `Videography` · Brand tag: `Visionary Collection`
- `digital-atelier` → Plain English: `Web & Digital` · Brand tag: `Digital Atelier Collection`
- `aurora` → Plain English: `Lighting` · Brand tag: `Aurora Collection`
- `resonance` → Plain English: `Sound` · Brand tag: `Resonance Collection`

Sixth chip (value `other`):

- Plain English: `Other` · Brand tag: `custom inquiry`

#### Optional disclosure ("Want to share more?")

Below the fast path is a `<details>` block. The summary copy makes the
optional nature unmissable so a lead-capture-only buyer never feels they
have to fill it.

**Summary text (always visible, on the collapsed disclosure):**

- Title: `Want to share more?`
- "Optional" pill (gold, bordered): `Optional`
- Subtitle: `Skip if you'd rather. We'll catch up on the rest when we reply.`

When opened, the following fieldsets render:

**`— more contact info —`**

- `Preferred contact method` (select, spans both columns):
  - Placeholder option: `— choose —`
  - Options (`PREFERRED_CONTACTS`): `Email`, `Phone`, `Text`.

**`— more about the event —`**

- `Event type` (select):
  - `— choose —`
  - Options (`EVENT_TYPES`): `Wedding`, `Reception`, `Engagement / Rehearsal`, `Corporate event`, `Gala / Fundraiser`, `Milestone celebration`, `Other`.
- `Estimated guest count` (number, min 0, max 100000, inputmode numeric).
- `Venue (name or location)` (text, spans both columns), placeholder: `e.g. The Sugar Mill · New Orleans, LA`
- `Event start time` (text), placeholder: `e.g. 5:00pm`
- `Event end time` (text), placeholder: `e.g. 11:00pm`
- `Planner / coordinator` (text), placeholder: `name (if applicable)`
- `Budget range` (select):
  - `— choose —`
  - Options (`BUDGET_RANGES`, anchored at the $695 booth floor):
    - `Under $1,000`
    - `$1,000 – $2,500`
    - `$2,500 – $5,000`
    - `$5,000 – $10,000`
    - `$10,000 – $25,000`
    - `$25,000+`
    - `Let's talk through what's possible`

**`— service-specific details —`**

Helper: `Questions specific to the services you checked above. Fill what you know.`

The per-collection deep-dive blocks (one per checked chip) reveal when the
matching chip is checked. Each block's heading reads `<Plain English> · <ShortName> Collection` (e.g. `Photo Booth · Smile Collection`). The fields
inside each block are the collection's `inquiryFormFields` array — see
section 3 for the per-collection field list.

The Other / custom inquiry block (when `Other` is checked):

- Heading: `Custom · tell us what you're building`
- Field: `Additional services or custom needs` (textarea, 4 rows), placeholder: `The event you're imagining, the services that aren't on our collections list, the moment you want to create…`

Empty-state hint (rendered until at least one chip is checked):

> Check a service above and its specific questions will appear here.

**`— how did you find us —`**

- `Referral source` (text), placeholder: `Instagram, a friend, a wedding planner, Google…`

**Submit row:**

- Button: `Send inquiry`. Becomes `Sending…` while in flight.
- Trust microcopy: `Replies typically within 24 hours · no spam, ever`

**Personalized thank-you (replaces the form on success):**

- Greeting: `thank you, <firstName>.` (or `thank you.` when missing).
- Body line: `Daniel will reach out personally within 24 hours to confirm your event on <Month Day, Year>.` (or fallback `Daniel will reach out personally within 24 hours.`).

The thank-you also scrolls the page back to the top on success.

### Admin portfolio form

File: `apps/site/src/pages/admin/portfolio.astro`.

**Page chrome:**

- Eyebrow: `— admin · portfolio —`
- Heading (Broadway lowercase): `add the work that closes the deal.`
- Head-sub: `Most pieces have a video — paste a YouTube, Vimeo, or PicTime gallery URL and the thumbnail is fetched automatically (PicTime needs a manual upload). Photo-only entries (booth-only events) can skip the video URL entirely; just upload a thumbnail. Tag every collection the piece belongs to, and add a Gallery URL if the client gallery lives elsewhere.`

**Form section heading:** `Add a new piece` (becomes implicit when an edit is
in progress; the submit button changes label).

**Fields, in order:**

- `Video URL` — input, type `url`, placeholder `https://… (leave blank for photo-only)`. Helper hint after the label: `— optional for photo-only events. Accepted: YouTube, Vimeo, PicTime.` Title attribute (browser tooltip): `Accepted: youtube.com / youtu.be / vimeo.com / <subdomain>.pic-time.com`.
- `Title *` — text, required, max 200 chars, placeholder: `Couple's name · venue · year`.
- `Collections *` — fieldset legend with helper `— check every collection this piece appeared in`. The fieldset renders one checkbox per collection in canonical order, each labelled with the short name (bold) and the first segment of the tagline (italic) underneath:
  - `Smile` / `photo booth experiences`
  - `Visionary` / `cinematic videography`
  - `Digital Atelier` / `event websites`
  - `Aurora` / `lighting`
  - `Resonance` / `concert-grade sound`
- `Custom thumbnail` — file input, accept `image/jpeg,image/png,image/webp`. Helper hint: `— optional, JPEG/PNG/WebP, up to 5 MB. Auto-resized to 1280×720.` Empty-state preview label: `No file selected — auto thumbnail will be used (YouTube / Vimeo only).` When a file is selected, the label switches to `<filename> · <size> KB · will be resized to 1280×720 JPEG`. When editing an existing item: `Pick a file to replace the current thumbnail, or leave empty to keep it.`
- `Description (optional)` — textarea, 3 rows, max 2000 chars, placeholder: `One or two sentences shown under the title on the public portfolio.`
- `Gallery URL` — input, type `url`, placeholder: `https://… (leave blank if there's no public gallery)`. Helper hint: `— optional. Direct link to the full client gallery (PicTime, Pixieset, etc.). Renders as a small "Gallery →" link on the public card.`
- `Feature on homepage` — checkbox, label `Feature on homepage`.
- `Display order (lower = first)` — number, default 0.

**Form actions:**

- Primary submit: `Add to portfolio` (becomes `Update` when editing, `Adding…` / `Updating…` in flight).
- Cancel (only visible during edit): `Cancel edit`.
- Save status microcopy (gold when ok, amber on error). Success: `✓ Saved · reloading…`; success with warning (e.g. auto-thumbnail fetch failed): `✓ Saved with warning: <message>`.

**Client-side validation messages:**

- `Pick at least one collection.`
- `Provide a video URL or upload a thumbnail (photo-only items still need a thumbnail).`

**Server-mirrored validation messages** (returned by `/api/admin/portfolio`
and surfaced in the save-status line):

- `URL must be a YouTube, Vimeo, or PicTime gallery link`
- `Item must keep either a video URL or a thumbnail. Upload a thumbnail before clearing the URL.`
- Thumbnail validation: empty (server-side rule), too-large (5 MB ceiling),
  wrong MIME type.

**List section:**

- Heading: `Current portfolio · <count> item` / `<count> items` (pluralized).
- Empty state: `Nothing here yet. Add your first video above — it'll appear on /portfolio and on every tagged collection page within seconds.`
- Each row carries:
  - Thumbnail (with placeholder fallback when none set).
  - Featured badge: `★ featured` (top-left of the thumbnail).
  - Title in bold.
  - Per-row collection tags as small pills (e.g. `Smile`, `Visionary`).
  - Optional description.
  - URL line — when a video URL is set: `Video: <url>` (label gold uppercase, URL underlined). When no video URL: italic line `Photo-only item — no video URL`.
  - Optional gallery URL line: `Gallery: <url>`.
  - Action buttons: `Edit`, `Delete`.

**Delete confirmation:** browser `confirm()` prompt with the message
`Delete "<title>"? This cannot be undone.`

## 6. Other admin surfaces

### /admin/login

File: `apps/site/src/pages/admin/login.astro`. Standalone page (does not use
`AdminLayout`).

- Page title: `Admin Login · Smile NOLA`
- `<meta name="robots" content="noindex,nofollow">`
- Card head: small icon mark (`/logos/icon.svg`), eyebrow `— admin —`,
  heading (Broadway lowercase) `password, please.`, sub `Authorized personnel only.`
- Form: a single `Password` field, autofocus, `autocomplete="current-password"`.
- Submit button: `Enter` (becomes `Verifying…` in flight).
- Error region (amber). Recognized error states:
  - Generic backend error: `Login failed.`
  - Incorrect password (with remaining attempts): `Incorrect password. (<n> attempts remaining)`
  - Rate-limited (HTTP 429): `Too many attempts. Please wait a moment.` (or whatever message the server returns).
  - Network failure: `Network error. Try again.`
- Footer: `← back to smile-nola.com` → `/`.

### /admin — dashboard

File: `apps/site/src/pages/admin/index.astro`.

- Page title in `AdminLayout`: `Dashboard · Smile NOLA Admin`
- Eyebrow: `— smile nola admin —`
- Heading: `good to have you back.`
- Stat cards (each links to a filtered inquiries view):
  - `<count>` / `New inquiries` → `/admin/inquiries?status=new`
  - `<count>` / `In conversation` → `/admin/inquiries?status=contacted`
  - `<count>` / `Closed` → `/admin/inquiries?status=closed`
  - `<count>` / `Total · all time` → `/admin/inquiries`
- Quick-actions section heading: `quick actions`
- Quick-action cards:
  - `All inquiries` / `View, filter, update status, export CSV` → `/admin/inquiries`
  - `Video Portfolio` / `Add or remove video embeds` → `/admin/portfolio`
  - `Testimonials` / `Add or feature client quotes` → `/admin/testimonials`

### /admin/inquiries — index

File: `apps/site/src/pages/admin/inquiries/index.astro`.

- Page title in `AdminLayout`: `Inquiries · Smile NOLA Admin`
- Eyebrow: `— admin · inquiries —`
- Heading: `conversations in progress.`
- Top-right action: `Export CSV` (links to `/api/admin/export/inquiries.csv`,
  honoring the active status filter via `?status=<value>`).
- Filter chips (each shows count in a small pill):
  - `All <total>`
  - `New <count>`
  - `In conversation <count>`
  - `Closed <count>`
- Search input: `Search name, email, phone, venue…`
- Empty state: `No inquiries match.` followed by `Clear the search?` (when
  a search is active) or `Once outreach lands, they'll show up here.`
- Table columns: `Date`, `Name`, `Contact`, `Event`, `Source`, `Status`,
  and an unlabelled "open" column with a right-arrow link to the detail page.
- Status pill labels (lowercase, brand-colored): `new` (amber), `contacted`
  (gold), `closed` (muted stone).

### /admin/inquiries/{id} — detail

File: `apps/site/src/pages/admin/inquiries/[id].astro`.

- Page title in `AdminLayout`: `Inquiry #<id> · Smile NOLA Admin`
- Back link: `← All inquiries`
- Eyebrow: `— inquiry #<id> —`
- Heading: the inquirer's first + last name.
- Head meta strip: clickable email + clickable phone + muted `received <created_at>`.
- Status pill in the top-right (same scheme as the list).

**Update block** (`Update` heading):

- Status radio group (three pills): `new`, `contacted`, `closed`.
- `Admin notes (internal, not shown to client)` — textarea, 4 rows,
  placeholder: `Conversation notes, follow-up dates, vendor connections…`
- Submit button: `Save` (becomes `Saving…`, success indicator `✓ Saved`).

**Read-only blocks (rendered in this order):**

- `Contact` — Name, Email, Phone, Preferred contact, Source, Received.
- `Event` — Date, Type, Venue, Guest count, Start, End, Planner, Budget range, How they heard. Missing values render as em-dash (`—`).
- `Collections of interest` (only when set) — pills, one per slug.
- Per-collection deep-dive groups (one per checked collection that has
  collection-specific fields). Group heading is the slug; field labels are
  the snake_case key with underscores replaced by spaces.
- `What they shared` (only when `message` is set) — preserves whitespace
  with `white-space: pre-wrap`.

### /admin/testimonials

File: `apps/site/src/pages/admin/testimonials.astro`.

- Page title in `AdminLayout`: `Testimonials · Smile NOLA Admin`
- Eyebrow: `— admin · testimonials —`
- Heading: `words that close the next deal.`
- Head-sub: `Add real client quotes. Featured testimonials surface on the homepage.`

**Form section heading:** `Add a new testimonial`.

- `Quote *` — textarea, required, max 4000 chars, placeholder: `“ We told them what we wanted. They delivered the night we'll talk about for years. ”`
- `Attribution *` — text, required, max 200 chars, placeholder: `Sarah & Marcus · Wedding · April 2026`
- `Feature on homepage` — checkbox.
- `Display order` — number, default 0.

**Form actions:**

- Submit: `Add testimonial` (becomes `Update` when editing, `Adding…` /
  `Updating…` in flight).
- Cancel: `Cancel edit`.

**List section:**

- Heading: `All testimonials · <count>`
- Empty state: `No testimonials yet. Add your first above — featured ones appear on the homepage immediately.`
- Each row shows the quote in champagne, attribution prefixed with em-dash,
  a `★ featured` badge (when applicable), and `Edit` / `Delete` action
  buttons.
- Delete confirmation: `Delete this testimonial?\n\n"<first 60 chars of quote>…"`

### AdminLayout nav

File: `apps/site/src/layouts/AdminLayout.astro`.

- Top bar: gold mark (`Smile NOLA Admin` `aria-label`), four nav links, and
  a `Log out` button on the far right.
- Nav items, in order:
  1. `Dashboard` → `/admin`
  2. `Inquiries` → `/admin/inquiries`
  3. `Video Portfolio` → `/admin/portfolio`
  4. `Testimonials` → `/admin/testimonials`
- Log-out button text: `Log out` (aria-label `Log out`). On click POSTs to
  `/api/admin/logout` and redirects to `/admin/login`.
- Skip-link target: `Skip to content` → `#admin-main`.

## 7. System emails & notifications

Source: `apps/site/src/lib/email.ts`. The email path is best-effort. Every
submission is saved to SQLite (`/data/leads.db` inside the container) before
the email is even attempted; an SMTP failure does NOT cascade into a request
failure.

**Environment variables that gate the email path** (all blank-tolerant):

- `NOTIFY_EMAIL` — destination address (recipient).
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`

If any of these are blank or missing, `email.ts` logs to stdout with the
prefix `[inquiry] SMTP not configured — would have notified about #<id> (<email>). Submission saved.` and returns silently.

**When SMTP is configured:**

- From header: `"Smile NOLA Inquiries" <SMTP_USER>`
- To: `NOTIFY_EMAIL`
- Reply-to: the inquirer's email.
- Subject template: `New inquiry: <first_name> <last_name> · <source>` (e.g.
  `New inquiry: Sarah Patel · contact` or `New inquiry: Sarah Patel · collection-smile`).
- Text body and HTML body both include: captured timestamp, source,
  name/email/phone, optional event_date / event_type / venue / guest_count /
  budget_range / collections_interested, and the message field if present.
- Both bodies include a footer link: `https://smile-nola.com/admin/inquiries/<id>` (text version) or `View in admin →` (HTML version).

**Inquiry endpoints:**

- `POST /api/inquiry` — the short-form endpoint used by every collection
  page's embedded form. Saves to SQLite, then fires-and-forgets the
  notification.
- `POST /api/contact` — the deep-form endpoint used by `/contact`. Same
  save-then-notify pattern.

Both endpoints honor the honeypot trap (silently accept-and-drop submissions
with non-empty `company` field) and return a uniform success message:
`Thank you. We'll be in touch within 24 hours.`

## 8. Key decisions and copy evolution

1. **Hero positioning.** The homepage thesis line `we design experiences,
   not rentals.` is the operating frame for every offering. Even the photo
   booth is positioned as an experience because every booking includes a
   custom overlay and an on-site attendant — the booth is designed, not
   rolled in on a luggage cart.
2. **About page step 3 — rewritten twice.** The original copy claimed
   walkthroughs were universal (`a venue walkthrough`). A first rewrite
   (commit d0169d0) split the line by service category, which still felt
   prescriptive. The settled version (commit 9d6bccb) makes the trigger
   situational — what the event needs, not what's on the invoice:

   > site visits, when they matter.
   >
   > First time at the venue, complex rig, unusual power, tight sightlines —
   > we walk it end to end. Repeat venues, simple setups, or events where
   > there's nothing to map — we save you the meeting and plan from your
   > event docs. Either way, no surprises on the day.

3. **Contact form trim (commit 6b653a5).** The form went from ~15 visible
   fields on first paint down to 7 on the fast path. Everything else
   (preferred contact method, event type, venue, guest count, planner,
   times, budget range, referral, per-collection deep-dives) moved behind
   a clearly-marked `Want to share more? · Optional` disclosure. The
   rationale: this form's job is lead capture, not pre-quote interrogation.
   Quote-stage detail comes later, on a real call.
4. **Service chip dual-label (commit 2286915).** Chips originally read like
   `Aurora / atmospheric lighting`. They now read with the plain-English
   service name on top (`Lighting`) and the brand collection underneath
   (`Aurora Collection`). First-time visitors recognise the service before
   they learn the brand collection name. The `SERVICE_NAMES` mapping lives
   inline in the form component rather than in the collections data layer,
   because every other surface on the site uses `shortName` directly.
5. **Portfolio nav label vs page title (commit 2555ba5).** The top
   navigation stays `Portfolio` (short, clean) but the page title and
   eyebrow read `Video Portfolio` because future portfolios — photo,
   lighting, sound, web — are planned per-collection. The chrome shouldn't
   pre-commit to a future structure that hasn't been built.
6. **Visionary honesty block.** Higher-budget productions are referred to
   Legend + Luxe Films (Ed Masters lineage). The exact wording is in
   section 3 under Visionary. Two things are settled there: Daniel
   personally does **not** edit films ("our editing team builds the final
   film"), and the referral is explicit and gracious.
7. **Photo-only portfolio items (commit 1e8d047).** Booth-only events have
   no video URL. Items can still be added without a video URL, but they
   must keep either a video URL or a thumbnail — a cross-field validation
   that lives both client-side and server-side. The admin form's helper
   hint and the public-grid "still" card shapes accommodate this.
8. **Personalized inquiry thank-you (commit 460ade2).** Greets by first
   name and event date. Falls back gracefully when either field is missing.
   Visible in both the short-form thank-you (collection pages) and the
   deep-form thank-you (contact page). The greeting uses Broadway-lowercase
   styling; the event date is bolded if successfully parsed.
9. **Smile tier widget.** Explicit packages at $695 / $895 / $1,195 on
   `/collections/smile` are the only place a tier widget renders today.
   The rationale: booth-only buyers need to see real pricing before they
   commit to filling out an inquiry. Without this, they'd bounce off a
   page framed for higher-priced full productions. The `Reserve <tier>`
   CTAs deep-link to the inquiry form with `?package=<slug>` so the admin
   sees the tier in the captured inquiry.

## 9. Technical stack (one-pager)

- Astro 5 SSR with `@astrojs/node` (standalone adapter).
- Tailwind v4 via `@tailwindcss/vite`.
- SQLite via `better-sqlite3` — single DB file at `<repo>/data/leads.db`
  (mounted into the container at `/data/leads.db`).
- Sharp for thumbnail resizing (auto-1280×720 JPEG from PicTime/upload).
- Zod for input validation on both inquiry endpoints and the admin
  portfolio/testimonials endpoints.
- Nodemailer for best-effort SMTP. Always optional, always non-blocking.
- Deployed on Coolify with a Docker Compose definition, Traefik reverse
  proxy, and Let's Encrypt-issued certificates.
- The repo also contains `apps/intake/` — a separate Next.js booth intake
  app used at expos and walk-up events. It shares the SQLite DB so leads
  from both surfaces land in the same admin inbox.

## 10. Live deploy reference

- **Domain:** smile-nola.com (DNS via Cloudflare; A record direct to
  Hetzner — no proxying, so Traefik can terminate TLS).
- **Server:** Coolify at empower.relentnet.com.
- **Container image:** `smile-nola/site:latest`.
- **Persistent volume:** Docker named volume `smile_nola_data` mounted at
  `/data` inside the container. This carries the SQLite DB and any
  uploaded thumbnails. Named volume rather than bind mount because the
  bind mount masked the image-supplied directory permissions (commit b55f599).
- **Public contact:**
  - Email: `smilenolainfo@gmail.com`
  - Phone: `858-859-1851`
  - Both are set in the SiteFooter, the `/contact` closing line, and the
    LocalBusiness JSON-LD block emitted by `BaseLayout`.
- **Environment variables** (names only — see `.env.example` in the repo
  root for the canonical list):
  - `ADMIN_PASSWORD`
  - `ADMIN_SESSION_SECRET`
  - `NOTIFY_EMAIL`
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
- **Full deploy walkthrough:** `DEPLOY.md` at the repo root.
