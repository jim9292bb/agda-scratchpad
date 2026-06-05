#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/browser-common.sh
source "$SCRIPT_DIR/browser-common.sh"

open_app

ab eval "(() => {
  const select = document.querySelector('.header-example-picker #scratchpad-example')
  if (!select) throw new Error('Header example picker is missing')
  if (document.querySelector('.example-picker')) throw new Error('Old example panel should not be visible')
  const loadButton = Array.from(document.querySelectorAll('button'))
    .find(button => button.textContent.trim() === 'Load example')
  if (loadButton) throw new Error('Load example button should not be visible')
  const resetButton = Array.from(document.querySelectorAll('button'))
    .find(button => button.textContent.trim() === 'Reset to default Cubical example')
  if (resetButton) throw new Error('Reset example button should not be visible')
  select.value = 'query-bool'
  select.dispatchEvent(new Event('change', { bubbles: true }))
  return { ok: true }
})()"
ab wait 500 >/dev/null
assert_editor_contains "test : Bool" "Query example loads into editor"
assert_log_contains "Example loaded into editor." "Example picker writes log message"

ab eval "(() => {
  const select = document.querySelector('.header-example-picker #scratchpad-example')
  if (!select) throw new Error('Header example picker is missing')
  select.value = 'cubical-prelude'
  select.dispatchEvent(new Event('change', { bubbles: true }))
  return { ok: true }
})()"
ab wait 500 >/dev/null
assert_editor_contains "open import Cubical.Foundations.Prelude" "Default Cubical example is restored"

echo "browser-test-example-picker: PASS"
