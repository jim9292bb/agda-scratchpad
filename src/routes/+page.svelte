<script>
import { onDestroy, tick, untrack } from 'svelte'

import { SPSC } from 'spsc'
// import { SplitPane } from '@rich_harris/svelte-split-pane'
import { basicSetup } from 'codemirror'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'

import SplitPane from '$lib/components/SplitPane.svelte'
import { AgdaController, LS_DOC_KEY } from '$lib/controller.svelte'
import { myCodeMirrorTheme } from '$lib/codemirror/theme'
import { agdaInputMethod } from '$lib/codemirror/agda-input'
import { attachAgdaIM } from '$lib/codemirror/agda-input-dom'
import { agdaSupport } from '$lib/agda'
import { getAgdaDocumentVersion, getAgdaGoals, mergeGoalInfos } from '$lib/agda/goal-state'
import { getGoalAtPosition, getGoalRangeById } from '$lib/agda/goals'
import { getAgdaShortcutContext } from '$lib/agda/shortcut-context'
import {
  agdaShortcutRegistry,
  createAgdaShortcutRegistry,
  findAgdaChordShortcut,
  formatAgdaShortcutHelpBinding,
  isAgdaCtrlKey,
  validateAgdaShortcutOverrides,
} from '$lib/agda/shortcuts'
import { lookupChar, formatCodePoint } from '$lib/agda/input-lookup'
import {
  autoOneCommand,
  contextCommand,
  computeCommand,
  elaborateGiveCommand,
  giveCommand,
  goalTypeCommand,
  goalTypeContextCommand,
  goalTypeContextCheckCommand,
  goalTypeContextInferCommand,
  helperFunctionCommand,
  inferCommand,
  makeCaseCommand,
  moduleContentsCommand,
  moduleContentsToplevelCommand,
  refineCommand,
  searchAboutToplevelCommand,
  whyInScopeCommand,
  whyInScopeToplevelCommand,
} from '$lib/agda/commands'
import { diagnosticToAgdaUtf8Position, focusAgdaUtf8Position } from '$lib/agda/diagnostics'

import { clearGoals, clearRunningInfo, emitRunningInfo, removeGoalInfo, setGoalInfo } from '$lib/agda/effects'

const driveLockSab = new SharedArrayBuffer(4)
const driveStdinSab = SPSC.allocateArrayBuffer(4096)
const driveStdoutSab = SPSC.allocateArrayBuffer(4096)

const agdaStdinSab = SPSC.allocateArrayBuffer(4096)
const agdaStdoutSab = SPSC.allocateArrayBuffer(4096)

const agdaController = new AgdaController({
  agdaBuffers: {
    stdin: agdaStdinSab,
    stdout: agdaStdoutSab,
  },
  driveBuffers: {
    lock: driveLockSab,
    stdin: driveStdinSab,
    stdout: driveStdoutSab,
  },
  agdaVersion: '2.8.0',
})

$effect(() => {
  if (agdaController.alsWorkerStatus === 'initial') {
    untrack(() => agdaController.startALSWASM())
  }
})

function runtimeSummary() {
  return [
    { label: 'Runtime backend', value: 'browser-wasi-shim-memfs' },
    { label: 'Agda runtime', value: 'v2.8.0' },
    { label: 'ALS WASM', value: 'als-2.8ext.wasm' },
    { label: 'standard-library', value: 'v2.3' },
    { label: 'Cubical', value: 'v0.9' },
  ]
}

const settingsSegments = [
  { id: 'general', label: 'General' },
  { id: 'editor', label: 'Editor' },
  { id: 'runtime', label: 'Runtime' },
  { id: 'commands', label: 'Commands' },
  { id: 'planned', label: 'Planned' },
]

const defaultSource = '{-# OPTIONS --cubical --guardedness #-}\n\nopen import Cubical.Foundations.Prelude\n'
const LS_SHORTCUT_OVERRIDES_KEY = 'agda-scratchpad.shortcut-overrides.v1'
const agdaShortcutIds = new Set(agdaShortcutRegistry.map(shortcut => shortcut.id))

/** @returns {Record<string, string>} */
function loadShortcutOverrides() {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(LS_SHORTCUT_OVERRIDES_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => typeof value === 'string')
    )
  } catch {
    return {}
  }
}

/**
 * @param {Record<string, string>} overrides
 * @returns {Record<string, string>}
 */
function cleanShortcutOverrides(overrides) {
  return Object.fromEntries(
    Object.entries(overrides)
      .map(([id, value]) => [id, value.trim()])
      .filter(([id, value]) => agdaShortcutIds.has(id) && value)
  )
}

const scratchpadExamples = [
  {
    id: 'cubical-prelude',
    label: 'Cubical Prelude',
    description: 'Minimal Cubical Agda import.',
    source: defaultSource,
  },
  {
    id: 'nat-basics',
    label: 'Nat basics',
    description: 'Define a small natural number datatype.',
    source: `data N : Set where
  z : N
  s : N -> N

one : N
one = s z
`,
  },
  {
    id: 'case-split-plus',
    label: 'Case split practice',
    description: 'Practice C-c C-c on the first argument.',
    source: `data N : Set where
  z : N
  s : N -> N

_+_ : N -> N -> N
a + b = ?
`,
  },
  {
    id: 'auto-identity',
    label: 'Auto practice',
    description: 'Practice C-c C-a in a simple goal.',
    source: `data N : Set where
  z : N
  s : N -> N

idN : N -> N
idN n = {! !}
`,
  },
  {
    id: 'refine-elaborate',
    label: 'Refine / elaborate',
    description: 'Practice C-c C-r or C-c C-m with an expression.',
    source: `data N : Set where
  z : N
  s : N -> N

idN : N -> N
idN n = {! n !}
`,
  },
  {
    id: 'query-bool',
    label: 'Query practice',
    description: 'Practice infer, compute, module contents, and why-in-scope.',
    source: `open import Agda.Builtin.Bool

test : Bool
test = true
`,
  },
  {
    id: 'stdlib-nat',
    label: 'standard-library Nat',
    description: 'Minimal standard-library import.',
    source: 'open import Data.Nat.Base\n',
  },
]

let width = $state(0)
let isMobile = $derived(width < 540)

onDestroy(() => {
  agdaController.terminateALSWASM()
})

const basicTheme = EditorView.theme({
  '.cm-panels': {
    // FIXME: should decouple from this extension
    marginRight: '-4px',
    paddingRight: '4px',
  },
  '.cm-scroller': {
    overscrollBehavior: 'contain',
  },
})

/**
 * @param {string} label
 * @param {EditorView} view
 * @param {(context: import('$lib/agda/shortcut-context').AgdaShortcutContext) => string | Promise<void>} command
 */
function runAgdaShortcut(label, view, command) {
  void (async () => {
    if (agdaController.alsWorkerStatus !== 'active') {
      textboxContent += `${label} failed: ALS is not active.\n`
      return
    }

    try {
      textboxContent += `${label}...\n`
      await agdaController.syncSourceFileToDrive()
      const context = getAgdaShortcutContext(view, agdaController.currentFilePath, goalInfos)
      const interaction = await command(context)
      if (interaction) await agdaController.runAgdaInteraction(interaction)
      textboxContent += `${label} finished.\n`
    } catch (err) {
      if (label === 'Case split' && agdaController.alsRouter) {
        agdaController.alsRouter.pendingCaseSplitGoal = undefined
      } else if ((label === 'Give' || label === 'Auto' || label === 'Elaborate and give') && agdaController.alsRouter) {
        agdaController.alsRouter.pendingGiveGoal = undefined
      }
      textboxContent += `${label} failed: ${err instanceof Error ? err.message : String(err)}\n`
    }
  })()
}

/**
 * @param {string} label
 * @param {EditorView} view
 * @param {(context: import('$lib/agda/shortcut-context').AgdaShortcutContext, input: string) => string | Promise<void>} command
 */
function runAgdaShortcutWithInputPrompt(label, view, command) {
  void (async () => {
    if (agdaController.alsWorkerStatus !== 'active') {
      textboxContent += `${label} failed: ALS is not active.\n`
      return
    }

    try {
      await agdaController.syncSourceFileToDrive()
      const context = getAgdaShortcutContext(view, agdaController.currentFilePath, goalInfos)
      if (!context.input.trim()) {
        openCommandInputPrompt(label, view, context, command)
        return
      }

      textboxContent += `${label}...\n`
      const interaction = await command(context, context.input)
      if (interaction) await agdaController.runAgdaInteraction(interaction)
      textboxContent += `${label} finished.\n`
    } catch (err) {
      clearPendingAgdaGoal(label)
      textboxContent += `${label} failed: ${err instanceof Error ? err.message : String(err)}\n`
    }
  })()
}

function runLoadShortcut() {
  void (async () => {
    if (agdaController.alsWorkerStatus !== 'active') {
      textboxContent += 'Load failed: ALS is not active.\n'
      return
    }

    try {
      await loadAgdaFile()
    } catch {
      // loadAgdaFile already writes the failure to the log.
    }
  })()
}

/** @param {ReturnType<typeof getAgdaShortcutContext>} context */
function requireGoal(context) {
  if (!context.goal) throw new Error('Place the cursor inside a goal first.')
  return context.goal
}

/** @param {ReturnType<typeof getAgdaShortcutContext>} context */
function requireInput(context) {
  if (!context.input.trim()) throw new Error('Enter an expression in the goal or select one first.')
  return context.input
}

/** @param {ReturnType<typeof getAgdaShortcutContext>} context */
function requireGoalOrSelectedInput(context) {
  const input = requireInput(context)
  return { goal: context.goal, input }
}

