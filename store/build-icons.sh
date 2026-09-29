#!/bin/sh
# Build every icon size from icons/icon-source.png as a full-bleed square with rounded
# (transparent) corners, then re-render the Chrome Web Store images that show the icon.
#
# Usage: sh store/build-icons.sh [radius-percent]
#   radius-percent  Corner radius, as a % of the icon size (default 22, like app icons).
#                   0 gives square corners; 50 gives a circle.
#
# Needs node and a Chromium browser (Chrome, Brave or Chromium).

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/icons/icon-source.png"
RADIUS="${1:-22}"

case "$RADIUS" in
  ''|*[!0-9.]*) echo "Radius must be a number (percent), e.g. 22" >&2; exit 1 ;;
esac
command -v node >/dev/null || { echo "node is required" >&2; exit 1; }

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

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
B64="$(base64 < "$SRC" | tr -d '\n')"

cat > "$TMP/build.html" <<EOF
<!doctype html><html><body><pre id="out"></pre><script>
var RADIUS = Math.min(50, $RADIUS) / 100;
var SIZES = [16, 32, 48, 128, 256, 512];

function scaled(src, size) {
  // Halve in steps first so small sizes stay sharp instead of aliased.
  var cur = src, w = src.width;
  while (w / 2 >= size * 1.5) {
    w = Math.round(w / 2);
    var step = document.createElement("canvas");
    step.width = step.height = w;
    var sctx = step.getContext("2d");
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(cur, 0, 0, w, w);
    cur = step;
  }
  var out = document.createElement("canvas");
  out.width = out.height = size;
  var octx = out.getContext("2d");
  octx.imageSmoothingQuality = "high";
  octx.drawImage(cur, 0, 0, size, size);
  return out.toDataURL("image/png");
}

var img = new Image();
img.onload = function () {
  // Centre-crop to a square, then clip the corners at full resolution so the
  // curve stays smooth once it's scaled down.
  var side = Math.min(img.width, img.height);
  var master = document.createElement("canvas");
  master.width = master.height = side;
  var mctx = master.getContext("2d");
  mctx.beginPath();
  mctx.roundRect(0, 0, side, side, side * RADIUS);
  mctx.clip();
  mctx.drawImage(
    img,
    (img.width - side) / 2, (img.height - side) / 2, side, side,
    0, 0, side, side
  );

  var out = { master: side, icons: {} };
  SIZES.forEach(function (s) { out.icons[s] = scaled(master, s); });
  document.getElementById("out").textContent = JSON.stringify(out);
};
img.src = "data:image/png;base64,$B64";
</script></body></html>
EOF

"$BROWSER" --headless=new --disable-gpu --virtual-time-budget=20000 \
  --dump-dom "file://$TMP/build.html" 2>/dev/null > "$TMP/out.html"

node -e '
const fs = require("fs");
const [outFile, root, radius] = process.argv.slice(1);
const m = fs.readFileSync(outFile, "utf8").match(/<pre id="out">([\s\S]*?)<\/pre>/);
if (!m || !m[1].trim()) { console.error("Icon build failed: browser produced no output"); process.exit(1); }
const out = JSON.parse(m[1].replace(/&quot;/g, "\"").replace(/&amp;/g, "&"));
const write = (file, url) => fs.writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
for (const size of [16, 32, 48, 128, 256]) write(`${root}/icons/icon${size}.png`, out.icons[size]);
write(`${root}/store/_preview/icon512.png`, out.icons[512]);
console.log(`Built icons with ${radius}% rounded corners (master ${out.master}px)`);
' "$TMP/out.html" "$ROOT" "$RADIUS"

sh "$ROOT/store/render-graphics.sh"
