// Standalone Agda Unicode input method for plain HTML <input> elements.
// Reuses the same trie data and CSS classes as the CodeMirror extension
// (agda-input.ts), but operates via DOM KeyboardEvent listeners and
// el.setRangeText() instead of CodeMirror state effects.
//
// The .agda-im-tooltip CSS is injected globally by EditorView.baseTheme in
// agda-input.ts when the main editor loads, so the tooltip styling is
// available to DOM nodes appended to document.body as well.

import keymapData from '$lib/agda/input-keymap.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TrieNode = any

function lookupTrie(root: TrieNode, sequence: string): {
  candidates: string[]
  further: boolean
  keySuggestions: string[]
} {
  let node: TrieNode = root
  for (const ch of sequence) {
    node = node[ch]
    if (!node) return { candidates: [], further: false, keySuggestions: [] }
  }
  const keys: string[] = Object.keys(node)
  return {
    candidates: (node['>>'] as string[]) ?? [],
    further: keys.some(k => k !== '>>'),
    keySuggestions: keys.filter(k => k !== '>>'),
  }
}

const PAGE_SIZE = 9

type IMActive = {
  active: true
  from: number
  sequence: string
  surface: string
  candidates: string[]
  further: boolean
  keySuggestions: string[]
  candidateIndex: number
}
type IMState = { active: false } | IMActive

function computeState(sequence: string, prevIdx: number): Omit<IMActive, 'active' | 'from'> {
  const { candidates, further, keySuggestions } = lookupTrie(keymapData as TrieNode, sequence)
  const candidateIndex = prevIdx < candidates.length ? prevIdx : 0
  const surface = candidates.length > 0 ? candidates[candidateIndex] : ('\\' + sequence)
  return { sequence, surface, candidates, further, keySuggestions, candidateIndex }
}

function renderTooltip(dom: HTMLElement, im: IMActive) {
  dom.innerHTML = ''

  const page = Math.floor(im.candidateIndex / PAGE_SIZE)
  const totalPages = Math.ceil(im.candidates.length / PAGE_SIZE)
  const pageStart = page * PAGE_SIZE
  const visible = im.candidates.slice(pageStart, pageStart + PAGE_SIZE)

  const row1 = document.createElement('div')
  row1.className = 'agda-im-row'

  const seq = document.createElement('span')
  seq.className = 'agda-im-seq'
  seq.textContent = '\\' + im.sequence
  row1.appendChild(seq)

  if (visible.length > 0) {
    const arr = document.createElement('span')
    arr.className = 'agda-im-arr'
    arr.textContent = ' → '
    row1.appendChild(arr)

    for (let i = 0; i < visible.length; i++) {
      const globalIdx = pageStart + i
      const btn = document.createElement('span')
      btn.className = 'agda-im-cand' + (globalIdx === im.candidateIndex ? ' agda-im-cand-sel' : '')
      btn.textContent = visible[i]
      if (visible.length > 1) {
        const sub = document.createElement('sub')
        sub.textContent = String(i + 1)
        btn.appendChild(sub)
      }
      row1.appendChild(btn)
    }

    if (totalPages > 1) {
      const pager = document.createElement('span')
      pager.className = 'agda-im-pager'
      pager.textContent = ' ' + (page + 1) + '/' + totalPages
      row1.appendChild(pager)
    }
  }

  dom.appendChild(row1)

  if (im.keySuggestions.length > 0) {
    const row2 = document.createElement('div')
    row2.className = 'agda-im-row agda-im-row-keys'

    const label = document.createElement('span')
    label.className = 'agda-im-keys-label'
    label.textContent = '+ '
    row2.appendChild(label)

    for (const key of im.keySuggestions) {
      const k = document.createElement('span')
      k.className = 'agda-im-key'
      k.textContent = key
      row2.appendChild(k)
    }

    dom.appendChild(row2)
  }
}

