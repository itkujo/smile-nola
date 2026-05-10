# Handoff: Smile NOLA Marketing Site Kickoff

**Date:** 2026-05-10
**From:** Booth-intake build session
**To:** Fresh session to scope + build the marketing site
**Status:** Ready for brainstorming with the user

---

## What you're building

A new, distinct application: **the Smile NOLA marketing/brand site**. Lives in this repo as a sibling to the existing booth intake form.

The booth intake form is **complete and in production**. Don't touch `apps/intake/` unless the user explicitly asks you to.

Your project lives at `apps/site/` (to be created).

---

## Step 0 — Required reading

Before asking the user a single question, read:

1. **`/home/phoenix/Downloads/Smile_NOLA_Website_and_Forms_Brand_Brief_for_OpenCode.md`** — the authoritative brand brief. Brand promise, voice, typography rules, color tokens, collection architecture, brand rules. Treat it as canon.
2. **`docs/superpowers/specs/2026-05-09-smile-nola-intake-form-design.md`** — the design doc for the booth intake. Useful as an example of how we work and what decisions were already locked.
3. **`apps/intake/app/globals.css`** — the brand tokens are already in code. Copy the `:root` block (colors, fonts) into the new site so visual language stays consistent.
4. **`apps/intake/components/brand/`** — DecoCorner, GoldDivider, LogoMark already exist and are battle-tested. You'll likely want to port the design language (not necessarily the components themselves, since framework differs).

---

## Decisions already locked from previous brainstorming

These came out of the user's day-one brainstorming with the previous agent. Do **not** re-litigate them unless the user brings it up:

1. **Stack: Astro** for the marketing site. Reasoning: content-heavy, SEO matters, performance matters, the booth form's interactivity is the exception not the rule. Astro shines for the marketing-site shape; React islands available where needed.
2. **Location: `apps/site/`** as a new directory at the repo root. Sibling to `apps/intake/`. The repo is structured as a multi-app monorepo without a workspace manager (no pnpm workspaces yet — fine, keep it simple).
3. **Brand canon honored from the brief**:
   - Typography: Holimount (signature, used sparingly), Broadway (Art Deco display), Poppins (utility/body). Holimount and Broadway font files live at `apps/intake/public/fonts/`. Copy them into `apps/site/public/fonts/` for now.
   - **Important type rule the user discovered during the booth build**: Broadway is single-case-only — when paired with `text-transform: uppercase` the glyphs double-decorate and look bad. Always write Broadway headings in **lowercase source text** with a `lowercase` CSS class. The font renders its decorative caps automatically.
   - Colors and tokens: see `apps/intake/app/globals.css` `:root` block. Verbatim from §6 of the brief.
4. **Official logo artwork**: lives at `apps/intake/public/logos/`. Four variants:
   - `full-logo.svg` — submark + script wordmark, `currentColor` (recolorable)
   - `full-logo-gold.svg` — same, pre-baked gold `#D4AF37`
   - `icon.svg` — camera/SN floral submark only, `currentColor`
   - `wordmark.svg` — Holimount script "Smile Nola" only, `currentColor`
   - **The "PHOTO/VIDEO BOOTH" subtitle was deliberately removed** — Smile NOLA is positioning as a production company now, not a booth rental. Do not put PHOTO/VIDEO BOOTH anywhere.
5. **Five collections** (Brand Brief §4) — each should have its own marketing page, inquiry path, and form:
   - The Aurora Collection (lighting, video walls)
   - The Resonance Series (concert-grade sound)
   - The Visionary Suite (cinematic videography)
   - The Digital Atelier (web, event design)
   - The Smile Collection (photo booths)

---

## What is NOT decided

Bring all of these to the user via brainstorming:

1. **Sitemap & information architecture** — what pages, in what hierarchy, with what navigation. The brief §8.1 lists a recommended page set, but the user should confirm priorities and whether all collection pages launch v1 or some are deferred.
2. **Content** — copy, imagery, the "About / Founder Story" voice, testimonials, case studies. The brief gives canonical copy blocks for each collection (§13) — use those as starting points.
3. **Inquiry-per-collection forms** — Brand Brief §10 specifies the field sets for each of the 5 collection inquiry forms. These need to be built. Decide: do they save into the same SQLite DB as the booth intake, or a separate store? Recommend: same DB, new table `inquiries`, since the user already has admin tooling pointed at `data/leads.db`.
4. **Imagery sourcing** — placeholder vs real event photography vs stock. Brand brief prohibits Lorem ipsum and example.com URLs (per global AGENTS.md). Get real content or pick contextually appropriate defaults with the user.
5. **Hosting** — local-only like the booth, or actually deploy somewhere (Vercel, Cloudflare Pages, Netlify)? If deploying, decide on a domain.
6. **Analytics, performance, SEO baseline** — sitemap.xml, robots.txt, OG images, twitter cards, structured data, Lighthouse targets. Astro makes most of this easy but it's still a content decision.
7. **HoneyBook integration for inquiry forms** — the booth form exports CSV manually. The marketing-site inquiry forms could do the same, or directly POST to HoneyBook's API, or email-notify the founder. User preference required.
8. **Future evolution to "black-on-white editorial"** — Brand brief §1 hints at a possible future shift toward a more editorial light-mode aesthetic. Brief explicitly says "should not drive the first build" — confirm with user that v1 stays dark-luxury.

---

## What exists to reuse

### Brand tokens (`apps/intake/app/globals.css`)

