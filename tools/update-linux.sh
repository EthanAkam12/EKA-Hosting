#!/bin/bash
# Updates an EKA Website Builder installed with install-linux.sh.
#
#   sudo bash /opt/eka-builder/tools/update-linux.sh eka-builder-0.2.0.tar.gz
#   sudo bash /opt/eka-builder/tools/update-linux.sh https://…/eka-builder-0.2.0.tar.gz
#   sudo bash /opt/eka-builder/tools/update-linux.sh /path/to/new/unpacked/folder
#
# Backs up the websites and the current version first, and puts the old
# version back if the new one doesn't start. settings.txt and the websites
# are never touched.
set -euo pipefail

APP=/opt/eka-builder
SRC_ARG="${1:-}"
if [ "$(id -u)" != "0" ]; then echo "Please run this with sudo."; exit 1; fi
if [ -z "$SRC_ARG" ]; then echo "Give the new version: a .tar.gz file, its web address, or an unpacked folder."; exit 1; fi

DATA="$(grep -E '^DATA_DIR=' "$APP/settings.txt" | tail -1 | cut -d= -f2- | tr -d '\r')"
DATA="${DATA:-$APP/data}"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1. Get the new version.
case "$SRC_ARG" in
  http://*|https://*) curl -fsSL "$SRC_ARG" -o "$WORK/new.tar.gz"; mkdir "$WORK/new"; tar -xzf "$WORK/new.tar.gz" -C "$WORK/new" ;;
  *.tar.gz|*.tgz) mkdir "$WORK/new"; tar -xzf "$SRC_ARG" -C "$WORK/new" ;;
  *) [ -d "$SRC_ARG" ] || { echo "Can't find $SRC_ARG"; exit 1; }; mkdir "$WORK/new"; cp -a "$SRC_ARG/." "$WORK/new/" ;;
esac
NEW="$WORK/new"
# A tarball with one top folder: use that folder.
if [ ! -f "$NEW/package.json" ] && [ "$(ls -1 "$NEW" | wc -l)" = "1" ]; then NEW="$NEW/$(ls -1 "$NEW")"; fi
[ -f "$NEW/package.json" ] && [ -f "$NEW/server/index.js" ] || { echo "That doesn't look like EKA Website Builder."; exit 1; }
echo "Updating from $(node -p "require('$APP/package.json').version") to $(node -p "require('$NEW/package.json').version")..."

# 2. Back up the websites and the current version.
mkdir -p /var/backups/eka-builder
tar -czf "/var/backups/eka-builder/data-$STAMP.tar.gz" --exclude="$(basename "$DATA")/backups" -C "$(dirname "$DATA")" "$(basename "$DATA")"
tar -czf "/var/backups/eka-builder/app-$STAMP.tar.gz" -C "$APP" --exclude=./node_modules .
echo "Backed up to /var/backups/eka-builder/ (data-$STAMP and app-$STAMP)."

# 3. Swap in the new code (keeping settings.txt and any data folder inside the app).
systemctl stop eka-builder
tar -C "$NEW" --exclude=./node_modules --exclude=./data --exclude=./.git --exclude=./settings.txt -cf - . | tar -C "$APP" -xf -
cd "$APP"
npm ci --omit=dev --no-audit --no-fund
systemctl start eka-builder
systemctl restart eka-hq 2>/dev/null || true

# 4. Check it started; if not, put the old version back.
PORT="$(grep -E '^PORT=' settings.txt | tail -1 | cut -d= -f2- | tr -d '\r')"; PORT="${PORT:-3000}"
for i in $(seq 1 20); do
  if curl -fs "http://127.0.0.1:$PORT/api/public-info" >/dev/null; then
    echo "Updated to $(node -p "require('./package.json').version")."; exit 0
  fi
  sleep 1
done
echo "The new version didn't start. Putting the old one back..."
systemctl stop eka-builder
tar -xzf "/var/backups/eka-builder/app-$STAMP.tar.gz" -C "$APP"
npm ci --omit=dev --no-audit --no-fund
systemctl start eka-builder
echo "Restored the previous version. See: journalctl -u eka-builder -n 50"
exit 1
