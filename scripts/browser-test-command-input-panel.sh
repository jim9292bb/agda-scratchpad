#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/browser-common.sh
source "$SCRIPT_DIR/browser-common.sh"

open_app
start_als

set_editor_fixture "test-fixtures/agda/plus-case-split.agda" "?" 0
load_agda

press_agda_chord "c" "KeyC"
ab wait 1000

assert_command_prompt "Input for Case split"
assert_log_contains "Case split: enter command input in the Goals panel." "Case split opens command input panel"

submit_command_prompt "a"
ab wait 6000

assert_no_command_prompt
assert_editor_focused
assert_editor_contains "z + b = {!   !}" "Prompt submit case split zero clause"
assert_editor_contains "s a + b = {!   !}" "Prompt submit case split successor clause"

press_agda_chord "c" "KeyC"
ab wait 1000

assert_command_prompt "Input for Case split"
cancel_command_prompt
ab wait 500

assert_no_command_prompt
assert_editor_focused
assert_log_contains "Case split cancelled." "Cancel does not send command"

echo "browser-test-command-input-panel: PASS"
