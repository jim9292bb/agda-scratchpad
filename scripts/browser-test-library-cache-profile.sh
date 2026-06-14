#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/browser-common.sh
source "$SCRIPT_DIR/browser-common.sh"

cmd_load_entry_count() {
  local raw
  raw="$(ab eval "(() => {
    const entries = JSON.parse(document.querySelector('.messages-panel')?.dataset.performanceEntries ?? '[]')
    return entries.filter(entry => entry.label === 'Agda Cmd_load').length
  })()")"
  echo "$raw" | tail -n 1 | tr -cd '0-9'
}

wait_for_cmd_load_entry_count_at_least() {
  local expected="$1"
  local timeout_ms="${2:-45000}"
  local elapsed=0
  while (( elapsed < timeout_ms )); do
    local count
    count="$(cmd_load_entry_count)"
    if (( count >= expected )); then
      return 0
    fi
    ab wait 1000 >/dev/null
    elapsed=$((elapsed + 1000))
  done
  echo "Timed out waiting for $expected Agda Cmd_load performance entries." >&2
  return 1
}

open_app
start_als

set_editor_fixture "test-fixtures/agda/cubical-prelude.agda"

initial_cmd_loads="$(cmd_load_entry_count)"

click_button Load
wait_for_cmd_load_entry_count_at_least $((initial_cmd_loads + 1)) 45000

click_button Load
wait_for_cmd_load_entry_count_at_least $((initial_cmd_loads + 2)) 45000

assert_log_contains "Load finished." "Cubical Prelude double load finishes"
assert_log_not_matches "module not found|not in scope|library.*(not|could not|failed)|failed.*library|Could not find" "Cubical double load has no lookup errors"

ab eval "(() => {
  const panel = document.querySelector('.messages-panel')
  if (!panel) throw new Error('Messages panel is missing')
  const entries = JSON.parse(panel.dataset.performanceEntries || '[]')
  const cmdLoads = entries.filter(entry => entry.label === 'Agda Cmd_load')
  const driveLoads = entries.filter(entry => entry.label === 'Drive proxy after Cmd_load')
  if (cmdLoads.length < 2) throw new Error('Expected two Agda Cmd_load entries, got ' + cmdLoads.length)

  const summarize = (cmdLoad, driveLoad) => ({
    cmdLoadMs: cmdLoad.durationMs,
    proxyMs: driveLoad?.detail?.totalMs ?? 0,
    calls: driveLoad?.detail?.calls ?? 0,
    pathStatCount: driveLoad?.detail?.pathStatCount ?? 0,
    pathStatMs: driveLoad?.detail?.pathStatMs ?? 0,
    uniquePathStatPaths: driveLoad?.detail?.uniquePathStatPaths ?? 0,
    pathStatSuccesses: driveLoad?.detail?.pathStatSuccesses ?? 0,
    pathStatFailures: driveLoad?.detail?.pathStatFailures ?? 0,
    agdaiPathStat: driveLoad?.detail?.agdaiPathStat ?? 0,
    agdaiOpen: driveLoad?.detail?.agdaiOpen ?? 0,
    agdaiRead: driveLoad?.detail?.agdaiRead ?? 0,
    agdaiWrite: driveLoad?.detail?.agdaiWrite ?? 0,
  })

  const summary = {
    firstLoad: summarize(cmdLoads.at(-2), driveLoads.at(-2)),
    secondLoad: summarize(cmdLoads.at(-1), driveLoads.at(-1)),
  }

  if (summary.firstLoad.cmdLoadMs <= 0 || summary.secondLoad.cmdLoadMs <= 0) {
    throw new Error('Cmd_load timings must be positive: ' + JSON.stringify(summary))
  }

  return summary
})()"

echo "browser-test-library-cache-profile: PASS"
