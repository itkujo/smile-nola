# Smile NOLA — Booth Setup Guide

Pre-launch checklist for running the intake form at the **New Orleans Bridal & Wedding Expo** (or any future event). One Linux machine acts as the host; the iPad scans a QR to load the kiosk over the local Wi-Fi.

---

## 5-minute pre-flight (the morning of)

1. **Both devices on the same Wi-Fi.**
   - Connect the laptop and iPad to the venue Wi-Fi (or your hotspot — see "If venue Wi-Fi is hostile" below).
2. **Start the booth on the laptop.**

   ```sh
   cd ~/code/smile-nola/apps/intake
   pnpm install          # only on the very first run, or after updating
   pnpm booth            # builds if needed, then starts the server
   ```

   You'll see something like:

   ```
   Open this on your iPad (same Wi-Fi):
       http://192.168.1.42:3000
   ```

   plus a QR code in the terminal.

3. **Open it on the iPad.**
   - Aim the iPad camera at the QR. It will offer to open the URL in Safari.
   - Or tap Safari and type the URL shown above.

4. **Add to home screen (kiosk mode).**
   - Tap the **Share** icon → **Add to Home Screen** → name it "Smile NOLA" → **Add**.
   - Tap the new home-screen icon. It launches **fullscreen with no Safari chrome**.

5. **(Recommended) Lock the iPad into the form with Guided Access.**
   - On the iPad: **Settings → Accessibility → Guided Access → On**.
   - Set a passcode you'll remember.
   - Open the Smile NOLA app from the home screen.
   - Triple-click the side button → **Start**.
   - The iPad is now locked to this app. Triple-click the side button + passcode to exit.

6. **Test one submission yourself.** Confirm it appears in the admin (next section) before guests arrive.

---

## Reviewing leads (laptop only)

While the server is running:

- **Admin view (browser):** `http://localhost:3000/admin`
- **Direct CSV download:** `http://localhost:3000/api/export` (or click the gold button on the admin page)

The admin page shows everything captured today in a table with timestamp, contact info, couple, event date, setting, and which Smile NOLA collections they're interested in. Tap **Remove** twice on any row to soft-delete a test or duplicate.

The CSV is HoneyBook-friendly. Columns:

```
First Name, Last Name, Email, Phone, Project Name, Event Date,
Event Type, Source, Setting, Preferred Contact, POC Relationship,
Venue, Services Interested, Notes, Captured At
```

Import flow into HoneyBook:

1. HoneyBook → **Contacts** → **Import**.
2. Upload `smile-nola-leads-YYYY-MM-DD.csv`.
3. Map the columns (HoneyBook will auto-match First Name, Last Name, Email, Phone). Map the rest as you prefer or leave them and they'll come in as additional info on each contact.
4. Source filter: every row is tagged `Source = New Orleans Bridal and Wedding Expo`.

---

## Troubleshooting

### iPad can't reach the laptop URL

**Most common cause:** venue Wi-Fi has "client isolation" enabled (a security feature that blocks devices on the same network from seeing each other).

**Quick fixes, in order:**

1. **Use the laptop's hotspot.** Turn on the laptop's Wi-Fi hotspot from Settings, connect the iPad to that hotspot, and rerun `pnpm booth`. The QR will print a new IP.
2. **Use a phone's hotspot.** Turn on personal hotspot on your phone, connect both laptop and iPad to it, rerun the booth. (Best fallback — venue Wi-Fi rarely allows peer-to-peer.)
3. **Use a small travel router.** Plug it in and connect both devices.

### Firewall blocking port 3000

```sh
# Ubuntu / Debian
sudo ufw allow 3000/tcp
```

### Server won't start

- Check that nothing else is on port 3000: `lsof -i:3000`
- Force a clean rebuild: `BUILD=1 pnpm booth`

### Battery dies on the iPad

- Plug in a charger. The Smile NOLA app keeps the screen on while you interact, but auto-lock still applies after inactivity. Disable auto-lock for the day: **Settings → Display & Brightness → Auto-Lock → Never**.

---

## What's captured per lead

| Field                | Source                              | Required |
| -------------------- | ----------------------------------- | -------- |
| POC Name             | Step 1                              | Yes      |
| POC Email            | Step 1                              | Yes      |
| POC Phone            | Step 1                              | Yes      |
| POC Relationship     | Step 1 (chip)                       | Yes      |
| Preferred Contact    | Step 1 (chip)                       | Yes      |
| Partner 1 name       | Step 2                              | Yes      |
| Partner 2 name       | Step 2                              | No       |
| Event Date           | Step 2                              | Yes      |
| Venue Name           | Step 2                              | No       |
| Setting              | Step 3 (chip)                       | Yes      |
| Collections of interest | Step 3 (multi-select cards)      | Yes (≥1) |
| Notes                | Step 3                              | No       |
| Source               | Auto-tagged to the expo             | Auto     |
| Captured At          | Server timestamp at submission      | Auto     |

---

## End of event

1. Stop the server (Ctrl-C in the terminal running `pnpm booth`).
2. Download a final CSV (`/api/export`) — keep it as your archive.
3. Import it into HoneyBook.
4. The SQLite database (`data/leads.db` at the repo root) keeps everything if you ever want to re-export.
