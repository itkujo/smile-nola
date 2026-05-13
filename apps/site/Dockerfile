# =============================================================================
# Smile NOLA marketing site — production container
# Multi-stage build: deps → build → runtime
# Output: a small Node 22 image serving Astro SSR on port 3000.
# =============================================================================

# Pinned to Alpine 3.22 (not :22-alpine which floats to 3.23+). Alpine 3.23's
# musl libc dropped the `fcntl64` symbol that better-sqlite3's prebuilt
# binary (from prebuild-install) expects, causing `Error relocating ...
# fcntl64: symbol not found` at first DB query. Pin until better-sqlite3
# publishes a prebuild against the newer musl, then bump.
ARG NODE_VERSION=22-alpine3.22

# -----------------------------------------------------------------------------
# Stage 1: deps  — install all dependencies (build + runtime), compile native
# better-sqlite3 against Alpine using build tools.
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# Native deps needed to build better-sqlite3 on Alpine.
RUN apk add --no-cache python3 make g++ libc6-compat

# Enable corepack so we get pnpm out of the box without a global install.
# We bring in package.json FIRST so corepack reads the pinned `packageManager`
# field and downloads exactly that pnpm version. Otherwise corepack pulls
# whatever's latest (which today is pnpm 11, whose script-approval behavior
# differs from the 10.x lockfile we generated on the host).
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN corepack prepare --activate

# Frozen lockfile = no surprises in CI/CD.
# The .npmrc whitelists native build scripts (better-sqlite3, esbuild, sharp)
# that pnpm 10 otherwise blocks by default.
RUN pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# Stage 2: build  — compile the Astro app to SSR output.
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app

RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
RUN pnpm build

# Prune devDependencies so the runtime image stays small.
RUN pnpm prune --prod

# -----------------------------------------------------------------------------
# Stage 3: runtime  — minimal Node image that just runs the built server.
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

# better-sqlite3's prebuilt binary expects libc6-compat at runtime as well.
RUN apk add --no-cache libc6-compat tini \
 && addgroup -S app && adduser -S app -G app

# Copy only what the server actually needs at runtime.
COPY --from=build --chown=app:app /app/dist           ./dist
COPY --from=build --chown=app:app /app/node_modules   ./node_modules
COPY --from=build --chown=app:app /app/package.json   ./package.json
COPY --from=build --chown=app:app /app/public         ./public

# VSCO Workspace config — resolved studio IDs from the bootstrap script.
# The push layer reads this file via process.cwd()+"/vsco-config.json".
# Non-secret (just ULIDs); the actual API key lives in VSCO_API_KEY env.
# Build context is apps/site/ (Coolify per-app build), so the file lives
# at /app/vsco-config.json in the build stage — not /app/apps/site/.
COPY --from=build --chown=app:app /app/vsco-config.json ./vsco-config.json

# The SQLite leads database lives at /data inside the container, mounted from
# the host (see docker-compose.yml). Tell the app to look there.
ENV SMILE_NOLA_DB_DIR=/data \
    NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# Ensure the data dir exists and is writable by the unprivileged user.
RUN mkdir -p /data && chown -R app:app /data

USER app
EXPOSE 3000

# Tini as PID 1 reaps zombies cleanly when Coolify SIGTERMs the container.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "./dist/server/entry.mjs"]
