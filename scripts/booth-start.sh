#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# Smile NOLA Booth — Desktop Launcher (Start)
#
# Invoked by the "Smile NOLA Booth — Start" desktop icon. Brings up the
# booth container in Docker (the site image in booth mode):
#
#   docker compose -f docker-compose.booth.yml up -d
#
# Then prints the LAN URL + QR code in a Konsole window so the iPad on the
# venue Wi-Fi can scan it. The Konsole window also tails the container logs
# so you can see live submissions + sync activity. Closing the window does
# NOT stop the booth — use the Stop icon for a clean shutdown.
#
# Idempotent: if the booth container is already running, refuses to launch
# a duplicate and tells you to stop it first.
#
# Why Docker (vs. running pnpm directly):
#   • Same image as smile-nola.com, started with SMILE_NOLA_MODE=booth.
#     No "works in dev but not prod" gap.
#   • Sandboxed: the server cannot see anything outside the
#     container. Friendly when the booth Wi-Fi is hostile.
#   • Portable: leads.db lives in ./data next to the compose file. Moving to a
#     new laptop = copy the compose file and ./data.
#   • Survives reboots: `restart: unless-stopped` brings the booth back
#     automatically after a power cycle, exactly like prod.
# ----------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.booth.yml"
PORT="${PORT:-3000}"
CONTAINER_NAME="smile-nola-booth"

notify() {
  notify-send -i "$1" "Smile NOLA Booth" "$2" 2>/dev/null || true
  echo "$2"
}

# ---- Pre-flight: Docker available? ----------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  notify dialog-error "Docker is not installed. Install Docker Desktop or docker.io first."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  notify dialog-error "Docker daemon is not running. Start Docker and try again."
  exit 1
fi

# ---- Pre-flight: env file present? ----------------------------------------
# docker-compose.booth.yml reads apps/site/.env.booth (template:
# apps/site/.env.booth.example). Compose refuses to start without it, and
# without BOOTH_PROD_API_TOKEN the booth runs but never pushes leads to
# smile-nola.com: they pile up in the local SQLite. Refuse that silent mode.
ENV_FILE="$REPO_ROOT/apps/site/.env.booth"
if [[ ! -f "$ENV_FILE" ]]; then
  notify dialog-error "Missing $ENV_FILE. Copy apps/site/.env.booth.example to it and fill it in (see docs/BOOTH_SETUP.md)."
  exit 1
fi
if ! grep -Eq "^BOOTH_PROD_API_TOKEN=.+" "$ENV_FILE"; then
  notify dialog-warning "BOOTH_PROD_API_TOKEN is empty in $ENV_FILE. The booth will run offline-only and will not sync to prod."
fi

# ---- Pre-flight: already running? -----------------------------------------
if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  notify dialog-information "Booth is already running on port $PORT. Use Stop first to restart."
  exit 0
fi

# ---- Pre-flight: port collision (something else on :3000) -----------------
if ss -ltn "sport = :$PORT" 2>/dev/null | grep -q "LISTEN"; then
  notify dialog-warning "Port $PORT is already in use by something else. Free it up and try again."
  exit 1
fi

# ---- Detect LAN IP for the QR code ----------------------------------------
detect_ip() {
  local ip
  ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -n1 || true)"
  if [[ -n "${ip:-}" ]]; then echo "$ip"; return; fi
  hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1"
}
LAN_IP="$(detect_ip)"
URL="http://${LAN_IP}:${PORT}"

# ---- Launch the Konsole window that will pull/run + tail logs -------------
# We do the docker compose up INSIDE Konsole rather than out here so the
# operator sees the build progress (first time only, ~3-4 min for
# better-sqlite3 native compile against Alpine) and any failures.
exec konsole \
  --workdir "$REPO_ROOT" \
  --hold \
  -e bash -c "
    set -e
    echo '═══════════════════════════════════════════════════════════════'
    echo '  ✦  Smile NOLA — Booth'
    echo '═══════════════════════════════════════════════════════════════'
    echo
    echo '  Starting the booth in Docker. First launch pulls the image'
    echo '  from ghcr.io (~30-90s depending on connection). Subsequent'
    echo '  starts are ~5 seconds.'
    echo
    echo '  To use a local build instead of the published image, set'
    echo '  BOOTH_IMAGE=local before running this script.'
    echo

    docker compose -f '$COMPOSE_FILE' up -d

    # Wait until the container is actually serving requests, not just running.
    echo
    printf '  Waiting for booth to be ready'
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
      if curl -fs -o /dev/null -m 2 http://localhost:$PORT/api/v1/public/brand 2>/dev/null; then
        echo ' — ready.'
        break
      fi
      printf '.'
      sleep 2
    done

    echo
    echo '  Open this on your iPad (same Wi-Fi):'
    echo '      $URL/booth'
    echo
    echo '  Admin (this laptop only): leads, sync status, Drain now'
    echo '      $URL/admin/booth'
    echo
    echo '  Scan to open on iPad:'
    echo

    # Print QR (the qrcode-terminal package is in the build image's
    # node_modules — but exec'ing into the container just for printing
    # is heavy. We bind-mount nothing for that, so use a host fallback.)
    if command -v qrencode >/dev/null 2>&1; then
      qrencode -t ANSIUTF8 '$URL/booth'
    else
      echo '      (install qrencode for an ASCII QR: sudo apt install qrencode)'
      echo '      For now type the URL on the iPad manually.'
    fi

    echo
    echo '═══════════════════════════════════════════════════════════════'
    echo '  Live container logs (Ctrl-C to exit log view; booth stays up)'
    echo '═══════════════════════════════════════════════════════════════'
    docker compose -f '$COMPOSE_FILE' logs -f booth
  "
