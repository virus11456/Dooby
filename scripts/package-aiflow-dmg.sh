#!/bin/bash
set -euo pipefail
# macOS only. Input: the already-built, signed distribution ZIP (never an installed app).
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
version="${1:-0.3.9}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 2
stage="$(mktemp -d /private/tmp/aiflow-dmg.XXXXXX)"
trap 'rm -rf "$stage"' EXIT
/usr/bin/ditto -x -k "$repo_dir/downloads/AI-Agent-Flow-Mac-$version.zip" "$stage"
/usr/bin/xattr -cr "$stage/AI Agent Flow.app"
/usr/bin/codesign --verify --deep --strict "$stage/AI Agent Flow.app"
ln -s /Applications "$stage/Applications"
cp "$repo_dir/downloads/AI-Agent-Flow-Read-Me.txt" "$stage/Read-Me.txt"
/usr/bin/hdiutil create -volname 'AI Agent Flow' -srcfolder "$stage" -ov -format UDZO -fs HFS+ "$repo_dir/downloads/AI-Agent-Flow-Mac-$version.dmg"
/usr/bin/hdiutil verify "$repo_dir/downloads/AI-Agent-Flow-Mac-$version.dmg"
