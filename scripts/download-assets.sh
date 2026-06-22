#!/usr/bin/env bash
# Downloads library/ALS assets that are not committed to the repository.
# What gets downloaded is driven by deploy.config.mjs (ALS versions and
# library combinations this deployment bundles) — see file-server/print-download-list.mjs.
#
# Downloads land in file-server/{library,als}/, never directly in static/.
# A self-deployer who wants to supply their own library/ALS files instead of
# the curated catalog download can place them there by hand beforehand —
# download() below skips any file that already exists, so manual files are
# never overwritten. Either way, everything in file-server/{library,als}/
# then gets synced into static/{library,als}/, which is what actually gets
# served. See file-server/README.md for the full picture.
#
# Run once after cloning: npm run setup
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGING_DIR="$SCRIPT_DIR/../file-server"
STATIC_DIR="$SCRIPT_DIR/../static"

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

echo "Syncing file-server/{library,als}/ into static/..."
mkdir -p "$STATIC_DIR/library" "$STATIC_DIR/als"
cp "$STAGING_DIR"/library/* "$STATIC_DIR/library/" 2>/dev/null || true
cp "$STAGING_DIR"/als/* "$STATIC_DIR/als/" 2>/dev/null || true

if [[ -d "$STATIC_DIR/agdai" ]]; then
  echo "  static/agdai/ already extracted — skipping (delete it to re-extract)"
else
  echo "Extracting .agdai files for on-demand serving..."
  node "$SCRIPT_DIR/../file-server/extract-agdai.mjs"
fi

echo "Done. Static assets are ready."
