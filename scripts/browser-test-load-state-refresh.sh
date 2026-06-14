#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/browser-common.sh
source "$SCRIPT_DIR/browser-common.sh"

load_and_wait_for_log() {
  local expected="$1"
  click_button Load
  wait_for_log_matches "$expected" 45000
}

assert_selector_count_at_least() {
  local selector_json minimum label
  selector_json="$(json_string "$1")"
  minimum="$2"
  label="${3:-$1}"
  ab eval "(() => {
    const selector = $selector_json
    const minimum = Number($minimum)
    const count = document.querySelectorAll(selector).length
    if (count < minimum) {
      throw new Error('Expected at least ' + minimum + ' matches for ' + selector + ', got ' + count)
    }
    return { ok: true, selector, count }
  })()"
  echo "PASS selector count: $label"
}

assert_selector_count() {
  local selector_json expected label
  selector_json="$(json_string "$1")"
  expected="$2"
  label="${3:-$1}"
  ab eval "(() => {
    const selector = $selector_json
    const expected = Number($expected)
    const count = document.querySelectorAll(selector).length
    if (count !== expected) {
      throw new Error('Expected ' + expected + ' matches for ' + selector + ', got ' + count)
    }
    return { ok: true, selector, count }
  })()"
  echo "PASS selector count: $label"
}

assert_goals_empty() {
  ab eval "(() => {
    const empty = document.querySelector('.goals-empty')
    if (!empty || !empty.textContent.includes('No goals.')) {
      throw new Error('Goals panel is not empty')
    }
    return { ok: true, text: empty.textContent.trim() }
  })()"
  echo "PASS goals panel empty"
}

open_app
start_als

set_editor_fixture "test-fixtures/agda/plus-case-split.agda" "?" 0
load_and_wait_for_log "Load finished\\."

assert_log_contains "Load finished." "Initial Load finishes"
assert_selector_count ".goal-entry" 1 "Initial Load creates one goal card"
assert_selector_count ".agda-hole[data-goal-id]" 1 "Initial Load creates one goal marker"
assert_selector_count_at_least ".agda-datatype" 1 "Initial Load applies datatype highlighting"
assert_selector_count_at_least ".agda-inductiveconstructor" 1 "Initial Load applies constructor highlighting"
assert_selector_count_at_least ".agda-function" 1 "Initial Load applies function highlighting"

set_editor_fixture "test-fixtures/agda/error-not-in-scope.agda"
load_and_wait_for_log "Load failed:|\\[NotInScope\\]|Not in scope"

assert_log_matches "Load failed:|\\[NotInScope\\]|Not in scope" "Load reports semantic diagnostics"
assert_goals_empty
assert_selector_count ".goal-entry" 0 "Failed Load clears old goal card"
assert_selector_count ".agda-hole[data-goal-id]" 0 "Failed Load clears old goal marker"

set_editor_fixture "test-fixtures/agda/warning-incomplete-pattern.agda"
load_and_wait_for_log "Load finished\\.|CoverageIssue|warning|Missing cases"

assert_log_not_contains "Not in scope" "Warning Load replaces previous semantic error output"
assert_log_matches "CoverageIssue|warning|Missing cases" "Load reports coverage warning"
assert_selector_count ".goal-entry" 0 "Warning fixture has no goals"
assert_selector_count_at_least ".agda-datatype" 1 "Warning Load refreshes datatype highlighting"
assert_selector_count_at_least ".agda-inductiveconstructor" 1 "Warning Load refreshes constructor highlighting"
assert_selector_count_at_least ".agda-function" 1 "Warning Load refreshes function highlighting"

set_editor_fixture "test-fixtures/agda/query-goal.agda" "{! n !}" 4
load_and_wait_for_log "Load finished\\."

assert_log_contains "Load finished." "Final Load finishes"
assert_log_not_contains "Not in scope" "Final Load does not keep old semantic error"
assert_log_not_matches "CoverageIssue|Missing cases" "Final Load does not keep old warning"
assert_selector_count ".goal-entry" 1 "Final Load recreates goal card"
assert_selector_count ".agda-hole[data-goal-id]" 1 "Final Load recreates goal marker"
assert_active_goal_contains "?0" "Final Load active goal id"
assert_active_goal_contains "?0 : N" "Final Load active goal type"

echo "browser-test-load-state-refresh: PASS"
