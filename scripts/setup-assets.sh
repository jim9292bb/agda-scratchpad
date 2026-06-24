#!/usr/bin/env bash
# Prepares static/ for serving from whatever's already in
# deploy-assets/{library,als}/ — raw library source, raw .agdai files, raw
# ALS wasm/data, and an optional dependency-graph file. Does NOT download
# anything itself. Run `npm run auto-configure` first (to fetch this
# project's own shipped defaults) or place files in
# deploy-assets/{library,als}/ by hand (see deploy-assets/README.md) before
# running this.
#
# Run after cloning (and after deploy-assets/{library,als}/ are populated):
#   npm run setup
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_ASSETS="$SCRIPT_DIR/../deploy-assets"

echo "Verifying required assets are present..."
node "$DEPLOY_ASSETS/print-required-files.mjs"

echo "Building static/ from deploy-assets/{library,als}/..."
node "$DEPLOY_ASSETS/build-static-assets.mjs"

echo "Done. Static assets are ready."
