# Smile NOLA — Booth Setup Guide

How to run the expo kiosk at the **New Orleans Bridal & Wedding Expo** (or any future event).

The booth is **not a separate app**. It is the same site image as smile-nola.com, started in *booth mode* on a laptop (or a Pi / ZimaBlade). The kiosk lives at `/booth`; the laptop keeps its own `leads.db`, and a sync loop pushes captured leads to the production site whenever the laptop is online. Wi-Fi at an expo is bad, so nothing about capturing a lead needs the internet.

```
iPad  --Wi-Fi-->  booth laptop (this image, SMILE_NOLA_MODE=booth)
                    |  /booth                  the kiosk
                    |  /admin/booth            leads, sync status, Drain now
                    |  ./data/leads.db         the booth's own database
                    '--> https://smile-nola.com/api/v1/sync/inquiries   (when online, with a write:sync token)
```

---

## One-time setup

### 1. Make a sync token on the production site

1. Sign in to `https://smile-nola.com/admin` and open **API tokens** (`/admin/tokens`).
2. Label it `booth laptop`. Tick **write** on the `sync` row and nothing else.
3. Copy the `sn_...` token. It is shown once; only a hash is kept.

To cut a lost laptop off, revoke that token on the same page. One token per booth machine makes that painless.

### 2. Configure the booth

```sh
cp apps/site/.env.booth.example apps/site/.env.booth
```

Fill in `apps/site/.env.booth`:

| Variable | What it is |
| --- | --- |
| `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` | Guard this booth's own `/admin`. Any password; secret from `openssl rand -hex 32`. |
| `BOOTH_PROD_API_URL` | Origin of the prod site, `https://smile-nola.com`. |
| `BOOTH_PROD_API_TOKEN` | The `sn_...` token from step 1. |
| `BOOTH_SYNC_INTERVAL_MS` | Milliseconds between automatic drains. Default `30000`. `0` = only when you press **Drain now**. |
| `GOOGLE_PLACES_API_KEY` | Optional. Without it the venue field is plain text. |

`SMILE_NOLA_MODE=booth` is set by `docker-compose.booth.yml`; you do not set it yourself.

### 3. Start it

```sh
./scripts/booth-start.sh      # or: docker compose -f docker-compose.booth.yml up -d
```

The first start pulls `ghcr.io/itkujo/smile-nola/booth:latest` (about a minute); later starts take seconds. The script prints the iPad URL and a QR code. To run a local build instead of the published image: `BOOTH_IMAGE=local docker compose -f docker-compose.booth.yml up -d --build`.

The sync loop starts on the first request after boot (Astro has no start hook); the container healthcheck makes that happen within seconds, so you do not need to do anything.

---

## 5-minute pre-flight (the morning of)

1. **Both devices on the same Wi-Fi.** Laptop and iPad on the venue Wi-Fi, or your hotspot (see "If venue Wi-Fi is hostile").
2. **Start the booth** (`./scripts/booth-start.sh`).
3. **Open it on the iPad.** Scan the QR, or type `http://<laptop-ip>:3000/booth` in Safari.
4. **Add to home screen (kiosk mode).** Share, **Add to Home Screen**, name it "Smile NOLA", **Add**. The new icon launches fullscreen with no Safari chrome.
5. **(Recommended) Lock the iPad with Guided Access.** Settings, Accessibility, Guided Access, On; set a passcode; open the app; triple-click the side button, **Start**. Triple-click and the passcode to exit.
6. **Test one submission yourself.** Open `http://localhost:3000/admin/booth` on the laptop and confirm it appears, then delete it with **Delete** before guests arrive.
7. **Check the sync panel** on `/admin/booth`. With the laptop online, **Waiting for prod** should drop to 0 within one interval (or press **Drain now**). Delete test rows *before* they sync, because deleting on the booth does not remove them from prod.

The kiosk has a Standard / Large text toggle in its top-left corner for the attendant. It resets itself to the welcome screen after 3 idle minutes, and after each thank-you.

---

## Reviewing leads (laptop only)

While the booth is running, sign in at `http://localhost:3000/admin` and open **Booth**:

