#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/browser-common.sh
source "$SCRIPT_DIR/browser-common.sh"

open_app
start_als

set_editor_fixture "test-fixtures/agda/idN-auto.agda" "{! !}" 3
load_agda
cursor_in_goal 0
press_agda_chord "a" "KeyA"
ab wait 5000

assert_editor_contains "idN n = n" "Auto fills idN"
assert_log_contains "Auto finished." "Auto finishes"

echo "browser-test-auto: PASS"
