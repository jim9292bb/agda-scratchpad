#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_URL="${APP_URL:-http://127.0.0.1:8099/}"
AGENT_BROWSER_RUNTIME="${AGENT_BROWSER_RUNTIME:-/tmp/agent-browser-runtime}"

if [[ -f /usr/share/nvm/init-nvm.sh ]]; then
  # shellcheck source=/usr/share/nvm/init-nvm.sh
  source /usr/share/nvm/init-nvm.sh
fi

json_string() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"
}

json_file() {
  node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(process.argv[1], "utf8")))' "$1"
}

ab() {
  XDG_RUNTIME_DIR="$AGENT_BROWSER_RUNTIME" agent-browser "$@"
}

open_app() {
  ab open "$APP_URL"
  ab wait --load networkidle
}

click_button() {
  local label_json
  label_json="$(json_string "$1")"
  ab eval "(() => {
    const label = $label_json
    const button = Array.from(document.querySelectorAll('button, quiet-button'))
      .find(button => button.textContent.trim() === label && !(button.disabled ?? button.hasAttribute('disabled')))
    if (!button) throw new Error('button not found: ' + label)
    button.click()
    return { ok: true, label }
  })()"
}

wait_for_button() {
  local label="$1"
  local timeout_ms="${2:-30000}"
  local elapsed=0
  while (( elapsed < timeout_ms )); do
    local found
    found="$(ab eval "(() => {
      const button = Array.from(document.querySelectorAll('button, quiet-button'))
        .find(button => button.textContent.trim() === '$label' && !(button.disabled ?? button.hasAttribute('disabled')))
      return Boolean(button)
    })()")"
    if [[ "$found" == *"true"* ]]; then
      return 0
    fi
    ab wait 1000 >/dev/null
    elapsed=$((elapsed + 1000))
  done
  echo "Timed out waiting for button: $label" >&2
  return 1
}

start_als() {
  local started
  started="$(ab eval "(() => {
    const buttons = Array.from(document.querySelectorAll('button, quiet-button'))
    const isEnabled = button => !(button.disabled ?? button.hasAttribute('disabled'))
    const load = buttons.some(button => button.textContent.trim() === 'Load' && isEnabled(button))
    if (load) return 'already-active'
    const start = buttons.find(button => button.textContent.trim() === 'Start' && isEnabled(button))
    if (!start) return 'missing-start'
    start.click()
    return 'started'
  })()")"

  if [[ "$started" == *"missing-start"* ]]; then
    echo "Could not find Start or Load button." >&2
    return 1
  fi

  if [[ "$started" == *"started"* ]]; then
    wait_for_button Load 45000
  fi
}

set_editor_fixture() {
  local fixture="$1"
  local marker="${2:-}"
  local offset="${3:-0}"
  local source_json marker_json
  source_json="$(json_file "$ROOT_DIR/$fixture")"
  marker_json="$(json_string "$marker")"

  ab eval "(() => {
    const source = $source_json
    const marker = $marker_json
    const offset = Number($offset)
    const view = document.querySelector('.cm-content')?.cmTile?.view
    if (!view) return { ok: false, error: 'missing CodeMirror view' }
    const anchor = marker ? source.indexOf(marker) + offset : 0
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: source },
      selection: { anchor: Math.max(0, anchor) },
    })
    view.focus()
    return { ok: true, text: view.state.doc.toString(), cursor: view.state.selection.main.head }
  })()"
}

load_agda() {
  click_button Load
  ab wait 5000
}

select_text() {
  local text_json occurrence
  text_json="$(json_string "$1")"
  occurrence="${2:-first}"
  ab eval "(() => {
    const text = $text_json
    const occurrence = '$occurrence'
    const view = document.querySelector('.cm-content')?.cmTile?.view
    if (!view) return { ok: false, error: 'missing CodeMirror view' }
    const doc = view.state.doc.toString()
    const from = occurrence === 'last' ? doc.lastIndexOf(text) : doc.indexOf(text)
    if (from < 0) return { ok: false, error: 'text not found', text }
    view.dispatch({ selection: { anchor: from, head: from + text.length } })
    view.focus()
    return { ok: true, text, from }
  })()"
}

