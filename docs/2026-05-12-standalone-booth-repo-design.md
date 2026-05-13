# Smile NOLA Booth — Standalone Portable Repo

**Date:** 2026-05-12
**Status:** Approved design, ready for implementation plan.
**Author:** brainstorming session with @phoenix

---

## Summary

Extract the booth intake application (currently `apps/intake/` in the `smile-nola` monorepo) into its own standalone git repository at `~/code/smile-nola-booth/`, published as a multi-arch Docker image to GitHub Container Registry. The image is offline-first: it runs anywhere Docker runs (laptop, Mac, Linux box, Raspberry Pi, NAS, edge router), serves the iPad over LAN, and syncs captured leads back to `smile-nola.com/api/sync/inquiries` whenever internet is available.

The hosted booth at `expo.smile-nola.com` (which shares a SQLite file with the main site on the same Coolify host) is **not** affected. It continues running from the existing `apps/intake/` code in this repo. The two are intentional, complementary deployments of the same role:

- `expo.smile-nola.com` — always-online pop-ups (uses the venue's internet, writes directly to the shared DB).
- `ghcr.io/itkujo/smile-nola-booth:latest` — offline-capable expos (runs anywhere, queues locally, syncs when online).

## Motivation

1. **The current laptop build is broken.** Today's `docker-compose.booth.yml` was supposed to run the same image as production locally on the booth laptop. The running container's `better-sqlite3` native binary throws `Error relocating ... fcntl64: symbol not found` because the prebuilt binary expects GLIBC and Alpine 3.23+'s musl dropped that symbol. A fix is already drafted in the uncommitted `feature/booth-laptop-docker` branch (pin Alpine 3.22, rebuild better-sqlite3 from source). Rather than ship that fix into the existing tangled compose setup, we use this as the moment to do the cleaner thing.
2. **The "booth" and "marketing site" are conceptually unrelated.** They share a repo today only because they happened to be built at the same time. The booth has no code dependency on the site; the site has zero runtime dependency on the booth (only documentation comments referencing schema alignment).
3. **Portability is a stated requirement.** The booth needs to run on whatever hardware is at the venue: a laptop, a Mac mini, a Raspberry Pi, eventually maybe a Peplink router. A self-contained Docker image distributed via ghcr.io is the universal contract for "runs anywhere."
4. **Independent release cadence.** The marketing site changes often (copy, package builder, admin features). The booth ideally changes rarely — once it works at one event, you want the same version at the next event. Separate repos = separate releases = no accidental booth regressions from site work.

## Non-goals

- Rewriting the booth in another framework. It's Next.js 15, it works, we're relocating not redesigning.
- Changing the form UX, the schema, or the admin UI.
- Bidirectional sync. Booth → site only.
- Peplink-specific runtime testing. Documented as "should work on routers that support standard Docker" but not gated on actual device validation.
- Touching `apps/intake/` in this repo before the new repo is proven. The hosted expo deploy must keep working throughout the migration.
- Building from this repo's monorepo tooling. The new repo is its own pnpm project at the root.

## Architecture

### Repo layout (new repo at `~/code/smile-nola-booth/`)

```
smile-nola-booth/
├── app/                       (Next.js 15 app routes — copied from apps/intake/app/)
├── components/                (copied from apps/intake/components/)
├── lib/                       (copied from apps/intake/lib/)
├── public/                    (copied from apps/intake/public/)
├── styles/                    (copied from apps/intake/styles/)
├── middleware.ts              (copied)
├── next.config.ts             (copied)
├── tsconfig.json              (copied, paths verified)
├── postcss.config.mjs         (copied)
├── package.json               (renamed: name → "smile-nola-booth", no @smile-nola/* scope)
├── pnpm-lock.yaml             (copied from apps/intake/, then `pnpm install` to verify)
├── .env.example               (every env var documented inline)
├── .gitignore
├── .dockerignore
├── Dockerfile                 (the multi-stage Alpine 3.22 build with the fcntl64 fix)
├── docker-compose.yml         (single-service compose for users who want it)
├── scripts/
│   ├── start.sh               (Linux/Mac desktop launcher, prints QR + LAN URL)
│   └── stop.sh                (clean shutdown, warns about unsynced rows)
├── .github/
│   └── workflows/
│       └── release.yml        (multi-arch build + push to ghcr.io on tag)
├── README.md                  (the one doc people actually read — install, run, sync, troubleshoot)
└── docs/
    ├── architecture.md
    ├── deploying.md
    └── sync-protocol.md
```

Crucially, the Next.js app sits at the **repo root**, not under `apps/intake/`. The build context is the whole repo. Path aliases (`@/components/...`) work unchanged because they were already self-contained.

### Removed during extraction

These files from `apps/intake/` don't make sense in the standalone repo:

- `BOOTH_SETUP.md` → replaced by the new `README.md` (which is now the primary doc, not a footnote).
- `tsconfig.tsbuildinfo` → build artifact, never committed anywhere.
- `scripts/start-booth.sh` → consolidated into the new `scripts/start.sh`.
- Any pnpm workspace references (verified to be none — `apps/intake/package.json` is a leaf, no `workspace:*` deps).

### Container image

**Base:** `node:22-alpine3.22`. Pinned to 3.22 with an explanatory comment because Alpine 3.23+'s musl drops the `fcntl64` symbol that prebuilt `better-sqlite3` expects (`Error relocating ... fcntl64: symbol not found`). The fix already lives in the uncommitted Dockerfile diff on `feature/booth-laptop-docker` — we copy it verbatim into the new repo's initial commit.

**Three stages:**

```
deps     → apk add python3 make g++ libc6-compat
           pnpm install --frozen-lockfile
           rm -rf better-sqlite3/build better-sqlite3/prebuilds
           node-gyp rebuild --release       ← force compile against THIS musl
build    → pnpm build                       ← Next.js standalone output
runtime  → apk add libc6-compat tini
           copy standalone artifacts as unprivileged `app` user
           ENTRYPOINT tini → CMD node ./server.js
```

**Multi-arch:** built for `linux/amd64` and `linux/arm64` via `docker buildx` in GitHub Actions. One manifest at `ghcr.io/itkujo/smile-nola-booth:<tag>`; Docker pulls the right architecture automatically.

**ARM 32-bit (Pi 3, Pi Zero W) is not built.** Node 22 ARMv7 prebuilts are incomplete and the user said "I want it to be like any other docker container out there" — that universe is amd64 + arm64. Adding armv7 can happen later if a real device demands it.

**Image size budget:** ~200MB compressed. Next.js standalone + Alpine should land us here. If we end up materially bigger (>300MB), revisit the runtime stage.

**Tags published per release:**

- `:latest` — newest stable release
- `:1.2.3` — semver, immutable
- `:1.2` and `:1` — rolling minor/major pointers
- `:sha-<short>` — commit-pinned for debugging
- `:edge` — built on every `main` push (unstable)

### Running it

The promise: anyone with Docker can run the booth in one command.

```bash
docker run -d \
  --name smile-nola-booth \
  -p 3000:3000 \
  -v booth-data:/data \
  -e ADMIN_PASSWORD=changeme \
  -e ADMIN_SESSION_SECRET=$(openssl rand -hex 32) \
  -e INTAKE_SYNC_TOKEN=<token-from-smile-nola.com> \
  --restart unless-stopped \
  ghcr.io/itkujo/smile-nola-booth:latest
```

Open `http://<host-ip>:3000` on the iPad. Admin at `/admin`. Done.

The repo also ships a `docker-compose.yml` for users who prefer it (env-file based, easier to read):

```yaml
services:
  booth:
    image: ghcr.io/itkujo/smile-nola-booth:latest
    container_name: smile-nola-booth
    ports: ["3000:3000"]
    volumes: [booth-data:/data]
    env_file: .env
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 25s
volumes:
  booth-data: {}
```

The `start.sh` / `stop.sh` desktop launchers from the current repo carry over with minor edits (path roots change, branding stays).

### Healthcheck

Today's healthcheck hits `/` — but `/` is a static-ish render that passes even when the DB is broken (which is exactly what hid the `fcntl64` bug). The new repo adds a tiny `GET /api/health` endpoint that runs a trivial `SELECT 1` against SQLite. A 200 means the entire write path is alive; anything else fails the healthcheck and forces a container restart.

### Configuration (env contract)

| Var | Required | Default | Purpose |
|---|---|---|---|
| `ADMIN_PASSWORD` | yes | — | Gates `/admin` and authenticated API routes |
| `ADMIN_SESSION_SECRET` | yes | — | Signs admin cookies. 32+ random bytes (`openssl rand -hex 32`) |
| `INTAKE_SYNC_TOKEN` | for sync only | — | Bearer the booth presents when posting to the main site |
| `INTAKE_SYNC_URL` | no | `https://smile-nola.com/api/sync/inquiries` | Sync target |
| `INTAKE_SYNC_INTERVAL` | no | `30000` | ms between sync attempts. `0` disables auto-drain (manual flush only) |
| `PORT` | no | `3000` | Internal container port |
| `SMILE_NOLA_DB_DIR` | no | `/data` | Where to put `booth.db`. Mounted from a volume |
| `BOOTH_ID` | no | auto-generated UUID stored in `/data/booth-id` | Identifies this physical booth in sync payloads |

`BOOTH_ID` is new. The hosted expo doesn't need it (one deployment, no ambiguity). A fleet of portable booths does — without it, the main site can't tell which physical machine sent which leads, which matters if you ever run two booths at the same event.

If `INTAKE_SYNC_TOKEN` is missing, the booth runs fully — it just queues leads forever in the local DB. Valid mode for "completely offline event, I'll sync later from a different machine that has the token."

### Data & sync

**Storage:** SQLite at `${SMILE_NOLA_DB_DIR}/booth.db` (default `/data/booth.db`).

The file is renamed from `leads.db` to `booth.db` to remove a footgun: the main site's `leads.db` is a richer schema (inquiries, portfolio, testimonials, package builder submissions). The standalone booth only knows about its own inquiry rows. Different filename = no risk of someone copying the wrong file in either direction.

**Schema:** same single-table model the booth uses today (`leads` table with the form fields + `synced_at`, `remote_id`, etc.). No migrations from the old shared `leads.db` because the standalone booth always starts empty on a new install.

**Sync drainer** (logic ported verbatim from `apps/intake/lib/sync.ts`):

1. Background loop wakes every `INTAKE_SYNC_INTERVAL` ms.
2. Selects rows with `synced_at IS NULL AND sync_error IS NULL`.
3. POSTs as a batch (up to 50 rows per request) to `INTAKE_SYNC_URL` with `Authorization: Bearer <INTAKE_SYNC_TOKEN>`.
4. On 2xx → mark each accepted row `synced_at = now()`, store the returned `remote_id`.
5. On 4xx (auth, validation) → mark row `sync_error = '<reason>'`. Surface in `/admin/sync` so a human decides. Do NOT auto-retry.
6. On 5xx, network error, or no internet → silent retry. Exponential backoff capped at 5 minutes.
7. Admin can manually drain via `POST /api/sync/drain`.
8. Admin can clear `sync_error` to retry via the `/admin` UI.

**Status visibility:** the existing `/api/sync/status` endpoint (which today returns `{pending, lastRunAt, lastError}`) stays. The admin page already renders it; that UI ports over unchanged.

### Sync protocol contract

Documented in the new repo's `docs/sync-protocol.md` so the main site team (i.e. future-you maintaining `smile-nola/`) has a written contract for what the booth promises to send.

```
POST /api/sync/inquiries HTTP/1.1
Host: smile-nola.com
Authorization: Bearer <INTAKE_SYNC_TOKEN>
Content-Type: application/json

{
  "source": "booth-standalone",
  "booth_id": "<UUID assigned once per install>",
  "rows": [
    {
      "client_id": "<row UUID local to this booth>",
      "captured_at": "<ISO 8601>",
      // ...all current Inquiry fields...
    }
  ]
}

→ 200 OK
{
  "accepted": ["<client_id>", ...],
  "rejected": [{ "client_id": "...", "reason": "validation: ..." }, ...]
}
```

**What changes on the main site side:** the existing `/api/sync/inquiries` endpoint already accepts the booth posting with this token. The only adjustment needed is the `source` validator accepting `"booth-standalone"` in addition to `"booth-expo"`. That is the *entire* main-site code change.

### Machine-specific launchers (NOT part of the repo)

This laptop has KDE desktop icons that wrap `docker compose up/down` so a non-technical operator can start and stop the booth without a terminal. Those scripts:

- Live at `~/.local/bin/smile-nola-booth/start.sh` and `~/.local/bin/smile-nola-booth/stop.sh`.
- Are referenced by `.desktop` files under `~/.local/share/applications/` (e.g. `smile-nola-booth-start.desktop`).
- Are **not** committed to either repo. They're machine- and desktop-environment-specific (KDE `konsole`, `notify-send`, hardcoded paths, this user's home directory).
- Content is adapted from today's `apps/intake/scripts/booth-{start,stop}.sh`, but operate against the published image's `docker run` / `docker compose` invocation, not a local build:
  - `start.sh`: open konsole → `docker compose -f ~/code/smile-nola-booth/docker-compose.yml up -d` (or a `docker run` one-liner) → wait until healthy → print LAN URL + QR.
  - `stop.sh`: check pending sync queue → `docker compose -f ~/.../docker-compose.yml down` → toast notification.
