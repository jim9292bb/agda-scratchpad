#!/usr/bin/env bash
# Downloads static assets that are not committed to the repository.
# Run once after cloning: npm run setup
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATIC_DIR="$SCRIPT_DIR/../static"

NIGHTLY="https://github.com/agda-web/agda-language-server/releases/download/nightly-20260407"

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

echo "Done. Static assets are ready."