set_goal_content() {
  local index content_json
  index="$1"
  content_json="$(json_string "$2")"
  ab eval "(() => {
    const index = Number($index)
    const content = $content_json
    const view = document.querySelector('.cm-content')?.cmTile?.view
    if (!view) return { ok: false, error: 'missing CodeMirror view' }
    const doc = view.state.doc.toString()
    const holes = []
    let searchFrom = 0
    while (searchFrom < doc.length) {
      const from = doc.indexOf('{!', searchFrom)
      if (from < 0) break
      const close = doc.indexOf('!}', from + 2)
      if (close < 0) break
      holes.push({ from, innerFrom: from + 2, innerTo: close, to: close + 2 })
      searchFrom = close + 2
    }
    const hole = holes[index]
    if (!hole) return { ok: false, error: 'hole not found', index, holes: holes.length }
    const insert = ' ' + content + ' '
    view.dispatch({
      changes: { from: hole.innerFrom, to: hole.innerTo, insert },
      selection: { anchor: hole.innerFrom + insert.length - 1 },
    })
    view.focus()
    return { ok: true, text: view.state.doc.toString(), cursor: view.state.selection.main.head }
  })()"
}

cursor_in_goal() {
  local index
  index="${1:-0}"
  ab eval "(() => {
    const index = Number($index)
    const view = document.querySelector('.cm-content')?.cmTile?.view
    if (!view) return { ok: false, error: 'missing CodeMirror view' }
    const doc = view.state.doc.toString()
    const holes = []
    let searchFrom = 0
    while (searchFrom < doc.length) {
      const from = doc.indexOf('{!', searchFrom)
      if (from < 0) break
      const close = doc.indexOf('!}', from + 2)
      if (close < 0) break
      holes.push({ from, close })
      searchFrom = close + 2
    }
    const hole = holes[index]
    if (!hole) return { ok: false, error: 'hole not found', index, holes: holes.length }
    view.dispatch({ selection: { anchor: Math.max(hole.from + 3, hole.close) } })
    view.focus()
    return { ok: true, cursor: view.state.selection.main.head }
  })()"
}

press_agda_chord() {
  local key="$1"
  local code="${2:-Key${key^^}}"
  ab eval "(() => {
    const view = document.querySelector('.cm-content')?.cmTile?.view
    const target = document.querySelector('.cm-content')
    if (!view || !target) return { ok: false, error: 'missing editor' }
    view.focus()
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', ctrlKey: true, bubbles: true, cancelable: true }))
    target.dispatchEvent(new KeyboardEvent('keydown', { key: '$key', code: '$code', ctrlKey: true, bubbles: true, cancelable: true }))
    return { ok: true, key: '$key', code: '$code' }
  })()"
}

editor_text() {
  ab eval "(() => document.querySelector('.cm-content')?.cmTile?.view?.state.doc.toString() ?? '')()"
}

log_text() {
  ab eval "(() => document.querySelector('textarea.textbox')?.value ?? '')()"
}

assert_editor_contains() {
  local needle_json label
  needle_json="$(json_string "$1")"
  label="${2:-$1}"
  ab eval "(() => {
    const needle = $needle_json
    const text = document.querySelector('.cm-content')?.cmTile?.view?.state.doc.toString() ?? ''
    if (!text.includes(needle)) throw new Error('Editor does not contain: ' + needle)
    return { ok: true, contains: needle }
  })()"
  echo "PASS editor contains: $label"
}

assert_log_contains() {
  local needle_json label
  needle_json="$(json_string "$1")"
  label="${2:-$1}"
  ab eval "(() => {
    const needle = $needle_json
    const text = document.querySelector('textarea.textbox')?.value ?? ''
    if (!text.includes(needle)) throw new Error('Log does not contain: ' + needle)
    return { ok: true, contains: needle }
  })()"
  echo "PASS log contains: $label"
}
