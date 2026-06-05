#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/browser-common.sh
source "$SCRIPT_DIR/browser-common.sh"

load_and_wait() {
  click_button Load
  ab wait 1000 >/dev/null
  wait_for_log_contains "Load finished." 30000
}

damage_first_goal_end_boundary() {
  ab eval "(() => {
    const view = document.querySelector('.cm-content')?.cmTile?.view
    if (!view) throw new Error('missing CodeMirror view')
    const doc = view.state.doc.toString()
    const from = doc.indexOf('!}')
    if (from < 0) throw new Error('goal end boundary not found')
    view.dispatch({
      changes: { from, to: from + 2, insert: '!' },
      selection: { anchor: from + 1 },
    })
    view.focus()
    return { ok: true, text: view.state.doc.toString() }
  })()"
}

assert_goal_marker_count() {
  local expected="$1"
  ab eval "(() => {
    const expected = Number($expected)
    const markers = document.querySelectorAll('.agda-hole[data-goal-id]')
    if (markers.length !== expected) {
      throw new Error('Expected ' + expected + ' goal markers, got ' + markers.length)
    }
    return { ok: true, count: markers.length }
  })()"
  echo "PASS goal marker count: $expected"
}

assert_goal_markers_are_complete() {
  ab eval "(() => {
    const markers = Array.from(document.querySelectorAll('.agda-hole[data-goal-id]'))
    if (markers.length === 0) throw new Error('No goal markers found')
    const invalid = markers
      .map(marker => marker.textContent)
      .filter(text => !text.startsWith('{!') || !text.endsWith('!}'))
    if (invalid.length) {
      throw new Error('Incomplete goal marker text: ' + JSON.stringify(invalid))
    }
    return { ok: true, markers: markers.map(marker => marker.textContent) }
  })()"
  echo "PASS goal markers are complete"
}

open_app
start_als

set_editor_fixture "test-fixtures/agda/plus-case-split.agda" "?" 0
load_and_wait

assert_editor_contains "a + b = {!" "Load creates goal"
assert_goal_marker_count 1
assert_goal_markers_are_complete

damage_first_goal_end_boundary
assert_editor_contains "a + b = {!" "Damaged goal boundary remains in text"
assert_goal_marker_count 0

set_editor_fixture "test-fixtures/agda/plus-case-split.agda" "?" 0
load_and_wait

set_goal_content 0 "a"
press_agda_chord "c" "KeyC"
ab wait 6000

assert_editor_contains "z + b = {!   !}" "Case split zero clause"
assert_editor_contains "s a + b = {!   !}" "Case split successor clause"
assert_goal_marker_count 2
assert_goal_markers_are_complete

set_goal_content 0 "b"
press_agda_chord " " "Space"
ab wait 5000

assert_editor_contains "z + b = b" "Give fills first clause"
assert_editor_contains "s a + b = {!   !}" "Second goal remains"
assert_goal_marker_count 1
assert_goal_markers_are_complete

echo "browser-test-damaged-goal-boundaries: PASS"
