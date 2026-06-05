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
  const viewSelect = document.querySelector('.messages-view-select select')
  if (!viewSelect) throw new Error('Messages view select missing')
  viewSelect.value = 'errors'
  viewSelect.dispatchEvent(new Event('change', { bubbles: true }))
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

echo "browser-test-error-display: PASS"