- Loss tolerance: trivial to regenerate from the new repo's `README.md` after an OS reinstall. No backup obligation.

The new portable repo's own `scripts/start.sh` and `scripts/stop.sh` (which ARE committed) are generic, terminal-friendly launchers — they print the same QR/URL but don't depend on a desktop environment. The machine-local KDE versions are a polish layer on top.

This separation is intentional: the repo ships things that work anywhere. The laptop ships things that only make sense on this laptop.

### Versioning & release

- Releases are tagged `v<major>.<minor>.<patch>` in the new repo.
- `.github/workflows/release.yml` triggers on `v*` tags:
  1. Build multi-arch image (`docker buildx build --platform linux/amd64,linux/arm64`).
  2. Push to `ghcr.io/itkujo/smile-nola-booth:{X.Y.Z, X.Y, X, latest}`.
  3. Create a GitHub Release with auto-generated notes.
- Pushes to `main` (no tag) build and publish only `:edge`.
- Initial release is `v0.1.0`.

## Migration & rollout

Strict ordering so nothing in production breaks:

1. **Scaffold the new repo locally** at `~/code/smile-nola-booth/`. Copy the relevant `apps/intake/` files. Re-root the Next.js app. Drop monorepo cruft. Fix the Dockerfile. `git init` + initial commit.
2. **Local build verification.** `docker build -t smile-nola-booth:test .` → run it → submit a test lead → confirm DB write succeeds (this proves the `fcntl64` fix is real).
3. **Local sync verification.** Set `INTAKE_SYNC_URL` to staging or prod's `/api/sync/inquiries` (with the real token), trigger a manual drain, confirm the row arrives in the main site's `inquiries` table with `source='booth-standalone'`. (Requires the one-line site change: accepting that source value.)
4. **Create GitHub repo** `itkujo/smile-nola-booth` (public). Push.
5. **Tag `v0.1.0`.** CI publishes the image to ghcr.io. Confirm the package is public.
6. **Clean-machine pull test.** On a different machine (or after `docker system prune`), `docker run` the published image. Confirm it works without anything cached locally.
7. **Install the laptop-only desktop launchers.** Create `~/.local/bin/smile-nola-booth/{start.sh,stop.sh}` adapted from today's `apps/intake/scripts/booth-{start,stop}.sh`, but pointing at the new repo's compose file (or directly at the published image). Install `.desktop` entries under `~/.local/share/applications/`. Confirm the KDE desktop icons start and stop the booth cleanly.
8. **Only then** clean up this repo: delete `docker-compose.booth.yml`, delete the untracked `apps/intake/scripts/booth-{start,stop}.sh` (their content lives on at `~/.local/bin/smile-nola-booth/`, just no longer pretending to be repo files), and either commit or abandon the uncommitted Dockerfile diff on `feature/booth-laptop-docker` (its fixes have moved to the new repo). The hosted `expo.smile-nola.com` deployment is unaffected — it still uses `apps/intake/` and the prod `docker-compose.yml`.
9. **(Future, optional)** Test on a Raspberry Pi. Test on a Peplink router. Document any quirks in `docs/deploying.md`.

