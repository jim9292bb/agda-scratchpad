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

ab eval "(async () => {
  const errorsTab = Array.from(document.querySelectorAll('.messages-tab-group .messages-tab'))
    .find(button => button.textContent.trim().startsWith('Errors'))
  if (!errorsTab) throw new Error('Messages Errors tab missing')
  errorsTab.click()
  await new Promise(requestAnimationFrame)
  const panel = document.querySelector('.diagnostics-panel')
  if (!panel) throw new Error('Diagnostics panel missing')
  const text = panel.textContent
  if (!text.includes('/source.agda:5.7-8')) throw new Error('Diagnostic location missing: ' + text)
  if (!text.includes('NotInScope')) throw new Error('Diagnostic code missing: ' + text)
  if (!text.includes('Not in scope')) throw new Error('Diagnostic message missing: ' + text)
  return { ok: true, text }
})()"

echo "PASS diagnostics panel shows file, line, and column"

ab eval "(() => {
  const diagnostic = document.querySelector('.diagnostic-card.clickable')
  const view = document.querySelector('.cm-content')?.cmTile?.view
  const editor = document.querySelector('.cm-content')
  if (!diagnostic) throw new Error('Clickable diagnostic card missing')
  if (!view || !editor) throw new Error('Editor missing')
  diagnostic.click()
  const text = view.state.doc.toString()
  const expected = text.indexOf('x')
  const actual = view.state.selection.main.head
  if (expected < 0) throw new Error('Fixture marker x missing')
  if (actual !== expected) throw new Error('Diagnostic jump mismatch: expected ' + expected + ', got ' + actual)
  if (!editor.contains(document.activeElement)) throw new Error('Editor is not focused after diagnostic jump')
  return { ok: true, cursor: actual }
})()"

echo "PASS clicking diagnostic jumps to source position"

echo "browser-test-error-display: PASS"
