#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/browser-common.sh
source "$SCRIPT_DIR/browser-common.sh"

open_app
start_als

set_editor_fixture "test-fixtures/agda/plus-case-split.agda" "?" 0
load_agda

assert_editor_contains "{! !}" "Load creates goal"

set_goal_content 0 "a"
press_agda_chord "c" "KeyC"
ab wait 6000

assert_editor_contains "z + b = {!   !}" "Case split zero clause"
assert_editor_contains "s a + b = {!   !}" "Case split successor clause"

set_goal_content 0 "b"
press_agda_chord " " "Space"
ab wait 5000

assert_editor_contains "z + b = b" "Give fills first clause"
assert_editor_contains "s a + b = {!   !}" "Second goal remains"

echo "browser-test-goal-lifecycle: PASS"
