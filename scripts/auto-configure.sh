#!/usr/bin/env bash
# Fetches this project's own shipped default library/ALS files into
# file-server/{library,als}/ — automating exactly the manual placement
# process described in file-server/README.md, for this project's own
# defaults specifically.
#
# This is NOT a generic, deploy.config.mjs-driven downloader. If you add a
# library/ALS version of your own to file-server/libraries.mjs or
# als-catalog.mjs, this script knows nothing about it — place that file in
# file-server/library/ or file-server/als/ by hand instead. See
# file-server/README.md.
#
# Safe to run even if some files are already there (by hand or from an
# earlier run): download() below skips anything that already exists.
#
# This only fetches — it does not touch static/. Run `npm run setup`
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

echo "Fetching this project's own shipped default assets..."

# library/ — stdlib 2.3, cubical 0.9, agda-categories 0.3.0: source archives
# and prebuilt .agdai cache zips.
download "https://github.com/agda/agda-stdlib/archive/refs/tags/v2.3.zip" \
  "$STAGING_DIR/library/agda-stdlib-2.3.zip"
download "https://github.com/jim9292bb/agda-playground/releases/download/cache-2.8.0/stdlib-agdai.zip" \
  "$STAGING_DIR/library/stdlib-agdai.zip"
download "https://github.com/agda/cubical/archive/refs/tags/v0.9.zip" \
  "$STAGING_DIR/library/agda-cubical-0.9.zip"
download "https://github.com/jim9292bb/agda-playground/releases/download/cache-2.8.0/cubical-agdai.zip" \
  "$STAGING_DIR/library/cubical-agdai.zip"
download "https://github.com/agda/agda-categories/archive/refs/tags/v0.3.0.zip" \
  "$STAGING_DIR/library/agda-categories-0.3.0.zip"
download "https://github.com/jim9292bb/agda-playground/releases/download/cache-2.8.0/agda-categories-agdai.zip" \
  "$STAGING_DIR/library/agda-categories-agdai.zip"

# als/ — ALS 2.8.0 WASM build and the Agda builtins data zip.
download "https://github.com/agda-web/agda-language-server/releases/download/nightly-20260407/als-2.8.0.wasm" \
  "$STAGING_DIR/als/als-2.8ext.wasm"
download "https://github.com/jim9292bb/agda-playground/releases/download/cache-2.8.0/agda-data.zip" \
  "$STAGING_DIR/als/agda-data.zip"

echo "Done. Run 'npm run setup' next to prepare static/ for serving."
