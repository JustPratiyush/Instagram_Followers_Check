#!/bin/sh
# Rebuild the Chrome Web Store upload folder from the repo.
# Zip the *contents* of cws-upload/ so manifest.json is at the ZIP root.

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/cws-upload"

rm -rf "$DEST"
mkdir -p "$DEST/icons" "$DEST/src"

cp "$ROOT/manifest.json" "$DEST/manifest.json"
cp -R "$ROOT/src/background" "$ROOT/src/content" "$ROOT/src/popup" "$DEST/src/"
cp "$ROOT/icons/icon16.png" "$ROOT/icons/icon32.png" "$ROOT/icons/icon48.png" \
   "$ROOT/icons/icon128.png" "$ROOT/icons/icon256.png" "$DEST/icons/"

# Strip junk macOS files if any slipped in
find "$DEST" -name ".DS_Store" -delete

echo "Ready to zip:"
echo "  rm -f \"$ROOT/cws-upload.zip\" && cd \"$DEST\" && zip -r ../cws-upload.zip . -x '*.DS_Store'"
find "$DEST" -type f | sort
