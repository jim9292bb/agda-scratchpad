#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/browser-common.sh
source "$SCRIPT_DIR/browser-common.sh"

open_app
start_als

set_editor_fixture "test-fixtures/agda/error-syntax.agda"
click_button Load
wait_for_log_matches "Load failed:|\\[ParseError\\]|Parse error|syntax error" 30000

assert_log_matches "Load failed:|\\[ParseError\\]|Parse error|syntax error" "Syntax error is reported"
assert_errors_panel_contains "/source.agda:" "Syntax error includes source location"

set_editor_fixture "test-fixtures/agda/error-not-in-scope.agda"
click_button Load
wait_for_log_matches "Load failed:|\\[NotInScope\\]|Not in scope" 30000

assert_log_matches "Load failed:|\\[NotInScope\\]|Not in scope" "Semantic not-in-scope error is reported"
assert_errors_panel_contains "/source.agda:5.7" "Semantic error includes line and column"
assert_errors_panel_contains "NotInScope" "Semantic error includes code"

echo "browser-test-error-display: PASS"
