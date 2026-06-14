#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/browser-common.sh
source "$SCRIPT_DIR/browser-common.sh"

open_app
start_als

set_editor_fixture "test-fixtures/agda/plus-case-split.agda" "?" 0
load_agda
ab wait 4000

assert_active_goal_contains "?0" "Active goal id"
assert_active_goal_contains "?0 : N" "Active goal type"
assert_active_goal_contains "a : N" "Active goal context includes a"
assert_active_goal_contains "b : N" "Active goal context includes b"

assert_log_contains "Load finished." "Load finishes"
assert_log_not_contains "a : N" "Silent goal detail query does not write context to log"
assert_log_not_contains "b : N" "Silent goal detail query does not write context to log"

echo "browser-test-goal-details: PASS"
