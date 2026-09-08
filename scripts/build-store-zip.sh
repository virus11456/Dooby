#!/usr/bin/env bash
# Build a Chrome Web Store upload package.
#
# - Strips the "key" field from manifest.json: the Web Store rejects a first
#   upload that contains it, and assigns its own key/ID to the listing.
# - Excludes repo-only files (README, icon generator, scripts, git metadata).
#
# Usage: scripts/build-store-zip.sh [output-dir]          (default: dist/)
#        scripts/build-store-zip.sh --dev [output-dir]    keeps the "key" so an
#        unpacked install gets the fixed ID dfoidibckihcnmakgoabkebinahggked
#        (needed for Google sign-in testing; never upload a --dev zip)
set -euo pipefail

DEV=0
if [ "${1:-}" = "--dev" ]; then DEV=1; shift; fi

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

DOOBY_KEEP_KEY="$DEV" python3 - "$ROOT/manifest.json" "$STAGE/dooby/manifest.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
import os
if os.environ.get('DOOBY_KEEP_KEY') != '1':
    m.pop('key', None)
with open(sys.argv[2], 'w') as f:
    json.dump(m, f, indent=2, ensure_ascii=False)
    f.write('\n')
PY

if [ "$DEV" = "1" ]; then ZIP="$OUT_DIR/dooby-$VERSION-dev-unpacked.zip"; else ZIP="$OUT_DIR/dooby-$VERSION-webstore.zip"; fi
rm -f "$ZIP"
(cd "$STAGE/dooby" && zip -qr -X "$ZIP" .)
echo "built $ZIP"
unzip -l "$ZIP" | tail -n +4 | head -n -2 | awk '{print "  " $4}'
