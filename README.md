# Smile NOLA

Luxury event experience brand — websites, forms, and digital touchpoints.

## Apps

- **`apps/site`** — Marketing site (Astro 5 SSR + Node adapter, SQLite via
  `better-sqlite3`, Tailwind 4). Public collection pages, inquiry forms,
  portfolio with PicTime/YouTube/Vimeo embeds, admin CMS for portfolio
  items + testimonials + inquiries.
- **`apps/intake`** — Conference / booth intake form (Next.js, kiosk-mode
  for iPad). Captures leads at events; writes to the same SQLite DB the
  marketing site reads from (`<repo>/data/leads.db`).

Both apps share `data/leads.db` (separate tables, single file). In
production they ship as separate containers; locally they can run side by
side on different ports.

## Quick start — marketing site

```sh
cd apps/site
pnpm install
pnpm dev          # http://localhost:4321
```

Admin: `http://localhost:4321/admin/login` — see `.env.example` for the
default dev password.

## Quick start — booth intake

```sh
cd apps/intake
pnpm install
pnpm dev          # http://localhost:3000
```

See [`apps/intake/BOOTH_SETUP.md`](apps/intake/BOOTH_SETUP.md) for iPad
kiosk setup.

## Deployment

Marketing site deploys to a Coolify server via the root `docker-compose.yml`.
Full walkthrough: [**`DEPLOY.md`**](DEPLOY.md).

## Brand

Brand brief and design tokens live under [`docs/`](docs/).
