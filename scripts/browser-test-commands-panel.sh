#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/browser-common.sh
source "$SCRIPT_DIR/browser-common.sh"

open_app
start_als

set_editor_fixture "test-fixtures/agda/query-goal.agda" "{! n !}" 4

# ── Open the commands panel ──────────────────────────────────────────────────
ab eval "(async () => {
  const toggle = document.querySelector('.commands-panel-toggle')
  if (!toggle) throw new Error('Commands panel toggle button missing')
  toggle.click()
  await new Promise(r => setTimeout(r, 200))

  const panel = document.querySelector('.commands-panel')
  if (!panel) throw new Error('Commands panel missing after click')

  const buttons = Array.from(document.querySelectorAll('.command-button'))
  if (buttons.length < 15) throw new Error('Too few command buttons: ' + buttons.length)

  const texts = buttons.map(b => b.textContent.trim())
  // Load is C-c C-l, Give is C-c C-SPC, Case split is C-c C-c, Goal type is C-c C-t
  const expected = ['C-c C-l', 'C-c C-SPC', 'C-c C-c', 'C-c C-t']
  const missing = expected.filter(s => !texts.includes(s))
  if (missing.length) throw new Error('Missing command buttons: ' + missing.join(', '))

  const expanded = toggle.getAttribute('aria-expanded')
  if (expanded !== 'true') throw new Error('Toggle aria-expanded should be true, got: ' + expanded)

  return { ok: true, count: buttons.length, expanded }
})()"

echo "PASS commands panel renders command buttons"

# ── Click Load command (C-c C-l) ─────────────────────────────────────────────
load_agda

assert_log_contains "Load finished." "Load command button runs Load"
assert_active_goal_contains "Goal 0" "Command panel Load updates goals"

# ── Collapse the commands panel ──────────────────────────────────────────────
ab eval "(async () => {
  const toggle = document.querySelector('.commands-panel-toggle')
  if (!toggle) throw new Error('Commands panel toggle button missing')
  toggle.click()
  await new Promise(r => setTimeout(r, 200))
  const expanded = toggle.getAttribute('aria-expanded')
  if (expanded !== 'false') throw new Error('Toggle aria-expanded should be false after collapse, got: ' + expanded)
  const panel = document.querySelector('.commands-panel')
  if (panel) throw new Error('Commands panel should be hidden after collapse')
  return { ok: true, expanded }
})()"

echo "PASS commands panel hides"
echo "browser-test-commands-panel: PASS"
