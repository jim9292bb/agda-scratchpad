#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/browser-common.sh
source "$SCRIPT_DIR/browser-common.sh"

open_app
start_als

load_and_wait() {
  click_button Load
  ab wait 1000 >/dev/null
  wait_for_log_contains "Load finished." 30000
}

set_editor_fixture "test-fixtures/agda/plus-case-split.agda" "?" 0
load_and_wait

assert_editor_contains "a + b = {!" "Load creates a goal"
assert_log_contains "Load finished." "Load finishes"

set_goal_content 0 "a"
press_agda_chord "c" "KeyC"
ab wait 6000

assert_editor_contains "z + b = {!   !}" "Case split zero clause"
assert_editor_contains "s a + b = {!   !}" "Case split successor clause"

set_goal_content 0 "b"
press_agda_chord " " "Space"
ab wait 5000

assert_editor_contains "z + b = b" "Give fills first clause"
assert_editor_contains "s a + b = {!   !}" "Give leaves second goal"
assert_log_contains "Give finished." "Give finishes"

set_editor_fixture "test-fixtures/agda/idN-elaborate.agda" "{! n !}" 4
load_and_wait
cursor_in_goal 0
press_agda_chord "r" "KeyR"
ab wait 5000

assert_editor_contains "idN n = n" "Refine fills idN"
assert_log_contains "Refine finished." "Refine finishes"

set_editor_fixture "test-fixtures/agda/idN-auto.agda" "{! !}" 3
load_and_wait
cursor_in_goal 0
press_agda_chord "a" "KeyA"
ab wait 5000

assert_editor_contains "idN n = n" "Auto fills idN"
assert_log_contains "Auto finished." "Auto finishes"

set_editor_fixture "test-fixtures/agda/idN-elaborate.agda" "{! n !}" 4
load_and_wait
cursor_in_goal 0
press_agda_chord "m" "KeyM"
ab wait 5000

assert_editor_contains "idN n = n" "Elaborate and give fills idN"
assert_log_contains "Elaborate and give finished." "Elaborate and give finishes"

set_editor_fixture "test-fixtures/agda/idN-elaborate.agda" "{! n !}" 4
load_and_wait
cursor_in_goal 0
press_agda_chord "h" "KeyH"
ab wait 5000

assert_queries_contains "n : N" "Helper function type is reported"
assert_log_contains "Helper function type finished." "Helper function type finishes"

echo "browser-test-core-commands: PASS"
