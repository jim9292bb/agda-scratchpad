#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/browser-common.sh
source "$SCRIPT_DIR/browser-common.sh"

open_app

ab eval "(async () => {
  const select = document.querySelector('#control-card-profile-select')
  if (!select) throw new Error('Profile select not found below the ALS control card')
  const option = Array.from(select.options).find(o => o.value.includes('agda-categories'))
  if (!option) throw new Error('agda-categories profile option not found in select')
  select.value = option.value
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await new Promise(r => setTimeout(r, 150))
  return { ok: true, selected: option.value }
})()"

start_als

set_editor_fixture "test-fixtures/agda/agda-categories-smoke.agda"

click_button Load
wait_for_log_contains "Load finished." 60000

assert_log_contains "Load finished." "agda-categories module loads via the new profile"
assert_log_not_matches "module not found|not in scope|library.*(not|could not|failed)|failed.*library|Could not find" "agda-categories load has no library lookup errors"

# The fixture's import is deep (dozens of agda-categories + stdlib modules
# transitively). If the prebuilt .agdai cache isn't actually being used,
# Agda falls back to recompiling each one from source and prints a
# "Checking <module>" line per module — catches a regression of the
# /_build/ on-demand-fetch path-prefix check in als-wasi-shim.ts silently
# only matching specific hardcoded library folder names again.
assert_log_not_matches "Checking Categories\." "agda-categories load uses the prebuilt .agdai cache (no per-module recompile)"

ab eval "(() => {
  const text = document.querySelector('.cm-content')?.textContent || ''
  if (!text.includes('idCategoryGoal')) throw new Error('Expected fixture content not found in editor')
})()"

echo "browser-test-agda-categories-smoke: PASS"
