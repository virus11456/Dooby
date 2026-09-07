#!/usr/bin/env bash
# Build a Chrome Web Store upload package.
#
# - Strips the "key" field from manifest.json: the Web Store rejects a first
#   upload that contains it, and assigns its own key/ID to the listing.
# - Excludes repo-only files (README, icon generator, scripts, git metadata).
#
# Usage: scripts/build-store-zip.sh [output-dir]   (default: dist/)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$ROOT/dist}"
VERSION="$(python3 -c "import json;print(json.load(open('$ROOT/manifest.json'))['version'])")"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/dooby" "$OUT_DIR"
for entry in _locales css icons js pages privacy-policy.html; do
  cp -R "$ROOT/$entry" "$STAGE/dooby/"
done
rm -f "$STAGE/dooby/icons/generate_icons.html"

python3 - "$ROOT/manifest.json" "$STAGE/dooby/manifest.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
m.pop('key', None)
with open(sys.argv[2], 'w') as f:
    json.dump(m, f, indent=2, ensure_ascii=False)
    f.write('\n')
PY

ZIP="$OUT_DIR/dooby-$VERSION-webstore.zip"
rm -f "$ZIP"
(cd "$STAGE/dooby" && zip -qr -X "$ZIP" .)
echo "built $ZIP"
unzip -l "$ZIP" | tail -n +4 | head -n -2 | awk '{print "  " $4}'
