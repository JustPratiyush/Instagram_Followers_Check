#!/bin/sh
# Build every icon size from icons/icon-source.png with an even black border around the
# artwork, then re-render the Chrome Web Store images that show the icon.
#
# Usage: sh store/build-icons.sh [border-percent]
#   border-percent  Border on each side, as a % of the icon size (default 8).
#                   The magnifier handle pokes into the border, so keep it at 7 or more.
#
# Needs node and a Chromium browser (Chrome, Brave or Chromium).

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/icons/icon-source.png"
BORDER="${1:-8}"

case "$BORDER" in
  ''|*[!0-9.]*) echo "Border must be a number (percent), e.g. 8" >&2; exit 1 ;;
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
var BORDER = $BORDER / 100;
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
  var W = img.width, H = img.height;
  var probe = document.createElement("canvas");
  probe.width = W; probe.height = H;
  var pctx = probe.getContext("2d");
  pctx.drawImage(img, 0, 0);
  var d = pctx.getImageData(0, 0, W, H).data;

  // The colourful gradient square is the artwork; the border is measured from it.
  var x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (var y = 0; y < H; y++) {
    for (var x = 0; x < W; x++) {
      var i = (y * W + x) * 4;
      var spread = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
      if (d[i + 3] > 200 && spread > 90) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  var side = Math.max(x1 - x0 + 1, y1 - y0 + 1);
  var crop = Math.round(side / (1 - 2 * BORDER));
  var cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2;

  // Square master: black border all round, artwork centred.
  var master = document.createElement("canvas");
  master.width = master.height = crop;
  var mctx = master.getContext("2d");
  mctx.fillStyle = "#000";
  mctx.fillRect(0, 0, crop, crop);
  mctx.drawImage(img, Math.round(crop / 2 - cx), Math.round(crop / 2 - cy));

  var out = { artwork: [x0, y0, x1, y1], master: crop, icons: {} };
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
const [outFile, root, border] = process.argv.slice(1);
const m = fs.readFileSync(outFile, "utf8").match(/<pre id="out">([\s\S]*?)<\/pre>/);
if (!m || !m[1].trim()) { console.error("Icon build failed: browser produced no output"); process.exit(1); }
const out = JSON.parse(m[1].replace(/&quot;/g, "\"").replace(/&amp;/g, "&"));
const write = (file, url) => fs.writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
for (const size of [16, 32, 48, 128, 256]) write(`${root}/icons/icon${size}.png`, out.icons[size]);
write(`${root}/store/_preview/icon512.png`, out.icons[512]);
console.log(`Built icons with a ${border}% border (artwork ${out.artwork.join(",")}, master ${out.master}px)`);
' "$TMP/out.html" "$ROOT" "$BORDER"

sh "$ROOT/store/render-graphics.sh"
