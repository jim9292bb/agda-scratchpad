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
async function requestActiveGoalDetails(goalId, documentVersion) {
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

let agdaChordTimer = /** @type {ReturnType<typeof setTimeout> | undefined} */(undefined)
let waitingForAgdaChord = false
let agdaChordSubPrefix = /** @type {string | undefined} */(undefined)

function clearAgdaChord() {
  waitingForAgdaChord = false
  agdaChordSubPrefix = undefined
  if (agdaChordTimer) {
    clearTimeout(agdaChordTimer)
    agdaChordTimer = undefined
  }
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

  if (isAgdaCtrlKey(event, 'c') && !waitingForAgdaChord) {
    event.preventDefault()
    event.stopPropagation()
    waitingForAgdaChord = true
    agdaChordTimer = setTimeout(clearAgdaChord, 1500)
    return true
  }

  if (!waitingForAgdaChord) return false

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
let selectedMessageTab = $state(/** @type {'log' | 'errors'} */('log'))
let commandsPanelVisible = $state(false)
let editorGoalsSplit = $state(0.78)
let editorGoalsContainerHeight = $state(0)
let commandsPanelContentHeight = $state(0)
$effect(() => {
  const cmdH = commandsPanelVisible ? commandsPanelContentHeight : 0
  const totalH = editorGoalsContainerHeight
  if (totalH === 0) return
  editorGoalsSplit = Math.max(0.35, Math.min(0.92, (totalH * 0.78 - cmdH) / totalH))
})
let settingsPanelVisible = $state(false)
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
</script>

{#snippet editor(/** @type {'horizontal' | 'vertical'} */ orientation)}
<SplitPane {orientation} position={.6} style="--divider-min-position: 25%; --divider-max-position: 90%;">
  {#snippet start()}
  <section class="editor-section">
    <header class="header">
      <div class="header-brand">
        <span class="header-title">Agda Scratchpad IDE</span> <a target="_blank" href={APP_REPO_URL} class="header-subtitle">{APP_COMMIT_ID}</a>
      </div>
      {@render headerExamplePicker()}
    </header>
    <div bind:clientHeight={editorGoalsContainerHeight} style="height:100%">
    <SplitPane class="editor-goals-splitter" orientation="vertical" bind:ratio={editorGoalsSplit} style="--divider-min-position: 35%; --divider-max-position: 92%;">
      {#snippet start()}
      <section class="editor-pane">
        <div class="container" {@attach codeMirror}></div>
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
            onclick={() => { commandsPanelVisible = !commandsPanelVisible }}>
            <span class="commands-panel-arrow" class:open={commandsPanelVisible}>▶</span>
            Commands
          </button>
          {#if commandsPanelVisible}
            <div id="commands-panel" class="commands-panel" aria-label="Agda commands" bind:clientHeight={commandsPanelContentHeight}>
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
                class="goal-card"
                aria-label={`Focus goal ${goal.id}`}
                onclick={() => focusGoal(goal.id)}>
                <div class="goal-meta">
                  <strong>Goal {goal.id}</strong>
                  {#if goal.range}
                    <span>{goal.range}</span>
                  {/if}
                </div>
                {#if goal.id === activeGoalId}
                  <div class="goal-detail">
                    <div class="goal-detail-label">Type</div>
                    {#if goal.type}
                      <pre>{goal.type}</pre>
                    {:else if activeGoalDetailStatus === 'loading'}
                      <div class="goal-type-empty">Loading goal details...</div>
                    {:else}
                      <div class="goal-type-empty">Type information is not available yet.</div>
                    {/if}

                    <div class="goal-detail-label">Context</div>
                    {#if goal.context}
                      <pre>{goal.context}</pre>
                    {:else if activeGoalDetailStatus === 'loading'}
                      <div class="goal-type-empty">Loading context...</div>
                    {:else if activeGoalDetailStatus === 'error'}
                      <div class="goal-type-empty">{activeGoalDetailError}</div>
                    {:else}
                      <div class="goal-type-empty">No context entries.</div>
                    {/if}
                  </div>
                {:else if goal.type}
                  <pre>{goal.type}</pre>
                {:else}
                  <div class="goal-type-empty">Type information is not available yet.</div>
                {/if}
              </button>
            {/each}
          {/if}
        </div>
      </section>
      {/snippet}
    </SplitPane>
    </div>
  </section>
  {/snippet}
  {#snippet end()}
  <section>
    <SplitPane orientation="vertical" position={.75}>
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
{/snippet}

{#snippet messagesPanel()}
  <section class="messages-panel" data-log-content={textboxContent} aria-label="Messages">
    <header class="messages-header">
      <div>
        <strong>Messages</strong>
        <span>{selectedMessageTab === 'log' ? 'Agda interaction log' : `${agdaDiagnostics.length} diagnostics`}</span>
      </div>
      <label class="messages-view-select">
        <span>View</span>
        <select bind:value={selectedMessageTab} aria-label="Message view">
          <option value="log">Log</option>
          <option value="errors">Errors {agdaDiagnostics.length ? `(${agdaDiagnostics.length})` : ''}</option>
        </select>
      </label>
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
      {:else}
        {@render diagnosticsPanel()}
      {/if}
    </div>
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
    loaded:       { color: '#f59e0b', label: 'Starting...' },
    active:       { color: '#22c55e', label: 'Active' },
    deactivating: { color: '#888',    label: 'Stopping...' },
    errored:      { color: '#ef4444', label: 'Error' },
    exited:       { color: '#888',    label: 'Exited' },
    terminated:   { color: '#888',    label: 'Terminated' },
  }[agdaController.alsWorkerStatus] ?? { color: '#888', label: agdaController.alsWorkerStatus }}
  <div class="als-buttons">
    <div class="als-toolbar-left">
      <span class="als-status-dot" style="--dot-color: {statusMeta.color}"></span>
      <span class="als-status-label">{statusMeta.label}</span>
      <button type="button" class="btn" onclick={() => agdaController.restartALSWASM()} disabled={agdaController.alsWorkerStatus !== 'active'}>Restart</button>
    </div>
    <button type="button" class="settings-button" onclick={openSettingsPanel}>Settings</button>
  </div>


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
  <label class="header-example-picker" for="scratchpad-example">
    <span>Example</span>
    <select
      id="scratchpad-example"
      value={selectedExampleId}
      title={selectedScratchpadExample?.description ?? 'Select an Agda example'}
      onchange={(event) => selectScratchpadExample(event.currentTarget.value)}>
      {#each scratchpadExamples as example}
        <option value={example.id}>{example.label}</option>
      {/each}
    </select>
  </label>
{/snippet}

<div
  bind:clientWidth={width} style="height: 100%">
  {@render editor(isMobile ? 'vertical' : 'horizontal')}
</div>

<style>
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px;
  border-bottom: 1px solid var(--quiet-neutral-stroke-softer);
}

.header-brand {
  min-width: 0;
}

.header-title {
  color: #999;
  letter-spacing: 1px;
  font-size: 1rem;
  font-family: monospace;
}

.header-subtitle {
  margin-inline-start: 1em;
  font-size: .75rem;
}

.header-example-picker {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  color: #666;
  font-size: .8rem;
  font-weight: 700;
}

.header-example-picker select {
  min-width: 220px;
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 4px;
  padding: 4px 6px;
  background: var(--quiet-neutral-fill-softer);
  color: inherit;
}

.header-example-picker select:focus-visible {
  border-color: var(--quiet-primary-stroke-soft);
  outline: none;
}

.container {
  flex: 1 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
  padding-right: 4px;
}

:global(.split-pane) {
  --divider-width: 1px;
  --divider-draggable-area: 13px;
}

.als-buttons {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px;
  border-bottom: 1px solid var(--quiet-neutral-stroke-softer);
}

.als-toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
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
  color: #666;
}


.btn {
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 4px;
  background: var(--quiet-neutral-fill-softer);
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 5px 12px;
  font-size: 0.875rem;
}
.btn:hover:not(:disabled),
.btn:focus-visible:not(:disabled) {
  border-color: var(--quiet-primary-stroke-soft);
  outline: none;
  background: color-mix(in srgb, var(--quiet-primary-fill-soft) 18%, var(--quiet-neutral-fill-softer));
}
.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}


.container > :global(*) {
  flex: 1 1;
}

.editor-section {
  display: flex;
  flex-direction: column;
  height: calc(100% - 1px);
}

:global(.editor-goals-splitter) {
  flex: 1 1;
  min-height: 0;
}

.editor-pane {
  display: flex;
  min-height: 0;
}

.goals-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: color-mix(in srgb, var(--quiet-neutral-fill-softer) 45%, transparent);
}

.panel-header {
  padding: 6px 8px;
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

.goals-empty,
.goal-type-empty {
  color: #777;
  font-size: .8rem;
}

.goal-card {
  display: block;
  width: 100%;
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 4px;
  background: var(--quiet-neutral-fill-softer);
  padding: 8px;
  cursor: pointer;
  color: inherit;
  font: inherit;
  text-align: start;
}

.goal-card:hover,
.goal-card:focus-visible {
  border-color: var(--quiet-primary-stroke-soft);
  outline: none;
  background: color-mix(in srgb, var(--quiet-primary-fill-soft) 18%, var(--quiet-neutral-fill-softer));
}

.goal-card.active {
  border-color: var(--quiet-primary-stroke);
  background: color-mix(in srgb, var(--quiet-primary-fill-soft) 32%, var(--quiet-neutral-fill-softer));
  box-shadow: inset 3px 0 0 var(--quiet-primary-stroke);
}

.goal-detail {
  margin-top: .5em;
}

.goal-detail-label {
  margin-top: .75em;
  font-size: .75rem;
  font-weight: 700;
  letter-spacing: .03em;
  text-transform: uppercase;
  color: #777;
}

.goal-card + .goal-card {
  margin-top: 8px;
}

.goal-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  color: #666;
  font-size: .75rem;
}

.goal-card pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: JuliaMono, monospace;
  font-size: 12px;
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

.messages-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  border-top: 1px solid var(--quiet-neutral-stroke-softer);
  background: color-mix(in srgb, var(--quiet-neutral-fill-softer) 82%, transparent);
}

.messages-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 8px;
  border-bottom: 1px solid var(--quiet-neutral-stroke-softer);
}

.messages-header div {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.messages-header strong {
  font-size: .8rem;
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

.messages-view-select {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #666;
  font-size: .72rem;
}

.messages-view-select select {
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 4px;
  background: var(--quiet-neutral-fill-softer);
  color: inherit;
  font: inherit;
  padding: 4px 24px 4px 7px;
}

.messages-view-select select:hover,
.messages-view-select select:focus-visible {
  border-color: var(--quiet-primary-stroke-soft);
  outline: none;
}

.messages-body {
  display: flex;
  flex: 1 1;
  min-height: 0;
  padding: 8px;
}

.diagnostics-panel {
  display: grid;
  gap: 8px;
  width: 100%;
  min-height: 0;
  overflow: auto;
}

.diagnostics-panel-title {
  color: #555;
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
  background: #fff;
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
  color: #555;
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


.settings-button,
.settings-close-button {
  border: 1px solid var(--quiet-neutral-stroke-softer);
  border-radius: 4px;
  background: var(--quiet-neutral-fill-softer);
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 6px 10px;
}

.settings-button:hover,
.settings-button:focus-visible,
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
  color: #555;
  font-family: JuliaMono, monospace;
  font-size: .78em;
}

.commands-panel-shell {
  border-bottom: 1px solid var(--quiet-neutral-stroke-softer);
}

.commands-panel-toggle,
.command-button {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
}

.commands-panel-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  text-align: start;
  font-size: .82rem;
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
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
  gap: 2px;
  max-height: 240px;
  overflow-y: auto;
  padding: 4px 0;
}

.command-button {
  padding: 7px 8px;
  text-align: start;
  font-family: JuliaMono, monospace;
  font-size: .82rem;
}


</style>
