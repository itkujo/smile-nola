# Booth deployment guide

The booth is a single Docker container that serves the iPad lead-capture form on the venue LAN and syncs captured rows back to `smile-nola.com` whenever the host has internet.

This doc covers running the published image on three targets:
1. **Raspberry Pi (3B, 4, 5)** — the canonical production target.
2. **Linux laptop / desktop** — what we use for development and as a backup booth.
3. **macOS** — fallback for events where a Mac is the only available host.

The image is published at `ghcr.io/itkujo/smile-nola-booth` and is multi-arch (`linux/amd64`, `linux/arm64`). Pull is the same command on every host.

---

## TL;DR

```sh
docker run -d \
  --name smile-nola-booth \
  -p 3000:3000 \
  -v smile_nola_booth_data:/data \
  --env-file ~/smile-nola-booth.env \
  --restart unless-stopped \
  ghcr.io/itkujo/smile-nola-booth:latest
```

Open `http://<host-ip>:3000` on the iPad. Done.

What you need before that: a `.env` file with the booth's secrets. See [Environment](#environment) below.

---

## Raspberry Pi (3B / 4 / 5) — the canonical path

### 1. Flash the OS

Use **Raspberry Pi OS Lite 64-bit (Bookworm)**. The Lite variant is headless (no desktop) which is exactly what we want.

Use the official **Raspberry Pi Imager**:
1. Pick "Raspberry Pi OS (other)" → "Raspberry Pi OS Lite (64-bit)".
2. Click the gear icon and set:
   - Hostname: `smile-nola-booth` (or whatever you want)
   - Enable SSH: yes, with public key
   - Set your Wi-Fi SSID + password
   - Set username + password
   - Set locale + timezone
3. Write to the SD card, boot the Pi.

After ~60s the Pi joins your Wi-Fi. Find it with:
```sh
ping smile-nola-booth.local
# or scan your network with: arp -a
```

SSH in:
```sh
ssh <username>@smile-nola-booth.local
```

### 2. Install Docker

The official convenience installer is the simplest correct option on Raspberry Pi OS:

```sh
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# log out and back in (or run `newgrp docker`) so the group change takes
exit
ssh <username>@smile-nola-booth.local
docker run hello-world  # should succeed without sudo
```

### 3. Create the `.env`

Make a directory for the booth's runtime config:

```sh
mkdir -p ~/smile-nola-booth
cd ~/smile-nola-booth
nano .env
```

Paste this template and fill in the values:

```sh
# Booth admin gate (the /admin page on the booth, NOT smile-nola.com/admin)
ADMIN_PASSWORD=<pick a strong password>
ADMIN_SESSION_SECRET=<run `openssl rand -hex 32` and paste the output>

# Sync to smile-nola.com — get this token from Coolify (INTAKE_SYNC_TOKEN
# on the marketing-site app). Same value used by the hosted expo deploy.
INTAKE_SYNC_TOKEN=<the production token>
INTAKE_SYNC_URL=https://smile-nola.com/api/sync/inquiries
INTAKE_SYNC_INTERVAL=30000

# Google Places autocomplete for venue field (optional but recommended).
# Without it the venue field falls back to plain text — capture still works.
# Use a key restricted to the Places API with a low daily quota.
GOOGLE_PLACES_API_KEY=<your booth's Places API key>
```

Lock the file:

```sh
chmod 600 .env
```

### 4. Pull the image and start the booth

```sh
docker pull ghcr.io/itkujo/smile-nola-booth:latest

docker run -d \
  --name smile-nola-booth \
  -p 3000:3000 \
  -v smile_nola_booth_data:/data \
  --env-file ~/smile-nola-booth/.env \
  --restart unless-stopped \
  ghcr.io/itkujo/smile-nola-booth:latest
```

Wait ~30 seconds for the container to warm up (Next.js cold-start on the Pi 3B is the slow case). Then verify:

```sh
curl -s http://localhost:3000/api/health
```

Expected:
```json
{"ok":true,"db":"ok","pending":0,"lastSync":null}
```

If `db` says anything other than `ok`, the SQLite native binary is unhappy. Check the logs (`docker logs smile-nola-booth`) and file an issue — the Dockerfile is supposed to have already fixed this case (the fcntl64 musl-vs-glibc bug).

### 5. Open it on the iPad