If steps 2 or 3 fail, the new repo isn't ready and we don't proceed. The existing setup (broken laptop booth, working hosted expo) is no worse than today.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| `fcntl64` fix doesn't actually work in the new repo's build | Step 2 of rollout proves it locally before anything else happens. If it fails we're back to debugging native compile, nothing else is touched. |
| The hosted expo and standalone booth diverge over time as separate codebases | Initial code state is identical (shared lineage; only the DB filename differs — `leads.db` vs `booth.db`). The sync protocol is the only enforced runtime contract. The two were always going to drift anyway — different deployment models, different needs. Accept and document. |
| `INTAKE_SYNC_TOKEN` leaks because more people now run booth instances | Token is per-deployment (a new portable booth can be issued a new token), and the main site can revoke and re-issue. Token gates only the inquiry sync endpoint, not full site admin. Acceptable blast radius. |
| Multi-arch ARM build fails or is slow in CI | Use `docker buildx` with QEMU emulation (standard pattern). If arm64 builds become painful, fall back to amd64-only initially and add arm64 in a follow-up release. |
| Someone clones the booth repo expecting it to also serve the marketing site | README leads with "this is the offline booth, the marketing site lives at github.com/itkujo/smile-nola." Clear. |
| Peplink turns out not to support this image at all | Documented as untested. Stretch goal. No design constraint accepted today on its behalf. |

