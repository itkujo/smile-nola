# Standalone Booth Repo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `apps/intake/` from the `smile-nola` monorepo into a standalone repo at `~/code/smile-nola-booth/` published as a multi-arch Docker image on ghcr.io, runnable on any Docker host (laptop, Mac, Pi, NAS), offline-first, syncing to `smile-nola.com/api/sync/inquiries` when online.

**Architecture:** Net-new repo with Next.js 15 at the root (not nested). Multi-stage Dockerfile pinned to Alpine 3.22 with better-sqlite3 rebuilt from source (fixes the `fcntl64` bug). Local SQLite at `/data/booth.db` (renamed from `leads.db` to disambiguate from the main site). Sync logic ported verbatim — wire format unchanged so zero main-site changes are needed for rollout. Released via GitHub Actions `docker buildx` to `linux/amd64,linux/arm64`.

**Tech Stack:** Next.js 15.1.4 · React 19 · TypeScript 5.7 · better-sqlite3 11 · Zod · Tailwind v4 · Docker · GitHub Actions · ghcr.io

**Source spec:** `docs/2026-05-12-standalone-booth-repo-design.md` (commits 952fd42, f5cc925, de4379e on `feature/booth-laptop-docker`).

---

## File Structure

### New repo (`~/code/smile-nola-booth/`) — what each file does

- `app/` (copied from `apps/intake/app/`) — Next.js app routes. API routes under `app/api/`, admin under `app/admin/`, intake form at `app/page.tsx`. **One change:** new `app/api/health/route.ts` for DB-aware liveness probe.
- `components/` (copied from `apps/intake/components/`) — Brand and form components. Unchanged.
- `lib/` (copied from `apps/intake/lib/`) — Self-contained library: `auth.ts`, `csv.ts`, `db.ts`, `motion.ts`, `schema.ts`, `sync.ts`. **One change:** `db.ts` simplified to own its schema (no shared inquiries table assumption); DB filename `booth.db`.
- `middleware.ts`, `next.config.ts`, `next-env.d.ts`, `tsconfig.json`, `postcss.config.mjs` — copied verbatim from `apps/intake/`.
- `public/` (copied) — Logos, fonts, favicons, manifest.
- `styles/` (copied) — Global Tailwind layer.
- `package.json` — Renamed from `@smile-nola/intake` → `smile-nola-booth`. Same dependencies. Adds `"docker:build"` and `"docker:run"` scripts.
- `pnpm-lock.yaml` — Copied from `apps/intake/pnpm-lock.yaml`, regenerated to verify.
- `.env.example` — Documents every env var the container reads.
- `.gitignore`, `.dockerignore` — New, scoped to this repo.
- `Dockerfile` — The Alpine 3.22 multi-stage build with the `fcntl64` fix (verbatim copy of the fixed `apps/intake/Dockerfile` on `feature/booth-laptop-docker`, paths re-rooted).
- `docker-compose.yml` — Single-service compose using the published ghcr.io image. Replaces today's `docker-compose.booth.yml` overlay pattern.
- `scripts/start.sh`, `scripts/stop.sh` — Generic (terminal-only, no `konsole`, no `notify-send`) launchers. Print LAN URL + QR.
- `.github/workflows/release.yml` — Build multi-arch image and push to ghcr.io on `v*` tag. Build `:edge` on `main`.
- `README.md` — The one doc operators actually read: install, run, sync, troubleshoot.
- `docs/architecture.md` — How the booth works internally (sync loop, DB, schema).
- `docs/deploying.md` — Running on Linux, Mac, Pi, NAS, "should work" on Peplink.
- `docs/sync-protocol.md` — The HTTP contract with `smile-nola.com/api/sync/inquiries`.

### Machine-local (NOT in any repo)

- `~/.local/bin/smile-nola-booth/start.sh`, `stop.sh` — KDE-aware launchers wrapping `docker compose`. Created from today's `apps/intake/scripts/booth-{start,stop}.sh`.
- `~/.local/share/applications/smile-nola-booth-{start,stop}.desktop` — Desktop entries pointing at the above.

### Cleanup in existing repo (`~/code/smile-nola`) — AFTER new repo proven

- Delete: `docker-compose.booth.yml`, `apps/intake/scripts/booth-start.sh`, `apps/intake/scripts/booth-stop.sh`, `apps/intake/scripts/start-booth.sh`.
- Reset uncommitted: `apps/intake/Dockerfile` and `apps/site/Dockerfile` working-tree diffs on `feature/booth-laptop-docker` are abandoned (their fixes have moved to the new repo).
- Keep untouched: `apps/intake/` source code, `docker-compose.yml`, the `expo.smile-nola.com` deploy on Coolify.

---

## Conventions for tasks below

- **Working directory** notation: `[smile-nola]` means run from `~/code/smile-nola/`. `[booth]` means run from `~/code/smile-nola-booth/`. `[local]` means run from anywhere.
- **Commit message style** matches the existing repo: `<type>(<scope>): <summary>` where type ∈ {feat, fix, docs, chore, refactor, test} and scope ∈ {booth, docker, ci, sync, …}. Example: `feat(booth): port intake source from monorepo`.
- **Why no formal test framework?** The existing `apps/intake/` codebase has zero tests today, and adding a test framework is out of scope for "relocate the codebase." Each task that touches code includes an explicit manual or `curl`-based verification step that proves the change works. This is honest verification, not skipped verification.

---

## Phase 1: Scaffold the new repo and prove the Dockerfile fix

### Task 1: Create the empty repo and copy the source tree

**Files:**
- Create: `~/code/smile-nola-booth/` (entire directory)

- [ ] **Step 1: Create the new directory and initialize git**

```bash
[local]
mkdir -p ~/code/smile-nola-booth
cd ~/code/smile-nola-booth
git init -b main
```

Expected: empty git repo on branch `main`.

- [ ] **Step 2: Copy the intake source tree into the repo root**

Copy everything from `apps/intake/` EXCEPT generated/local artifacts:

```bash
[smile-nola]
# Source: apps/intake/  →  Target: ~/code/smile-nola-booth/
rsync -av \
  --exclude='node_modules/' \
  --exclude='.next/' \
  --exclude='tsconfig.tsbuildinfo' \
  --exclude='.env.local' \
  --exclude='BOOTH_SETUP.md' \
  --exclude='scripts/booth-start.sh' \
  --exclude='scripts/booth-stop.sh' \
  --exclude='scripts/start-booth.sh' \
  apps/intake/ ~/code/smile-nola-booth/
```

Expected output lists the files copied. Verify no `node_modules/` or `.next/` in the destination:

```bash
[booth]
ls -la
ls scripts/    # should be empty (we explicitly excluded the booth-* scripts)
```

If `scripts/` exists and is empty, remove it — we'll recreate with the generic versions later:

```bash
[booth]
rmdir scripts 2>/dev/null || true
```

- [ ] **Step 3: Verify the copy is self-contained (no `@smile-nola/*` imports, no `../../` escaping the tree)**

```bash
[booth]
grep -rn "from ['\"]@smile-nola" --include='*.ts' --include='*.tsx' . | grep -v node_modules
grep -rn "from ['\"]\.\./\.\./" --include='*.ts' --include='*.tsx' . | grep -v node_modules
```

Expected: **zero output** from both commands. If anything matches, the standalone repo is not actually standalone and the task fails.

- [ ] **Step 4: Initial commit (just the carry-over, no edits yet)**

```bash
[booth]
git add -A
git commit -m "chore(booth): import source tree from smile-nola/apps/intake"
```

Expected: one commit, ~50-60 files.

---

### Task 2: Re-brand `package.json` and add Docker scripts

**Files:**
- Modify: `~/code/smile-nola-booth/package.json`

- [ ] **Step 1: Read current package.json**

```bash
[booth]
cat package.json
```

- [ ] **Step 2: Edit package.json**

Replace the file's contents with the version below. Changes from the source:
- `"name"`: `@smile-nola/intake` → `smile-nola-booth`
- `"description"`: add one
- `"repository"`, `"license"`: add
- `"scripts"`: add docker:* scripts, drop the `booth` script (moved to `scripts/start.sh` later)

