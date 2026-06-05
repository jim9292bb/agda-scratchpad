#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/browser-common.sh
source "$SCRIPT_DIR/browser-common.sh"

open_app
start_als

set_editor_fixture "test-fixtures/agda/query-goal.agda" "{! n !}" 4

wait_for_button "Show commands" 30000

ab eval "(async () => {
  const toggle = Array.from(document.querySelectorAll('button'))
    .find(button => button.textContent.trim() === 'Show commands')
  if (!toggle) throw new Error('Show commands button missing')
  toggle.click()
  await new Promise(requestAnimationFrame)

  const panel = document.querySelector('.commands-panel')
  if (!panel) throw new Error('Commands panel missing')

  const style = getComputedStyle(panel)
  const buttons = Array.from(document.querySelectorAll('.command-button'))
  const labels = buttons.map(button => button.querySelector('.command-button-label')?.textContent?.trim())
  const expected = ['Load', 'Give', 'Case split', 'Goal type', 'Search about', 'Why in scope']
  const missing = expected.filter(label => !labels.includes(label))
  if (missing.length) throw new Error('Missing command buttons: ' + missing.join(', '))
  if (style.overflowY !== 'auto') throw new Error('Commands panel is not vertically scrollable')
  if (buttons.length < 15) throw new Error('Too few command buttons: ' + buttons.length)

  return {
    ok: true,
    count: buttons.length,
    overflowY: style.overflowY,
    maxHeight: style.maxHeight,
  }
})()"

echo "PASS commands panel renders command buttons"

ab eval "(() => {
  const load = Array.from(document.querySelectorAll('.command-button'))
    .find(button => button.textContent.includes('Load'))
  if (!load) throw new Error('Load command button missing')
  load.click()
  return { ok: true }
})()"

wait_for_log_contains "Load finished." 30000

assert_log_contains "Load finished." "Load command button runs Load"
assert_active_goal_contains "Goal 0" "Command panel Load updates goals"

ab eval "(async () => {
  const toggle = Array.from(document.querySelectorAll('button'))
    .find(button => button.textContent.trim() === 'Hide commands')
  if (!toggle) throw new Error('Hide commands button missing')
  toggle.click()
  await new Promise(requestAnimationFrame)
  if (document.querySelector('.commands-panel')) throw new Error('Commands panel is still visible')
  return { ok: true }
})()"

echo "PASS commands panel hides"
echo "browser-test-commands-panel: PASS"
