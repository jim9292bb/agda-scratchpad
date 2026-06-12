#!/usr/bin/env bash
# Generates static/agda-data.zip from agda/agda v2.8.0 sources.
# Requires: agda 2.8.0 in $PATH, curl, python3
# Produces: static/agda-data.zip containing:
#   - lib/prim/ source files (Agda builtins)
#   - lib/prim/_build/2.8.0/agda/ .agdai cache (pre-compiled by agda --build-library)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATIC_DIR="$SCRIPT_DIR/../static"
DEST="$STATIC_DIR/agda-data.zip"

# Check prerequisites
if ! command -v agda >/dev/null 2>&1; then
  echo "error: 'agda' not found in PATH. Install Agda 2.8.0 first." >&2
  exit 1
fi
AGDA_VER=$(agda --version | head -1)
echo "Using: $AGDA_VER"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

PRIM_DIR="$TMPDIR/lib/prim"

echo "Downloading lib/prim sources from agda/agda v2.8.0..."
curl -fL --progress-bar \
  "https://github.com/agda/agda/archive/refs/tags/v2.8.0.tar.gz" | \
  tar -xz -C "$TMPDIR" --wildcards "agda-2.8.0/src/data/lib/prim/*"
mv "$TMPDIR/agda-2.8.0/src/data/lib" "$TMPDIR/lib"
rm -rf "$TMPDIR/agda-2.8.0"

# agda-lib file needed by --build-library
printf 'name: agda-builtins\ninclude: .\n' > "$PRIM_DIR/agda-builtins.agda-lib"

echo "Running agda --build-library..."
(cd "$PRIM_DIR" && Agda_datadir="$TMPDIR" agda --build-library 2>&1) | \
  grep -v "^$" | sed 's/^/  /'

AGDAI_COUNT=$(find "$PRIM_DIR/_build" -name "*.agdai" 2>/dev/null | wc -l)
echo "Generated $AGDAI_COUNT .agdai files"

echo "Packaging $DEST..."
python3 - <<PYEOF
import zipfile, os

prim_dir = "$PRIM_DIR"
dest = "$DEST"

base_dir = os.path.dirname(os.path.dirname(prim_dir))  # $TMPDIR, so paths are lib/prim/...

with zipfile.ZipFile(dest, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(prim_dir):
        for f in sorted(files):
            full = os.path.join(root, f)
            rel = os.path.relpath(full, base_dir)
            zf.write(full, rel)

print(f"  wrote {dest}")
PYEOF

TOTAL=$(python3 -c "import zipfile; z=zipfile.ZipFile('$DEST'); print(len([n for n in z.namelist() if not n.endswith('/')]))")
echo "Done. $DEST contains $TOTAL files."
