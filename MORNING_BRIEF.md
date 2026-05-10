# Good morning. Here's what's ready.

## The 30-second version

The Smile NOLA conference intake form is built, tested, and ready for tomorrow's New Orleans Bridal & Wedding Expo.

To run it:

```sh
cd ~/code/smile-nola/apps/intake
pnpm booth
```

This builds (if needed), prints a QR code in your terminal, and starts the server on port 3000 bound to your LAN. Scan the QR with your iPad camera, tap to open in Safari, then **Share → Add to Home Screen** for kiosk-mode fullscreen launch.

Admin (laptop only): `http://localhost:3000/admin`
Direct CSV download: `http://localhost:3000/api/export`

Full booth setup guide: `apps/intake/BOOTH_SETUP.md`.

---

## What you'll see tomorrow

A 5-step cinematic flow on the iPad:

1. **Welcome** — full-bleed black with ambient amber glow, the Smile NOLA wordmark, Broadway "Let's design your moment.", a single gold "Begin" CTA. Tap anywhere advances.
2. **Tell us about you** — POC name, email, phone (auto-formats on blur), relationship to couple (chip), preferred contact method (chip).
3. **About the celebration** — Partner 1 (required), Partner 2 (optional), event date (uses iPad's native date picker), venue name (optional).
4. **Your vision** — Setting (Indoor / Outdoor — Covered / Outdoor — Uncovered / Not sure yet), the five Smile NOLA collections as multi-select cards (Aurora / Resonance / Visionary / Digital Atelier / Smile), free-text "anything else."
5. **Cinematic thank-you** — Holimount script reveals "Thank you, [Partner 1] & [Partner 2]" with a gold light sweep, the brand mark, and a soft note that someone will follow up within 24 hours. Auto-resets to step 1 after ~9 seconds. Tap to skip.

A thin gold Art Deco progress bar sits above the form during steps 1–3 with corner brackets and a smooth fill animation. The card itself has Art Deco brackets at all four corners. Field underlines glow gold on focus. Selected chips fill gold with a subtle amber glow. Selected collection cards get gold borders + inner glow + check.

All motion is compositor-only (transform/opacity), so it'll be buttery on the iPad. `prefers-reduced-motion` is honored.

---

## What it captures

Every submission lands in a local SQLite database at `data/leads.db` (outside the app folder, gitignored). Each row gets a server timestamp and is auto-tagged `Source = "New Orleans Bridal and Wedding Expo"`.

| Field | Required |
|---|---|
| POC name | Yes |
| POC email | Yes |
| POC phone | Yes |
| POC relationship to couple | Yes |
| Preferred contact method | Yes |
| Partner 1 name | Yes |
| Partner 2 name | No |
| Event date | Yes |
| Venue name | No |
| Setting | Yes |
| Collections of interest (multi) | Yes (≥1) |
| Notes | No |

Validation runs on the client (react-hook-form + Zod) and again on the server with the same schema. You can't submit garbage.

---

## How to get the data into HoneyBook

While the booth is running, on your laptop browser:

1. Visit `http://localhost:3000/admin`. You'll see every lead in a table with timestamp, contact, couple, event date, setting, and collection chips. You can soft-delete test or duplicate entries (tap "Remove" twice).
2. Click the gold "Download HoneyBook CSV" button. A file like `smile-nola-leads-2026-05-09.csv` downloads.
3. In HoneyBook → Contacts → Import → upload the CSV. First Name / Last Name / Email / Phone auto-map. Map (or pass through) the rest.
4. Every row is tagged `Source = New Orleans Bridal and Wedding Expo` so you can filter post-import.

---

## What I'd flag for you to look at when you have time

1. **Logo artwork.** Right now the wordmark is a tasteful Broadway-only typographic stand-in (`components/brand/LogoMark.tsx`). When you have the official gold script logo file, drop it in `public/logo-gold.svg` (or `.png`) and I'll swap the component. It's a one-line change.

2. **HoneyBook CSV column names.** I mapped to standard HoneyBook contact import field names, but you should do one test import tomorrow morning *before* the expo opens — submit one fake lead, download the CSV, run an import, confirm everything maps. If HoneyBook's column names have shifted recently, only `apps/intake/lib/csv.ts` needs editing.

3. **Conference Wi-Fi can be hostile.** Many event venues enable "client isolation" (laptop and iPad on the same Wi-Fi can't see each other). The setup guide has a full troubleshooting section, but the safest backup is **your phone's hotspot** — connect both laptop and iPad to your phone's hotspot, run `pnpm booth`, scan the new QR. Bring a charger for your phone.

4. **iPad auto-lock.** Set Settings → Display & Brightness → Auto-Lock → Never for the day so the screen doesn't go dark mid-conversation.

5. **Guided Access (recommended).** Once the form is open on the iPad, triple-click the side button → Start to lock the iPad into the form. Triple-click + passcode to exit. Prevents curious guests from poking around the iPad.

---

## File map (quick orientation)

```
smile-nola/
├── README.md
├── BOOTH_SETUP.md ← morning-of checklist        (in apps/intake/)
├── docs/superpowers/specs/2026-05-09-…design.md ← what we agreed
└── apps/intake/
    ├── app/
    │   ├── page.tsx                ← the form
    │   ├── admin/page.tsx          ← lead review + CSV download
    │   └── api/                    ← submit / export / leads CRUD
    ├── components/
    │   ├── form/                   ← IntakeForm, steps, fields
    │   └── brand/                  ← logo, deco corners, divider
    ├── lib/
    │   ├── schema.ts               ← single source of truth
    │   ├── db.ts                   ← SQLite
    │   ├── csv.ts                  ← HoneyBook export
    │   └── motion.ts               ← Framer Motion presets
    ├── public/fonts/               ← Holimount, Broadway
    ├── scripts/start-booth.sh      ← LAN launcher with QR
    ├── BOOTH_SETUP.md
    └── package.json                ← `pnpm booth` is the magic word
```

---

## Tested

I ran a full end-to-end smoke test with the production build:
- All routes render (200 status): `/`, `/admin`, `/api/submit`, `/api/export`, `/api/leads`, `/api/leads/:id`
- All static assets serve (200): manifest, all icons, both fonts (Holimount.otf, Broadway.ttf)
- Valid POSTs create rows and return JSON success
- Invalid POSTs return Zod field errors per field
- Empty optional fields (no Partner 2, no venue, no notes) handled — coerced to NULL in DB, empty cells in CSV
- CSV escaping verified with commas + double-quotes in note text (RFC 4180 + UTF-8 BOM for Excel)
- Soft-delete works
- Admin shows leads, download button works
- TypeScript clean (`pnpm typecheck`)
- Production build clean (`pnpm build`)
- Test data cleared — DB is empty, ready for tomorrow

---

## If something goes wrong tomorrow

The form's data path is dead simple: file system, SQLite, CSV. Even if the app crashes mid-event, the database file at `~/code/smile-nola/data/leads.db` has every captured lead — restart the booth and they're still there. You can also extract them with any SQLite tool if you ever need to.

Sleep well.
