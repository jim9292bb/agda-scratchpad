#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/browser-common.sh
source "$SCRIPT_DIR/browser-common.sh"

ab eval "(() => { localStorage.removeItem('agda-playground.shortcut-overrides.v1'); return {ok:true} })()" 2>/dev/null || true
open_app

# ── Helpers ──────────────────────────────────────────────────────────────────

set_editor_simple() {
  local text_json
  text_json="$(json_string "$1")"
  ab eval "(() => {
    const text = $text_json
    const view = document.querySelector('.cm-content')?.cmTile?.view
    if (!view) return { ok: false, error: 'missing view' }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: { anchor: text.length },
    })
    view.focus()
    return { ok: true }
  })()"
}

press_key() {
  local key_json code_json
  key_json="$(json_string "$1")"
  code_json="$(json_string "${2:-}")"
  ab eval "(() => {
    const key = $key_json
    const code = $code_json || ('Key' + key.toUpperCase())
    const target = document.querySelector('.cm-content')
    if (!target) return { ok: false, error: 'missing editor' }
    target.cmTile?.view?.focus()
    target.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }))
    return { ok: true, key, code }
  })()"
}

assert_im_active() {
  ab eval "(() => {
    const tooltip = document.querySelector('.agda-im-tooltip')
    if (!tooltip) throw new Error('IM tooltip is not visible — IM is not active')
    return { ok: true, text: tooltip.textContent.trim().slice(0, 80) }
  })()"
  echo "PASS IM is active (tooltip visible)"
}

assert_im_inactive() {
  ab eval "(() => {
    const tooltip = document.querySelector('.agda-im-tooltip')
    if (tooltip) throw new Error('IM tooltip is unexpectedly visible: ' + tooltip.textContent.trim().slice(0, 80))
    return { ok: true }
  })()"
  echo "PASS IM is inactive (tooltip hidden)"
}

assert_im_shows() {
  local needle_json label
  needle_json="$(json_string "$1")"
  label="${2:-$1}"
  ab eval "(() => {
    const needle = $needle_json
    const tooltip = document.querySelector('.agda-im-tooltip')
    if (!tooltip) throw new Error('IM tooltip is not visible')
    if (!tooltip.textContent.includes(needle))
      throw new Error('IM tooltip does not contain: ' + needle + '\\nGot: ' + tooltip.textContent.trim().slice(0, 200))
    return { ok: true, contains: needle }
  })()"
  echo "PASS IM tooltip shows: $label"
}

# ── Test 1: \\ alone activates IM and shows root key suggestions ──────────────
echo "--- Test 1: backslash activates IM and shows key suggestions immediately"
set_editor_simple "x = "
press_key "\\" "Backslash"
ab wait 300
assert_im_active
assert_im_shows "+" "key-suggestions label"
# Root trie has 79 top-level single-char keys; verify a few known ones
assert_im_shows "l" "root key l"
assert_im_shows "r" "root key r"
assert_im_shows "t" "root key t"
echo "PASS backslash opens IM with root key suggestions"

# ── Test 2: typing sequence narrows candidates ────────────────────────────────
echo "--- Test 2: \\to shows → candidate"
press_key "t" "KeyT"
press_key "o" "KeyO"
ab wait 200
assert_im_shows "→" "→ candidate"
echo "PASS \\to narrows to → candidate"

# ── Test 3: Tab confirms and inserts symbol ───────────────────────────────────
echo "--- Test 3: Tab confirms → insertion"
press_key "Tab" "Tab"
ab wait 200
assert_im_inactive
assert_editor_contains "→" "→ in editor after Tab"

# ── Test 4: Space confirms and appends trailing space ─────────────────────────
echo "--- Test 4: Space confirms and appends trailing space"
set_editor_simple "f "
press_key "\\" "Backslash"
press_key "t" "KeyT"
press_key "o" "KeyO"
ab wait 200
assert_im_shows "→"
press_key " " "Space"
ab wait 200
assert_im_inactive
assert_editor_contains "→ " "→ with trailing space"

# ── Test 5: Escape cancels and removes the entire sequence ────────────────────
echo "--- Test 5: Escape cancels IM and removes backslash sequence"
set_editor_simple "g "
press_key "\\" "Backslash"
press_key "t" "KeyT"
press_key "o" "KeyO"
ab wait 200
assert_im_shows "→"
press_key "Escape" "Escape"
ab wait 200
assert_im_inactive
ab eval "(() => {
  const text = document.querySelector('.cm-content')?.cmTile?.view?.state.doc.toString() ?? ''
  if (text.includes('→')) throw new Error('Editor unexpectedly contains → after Escape: ' + text)
  if (text.includes('\\\\')) throw new Error('Editor unexpectedly contains \\\\ after Escape: ' + text)
  return { ok: true, text }
})()"
echo "PASS Escape removes backslash sequence from editor"