/** @param {string} label */
function clearPendingAgdaGoal(label) {
  if (label === 'Case split' && agdaController.alsRouter) {
    agdaController.alsRouter.pendingCaseSplitGoal = undefined
  } else if ((label === 'Give' || label === 'Auto' || label === 'Elaborate and give') && agdaController.alsRouter) {
    agdaController.alsRouter.pendingGiveGoal = undefined
  }
}

/**
 * @param {string} label
 * @param {EditorView} view
 * @param {import('$lib/agda/shortcut-context').AgdaShortcutContext} context
 * @param {(context: import('$lib/agda/shortcut-context').AgdaShortcutContext, input: string) => string | Promise<void>} command
 */
function openCommandInputPrompt(label, view, context, command) {
  commandInputError = ''
  commandInputPrompt = {
    label,
    value: '',
    documentVersion: getAgdaDocumentVersion(view.state),
    command,
    context,
  }
  textboxContent += `${label}: enter command input in the Goals panel.\n`
  void tick().then(() => commandInputElement?.focus())
}

function cancelCommandInputPrompt() {
  const label = commandInputPrompt?.label
  commandInputPrompt = null
  if (label) textboxContent += `${label} cancelled.\n`
  agdaController.editorView?.focus()
}

function submitCommandInputPrompt() {
  void (async () => {
    const prompt = commandInputPrompt
    const view = agdaController.editorView
    if (!prompt || !view) return

    const input = prompt.value.trim()
    if (!input) {
      commandInputError = 'Enter an expression before submitting.'
      return
    }

    if (getAgdaDocumentVersion(view.state) !== prompt.documentVersion) {
      commandInputPrompt = null
      textboxContent += `${prompt.label} failed: Reload or retry because the editor changed while the prompt was open.\n`
      view.focus()
      return
    }

    commandInputError = ''
    commandInputPrompt = null
    try {
      textboxContent += `${prompt.label}...\n`
      const interaction = await prompt.command(prompt.context, input)
      if (interaction) await agdaController.runAgdaInteraction(interaction)
      textboxContent += `${prompt.label} finished.\n`
    } catch (err) {
      clearPendingAgdaGoal(prompt.label)
      textboxContent += `${prompt.label} failed: ${err instanceof Error ? err.message : String(err)}\n`
    } finally {
      view.focus()
    }
  })()
}

/** @param {EditorView} view */
function getActiveGoalId(view) {
  const docLength = view.state.doc.length
  const head = view.state.selection.main.head
  const previousPos = Math.max(0, head - 1)
  const nextPos = Math.min(docLength, head + 1)
  return (
    getGoalAtPosition(view.state, head) ??
    getGoalAtPosition(view.state, previousPos) ??
    getGoalAtPosition(view.state, nextPos)
  )?.id ?? null
}

/**
 * @param {EditorView} view
 * @param {1 | -1} direction
 */
function focusAdjacentGoal(view, direction) {
  const goals = getAgdaGoals(view.state)
  if (goals.length === 0) {
    textboxContent += 'Goal navigation failed: No goals.\n'
    return
  }

  const head = view.state.selection.main.head
  const currentIndex = goals.findIndex(goal => goal.outerFrom <= head && head <= goal.outerTo)
  let targetIndex

  if (currentIndex >= 0) {
    targetIndex = (currentIndex + direction + goals.length) % goals.length
  } else if (direction > 0) {
    const nextIndex = goals.findIndex(goal => goal.outerFrom > head)
    targetIndex = nextIndex >= 0 ? nextIndex : 0
  } else {
    for (let i = goals.length - 1; i >= 0; i--) {
      if (goals[i].outerTo < head) {
        targetIndex = i
        break
      }
    }
    targetIndex ??= goals.length - 1
  }

  focusGoal(goals[targetIndex].id)
}

/** @param {EditorView} view */
function syncGoalPanel(view) {
  panelGoalInfos = getAgdaGoals(view.state).map(goal => ({
    id: goal.id,
    range: goal.range,
    type: goal.type,
    context: goal.context,
  }))

  const active = getActiveGoalId(view)
  activeGoalId = active != null && panelGoalInfos.some(goal => goal.id === active) ? active : null
}

/**
 * @param {number} goalId
 * @param {number} documentVersion
 */
let autoFetchingGoalTypes = $state(false)

async function autoFetchGoalTypes(/** @type {number} */ documentVersion) {
  if (autoFetchingGoalTypes) return
  autoFetchingGoalTypes = true
  try {
    const goalIds = /** @type {number[]} */ (panelGoalInfos
      .filter(g => typeof g.id === 'number' && g.type === undefined)
      .map(g => g.id))
    for (const goalId of goalIds) {
      const view = agdaController.editorView
      if (!view || getAgdaDocumentVersion(view.state) !== documentVersion) break
      if (agdaController.alsWorkerStatus !== 'active') break
      if (panelGoalInfos.find(g => g.id === goalId)?.type !== undefined) continue
      await agdaController.runAgdaInteraction(
        goalTypeContextCommand('Simplified', { id: goalId }),
        { suppressDisplayInfo: true },
      )
    }
  } finally {
    autoFetchingGoalTypes = false
  }
}

async function requestActiveGoalDetails(/** @type {number} */ goalId, /** @type {number} */ documentVersion) {
  const requestKey = `${documentVersion}:${goalId}`
  if (activeGoalDetailRequestKey === requestKey) return

  activeGoalDetailRequestKey = requestKey
  activeGoalDetailStatus = 'loading'
  activeGoalDetailError = ''

  try {
    await agdaController.runAgdaInteraction(
      goalTypeContextCommand('Simplified', { id: goalId }),
      { suppressDisplayInfo: true },
    )
    if (activeGoalDetailRequestKey === requestKey) activeGoalDetailStatus = 'ready'
  } catch (err) {
    if (activeGoalDetailRequestKey === requestKey) {
      activeGoalDetailStatus = 'error'
      activeGoalDetailError = err instanceof Error ? err.message : String(err)
    }
  }
}

let waitingForAgdaChord = $state(false)
let agdaChordSubPrefix = /** @type {string | undefined} */(undefined)
let waitingForCxChord = $state(false)

function clearAgdaChord() {
  waitingForAgdaChord = false
  agdaChordSubPrefix = undefined
}

function clearCxChord() {
  waitingForCxChord = false
}

/** @param {EditorView} view */
function lookupUnicodeAtCursor(view) {
  const { from, to } = view.state.selection.main
  const text = view.state.sliceDoc(from, to > from ? to : from + 2)
  const cp = text.codePointAt(0)
  if (cp === undefined || text.length === 0) {
    agdaController.appendQueryResult('Unicode Lookup', 'No character at cursor.')
    return
  }
  const char = String.fromCodePoint(cp)
  const sequences = lookupChar(char)
  const uLabel = formatCodePoint(cp)
  const content = sequences.length === 0
    ? `${char}  (${uLabel})\nNo Agda input sequences found.`
    : `${char}  (${uLabel})\n${sequences.map(s => '\\' + s).join('  ')}`
  agdaController.appendQueryResult('Unicode Lookup', content)
  selectedMessageTab = 'queries'
}

/**
 * @param {import('$lib/agda/shortcuts').AgdaShortcutDefinition} shortcut
 * @param {EditorView} view
 */
function runAgdaShortcutDefinition(shortcut, view) {
  switch (shortcut.id) {
    case 'load':
      runLoadShortcut()
      break
    case 'next-goal':
      focusAdjacentGoal(view, 1)
      break
    case 'previous-goal':
      focusAdjacentGoal(view, -1)
      break
    case 'goal-type':
      runAgdaShortcut(shortcut.label, view, context => goalTypeCommand('Simplified', requireGoal(context)))
      break
    case 'context':
      runAgdaShortcut(shortcut.label, view, context => contextCommand('Simplified', requireGoal(context)))
      break
    case 'goal-type-context':
      runAgdaShortcut(shortcut.label, view, context => goalTypeContextCommand('Simplified', requireGoal(context)))
      break
    case 'goal-type-context-infer':
      runAgdaShortcut(shortcut.label, view, context => {
        const goal = requireGoal(context)
        if (!context.input.trim()) {
          return goalTypeContextCommand('Simplified', goal)
        }
        return goalTypeContextInferCommand('Simplified', goal, context.input)
      })
      break
    case 'goal-type-context-check':
      runAgdaShortcutWithInputPrompt(shortcut.label, view, (context, input) =>
        goalTypeContextCheckCommand('Simplified', requireGoal(context), input))
      break
    case 'search-about':
      runAgdaShortcutWithInputPrompt(shortcut.label, view, (_context, input) =>
        searchAboutToplevelCommand('Simplified', input))
      break
    case 'module-contents':
      runAgdaShortcutWithInputPrompt(shortcut.label, view, (context, input) => {
        const goal = context.goal
        return goal
          ? moduleContentsCommand('Simplified', goal, input)
          : moduleContentsToplevelCommand('Simplified', input)
      })
      break
    case 'why-in-scope':
      runAgdaShortcutWithInputPrompt(shortcut.label, view, (context, input) => {
        const goal = context.goal
        return goal
          ? whyInScopeCommand(goal, input)
          : whyInScopeToplevelCommand(input)
      })
      break
    case 'give':
      runAgdaShortcutWithInputPrompt(shortcut.label, view, (context, input) => {
        const goal = requireGoal(context)
        if (agdaController.alsRouter) {
          agdaController.alsRouter.pendingGiveGoal = goal
        }
        return giveCommand(goal, context.range, input)
      })
      break
    case 'refine':
      runAgdaShortcutWithInputPrompt(shortcut.label, view, (context, input) =>
        refineCommand(requireGoal(context), context.range, input))
      break
    case 'auto':
      runAgdaShortcut(shortcut.label, view, context => {
        const goal = requireGoal(context)
        if (agdaController.alsRouter) {
          agdaController.alsRouter.pendingGiveGoal = goal
        }
        return autoOneCommand('AsIs', goal, context.range, context.input)
      })
      break
    case 'elaborate-give':
      runAgdaShortcutWithInputPrompt(shortcut.label, view, (context, input) => {
        const goal = requireGoal(context)
        if (agdaController.alsRouter) {
          agdaController.alsRouter.pendingGiveGoal = goal
        }
        return elaborateGiveCommand('Simplified', goal, input)
      })
      break
    case 'helper-function':
      runAgdaShortcutWithInputPrompt(shortcut.label, view, (context, input) =>
        helperFunctionCommand('AsIs', requireGoal(context), input))
      break
    case 'case-split':
      runAgdaShortcutWithInputPrompt(shortcut.label, view, (context, input) => {
        const goal = requireGoal(context)
        if (agdaController.alsRouter) {
          agdaController.alsRouter.pendingCaseSplitGoal = goal
        }
        return makeCaseCommand(goal, context.range, input)
      })
      break
    case 'compute':
      runAgdaShortcutWithInputPrompt(shortcut.label, view, (context, input) =>
        computeCommand('DefaultCompute', requireGoal(context), input))
      break
    case 'infer':
      runAgdaShortcutWithInputPrompt(shortcut.label, view, (context, input) =>
        inferCommand('Normalised', requireGoal(context), input))
      break
  }
}

