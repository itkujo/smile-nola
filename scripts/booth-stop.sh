#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# Smile NOLA Booth — Desktop Launcher (Stop)
#
# Invoked by the "Smile NOLA Booth — Stop" desktop icon. Cleanly shuts
# down the booth container:
#
#   docker compose -f docker-compose.booth.yml down
#
# The data directory (./data, bind-mounted at /data) is NOT touched — leads.db
# survives. To actually destroy the local database, delete ./data by hand
# (only after /admin/booth shows nothing waiting for prod).
#
# Idempotent: safe to click multiple times. If the booth isn't running,
# says so and exits cleanly.
# ----------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
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
# locally. The status operation needs a credential, so read the bind-mounted
# database directly (needs the sqlite3 CLI on the host; skipped if absent).
PENDING=""
DB_FILE="$REPO_ROOT/data/leads.db"
if command -v sqlite3 >/dev/null 2>&1 && [[ -f "$DB_FILE" ]]; then
  PENDING="$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM inquiries WHERE source='booth-expo' AND synced_at IS NULL AND deleted_at IS NULL;" 2>/dev/null || true)"
fi

# ---- Bring down via compose ------------------------------------------------
docker compose -f "$COMPOSE_FILE" down 2>&1 | tail -3

if [[ -n "${PENDING:-}" && "$PENDING" -gt 0 ]]; then
  notify dialog-warning "Booth stopped. ⚠ $PENDING captured lead(s) had NOT synced to smile-nola.com yet. Keep ./data; they'll sync on the next start."
else
  notify dialog-information "Booth stopped cleanly. Database preserved."
fi