- every capture, newest first, with a **waiting** / **synced** marker and a **Delete** button (soft delete: the row stays in the database but leaves the list, the export and the sync);
- **Export CSV**, a HoneyBook-importable file of all live booth rows (same columns as the main site's inquiry export);
- **Sync**: mode, rows waiting, rows synced, the prod target, the auto-drain interval, the last run's result, and **Drain now**.

The same things are available as API operations (tag `booth` on `/developers`), if you want to script them with a token holding `read:booth` / `write:booth`:

| Operation | Needs |
| --- | --- |
| `POST /api/v1/booth/inquiries` (what the kiosk calls) | nothing; rate limited per address |
| `GET /api/v1/booth/inquiries` (paged) | `read:booth` |
| `DELETE /api/v1/booth/inquiries/{id}` | `write:booth` |
| `GET /api/v1/booth/export.csv` | `read:booth` |
| `GET /api/v1/booth/sync/status` | `read:booth` |
| `POST /api/v1/booth/sync/drain` | `write:booth` |

### Importing into HoneyBook

1. Export the CSV from `/admin/booth` (or from prod's `/admin/inquiries` once synced).
2. HoneyBook, **Contacts**, **Import**, upload the file.
3. HoneyBook auto-matches First Name, Last Name, Email and Phone. Map the rest or leave them as additional info.
4. Booth rows have `Source = booth-expo`.

---

## How the sync works

- Each lead gets a random `external_uuid` when it is captured. That UUID, not the row id, identifies it across machines.
- Every `BOOTH_SYNC_INTERVAL_MS` the booth sends unsynced, undeleted rows (50 at a time) to `BOOTH_PROD_API_URL/api/v1/sync/inquiries` as `{ "inquiries": [...] }` with `Authorization: Bearer <BOOTH_PROD_API_TOKEN>`.
- Prod upserts on `external_uuid`, so resending is harmless. For each row it acknowledges, the booth stamps `synced_at`.
- If the network is down or prod answers an error, nothing is lost. The rows stay pending and the next tick retries. If prod rejects a batch as invalid, the booth resends it row by row so one bad row cannot block the rest.
- A server that is **not** in booth mode (like prod) never runs the loop and refuses **Drain now**.

---

## Troubleshooting

### Rows stay "waiting"

Open `/admin/booth`, Sync panel, and read **Last run**:

- `network error` - the laptop cannot reach `BOOTH_PROD_API_URL`. Check Wi-Fi; it retries by itself.
- `prod returned 401` - the token is wrong, revoked or expired. Make a new one (step 1) and update `.env.booth`, then `docker compose -f docker-compose.booth.yml up -d`.
- `prod returned 403` - the token lacks `write:sync`.
- `BOOTH_PROD_API_URL / BOOTH_PROD_API_TOKEN not set` - fill them in `.env.booth`.

### iPad can't reach the laptop URL

**Most common cause:** the venue Wi-Fi has "client isolation" on, which blocks devices from seeing each other.

1. **Use the laptop's hotspot.** Connect the iPad to it and re-run `./scripts/booth-start.sh` (the QR prints the new IP).
2. **Use a phone hotspot** for both devices (best fallback).
3. **Use a small travel router.**

### Firewall blocking port 3000

```sh
# Ubuntu / Debian
sudo ufw allow 3000/tcp
```

### Container won't start

- `docker compose -f docker-compose.booth.yml logs booth`
- Port 3000 taken? `lsof -i:3000`
- "unable to open database file": the `./data` directory is not writable by the container user. `sudo chown -R 100:101 ./data`.
- Compose says `env file ... not found`: do step 2.

### Battery dies on the iPad

Plug in a charger and set **Settings, Display & Brightness, Auto-Lock, Never** for the day.

---

## What's captured per lead

| Field | Source | Required |
| --- | --- | --- |
| POC Name | Step 1 | Yes |
| POC Email | Step 1 | Yes |
| POC Phone | Step 1 | Yes |
| POC Relationship | Step 1 (chip) | Yes |
| Preferred Contact | Step 1 (chip) | Yes |
| Partner 1 name | Step 2 | Yes |
| Partner 2 name | Step 2 | No |
| Event Date | Step 2 | Yes |
| Venue (name + address when picked from suggestions) | Step 2 | No |
| Setting | Step 3 (chip) | Yes |
| Collections of interest | Step 3 (multi-select cards) | Yes (at least 1) |
| Notes | Step 3 | No |
| Source | Auto: `booth-expo` | Auto |
| External UUID | Auto: random per lead | Auto |
| Captured At | Server timestamp | Auto |

---

## End of event

1. On `/admin/booth`, press **Drain now** and wait for **Waiting for prod** to reach 0. (If the venue Wi-Fi is hopeless, drain from home Wi-Fi; the rows are safe in `./data/leads.db`.)
2. Export a final CSV as your archive.
3. Stop the booth (`./scripts/booth-stop.sh`, or `docker compose -f docker-compose.booth.yml down`). `./data` is left alone.
4. Import the CSV into HoneyBook, or work the synced rows on prod at `/admin/inquiries`.
5. Revoke the booth's sync token on prod if the laptop is not going to be used again soon.