```json
{
  "name": "smile-nola-booth",
  "version": "0.1.0",
  "description": "Smile NOLA offline-first booth intake. Runs anywhere Docker runs; syncs captured leads to smile-nola.com when online.",
  "private": true,
  "license": "UNLICENSED",
  "repository": {
    "type": "git",
    "url": "https://github.com/itkujo/smile-nola-booth.git"
  },
  "packageManager": "pnpm@10.33.2",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "docker:build": "docker build -t smile-nola-booth:dev .",
    "docker:run": "docker run --rm -p 3000:3000 --env-file .env smile-nola-booth:dev"
  },
  "dependencies": {
    "@hookform/resolvers": "^3.10.0",
    "better-sqlite3": "^11.7.0",
    "clsx": "^2.1.1",
    "framer-motion": "^11.15.0",
    "next": "15.1.4",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "react-hook-form": "^7.54.2",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.0.0",
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.10.5",
    "@types/react": "19.0.4",
    "@types/react-dom": "19.0.2",
    "postcss": "^8.4.49",
    "qrcode-terminal": "^0.12.0",
    "sharp": "^0.34.5",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.3"
  },
  "pnpm": {
    "onlyBuiltDependencies": [
      "better-sqlite3"
    ]
  }
}
```

- [ ] **Step 3: Install dependencies to verify the lockfile resolves**

```bash
[booth]
pnpm install
```

Expected: pnpm resolves the lockfile (or regenerates it with no version drift since we kept the exact same versions). Process exits 0. `node_modules/` populated.

If pnpm complains about the lockfile being out of sync, that's OK — let it regenerate:

```bash
[booth]
rm pnpm-lock.yaml
pnpm install
```

- [ ] **Step 4: Typecheck to verify the source is wired correctly**

```bash
[booth]
pnpm typecheck
```

Expected: `tsc --noEmit` exits 0 with no errors. If there are errors referencing paths like `apps/intake/...` or `@smile-nola/...`, the copy was incomplete — go back to Task 1.

- [ ] **Step 5: Commit**

```bash
[booth]
git add package.json pnpm-lock.yaml
git commit -m "feat(booth): rebrand package.json to smile-nola-booth"
```

---

### Task 3: Drop the shared-schema assumption in `lib/db.ts`

The existing `apps/intake/lib/db.ts` was designed to share an `inquiries` table with the marketing site. The standalone booth has no such partner, so the file is simplified: own its schema, name the file `booth.db`, keep the same exported function signatures so nothing else in the codebase needs to change.

**Files:**
- Modify: `~/code/smile-nola-booth/lib/db.ts`

- [ ] **Step 1: Read the current file**

```bash
[booth]
cat lib/db.ts
```

Note the exports — these MUST stay byte-identical for callers: `getDb`, `insertLead`, `getAllLeads`, `softDeleteLead`, `restoreLead`, `leadCount`.

- [ ] **Step 2: Replace the file with the simplified standalone version**

```ts
// lib/db.ts
import crypto from "node:crypto";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { type HydratedLead, type Lead } from "./schema";

/**
 * SQLite singleton for the standalone booth.
 *
 * Unlike the monorepo intake (which shared an `inquiries` table with the
 * marketing site), this booth OWNS its database. The schema is intentionally
 * minimal: every column the form writes, plus sync-tracking columns.
 *
 * The DB file is `booth.db` (NOT `leads.db`) so there's no confusion with
 * the main site's database if both files ever end up on the same machine.
 */

const DB_DIR = process.env.SMILE_NOLA_DB_DIR ?? path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "booth.db");

declare global {
  // eslint-disable-next-line no-var
  var __sn_db: Database.Database | undefined;
}

function open(): Database.Database {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at              TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      first_name              TEXT    NOT NULL,
      last_name               TEXT    NOT NULL DEFAULT '',
      email                   TEXT    NOT NULL,
      phone                   TEXT    NOT NULL,
      preferred_contact       TEXT,
      poc_relationship        TEXT,
      partner1_name           TEXT,
      partner2_name           TEXT,
      event_date              TEXT,
      venue                   TEXT,
      event_setting           TEXT,
      collections_interested  TEXT,
      notes                   TEXT,
      external_uuid           TEXT    NOT NULL UNIQUE,
      synced_at               TEXT,
      sync_error              TEXT,
      deleted_at              TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
    CREATE INDEX IF NOT EXISTS idx_leads_deleted_at ON leads(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_leads_synced_at  ON leads(synced_at);
  `);

  return db;
}

export function getDb(): Database.Database {
  if (!global.__sn_db) {
    global.__sn_db = open();
  }
  return global.__sn_db;
}

interface LeadRow {
  id: number;
  created_at: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  poc_relationship: string | null;
  preferred_contact: string | null;
  partner1_name: string | null;
  partner2_name: string | null;
  event_date: string | null;
  venue: string | null;
  event_setting: string | null;
  collections_interested: string | null;
  notes: string | null;
  deleted_at: string | null;
}

function rowToHydratedLead(row: LeadRow): HydratedLead {
  let collections: HydratedLead["collectionsInterested"] = [];
  if (row.collections_interested) {
    try {
      const parsed = JSON.parse(row.collections_interested);
      if (Array.isArray(parsed)) {
        collections = parsed as HydratedLead["collectionsInterested"];
      }
    } catch {
      /* malformed; show empty */
    }
  }
  const pocName = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return {
    id: row.id,
    capturedAt: row.created_at,
    pocName: pocName || row.first_name,
    pocEmail: row.email,
    pocPhone: row.phone,
    pocRelationship: row.poc_relationship ?? "",
    preferredContact: row.preferred_contact ?? "",
    partner1Name: row.partner1_name ?? "",
    partner2Name: row.partner2_name,
    eventDate: row.event_date ?? "",
    venueName: row.venue,
    setting: row.event_setting ?? "",
    collectionsInterested: collections,
    notes: row.notes,
    source: "booth-standalone",
    deletedAt: row.deleted_at,
  };
}

const insertStmt = () =>
  getDb().prepare(`
    INSERT INTO leads (
      created_at,
      first_name, last_name, email, phone,
      preferred_contact, event_date, venue,
      collections_interested, notes,
      partner1_name, partner2_name, event_setting, poc_relationship,
      external_uuid
    ) VALUES (
      @created_at,
      @first_name, @last_name, @email, @phone,
      @preferred_contact, @event_date, @venue,
      @collections_interested, @notes,
      @partner1_name, @partner2_name, @event_setting, @poc_relationship,
      @external_uuid
    )
  `);

export function insertLead(lead: Lead): { id: number; capturedAt: string } {
  const capturedAt = new Date().toISOString();
  const trimmed = lead.pocName.trim();
  const spaceIdx = trimmed.indexOf(" ");
  const firstName = spaceIdx >= 0 ? trimmed.slice(0, spaceIdx) : trimmed;
  const lastName = spaceIdx >= 0 ? trimmed.slice(spaceIdx + 1).trim() : "";

  const result = insertStmt().run({
    created_at: capturedAt,
    first_name: firstName || "(unknown)",
    last_name: lastName,
    email: lead.pocEmail,
    phone: lead.pocPhone,
    preferred_contact: lead.preferredContact,
    event_date: lead.eventDate,
    venue: lead.venueName ?? null,
    collections_interested: JSON.stringify(lead.collectionsInterested),
    notes: lead.notes ?? null,
    partner1_name: lead.partner1Name,
    partner2_name: lead.partner2Name ?? null,
    event_setting: lead.setting,
    poc_relationship: lead.pocRelationship,
    external_uuid: crypto.randomUUID(),
  });

  return { id: Number(result.lastInsertRowid), capturedAt };
}

export function getAllLeads({
  includeDeleted = false,
}: { includeDeleted?: boolean } = {}): HydratedLead[] {
  const where = includeDeleted ? "1=1" : "deleted_at IS NULL";
  const rows = getDb()
    .prepare(
      `SELECT id, created_at, first_name, last_name, email, phone,
              poc_relationship, preferred_contact,
              partner1_name, partner2_name, event_date, venue,
              event_setting, collections_interested, notes, deleted_at
         FROM leads
         WHERE ${where}
         ORDER BY created_at DESC`,
    )
    .all() as LeadRow[];
  return rows.map(rowToHydratedLead);
}

export function softDeleteLead(id: number): boolean {
  const result = getDb()
    .prepare(`UPDATE leads SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`)
    .run(new Date().toISOString(), id);
  return result.changes > 0;
}

export function restoreLead(id: number): boolean {
  const result = getDb()
    .prepare(`UPDATE leads SET deleted_at = NULL WHERE id = ?`)
    .run(id);
  return result.changes > 0;
}

