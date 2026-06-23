#!/usr/bin/env bash
# Prepares static/ for serving from whatever's already in
# file-server/{library,als}/ — raw library source, raw .agdai files, raw
# ALS wasm/data, and an optional dependency-graph file. Does NOT download
# anything itself. Run `npm run auto-configure` first (to fetch this
# project's own shipped defaults) or place files in
# file-server/{library,als}/ by hand (see file-server/README.md) before
# running this.
#
# Run after cloning (and after file-server/{library,als}/ are populated):
#   npm run setup
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILE_SERVER="$SCRIPT_DIR/../file-server"

echo "Verifying required assets are present..."
node "$FILE_SERVER/print-required-files.mjs"

echo "Building static/ from file-server/{library,als}/..."
node "$FILE_SERVER/build-static-assets.mjs"

echo "Done. Static assets are ready."
