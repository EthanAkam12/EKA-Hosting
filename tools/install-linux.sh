#!/bin/bash
# Installs EKA Website Builder on a Linux server (Ubuntu/Debian, or any
# system with Node.js 20+ and systemd), as a service that starts on boot.
#
#   sudo bash tools/install-linux.sh            # run from the unpacked builder folder
#
# It copies the builder to /opt/eka-builder, keeps websites in
# /var/lib/eka-builder, and runs it on port 3000 as the "eka" user.
# Put Caddy in front for HTTPS (see deploy/Caddyfile and the README).
set -euo pipefail

APP=/opt/eka-builder
DATA=/var/lib/eka-builder
SRC="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$(id -u)" != "0" ]; then echo "Please run this with sudo."; exit 1; fi

# Node.js 20 or newer.
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  if command -v apt-get >/dev/null; then
    echo "Installing Node.js 22..."
    apt-get update -y && apt-get install -y ca-certificates curl gnupg
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  else
    echo "Please install Node.js 20 or newer (https://nodejs.org), then run this again."; exit 1
  fi
fi

id eka >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin eka
mkdir -p "$APP" "$DATA"

echo "Copying the builder to $APP..."
if [ "$SRC" != "$APP" ]; then
  tar -C "$SRC" --exclude=./node_modules --exclude=./data --exclude=./.git --exclude=./settings.txt -cf - . | tar -C "$APP" -xf -
fi
cd "$APP"
npm ci --omit=dev --no-audit --no-fund

# Settings: made once, never overwritten.
if [ ! -f "$APP/settings.txt" ]; then
  PW="$(tr -dc 'A-HJ-NP-Za-km-z2-9' < /dev/urandom | head -c 16 | sed 's/.\{4\}/&-/g;s/-$//')"
  sed -e "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=$PW/" settings.example.txt | tr -d '\r' > settings.txt
  printf '\n# Server settings (added by install-linux.sh)\nDATA_DIR=%s\nNODE_ENV=production\nTRUST_PROXY=1\nHOST=127.0.0.1\n' "$DATA" >> settings.txt
  NEW_PASSWORD="$PW"
fi
chown -R eka:eka "$DATA"
chown root:eka settings.txt && chmod 640 settings.txt

cat > /etc/systemd/system/eka-builder.service <<UNIT
[Unit]
Description=EKA Website Builder
After=network.target

[Service]
Type=simple
User=eka
WorkingDirectory=$APP
ExecStart=$(command -v node) server/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now eka-builder
sleep 2
systemctl --no-pager --lines=5 status eka-builder || true

echo
echo "EKA Website Builder is running on http://127.0.0.1:3000/admin"
[ -n "${NEW_PASSWORD:-}" ] && echo "Administrator password: $NEW_PASSWORD  (saved in $APP/settings.txt)"
echo "Next: edit $APP/settings.txt (AI key, BASE_DOMAIN, email), then: sudo systemctl restart eka-builder"
echo "For HTTPS on your domain, install Caddy and use deploy/Caddyfile."
