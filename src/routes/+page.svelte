<script>
import { onDestroy } from 'svelte'

import { SPSC } from 'spsc'
import { SplitPane } from '@rich_harris/svelte-split-pane'
import { basicSetup } from 'codemirror'
import { EditorView } from '@codemirror/view'

import { autoColorScheme, myCodeMirrorTheme, prefersDarkTheme } from '$lib/codemirror/theme'
import { offsetTracking } from '$lib/codemirror/offsets'
import { agdaHighlight } from '$lib/agda/highlight'
import { agdaDarkSchemeFromEmacs, agdaLightSchemeFromEmacs } from '$lib/agda/color-scheme'
import { AgdaController, LS_DOC_KEY } from '$lib/controller.svelte'
import { withDriveLock } from '$lib'
import { makeBufUint32LE } from '$lib/stdlib'

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
  agdaVersion: '2.7.0.1',
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
})

/** @type {import('svelte/attachments').Attachment} */
function codeMirror(el) {
  const ev = new EditorView({
    doc: localStorage.getItem(LS_DOC_KEY) ?? 'open import Agda.Primitive\n',
    parent: el,
    extensions: [
      basicSetup,
      myCodeMirrorTheme(),
      basicTheme,
      offsetTracking(),
      autoColorScheme({
        dark: agdaDarkSchemeFromEmacs,
        light: agdaLightSchemeFromEmacs,
        defaultDark: prefersDarkTheme(window),
      }),
      agdaHighlight(),
      agdaController.lspClientCompartment.of([]),
    ],
  })

  agdaController.connectEditorView(ev)

  return () => { ev.destroy() }
}

function dumpFS() {
  if (agdaController._driveHostWorker == null) {
    console.warn('no drive worker to dump')
    return
  }
  withDriveLock(agdaController.driveHandle.lock, async () => {
    agdaController.driveHandle.stdinWriter.write(makeBufUint32LE(2), { nonblock: true })
    while (!agdaController.driveHandle.stdoutReader.read(1, { nonblock: true }).ok) {
      await new Promise(r => setTimeout(r, 100))
    }
  }).then(() => {
    console.log('dumped')
  })
}

/** @type {HTMLTextAreaElement} */
let textbox

let textboxContent = $state('WIP')

/** @type {number | undefined} */
let raf

$effect(() => {
  if (textbox && raf) {
    raf = requestAnimationFrame(() => {
      textbox.scrollTop = textbox.scrollHeight
      raf = undefined
    })
  }
})
</script>

{#snippet editor(/** @type {'horizontal' | 'vertical'} */ orientation)}

<SplitPane type={orientation} min="300px" max="-300px" pos="60%" --color={'var(--layout-divider-color)'} --thickness={'11px'}>
  {#snippet a()}
    <section class="editor-section">
      <header class="header">Agda REPL 2025</header>
      <div class="container" {@attach codeMirror}></div>
    </section>
  {/snippet}
  {#snippet b()}
    <section>
      <SplitPane type="vertical" min="100px" max="-40px" pos="75%" --color={'var(--layout-divider-color)'} --thickness={'11px'}>
        {#snippet a()}
          <section class="info-section">
            {@render alsButtons()}
          </section>
        {/snippet}
        {#snippet b()}
          <section>
            <textarea bind:this={textbox} class="textbox" value={textboxContent}></textarea>
          </section>
        {/snippet}
      </SplitPane>
    </section>
  {/snippet}
</SplitPane>

{/snippet}

{#snippet alsButtons()}
  {@const alsIsStartable =
    ['initial', 'terminated', 'exited', 'errored'].includes(agdaController.alsWorkerStatus) ?
      'startable' : agdaController.alsWorkerStatus === 'active' ? 'stopable' : ''}
  <div class="flex" style="padding: 1em 0">
    <button onclick={{
      startable: () => agdaController.startALSWASM(),
      stopable: () => agdaController.stopALSWASM(),
      '': null}[alsIsStartable]}
      disabled={!alsIsStartable}>{
      {startable: 'Start', stopable: 'Stop', '': '...'}[alsIsStartable]
    }</button>
    <button onclick={() => agdaController.restartALSWASM()} disabled={agdaController.alsWorkerStatus !== 'active'}>Restart</button>
    <button onclick={() => agdaController.terminateALSWASM()}  disabled={['initial', 'terminated'].includes(agdaController.alsWorkerStatus)}>Terminate</button>
    <button disabled={!agdaController._driveHostWorker} onclick={() => dumpFS()}>Dump FS</button>
  </div>

  {@const bytesLoaded = agdaController.wasmLoadingProgress?.bytesLoaded}
  {@const bytesTotal = agdaController.wasmLoadingProgress?.bytesTotal ?? 0}
  <div>
  {#if agdaController.alsWorkerStatus === 'loading'}
    ⌛ Downloading WASM: <progress max={bytesTotal} value={bytesLoaded}></progress> {bytesLoaded}/{bytesTotal}
  {:else if agdaController.alsWorkerStatus === 'loaded'}
    ⚙️ WASM is downloaded. Starting up...
  {:else if agdaController.alsWorkerStatus === 'exited'}
    🚪 WASM has exited. Start again to reuse this worker.
  {:else if agdaController.alsWorkerStatus === 'errored'}
    ⚠️ Error has occurred. Terminate and try again.
  {:else if agdaController.alsWorkerStatus === 'deactivating'}
    ⚠️ Deactivating the worker...
  {:else if agdaController.alsWorkerStatus === 'terminated'}
    🛑 WASM has been terminated.
  {:else if agdaController.alsWorkerStatus === 'initial'}
    <div><strong>Startup config</strong></div>
    <ul>
      <li>Agda version: <select disabled>
        <option value="2.7.0.1" selected>v2.7.0.1</option>
      </select></li>
      <li>Agda CLI args: <input style="font-family: monospace;" placeholder="(empty)" disabled></li>
      <li>Load args: <input style="font-family: monospace;" placeholder="(empty)" disabled></li>
      <li>Source file name: <input style="font-family: monospace;" value="source.agda" disabled></li>
      <li>Stdlib version: <select disabled>
        <option value="none" selected>None</option>
        <option value="2.1.1">v2.1.1</option>
        <option value="2.2">v2.2</option>
        <option value="2.3">v2.3</option>
      </select></li>
    </ul>
  {:else}
    Status: <strong>{agdaController.alsWorkerStatus}</strong>
    <ul>
      <li>Agda version: {agdaController.receivedALSVersion}</li>
      <li>Load args: (empty)</li>
      <li>IOTCM status: {agdaController.iotcmStatus}</li>
    </ul>
    <div class="flex">
      <button style="padding: 20px" onclick={() => agdaController.loadAgdaFile()}>Load</button>
    </div>
  {/if}
  </div>

{/snippet}

<div
  bind:clientWidth={width} style="height: 100%">
  {@render editor(isMobile ? 'vertical' : 'horizontal')}
</div>

<style>
select {
  min-width: 10em;
}

.header {
  color: #999;
  letter-spacing: 1px;
  font-size: 16px;
  font-family: monospace;
  padding: 8px;
  border-bottom: 1px solid var(--layout-divider-color);
}

.container {
  flex: 1 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
  padding-right: 4px;
}

.container > :global(*) {
  flex: 1 1;
}

.editor-section {
  display: flex;
  flex-direction: column;
  height: calc(100% - 1px);
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

button {
  min-width: 56px;
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.flex {
  display: flex;
  gap: 8px;
}

:global(svelte-split-pane-divider:hover:after) {
  --sp-color: #ace;
  /*width: 3px !important;*/
}
</style>
