<script>
import { onDestroy, untrack } from 'svelte'

import { SPSC } from 'spsc'
// import { SplitPane } from '@rich_harris/svelte-split-pane'
import { basicSetup } from 'codemirror'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'

import { AgdaController, LS_DOC_KEY } from '$lib/controller.svelte'
import { withDriveLock } from '$lib'
import { makeBufUint32LE } from '$lib/stdlib'
import { myCodeMirrorTheme } from '$lib/codemirror/theme'
import { agdaSupport } from '$lib/agda'
import { mergeGoalInfos } from '$lib/agda/goal-state'
import { getGoalRangeById } from '$lib/agda/goals'
import { getAgdaShortcutContext } from '$lib/agda/shortcut-context'
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

const agdaKeymap = keymap.of([
  { key: 'Mod-Enter', run: () => { runLoadShortcut(); return true } },
])

let agdaChordTimer = /** @type {ReturnType<typeof setTimeout> | undefined} */(undefined)
let waitingForAgdaChord = false

function clearAgdaChord() {
  waitingForAgdaChord = false
  if (agdaChordTimer) {
    clearTimeout(agdaChordTimer)
    agdaChordTimer = undefined
  }
}

/**
 * @param {KeyboardEvent} event
 * @param {string} key
 */
function isCtrlKey(event, key) {
  return event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === key
}

