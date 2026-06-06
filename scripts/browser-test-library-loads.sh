#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/browser-common.sh
source "$SCRIPT_DIR/browser-common.sh"

open_app
start_als

ab eval "(() => {
  const panel = document.querySelector('.performance-summary')
  if (!panel) throw new Error('Performance summary is missing')
  const text = panel.textContent
  const expected = [
    'Fetch ALS WASM response',
    'Initialize ALS worker',
    'Fetch standard-library zip',
    'Fetch Cubical zip',
    'Extract standard-library zip',
    'Extract Cubical zip',
    'Run Agda --setup',
  ]
  const missing = expected.filter(label => !text.includes(label))
  if (missing.length) throw new Error('Missing performance timings: ' + missing.join(', ') + '\\n' + text)
  return { ok: true, text }
})()"

echo "PASS performance timings are shown for startup and library preparation"

set_editor_fixture "test-fixtures/agda/cubical-prelude.agda"
click_button Load
wait_for_log_contains "Load finished." 45000

assert_log_contains "Load finished." "Cubical Prelude loads"
assert_log_not_matches "module not found|not in scope|library.*(not|could not|failed)|failed.*library|Could not find" "Cubical load has no lookup errors"
ab eval "(() => {
  const text = document.querySelector('.performance-summary')?.textContent ?? ''
  if (!text.includes('Agda Cmd_load')) throw new Error('Cmd_load timing missing: ' + text)
  if (!text.includes('Agda token highlighting')) throw new Error('Token highlighting timing missing: ' + text)
  if (!text.includes('Sync source to virtual filesystem')) throw new Error('Source sync timing missing: ' + text)
  if (!text.includes('Drive proxy after Cmd_load')) throw new Error('Drive proxy Cmd_load stats missing: ' + text)
  if (!text.includes('calls')) throw new Error('Drive proxy call count missing: ' + text)
  if (!text.includes('read')) throw new Error('Drive proxy bytes read missing: ' + text)
  if (!text.match(/pathStat\\s+\\d+\\s+\\/\\s+(?:\\d+ms|\\d+\\.\\d+s)/)) throw new Error('Drive proxy method timing missing: ' + text)
  if (!text.includes('unique pathStat paths')) throw new Error('Drive proxy unique pathStat summary missing: ' + text)
  if (!text.includes('pathStat ok')) throw new Error('Drive proxy pathStat success/failure summary missing: ' + text)
  if (!text.includes('top pathStat:')) throw new Error('Drive proxy top pathStat summary missing: ' + text)
  if (!text.includes('top open:')) throw new Error('Drive proxy top open summary missing: ' + text)
  if (!text.includes('.agda pathStat')) throw new Error('.agda drive proxy stats missing: ' + text)
  if (!text.includes('.agdai pathStat')) throw new Error('.agdai drive proxy stats missing: ' + text)
  return { ok: true, text }
})()"
echo "PASS performance timings split Agda Load and drive proxy stats"

open_app
start_als

set_editor_fixture "test-fixtures/agda/stdlib-nat.agda"
click_button Load
wait_for_log_contains "Load finished." 180000

assert_log_contains "Load finished." "standard-library Data.Nat.Base loads"
assert_log_not_matches "module not found|not in scope|library.*(not|could not|failed)|failed.*library|Could not find" "standard-library load has no lookup errors"

echo "browser-test-library-loads: PASS"
