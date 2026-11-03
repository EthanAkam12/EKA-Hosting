#!/bin/bash
# Makes the file you give to hosts: dist/eka-builder-<version>.tar.gz, from
# the last commit (so commit first). The licence server isn't included.
#
#   bash tools/make-release.sh
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="$(node -p "require('./package.json').version")"
if ! grep -q '"publicKey": "-----BEGIN' server/licence-config.json; then
  echo "Note: server/licence-config.json has no licence server yet, so this copy won't ask for a licence key."
  echo "      Run node licence-server/keys.mjs https://licence.yourdomain.com and commit first if you want it to."
fi
if [ -n "$(git status --porcelain)" ]; then echo "Note: you have uncommitted changes; they're NOT in the release."; fi
mkdir -p dist
git archive --format=tar.gz --prefix="eka-builder-$VERSION/" -o "dist/eka-builder-$VERSION.tar.gz" HEAD -- . ':(exclude)licence-server' ':(exclude)test' ':(exclude)dist'
echo "Made dist/eka-builder-$VERSION.tar.gz"
echo "Hosts install it with: tar -xzf eka-builder-$VERSION.tar.gz && sudo bash eka-builder-$VERSION/tools/install-linux.sh"
echo "and update with:       sudo bash /opt/eka-builder/tools/update-linux.sh eka-builder-$VERSION.tar.gz"
