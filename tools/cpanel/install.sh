#!/bin/bash
# Installs the EKA Website Builder icon in cPanel (Jupiter theme).
# Run as root on the cPanel server:
#   bash install.sh https://builder.yourhost.com YOUR_HOST_API_KEY
# The address and key are on the builder's Customers page.
set -euo pipefail

if [ "$(id -u)" != "0" ]; then echo "Please run this as root."; exit 1; fi
if [ ! -d /usr/local/cpanel ]; then echo "cPanel isn't installed on this server."; exit 1; fi
HERE="$(cd "$(dirname "$0")" && pwd)"

URL="${1:-}"; KEY="${2:-}"
[ -n "$URL" ] || read -rp "Builder address (e.g. https://builder.yourhost.com): " URL
[ -n "$KEY" ] || { read -rsp "Host API key: " KEY; echo; }
if [ -z "$URL" ] || [ -z "$KEY" ]; then echo "The address and key are both needed."; exit 1; fi

# 1. Settings, readable only by root.
install -d -m 700 /etc/eka-builder
if [ -f /etc/eka-builder/config ]; then cp /etc/eka-builder/config /etc/eka-builder/config.bak; fi
umask 077
cat > /etc/eka-builder/config <<CONF
# EKA Website Builder (cPanel plugin)
url=$URL
key=$KEY
# Optional: which builder plan each cPanel package gets, e.g.
# plans=Basic:starter,Business:business
plans=
# The plan for packages not listed above (empty = the builder's first plan).
default_plan=
# A name for this server, if you have several (used to tell customers apart).
server_name=$(hostname)
CONF
chmod 600 /etc/eka-builder/config

# 2. The root-run part (AdminBin) and the UAPI call the plugin page uses.
install -d -m 755 /usr/local/cpanel/bin/admin/EKA
install -m 700 "$HERE/files/Builder" /usr/local/cpanel/bin/admin/EKA/Builder
install -m 644 "$HERE/files/Builder.conf" /usr/local/cpanel/bin/admin/EKA/Builder.conf
install -m 644 "$HERE/files/EKABuilder.pm" /usr/local/cpanel/Cpanel/API/EKABuilder.pm

# 3. The page and the icon.
install -d -m 755 /usr/local/cpanel/base/frontend/jupiter/eka_builder
install -m 644 "$HERE/files/index.live.php" /usr/local/cpanel/base/frontend/jupiter/eka_builder/index.live.php
TMP="$(mktemp -d)"
cp "$HERE/files/install.json" "$HERE/files/eka_builder.svg" "$TMP/"
tar -czf "$TMP/eka_builder.tar.gz" -C "$TMP" install.json eka_builder.svg
/usr/local/cpanel/scripts/install_plugin "$TMP/eka_builder.tar.gz" --theme jupiter
rm -rf "$TMP"

echo
echo "Done. 'Website Builder' is now in cPanel under Domains."
echo "Turn it on or off per package in WHM > Feature Manager (feature: eka_builder)."
echo "To map cPanel packages to builder plans, edit /etc/eka-builder/config."
