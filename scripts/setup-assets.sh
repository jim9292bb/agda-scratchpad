#!/usr/bin/env bash
# Prepares static/ for serving from whatever's already in
# file-server/{library,als}/ — does NOT download anything itself. Run
# `npm run auto-configure` first (to fetch this project's own shipped
# defaults) or place files in file-server/{library,als}/ by hand (see
# file-server/README.md) before running this.
#
# Run after cloning (and after file-server/{library,als}/ are populated):
#   npm run setup
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGING_DIR="$SCRIPT_DIR/../file-server"
STATIC_DIR="$SCRIPT_DIR/../static"

echo "Syncing file-server/{library,als}/ into static/..."
mkdir -p "$STATIC_DIR/library" "$STATIC_DIR/als"
cp "$STAGING_DIR"/library/* "$STATIC_DIR/library/" 2>/dev/null || true
cp "$STAGING_DIR"/als/* "$STATIC_DIR/als/" 2>/dev/null || true

echo "Verifying required assets are present..."
missing=0
while IFS=$'\t' read -r filename subdir; do
  if [[ ! -f "$STATIC_DIR/$subdir/$filename" ]]; then
    echo "  MISSING: $subdir/$filename" >&2
    missing=1
  fi
done < <(node "$SCRIPT_DIR/../file-server/print-required-files.mjs")

if [[ "$missing" -ne 0 ]]; then
  echo "" >&2
  echo "Some required library/ALS files are missing. Either:" >&2
  echo "  - run 'npm run auto-configure' to fetch this project's own shipped defaults, or" >&2
  echo "  - place them by hand in file-server/library/ or file-server/als/ (see file-server/README.md)" >&2
  echo "then re-run 'npm run setup'." >&2
  exit 1
fi

if [[ -d "$STATIC_DIR/agdai" ]]; then
  echo "  static/agdai/ already extracted — skipping (delete it to re-extract)"
else
  echo "Extracting .agdai files for on-demand serving..."
  node "$SCRIPT_DIR/../file-server/extract-agdai.mjs"
fi

echo "Done. Static assets are ready."
