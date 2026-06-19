#!/usr/bin/env bash
# Downloads static assets that are not committed to the repository.
# What gets downloaded is driven by deploy.config.mjs (ALS versions and
# library combinations this deployment bundles) — see file-server/print-download-list.mjs.
# Run once after cloning: npm run setup
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

echo "Downloading assets for the libraries/ALS versions configured in deploy.config.mjs..."
while IFS=$'\t' read -r url filename; do
  download "$url" "$STATIC_DIR/$filename"
done < <(node "$SCRIPT_DIR/../file-server/print-download-list.mjs")

if [[ -d "$STATIC_DIR/agdai" ]]; then
  echo "  static/agdai/ already extracted — skipping (delete it to re-extract)"
else
  echo "Extracting .agdai files for on-demand serving..."
  node "$SCRIPT_DIR/../file-server/extract-agdai.mjs"
fi

echo "Done. Static assets are ready."
