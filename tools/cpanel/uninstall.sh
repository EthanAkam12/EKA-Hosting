#!/bin/bash
# Removes the EKA Website Builder icon from cPanel. Run as root.
set -euo pipefail
if [ "$(id -u)" != "0" ]; then echo "Please run this as root."; exit 1; fi
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
cp "$HERE/files/install.json" "$HERE/files/eka_builder.svg" "$TMP/"
tar -czf "$TMP/eka_builder.tar.gz" -C "$TMP" install.json eka_builder.svg
/usr/local/cpanel/scripts/uninstall_plugin "$TMP/eka_builder.tar.gz" --theme jupiter || true
rm -rf "$TMP" /usr/local/cpanel/base/frontend/jupiter/eka_builder
rm -f /usr/local/cpanel/Cpanel/API/EKABuilder.pm /usr/local/cpanel/bin/admin/EKA/Builder /usr/local/cpanel/bin/admin/EKA/Builder.conf
rmdir /usr/local/cpanel/bin/admin/EKA 2>/dev/null || true
echo "Removed. Settings are kept in /etc/eka-builder (delete the folder to remove them)."