The full `:root` block including all 8 brand colors, alpha tints, and font family declarations. Copy verbatim. The `@theme inline` block exposes them as Tailwind v4 utilities — you'll port that pattern if you use Tailwind in Astro.

### Fonts (`apps/intake/public/fonts/`)

- `Holimount.otf`, `Holimount-Swash.otf`
- `Broadway.ttf`

Copy into `apps/site/public/fonts/` and replicate the `@font-face` declarations.

### Logos (`apps/intake/public/logos/`)

Already cleaned, viewBox-tightened, `currentColor`-tinted, mask-friendly. Use as-is or copy into `apps/site/public/logos/`.

### Brand components (`apps/intake/components/brand/`)

- `DecoCorner.tsx` — Art Deco corner ornament
- `GoldDivider.tsx` — thin gold rule with centered diamond
- `LogoMark.tsx` — wrapper that renders any of the 4 logo variants via CSS mask, with optional glow filter
- `DensityToggle.tsx` — font-size selector (Standard / Large) for accessibility

These are React + Framer Motion. If Astro + plain CSS does the job, reimplement simpler. If you do use React islands in Astro, you can copy these directly.

### Motion language (`apps/intake/lib/motion.ts`)

Framer Motion presets used in the booth: stepVariants, headlineReveal, fieldStagger, fadeUp. Cinematic easing `[0.16, 1, 0.3, 1]`. Useful reference even if your marketing-site motion ends up lighter.

### Booth (don't touch)

`apps/intake/` is in production. The user uses it for live lead capture. Leave it alone unless they ask. If you do need to reference its CSV export format, it's at `apps/intake/lib/csv.ts` and serves at `/api/export` (HoneyBook-friendly columns).

---

## Project root files to be aware of

- `README.md` — top-level overview
- `MORNING_BRIEF.md` — the booth-day morning briefing (legacy, can be ignored or archived)
- `.gitignore` — already configured to ignore `data/`, `*.db`, `.next/`, `node_modules`, etc.
- `docs/superpowers/specs/` — design docs (one exists for the booth)
- `docs/superpowers/handoffs/` — this file lives here. Future handoffs go here too.

---

## How to start with the user

Invoke the `brainstorming` skill **before** any other action. Brainstorming is non-optional even for "simple" projects per the skill's own rules.

Your first message after reading should be something like:

> "I've read the brand brief, the booth-form spec, and the handoff doc. Before we touch any code I want to brainstorm the scope and shape of the marketing site. Quick context check: the goal is to send out outreach emails today — so should we plan a minimal v1 that ships fast (e.g., one-page landing with collection summaries) and iterate, or scope the full multi-page site upfront and ship in pieces?"

That's a good first question because it disambiguates the user's deadline pressure ("emails today") from the brief's broader scope (multi-page architecture).

---

## Email-outreach context (the user's deadline)

The user said: *"I am trying to send out emails today hopefully."*

That tells you:
- There's a need for a landing destination from today's outreach
- It probably doesn't need to be the full eventual site
- A holding-page-quality v1 with brand polish + a single "Inquire" CTA may be enough for today
- Don't let perfect scope kill today's send

Discuss the trade-off with the user explicitly. They've been working hard for two days; an MVP that's "shippable for outreach today, then iterate" is likely the right call.

---

## How to deploy (if needed today)

If the user wants the site live publicly today for the email send:

- **Vercel** — easiest, free tier, deploys Astro out of the box, supports custom domains.
- **Cloudflare Pages** — also free, also Astro-friendly, great performance.
- **Netlify** — same.

Ask user preference. If no preference, recommend Vercel (battle-tested for Astro).

For a domain — `smile-nola.com` is referenced in Daniel's vCard (see `vcard.ts` plan from the booth session for the contact card the user wanted). Confirm whether they own it and have DNS access.

---

## Style of working

The user, Daniel Velez (Owner, Smile NOLA), prefers:

- **Honest technical opinions over agreement-seeking**. He'll push back if he disagrees and expects the same.
- **Real wow-factor UI**. He explicitly cited meter.com's motion quality as a benchmark.
- **Speed when there's a deadline**. He said "do whatever will make it work fastest now" on the day of the conference.
- **Verification before claiming done**. He noticed the CSV format issue post-event and asked for it to be fixed — so test your CSV/forms/whatever before declaring victory.

He'll appreciate:
- Plan-mode-first when scope is real
- Brainstorming with clear options + a recommendation
- Honoring the brand brief instead of re-inventing
- Cleaning up after yourself (commits, .gitignore, documenting)
- Direct yes/no answers when he asks "can we do X" — not pages of caveats

He'll dislike:
- Glazing or excessive enthusiasm
- Re-asking decisions he's already made
- Suggesting framework migrations when not asked
- Wasted context on trivia

---

## Final checklist before opening with the user

- [ ] Read the brand brief (`/home/phoenix/Downloads/Smile_NOLA_Website_and_Forms_Brand_Brief_for_OpenCode.md`)
- [ ] Read the booth spec (`docs/superpowers/specs/2026-05-09-smile-nola-intake-form-design.md`)
- [ ] Skim `apps/intake/app/globals.css` for the brand tokens
- [ ] Inspect `apps/intake/public/logos/` to know what artwork exists
- [ ] Note that `apps/intake/` is in production — don't touch it
- [ ] Invoke the `brainstorming` skill
- [ ] Open with the scope/MVP question above
- [ ] Ask one question at a time
- [ ] Get user approval before writing any code, even scaffolding

Welcome to the project. Build something the user is proud to send.