/** @param {KeyboardEvent} event */
function isSpace(event) {
  return !event.altKey && !event.metaKey &&
    (event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space')
}

/** @param {KeyboardEvent} event */
function isCtrlSpace(event) {
  return event.ctrlKey && isSpace(event)
}

/**
 * Handles Agda/Emacs-style two-key chords before the browser can consume
 * shortcuts such as Ctrl-L.
 *
 * @param {KeyboardEvent} event
 * @param {EditorView} view
 */
function handleAgdaChordKeydown(event, view) {
  if (event.isComposing || !view.hasFocus) return false

  if (isCtrlKey(event, 'c') && !waitingForAgdaChord) {
    event.preventDefault()
    event.stopPropagation()
    waitingForAgdaChord = true
    agdaChordTimer = setTimeout(clearAgdaChord, 1500)
    return true
  }

  if (!waitingForAgdaChord) return false

  event.preventDefault()
  event.stopPropagation()
  clearAgdaChord()

  if (isCtrlKey(event, 'l')) {
    runLoadShortcut()
  } else if (isCtrlKey(event, 't')) {
    runAgdaShortcut('Goal type', view, context => goalTypeCommand('Simplified', requireGoal(context)))
  } else if (isCtrlKey(event, 'e')) {
    runAgdaShortcut('Context', view, context => contextCommand('Simplified', requireGoal(context)))
  } else if (isCtrlKey(event, ',')) {
    runAgdaShortcut('Goal type and context', view, context => goalTypeContextCommand('Simplified', requireGoal(context)))
  } else if (isCtrlKey(event, '.')) {
    runAgdaShortcut('Goal type, context and inferred type', view, context => {
      const goal = requireGoal(context)
      if (!context.input.trim()) {
        return goalTypeContextCommand('Simplified', goal)
      }
      return goalTypeContextInferCommand('Simplified', goal, context.input)
    })
  } else if (isCtrlKey(event, ';')) {
    runAgdaShortcut('Goal type, context and checked type', view, context => {
      return goalTypeContextCheckCommand('Simplified', requireGoal(context), requireInput(context))
    })
  } else if (isCtrlKey(event, 'z')) {
    runAgdaShortcut('Search about', view, context => {
      return searchAboutToplevelCommand('Simplified', requireInput(context))
    })
  } else if (isCtrlKey(event, 'o')) {
    runAgdaShortcut('Module contents', view, context => {
      const { goal, input } = requireGoalOrSelectedInput(context)
      return goal
        ? moduleContentsCommand('Simplified', goal, input)
        : moduleContentsToplevelCommand('Simplified', input)
    })
  } else if (isCtrlKey(event, 'w')) {
    runAgdaShortcut('Why in scope', view, context => {
      const { goal, input } = requireGoalOrSelectedInput(context)
      return goal
        ? whyInScopeCommand(goal, input)
        : whyInScopeToplevelCommand(input)
    })
  } else if (isCtrlSpace(event) || isSpace(event)) {
    runAgdaShortcut('Give', view, context => {
      const goal = requireGoal(context)
      if (agdaController.alsRouter) {
        agdaController.alsRouter.pendingGiveGoal = goal
      }
      return giveCommand(goal, context.range, requireInput(context))
    })
  } else if (isCtrlKey(event, 'r')) {
    runAgdaShortcut('Refine', view, context => refineCommand(requireGoal(context), context.range, requireInput(context)))
  } else if (isCtrlKey(event, 'a')) {
    runAgdaShortcut('Auto', view, context => {
      const goal = requireGoal(context)
      if (agdaController.alsRouter) {
        agdaController.alsRouter.pendingGiveGoal = goal
      }
      return autoOneCommand('AsIs', goal, context.range, context.input)
    })
  } else if (isCtrlKey(event, 'm')) {
    runAgdaShortcut('Elaborate and give', view, context => {
      const goal = requireGoal(context)
      if (agdaController.alsRouter) {
        agdaController.alsRouter.pendingGiveGoal = goal
      }
      return elaborateGiveCommand('Simplified', goal, requireInput(context))
    })
  } else if (isCtrlKey(event, 'h')) {
    runAgdaShortcut('Helper function type', view, context => {
      return helperFunctionCommand('AsIs', requireGoal(context), requireInput(context))
    })
  } else if (isCtrlKey(event, 'c')) {
    runAgdaShortcut('Case split', view, context => {
      const goal = requireGoal(context)
      if (agdaController.alsRouter) {
        agdaController.alsRouter.pendingCaseSplitGoal = goal
      }
      return makeCaseCommand(goal, context.range, requireInput(context))
    })
  } else if (isCtrlKey(event, 'n')) {
    runAgdaShortcut('Compute', view, context => computeCommand('DefaultCompute', requireGoal(context), requireInput(context)))
  } else if (isCtrlKey(event, 'd')) {
    runAgdaShortcut('Infer type', view, context => inferCommand('Normalised', requireGoal(context), requireInput(context)))
  }

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
    doc: localStorage.getItem(LS_DOC_KEY) ?? '{-# OPTIONS --cubical --guardedness #-}\n\nopen import Cubical.Foundations.Prelude\n',
    parent: el,
    extensions: [
      basicSetup,
      myCodeMirrorTheme(),
      basicTheme,
      agdaSupport(),
      agdaKeymap,
      agdaChordKeymap,
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

async function dumpFS() {
  if (agdaController._driveHostWorker == null) {
    console.warn('no drive worker to dump')
    return
  }
  await withDriveLock(agdaController.driveHandle.lock, async () => {
    agdaController.driveHandle.stdinWriter.write(makeBufUint32LE(2), { nonblock: true })
    while (!agdaController.driveHandle.stdoutReader.read(1, { nonblock: true }).ok) {
      await new Promise(r => setTimeout(r, 100))
    }
  })
  alert('Dump end. See the browser console')
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
  agdaController.editorView?.dispatch({ effects: clearGoals.of() })
  try {
    await agdaController.loadAgdaFile()
    textboxContent += 'Load finished.\n'
  } catch (err) {
    textboxContent += `Load failed: ${err instanceof Error ? err.message : String(err)}\n`
    throw err
  }
}

/** @type {HTMLTextAreaElement} */
let textbox

let textboxContent = $state('WIP')
let goalInfos = $state(/** @type {{id: number | string, range?: string, type?: string}[]} */([]))

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
      textbox.scrollTop = textbox.scrollHeight
      raf = undefined
      needScroll = false
    })
  }
})
</script>