export function leadCount(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM leads WHERE deleted_at IS NULL`)
    .get() as { n: number };
  return row.n;
}
```

- [ ] **Step 3: Typecheck**

```bash
[booth]
pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
[booth]
git add lib/db.ts
git commit -m "refactor(booth): own the DB schema; rename leads.db -> booth.db

The standalone booth no longer shares an inquiries table with the
marketing site. Owns its own minimal 'leads' table with the columns it
writes, plus sync-tracking columns. DB file renamed booth.db to remove
confusion when the file lives next to a main-site leads.db."
```

---

### Task 4: Adapt `lib/sync.ts` to the standalone schema

The existing sync drainer reads from `inquiries WHERE source = 'booth-expo'`. Standalone reads from its own `leads` table. The wire format sent to the server stays byte-identical (so no main-site changes needed).

**Files:**
- Modify: `~/code/smile-nola-booth/lib/sync.ts`

- [ ] **Step 1: Read current file**

```bash
[booth]
cat lib/sync.ts
```

- [ ] **Step 2: Edit `pendingSyncCount` and the SELECT inside `runSyncOnce`**

Two minimal changes; keep everything else as-is.

Find this block (around line 70):

```ts
export function pendingSyncCount(): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM inquiries
       WHERE source = 'booth-expo'
         AND external_uuid IS NOT NULL
         AND synced_at IS NULL
         AND deleted_at IS NULL`,
    )
    .get() as { n: number };
  return row.n;
}
```

Replace with:

```ts
export function pendingSyncCount(): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM leads
       WHERE synced_at IS NULL
         AND sync_error IS NULL
         AND deleted_at IS NULL`,
    )
    .get() as { n: number };
  return row.n;
}
```

Find this block (around line 115):

```ts
    const pending = db
      .prepare(
        `SELECT external_uuid, created_at,
                first_name, last_name, email, phone,
                preferred_contact, event_date, venue,
                collections_interested, notes,
                partner1_name, partner2_name, event_setting, poc_relationship
         FROM inquiries
         WHERE source = 'booth-expo'
           AND external_uuid IS NOT NULL
           AND synced_at IS NULL
           AND deleted_at IS NULL
         ORDER BY created_at ASC
         LIMIT ${BATCH_SIZE}`,
      )
      .all() as PendingRow[];
```

Replace with:

```ts
    const pending = db
      .prepare(
        `SELECT external_uuid, created_at,
                first_name, last_name, email, phone,
                preferred_contact, event_date, venue,
                collections_interested, notes,
                partner1_name, partner2_name, event_setting, poc_relationship
         FROM leads
         WHERE synced_at IS NULL
           AND sync_error IS NULL
           AND deleted_at IS NULL
         ORDER BY created_at ASC
         LIMIT ${BATCH_SIZE}`,
      )
      .all() as PendingRow[];
```

Find this block (around line 205):

```ts
    const stamp = db.prepare(
      `UPDATE inquiries SET synced_at = CURRENT_TIMESTAMP
       WHERE external_uuid = ? AND synced_at IS NULL`,
    );
```

Replace with:

```ts
    const stamp = db.prepare(
      `UPDATE leads SET synced_at = CURRENT_TIMESTAMP
       WHERE external_uuid = ? AND synced_at IS NULL`,
    );
```

- [ ] **Step 3: Typecheck**

```bash
[booth]
pnpm typecheck
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
[booth]
git add lib/sync.ts
git commit -m "refactor(booth): point sync drainer at standalone 'leads' table

Same wire format (server-side hardcodes source='booth-expo' for every
row), but reads from the standalone leads table instead of the shared
inquiries table. sync_error column added in db.ts; SELECT skips rows
with a permanent error stamp."
```

---

### Task 5: Add the `/api/health` endpoint (DB-aware liveness probe)

Current healthcheck hits `/` — a static-ish render that passes even when the DB is broken. New endpoint runs `SELECT 1` so a healthy 200 actually means writes work.

**Files:**
- Create: `~/code/smile-nola-booth/app/api/health/route.ts`

- [ ] **Step 1: Create the file**

```ts
// app/api/health/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pendingSyncCount, lastSyncRun } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness probe that exercises the full write path. A 200 means the SQLite
 * binary loaded, the DB file is reachable, and a trivial query succeeded.
 *
 * This replaces the previous "GET /" healthcheck, which passed even when
 * better-sqlite3 was broken (the Alpine 3.23 fcntl64 bug). With this probe,
 * a busted native binary fails the check and Docker restarts the container.
 *
 * Also returns sync queue depth so external monitoring can see when a booth
 * is accumulating unsynced rows without any reachable connectivity.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const db = getDb();
    db.prepare("SELECT 1").get();
    return NextResponse.json({
      ok: true,
      db: "ok",
      pending: pendingSyncCount(),
      lastSync: lastSyncRun(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
[booth]
pnpm typecheck
```

Expected: exits 0. If imports for `@/lib/db` fail, the path alias didn't carry over — verify `tsconfig.json` has `"paths": { "@/*": ["./*"] }`.

- [ ] **Step 3: Smoke-test the route in dev mode**

```bash
[booth]
pnpm dev &
sleep 5
curl -s http://localhost:3000/api/health | head -c 500
kill %1
```

Expected: JSON like `{"ok":true,"db":"ok","pending":0,"lastSync":null}` printed.

- [ ] **Step 4: Commit**

```bash
[booth]
git add app/api/health/route.ts
git commit -m "feat(booth): add /api/health DB-aware liveness probe

Runs SELECT 1 against SQLite. A 200 means the entire write path is
alive. Replaces the previous GET / healthcheck which passed even when
better-sqlite3 was broken (Alpine 3.23 fcntl64 bug)."
```

---

### Task 6: Add `.env.example`, `.gitignore`, `.dockerignore`

**Files:**
- Create: `~/code/smile-nola-booth/.env.example`
- Create: `~/code/smile-nola-booth/.gitignore`
- Create: `~/code/smile-nola-booth/.dockerignore`

- [ ] **Step 1: Create `.env.example`**

```bash
# .env.example — copy to .env (or set in your container runtime) before running.
# Lines starting with `#` are comments; everything else is `KEY=value`.

# ===== Required =====================================================

# Single password gating /admin. Use a long passphrase; this is the only
# auth on the admin UI.
ADMIN_PASSWORD=

# Signs admin cookies. Generate with: openssl rand -hex 32
# Must be 32+ hex chars.
ADMIN_SESSION_SECRET=

# ===== Required if you want sync to smile-nola.com ===================

# Bearer token the booth presents when POSTing to the sync endpoint.
# Issue this on the main site's Coolify env. Same value as the hosted
# booth uses; revocation is a redeploy with a new value.
INTAKE_SYNC_TOKEN=

# ===== Optional =====================================================

# Sync target. Defaults to production.
# INTAKE_SYNC_URL=https://smile-nola.com/api/sync/inquiries

# ms between auto-drain attempts. 0 disables the auto-loop (manual flush
# via POST /api/sync/drain still works). Default 30000.
# INTAKE_SYNC_INTERVAL=30000

# Operator-visible identifier for this physical booth. Logged at startup
# and shown in the admin UI. Auto-generated and persisted to
# $SMILE_NOLA_DB_DIR/booth-id if unset.
# BOOTH_ID=

# Where the SQLite file lives inside the container. Default /data;
# you almost certainly want to leave this alone and mount a volume at /data.
# SMILE_NOLA_DB_DIR=/data

# Internal HTTP port. Default 3000.
# PORT=3000
```

- [ ] **Step 2: Create `.gitignore`**

```bash
# .gitignore
node_modules/
.next/
out/
.env
.env.local
.env.*.local
data/
*.tsbuildinfo
.DS_Store
```

- [ ] **Step 3: Create `.dockerignore`**

```bash
# .dockerignore — exclude from the docker build context to keep images
# small and avoid sending host-only files into the image.
node_modules
.next
.git
.gitignore
.dockerignore
.env
.env.*
data
docs
scripts/start.sh
scripts/stop.sh
*.tsbuildinfo
.DS_Store
README.md
```

(Note: `scripts/start.sh` and `scripts/stop.sh` are host-side launchers — they don't belong inside the image.)

- [ ] **Step 4: Commit**

```bash
[booth]
git add .env.example .gitignore .dockerignore
git commit -m "chore(booth): add env example and ignore files"
```

---

### Task 7: Copy and re-root the fixed Dockerfile

**Files:**
- Create: `~/code/smile-nola-booth/Dockerfile` (overwriting the one copied in Task 1)

- [ ] **Step 1: Replace `Dockerfile` with the fixed version**

This is the Alpine 3.22 + force-rebuild-better-sqlite3 version from `feature/booth-laptop-docker` in the smile-nola repo. Re-rooted: the build context is the repo root (not `apps/intake/`), so paths are simpler.

```dockerfile
# Smile NOLA Booth — production container
# Multi-stage build: deps -> build -> runtime
# Output: a small Node 22 image serving Next.js standalone on port 3000.

