#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/browser-common.sh
source "$SCRIPT_DIR/browser-common.sh"

open_app

ab eval "(async () => {
  const picker = document.querySelector('.header-examples-wrap .header-examples-btn')
  if (!picker) throw new Error('Header examples picker button is missing')
  if (document.querySelector('.example-picker')) throw new Error('Old example panel should not be visible')
  const loadButton = Array.from(document.querySelectorAll('button'))
    .find(button => button.textContent.trim() === 'Load example')
  if (loadButton) throw new Error('Load example button should not be visible')
  const resetButton = Array.from(document.querySelectorAll('button'))
    .find(button => button.textContent.trim() === 'Reset to default Cubical example')
  if (resetButton) throw new Error('Reset example button should not be visible')
  picker.click()
  await new Promise(requestAnimationFrame)
  const item = Array.from(document.querySelectorAll('.header-examples-menu .header-examples-item'))
    .find(button => button.textContent.trim() === 'Query practice')
  if (!item) throw new Error('Query practice example item missing')
  item.click()
  return { ok: true }
})()"
ab wait 500 >/dev/null
assert_editor_contains "test : Bool" "Query example loads into editor"
assert_log_contains "Example loaded into editor." "Example picker writes log message"

ab eval "(async () => {
  const picker = document.querySelector('.header-examples-wrap .header-examples-btn')
  if (!picker) throw new Error('Header examples picker button is missing')
  picker.click()
  await new Promise(requestAnimationFrame)
  const item = Array.from(document.querySelectorAll('.header-examples-menu .header-examples-item'))
    .find(button => button.textContent.trim() === 'Cubical Prelude')
  if (!item) throw new Error('Cubical Prelude example item missing')
  item.click()
  return { ok: true }
})()"
ab wait 500 >/dev/null
assert_editor_contains "open import Cubical.Foundations.Prelude" "Default Cubical example is restored"

echo "browser-test-example-picker: PASS"
