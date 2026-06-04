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

set_editor_fixture "test-fixtures/agda/error-not-in-scope.agda"
click_button Load
wait_for_log_matches "Load failed:|\\[NotInScope\\]|Not in scope" 30000

assert_log_matches "Load failed:|\\[NotInScope\\]|Not in scope" "Semantic not-in-scope error is reported"

echo "browser-test-error-display: PASS"