# ── Test 6: Backspace shortens the sequence ───────────────────────────────────
echo "--- Test 6: Backspace shortens sequence"
set_editor_simple "h "
press_key "\\" "Backslash"
press_key "t" "KeyT"
press_key "o" "KeyO"
ab wait 200
assert_im_shows "→"
press_key "Backspace" "Backspace"
ab wait 200
assert_im_active
ab eval "(() => {
  const tooltip = document.querySelector('.agda-im-tooltip')
  if (!tooltip) throw new Error('tooltip missing after backspace')
  // Check that → is not among the candidate symbols (the arrow in row 1 is a separator, not a candidate)
  const cands = [...tooltip.querySelectorAll('.agda-im-cand')].map(el => el.childNodes[0]?.textContent ?? el.textContent)
  if (cands.includes('→')) throw new Error('→ still listed as candidate after removing o from \\\\to: ' + JSON.stringify(cands))
  return { ok: true, cands: cands.slice(0, 5) }
})()"
echo "PASS Backspace removes last char; → no longer a candidate"
# Cancel to reset state
press_key "Escape" "Escape"
ab wait 200

# ── Test 7: Backspace on empty sequence deactivates IM ───────────────────────
echo "--- Test 7: Backspace on empty sequence deactivates IM"
set_editor_simple "k "
press_key "\\" "Backslash"
ab wait 200
assert_im_active
press_key "Backspace" "Backspace"
ab wait 200
assert_im_inactive
ab eval "(() => {
  const text = document.querySelector('.cm-content')?.cmTile?.view?.state.doc.toString() ?? ''
  if (text.includes('\\\\')) throw new Error('Backslash still in editor after Backspace on empty sequence: ' + text)
  return { ok: true, text }
})()"
echo "PASS Backspace on empty sequence deactivates IM and removes backslash"

# ── Test 8: number key selects candidate by page position ────────────────────
echo "--- Test 8: number key 2 selects second candidate"
set_editor_simple "p "
press_key "\\" "Backslash"
press_key "l" "KeyL"
ab wait 200
# \l has multiple candidates: ←, ⇐, ...
ab eval "(() => {
  const cands = document.querySelectorAll('.agda-im-cand')
  if (cands.length < 2) throw new Error('expected ≥2 candidates for \\\\l, got ' + cands.length)
  const sel = document.querySelector('.agda-im-cand-sel')
  const all = [...cands]
  const idx = all.indexOf(sel)
  if (idx !== 0) throw new Error('expected first candidate selected initially, got index ' + idx)
  return { ok: true, count: cands.length }
})()"
echo "PASS \\l has multiple candidates, first selected"
press_key "2" "Digit2"
ab wait 200
ab eval "(() => {
  const sel = document.querySelector('.agda-im-cand-sel')
  if (!sel) throw new Error('no candidate selected after pressing 2')
  const all = [...document.querySelectorAll('.agda-im-cand')]
  const idx = all.indexOf(sel)
  if (idx !== 1) throw new Error('expected second candidate (index 1) selected, got index ' + idx)
  return { ok: true, idx, text: sel.textContent }
})()"
echo "PASS key 2 selects second candidate"
press_key "Tab" "Tab"
ab wait 200
assert_im_inactive

# ── Test 9: ArrowRight / ArrowLeft navigate candidates ───────────────────────
echo "--- Test 9: ArrowRight and ArrowLeft navigate candidates"
set_editor_simple "q "
press_key "\\" "Backslash"
press_key "l" "KeyL"
ab wait 200
press_key "ArrowRight" "ArrowRight"
ab wait 200
ab eval "(() => {
  const sel = document.querySelector('.agda-im-cand-sel')
  const all = [...document.querySelectorAll('.agda-im-cand')]
  if (all.indexOf(sel) !== 1) throw new Error('ArrowRight did not advance to index 1')
  return { ok: true }
})()"
press_key "ArrowLeft" "ArrowLeft"
ab wait 200
ab eval "(() => {
  const sel = document.querySelector('.agda-im-cand-sel')
  const all = [...document.querySelectorAll('.agda-im-cand')]
  if (all.indexOf(sel) !== 0) throw new Error('ArrowLeft did not go back to index 0')
  return { ok: true }
})()"
echo "PASS ArrowRight/ArrowLeft navigate candidates"
press_key "Escape" "Escape"
ab wait 200

echo "browser-test-unicode-input: PASS"
