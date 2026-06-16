#!/usr/bin/env bash
# Downloads static assets that are not committed to the repository.
# Run once after cloning: npm run setup
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATIC_DIR="$SCRIPT_DIR/../static"

NIGHTLY="https://github.com/agda-web/agda-language-server/releases/download/nightly-20260407"
CACHE="https://github.com/jim9292bb/agda-scratchpad/releases/download/cache-2.8.0"

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

echo "Downloading ALS WASM binaries from agda-web/agda-language-server nightly-20260407..."
download "$NIGHTLY/als-2.6.4.3.wasm" "$STATIC_DIR/als-2.6.wasm"
download "$NIGHTLY/als-2.7.0.1.wasm" "$STATIC_DIR/als-2.7ext.wasm"
download "$NIGHTLY/als-2.8.0.wasm"   "$STATIC_DIR/als-2.8ext.wasm"

echo "Downloading Agda library source archives from GitHub..."
download "https://github.com/agda/agda-stdlib/archive/refs/tags/v2.3.zip" "$STATIC_DIR/agda-stdlib-2.3.zip"
download "https://github.com/agda/cubical/archive/refs/tags/v0.9.zip"     "$STATIC_DIR/agda-cubical-0.9.zip"

echo "Downloading pre-built Agda 2.8.0 cache from jim9292bb/agda-scratchpad cache-2.8.0..."
download "$CACHE/agda-data.zip"      "$STATIC_DIR/agda-data.zip"
download "$CACHE/stdlib-agdai.zip"   "$STATIC_DIR/stdlib-agdai.zip"
download "$CACHE/cubical-agdai.zip"  "$STATIC_DIR/cubical-agdai.zip"

if [[ -d "$STATIC_DIR/agdai/stdlib" && -d "$STATIC_DIR/agdai/cubical" ]]; then
  echo "  static/agdai/ already extracted — skipping (delete it to re-extract)"
else
  echo "Extracting .agdai files for on-demand serving..."
  node "$SCRIPT_DIR/extract-agdai-for-serving.mjs"
fi

echo "Done. Static assets are ready."