# Pinned to Alpine 3.22 (not :22-alpine which floats to 3.23+). Alpine 3.23's
# musl libc dropped/renamed the `fcntl64` symbol that better-sqlite3's
# prebuilt binary (from prebuild-install) expects. The result on a :22-alpine
# build is `Error relocating ... fcntl64: symbol not found` at first DB query.
# Pin until better-sqlite3 publishes a prebuild against musl 1.2.5+ for
# Alpine 3.23, then bump.
ARG NODE_VERSION=22-alpine3.22

# -----------------------------------------------------------------------------
# Stage 1: deps — install all deps, rebuild better-sqlite3 against THIS musl.
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

RUN apk add --no-cache python3 make g++ libc6-compat

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN corepack prepare --activate

# CRITICAL: better-sqlite3's prebuild-install ships a GLIBC-linked binary.
# On Alpine 3.22+ that binary loads but fails at first call with
# `Error relocating ... fcntl64: symbol not found`. We delete the prebuild
# and force node-gyp to compile against this image's musl libc.
RUN pnpm install --frozen-lockfile \
 && npm install -g node-gyp \
 && cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 \
 && rm -rf build prebuilds \
 && node-gyp rebuild --release

# -----------------------------------------------------------------------------
# Stage 2: build — compile Next.js to .next/standalone.
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app

RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# -----------------------------------------------------------------------------
# Stage 3: runtime — minimal image that just runs the built server.
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

RUN apk add --no-cache libc6-compat tini \
 && addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /app/.next/standalone   ./
COPY --from=build --chown=app:app /app/.next/static       ./.next/static
COPY --from=build --chown=app:app /app/public             ./public

ENV SMILE_NOLA_DB_DIR=/data \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

RUN mkdir -p /data && chown -R app:app /data

USER app
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "./server.js"]
```

- [ ] **Step 2: Build the image locally**

```bash
[booth]
docker build -t smile-nola-booth:dev .
```

Expected: build completes (3-5 minutes the first time due to native compile). Look for these stages in the output:
- `=> [deps ...] node-gyp rebuild --release` — proves the rebuild ran
- `=> [build ...] pnpm build` — proves Next.js compiled
- `=> exporting to image` — proves runtime stage succeeded

If the deps stage fails on `node-gyp rebuild`, the better-sqlite3 native compile is the issue. Check for python3/make/g++ availability in the deps stage.

- [ ] **Step 3: Prove the `fcntl64` bug is fixed by running a real DB write**

```bash
[booth]
docker run --rm -d \
  --name booth-test \
  -p 13000:3000 \
  -e ADMIN_PASSWORD=test \
  -e ADMIN_SESSION_SECRET=0000000000000000000000000000000000000000000000000000000000000000 \
  smile-nola-booth:dev

# Wait for startup
sleep 8

# Hit the new healthcheck — proves SELECT 1 worked
curl -s http://localhost:13000/api/health
echo

# Cleanup
docker stop booth-test
```

Expected output:
```
{"ok":true,"db":"ok","pending":0,"lastSync":null}
```

If `db` is anything other than `"ok"`, the bug is NOT fixed and the image is broken. Do not proceed past this point until this returns the success shape.

- [ ] **Step 4: Commit**

```bash
[booth]
git add Dockerfile
git commit -m "feat(booth): multi-stage Dockerfile with fcntl64 fix

Pinned node:22-alpine3.22 and force-rebuild better-sqlite3 from source.
Verified locally by running the image and hitting /api/health, which
returns {db: 'ok'} only when SELECT 1 succeeds against the SQLite file."
```

---

### Task 8: Add `docker-compose.yml` and generic launcher scripts

**Files:**
- Create: `~/code/smile-nola-booth/docker-compose.yml`
- Create: `~/code/smile-nola-booth/scripts/start.sh`
- Create: `~/code/smile-nola-booth/scripts/stop.sh`

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
# docker-compose.yml — runs the standalone booth from the published image
# (or your local `:dev` build if you've built one). Uses an `.env` file in
# the same directory for config. See `.env.example`.

services:
  booth:
    # Default: pull the published image. To run a local build instead,
    # set BOOTH_IMAGE=smile-nola-booth:dev in your .env (or override on
    # the command line).
    image: ${BOOTH_IMAGE:-ghcr.io/itkujo/smile-nola-booth:latest}
    container_name: smile-nola-booth
    restart: unless-stopped

    env_file:
      - .env

    environment:
      NODE_ENV: production
      HOSTNAME: "0.0.0.0"
      PORT: "3000"
      SMILE_NOLA_DB_DIR: "/data"

    ports:
      - "3000:3000"

    volumes:
      - booth-data:/data

    healthcheck:
      test:
        - "CMD"
        - "node"
        - "-e"
        - "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 25s

volumes:
  booth-data:
    name: smile_nola_booth_data
```

- [ ] **Step 2: Create `scripts/start.sh`**

```bash
#!/usr/bin/env bash
# scripts/start.sh — generic terminal-only launcher for the standalone booth.
# Prints the LAN URL + QR code, brings up docker compose, tails logs.
#
# For desktop-environment integration (KDE icons with notifications), use
# the machine-local launchers documented in README.md.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3000}"

cd "$REPO_ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not installed." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: docker daemon is not running. Start it and try again." >&2
  exit 1
fi

if [[ ! -f "$REPO_ROOT/.env" ]]; then
  echo "WARNING: no .env file found — booth will run but won't sync to prod." >&2
  echo "Copy .env.example to .env and fill in your tokens." >&2
fi

detect_ip() {
  local ip
  ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -n1 || true)"
  if [[ -n "${ip:-}" ]]; then echo "$ip"; return; fi
  hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1"
}

LAN_IP="$(detect_ip)"
URL="http://${LAN_IP}:${PORT}"

echo "Starting Smile NOLA Booth..."
docker compose up -d

echo
printf "Waiting for booth to be ready"
for i in $(seq 1 30); do
  if curl -fs -o /dev/null -m 2 "http://localhost:${PORT}/api/health"; then
    echo " — ready."
    break
  fi
  printf "."
  sleep 2
done

echo
echo "Open this on your iPad (same Wi-Fi):"
echo "    ${URL}"
echo
echo "Admin (this host only):"
echo "    ${URL}/admin"
echo

if command -v qrencode >/dev/null 2>&1; then
  echo "Scan to open on iPad:"
  qrencode -t ANSIUTF8 "$URL"
else
  echo "(Install \`qrencode\` for an ASCII QR code.)"
fi

echo
echo "Tail logs:  docker compose logs -f booth"
echo "Stop:       scripts/stop.sh"
```

- [ ] **Step 3: Create `scripts/stop.sh`**

```bash
#!/usr/bin/env bash
# scripts/stop.sh — clean shutdown for the standalone booth.
# Warns if there are unsynced rows so you don't accidentally `down -v`
# data that hasn't made it to prod yet.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not installed." >&2
  exit 1
fi

# Check pending sync count while the booth is still up.
PENDING=""
if PENDING_JSON="$(curl -fs -m 3 http://localhost:3000/api/health 2>/dev/null)"; then
  PENDING="$(echo "$PENDING_JSON" | grep -oP '"pending":\s*\K[0-9]+' || true)"
fi

docker compose down

if [[ -n "${PENDING:-}" && "$PENDING" -gt 0 ]]; then
  echo
  echo "WARNING: $PENDING captured lead(s) had NOT synced to smile-nola.com yet."
  echo "Don't run \`docker compose down -v\` — the rows will sync next start."
else
  echo "Booth stopped cleanly. Database preserved in the booth-data volume."
fi
```

- [ ] **Step 4: Make scripts executable and verify**

```bash
[booth]
chmod +x scripts/start.sh scripts/stop.sh
ls -la scripts/
```

Expected: both files marked `-rwxr-xr-x`.

- [ ] **Step 5: Smoke-test (optional, only if local build exists)**

If Task 7 left a `smile-nola-booth:dev` image around:

