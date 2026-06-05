#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/browser-common.sh
source "$SCRIPT_DIR/browser-common.sh"

open_app

ab eval "(() => {
  localStorage.removeItem('agda-scratchpad.shortcut-overrides.v1')
  return { ok: true }
})()"
ab wait 500 >/dev/null

wait_for_button "Settings" 30000

ab eval "(async () => {
  const settings = Array.from(document.querySelectorAll('button'))
    .find(button => button.textContent.trim() === 'Settings')
  if (!settings) throw new Error('Settings button missing')
  settings.click()
  await new Promise(requestAnimationFrame)

  const commandsTab = Array.from(document.querySelectorAll('.settings-segmented-control button'))
    .find(button => button.textContent.trim() === 'Commands')
  if (!commandsTab) throw new Error('Commands segment missing')
  commandsTab.click()
  await new Promise(requestAnimationFrame)

  const findRow = label => Array.from(document.querySelectorAll('.shortcut-settings-row'))
    .find(row => row.querySelector('strong')?.textContent?.trim() === label)
  const setOverride = (label, value) => {
    const row = findRow(label)
    if (!row) throw new Error(label + ' shortcut row missing')
    const input = row.querySelector('input')
    if (!input) throw new Error(label + ' shortcut input missing')
    input.value = value
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
    return row
  }

  const loadRow = setOverride('Load', 'Ctrl-c Ctrl-g')
  const giveRow = setOverride('Give', 'Ctrl-c Ctrl-y')
  const whyInScopeRow = setOverride('Why in scope', 'Ctrl-c Ctrl-u')
  await new Promise(requestAnimationFrame)

  const save = Array.from(document.querySelectorAll('button'))
    .find(button => button.textContent.trim() === 'Save shortcuts')
  if (!save) throw new Error('Save shortcuts button missing')
  if (save.disabled) throw new Error('Save shortcuts should be enabled')
  save.click()
  await new Promise(requestAnimationFrame)

  const stored = JSON.parse(localStorage.getItem('agda-scratchpad.shortcut-overrides.v1') || '{}')
  if (stored.load !== 'Ctrl-c Ctrl-g') throw new Error('Load shortcut override was not stored')
  if (stored.give !== 'Ctrl-c Ctrl-y') throw new Error('Give shortcut override was not stored')
  if (stored['why-in-scope'] !== 'Ctrl-c Ctrl-u') throw new Error('Why in scope shortcut override was not stored')
  const loadEffective = loadRow.textContent
  const giveEffective = giveRow.textContent
  const whyInScopeEffective = whyInScopeRow.textContent
  if (!loadEffective.includes('Effective: Ctrl-c Ctrl-g')) {
    throw new Error('Load effective shortcut did not update')
  }
  if (!giveEffective.includes('Effective: Ctrl-c Ctrl-y')) {
    throw new Error('Give effective shortcut did not update')
  }
  if (!whyInScopeEffective.includes('Effective: Ctrl-c Ctrl-u')) {
    throw new Error('Why in scope effective shortcut did not update')
  }

  const close = Array.from(document.querySelectorAll('button'))
    .find(button => button.textContent.trim() === 'Close')
  if (!close) throw new Error('Settings close button missing')
  close.click()
  await new Promise(requestAnimationFrame)
  return { ok: true, stored, loadEffective, giveEffective, whyInScopeEffective }
})()"

echo "PASS Load, Give, and Why in scope shortcut overrides save and update Settings"

start_als

ab eval "(() => {
  const view = document.querySelector('.cm-content')?.cmTile?.view
  if (!view) throw new Error('missing CodeMirror view')
  view.focus()
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'c', code: 'KeyC', ctrlKey: true, bubbles: true, cancelable: true,
  }))
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'g', code: 'KeyG', ctrlKey: true, bubbles: true, cancelable: true,
  }))
  return { ok: true }
})()"

wait_for_log_contains "Loading /source.agda" 30000
wait_for_log_contains "Load finished." 45000

echo "PASS overridden Ctrl-c Ctrl-g triggers Load"

set_editor_fixture "test-fixtures/agda/idN-elaborate.agda" "{! n !}" 4
click_button Load
wait_for_log_contains "Load finished." 30000

cursor_in_goal 0
press_agda_chord "y" "KeyY"
ab wait 5000

assert_editor_contains "idN n = n" "Overridden Give fills goal"
assert_log_contains "Give finished." "Overridden Give finishes"

echo "PASS overridden Ctrl-c Ctrl-y triggers Give"

set_editor_fixture "test-fixtures/agda/query-bool.agda"
click_button Load
wait_for_log_contains "Load finished." 30000

select_text "true" "last"
press_agda_chord "u" "KeyU"
ab wait 3000

assert_log_contains "\"kind\":\"WhyInScope\"" "Overridden Why in scope response"

echo "PASS overridden Ctrl-c Ctrl-u triggers Why in scope"
echo "browser-test-shortcut-overrides: PASS"
