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

wait_for_log_contains() {
  local needle_json timeout_ms elapsed
  needle_json="$(json_string "$1")"
  timeout_ms="${2:-30000}"
  elapsed=0
  while (( elapsed < timeout_ms )); do
    local found
    found="$(ab eval "(() => {
      const needle = $needle_json
      const text = document.querySelector('textarea.textbox')?.value ?? ''
      return text.includes(needle)
    })()")"
    if [[ "$found" == *"true"* ]]; then
      return 0
    fi
    ab wait 1000 >/dev/null
    elapsed=$((elapsed + 1000))
  done
  echo "Timed out waiting for log text: $1" >&2
  return 1
}

wait_for_log_matches() {
  local pattern_json timeout_ms elapsed
  pattern_json="$(json_string "$1")"
  timeout_ms="${2:-30000}"
  elapsed=0
  while (( elapsed < timeout_ms )); do
    local found
    found="$(ab eval "(() => {
      const pattern = new RegExp($pattern_json, 'i')
      const text = document.querySelector('textarea.textbox')?.value ?? ''
      return pattern.test(text)
    })()")"
    if [[ "$found" == *"true"* ]]; then
      return 0
    fi
    ab wait 1000 >/dev/null
    elapsed=$((elapsed + 1000))
  done
  echo "Timed out waiting for log pattern: $1" >&2
  return 1
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

assert_command_prompt() {
  local label_json
  label_json="$(json_string "$1")"
  ab eval "(() => {
    const label = $label_json
    const panel = document.querySelector('.command-input-panel')
    const input = document.querySelector('#command-input')
    if (!panel) throw new Error('Command input panel is missing')
    if (!panel.textContent.includes(label)) throw new Error('Command input panel label mismatch: ' + panel.textContent)
    if (document.activeElement !== input) throw new Error('Command input is not focused')
    return { ok: true, label, text: panel.textContent.trim() }
  })()"
  echo "PASS command prompt focused: $1"
}

submit_command_prompt() {
  local content_json
  content_json="$(json_string "$1")"
  ab eval "(() => {
    const content = $content_json
    const input = document.querySelector('#command-input')
    const panel = document.querySelector('.command-input-panel')
    if (!input || !panel) throw new Error('Command input panel is missing')
    input.value = content
    input.dispatchEvent(new Event('input', { bubbles: true }))
    panel.requestSubmit()
    return { ok: true, content }
  })()"
}

cancel_command_prompt() {
  ab eval "(() => {
    const button = document.querySelector('.command-input-panel button[type=button]')
    if (!button) throw new Error('Cancel button is missing')
    button.click()
    return { ok: true }
  })()"
}

assert_no_command_prompt() {
  ab eval "(() => {
    if (document.querySelector('.command-input-panel')) throw new Error('Command input panel is still visible')
    return { ok: true }
  })()"
  echo "PASS command prompt hidden"
}

assert_editor_focused() {
  ab eval "(() => {
    const editor = document.querySelector('.cm-content')
    if (!editor?.contains(document.activeElement)) throw new Error('Editor is not focused')
    return { ok: true }
  })()"
  echo "PASS editor focused"
}

assert_active_goal_contains() {
  local needle_json label
  needle_json="$(json_string "$1")"
  label="${2:-$1}"
  ab eval "(() => {
    const needle = $needle_json
    const card = document.querySelector('.goal-card.active')
    if (!card) throw new Error('Active goal card is missing')
    const text = card.textContent
    if (!text.includes(needle)) throw new Error('Active goal card does not contain: ' + needle + '\\n' + text)
    return { ok: true, contains: needle, text: card.textContent.trim() }
  })()"
  echo "PASS active goal contains: $label"
}

assert_log_not_contains() {
  local needle_json label
  needle_json="$(json_string "$1")"
  label="${2:-$1}"
  ab eval "(() => {
    const needle = $needle_json
    const text = document.querySelector('textarea.textbox')?.value ?? ''
    if (text.includes(needle)) throw new Error('Log unexpectedly contains: ' + needle)
    return { ok: true, missing: needle }
  })()"
  echo "PASS log excludes: $label"
}

assert_log_not_matches() {
  local pattern_json label
  pattern_json="$(json_string "$1")"
  label="${2:-$1}"
  ab eval "(() => {
    const pattern = new RegExp($pattern_json, 'i')
    const text = document.querySelector('textarea.textbox')?.value ?? ''
    if (pattern.test(text)) throw new Error('Log unexpectedly matches: ' + pattern)
    return { ok: true, pattern: String(pattern) }
  })()"
  echo "PASS log does not match: $label"
}

assert_log_matches() {
  local pattern_json label
  pattern_json="$(json_string "$1")"
  label="${2:-$1}"
  ab eval "(() => {
    const pattern = new RegExp($pattern_json, 'i')
    const text = document.querySelector('textarea.textbox')?.value ?? ''
    if (!pattern.test(text)) throw new Error('Log does not match: ' + pattern + '\\n' + text)
    return { ok: true, pattern: String(pattern) }
  })()"
  echo "PASS log matches: $label"
}

assert_errors_panel_contains() {
  local needle_json label
  needle_json="$(json_string "$1")"
  label="${2:-$1}"
  ab eval "(() => {
    const needle = $needle_json
    const panel = document.querySelector('.errors-panel')
    if (!panel) throw new Error('Errors panel is missing')
    const text = panel.textContent ?? ''
    if (!text.includes(needle)) throw new Error('Errors panel does not contain: ' + needle + '\\n' + text)
    return { ok: true, contains: needle, text: text.trim() }
  })()"
  echo "PASS errors panel contains: $label"
}