// Attach the Agda Unicode input method to a plain HTML <input> element.
// Returns a cleanup function that removes all listeners and hides the tooltip.
export function attachAgdaIM(el: HTMLInputElement): () => void {
  let im: IMState = { active: false }
  let tooltipEl: HTMLElement | null = null

  function showTooltip(state: IMActive) {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div')
      tooltipEl.className = 'agda-im-tooltip'
      document.body.appendChild(tooltipEl)
    }
    renderTooltip(tooltipEl, state)

    // Position above the input element
    const rect = el.getBoundingClientRect()
    tooltipEl.style.position = 'fixed'
    tooltipEl.style.left = rect.left + 'px'
    tooltipEl.style.top = 'auto'
    tooltipEl.style.bottom = (window.innerHeight - rect.top + 4) + 'px'
    tooltipEl.style.zIndex = '9999'
  }

  function hideTooltip() {
    tooltipEl?.remove()
    tooltipEl = null
  }

  function replaceInInput(from: number, oldLen: number, text: string) {
    el.setRangeText(text, from, from + oldLen, 'end')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function activate() {
    const pos = el.selectionStart ?? el.value.length
    replaceInInput(pos, 0, '\\')
    const state = computeState('', 0)
    im = { active: true, from: pos, ...state }
    showTooltip(im)
  }

  function confirm(suffix = '') {
    if (!im.active) return
    const symbol = im.candidates[im.candidateIndex] ?? im.surface
    replaceInInput(im.from, im.surface.length, symbol + suffix)
    im = { active: false }
    hideTooltip()
  }

  function cancel() {
    if (!im.active) return
    replaceInInput(im.from, im.surface.length, '')
    im = { active: false }
    hideTooltip()
  }

  function backspace() {
    if (!im.active) return
    if (im.sequence.length === 0) {
      replaceInInput(im.from, im.surface.length, '')
      im = { active: false }
      hideTooltip()
    } else {
      const next = computeState(im.sequence.slice(0, -1), im.candidateIndex)
      replaceInInput(im.from, im.surface.length, next.surface)
      im = { active: true, from: im.from, ...next }
      showTooltip(im)
    }
  }

  function appendChar(char: string) {
    if (!im.active) return false
    const next = computeState(im.sequence + char, 0)
    if (!next.further && next.candidates.length === 0) {
      confirm()
      return false
    }
    replaceInInput(im.from, im.surface.length, next.surface)
    im = { active: true, from: im.from, ...next }
    showTooltip(im)
    return true
  }

  function selectCandidate(idx: number) {
    if (!im.active || im.candidates.length === 0) return
    const len = im.candidates.length
    const clamped = ((idx % len) + len) % len
    const surface = im.candidates[clamped]
    replaceInInput(im.from, im.surface.length, surface)
    im = { ...im, surface, candidateIndex: clamped }
    showTooltip(im)
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return

    if (!im.active) {
      if (e.key === '\\') { e.preventDefault(); activate() }
      return
    }

    const key = e.key
    if (key === 'Escape')               { e.preventDefault(); cancel(); return }
    if (key === 'Tab' || key === 'Enter') { e.preventDefault(); confirm(); return }
    if (key === ' ')                    { e.preventDefault(); confirm(' '); return }
    if (key === 'Backspace')            { e.preventDefault(); backspace(); return }
    if (key === 'ArrowLeft')            { e.preventDefault(); selectCandidate(im.candidateIndex - 1); return }
    if (key === 'ArrowRight')           { e.preventDefault(); selectCandidate(im.candidateIndex + 1); return }
    if (key === 'ArrowUp')              { e.preventDefault(); selectCandidate(im.candidateIndex - PAGE_SIZE); return }
    if (key === 'ArrowDown')            { e.preventDefault(); selectCandidate(im.candidateIndex + PAGE_SIZE); return }

    if (/^[1-9]$/.test(key) && im.candidates.length > 1) {
      e.preventDefault()
      const page = Math.floor(im.candidateIndex / PAGE_SIZE)
      selectCandidate(page * PAGE_SIZE + Number(key) - 1)
      return
    }

    if (key.length === 1) { e.preventDefault(); appendChar(key); return }
  }

  function onBlur() {
    if (im.active) cancel()
  }

  el.addEventListener('keydown', onKeydown)
  el.addEventListener('blur', onBlur)

  return () => {
    el.removeEventListener('keydown', onKeydown)
    el.removeEventListener('blur', onBlur)
    hideTooltip()
    im = { active: false }
  }
}
