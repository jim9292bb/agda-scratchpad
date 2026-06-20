#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/browser-common.sh
source "$SCRIPT_DIR/browser-common.sh"

open_app

wait_for_button "Settings" 30000

ab eval "(async () => {
  const settings = Array.from(document.querySelectorAll('button'))
    .find(button => button.textContent.trim() === 'Settings' || (button.getAttribute('aria-label') || '').trim() === 'Settings')
  if (!settings) throw new Error('Settings button missing')
  if (settings.closest('.header')) throw new Error('Settings button should not be in the editor header')
  const controls = settings.closest('.control-card-row')
  if (!controls) throw new Error('Settings button should be in the ALS controls row (.control-card-row)')
  const restartBtn = Array.from(controls.querySelectorAll('button')).find(b => b.textContent.trim() === 'Restart')
  if (!restartBtn) throw new Error('Restart button missing near Settings')
  settings.click()
  await new Promise(r => setTimeout(r, 100))

  const panel = document.querySelector('.settings-panel')
  if (!panel) throw new Error('Settings panel missing')
  if (panel.getAttribute('role') !== 'dialog') throw new Error('Settings panel is not a dialog')
  const panelBox = panel.getBoundingClientRect()
  const panelCenterX = panelBox.left + panelBox.width / 2
  const panelCenterY = panelBox.top + panelBox.height / 2
  if (Math.abs(panelCenterX - window.innerWidth / 2) > 2 || Math.abs(panelCenterY - window.innerHeight / 2) > 2) {
    throw new Error('Settings panel is not centered')
  }

  const body = document.querySelector('.settings-panel-body')
  if (!body) throw new Error('Settings panel body missing')
  const bodyStyle = getComputedStyle(body)
  if (bodyStyle.overflowY !== 'auto') throw new Error('Settings panel body is not scrollable')

  const main = document.querySelector('.settings-panel-main')
  if (!main) throw new Error('Settings panel main layout missing')
  const mainStyle = getComputedStyle(main)
  const columns = mainStyle.gridTemplateColumns.split(' ')
  if (columns[0] !== '168px' || columns.length < 2) {
    throw new Error('Settings panel should use a fixed left segmented-control column')
  }

  const segmented = document.querySelector('.settings-segmented-control')
  if (!segmented) throw new Error('Settings segmented control missing')
  const segmentedStyle = getComputedStyle(segmented)
  if (segmentedStyle.overflowY !== 'auto') {
    throw new Error('Settings segmented control is not vertically scrollable')
  }

  const title = document.querySelector('#settings-panel-title')
  if (!title || title.textContent.trim() !== 'Scratchpad Settings') {
    throw new Error('Settings dialog title should describe whole-page settings')
  }

  const segmentLabels = Array.from(document.querySelectorAll('.settings-segmented-control button'))
    .map(button => button.textContent.trim())
  const expectedSegments = ['General', 'Editor', 'Runtime', 'Commands', 'Planned']
  const missingSegments = expectedSegments.filter(section => !segmentLabels.includes(section))
  if (missingSegments.length) {
    throw new Error('Missing settings segments: ' + missingSegments.join(', '))
  }

  const activeTitle = document.querySelector('.settings-section h3')
  if (!activeTitle || activeTitle.textContent.trim() !== 'General') {
    throw new Error('Settings should open on the General segment')
  }

  const runtimeTab = Array.from(document.querySelectorAll('.settings-segmented-control button'))
    .find(button => button.textContent.trim() === 'Runtime')
  if (!runtimeTab) throw new Error('Runtime segment missing')
  runtimeTab.click()
  await new Promise(r => setTimeout(r, 100))
  if (!document.querySelector('.settings-runtime-list')) {
    throw new Error('Runtime settings list missing')
  }

  const commandsTab = Array.from(document.querySelectorAll('.settings-segmented-control button'))
    .find(button => button.textContent.trim() === 'Commands')
  if (!commandsTab) throw new Error('Commands segment missing')
  commandsTab.click()
  await new Promise(r => setTimeout(r, 100))
  const commandTitle = document.querySelector('#command-settings-title')
  if (!commandTitle || commandTitle.textContent.trim() !== 'Commands and shortcuts') {
    throw new Error('Commands settings section missing')
  }

  const rows = Array.from(document.querySelectorAll('.shortcut-settings-row'))
  const labels = rows.map(row => row.querySelector('strong')?.textContent?.trim())
  const expected = ['Load', 'Give', 'Case split', 'Goal type', 'Why in scope']
  const missing = expected.filter(label => !labels.includes(label))
  if (missing.length) throw new Error('Missing shortcut settings rows: ' + missing.join(', '))

  return {
    ok: true,
    rows: rows.length,
    centered: true,
    segments: segmentLabels,
    layout: mainStyle.gridTemplateColumns,
    segmentedOverflowY: segmentedStyle.overflowY,
    overflowY: bodyStyle.overflowY,
  }
})()"

echo "PASS settings dialog shows whole-page settings"

ab eval "(async () => {
  const close = Array.from(document.querySelectorAll('button'))
    .find(button => button.textContent.trim() === 'Close')
  if (!close) throw new Error('Settings close button missing')
  close.click()
  await new Promise(r => setTimeout(r, 100))
  if (document.querySelector('.settings-panel')) throw new Error('Settings panel is still visible')
  return { ok: true }
})()"

echo "PASS settings dialog closes"
echo "browser-test-settings-dialog: PASS"