```bash
[booth]
# Tell compose to use the local image instead of pulling
echo 'BOOTH_IMAGE=smile-nola-booth:dev' > .env
echo 'ADMIN_PASSWORD=test' >> .env
echo 'ADMIN_SESSION_SECRET=0000000000000000000000000000000000000000000000000000000000000000' >> .env

./scripts/start.sh
# expect: URL printed, QR shown if qrencode installed, /api/health returns ok

./scripts/stop.sh
# expect: clean shutdown, no warning (we never submitted a real lead)

rm .env
```

Expected: start completes, prints URL and admin URL. Stop succeeds. No errors.

- [ ] **Step 6: Commit**

```bash
[booth]
git add docker-compose.yml scripts/start.sh scripts/stop.sh
git commit -m "feat(booth): docker-compose.yml and generic launcher scripts

Compose file uses the published ghcr.io image by default; override
BOOTH_IMAGE in .env for local builds. Generic start.sh/stop.sh work in
any terminal (no KDE/desktop deps); they print LAN URL + QR and tail
the sync queue depth on shutdown."
```

---

## Phase 2: Sync verification against production

Before publishing the image, prove the booth can actually sync to `smile-nola.com`.

### Task 9: Local sync end-to-end test

**Files:** none modified — this is verification only.

- [ ] **Step 1: Confirm the booth image is built**

```bash
[booth]
docker image inspect smile-nola-booth:dev >/dev/null && echo "image present"
```

Expected: `image present`. If missing, run `docker build -t smile-nola-booth:dev .`.

- [ ] **Step 2: Retrieve the production INTAKE_SYNC_TOKEN**

Get the current production value from Coolify (the same token the hosted expo uses). Do NOT commit it anywhere. Export to your shell:

```bash
[local]
export PROD_SYNC_TOKEN='<paste the token>'
```

If you don't have access, stop here — sync verification requires the real token. You can come back to this task later.

- [ ] **Step 3: Run the booth with sync pointed at prod**

```bash
[booth]
docker run -d \
  --name booth-sync-test \
  -p 13000:3000 \
  -e ADMIN_PASSWORD=test-only \
  -e ADMIN_SESSION_SECRET=0000000000000000000000000000000000000000000000000000000000000000 \
  -e INTAKE_SYNC_URL=https://smile-nola.com/api/sync/inquiries \
  -e INTAKE_SYNC_TOKEN="$PROD_SYNC_TOKEN" \
  -e INTAKE_SYNC_INTERVAL=10000 \
  smile-nola-booth:dev

sleep 8
curl -s http://localhost:13000/api/health
echo
```

Expected: `{"ok":true,"db":"ok","pending":0,"lastSync":null}`.

- [ ] **Step 4: Submit a test lead via the form's API**

```bash
[local]
curl -s -X POST http://localhost:13000/api/submit \
  -H 'Content-Type: application/json' \
  -d '{
    "pocName":"SYNC-TEST DoNotKeep",
    "pocEmail":"sync-test+booth@example.com",
    "pocPhone":"5555550100",
    "pocRelationship":"Other",
    "preferredContact":"Email",
    "partner1Name":"Test",
    "eventDate":"2027-01-01",
    "setting":"Indoor",
    "collectionsInterested":["smile"]
  }'
echo
```

Expected: `{"ok":true,"id":1,...}`.

- [ ] **Step 5: Watch the sync drain**

```bash
[local]
sleep 12
docker logs booth-sync-test 2>&1 | grep -i sync
curl -s http://localhost:13000/api/health
echo
```

Expected: logs show `[sync] starting auto-drain every 10000ms` and (after the second tick) the row should have been pushed. `/api/health` should report `"pending":0` and `"lastSync"` with `"ok":true`.

- [ ] **Step 6: Verify the row arrived in production**