{#snippet editor(/** @type {'horizontal' | 'vertical'} */ orientation)}
<quiet-splitter {orientation} position={.6} style="--divider-min-position: 25%; --divider-max-position: 90%;">
  <section slot="start" class="editor-section">
    <header class="header">
      <span class="header-title">Agda REPL 2025</span> <a target="_blank" href={ALS_DEMO_REPO_URL} class="header-subtitle">{ALS_DEMO_COMMIT_ID}</a>
    </header>
    <quiet-splitter class="editor-goals-splitter" orientation="vertical" position={.78} style="--divider-min-position: 35%; --divider-max-position: 92%;">
      <section slot="start" class="editor-pane">
        <div class="container" {@attach codeMirror}></div>
      </section>
      <section slot="end" class="goals-section">
        <header class="panel-header">Goals</header>
        <div class="goals-list">
          {#if goalInfos.length === 0}
            <div class="goals-empty">No goals.</div>
          {:else}
            {#each goalInfos as goal (`${goal.id}-${goal.range ?? ''}`)}
              <button
                type="button"
                class="goal-card"
                aria-label={`Focus goal ${goal.id}`}
                onclick={() => focusGoal(goal.id)}>
                <div class="goal-meta">
                  <strong>Goal {goal.id}</strong>
                  {#if goal.range}
                    <span>{goal.range}</span>
                  {/if}
                </div>
                {#if goal.type}
                  <pre>{goal.type}</pre>
                {:else}
                  <div class="goal-type-empty">Type information is not available yet.</div>
                {/if}
              </button>
            {/each}
          {/if}
        </div>
      </section>
    </quiet-splitter>
  </section>
  <section slot="end">
    <quiet-splitter orientation="vertical" position={.75}>

      <section slot="start" class="info-section">
        {@render alsButtons()}
      </section>

      <section slot="end" style="margin-top: -1px">
        <textarea bind:this={textbox} class="textbox" value={textboxContent} placeholder="(log area is empty)"></textarea>
      </section>
    </quiet-splitter>
  </section>
</quiet-splitter>
{/snippet}

{#snippet alsButtons()}
  {@const alsIsStartable =
    ['initial', 'terminated', 'exited', 'errored'].includes(agdaController.alsWorkerStatus) ?
      'startable' : agdaController.alsWorkerStatus === 'active' ? 'stoppable' : ''}
  <div class="flex" style="padding: 1em 0">
    <quiet-button variant={agdaController.alsWorkerStatus !== 'active' ? 'primary' : 'destructive'} onclick={{
      startable: () => agdaController.startALSWASM(),
      stoppable: () => agdaController.stopALSWASM(),
      '': null}[alsIsStartable]}
      disabled={!alsIsStartable}>{
      {startable: 'Start', stoppable: 'Stop', '': '...'}[alsIsStartable]
    }</quiet-button>
    <quiet-button onclick={() => agdaController.restartALSWASM()} disabled={agdaController.alsWorkerStatus !== 'active'}>Restart</quiet-button>
    <quiet-button onclick={() => agdaController.terminateALSWASM()}  disabled={['initial', 'terminated'].includes(agdaController.alsWorkerStatus)}>Terminate</quiet-button>
    <quiet-button disabled={!agdaController.driveIsCreated} onclick={() => dumpFS()}>Dump FS</quiet-button>
  </div>

  {@const bytesLoaded = agdaController.wasmLoadingProgress?.bytesLoaded ?? 0}
  {@const bytesTotal = agdaController.wasmLoadingProgress?.bytesTotal ?? 0}
  <div>
  {#if agdaController.alsWorkerStatus === 'loading'}
    ⌛ Downloading WASM: <progress max={bytesTotal} value={bytesLoaded}></progress> {bytesLoaded}/{bytesTotal}
  {:else if agdaController.alsWorkerStatus === 'loaded'}
    ⚙️ WASM is downloaded. Starting up...
  {:else if agdaController.alsWorkerStatus === 'exited'}
    🚪 WASM has exited. Start again to reuse this worker.<br>
    If this is not intended, open the console to inspect its output.
  {:else if agdaController.alsWorkerStatus === 'errored'}
    ⚠️ Error has occurred. Terminate and try again.
  {:else if agdaController.alsWorkerStatus === 'deactivating'}
    ⚠️ Deactivating the worker...
  {:else if agdaController.alsWorkerStatus === 'terminated'}
    <p>🛑 WASM has been terminated.</p>
    <quiet-button onclick={() => { agdaController.alsWorkerStatus = 'initial' }}>Reset state to initial</quiet-button>
  {:else if agdaController.alsWorkerStatus === 'initial'}
    <div><strong>Startup config</strong></div>

    <div style="display: flex; flex-direction: column; gap: .25em;">
      <quiet-select label="Agda version" class="quiet-side-label" disabled>
        <option value="2.8.0" selected>v2.8.0</option>
        <option value="2.7.0.1">v2.7.0.1</option>
        <option value="2.6.4.3">v2.6.4.3</option>
      </quiet-select>
      <quiet-text-field label="Agda CLI args" class="quiet-side-label mono" placeholder="(empty)" disabled></quiet-text-field>
      <quiet-text-field label="Load args" class="quiet-side-label mono" placeholder="(empty)" disabled></quiet-text-field>
      <quiet-text-field label="Source file name" class="quiet-side-label mono" value="source.agda" disabled></quiet-text-field>
      <quiet-select label="Stdlib version" class="quiet-side-label" disabled>
        <option value="NONE">None</option>
        <option value="2.0">v2.0</option>
        <option value="2.1">v2.1</option>
        <option value="2.1.1">v2.1.1</option>
        <option value="2.2">v2.2</option>
        <option value="2.3" selected>v2.3</option>
      </quiet-select>
      <quiet-text-field label="Cubical version" class="quiet-side-label mono" value="v0.9" disabled></quiet-text-field>
    </div>
  {:else}
    Status: <strong>{agdaController.alsWorkerStatus}</strong>
    <ul>
      <li>Agda version: {agdaController.receivedALSVersion}</li>
      <li>Load args: (empty)</li>
      <li>IOTCM status: {agdaController.iotcmStatus}</li>
    </ul>
    <div class="flex">
      <quiet-button variant="primary" onclick={() => loadAgdaFile()}>Load</quiet-button>
      <quiet-button onclick={() => sendAbort()}>Abort</quiet-button>
    </div>
    <details class="shortcut-help">
      <summary>Agda shortcuts</summary>
      <dl>
        <div><dt>Ctrl-c Ctrl-l / Cmd-Enter</dt><dd>Load</dd></div>
        <div><dt>Ctrl-c Ctrl-t</dt><dd>Goal type</dd></div>
        <div><dt>Ctrl-c Ctrl-e</dt><dd>Context</dd></div>
        <div><dt>Ctrl-c Ctrl-,</dt><dd>Goal type and context</dd></div>
        <div><dt>Ctrl-c Ctrl-.</dt><dd>Goal type, context and inferred type</dd></div>
        <div><dt>Ctrl-c Ctrl-;</dt><dd>Goal type, context and checked type</dd></div>
        <div><dt>Ctrl-c Ctrl-Space</dt><dd>Give</dd></div>
        <div><dt>Ctrl-c Ctrl-r</dt><dd>Refine</dd></div>
        <div><dt>Ctrl-c Ctrl-a</dt><dd>Auto</dd></div>
        <div><dt>Ctrl-c Ctrl-m</dt><dd>Elaborate and give</dd></div>
        <div><dt>Ctrl-c Ctrl-h</dt><dd>Helper function type</dd></div>
        <div><dt>Ctrl-c Ctrl-c</dt><dd>Case split</dd></div>
        <div><dt>Ctrl-c Ctrl-n</dt><dd>Compute</dd></div>
        <div><dt>Ctrl-c Ctrl-d</dt><dd>Infer type</dd></div>
        <div><dt>Ctrl-c Ctrl-z</dt><dd>Search about</dd></div>
        <div><dt>Ctrl-c Ctrl-o</dt><dd>Module contents</dd></div>
        <div><dt>Ctrl-c Ctrl-w</dt><dd>Why in scope</dd></div>
      </dl>
    </details>
  {/if}
  </div>

{/snippet}

<div
  bind:clientWidth={width} style="height: 100%">
  {@render editor(isMobile ? 'vertical' : 'horizontal')}
</div>

<style>
.header {
  padding: 8px;
  border-bottom: 1px solid var(--quiet-neutral-stroke-softer);
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

.container {
  flex: 1 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
  padding-right: 4px;
}

quiet-splitter {
  border-style: none;
  border-radius: 0;
  --divider-width: 1px;
  --divider-draggable-area: 13px;

  > section {
    height: 100%;
    width: 100%;
  }

  &::part(divider):hover {
    background: var(--quiet-primary-fill-soft);
  }

  &::part(handle) {
    display: none;
  }
}

quiet-text-field.mono::part(text-box) {
  font-family: monospace;
}

.quiet-side-label {
  --label-width: 12ch;
}

.container > :global(*) {
  flex: 1 1;
}

.editor-section {
  display: flex;
  flex-direction: column;
  height: calc(100% - 1px);
}

.editor-goals-splitter {
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
  padding: 8px;
  display: flex;
  flex-direction: column;
  overflow: auto;
}

.textbox {
  display: block;
  resize: none;
  border-style: none;
  font-size: 11px;
  font-family: JuliaMono, monospace;
  width: 100%;
  height: 100%;
  padding: 4px;
}

.flex {
  display: flex;
  gap: 8px;
}

.shortcut-help {
  margin-top: 12px;
  font-size: .8rem;
}

.shortcut-help dl {
  display: grid;
  gap: 4px;
  margin: 8px 0 0;
}

.shortcut-help dl > div {
  display: grid;
  grid-template-columns: minmax(12ch, max-content) 1fr;
  gap: 8px;
}

.shortcut-help dt {
  font-family: JuliaMono, monospace;
  color: #666;
}

.shortcut-help dd {
  margin: 0;
}
</style>
