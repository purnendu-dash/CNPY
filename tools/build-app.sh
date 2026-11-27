#!/usr/bin/env bash
# Builds dist/Islet.app from the Electron runtime in node_modules.
# Ad-hoc signed, so it runs locally without an Apple developer certificate.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/node_modules/electron/dist/Electron.app"
APP="$ROOT/dist/Islet.app"
PLIST="$APP/Contents/Info.plist"
BUNDLE_ID="${BUNDLE_ID:-pro.islet.app}"
VERSION="$(bun -e 'console.log(require("./package.json").version)' 2>/dev/null || echo 0.1.0)"

[ -d "$SRC" ] || { echo "missing Electron runtime at $SRC — run: bun install" >&2; exit 1; }

rm -rf "$APP"
mkdir -p "$ROOT/dist"
cp -R "$SRC" "$APP"
rm -f "$APP/Contents/Resources/default_app.asar"
mv "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/Islet"

setkey() {
  plutil -replace "$1" -string "$2" "$PLIST" 2>/dev/null ||
    plutil -insert "$1" -string "$2" "$PLIST"
}

setkey CFBundleExecutable Islet
setkey CFBundleName Islet
setkey CFBundleDisplayName Islet
setkey CFBundleIdentifier "$BUNDLE_ID"
setkey CFBundleShortVersionString "$VERSION"
setkey CFBundleVersion 1
setkey LSApplicationCategoryType public.app-category.utilities
# Shown in the Automation consent prompt, and why TCC lists the app as Islet.
setkey NSAppleEventsUsageDescription \
  "Islet reads what is playing in Music and Spotify so it can show the current track and its lyrics in the island."

RES="$APP/Contents/Resources/app"
rm -rf "$RES"
mkdir -p "$RES"
cp "$ROOT/package.json" "$ROOT/main.js" "$ROOT/preload.js" "$RES/"
cp -R "$ROOT/lib" "$ROOT/renderer" "$RES/"

xattr -cr "$APP"
codesign --force --deep --sign - "$APP"
codesign --verify --strict "$APP"

echo "built $APP"
echo "  bundle id: $BUNDLE_ID"
