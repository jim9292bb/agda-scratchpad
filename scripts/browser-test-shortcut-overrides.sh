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

  const loadRow = Array.from(document.querySelectorAll('.shortcut-settings-row'))
    .find(row => row.querySelector('strong')?.textContent?.trim() === 'Load')
  if (!loadRow) throw new Error('Load shortcut row missing')

  const input = loadRow.querySelector('input')
  if (!input) throw new Error('Load shortcut input missing')
  input.value = 'Ctrl-c Ctrl-g'
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'g' }))
  await new Promise(requestAnimationFrame)

  const save = Array.from(document.querySelectorAll('button'))
    .find(button => button.textContent.trim() === 'Save shortcuts')
  if (!save) throw new Error('Save shortcuts button missing')
  if (save.disabled) throw new Error('Save shortcuts should be enabled')
  save.click()
  await new Promise(requestAnimationFrame)

  const stored = JSON.parse(localStorage.getItem('agda-scratchpad.shortcut-overrides.v1') || '{}')
  if (stored.load !== 'Ctrl-c Ctrl-g') throw new Error('Load shortcut override was not stored')
  const effective = loadRow.textContent
  if (!effective.includes('Effective: Ctrl-c Ctrl-g')) {
    throw new Error('Load effective shortcut did not update')
  }

  const close = Array.from(document.querySelectorAll('button'))
    .find(button => button.textContent.trim() === 'Close')
  if (!close) throw new Error('Settings close button missing')
  close.click()
  await new Promise(requestAnimationFrame)
  return { ok: true, stored, effective }
})()"

echo "PASS Load shortcut override saves and updates Settings"

start_als

ab eval "(() => {
  const view = document.querySelector('.cm-content')?.cmTile?.view
  if (!view) throw new Error('missing CodeMirror view')
  const output = document.querySelector('textarea.textbox')
  if (output) output.value = ''
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
echo "browser-test-shortcut-overrides: PASS"
