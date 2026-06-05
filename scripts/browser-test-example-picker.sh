#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/browser-common.sh
source "$SCRIPT_DIR/browser-common.sh"

open_app

ab eval "(() => {
  const select = document.querySelector('#scratchpad-example')
  if (!select) throw new Error('Example picker is missing')
  select.value = 'query-bool'
  select.dispatchEvent(new Event('change', { bubbles: true }))
  const button = Array.from(document.querySelectorAll('button'))
    .find(button => button.textContent.trim() === 'Load example')
  if (!button) throw new Error('Load example button is missing')
  button.click()
  return { ok: true }
})()"
ab wait 500 >/dev/null
assert_editor_contains "test : Bool" "Query example loads into editor"
assert_log_contains "Example loaded into editor." "Example picker writes log message"

ab eval "(() => {
  const button = Array.from(document.querySelectorAll('button'))
    .find(button => button.textContent.trim() === 'Reset to default Cubical example')
  if (!button) throw new Error('Reset default example button is missing')
  button.click()
  return { ok: true }
})()"
ab wait 500 >/dev/null
assert_editor_contains "open import Cubical.Foundations.Prelude" "Default Cubical example is restored"

echo "browser-test-example-picker: PASS"
