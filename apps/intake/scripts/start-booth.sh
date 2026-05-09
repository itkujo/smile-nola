#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# Smile NOLA Booth Launcher
# Builds (if needed) and starts the intake app on this machine, prints a
# QR code so the iPad on the same Wi-Fi can scan to open it.
# ----------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"

# Detect LAN IPv4 address (skip loopback + docker bridges)
detect_ip() {
  local ip
  # Prefer the route used to reach 1.1.1.1 (won't actually contact it)
  ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -n1 || true)"
  if [[ -n "${ip:-}" ]]; then
    echo "$ip"
    return
  fi
  # Fallback: first non-loopback inet
  hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1"
}

LAN_IP="$(detect_ip)"
URL="http://${LAN_IP}:${PORT}"

echo
echo "═══════════════════════════════════════════════════════════════"
echo "  ✦  Smile NOLA — Booth"
echo "      New Orleans Bridal & Wedding Expo"
echo "═══════════════════════════════════════════════════════════════"
echo

# Build if .next doesn't exist or BUILD=1 forces a fresh build
if [[ "${BUILD:-}" == "1" || ! -d ".next" ]]; then
  echo "  Building production bundle…"
  pnpm build
  echo
fi

echo "  Open this on your iPad (same Wi-Fi):"
echo "      ${URL}"
echo
echo "  Admin (laptop only):"
echo "      ${URL}/admin"
echo
echo "  CSV download:"
echo "      ${URL}/api/export"
echo
echo "  Scan to open on iPad:"
echo

# Print QR code if qrcode-terminal is installed
if [[ -d "node_modules/qrcode-terminal" ]]; then
  node -e "require('qrcode-terminal').generate(process.argv[1], { small: true })" "$URL" || true
else
  echo "  (Install qrcode-terminal to print a QR code: pnpm add -D qrcode-terminal)"
fi

echo
echo "  Press Ctrl-C to stop the booth."
echo "═══════════════════════════════════════════════════════════════"
echo

# Bind to all interfaces so the iPad on the LAN can reach us
exec pnpm next start -H 0.0.0.0 -p "${PORT}"
