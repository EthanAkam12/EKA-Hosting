#!/bin/bash
# Sets up a whole EKA Hosting server in one go: the website builder, EKA HQ,
# and Caddy for automatic HTTPS. For a fresh Ubuntu 24.04 (or 22.04) server.
#
#   sudo bash tools/install-server.sh ekahosting.co.uk you@example.com
#
# Afterwards:
#   https://builder.ekahosting.co.uk   the website builder (you and your customers)
#   https://hq.ekahosting.co.uk        EKA HQ (just you)
#   https://<name>.sites.ekahosting.co.uk   customers' websites before they have their own domain
#   ekahosting.co.uk                   your own website, once you add the domain to it in the builder
# Point these DNS records at this server's IP address first (A records):
#   builder, hq, sites, *.sites  (and @ and www for your own website)
set -euo pipefail

DOMAIN="${1:-}"; EMAIL="${2:-}"
if [ "$(id -u)" != "0" ]; then echo "Please run this with sudo."; exit 1; fi
if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then echo "Usage: sudo bash tools/install-server.sh yourdomain.co.uk you@example.com"; exit 1; fi
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/eka-builder
HQDATA=/var/lib/eka-hq
IP="$(curl -fs4 https://api.ipify.org || hostname -I | awk '{print $1}')"

echo "== 1/4 The website builder =="
bash "$SRC/tools/install-linux.sh"
set_setting() { # file key value: set or add KEY=value
  if grep -qE "^$2=" "$1"; then sed -i "s|^$2=.*|$2=$3|" "$1"; else printf '%s=%s\n' "$2" "$3" >> "$1"; fi
}
set_setting "$APP/settings.txt" BASE_DOMAIN "sites.$DOMAIN"
set_setting "$APP/settings.txt" BUILDER_URL "https://builder.$DOMAIN"
set_setting "$APP/settings.txt" SERVER_IP "$IP"
set_setting "$APP/settings.txt" COOKIE_SECURE 1
systemctl restart eka-builder
for i in $(seq 1 30); do [ -f /var/lib/eka-builder/.host-api-key ] && break; sleep 1; done
HOSTKEY="$(cat /var/lib/eka-builder/.host-api-key 2>/dev/null || true)"

echo "== 2/4 EKA HQ =="
mkdir -p "$HQDATA"
if [ ! -f "$APP/hq-settings.txt" ]; then
  HQPW="$(tr -dc 'A-HJ-NP-Za-km-z2-9' < /dev/urandom | head -c 16 | sed 's/.\{4\}/&-/g;s/-$//')"
  tr -d '\r' < "$APP/hq-settings.example.txt" > "$APP/hq-settings.txt"
  set_setting "$APP/hq-settings.txt" HQ_PASSWORD "$HQPW"
  set_setting "$APP/hq-settings.txt" HQ_URL "https://hq.$DOMAIN"
  set_setting "$APP/hq-settings.txt" BUILDER_URL "http://127.0.0.1:3000"
  set_setting "$APP/hq-settings.txt" BUILDER_API_KEY "$HOSTKEY"
  printf '\n# Server settings (added by install-server.sh)\nHQ_DATA_DIR=%s\nHQ_HOST=127.0.0.1\nCOOKIE_SECURE=1\n' "$HQDATA" >> "$APP/hq-settings.txt"
fi
chown -R eka:eka "$HQDATA"
chown root:eka "$APP/hq-settings.txt" && chmod 640 "$APP/hq-settings.txt"
cat > /etc/systemd/system/eka-hq.service <<UNIT
[Unit]
Description=EKA HQ
After=network.target eka-builder.service

[Service]
Type=simple
User=eka
WorkingDirectory=$APP
ExecStart=$(command -v node) hq/server/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$HQDATA

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now eka-hq

echo "== 3/4 HTTPS (Caddy) =="
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi
cat > /etc/caddy/Caddyfile <<CADDY
{
	email $EMAIL
	on_demand_tls {
		ask http://127.0.0.1:3000/_tls-check
	}
}

builder.$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}

hq.$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3100
}

# Customers' websites (name.sites.$DOMAIN), their own domains, and your own website.
https:// {
	tls {
		on_demand
	}
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}
CADDY
systemctl reload caddy || systemctl restart caddy

echo "== 4/4 Firewall =="
if command -v ufw >/dev/null; then ufw allow OpenSSH >/dev/null; ufw allow 80,443/tcp >/dev/null; ufw --force enable >/dev/null; fi

echo
echo "All done. This server's IP address is $IP."
echo "  Builder: https://builder.$DOMAIN/admin   password: $(grep -E '^ADMIN_PASSWORD=' $APP/settings.txt | cut -d= -f2-)"
echo "  HQ:      https://hq.$DOMAIN              password: $(grep -E '^HQ_PASSWORD=' $APP/hq-settings.txt | cut -d= -f2-)"
echo "Next: add your AI key to $APP/settings.txt and $APP/hq-settings.txt, and WHMCS + phone details"
echo "to hq-settings.txt, then: sudo systemctl restart eka-builder eka-hq"
