import { Prec, StateField, StateEffect, type Extension } from '@codemirror/state'
import { EditorView, keymap, showTooltip, type Tooltip } from '@codemirror/view'
import keymapData from '$lib/agda/input-keymap.js'

// ---------------------------------------------------------------------------
// Trie
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type IMActive = {
  active: true
  from: number          // doc offset where \ was inserted
  sequence: string      // chars typed after \
  surface: string       // text currently occupying [from, from+surface.length]
  candidates: string[]
  further: boolean
  keySuggestions: string[]
  candidateIndex: number
}
type IMState = { active: false } | IMActive

const imActivate   = StateEffect.define<{ from: number }>()
const imDeactivate = StateEffect.define<void>()
const imUpdate     = StateEffect.define<Omit<IMActive, 'active' | 'from'>>()

const PAGE_SIZE = 9

function computeUpdate(sequence: string, prevCandidateIndex: number): Omit<IMActive, 'active' | 'from'> {
  const root = keymapData as TrieNode
  const { candidates, further, keySuggestions } = lookupTrie(root, sequence)
  const candidateIndex = prevCandidateIndex < candidates.length ? prevCandidateIndex : 0
  const surface = candidates.length > 0 ? candidates[candidateIndex] : ('\\' + sequence)
  return { sequence, surface, candidates, further, keySuggestions, candidateIndex }
}

const imStateField = StateField.define<IMState>({
  create: () => ({ active: false }),

  update(state, tr) {
    for (const e of tr.effects) {
      if (e.is(imActivate)) {
        const { candidates, further, keySuggestions } = lookupTrie(keymapData as TrieNode, '')
        return { active: true, from: e.value.from, sequence: '', surface: '\\', candidates, further, keySuggestions, candidateIndex: 0 }
      }
      if (e.is(imDeactivate)) {
        return { active: false }
      }
      if (e.is(imUpdate)) {
        if (!state.active) return state
        return { ...state, ...e.value }
      }
    }

    if (!state.active) return state

    // External cursor movement: deactivate if cursor left the IM range
    if (tr.selection) {
      const cursor = tr.newSelection.main.from
      const to = state.from + state.surface.length
      if (cursor < state.from || cursor > to) return { active: false }
    }

    // External doc change: deactivate
    if (tr.docChanged) return { active: false }

    return state
  },
})

// ---------------------------------------------------------------------------
// Tooltip — two-row layout
// ---------------------------------------------------------------------------