const agdaKeymap = keymap.of(agdaShortcutRegistry.flatMap(shortcut =>
  shortcut.bindings
    .filter(binding => binding.kind === 'keymap')
    .map(binding => ({
      key: binding.key,
      run: (/** @type {EditorView} */ view) => {
        runAgdaShortcutDefinition(shortcut, view)
        return true
      },
    }))))

/**
 * Handles Agda/Emacs-style two-key chords before the browser can consume
 * shortcuts such as Ctrl-L.
 *
 * @param {KeyboardEvent} event
 * @param {EditorView} view
 */
function handleAgdaChordKeydown(event, view) {
  if (event.isComposing || !view.hasFocus) return false

  // C-x chord (e.g. C-x C-= for Unicode lookup)
  if (isAgdaCtrlKey(event, 'x') && !waitingForAgdaChord && !waitingForCxChord) {
    event.preventDefault()
    event.stopPropagation()
    waitingForCxChord = true
    return true
  }

  if (waitingForCxChord) {
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return false
    event.preventDefault()
    event.stopPropagation()
    clearCxChord()
    if (event.key === '=') lookupUnicodeAtCursor(view)
    return true
  }

  // C-c chord
  if (isAgdaCtrlKey(event, 'c') && !waitingForAgdaChord) {
    event.preventDefault()
    event.stopPropagation()
    waitingForAgdaChord = true
    return true
  }

  if (!waitingForAgdaChord) return false

  // Modifier-only keypresses are not a second chord key; the user may release
  // and re-press Ctrl between the two chord keys without cancelling the chord.
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return false

  event.preventDefault()
  event.stopPropagation()

  // C-c C-x is a sub-prefix for three-key chords (e.g. C-c C-x C-a = abort)
  if (!agdaChordSubPrefix && isAgdaCtrlKey(event, 'x')) {
    agdaChordSubPrefix = 'x'
    return true
  }

  const subPrefix = agdaChordSubPrefix
  clearAgdaChord()

  if (subPrefix === 'x') {
    if (isAgdaCtrlKey(event, 'a')) sendAbort()
    return true
  }

  const shortcut = findAgdaChordShortcut(event, activeAgdaShortcutRegistry)
  if (shortcut) runAgdaShortcutDefinition(shortcut, view)

  return true
}

const agdaChordKeymap = EditorView.domEventHandlers({
  keydown(event, view) {
    return handleAgdaChordKeydown(event, view)
  },
})

/** @type {import('svelte/attachments').Attachment} */
function codeMirror(el) {
  const ev = new EditorView({
    doc: localStorage.getItem(LS_DOC_KEY) ?? defaultSource,
    parent: el,
    extensions: [
      basicSetup,
      myCodeMirrorTheme(),
      basicTheme,
      agdaSupport(),
      agdaInputMethod(),
      agdaKeymap,
      agdaChordKeymap,
      EditorView.updateListener.of(update => {
        const goalEffects = update.transactions.some(tr => tr.effects.length > 0)
        if (update.selectionSet || update.docChanged || goalEffects) {
          syncGoalPanel(update.view)
        }
      }),
      agdaController.lspClientCompartment.of([]),
      EditorState.changeFilter.of(tr => {
        for (const e of tr.effects) {
          if (e.is(emitRunningInfo)) {
            textboxContent += e.value.message
          } else if (e.is(clearRunningInfo)) {
            // Highlighting commands may clear Agda's running-info buffer after
            // loading succeeds; keep the visible load log until the next Load.
          } else if (e.is(setGoalInfo)) {
            goalInfos = mergeGoalInfos(goalInfos, e.value)
          } else if (e.is(removeGoalInfo)) {
            goalInfos = goalInfos.filter(goal => goal.id !== e.value)
          }
        }
        return true
      })
    ],
  })

  agdaController.connectEditorView(ev)
  const captureAgdaChord = (/** @type {KeyboardEvent} */ event) => {
    if (handleAgdaChordKeydown(event, ev)) {
      event.stopImmediatePropagation()
    }
  }
  const reloadAfterAgdaEdit = () => {
    void (async () => {
      while (agdaController.alsWorkerStatus === 'active' && agdaController.iotcmStatus !== 'ready') {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      if (agdaController.alsWorkerStatus === 'active') {
        await loadAgdaFile()
      }
    })()
  }
  window.addEventListener('keydown', captureAgdaChord, { capture: true })
  ev.dom.addEventListener('agda-reload-needed', reloadAfterAgdaEdit)

  return () => {
    window.removeEventListener('keydown', captureAgdaChord, { capture: true })
    ev.dom.removeEventListener('agda-reload-needed', reloadAfterAgdaEdit)
    clearAgdaChord()
    clearCxChord()
    ev.destroy()
  }
}

function clearScratchpadInteractionState() {
  goalInfos = []
  panelGoalInfos = []
  agdaDiagnostics = []
  activeGoalId = null
  activeGoalDetailRequestKey = ''
  activeGoalDetailStatus = 'idle'
  activeGoalDetailError = ''
  commandInputPrompt = null
  commandInputError = ''
  settingsPanelVisible = false
  agdaController.editorView?.dispatch({ effects: clearGoals.of() })
}

/** @param {string} source */
function replaceScratchpadSource(source) {
  const view = agdaController.editorView
  if (!view) return
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: source },
    selection: { anchor: 0 },
  })
  localStorage.setItem(LS_DOC_KEY, source)
  clearScratchpadInteractionState()
  textboxContent = 'Example loaded into editor. Click Load to type-check it.\n'
  view.focus()
}

/** @param {string} exampleId */
function selectScratchpadExample(exampleId) {
  selectedExampleId = exampleId
  const example = scratchpadExamples.find(example => example.id === exampleId)
  if (example) replaceScratchpadSource(example.source)
}

function openSettingsPanel() {
  selectedSettingsSegment = 'general'
  shortcutDrafts = { ...shortcutOverrides }
  shortcutOverrideMessage = ''
  settingsPanelVisible = true
}

function closeSettingsPanel() {
  settingsPanelVisible = false
  agdaController.editorView?.focus()
}

function copyEditorCode() {
  const text = agdaController.editorView?.state.doc.toString() ?? ''
  navigator.clipboard.writeText(text)
}

function exportAgdaFile() {
  const text = agdaController.editorView?.state.doc.toString() ?? ''
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'source.agda'
  a.click()
  URL.revokeObjectURL(url)
}

/** @param {Event} event */
function openAgdaFile(event) {
  const input = /** @type {HTMLInputElement} */ (event.currentTarget)
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const text = /** @type {string} */ (reader.result)
    const view = agdaController.editorView
    if (!view) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  }
  reader.readAsText(file)
  input.value = ''
}

/**
 * @param {string} id
 * @param {string} value
 */
function setShortcutDraft(id, value) {
  shortcutDrafts = { ...shortcutDrafts, [id]: value }
  shortcutOverrideMessage = ''
}

/** @param {string} id */
function clearShortcutDraft(id) {
  const next = { ...shortcutDrafts }
  delete next[id]
  shortcutDrafts = next
  shortcutOverrideMessage = ''
}

function saveShortcutOverrides() {
  const cleaned = cleanShortcutOverrides(shortcutDrafts)
  const validation = validateAgdaShortcutOverrides(cleaned)
  if (!validation.valid) {
    shortcutOverrideMessage = validation.errors.join(' ')
    return
  }

  shortcutOverrides = cleaned
  shortcutDrafts = { ...cleaned }
  localStorage.setItem(LS_SHORTCUT_OVERRIDES_KEY, JSON.stringify(cleaned))
  shortcutOverrideMessage = Object.keys(cleaned).length
    ? 'Shortcut overrides saved.'
    : 'Shortcut overrides cleared.'
}

function resetShortcutOverrides() {
  shortcutOverrides = {}
  shortcutDrafts = {}
  localStorage.removeItem(LS_SHORTCUT_OVERRIDES_KEY)
  shortcutOverrideMessage = 'Shortcut overrides reset to defaults.'
}


function sendAbort() {
  return /** @type {any} */(agdaController.lspClient).request('agda', {
    tag: 'CmdReq',
    contents: `IOTCM "/source.agda" NonInteractive Direct (Cmd_abort)`,
  })
}

