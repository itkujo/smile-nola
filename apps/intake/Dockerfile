# =============================================================================
# Smile NOLA booth intake — production container
# Multi-stage build: deps -> build -> runtime
# Output: a small Node 22 image serving Next.js standalone on port 3000.
#
# Modeled on apps/site/Dockerfile. The two services share the same on-disk
# SQLite database (named volume `smile_nola_data` mounted at /data inside
# the container) but run as separate processes routed by Coolify at
# different domains (smile-nola.com vs expo.smile-nola.com).
# =============================================================================

ARG NODE_VERSION=22-alpine

# -----------------------------------------------------------------------------
# Stage 1: deps -- install all dependencies, compile better-sqlite3 against
# Alpine's libc.
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# Native build deps for better-sqlite3 + canvas-style packages.
RUN apk add --no-cache python3 make g++ libc6-compat

RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN corepack prepare --activate

# Frozen lockfile so the container build matches what the host generated.
RUN pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# Stage 2: build -- compile the Next.js app to .next/standalone.
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app

RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
# Telemetry off in CI/CD: it sometimes hangs on disconnected build hosts.
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# -----------------------------------------------------------------------------
# Stage 3: runtime -- minimal Node image that just runs the built server.
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

# better-sqlite3's prebuilt binary expects libc6-compat at runtime as well.
# tini is PID 1 so the container reaps zombies cleanly on Coolify SIGTERM.
RUN apk add --no-cache libc6-compat tini \
 && addgroup -S app && adduser -S app -G app

# Next standalone output layout:
#   .next/standalone/               minimal server.js + traced deps
#   .next/static/                   public-served static assets
#   public/                         everything from the source public dir
#
# We need all three. standalone/server.js expects the static + public dirs
# at the standard relative paths.
COPY --from=build --chown=app:app /app/.next/standalone   ./
COPY --from=build --chown=app:app /app/.next/static       ./.next/static
COPY --from=build --chown=app:app /app/public             ./public

# DB and any future on-disk artifacts live under /data inside the container,
# mounted from the shared named volume. Tell the app where to look.
ENV SMILE_NOLA_DB_DIR=/data \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# Ensure the data dir exists and is writable by the unprivileged user.
# When Coolify mounts the named volume, Docker auto-populates from the
# image's existing /data with the correct ownership.
RUN mkdir -p /data && chown -R app:app /data

USER app
EXPOSE 3000

# Tini reaps zombies cleanly on SIGTERM from Coolify.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "./server.js"]
