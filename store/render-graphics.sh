#!/bin/sh
# Re-render the Chrome Web Store screenshots and promo tiles from store/_preview/*.html.
# Uses Google Chrome if installed, otherwise Brave or Chromium (any Chromium browser works).

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PREVIEW="$ROOT/store/_preview"
OUT="$ROOT/store/graphics"

BROWSER=""
for candidate in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
  if [ -x "$candidate" ]; then
    BROWSER="$candidate"
    break
  fi
done
if [ -z "$BROWSER" ]; then
  echo "No Chromium-based browser found in /Applications" >&2
  exit 1
fi

shot() {
  "$BROWSER" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 --window-size="$2" \
    --screenshot="$OUT/$3" "file://$PREVIEW/$1" 2>/dev/null
}

shot 01-popup.html 1280,800 screenshot-01-popup.png
shot 02-start.html 1280,800 screenshot-02-start.png
shot 03-scanning.html 1280,800 screenshot-03-scanning.png
shot 04-results.html 1280,800 screenshot-04-results.png
# Promotional screenshots (1280x800, the store's screenshot size), also shown in the README.
shot promo-1-overview.html 1280,800 promo-1-overview.png
shot promo-2-lists.html 1280,800 promo-2-lists.png
shot promo-3-actions.html 1280,800 promo-3-actions.png
shot promo-4-live-scan.html 1280,800 promo-4-live-scan.png
shot promo-5-privacy.html 1280,800 promo-5-privacy.png
shot promo-small.html 440,280 promo-small-440x280.png
shot promo-marquee.html 1400,560 promo-marquee-1400x560.png
cp "$ROOT/icons/icon128.png" "$OUT/store-icon-128.png"

echo "Rendered store graphics into $OUT"
