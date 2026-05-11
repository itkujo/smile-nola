# Deploying Smile NOLA to Coolify

The marketing site (`apps/site`) ships as a single Docker container built from
`apps/site/Dockerfile` and orchestrated by the repo-root `docker-compose.yml`.
Coolify is the deploy target — it builds from this GitHub repo, manages
environment variables, owns DNS + TLS via its built-in Traefik, and persists
the SQLite database + uploaded thumbnails between deploys.

This guide assumes you already have:

- A running Coolify server (4.x or newer)
- DNS pointed at that server (or about to be)
- GitHub access to `itkujo/smile-nola`

---

## 1. Create the application in Coolify

1. **Projects → New Resource → Public Repository** (or **Private Repository**
   if you've connected the Coolify GitHub App; private is preferred for this
   codebase).
2. Repository: `https://github.com/itkujo/smile-nola`
3. Branch: `main`
4. **Build Pack**: `Docker Compose`
5. **Docker Compose Location**: `/docker-compose.yml` (repo root, default)
6. **Base Directory**: `/` (repo root)

Coolify will read `docker-compose.yml`, see the `site` service with
`expose: 3000`, and offer to wire its proxy to that port.

---

## 2. Set the domain

In the application's **General** tab:

- **Domain**: `https://smile-nola.com`
- Optional: also add `https://www.smile-nola.com` and let Coolify handle the
  redirect (or set it up in DNS).
- **Generate Domain** is fine for staging if you don't want to point real DNS
  yet — Coolify will give you something like `smile-nola.example.coolify.app`.

Coolify auto-generates the Traefik labels for this domain on top of whatever
the compose file declares. **The compose file deliberately ships no
hostname-specific config** — Coolify owns it.

TLS: Coolify provisions a Let's Encrypt cert automatically once DNS
resolves. No manual cert config needed.

---

## 3. Set environment variables

In the application's **Environment Variables** tab. Two required, the rest
optional.

### Required

| Variable | Notes |
|---|---|
| `ADMIN_PASSWORD` | The single password gate for `/admin/*`. Pick something strong — there's no per-user auth, this is the master key. |
| `ADMIN_SESSION_SECRET` | At least 32 random bytes. Used to HMAC-sign the admin cookie. Generate with `openssl rand -hex 32` on any Unix box. |

### Optional — SMTP for inquiry email notifications

If any of these are blank the server skips SMTP and just writes inquiries to
SQLite (you'll still see them in `/admin/inquiries`).

| Variable | Example |
|---|---|
| `NOTIFY_EMAIL` | `smilenolainfo@gmail.com` |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | `smilenolainfo@gmail.com` |
| `SMTP_PASS` | Gmail App Password (NOT your account password — generate at https://myaccount.google.com/apppasswords) |

Mark `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, and `SMTP_PASS` as **Secret**
in the Coolify UI so they're masked.

---

## 4. Persistent storage

The compose file declares one bind mount:

```yaml
volumes:
  - ./data:/data
```

Inside the container, two things live there:

- `/data/leads.db` — SQLite (inquiries, portfolio items, testimonials, booth
  leads — shared schema, separate tables)
- `/data/uploads/portfolio/<id>.jpg` — admin-uploaded portfolio thumbnails
  (resized to 1280×720 by Sharp on upload)

Coolify treats this directory as a managed bind mount on the deploy server —
it survives container rebuilds and redeploys. To inspect or back up:

```sh
# On the Coolify server, find the application's resource path
ssh coolify-server
ls /data/coolify/applications/<app-id>/data
```

(Adjust path to match your Coolify install. The Coolify UI also shows the
exact host path under the application's **Storages** tab.)

To **back up** the database (recommended weekly, especially after onboarding
real client data):

```sh
# On the Coolify server, with the container running:
docker exec smile-nola-site sqlite3 /data/leads.db ".backup /tmp/leads-$(date +%F).db"
docker cp smile-nola-site:/tmp/leads-$(date +%F).db ./backups/
```

WAL files (`leads.db-wal`, `leads.db-shm`) live in the same directory and
back up alongside the main DB file.

---

## 5. Deploy

Click **Deploy** in the Coolify UI. First build takes ~3–4 minutes (native
deps for `better-sqlite3` + `sharp` compile against Alpine).

The health check (`fetch http://127.0.0.1:3000/`) needs to pass before
Coolify marks the service healthy. If it fails:

- Check the **Logs** tab — most cold-start failures are missing env vars
- The healthcheck hits the homepage, which triggers SQLite bootstrap. A
  failure here often means the volume mount didn't apply or `/data` is
  read-only.

---

## 6. First-deploy verification

In order, hitting each from a browser:

1. `https://smile-nola.com/` — homepage loads, hero cycler animates,
   collection cards render with real images.
2. `https://smile-nola.com/portfolio` — empty state on a fresh DB (no
   portfolio items yet) OR the Dyason wedding card if you migrated the dev
   SQLite over.
3. `https://smile-nola.com/about` — Daniel's portrait renders.
4. `https://smile-nola.com/contact` — form renders 7-field fast path + the
   "Want to share more?" disclosure.
5. `https://smile-nola.com/admin/login` — login with `ADMIN_PASSWORD`.
6. In admin, add a test portfolio item with a YouTube URL + PicTime URL +
   an uploaded thumbnail. Verify all three render on `/portfolio`.
7. Submit a test inquiry via `/contact`. Check `/admin/inquiries` — the
   row should be there. If SMTP is configured, the email arrives at
   `NOTIFY_EMAIL`.

---

## 7. Future deploys

Push to `main`. Coolify auto-deploys if you've enabled the GitHub webhook
(default for connected repos). Otherwise click **Deploy** in the UI.

The shipped Dockerfile is multi-stage with a pruned production image — a
typical rebuild is ~90 seconds after the first deploy (deps cache hits).

---

## What's NOT in this guide (yet)

- WordPress migration: if `smile-nola.com` is currently pointed at the old
  WordPress site, plan a DNS cutover window. There's no scheduled-cutover
  pattern here — point DNS, wait for propagation, done. Old WordPress can
  be left running in parallel until you confirm the new site is healthy.
- The booth intake (`apps/intake`) is a separate Next.js app and has its
  own deploy story. This guide is marketing site only.
- Sitemap submission to Google Search Console, social card preview testing,
  and analytics wiring are post-launch tasks. The site already ships
  structured data (LocalBusiness JSON-LD) so it'll be discoverable
  automatically.

---

## Troubleshooting

**Healthcheck fails on first deploy.** Most often a missing
`ADMIN_SESSION_SECRET`. The auth library throws at module load if it's
blank. Check `Logs` for the actual exception.

**"Item must keep either a video URL or a thumbnail" errors in admin
portfolio.** That's correct behaviour — the cross-field rule for the
photo-only items feature. Either provide a video URL OR upload a thumbnail
when adding/editing portfolio items.

**Daniel's image doesn't load.** It's committed to the repo at
`apps/site/public/images/daniel.jpg` — should ship with every build.
If it's 404'ing, check that the build context in compose is correct
(`./apps/site`) and that the Dockerfile copies `public/` into the
runtime image (it does, at line 64).

**SQLite "database is locked".** Shouldn't happen — WAL mode is enabled in
`lib/db.ts`. If it does, restart the container; WAL files in `/data` will
replay cleanly.
