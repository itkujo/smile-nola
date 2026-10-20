# Smile NOLA

Luxury event experience brand — websites, forms, and digital touchpoints.

## Apps

- **`apps/site`** — The whole product: marketing site, package builder, admin,
  the `/api/v1` API, and the expo booth kiosk (Astro 7 SSR + Node adapter,
  SQLite via `better-sqlite3`, Tailwind 4, React 18 islands).
  - `/booth` is the iPad kiosk for events (Welcome, POC, Celebration, Dream,
    Thank-you).
  - `/admin/booth` lists booth captures, exports CSV, and shows sync status.
  - Booth operations live under `/api/v1/booth/*` (tag `booth` on
    `/developers`).

There is no separate booth app. The booth is **the same image in booth mode**:
`SMILE_NOLA_MODE=booth` on a laptop gives it its own `leads.db` and a sync loop
that pushes booth inquiries to the production site's
`/api/v1/sync/inquiries` with a `write:sync` API token. Details:
[`docs/BOOTH_SETUP.md`](docs/BOOTH_SETUP.md).

## Quick start — marketing site

```sh
cd apps/site
pnpm install
pnpm dev          # http://localhost:4321
```

Admin: `http://localhost:4321/admin/login` — see `.env.example` for the
default dev password.

## Quick start — booth kiosk

Locally, the kiosk is just a page of the site:

```sh
cd apps/site
pnpm dev          # http://localhost:4321/booth
```

To run a real booth (laptop or Pi, Docker, own database, sync to prod):

```sh
cp apps/site/.env.booth.example apps/site/.env.booth   # fill in
./scripts/booth-start.sh          # or: docker compose -f docker-compose.booth.yml up -d
```

See [`docs/BOOTH_SETUP.md`](docs/BOOTH_SETUP.md) for the sync token, iPad kiosk
setup and troubleshooting.

## Deployment

The site deploys to a Coolify server via the root `docker-compose.yml`.
Full walkthrough: [**`DEPLOY.md`**](DEPLOY.md). Booth machines run the same
image from `ghcr.io/itkujo/smile-nola/booth`, built by
`.github/workflows/booth-release.yml` whenever `apps/site/**` changes on main.

## Brand

Brand brief and design tokens live under [`docs/`](docs/).
