#!/usr/bin/env bash
# Build the Safari version of Dooby (macOS only: needs Xcode).
#
# 1. scripts/stage-safari.js stages the extension with Safari adjustments
# 2. Apple's safari-web-extension-converter wraps it in an Xcode project with
#    a macOS app and an iOS app (each containing the extension)
# 3. xcodebuild compiles both, unsigned, to prove the project builds
#
# Output: <out>/extension, <out>/xcode, <out>/dooby-safari-xcode.zip
# Signing and App Store upload need an Apple Developer account and are not
# done here.
#
# Usage: scripts/build-safari.sh [out-dir]   (default: dist/safari)
#        DOOBY_BUNDLE_ID=com.example.dooby scripts/build-safari.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/dist/safari}"
BUNDLE_ID="${DOOBY_BUNDLE_ID:-cc.toolist.dooby}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
rm -rf "$OUT/extension" "$OUT/xcode" "$OUT/dooby-safari-xcode.zip"

node "$ROOT/scripts/stage-safari.js" "$OUT/extension"

xcrun safari-web-extension-converter "$OUT/extension" \
  --project-location "$OUT/xcode" \
  --app-name Dooby \
  --bundle-identifier "$BUNDLE_ID" \
  --swift \
  --copy-resources \
  --no-open \
  --no-prompt \
  --force

PROJ="$(find "$OUT/xcode" -maxdepth 3 -name '*.xcodeproj' | head -n 1)"
if [ -z "$PROJ" ]; then echo "converter produced no Xcode project" >&2; exit 1; fi
echo "Xcode project: $PROJ"
xcodebuild -list -project "$PROJ"

# Schemes are named after the app, e.g. "Dooby (macOS)" and "Dooby (iOS)".
SCHEMES="$(xcodebuild -list -json -project "$PROJ" | python3 -c 'import json,sys; print("\n".join(json.load(sys.stdin)["project"]["schemes"]))')"
MAC_SCHEME="$(echo "$SCHEMES" | grep -E '^Dooby \(macOS\)$' || true)"
IOS_SCHEME="$(echo "$SCHEMES" | grep -E '^Dooby \(iOS\)$' || true)"
if [ -z "$MAC_SCHEME" ] || [ -z "$IOS_SCHEME" ]; then echo "expected 'Dooby (macOS)' and 'Dooby (iOS)' schemes, got:"; echo "$SCHEMES"; exit 1; fi

COMMON=(-project "$PROJ" -configuration Debug CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" -derivedDataPath "$OUT/DerivedData")
xcodebuild "${COMMON[@]}" -scheme "$MAC_SCHEME" -destination 'generic/platform=macOS' build
xcodebuild "${COMMON[@]}" -scheme "$IOS_SCHEME" -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build

(cd "$OUT" && zip -qr -X dooby-safari-xcode.zip xcode)
echo "built $OUT/dooby-safari-xcode.zip"
