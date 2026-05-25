#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# Smile NOLA Booth — Desktop Launcher (Stop)
#
# Invoked by the "Smile NOLA Booth — Stop" desktop icon. Cleanly shuts
# down the booth container:
#
#   docker compose -f docker-compose.booth.yml down
#
# The named volume (smile_nola_booth_data) is NOT removed — leads.db
# survives. To actually destroy the local database use:
#
#   docker compose -f docker-compose.booth.yml down -v
#
# (Only do that after confirming everything synced to prod via the admin
# at /admin or by running the sync drain endpoint.)
#
# Idempotent: safe to click multiple times. If the booth isn't running,
# says so and exits cleanly.
# ----------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.booth.yml"
CONTAINER_NAME="smile-nola-booth"

notify() {
  notify-send -i "$1" "Smile NOLA Booth" "$2" 2>/dev/null || echo "$2"
}

if ! command -v docker >/dev/null 2>&1; then
  notify dialog-error "Docker is not installed."
  exit 1
fi

# Already stopped?
if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  notify dialog-information "Booth is not running."
  exit 0
fi

# ---- Check unsynced row count BEFORE stopping ------------------------------
# Helpful diagnostic — operator should know if leads are still queued
# locally. We hit the booth's own status endpoint while it's still up.
PENDING=""
if PENDING_JSON="$(curl -fs -m 3 http://localhost:3000/api/sync/status 2>/dev/null)"; then
  PENDING="$(echo "$PENDING_JSON" | grep -oP '"pending":\s*\K[0-9]+' || true)"
fi

# ---- Bring down via compose ------------------------------------------------
docker compose -f "$COMPOSE_FILE" down 2>&1 | tail -3

if [[ -n "${PENDING:-}" && "$PENDING" -gt 0 ]]; then
  notify dialog-warning "Booth stopped. ⚠ $PENDING captured lead(s) had NOT synced to smile-nola.com yet. Don't 'down -v' the volume — they'll sync next start."
else
  notify dialog-information "Booth stopped cleanly. Database preserved."
fi