/** @param {number | string} goalId */
function focusGoal(goalId) {
  if (typeof goalId !== 'number' || !agdaController.editorView) return

  const view = agdaController.editorView
  const range = getGoalRangeById(view.state, goalId)
  if (!range) return

  const cursor = Math.min(range.to, range.from + 3)
  view.dispatch({
    selection: { anchor: cursor },
    scrollIntoView: true,
  })
  view.focus()
}

async function loadAgdaFile() {
  textboxContent = `Loading ${agdaController.currentFilePath}...\n`
  goalInfos = []
  panelGoalInfos = []
  agdaDiagnostics = []
  if (agdaController.alsRouter) {
    agdaController.alsRouter.lastAgdaDiagnostics = []
  }
  activeGoalId = null
  activeGoalDetailRequestKey = ''
  activeGoalDetailStatus = 'idle'
  activeGoalDetailError = ''
  commandInputPrompt = null
  commandInputError = ''
  agdaController.editorView?.dispatch({ effects: clearGoals.of() })
  try {
    await agdaController.loadAgdaFile()
    syncAgdaDiagnostics()
    textboxContent += 'Load finished.\n'
  } catch (err) {
    syncAgdaDiagnostics()
    textboxContent += `Load failed: ${err instanceof Error ? err.message : String(err)}\n`
    throw err
  }
}

function syncAgdaDiagnostics() {
  agdaDiagnostics = [...(agdaController.alsRouter?.lastAgdaDiagnostics ?? [])]
}

/** @param {import('$lib/agda/diagnostics').AgdaDiagnostic} diagnostic */
function formatDiagnosticLocation(diagnostic) {
  const start = `${diagnostic.filepath}:${diagnostic.line}.${diagnostic.column}`
  if (diagnostic.endLine == null || diagnostic.endColumn == null) return start
  if (diagnostic.endLine === diagnostic.line) return `${start}-${diagnostic.endColumn}`
  return `${start}-${diagnostic.endLine}.${diagnostic.endColumn}`
}

/** @param {import('$lib/agda/diagnostics').AgdaDiagnostic} diagnostic */
function canFocusDiagnostic(diagnostic) {
  return diagnostic.filepath === '/source.agda' &&
    Number.isFinite(diagnostic.line) &&
    Number.isFinite(diagnostic.column)
}

/** @param {import('$lib/agda/diagnostics').AgdaDiagnostic} diagnostic */
function focusDiagnostic(diagnostic) {
  const editorView = agdaController.editorView
  if (!editorView || !canFocusDiagnostic(diagnostic)) return
  const position = diagnosticToAgdaUtf8Position(editorView.state, diagnostic)
  focusAgdaUtf8Position(editorView, position)
}

/** @type {HTMLDivElement | undefined} */
let textbox = $state(/** @type {HTMLDivElement | undefined} */(undefined))

let textboxContent = $state('WIP')
let logEntries = $derived(textboxContent.trimEnd().split(/\n+/).filter(Boolean))
let selectedExampleId = $state('cubical-prelude')
let selectedScratchpadExample = $derived(scratchpadExamples.find(example => example.id === selectedExampleId))
const initialShortcutOverrides = loadShortcutOverrides()
let goalInfos = $state(/** @type {{id: number | string, range?: string, type?: string, context?: string}[]} */([]))
let panelGoalInfos = $state(/** @type {{id: number | string, range?: string, type?: string, context?: string}[]} */([]))
let agdaDiagnostics = $state(/** @type {import('$lib/agda/diagnostics').AgdaDiagnostic[]} */([]))
let activeGoalId = $state(/** @type {number | string | null} */(null))
let activeGoalDetailRequestKey = $state('')
let activeGoalDetailStatus = $state(/** @type {'idle' | 'loading' | 'ready' | 'error'} */('idle'))
let activeGoalDetailError = $state('')
let selectedMessageTab = $state(/** @type {'log' | 'queries' | 'errors'} */('log'))
let commandsPanelVisible = $state(false)
let editorGoalsSplit = $state(0.65)
let savedEditorGoalsSplit = $state(/** @type {number | null} */(null))
/** @type {HTMLElement | undefined} */
let editorPaneSectionEl = $state()
/** @type {HTMLElement | undefined} */
let commandsPanelEl = $state()

async function toggleCommandsPanel() {
  if (!commandsPanelVisible) {
    commandsPanelVisible = true
    await tick()
    if (editorPaneSectionEl && commandsPanelEl) {
      const editorH = editorPaneSectionEl.clientHeight
      const panelH = commandsPanelEl.clientHeight
      const totalH = editorH / editorGoalsSplit
      savedEditorGoalsSplit = editorGoalsSplit
      editorGoalsSplit = Math.max(0.1, editorGoalsSplit - panelH / totalH)
    }
  } else {
    commandsPanelVisible = false
    if (savedEditorGoalsSplit !== null) {
      editorGoalsSplit = savedEditorGoalsSplit
      savedEditorGoalsSplit = null
    }
  }
}
let settingsPanelVisible = $state(false)
let examplesMenuOpen = $state(false)
let aboutPanelVisible = $state(false)
/** @type {HTMLInputElement} */
let fileInput
let selectedSettingsSegment = $state('general')
let shortcutOverrides = $state(initialShortcutOverrides)
let shortcutDrafts = $state({ ...initialShortcutOverrides })
let shortcutOverrideMessage = $state('')
let activeAgdaShortcutRegistry = $derived(createAgdaShortcutRegistry(shortcutOverrides))
let shortcutDraftValidation = $derived(validateAgdaShortcutOverrides(cleanShortcutOverrides(shortcutDrafts)))
let commandInputPrompt = $state(/** @type {null | {
  label: string,
  value: string,
  documentVersion: number,
  context: import('$lib/agda/shortcut-context').AgdaShortcutContext,
  command: (context: import('$lib/agda/shortcut-context').AgdaShortcutContext, input: string) => string | Promise<void>,
}} */(null))
let commandInputError = $state('')
/** @type {HTMLInputElement | undefined} */
let commandInputElement = $state(/** @type {HTMLInputElement | undefined} */(undefined))

/** @param {HTMLInputElement} el */
function agdaInputAction(el) {
  const cleanup = attachAgdaIM(el)
  return { destroy: cleanup }
}

/** @type {number | undefined} */
let raf
let needScroll = false

$effect.pre(() => {
  textboxContent
  if (textbox && textbox.scrollHeight - textbox.clientHeight - textbox.scrollTop < 50) {
    needScroll = true
  }
})

$effect(() => {
  textboxContent
  untrack(() => raf)
  if (needScroll && !raf) {
    raf = requestAnimationFrame(() => {
      if (textbox) textbox.scrollTop = textbox.scrollHeight
      raf = undefined
      needScroll = false
    })
  }
})

$effect(() => {
  const view = agdaController.editorView
  const goalId = activeGoalId
  const goal = panelGoalInfos.find(goal => goal.id === goalId)

  if (
    !view ||
    typeof goalId !== 'number' ||
    !goal ||
    goal.context !== undefined ||
    agdaController.alsWorkerStatus !== 'active' ||
    agdaController.iotcmStatus !== 'ready'
  ) {
    return
  }

  const documentVersion = getAgdaDocumentVersion(view.state)
  untrack(() => {
    void requestActiveGoalDetails(goalId, documentVersion)
  })
})

$effect(() => {
  if (autoFetchingGoalTypes) return
  if (panelGoalInfos.every(g => g.type !== undefined)) return
  if (agdaController.alsWorkerStatus !== 'active') return
  if (agdaController.iotcmStatus !== 'ready') return
  const view = agdaController.editorView
  if (!view) return
  const documentVersion = getAgdaDocumentVersion(view.state)
  untrack(() => {
    void autoFetchGoalTypes(documentVersion)
  })
})
</script>

