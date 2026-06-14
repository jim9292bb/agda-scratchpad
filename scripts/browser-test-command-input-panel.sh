#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/browser-common.sh
source "$SCRIPT_DIR/browser-common.sh"

open_app
start_als

set_editor_fixture "test-fixtures/agda/plus-case-split.agda" "?" 0
load_agda

press_agda_chord "c" "KeyC"
ab wait 1000

assert_command_prompt "Input for Case split"
assert_log_contains "Case split: enter command input in the Goals panel." "Case split opens command input panel"

# ── Unicode IM inside the command input prompt ────────────────────────────────
press_prompt_key() {
  local key_json code_json
  key_json="$(json_string "$1")"
  code_json="$(json_string "${2:-}")"
  ab eval "(() => {
    const key = $key_json
    const code = $code_json || ('Key' + key.toUpperCase())
    const input = document.querySelector('#command-input')
    if (!input) throw new Error('command input missing')
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }))
    return { ok: true, key }
  })()"
}

press_prompt_key "\\" "Backslash"
ab wait 300
ab eval "(() => {
  const tooltip = document.querySelector('.agda-im-tooltip')
  if (!tooltip) throw new Error('IM tooltip not visible after \\\\ in prompt')
  if (!tooltip.textContent.includes('+')) throw new Error('IM tooltip missing key-suggestions row')
  return { ok: true, text: tooltip.textContent.trim().slice(0, 60) }
})()"
echo "PASS IM activates in command input prompt"

press_prompt_key "t" "KeyT"
press_prompt_key "o" "KeyO"
ab wait 200
ab eval "(() => {
  const tooltip = document.querySelector('.agda-im-tooltip')
  if (!tooltip) throw new Error('IM tooltip not visible after \\\\to')
  const cands = [...tooltip.querySelectorAll('.agda-im-cand')].map(el => el.childNodes[0]?.textContent ?? el.textContent)
  if (!cands.includes('→')) throw new Error('→ not in candidates: ' + JSON.stringify(cands))
  return { ok: true, cands }
})()"
echo "PASS \\to shows → candidate in prompt tooltip"

press_prompt_key "Tab" "Tab"
ab wait 200
ab eval "(() => {
  const tooltip = document.querySelector('.agda-im-tooltip')
  if (tooltip) throw new Error('IM tooltip still visible after Tab')
  const input = document.querySelector('#command-input')
  if (input.value !== '→') throw new Error('Expected → in input after Tab, got: ' + JSON.stringify(input.value))
  return { ok: true, value: input.value }
})()"
echo "PASS Tab confirms → in command input prompt"

# ── Now submit with 'a' for the actual case split test ───────────────────────
submit_command_prompt "a"
ab wait 6000

assert_no_command_prompt
assert_editor_focused
assert_editor_contains "z + b = {!   !}" "Prompt submit case split zero clause"
assert_editor_contains "s a + b = {!   !}" "Prompt submit case split successor clause"

press_agda_chord "c" "KeyC"
ab wait 1000

assert_command_prompt "Input for Case split"
cancel_command_prompt
ab wait 500

assert_no_command_prompt
assert_editor_focused
assert_log_contains "Case split cancelled." "Cancel does not send command"

echo "browser-test-command-input-panel: PASS"