## Decisions log

Decisions made during brainstorming, captured here for posterity:

- **Separate repo, not separate folder in this repo.** User wanted clean independence; YAGNI doesn't apply to org boundaries.
- **Multi-arch amd64 + arm64.** Universal Docker target without overinvesting in 32-bit ARM.
- **Keep posting to `/api/sync/inquiries`.** Don't introduce a new versioned API on the main site; the existing endpoint already does the job.
- **Hosted `expo.smile-nola.com` stays as-is.** It serves a different need (always-online pop-ups, zero sync latency). Two flavors of booth, one role.
- **Generic Docker, not Peplink-constrained.** Designing strictly for BR2 Pro's envelope would require dropping Next.js. Not worth it for hardware we can't test on.
- **ghcr.io public.** No Docker Hub rate limits, no login required to pull, lives next to the source.
- **Image is safe to publish publicly.** All secrets are runtime env, nothing sensitive baked into layers.

## Open questions

None blocking. The following can be answered during implementation:

- Exact `client_id` format on the booth side (UUID v4 is fine; flag if there's a reason to prefer something else).
- Whether the new `/api/health` endpoint should also report sync queue depth (probably yes — cheap and useful for monitoring).
- README screenshots vs. plain text (start with text, add screenshots once the UI is stable in the standalone repo).