Find the Pi's LAN IP:

```sh
hostname -I | awk '{print $1}'
# e.g. 192.168.1.42
```

On the iPad (joined to the same Wi-Fi), open Safari and go to `http://192.168.1.42:3000`. The intake form should appear.

If you have `qrencode` installed (`sudo apt install -y qrencode`), the booth's start script prints an ASCII QR code that the iPad camera can scan to open the URL. See `scripts/` in the repo.

### 6. Auto-start on boot

`--restart unless-stopped` (in the `docker run` above) handles container crashes and host reboots. The Docker daemon itself is enabled by default on Raspberry Pi OS, so the Pi powering up → booth running takes ~45s with no human intervention.

To verify after a reboot:

```sh
sudo reboot
# wait for the Pi to come back, SSH in
docker ps
# smile-nola-booth should be Up
```

### 7. Pi 3B-specific notes (1 GB RAM constraint)

The Pi 3B has 1 GB RAM total. Next.js 15 + better-sqlite3 idles around 200 MB resident, leaving ~600 MB of headroom on Raspberry Pi OS Lite. This is comfortable for a single iPad submitting a few leads per minute. It is **not** comfortable for:

- Browser-based admin sessions while the booth is being hammered (close the admin tab when not in use).
- Concurrent submissions from multiple iPads (one iPad at a time is the supported pattern).
- Running anything else on the Pi (a media server, Home Assistant, etc.). Dedicate the Pi to the booth.

If you see OOMKilled events (`docker inspect smile-nola-booth | grep OOM`), upgrade to a Pi 5. There is no useful Pi 3B tuning that changes the math.

---

## Linux laptop / desktop

The laptop is what we use for development and as a backup booth at the venue.

```sh
mkdir -p ~/smile-nola-booth
cd ~/smile-nola-booth
nano .env   # paste the template from the Pi section above

docker run -d \
  --name smile-nola-booth \
  -p 3000:3000 \
  -v smile_nola_booth_data:/data \
  --env-file ~/smile-nola-booth/.env \
  --restart unless-stopped \
  ghcr.io/itkujo/smile-nola-booth:latest

# verify
curl -s http://localhost:3000/api/health
```

On a Linux desktop with KDE, you can add Start / Stop desktop entries that wrap this with a notification + QR display. Those scripts live in `apps/intake/scripts/booth-{start,stop}.sh` in this repo as reference (they're not part of the published image — they're machine-local).

## macOS

Same `docker run` as Linux. The iPad joins the same Wi-Fi and visits `http://<mac-ip>:3000`. Find the IP with:

```sh
ipconfig getifaddr en0   # or en1 if you're on USB-C ethernet
```

Docker Desktop on macOS introduces a small Linux VM under the hood; everything still works but boot time is ~5s slower than native Linux.

---

## Environment

The booth reads these environment variables at startup. Set them via `--env-file` (recommended) or `-e KEY=VALUE` flags on `docker run`.

| Var | Required | Purpose |
|---|---|---|
| `ADMIN_PASSWORD` | yes | Password for the booth's own `/admin` UI |
| `ADMIN_SESSION_SECRET` | yes | 32+ hex chars; signs admin cookies. Generate with `openssl rand -hex 32` |
| `INTAKE_SYNC_TOKEN` | for sync | Bearer token to authenticate to `smile-nola.com/api/sync/inquiries`. Get from Coolify |
| `INTAKE_SYNC_URL` | no | Defaults to `https://smile-nola.com/api/sync/inquiries` |
| `INTAKE_SYNC_INTERVAL` | no | ms between auto-drain attempts. Default `30000`. `0` disables auto-loop |
| `GOOGLE_PLACES_API_KEY` | no | Enables venue autocomplete. Without it the field falls back to plain text |
| `SMILE_NOLA_DB_DIR` | no | Where the SQLite file lives inside the container. Default `/data`. Don't change |
| `PORT` | no | Internal HTTP port. Default `3000` |

If `INTAKE_SYNC_TOKEN` is absent the booth runs fully offline and queues leads indefinitely. They'll sync the first time you set the token and restart.

---

## Persistent storage

The booth's SQLite database lives inside the Docker named volume `smile_nola_booth_data`. It survives container restarts, image upgrades, and host reboots.

### Backup