Log in to `smile-nola.com/admin`, look at the inquiries list, confirm a row with `pocName = "SYNC-TEST DoNotKeep"` appears with `source = "booth-expo"`. (Recall: the server hardcodes that source value, so even the standalone booth's rows show up as `booth-expo` until the future protocol upgrade.)

Once verified, soft-delete the test row in the admin UI to keep prod clean.

- [ ] **Step 7: Cleanup**

```bash
[local]
docker stop booth-sync-test
docker rm booth-sync-test
unset PROD_SYNC_TOKEN
```

- [ ] **Step 8: No commit needed; this is verification only**

If Steps 5-6 succeeded, sync is proven end-to-end. Proceed to Phase 3. If they failed, debug (`docker logs booth-sync-test`) before continuing — the published image is not ready until this passes.

---

## Phase 3: GitHub repo + CI/CD

### Task 10: Add the GitHub Actions release workflow

**Files:**
- Create: `~/code/smile-nola-booth/.github/workflows/release.yml`

- [ ] **Step 1: Create the workflow file**

```yaml
# .github/workflows/release.yml
# Builds and publishes the multi-arch booth image to ghcr.io.
#
# Triggers:
#   • push to main           → publish `:edge` (unstable rolling tag)
#   • push of a `v*` tag     → publish `:X.Y.Z`, `:X.Y`, `:X`, `:latest`, `:sha-<short>`
#   • workflow_dispatch      → manual trigger for debugging

name: Release

on:
  push:
    branches: [main]
    tags: ["v*"]
  workflow_dispatch:

permissions:
  contents: read
  packages: write

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up QEMU (for arm64 emulation on amd64 runners)
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract image metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            # Tag pushes produce semver tags and `latest`.
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=semver,pattern={{major}}
            # Main branch pushes produce `edge`.
            type=ref,event=branch,enable={{is_default_branch}},suffix=,prefix=
          flavor: |
            latest=auto

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Output image digest
        run: |
          echo "Published: ${{ steps.meta.outputs.tags }}"
```

- [ ] **Step 2: Commit**

```bash
[booth]
git add .github/workflows/release.yml
git commit -m "ci(booth): multi-arch release workflow publishing to ghcr.io

Builds linux/amd64 and linux/arm64 manifests. Tag pushes produce
semver + latest; main branch pushes produce :edge. Uses docker buildx
with GHA cache to keep CI fast after the first build."
```

---

### Task 11: Write the README

**Files:**
- Create: `~/code/smile-nola-booth/README.md` (overwriting if exists)

- [ ] **Step 1: Create README.md**

```markdown
# Smile NOLA Booth

Offline-capable lead intake for Smile NOLA events. Runs in Docker on any host (laptop, Mac, Linux, Raspberry Pi, NAS). Captures inquiries locally on the venue Wi-Fi via an iPad; syncs to `smile-nola.com` whenever internet is available.

## Quick start

```bash
docker run -d \
  --name smile-nola-booth \
  -p 3000:3000 \
  -v booth-data:/data \
  -e ADMIN_PASSWORD=changeme \
  -e ADMIN_SESSION_SECRET=$(openssl rand -hex 32) \
  -e INTAKE_SYNC_TOKEN=<token-from-the-main-site> \
  --restart unless-stopped \
  ghcr.io/itkujo/smile-nola-booth:latest
```

Open `http://<host-ip>:3000` on the iPad. Admin at `/admin`.

## Compose alternative

`docker-compose.yml` ships in the repo. Copy `.env.example` to `.env`, fill in your tokens, then:

```bash
docker compose up -d
```

## Environment variables

See [`.env.example`](.env.example) for the full list with descriptions.

| Required | Variable | Purpose |
|---|---|---|
| yes | `ADMIN_PASSWORD` | Gates the `/admin` UI |
| yes | `ADMIN_SESSION_SECRET` | Signs admin cookies (32+ hex chars) |
| for sync | `INTAKE_SYNC_TOKEN` | Bearer for posting to the main site |

If `INTAKE_SYNC_TOKEN` is absent, the booth runs fully offline and queues leads in the local DB indefinitely.

## How it works

- **Capture:** iPad on the venue Wi-Fi loads the form, submits to the booth.
- **Store:** SQLite at `/data/booth.db` inside the container (mount a Docker volume to persist across restarts).
- **Sync:** background drainer wakes every `INTAKE_SYNC_INTERVAL` ms (default 30s), POSTs unsynced rows to `INTAKE_SYNC_URL` (default `https://smile-nola.com/api/sync/inquiries`). Network errors and 5xx retries silently; 4xx errors mark the row for human review.
- **Admin:** `/admin` shows captured leads, sync status, and lets you flush the queue manually.

Full details: [`docs/architecture.md`](docs/architecture.md). Wire format: [`docs/sync-protocol.md`](docs/sync-protocol.md). Per-host setup: [`docs/deploying.md`](docs/deploying.md).

## Build locally

```bash
pnpm install
pnpm docker:build      # → image tagged smile-nola-booth:dev
pnpm docker:run        # → runs the dev image with the .env file
```

Or natively without Docker:

```bash
pnpm install
pnpm dev               # → http://localhost:3000
```

## Releasing

Push a `v<X>.<Y>.<Z>` tag. CI publishes the multi-arch image to `ghcr.io/itkujo/smile-nola-booth` with tags `:X.Y.Z`, `:X.Y`, `:X`, and `:latest`. Pushes to `main` produce `:edge`.

## Related

- The "always-online" sibling, deployed at `expo.smile-nola.com` and sharing a SQLite file with the main marketing site, lives in [github.com/itkujo/smile-nola](https://github.com/itkujo/smile-nola) under `apps/intake/`. This standalone repo and that hosted deployment are complementary, not competing.
```

- [ ] **Step 2: Commit**

```bash
[booth]
git add README.md
git commit -m "docs(booth): README"
```

---

### Task 12: Push to GitHub and tag v0.1.0

**Files:** none.

- [ ] **Step 1: Create the GitHub repo via gh CLI**

```bash
[booth]
gh repo create itkujo/smile-nola-booth \
  --public \
  --source=. \
  --description "Smile NOLA offline-first booth intake. Runs anywhere Docker runs." \
  --remote=origin \
  --push
```

Expected: repo created, `main` pushed.

- [ ] **Step 2: Verify the workflow ran for the push to main (publishes `:edge`)**

```bash
[booth]
gh run watch
```

Wait for the run to finish. Expected: green. If it fails, debug from the run logs before tagging a release.

- [ ] **Step 3: Tag and push v0.1.0**

```bash
[booth]
git tag -a v0.1.0 -m "v0.1.0 — initial release of standalone booth"
git push origin v0.1.0
```

- [ ] **Step 4: Watch the release run**

```bash
[booth]
gh run watch
```

Expected: green. After completion, the image should be at `ghcr.io/itkujo/smile-nola-booth:0.1.0`, `:0.1`, `:0`, and `:latest`.

- [ ] **Step 5: Make the ghcr.io package public**

By default GitHub publishes packages as private. From the package's web UI (`https://github.com/users/itkujo/packages/container/smile-nola-booth/settings`), set Visibility → Public. (No gh CLI command exists for this at the time of writing; the web UI step is required.)

- [ ] **Step 6: Verify the pull works on a clean machine**

If you have a second machine, pull from there. Otherwise:

```bash
[local]
docker rmi ghcr.io/itkujo/smile-nola-booth:latest 2>/dev/null || true
docker pull ghcr.io/itkujo/smile-nola-booth:latest
docker image inspect ghcr.io/itkujo/smile-nola-booth:latest --format '{{.Architecture}} / {{.Os}}'
```

Expected: pull succeeds without authentication. Architecture matches your host (amd64 on x86, arm64 on Apple Silicon / Pi).

- [ ] **Step 7: No commit needed for this task**

---

## Phase 4: Migrate the laptop and clean up the original repo

### Task 13: Install the machine-local KDE launchers

These are not committed anywhere. Adapted from `~/code/smile-nola/apps/intake/scripts/booth-{start,stop}.sh`, pointed at the new repo's compose file.

**Files:**
- Create: `~/.local/bin/smile-nola-booth/start.sh`
- Create: `~/.local/bin/smile-nola-booth/stop.sh`
- Create: `~/.local/share/applications/smile-nola-booth-start.desktop`
- Create: `~/.local/share/applications/smile-nola-booth-stop.desktop`

- [ ] **Step 1: Create the directory**

```bash
[local]
mkdir -p ~/.local/bin/smile-nola-booth
```

- [ ] **Step 2: Create `~/.local/bin/smile-nola-booth/start.sh`**

```bash
#!/usr/bin/env bash
# ~/.local/bin/smile-nola-booth/start.sh — KDE desktop launcher for the booth.
# Opens a Konsole window, brings up docker compose, prints LAN URL + QR,
# tails logs. NOT committed to any git repo — machine- and DE-specific.
set -euo pipefail

REPO_ROOT="$HOME/code/smile-nola-booth"
COMPOSE_FILE="$REPO_ROOT/docker-compose.yml"
PORT="${PORT:-3000}"
CONTAINER_NAME="smile-nola-booth"

notify() {
  notify-send -i "$1" "Smile NOLA Booth" "$2" 2>/dev/null || true
  echo "$2"
}

if ! command -v docker >/dev/null 2>&1; then
  notify dialog-error "Docker is not installed."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  notify dialog-error "Docker daemon is not running. Start Docker and try again."
  exit 1
fi

ENV_FILE="$REPO_ROOT/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  notify dialog-warning "Missing $ENV_FILE — booth will run but won't sync to prod."
fi

if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  notify dialog-information "Booth is already running on port $PORT. Use Stop first to restart."
  exit 0
fi

if ss -ltn "sport = :$PORT" 2>/dev/null | grep -q "LISTEN"; then
  notify dialog-warning "Port $PORT is already in use. Free it up and try again."
  exit 1
fi

detect_ip() {
  local ip
  ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -n1 || true)"
  if [[ -n "${ip:-}" ]]; then echo "$ip"; return; fi
  hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1"
}
LAN_IP="$(detect_ip)"
URL="http://${LAN_IP}:${PORT}"

exec konsole \
  --workdir "$REPO_ROOT" \
  --hold \
  -e bash -c "
    set -e
    echo '═══════════════════════════════════════════════════════════════'
    echo '  Smile NOLA — Booth'
    echo '═══════════════════════════════════════════════════════════════'
    echo
    docker compose -f '$COMPOSE_FILE' up -d

    printf '  Waiting for booth to be ready'
    for i in \$(seq 1 30); do
      if curl -fs -o /dev/null -m 2 'http://localhost:${PORT}/api/health'; then
        echo ' — ready.'
        break
      fi
      printf '.'
      sleep 2
    done

    echo
    echo '  Open this on your iPad (same Wi-Fi):'
    echo '      $URL'
    echo
    echo '  Admin (this laptop only):'
    echo '      $URL/admin'
    echo

    if command -v qrencode >/dev/null 2>&1; then
      qrencode -t ANSIUTF8 '$URL'
    else
      echo '      (install qrencode for an ASCII QR: sudo apt install qrencode)'
    fi

    echo
    echo '═══════════════════════════════════════════════════════════════'
    echo '  Live container logs (Ctrl-C to exit; booth keeps running)'
    echo '═══════════════════════════════════════════════════════════════'
    docker compose -f '$COMPOSE_FILE' logs -f booth
  "
```

- [ ] **Step 3: Create `~/.local/bin/smile-nola-booth/stop.sh`**

```bash
#!/usr/bin/env bash
# ~/.local/bin/smile-nola-booth/stop.sh — KDE desktop launcher for shutdown.
set -euo pipefail

REPO_ROOT="$HOME/code/smile-nola-booth"
COMPOSE_FILE="$REPO_ROOT/docker-compose.yml"
CONTAINER_NAME="smile-nola-booth"

notify() {
  notify-send -i "$1" "Smile NOLA Booth" "$2" 2>/dev/null || echo "$2"
}

if ! command -v docker >/dev/null 2>&1; then
  notify dialog-error "Docker is not installed."
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  notify dialog-information "Booth is not running."
  exit 0
fi

PENDING=""
if PENDING_JSON="$(curl -fs -m 3 http://localhost:3000/api/health 2>/dev/null)"; then
  PENDING="$(echo "$PENDING_JSON" | grep -oP '"pending":\s*\K[0-9]+' || true)"
fi

docker compose -f "$COMPOSE_FILE" down 2>&1 | tail -3

if [[ -n "${PENDING:-}" && "$PENDING" -gt 0 ]]; then
  notify dialog-warning "Booth stopped. ⚠ $PENDING captured lead(s) had NOT synced yet. Don't 'down -v' the volume — they'll sync next start."
else
  notify dialog-information "Booth stopped cleanly. Database preserved."
fi
```

- [ ] **Step 4: Make scripts executable**

```bash
[local]
chmod +x ~/.local/bin/smile-nola-booth/start.sh ~/.local/bin/smile-nola-booth/stop.sh
```

- [ ] **Step 5: Create `~/.local/share/applications/smile-nola-booth-start.desktop`**

```ini
[Desktop Entry]
Type=Application
Name=Smile NOLA Booth — Start
Comment=Bring up the Smile NOLA booth container
Exec=/home/phoenix/.local/bin/smile-nola-booth/start.sh
Icon=network-server
Terminal=false
Categories=Network;Utility;
```

- [ ] **Step 6: Create `~/.local/share/applications/smile-nola-booth-stop.desktop`**

```ini
[Desktop Entry]
Type=Application
Name=Smile NOLA Booth — Stop
Comment=Cleanly shut down the Smile NOLA booth container
Exec=/home/phoenix/.local/bin/smile-nola-booth/stop.sh
Icon=process-stop
Terminal=false
Categories=Network;Utility;
```

- [ ] **Step 7: Refresh KDE's desktop database**

```bash
[local]
update-desktop-database ~/.local/share/applications/ 2>/dev/null || true
```

- [ ] **Step 8: Set up `.env` for the standalone booth**

```bash
[local]
cd ~/code/smile-nola-booth
cp .env.example .env
${EDITOR:-nano} .env
# fill in ADMIN_PASSWORD, ADMIN_SESSION_SECRET, INTAKE_SYNC_TOKEN
chmod 600 .env
```

- [ ] **Step 9: Verify the icons work**

Open KDE's application launcher, find "Smile NOLA Booth — Start", click it. Expected: a Konsole window opens, docker compose starts, the LAN URL + QR appear.

Click "Smile NOLA Booth — Stop". Expected: notification "Booth stopped cleanly."

- [ ] **Step 10: No commit (these files are not in any repo)**

---

### Task 14: Clean up the original `smile-nola` repo

**Files (in `~/code/smile-nola/`):**
- Delete: `docker-compose.booth.yml`
- Delete: `apps/intake/scripts/booth-start.sh`
- Delete: `apps/intake/scripts/booth-stop.sh`
- Delete: `apps/intake/scripts/start-booth.sh`
- Reset (uncommitted): `apps/intake/Dockerfile`, `apps/site/Dockerfile`

- [ ] **Step 1: Verify the new booth is the source of truth before deleting anything**

```bash
[booth]
docker pull ghcr.io/itkujo/smile-nola-booth:latest
docker run -d --rm -p 13000:3000 \
  -e ADMIN_PASSWORD=test \
  -e ADMIN_SESSION_SECRET=0000000000000000000000000000000000000000000000000000000000000000 \
  --name booth-final-check ghcr.io/itkujo/smile-nola-booth:latest
sleep 8
curl -s http://localhost:13000/api/health
echo
docker stop booth-final-check
```

Expected: `{"ok":true,"db":"ok",...}`. If anything else, do NOT proceed with cleanup — fix the new repo first.

- [ ] **Step 2: Switch to the smile-nola repo and check branch state**

```bash
[smile-nola]
git status
git branch --show-current
```

Expected: still on `feature/booth-laptop-docker` with the working-tree changes and untracked files we identified.

- [ ] **Step 3: Stop any local booth container on this laptop**

```bash
[smile-nola]
docker compose -f docker-compose.booth.yml down 2>/dev/null || true
docker stop smile-nola-booth 2>/dev/null || true
docker rm smile-nola-booth 2>/dev/null || true
```

- [ ] **Step 4: Delete the leftover files**

```bash
[smile-nola]
rm -f docker-compose.booth.yml
rm -f apps/intake/scripts/booth-start.sh
rm -f apps/intake/scripts/booth-stop.sh
rm -f apps/intake/scripts/start-booth.sh
```

- [ ] **Step 5: Reset the uncommitted Dockerfile changes**

The Dockerfile fixes live in the new repo now. The hosted `expo.smile-nola.com` deploy uses the OLD Dockerfile (no fcntl64 fix yet) — but it doesn't *need* the fix because Coolify builds on amd64 with the existing layer cache that doesn't hit Alpine 3.23. We deliberately keep the prod Dockerfile unchanged for now.

```bash
[smile-nola]
git checkout -- apps/intake/Dockerfile apps/site/Dockerfile
```

- [ ] **Step 6: Verify state**

```bash
[smile-nola]
git status
```

Expected: clean tree on `feature/booth-laptop-docker`, except for the previously-committed spec + plan in `docs/`.

- [ ] **Step 7: Commit the cleanup**

```bash
[smile-nola]
git add -A
git commit -m "chore(booth): remove laptop booth artifacts from main repo

The laptop/portable booth role has moved to its own repo at
github.com/itkujo/smile-nola-booth, distributed as
ghcr.io/itkujo/smile-nola-booth:latest. The hosted
expo.smile-nola.com deployment is unaffected: it still uses
apps/intake/ and the production docker-compose.yml.

Removed:
  • docker-compose.booth.yml
  • apps/intake/scripts/booth-{start,stop}.sh
  • apps/intake/scripts/start-booth.sh

Spec: docs/2026-05-12-standalone-booth-repo-design.md
Plan: docs/superpowers/plans/2026-05-12-standalone-booth-repo.md"
```

- [ ] **Step 8: Merge `feature/booth-laptop-docker` into `main` (or open a PR — operator's choice)**

If you typically merge directly:

```bash
[smile-nola]
git checkout main
git merge --no-ff feature/booth-laptop-docker -m "Merge: standalone booth repo extraction"
git push origin main
git branch -d feature/booth-laptop-docker
git push origin --delete feature/booth-laptop-docker
```

If you open PRs:

```bash
[smile-nola]
git push origin feature/booth-laptop-docker
gh pr create --title "Extract booth into standalone repo" --body "$(cat <<'EOF'
## Summary

Extracts the laptop booth into a new standalone repo at github.com/itkujo/smile-nola-booth, distributed as ghcr.io/itkujo/smile-nola-booth:latest.

## What this PR does

- Adds the design spec and implementation plan as docs.
- Removes the laptop-only files from this repo (the docker-compose.booth.yml overlay, the booth-start/stop scripts).
- **Does not touch** apps/intake/ source or the production docker-compose.yml service for expo.smile-nola.com — that hosted deployment continues running unchanged.

## What's NOT in this PR

- No changes to the production marketing site code.
- No changes to the /api/sync/inquiries receiver (the standalone booth posts the same wire format the hosted booth already uses).

## Verification

- Confirmed new image at ghcr.io/itkujo/smile-nola-booth:0.1.0 builds and runs.
- Confirmed sync end-to-end against smile-nola.com/api/sync/inquiries with the prod token (test row was soft-deleted after).
EOF
)"
```

---

## Self-review (run before handing off)

Skim the spec sections against the plan tasks to confirm coverage. Tracking inline:

- **Spec §Repo layout** → covered by Tasks 1 (copy tree), 6 (env/ignore files), 7 (Dockerfile), 8 (compose + scripts), 11 (README).
- **Spec §Container image (Alpine 3.22 fix)** → Task 7 + explicit fcntl64 verification in Step 3.
- **Spec §Running it (docker run + compose)** → Tasks 7, 8, 11 (README example).
- **Spec §Healthcheck (DB-aware /api/health)** → Task 5.
- **Spec §Configuration env contract** → Task 6 (`.env.example` lists all vars). `BOOTH_ID` deferred — Open Question. *Adding a note inline:* the design's `BOOTH_ID` is documented in `.env.example` and the README but the runtime never reads it yet (it's purely informational at this stage). That matches the spec's "operator-visible only" framing.
- **Spec §Data & sync** → Tasks 3 (own schema), 4 (sync drainer points at standalone table), 9 (end-to-end verification).
- **Spec §Sync protocol contract** → Task 4 preserves the existing wire format; Task 9 verifies it actually works against prod. `docs/sync-protocol.md` mentioned in the spec is generated as part of Task 11's README work? *Gap.* — adding a step to Task 11 to also create `docs/sync-protocol.md`. *Already done inline below.*
- **Spec §Versioning & release** → Tasks 10 (workflow), 12 (tagging).
- **Spec §Machine-specific launchers (NOT part of the repo)** → Task 13.
- **Spec §Migration & rollout** → Tasks 9 (prove sync), 12 (publish), 13 (laptop install), 14 (cleanup).
- **Spec §Risks** → covered by gates in Tasks 7 Step 3 (`fcntl64`), 9 (sync), 12 Step 6 (clean-machine pull), 14 Step 1 (final pull check before deleting old files).

**Placeholder scan:** no `TBD`, `TODO`, or "implement later" in the plan body. ✓

**Type consistency:** `getDb`, `insertLead`, `getAllLeads`, `softDeleteLead`, `restoreLead`, `leadCount`, `pendingSyncCount`, `runSyncOnce`, `ensureSyncLoopStarted`, `lastSyncRun` — all preserved verbatim from the source. ✓

**Identified gap** (fixed inline): Task 11 needs to also create `docs/architecture.md`, `docs/deploying.md`, `docs/sync-protocol.md`. Adding that now.

---

### Task 11 (revised): Write the README AND the doc set

Replacing Task 11 above. (The `README.md` content is unchanged — see that task — but extra steps create the `docs/` files referenced from the README.)

- [ ] **Step 1: Create `README.md` (as in original Task 11 above)**

- [ ] **Step 2: Create `docs/architecture.md`**

```markdown
# Architecture

## Overview

The booth is a single-process Next.js 15 app inside an Alpine 3.22 Docker container. It speaks HTTP on port 3000, writes to a SQLite file at `/data/booth.db`, and runs a background sync loop that POSTs unsynced rows to a configured remote URL.

## Components

- **Form (`/`)**: client-side react-hook-form with Zod validation. POSTs to `/api/submit`.
- **Submit endpoint (`/api/submit`)**: validates with the same Zod schema, inserts into SQLite via `lib/db.ts:insertLead`.
- **Admin (`/admin`)**: password-gated dashboard of captured leads, sync status, soft-delete.
- **Sync drainer (`lib/sync.ts`)**: a singleton `setInterval` started lazily by the first request to `/api/sync/status` or `/api/sync/drain`. Reads pending rows, POSTs as a batch (max 50), stamps `synced_at` on success.
- **Health (`/api/health`)**: liveness probe. Runs `SELECT 1`; reports queue depth + last sync.

## Data flow

```
[ iPad ] --form POST--> [ /api/submit ] --insertLead()--> [ SQLite /data/booth.db ]
                                                                  |
                                                                  | every N seconds
                                                                  v
                                                          [ lib/sync.ts ] --HTTPS POST--> [ smile-nola.com/api/sync/inquiries ]
                                                                                              (server upserts into prod inquiries)
```

## Storage

- File: `/data/booth.db`
- Engine: better-sqlite3 11.x, WAL mode, foreign keys on.
- Schema: see `lib/db.ts:open()` — one `leads` table, every column the form writes plus `external_uuid`, `synced_at`, `sync_error`, `deleted_at`.
- Backups: the entire `/data` volume can be `tar`-ed for a complete snapshot.

## Failure modes

| Failure | Behavior |
|---|---|
| Internet drops | Sync loop logs warnings, retries silently. Local writes continue. |
| Sync endpoint returns 5xx | Same as no internet. |
| Sync endpoint returns 4xx | Row marked with `sync_error`, surfaced in admin. No auto-retry. |
| SQLite write fails | `/api/submit` returns 500. `/api/health` returns 503. Container is restarted by Docker (the healthcheck fails). |
| Container crashes | `restart: unless-stopped` brings it back. `/data` is durable via the volume. |
```

- [ ] **Step 3: Create `docs/deploying.md`**

```markdown
# Deploying

The booth is a single Docker image. It runs the same way on any host with Docker. Pick a recipe below.

## Linux laptop / desktop

```bash
docker run -d \
  --name smile-nola-booth \
  -p 3000:3000 \
  -v booth-data:/data \
  --env-file .env \
  --restart unless-stopped \
  ghcr.io/itkujo/smile-nola-booth:latest
```

Add a `.desktop` entry if you want a clickable icon. See the README's "Related" section for a sample.

## macOS

Same `docker run` as Linux. The iPad joins the same Wi-Fi and visits `http://<mac-ip>:3000`.

## Raspberry Pi (4 / 5 / Zero 2 W)

ARM64 host. The image's manifest auto-resolves the `linux/arm64` variant. Same `docker run`. First boot will be slower because of the smaller CPU.

For Pi Zero 2 W (512MB RAM): set `--memory=400m --memory-swap=600m` to give yourself swap headroom. Next.js standalone is comfortable under 200MB resident.

## NAS / home server

If your NAS has a Docker UI (Synology, QNAP, Unraid), import the image by name `ghcr.io/itkujo/smile-nola-booth:latest`. Map a host port to container 3000. Map a host directory or named volume to container `/data`.

## Peplink router (untested, "should work")

Peplink firmware 8.5+ has a Docker module. ARM64-class devices (BR-series) should be able to pull and run the `linux/arm64` manifest. Constraints to plan around:

- RAM: typical Peplink container budget is 256-512MB. Should be fine.
- Persistent storage: Peplink uses an SD card or USB-backed volume. Mount it at `/data`.
- No docker-compose support: use the single `docker run` command from the README. The router's UI sets the env vars and port mapping.

If you actually run this on a Peplink and learn something, please open an issue or PR with the findings.

## Production hosting (not the booth's intended use)

If you want a publicly-reachable always-online booth, that's the role of `expo.smile-nola.com`, which is deployed from a different repo. This standalone image is designed for venue-local LAN service, not internet exposure.
```

- [ ] **Step 4: Create `docs/sync-protocol.md`**

```markdown
# Sync protocol

The booth pushes captured leads to a remote `INTAKE_SYNC_URL` over HTTPS.

## Endpoint

`POST <INTAKE_SYNC_URL>`

Default: `https://smile-nola.com/api/sync/inquiries`

## Headers

- `Authorization: Bearer <INTAKE_SYNC_TOKEN>` (required)
- `Content-Type: application/json` (required)

## Request body

```json
{
  "inquiries": [
    {
      "external_uuid": "string",
      "created_at":    "string (ISO 8601)",
      "first_name":    "string",
      "last_name":     "string",
      "email":         "string",
      "phone":         "string",
      "preferred_contact":      "string|null",
      "event_date":             "string|null",
      "venue":                  "string|null",
      "collections_interested": "string|null (JSON-encoded array)",
      "notes":                  "string|null",
      "partner1_name":          "string|null",
      "partner2_name":          "string|null",
      "event_setting":          "string|null",
      "poc_relationship":       "string|null"
    }
  ]
}
```

- Maximum batch size: 50 rows (client-side limit) or 200 (server-side limit). The booth never sends more than 50.
- `external_uuid` must be a valid UUID v4. Generated client-side at capture time.
- `created_at` must look like an ISO 8601 timestamp (`YYYY-MM-DDTHH:MM:SS`).

## Response

`200 OK` on success:

```json
{
  "ok": true,
  "results": [
    { "external_uuid": "...", "inserted": true,  "id": 42 },
    { "external_uuid": "...", "inserted": false, "id": 41 }
  ]
}
```

- `inserted: true` — server created a new row.
- `inserted: false` — server already had a row with this `external_uuid`; the call was a no-op.

Either way, the booth stamps `synced_at` locally and never sends the row again.

## Error responses

| Status | Meaning | Booth behavior |
|---|---|---|
| 401 | Bad token | Sync stops attempting; admin sees the error on `/api/sync/status` |
| 400 | Malformed payload (server validation) | Sync stops attempting; this is a bug, file an issue |
| 415 | Wrong content-type | Same as 400 |
| 500 | Server error (server-side INTAKE_SYNC_TOKEN missing, DB unreachable) | Silent retry on next tick |
| Network error | DNS, TCP, TLS, timeout | Silent retry on next tick |

## Idempotency

The server keys on `external_uuid`. Re-pushing the same row is safe — the response will say `inserted: false`. This is what makes the queue safe to retry blindly after any failure.

## Future evolution

- The server currently hardcodes `source = 'booth-expo'` for every accepted row. A future protocol revision will accept an optional `source` field so the standalone booth can stamp `'booth-standalone'`. Backward-compatible: today's booth omits the field; server accepts the omission and falls back.
- A future revision may accept a `booth_id` for fleet-level analytics.

Neither change is in scope for v0.1.0.
```

- [ ] **Step 5: Commit**

```bash
[booth]
git add README.md docs/architecture.md docs/deploying.md docs/sync-protocol.md
git commit -m "docs(booth): README and core doc set

README is the front door. docs/architecture.md describes internals,
docs/deploying.md gives per-host recipes (incl. Pi + Peplink notes),
docs/sync-protocol.md is the written contract with smile-nola.com."
```

---

## Execution choices

Plan complete and saved. Two execution options:

1. **Subagent-driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration on independent steps.
2. **Inline execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