function renderTooltip(dom: HTMLElement, im: IMActive) {
  dom.innerHTML = ''

  const page = Math.floor(im.candidateIndex / PAGE_SIZE)
  const totalPages = Math.ceil(im.candidates.length / PAGE_SIZE)
  const pageStart = page * PAGE_SIZE
  const visible = im.candidates.slice(pageStart, pageStart + PAGE_SIZE)

  // Row 1: sequence + candidate symbols + page indicator
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

  // Row 2: key suggestions
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

const tooltipField = StateField.define<Tooltip | null>({
  create: () => null,

  update(prev, tr) {
    const im = tr.state.field(imStateField)
    if (!im.active) return null
    if (prev) return prev
    return {
      pos: im.from,
      above: true,
      strictSide: false,
      arrow: false,
      create(view) {
        const dom = document.createElement('div')
        dom.className = 'agda-im-tooltip'
        const s = view.state.field(imStateField)
        if (s.active) renderTooltip(dom, s)
        return {
          dom,
          update(update) {
            const s = update.state.field(imStateField)
            if (s.active) renderTooltip(dom, s)
          },
        }
      },
    }
  },

  provide: f => showTooltip.from(f),
})

// ---------------------------------------------------------------------------
// Key handling
// ---------------------------------------------------------------------------

function activateIM(view: EditorView): boolean {
  const im = view.state.field(imStateField)
  if (im.active) return handleChar(view, '\\')

  const sel = view.state.selection.main
  if (!sel.empty) return false

  const from = sel.from
  view.dispatch({
    changes: { from, insert: '\\' },
    selection: { anchor: from + 1 },
    effects: imActivate.of({ from }),
  })
  return true
}

function handleChar(view: EditorView, char: string): boolean {
  const im = view.state.field(imStateField)
  if (!im.active) return false

  const upd = computeUpdate(im.sequence + char, 0)
  if (!upd.further && upd.candidates.length === 0) {
    confirmIM(view)
    return false
  }

  view.dispatch({
    changes: { from: im.from, to: im.from + im.surface.length, insert: upd.surface },
    selection: { anchor: im.from + upd.surface.length },
    effects: imUpdate.of(upd),
  })
  return true
}

function confirmIM(view: EditorView, suffix = ''): boolean {
  const im = view.state.field(imStateField)
  if (!im.active) return false

  const symbol = im.candidates[im.candidateIndex] ?? im.surface
  const insert = symbol + suffix
  view.dispatch({
    changes: { from: im.from, to: im.from + im.surface.length, insert },
    selection: { anchor: im.from + insert.length },
    effects: imDeactivate.of(),
  })
  return true
}

function cancelIM(view: EditorView): boolean {
  const im = view.state.field(imStateField)
  if (!im.active) return false

  view.dispatch({
    changes: { from: im.from, to: im.from + im.surface.length, insert: '' },
    selection: { anchor: im.from },
    effects: imDeactivate.of(),
  })
  return true
}

function backspaceIM(view: EditorView): boolean {
  const im = view.state.field(imStateField)
  if (!im.active) return false

  if (im.sequence.length === 0) {
    view.dispatch({
      changes: { from: im.from, to: im.from + im.surface.length, insert: '' },
      selection: { anchor: im.from },
      effects: imDeactivate.of(),
    })
    return true
  }

  const upd = computeUpdate(im.sequence.slice(0, -1), im.candidateIndex)
  view.dispatch({
    changes: { from: im.from, to: im.from + im.surface.length, insert: upd.surface },
    selection: { anchor: im.from + upd.surface.length },
    effects: imUpdate.of(upd),
  })
  return true
}

function navigateCandidate(view: EditorView, rawIdx: number): boolean {
  const im = view.state.field(imStateField)
  if (!im.active || im.candidates.length === 0) return false

  const idx = ((rawIdx % im.candidates.length) + im.candidates.length) % im.candidates.length
  const surface = im.candidates[idx]
  view.dispatch({
    changes: { from: im.from, to: im.from + im.surface.length, insert: surface },
    selection: { anchor: im.from + surface.length },
    effects: imUpdate.of({ ...im, surface, candidateIndex: idx }),
  })
  return true
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export function agdaInputMethod(): Extension {
  // High-priority keymap: runs before basicSetup keymaps.
  // Handles all special keys so CM cannot intercept them first.
  const imKeymap = Prec.highest(keymap.of([
    { key: '\\',       run: activateIM },
    {
      key: 'Tab',
      run: (view) => { const im = view.state.field(imStateField); return im.active ? confirmIM(view) : false },
    },
    {
      key: 'Enter',
      run: (view) => { const im = view.state.field(imStateField); return im.active ? confirmIM(view) : false },
    },
    {
      key: 'Escape',
      run: (view) => { const im = view.state.field(imStateField); return im.active ? cancelIM(view) : false },
    },
    {
      key: ' ',
      run: (view) => { const im = view.state.field(imStateField); return im.active ? confirmIM(view, ' ') : false },
    },
    {
      key: 'Backspace',
      run: (view) => { const im = view.state.field(imStateField); return im.active ? backspaceIM(view) : false },
    },
    // Arrow keys: navigate candidates when IM is active and has candidates
    {
      key: 'ArrowLeft',
      run: (view) => {
        const im = view.state.field(imStateField)
        if (!im.active) return false
        return im.candidates.length > 0 ? navigateCandidate(view, im.candidateIndex - 1) : false
      },
    },
    {
      key: 'ArrowRight',
      run: (view) => {
        const im = view.state.field(imStateField)
        if (!im.active) return false
        return im.candidates.length > 0 ? navigateCandidate(view, im.candidateIndex + 1) : false
      },
    },
    {
      key: 'ArrowUp',
      run: (view) => {
        const im = view.state.field(imStateField)
        if (!im.active) return false
        return im.candidates.length > 0 ? navigateCandidate(view, im.candidateIndex - PAGE_SIZE) : false
      },
    },
    {
      key: 'ArrowDown',
      run: (view) => {
        const im = view.state.field(imStateField)
        if (!im.active) return false
        return im.candidates.length > 0 ? navigateCandidate(view, im.candidateIndex + PAGE_SIZE) : false
      },
    },
    // Number keys: select by position on the current page
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ({
      key: String(n),
      run: (view: EditorView) => {
        const im = view.state.field(imStateField)
        if (!im.active || im.candidates.length <= 1) return false
        const page = Math.floor(im.candidateIndex / PAGE_SIZE)
        return navigateCandidate(view, page * PAGE_SIZE + n - 1)
      },
    })),
  ]))

  // domEventHandler: handles printable chars not covered by the keymap above
  const domHandler = EditorView.domEventHandlers({
    keydown(event, view) {
      const im = view.state.field(imStateField)
      if (!im.active) return false
      if (event.ctrlKey || event.metaKey || event.altKey) return false
      const key = event.key
      if (key.length === 1) return handleChar(view, key)
      return false
    },
  })

  const theme = EditorView.baseTheme({
    '.agda-im-tooltip': {
      display: 'flex',
      flexDirection: 'column',
      padding: '5px 8px',
      gap: '3px',
      fontFamily: 'JuliaMono, monospace',
      minWidth: '120px',
      maxWidth: '520px',
      maxHeight: '200px',
      overflowY: 'auto',
    },
    '.agda-im-row': {
      display: 'flex',
      alignItems: 'baseline',
      flexWrap: 'wrap',
      gap: '2px',
    },
    '.agda-im-row-keys': {
      borderTop: '1px solid rgba(128,128,128,0.2)',
      paddingTop: '3px',
      marginTop: '1px',
    },
    '.agda-im-seq': {
      color: '#888',
      fontFamily: 'JuliaMono, monospace',
      fontSize: '12px',
      minWidth: '2ch',
    },
    '&dark .agda-im-seq': { color: '#666' },
    '.agda-im-arr': { color: '#888', fontSize: '12px' },
    '&dark .agda-im-arr': { color: '#555' },
    '.agda-im-cand': {
      padding: '1px 4px',
      borderRadius: '3px',
      cursor: 'default',
      userSelect: 'none',
      fontSize: '14px',
    },
    '.agda-im-cand-sel': {
      background: 'rgba(80,120,200,0.18)',
      outline: '1px solid rgba(80,120,200,0.35)',
    },
    '&dark .agda-im-cand-sel': {
      background: 'rgba(100,140,220,0.22)',
      outline: '1px solid rgba(100,140,220,0.4)',
    },
    '.agda-im-pager': {
      color: '#aaa',
      fontSize: '11px',
      fontFamily: 'JuliaMono, monospace',
      marginLeft: '2px',
    },
    '&dark .agda-im-pager': { color: '#555' },
    '.agda-im-keys-label': {
      color: '#aaa',
      fontSize: '11px',
      fontFamily: 'JuliaMono, monospace',
    },
    '&dark .agda-im-keys-label': { color: '#555' },
    '.agda-im-key': {
      display: 'inline-block',
      padding: '0 3px',
      border: '1px solid rgba(128,128,128,0.35)',
      borderRadius: '2px',
      fontSize: '11px',
      fontFamily: 'JuliaMono, monospace',
      color: '#666',
      lineHeight: '1.4',
    },
    '&dark .agda-im-key': {
      borderColor: 'rgba(128,128,128,0.3)',
      color: '#888',
    },
  })

  return [imStateField, tooltipField, imKeymap, domHandler, theme]
}