```sh
# Snapshot the volume to a tarball
docker run --rm \
  -v smile_nola_booth_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/booth-data-$(date +%Y%m%d-%H%M%S).tgz -C /data .
```

### Restore (or migrate to a new Pi)

```sh
docker volume create smile_nola_booth_data
docker run --rm \
  -v smile_nola_booth_data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/booth-data-YYYYMMDD-HHMMSS.tgz -C /data
```

### DESTROY (only after confirming everything synced)

```sh
docker stop smile-nola-booth
docker rm smile-nola-booth
docker volume rm smile_nola_booth_data
```

Don't run that last command unless `/api/health` reports `"pending":0` and you've verified the rows on `smile-nola.com/admin`.

---

## Upgrading

```sh
docker pull ghcr.io/itkujo/smile-nola-booth:latest
docker stop smile-nola-booth
docker rm smile-nola-booth
# re-run the same `docker run` command from step 4
```

The named volume persists across the rebuild. Captured leads survive.

To pin to a specific version (recommended for production):

```sh
docker pull ghcr.io/itkujo/smile-nola-booth:0.2.0
# ... and use that tag in the docker run command
```

The `:edge` tag is the latest commit on `main` and is intentionally unstable. Use `:latest` (matches the latest semver tag) or a pinned `:X.Y.Z` for shows.

---

## Troubleshooting

### Container exits immediately

```sh
docker logs smile-nola-booth
```

Most likely cause: `ADMIN_SESSION_SECRET` is missing or too short. Generate one with `openssl rand -hex 32` and put it in `.env`.

### `/api/health` returns `{"ok":false,"db":"error",...}`

The SQLite native binary failed to load. On Alpine-based images this used to be the `fcntl64` musl-vs-glibc bug. Our Dockerfile rebuilds better-sqlite3 from source against the image's libc, so this should not happen on the published image. If it does:

1. Confirm you're on the latest image: `docker images | grep smile-nola-booth`
2. Pull `:latest` and re-run.
3. If it still fails, file an issue with the output of `docker logs smile-nola-booth`.

### iPad can't reach the booth on the venue Wi-Fi

- Confirm iPad and host are on the same SSID (some venues split 2.4GHz / 5GHz networks; the Pi 3B is 2.4-only).
- Try the LAN IP directly (`http://192.168.x.y:3000`), not `.local` hostname — many venue networks block mDNS.
- Confirm no firewall on the host: `sudo ufw status` should be `inactive` (the Pi default), or `3000/tcp` allowed.

### Leads not appearing on smile-nola.com

```sh
curl -s http://localhost:3000/api/health
# look at "pending" and "lastSync"
```

- `pending > 0` and `lastSync.ok = false` → the booth tried and the server rejected. Check `lastSync.message`. Usually a bad `INTAKE_SYNC_TOKEN`.
- `pending > 0` and `lastSync = null` → the booth has never managed to reach the server. Check internet on the host.
- `pending = 0` → all rows are stamped synced. If they're not on the admin page, the server got them but something else (VSCO sync, etc.) didn't pick them up. Check the marketing-site admin UI.

### "Help, I can't find the booth's IP"

```sh
# on the host
hostname -I

# or from another machine on the same Wi-Fi
arp -a | grep -i 'smile-nola\|raspberrypi'
```

---

## Development (running from source)

Use this only when iterating on booth code. Production should pull the published image.

```sh
git clone https://github.com/itkujo/smile-nola.git
cd smile-nola
echo 'BOOTH_IMAGE=local' > .env
# add your other env vars to apps/intake/.env.local
docker compose -f docker-compose.booth.yml up -d --build
```

The compose file's `BOOTH_IMAGE=local` switch flips it from "pull from ghcr.io" to "build from `apps/intake/`". First build is ~3 minutes (better-sqlite3 native compile); subsequent builds are ~30 seconds with layer caching.

---

## What's NOT covered

- **HTTPS / TLS.** The booth speaks plain HTTP on the LAN. Don't expose port 3000 to the internet. Don't put the booth on a Wi-Fi network you don't trust.
- **Authentication on `/`.** The intake form is wide-open by design — that's the point, an iPad on the booth captures any lead that walks up. The `/admin` page IS password-gated; that's where the captured rows are visible.
- **VSCO Workspace push.** That happens server-side on `smile-nola.com`, not on the booth. The booth's only job is "capture, store, sync."
