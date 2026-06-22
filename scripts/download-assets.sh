#!/usr/bin/env bash
# Downloads library/ALS assets that are not committed to the repository,
# from the curated catalog driven by deploy.config.mjs (ALS versions and
# library combinations this deployment bundles) — see
# file-server/print-download-list.mjs.
#
# Downloads land in file-server/{library,als}/, never directly in static/.
# A self-deployer who wants to supply their own library/ALS files instead
# of the curated catalog download can skip this script entirely and place
# them in file-server/{library,als}/ by hand — download() below skips any
# file that already exists, so it's also safe to run this on top of
# manually-placed files (e.g. to fill in anything you didn't provide
# yourself). See file-server/README.md for the full picture.
#
# This only downloads — it does not touch static/. Run `npm run setup`
# afterward to sync file-server/{library,als}/ into static/ for serving.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGING_DIR="$SCRIPT_DIR/../file-server"

download() {
  local url="$1"
  local dest="$2"
  if [[ -f "$dest" ]]; then
    echo "  already exists: $(basename "$dest")"
    return 0
  fi
  echo "  downloading: $(basename "$dest")"
  curl -fL --progress-bar -o "$dest.tmp" "$url"
  mv "$dest.tmp" "$dest"
}

mkdir -p "$STAGING_DIR/library" "$STAGING_DIR/als"

echo "Downloading assets for the libraries/ALS versions configured in deploy.config.mjs..."
while IFS=$'\t' read -r url filename subdir; do
  download "$url" "$STAGING_DIR/$subdir/$filename"
done < <(node "$SCRIPT_DIR/../file-server/print-download-list.mjs")

echo "Done. Run 'npm run setup' next to prepare static/ for serving."