{#snippet editor(/** @type {'horizontal' | 'vertical'} */ orientation)}
<SplitPane {orientation} position={.6} style="--divider-min-position: 25%; --divider-max-position: 90%;">
  {#snippet start()}
  <section class="editor-section">
    <header class="header">
      <div class="header-left">
        <span class="header-title">Agda Scratchpad</span>
        {@render headerExamplePicker()}
      </div>
      <div class="header-actions">
        <button type="button" class="header-action-btn" onclick={copyEditorCode}>Copy</button>
        <button type="button" class="header-action-btn" onclick={() => fileInput.click()}>Open</button>
        <button type="button" class="header-action-btn" onclick={exportAgdaFile}>Export</button>
      </div>
    </header>
    <SplitPane class="editor-goals-splitter" orientation="vertical" bind:ratio={editorGoalsSplit} style="--divider-min-position: 35%; --divider-max-position: 92%;">
      {#snippet start()}
      <section class="editor-pane" bind:this={editorPaneSectionEl}>
        <div class="editor-wrap">
          <div class="container" {@attach codeMirror}></div>
          {#if waitingForAgdaChord}
            <div class="chord-hint" aria-live="polite" aria-label="Waiting for second chord key">C-c</div>
          {:else if waitingForCxChord}
            <div class="chord-hint" aria-live="polite" aria-label="Waiting for second chord key">C-x</div>
          {/if}
        </div>
      </section>
      {/snippet}
      {#snippet end()}
      <section class="goals-section">
        <section class="commands-panel-shell">
          <button
            type="button"
            class="commands-panel-toggle"
            aria-expanded={commandsPanelVisible}
            aria-controls="commands-panel"
            onclick={toggleCommandsPanel}>
            <span class="commands-panel-arrow" class:open={commandsPanelVisible}>▶</span>
            Commands
          </button>
          {#if commandsPanelVisible}
            <div id="commands-panel" class="commands-panel" aria-label="Agda commands" bind:this={commandsPanelEl}>
              {#each activeAgdaShortcutRegistry as shortcut}
                <button
                  type="button"
                  class="command-button"
                  onclick={() => {
                    if (agdaController.editorView) {
                      runAgdaShortcutDefinition(shortcut, agdaController.editorView)
                      agdaController.editorView.focus()
                    }
                  }}>
                  {formatAgdaShortcutHelpBinding(shortcut)}
                </button>
              {/each}
            </div>
          {/if}
        </section>
        <header class="panel-header">Goals</header>
        {#if commandInputPrompt}
          <form class="command-input-panel" onsubmit={(event) => { event.preventDefault(); submitCommandInputPrompt() }}>
            <label for="command-input">Input for {commandInputPrompt.label}</label>
            <div class="command-input-row">
              <input
                id="command-input"
                use:agdaInputAction
                bind:this={commandInputElement}
                bind:value={commandInputPrompt.value}
                autocomplete="off"
                spellcheck="false"
                placeholder="Agda expression or name" />
              <button type="submit">Run</button>
              <button type="button" onclick={cancelCommandInputPrompt}>Cancel</button>
            </div>
            {#if commandInputError}
              <div class="command-input-error">{commandInputError}</div>
            {/if}
          </form>
        {/if}
        <div class="goals-list">
          {#if panelGoalInfos.length === 0}
            <div class="goals-empty">No goals.</div>
          {:else}
            {#each panelGoalInfos as goal (`${goal.id}-${goal.range ?? ''}`)}
              <button
                type="button"
                class:active={goal.id === activeGoalId}
                class="goal-entry"
                aria-label={`Focus goal ${goal.id}`}
                onclick={() => focusGoal(goal.id)}>
                <div class="goal-head">?{goal.id} : {#if goal.type}{goal.type}{:else if goal.id === activeGoalId && activeGoalDetailStatus === 'loading'}<span class="goal-type-muted">…</span>{:else}<span class="goal-type-muted">?</span>{/if}</div>
                {#if goal.id === activeGoalId}
                  {#if goal.context}
                    <div class="goal-separator"></div>
                    <pre class="goal-context">{goal.context}</pre>
                  {:else if activeGoalDetailStatus === 'loading'}
                    <div class="goal-separator"></div>
                    <div class="goal-context-empty">Loading…</div>
                  {:else if activeGoalDetailStatus === 'error'}
                    <div class="goal-separator"></div>
                    <div class="goal-context-empty">{activeGoalDetailError}</div>
                  {/if}
                {/if}
              </button>
            {/each}
          {/if}
        </div>
      </section>
      {/snippet}
    </SplitPane>
  </section>
  {/snippet}
  {#snippet end()}
  <section class="right-column">
    <SplitPane class="right-column-splitter" orientation="vertical" position={.65}>
      {#snippet start()}
      <section class="info-section">
        {@render alsButtons()}
      </section>
      {/snippet}
      {#snippet end()}
      <section class="output-section">
        {@render messagesPanel()}
      </section>
      {/snippet}
    </SplitPane>
  </section>
  {/snippet}
</SplitPane>
{@render settingsPanel()}
{@render aboutPanel()}
{/snippet}

{#snippet messagesPanel()}
  <section class="messages-panel" data-log-content={textboxContent} data-performance-entries={JSON.stringify(agdaController.performanceEntries)} data-query-results={agdaController.queryResults.map(r => r.content).join('\n---\n')} aria-label="Messages">
    <header class="messages-header">
      <div class="messages-header-info">
        <strong>Messages</strong>
        <span>{selectedMessageTab === 'log' ? 'Agda interaction log' : selectedMessageTab === 'queries' ? `${agdaController.queryResults.length} results` : `${agdaDiagnostics.length} diagnostics`}</span>
      </div>
      <div class="messages-tab-group" role="group" aria-label="Message view">
        <button type="button" class="messages-tab" class:active={selectedMessageTab === 'log'}
          onclick={() => { selectedMessageTab = 'log' }}>Log</button>
        <button type="button" class="messages-tab" class:active={selectedMessageTab === 'queries'}
          onclick={() => { selectedMessageTab = 'queries' }}>Queries{agdaController.queryResults.length ? ` (${agdaController.queryResults.length})` : ''}</button>
        <button type="button" class="messages-tab" class:active={selectedMessageTab === 'errors'}
          onclick={() => { selectedMessageTab = 'errors' }}>Errors{agdaDiagnostics.length ? ` (${agdaDiagnostics.length})` : ''}</button>
      </div>
    </header>

    <div class="messages-body">
      {#if selectedMessageTab === 'log'}
        <div bind:this={textbox} class="messages-log" aria-label="Agda log" role="log">
          {#if logEntries.length}
            {#each logEntries as entry}
              <pre class="messages-log-entry">{entry}</pre>
            {/each}
          {:else}
            <div class="messages-log-empty">(log area is empty)</div>
          {/if}
        </div>
      {:else if selectedMessageTab === 'queries'}
        {@render queriesPanel()}
      {:else}
        {@render diagnosticsPanel()}
      {/if}
    </div>
  </section>
{/snippet}

{#snippet queriesPanel()}
  <section class="queries-panel" aria-label="Agda query results">
    <header class="queries-panel-header">
      <span>Query results</span>
      {#if agdaController.queryResults.length}
        <button type="button" class="queries-clear-btn" onclick={() => agdaController.clearQueryResults()}>Clear</button>
      {/if}
    </header>
    {#if agdaController.queryResults.length}
      <div class="queries-list">
        {#each agdaController.queryResults as result (result.id)}
          <div class="query-result">
            <div class="query-result-label">{result.label}</div>
            <pre class="query-result-content">{result.content}</pre>
          </div>
        {/each}
      </div>
    {:else}
      <div class="queries-empty">No query results yet. Use C-c C-t, C-c C-,, C-c C-e, etc.</div>
    {/if}
  </section>
{/snippet}

{#snippet diagnosticsPanel()}
  <section class="diagnostics-panel" aria-label="Agda diagnostics">
    <header class="diagnostics-panel-title">Diagnostics</header>
    {#if agdaDiagnostics.length}
      <div class="diagnostics-list">
          {#each agdaDiagnostics as diagnostic}
            <button
              class:clickable={canFocusDiagnostic(diagnostic)}
              class:error={diagnostic.severity === 'error'}
              class:warning={diagnostic.severity === 'warning'}
              class="diagnostic-card"
              type="button"
              disabled={!canFocusDiagnostic(diagnostic)}
              aria-label={`Jump to ${formatDiagnosticLocation(diagnostic)}`}
              onclick={() => focusDiagnostic(diagnostic)}
            >
              <div class="diagnostic-meta">
                <strong>{diagnostic.severity}</strong>
                {#if diagnostic.code}
                  <code>{diagnostic.code}</code>
                {/if}
              </div>
              <div class="diagnostic-location">{formatDiagnosticLocation(diagnostic)}</div>
              <pre>{diagnostic.message}</pre>
            </button>
          {/each}
      </div>
    {:else}
      <div class="diagnostics-empty">No diagnostics.</div>
    {/if}
  </section>
{/snippet}

{#snippet alsButtons()}
  {@const statusMeta = {
    initial:      { color: '#888',    label: 'Starting...' },
    loading:      { color: '#f59e0b', label: 'Loading...' },
    loaded:       { color: '#f59e0b', label: agdaController.driveIsCreated ? 'Setting up...' : 'Fetching libraries...' },
    active:       { color: '#22c55e', label: 'Active' },
    deactivating: { color: '#888',    label: 'Stopping...' },
    errored:      { color: '#ef4444', label: 'Error' },
    exited:       { color: '#888',    label: 'Exited' },
    terminated:   { color: '#888',    label: 'Terminated' },
  }[agdaController.alsWorkerStatus] ?? { color: '#888', label: agdaController.alsWorkerStatus }}
  <div class="control-card">
    <div class="control-card-row">
      <span class="als-status-dot" style="--dot-color: {statusMeta.color}"></span>
      <span class="als-status-label" style="color: {statusMeta.color}">{statusMeta.label}{#if agdaController.alsWorkerStatus === 'loading' && agdaController.wasmLoadingProgress}{@const p = agdaController.wasmLoadingProgress}{@const loaded = (p.bytesLoaded / 1048576).toFixed(1)}{@const total = p.bytesTotal ? ` / ${(p.bytesTotal / 1048576).toFixed(1)}` : ''} {loaded}{total} MB{/if}</span>
      <button type="button" class="btn btn-primary" onclick={() => agdaController.restartALSWASM()} disabled={agdaController.alsWorkerStatus !== 'active'}>Restart</button>
      <div class="control-card-actions">
      <button type="button" class="control-btn control-icon-btn" aria-label="Help" onclick={toggleCommandsPanel}>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
          <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286zm1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94z"/>
          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0-1a8 8 0 1 1 0 16A8 8 0 0 1 8 0z"/>
        </svg>
      </button>
      <button type="button" class="control-btn control-icon-btn" aria-label="About" onclick={() => { aboutPanelVisible = true }}>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
          <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
          <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533L8.93 6.588zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
        </svg>
      </button>
      <a class="control-btn control-icon-btn" href="https://github.com/agda-web/als-demo" target="_blank" rel="noopener noreferrer" aria-label="Source code on GitHub">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
          <path fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
        </svg>
      </a>
      <button type="button" class="control-btn control-icon-btn" aria-label="Settings" onclick={openSettingsPanel}>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
          <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/>
          <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.475l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z"/>
        </svg>
      </button>
      </div>
    </div>
  </div>
{/snippet}

{#snippet aboutPanel()}
  {#if aboutPanelVisible}
    <div class="about-backdrop" role="presentation" onclick={() => { aboutPanelVisible = false }}></div>
    <div class="about-panel" role="dialog" aria-modal="true" aria-label="About Agda Scratchpad">
      <div class="about-header">
        <h2 class="about-title">Agda Scratchpad</h2>
        <button type="button" class="about-close" aria-label="Close" onclick={() => { aboutPanelVisible = false }}>✕</button>
      </div>
      <p class="about-desc">A browser-hosted single-file Agda scratchpad for demonstrations, learning, and practice.</p>
      <dl class="about-meta">
        <div class="about-meta-row"><dt>Agda</dt><dd>v2.8.0</dd></div>
        <div class="about-meta-row"><dt>standard-library</dt><dd>v2.3</dd></div>
        <div class="about-meta-row"><dt>Cubical</dt><dd>v0.9</dd></div>
        <div class="about-meta-row"><dt>Commit</dt><dd><code>{APP_COMMIT_ID}</code></dd></div>
      </dl>
      <a class="about-github" href="https://github.com/agda-web/als-demo" target="_blank" rel="noopener noreferrer">
        Source code on GitHub ↗
      </a>
    </div>
  {/if}
{/snippet}

{#snippet settingsPanel()}
  {#if settingsPanelVisible}
    <div class="settings-backdrop" role="presentation" onclick={closeSettingsPanel}></div>
    <div
      class="settings-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-panel-title">
      <header class="settings-panel-header">
        <div>
          <h2 id="settings-panel-title">Scratchpad Settings</h2>
          <p>Configure the browser IDE experience. These settings apply to the whole page.</p>
        </div>
        <button type="button" class="settings-close-button" aria-label="Close settings" onclick={closeSettingsPanel}>Close</button>
      </header>

      <div class="settings-panel-main">
        <div class="settings-segmented-control" role="tablist" aria-label="Settings sections">
          {#each settingsSegments as segment}
            <button
              type="button"
              class:active={selectedSettingsSegment === segment.id}
              role="tab"
              aria-selected={selectedSettingsSegment === segment.id}
              aria-controls={`settings-panel-${segment.id}`}
              onclick={() => { selectedSettingsSegment = segment.id }}>
              {segment.label}
            </button>
          {/each}
        </div>

        <div class="settings-panel-body">
          {#if selectedSettingsSegment === 'general'}
            <div id="settings-panel-general" class="settings-section settings-overview" role="tabpanel" aria-labelledby="general-settings-title">
              <h3 id="general-settings-title">General</h3>
              <p class="settings-note">Global scratchpad behavior for demos and practice sessions.</p>
              <div class="settings-option-grid">
                <div class="settings-option">
                  <strong>Source buffer</strong>
                  <span>Single-file `/source.agda` scratchpad</span>
                </div>
                <div class="settings-option">
                  <strong>Persistence</strong>
                  <span>Editor contents are saved in this browser</span>
                </div>
                <label class="settings-toggle-row">
                  <input type="checkbox" checked disabled />
                  <span>Restore last source on reload</span>
                </label>
              </div>
            </div>
          {:else if selectedSettingsSegment === 'editor'}
            <div id="settings-panel-editor" class="settings-section" role="tabpanel" aria-labelledby="editor-settings-title">
              <h3 id="editor-settings-title">Editor</h3>
              <p class="settings-note">Display and input options for the CodeMirror editor.</p>
              <div class="settings-option-grid">
                <label class="settings-field">
                  <span>Font</span>
                  <select disabled>
                    <option>JuliaMono</option>
                  </select>
                </label>
                <label class="settings-field">
                  <span>Theme</span>
                  <select disabled>
                    <option>Follow browser preference</option>
                  </select>
                </label>
                <label class="settings-toggle-row">
                  <input type="checkbox" disabled />
                  <span>Agda Unicode input method</span>
                </label>
              </div>
            </div>
          {:else if selectedSettingsSegment === 'runtime'}
            <div id="settings-panel-runtime" class="settings-section" role="tabpanel" aria-labelledby="runtime-settings-title">
              <h3 id="runtime-settings-title">Runtime and libraries</h3>
              <p class="settings-note">Read-only runtime assets used by the hosted Agda environment.</p>
              <dl class="settings-runtime-list">
                {#each runtimeSummary() as item}
                  <div>
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>
                {/each}
              </dl>
            </div>
          {:else if selectedSettingsSegment === 'commands'}
            <div id="settings-panel-commands" class="settings-section" role="tabpanel" aria-labelledby="command-settings-title">
              <h3 id="command-settings-title">Commands and shortcuts</h3>
              <p class="settings-note">Replace Agda chord shortcuts with values like <code>Ctrl-c Ctrl-g</code> or <code>Ctrl-c Space</code>. CodeMirror keymap fallbacks such as Cmd-Enter remain available.</p>
              <div class="shortcut-settings-actions">
                <button type="button" class="settings-action-button primary" disabled={!shortcutDraftValidation.valid} onclick={saveShortcutOverrides}>Save shortcuts</button>
                <button type="button" class="settings-action-button" onclick={resetShortcutOverrides}>Reset to defaults</button>
              </div>
              {#if shortcutOverrideMessage || !shortcutDraftValidation.valid}
                <p class:settings-error={!shortcutDraftValidation.valid} class="settings-message">
                  {shortcutDraftValidation.valid ? shortcutOverrideMessage : shortcutDraftValidation.errors.join(' ')}
                </p>
              {/if}
              <div class="shortcut-settings-list">
                {#each agdaShortcutRegistry as shortcut}
                  {@const activeShortcut = activeAgdaShortcutRegistry.find(active => active.id === shortcut.id) ?? shortcut}
                  <div class="shortcut-settings-row">
                    <div>
                      <strong>{shortcut.label}</strong>
                      <span>{shortcut.id}</span>
                      <span>Default: {formatAgdaShortcutHelpBinding(shortcut)}</span>
                      <span>Effective: {formatAgdaShortcutHelpBinding(activeShortcut)}</span>
                    </div>
                    <label>
                      <span>Override</span>
                      <input
                        type="text"
                        placeholder="Default"
                        value={shortcutDrafts[shortcut.id] ?? ''}
                        oninput={event => setShortcutDraft(shortcut.id, event.currentTarget.value)} />
                    </label>
                    <button type="button" class="settings-action-button compact" onclick={() => clearShortcutDraft(shortcut.id)}>Clear</button>
                  </div>
                {/each}
              </div>
            </div>
          {:else}
            <div id="settings-panel-planned" class="settings-section" role="tabpanel" aria-labelledby="future-settings-title">
              <h3 id="future-settings-title">Planned settings</h3>
              <p class="settings-note">Future normalization defaults, output verbosity, layout density, and command behavior settings can be added here without changing the main page layout.</p>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
{/snippet}



{#snippet headerExamplePicker()}
  <div class="header-examples-wrap">
    <button
      type="button"
      class="header-examples-btn"
      aria-expanded={examplesMenuOpen}
      onclick={() => { examplesMenuOpen = !examplesMenuOpen }}>
      Examples
      <span class="header-examples-arrow" class:open={examplesMenuOpen}>▾</span>
    </button>
    {#if examplesMenuOpen}
      <div class="header-examples-menu" role="menu">
        {#each scratchpadExamples as example}
          <button
            type="button"
            class="header-examples-item"
            class:active={example.id === selectedExampleId}
            role="menuitem"
            title={example.description}
            onclick={() => { selectScratchpadExample(example.id); examplesMenuOpen = false }}>
            {example.label}
          </button>
        {/each}
      </div>
      <div class="header-menu-backdrop" role="presentation" onclick={() => { examplesMenuOpen = false }}></div>
    {/if}
  </div>
{/snippet}

<input
  bind:this={fileInput}
  type="file"
  accept=".agda,.lagda,.lagda.md"
  class="sr-only"
  onchange={openAgdaFile}>

<div
  bind:clientWidth={width} style="height: 100%; background: var(--quiet-neutral-fill-softer)">
  {@render editor(isMobile ? 'vertical' : 'horizontal')}
</div>

<style>
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px;
  background: var(--quiet-neutral-fill-softer);
  border-bottom: 1px solid var(--quiet-neutral-stroke-softer);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.header-title {
  color: #1f2937;
  letter-spacing: 1px;
  font-size: 1rem;
  font-family: monospace;
  white-space: nowrap;
}

.header-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
}

.header-action-btn {
  padding: 4px 10px;
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 4px;
  background: var(--quiet-neutral-fill);
  color: #374151;
  font: inherit;
  font-size: .82rem;
  cursor: pointer;
}

.header-action-btn:hover {
  border-color: var(--quiet-primary-stroke-soft);
  background: color-mix(in srgb, var(--quiet-primary-fill-soft) 18%, var(--quiet-neutral-fill));
  color: var(--quiet-primary-text, #3b3aab);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0,0,0,0);
  white-space: nowrap;
}

.header-examples-wrap {
  position: relative;
  flex: 0 0 auto;
}

.header-examples-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 4px;
  background: var(--quiet-neutral-fill);
  color: #374151;
  font: inherit;
  font-size: .82rem;
  font-weight: 600;
  cursor: pointer;
}

.header-examples-btn:hover {
  border-color: var(--quiet-primary-stroke-soft);
  background: color-mix(in srgb, var(--quiet-primary-fill-soft) 18%, var(--quiet-neutral-fill));
  color: var(--quiet-primary-text, #3b3aab);
}

.header-examples-arrow {
  font-size: .7rem;
  transition: transform 0.15s;
  display: inline-block;
}

.header-examples-arrow.open {
  transform: rotate(180deg);
}

.header-examples-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 200;
  min-width: 200px;
  background: var(--quiet-neutral-fill-softer);
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,.1);
  overflow: hidden;
}

.header-examples-item {
  display: block;
  width: 100%;
  padding: 8px 14px;
  text-align: left;
  font: inherit;
  font-size: .85rem;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
}

.header-examples-item:hover {
  background: color-mix(in srgb, var(--quiet-primary-fill-soft) 12%, transparent);
}

.header-examples-item.active {
  font-weight: 600;
  color: var(--quiet-primary-text);
}

.editor-wrap {
  position: relative;
  flex: 1 1;
  min-height: 0;
}

.container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: row;
  min-height: 0;
}

.chord-hint {
  position: absolute;
  bottom: 10px;
  right: 14px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--color-text, #111);
  background: color-mix(in srgb, var(--quiet-neutral-fill-softer, #e8e8e8) 90%, transparent);
  border: 1px solid color-mix(in srgb, var(--quiet-neutral-border, #bbb) 70%, transparent);
  border-radius: 4px;
  padding: 2px 7px;
  pointer-events: none;
  user-select: none;
  letter-spacing: 0.04em;
}

:global(.split-pane) {
  --divider-width: 1px;
  --divider-draggable-area: 13px;
}

.control-card {
  margin: 12px;
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 6px;
  background: var(--quiet-neutral-fill);
  overflow: hidden;
}

.control-card-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
}

.control-card-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.control-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 4px;
  background: transparent;
  color: #374151;
  font: inherit;
  font-size: .82rem;
  cursor: pointer;
  text-decoration: none;
}

.control-btn:hover {
  background: color-mix(in srgb, var(--quiet-primary-fill-soft) 18%, transparent);
  border-color: var(--quiet-primary-stroke-soft);
  color: var(--quiet-primary-text, #3b3aab);
}

.control-icon-btn {
  padding: 8px 10px;
  line-height: 0;
  border: none;
  color: #374151;
}

.control-icon-btn svg {
  width: 18px;
  height: 18px;
}

.control-icon-btn:hover {
  border: none;
  background: color-mix(in srgb, var(--quiet-primary-fill-soft) 22%, transparent);
  color: var(--quiet-primary-text, #3b3aab);
}

.about-backdrop {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(0,0,0,.3);
}

.about-panel {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 301;
  width: 340px;
  background: var(--quiet-neutral-fill);
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,.15);
  padding: 20px;
}

.about-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.about-title {
  font-size: 1rem;
  font-family: monospace;
  letter-spacing: .04em;
  margin: 0;
}

.about-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: .9rem;
  color: #888;
  padding: 2px 6px;
}

.about-close:hover { color: inherit; }

.about-desc {
  font-size: .85rem;
  color: #666;
  margin: 0 0 14px;
  line-height: 1.5;
}

.about-meta {
  margin: 0 0 14px;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  font-size: .8rem;
}

.about-meta-row { display: contents; }

.about-meta dt { color: #999; }

.about-meta code {
  font-size: .75rem;
  background: var(--quiet-neutral-fill-softer);
  padding: 1px 4px;
  border-radius: 3px;
}

.about-github {
  display: inline-block;
  font-size: .82rem;
  color: var(--quiet-primary-text, #3b82f6);
}



.als-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dot-color);
  flex-shrink: 0;
}

.als-status-label {
  font-size: .78rem;
  font-weight: 500;
}


.btn {
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 4px;
  background: var(--quiet-neutral-fill-softer);
  color: #374151;
  cursor: pointer;
  font: inherit;
  padding: 5px 12px;
  font-size: .82rem;
}
.btn:hover:not(:disabled),
.btn:focus-visible:not(:disabled) {
  border-color: var(--quiet-primary-stroke-soft);
  outline: none;
  background: color-mix(in srgb, var(--quiet-primary-fill-soft) 18%, var(--quiet-neutral-fill-softer));
  color: var(--quiet-primary-text, #3b3aab);
}
.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--quiet-primary-fill-soft);
  border-color: var(--quiet-primary-stroke-soft);
  color: var(--quiet-primary-text, #3b3aab);
}
.btn-primary:hover:not(:disabled),
.btn-primary:focus-visible:not(:disabled) {
  background: color-mix(in srgb, var(--quiet-primary-fill-soft) 85%, var(--quiet-neutral-fill));
  border-color: var(--quiet-primary-stroke);
}


.container > :global(*) {
  flex: 1 1;
}

.container :global(.cm-editor) {
  background: var(--quiet-neutral-fill);
}

.editor-section {
  display: flex;
  flex-direction: column;
  height: calc(100% - 1px);
  position: relative;
  background: var(--quiet-neutral-fill);
}
.editor-section::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  width: 8px;
  height: 100%;
  background: linear-gradient(to left, rgba(0, 0, 0, 0.09), transparent);
  pointer-events: none;
  z-index: 10;
}

:global(.editor-goals-splitter) {
  flex: 1 1;
  min-height: 0;
}

.editor-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
}

.editor-pane::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 7px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.07), transparent);
  pointer-events: none;
  z-index: 10;
}

.goals-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: color-mix(in srgb, var(--quiet-neutral-fill-softer) 45%, transparent);
}

.panel-header {
  padding: 6px 8px;
  background: var(--quiet-neutral-fill-softer);
  border-bottom: 1px solid var(--quiet-neutral-stroke-softer);
  color: #777;
  font-family: monospace;
  font-size: .75rem;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.output-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  margin-top: -1px;
}

.command-input-panel {
  border-bottom: 1px solid var(--quiet-neutral-stroke-softer);
  padding: 8px;
  background: color-mix(in srgb, var(--quiet-primary-fill-soft) 18%, var(--quiet-neutral-fill-softer));
}

.command-input-panel label {
  display: block;
  margin-bottom: 6px;
  color: #666;
  font-size: .8rem;
  font-weight: 700;
}

.command-input-row {
  display: flex;
  gap: 6px;
}

.command-input-row input {
  min-width: 0;
  flex: 1 1;
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 4px;
  padding: 4px 6px;
  background: var(--quiet-neutral-fill-softer);
  color: inherit;
  font-family: JuliaMono, monospace;
}

.command-input-row button {
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 4px;
  padding: 4px 8px;
  background: var(--quiet-neutral-fill-softer);
  color: inherit;
  cursor: pointer;
}

.command-input-row button:hover,
.command-input-row button:focus-visible {
  border-color: var(--quiet-primary-stroke-soft);
  outline: none;
}

.command-input-error {
  margin-top: 6px;
  color: var(--quiet-destructive-text, #a33);
  font-size: .8rem;
}

.goals-list {
  flex: 1 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}

.goals-empty {
  color: #777;
  font-size: .8rem;
  padding: 4px 0;
}

.goal-entry {
  display: block;
  width: 100%;
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 3px 8px;
  cursor: pointer;
  color: inherit;
  font-family: JuliaMono, monospace;
  font-size: 12px;
  text-align: start;
}

.goal-entry:hover,
.goal-entry:focus-visible {
  background: color-mix(in srgb, var(--quiet-primary-fill-soft) 18%, var(--quiet-neutral-fill-softer));
  outline: none;
}

.goal-entry.active {
  background: color-mix(in srgb, var(--quiet-primary-fill-soft) 28%, var(--quiet-neutral-fill-softer));
  box-shadow: inset 2px 0 0 var(--quiet-primary-stroke);
}

.goal-head {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.5;
}

.goal-type-muted {
  color: #999;
}

.goal-separator {
  border-top: 1px solid var(--quiet-neutral-stroke-softer);
  margin: 4px 0;
}

.goal-context {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--quiet-muted-text, #555);
}

.goal-context-empty {
  color: #777;
  font-size: .8rem;
}

.info-section {
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
}

.output-section {
  min-height: 0;
}

:global(.right-column-splitter .split-end) {
  margin: 0 12px 12px 12px;
  border-radius: 10px;
  border: 1px solid #d0d2d8;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.05);
  overflow: hidden;
  background: var(--quiet-neutral-fill);
}

.messages-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: var(--quiet-neutral-fill);
}

.messages-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 8px;
  background: var(--quiet-neutral-fill-softer);
  border-bottom: 1px solid var(--quiet-neutral-stroke-softer);
}

.messages-header-info {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.messages-header strong {
  font-size: .9rem;
  font-weight: 500;
  letter-spacing: .02em;
  text-transform: uppercase;
}

.messages-header span {
  color: #666;
  font-size: .72rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.messages-tab-group {
  display: flex;
  gap: 1px;
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 5px;
  background: var(--quiet-neutral-stroke-softer);
  overflow: hidden;
  flex-shrink: 0;
}

.messages-tab {
  border: none;
  background: var(--quiet-neutral-fill-softer);
  color: #374151;
  font: inherit;
  font-size: .72rem;
  padding: 3px 9px;
  cursor: pointer;
  white-space: nowrap;
}

.messages-tab.active {
  background: var(--quiet-primary-fill-soft);
  color: var(--quiet-primary-text, #3b3aab);
  font-weight: 500;
}

.messages-tab:hover:not(.active) {
  background: color-mix(in srgb, var(--quiet-neutral-stroke-softer) 60%, var(--quiet-neutral-fill-softer));
}

.messages-body {
  display: flex;
  flex: 1 1;
  min-height: 0;
  padding: 8px;
}

.queries-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 0;
  overflow: auto;
  gap: 0;
}

.queries-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  color: #374151;
  font-size: .78rem;
  font-weight: 700;
  letter-spacing: .02em;
  text-transform: uppercase;
}

.queries-clear-btn {
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 4px;
  padding: 1px 7px;
  background: transparent;
  color: #777;
  font-size: .75rem;
  cursor: pointer;
}

.queries-clear-btn:hover {
  border-color: var(--quiet-primary-stroke-soft);
  color: inherit;
}

.queries-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.queries-empty {
  color: #777;
  font-size: .8rem;
}

.query-result {
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 4px;
  background: var(--quiet-neutral-fill-softer);
  overflow: hidden;
}

.query-result-label {
  padding: 3px 8px;
  background: color-mix(in srgb, var(--quiet-neutral-fill-softer) 60%, transparent);
  border-bottom: 1px solid var(--quiet-neutral-stroke-softer);
  color: #666;
  font-size: .75rem;
  font-weight: 700;
  letter-spacing: .02em;
  text-transform: uppercase;
}

.query-result-content {
  margin: 0;
  padding: 6px 8px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: JuliaMono, monospace;
  font-size: 12px;
}

.diagnostics-panel {
  display: grid;
  gap: 8px;
  width: 100%;
  min-height: 0;
  overflow: auto;
}

.diagnostics-panel-title {
  color: #374151;
  font-size: .78rem;
  font-weight: 700;
  letter-spacing: .02em;
  text-transform: uppercase;
}

.diagnostics-list {
  display: grid;
  gap: 8px;
}

.diagnostics-empty {
  color: #777;
  font-size: .8rem;
}

.diagnostic-card {
  display: grid;
  gap: 6px;
  width: 100%;
  padding: 8px;
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-left-width: 4px;
  border-radius: 6px;
  background: var(--quiet-neutral-fill-softer);
  color: inherit;
  text-align: left;
  appearance: none;
  font: inherit;
}

.diagnostic-card.error {
  border-left-color: #c2410c;
}

.diagnostic-card.warning {
  border-left-color: #ca8a04;
}

.diagnostic-card.clickable {
  cursor: pointer;
}

.diagnostic-card.clickable:hover,
.diagnostic-card.clickable:focus-visible {
  border-color: #777;
  border-left-color: currentColor;
  background: var(--quiet-neutral-fill);
  outline: none;
}

.diagnostic-card:disabled {
  opacity: 1;
}

.diagnostic-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: .76rem;
  text-transform: capitalize;
}

.diagnostic-meta code {
  color: #666;
  font-family: JuliaMono, monospace;
  font-size: .72rem;
  text-transform: none;
}

.diagnostic-location {
  color: #444;
  font-family: JuliaMono, monospace;
  font-size: .76rem;
}

.diagnostic-card pre {
  margin: 0;
  color: #374151;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: JuliaMono, monospace;
  font-size: .72rem;
}

.messages-log {
  flex: 1 1;
  min-height: 0;
  width: 100%;
  overflow: auto;
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 6px;
  background: color-mix(in srgb, var(--quiet-neutral-fill-softer) 78%, white);
}

.messages-log-entry {
  margin: 0;
  padding: 7px 8px;
  color: #444;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: JuliaMono, monospace;
  font-size: 11px;
  line-height: 1.45;
}

.messages-log-entry + .messages-log-entry {
  border-top: 1px solid var(--quiet-neutral-stroke-softer);
}

.messages-log-empty {
  padding: 8px;
  color: #777;
  font-size: .8rem;
}


.settings-close-button {
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 4px;
  background: var(--quiet-neutral-fill-softer);
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 6px 10px;
}

.settings-close-button:hover,
.settings-close-button:focus-visible {
  border-color: var(--quiet-primary-stroke-soft);
  outline: none;
  background: color-mix(in srgb, var(--quiet-primary-fill-soft) 18%, var(--quiet-neutral-fill-softer));
}

.settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgb(0 0 0 / .2);
}

.settings-panel {
  position: fixed;
  z-index: 41;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  width: min(920px, calc(100vw - 24px));
  height: min(680px, calc(100vh - 48px));
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 10px;
  background: var(--quiet-neutral-fill, #fff);
  box-shadow: 0 18px 60px rgb(0 0 0 / .25);
  overflow: hidden;
}

.settings-panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border-bottom: 1px solid var(--quiet-neutral-stroke-softer);
}

.settings-panel-header h2,
.settings-section h3 {
  margin: 0;
}

.settings-panel-header p {
  margin: 4px 0 0;
  color: #666;
  font-size: .82rem;
}

.settings-panel-main {
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr);
  min-height: 0;
  flex: 1 1;
}

.settings-segmented-control {
  display: grid;
  align-content: start;
  gap: 4px;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  border-right: 1px solid var(--quiet-neutral-stroke-softer);
  background: color-mix(in srgb, var(--quiet-neutral-fill-softer) 84%, transparent);
}

.settings-segmented-control button {
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: #666;
  cursor: pointer;
  font: inherit;
  font-size: .78rem;
  padding: 8px 10px;
  text-align: start;
}

.settings-segmented-control button:hover,
.settings-segmented-control button:focus-visible {
  border-color: var(--quiet-primary-stroke-soft);
  outline: none;
}

.settings-segmented-control button.active {
  border-color: var(--quiet-primary-stroke-soft);
  background: var(--quiet-primary-fill-soft);
  color: inherit;
  font-weight: 700;
}

.settings-panel-body {
  display: grid;
  gap: 14px;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
}

@media (max-width: 620px) {
  .settings-panel {
    height: min(620px, calc(100vh - 24px));
  }

  .settings-panel-main {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .settings-segmented-control {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    max-height: 140px;
    border-right: 0;
    border-bottom: 1px solid var(--quiet-neutral-stroke-softer);
  }
}

.settings-section {
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 8px;
  padding: 12px;
  background: color-mix(in srgb, var(--quiet-neutral-fill-softer) 72%, transparent);
}

.settings-overview {
  background: color-mix(in srgb, var(--quiet-primary-fill-soft) 12%, var(--quiet-neutral-fill-softer));
}

.settings-note {
  margin: 6px 0 12px;
  color: #666;
  font-size: .8rem;
}

.settings-option-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}

.settings-option,
.settings-toggle-row,
.settings-field {
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 6px;
  background: var(--quiet-neutral-fill-softer);
  padding: 8px;
}

.settings-option,
.settings-field {
  display: grid;
  gap: 4px;
}

.settings-option span,
.settings-field span,
.settings-toggle-row span {
  color: #666;
  font-size: .78rem;
}

.settings-toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.settings-field select {
  min-width: 0;
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 4px;
  padding: 4px 6px;
  background: color-mix(in srgb, var(--quiet-neutral-fill-softer) 70%, white);
  color: inherit;
}

.settings-runtime-list {
  display: grid;
  gap: 6px;
  margin: 0;
}

.settings-runtime-list div {
  display: grid;
  grid-template-columns: minmax(12ch, max-content) 1fr;
  gap: 10px;
  padding: 7px 8px;
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 6px;
  background: var(--quiet-neutral-fill-softer);
}

.settings-runtime-list dt {
  color: #666;
  font-size: .78rem;
}

.settings-runtime-list dd {
  margin: 0;
  font-family: JuliaMono, monospace;
  font-size: .78rem;
}

.shortcut-settings-list {
  display: grid;
  gap: 6px;
}

.shortcut-settings-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(160px, 220px) max-content;
  align-items: end;
  gap: 12px;
  padding: 8px;
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 6px;
  background: var(--quiet-neutral-fill-softer);
}

.shortcut-settings-row div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.shortcut-settings-row span {
  color: #777;
  font-size: .72rem;
}

.shortcut-settings-row label {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.shortcut-settings-row input {
  min-width: 0;
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 4px;
  padding: 5px 7px;
  background: color-mix(in srgb, var(--quiet-neutral-fill-softer) 70%, white);
  color: inherit;
  font: inherit;
  font-family: JuliaMono, monospace;
  font-size: .78rem;
}

.shortcut-settings-row input:focus {
  border-color: var(--quiet-primary-stroke-soft);
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--quiet-primary-fill-soft) 45%, transparent);
}

.settings-action-button {
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 4px;
  background: var(--quiet-neutral-fill-softer);
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 6px 8px;
}

.settings-action-button.primary {
  border-color: var(--quiet-primary-stroke-soft);
  background: color-mix(in srgb, var(--quiet-primary-fill-soft) 42%, var(--quiet-neutral-fill-softer));
}

.settings-action-button.compact {
  padding: 5px 7px;
}

.settings-action-button:disabled {
  cursor: not-allowed;
  opacity: .55;
}

.settings-action-button:hover:not(:disabled),
.settings-action-button:focus-visible:not(:disabled) {
  border-color: var(--quiet-primary-stroke-soft);
  outline: none;
  background: color-mix(in srgb, var(--quiet-primary-fill-soft) 22%, var(--quiet-neutral-fill-softer));
}

.shortcut-settings-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.settings-message {
  margin: 0 0 10px;
  color: #4f5b36;
  font-size: .78rem;
}

.settings-message.settings-error {
  color: #9a3412;
}

.settings-note code {
  color: #374151;
  font-family: JuliaMono, monospace;
  font-size: .78em;
}

.commands-panel-shell {
  flex-shrink: 0;
}

.commands-panel-toggle,
.command-button {
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
}

.commands-panel-toggle {
  border: none;
  border-bottom: 1px solid var(--quiet-neutral-stroke-softer);
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  text-align: start;
  font-size: .82rem;
  background: var(--quiet-neutral-fill-softer);
}

.commands-panel-arrow {
  display: inline-block;
  font-size: .6rem;
  transition: transform 0.15s;
}

.commands-panel-arrow.open {
  transform: rotate(90deg);
}

.commands-panel-toggle:hover,
.commands-panel-toggle:focus-visible,
.command-button:hover,
.command-button:focus-visible {
  outline: none;
  background: color-mix(in srgb, var(--quiet-primary-fill-soft) 18%, transparent);
}

.commands-panel {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-height: 200px;
  overflow-y: auto;
  padding: 6px 8px;
  background: var(--quiet-neutral-fill-softer);
  border-top: 1px solid var(--quiet-neutral-stroke-softer);
}

.command-button {
  padding: 3px 8px;
  text-align: center;
  font-family: JuliaMono, monospace;
  font-size: .82rem;
  background: var(--quiet-neutral-fill-softer);
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 3px;
}


</style>
