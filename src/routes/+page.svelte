<script>
import { onDestroy } from 'svelte'
import * as Comlink from 'comlink'

import { SplitPane } from '@rich_harris/svelte-split-pane'
import { basicSetup } from 'codemirror'
import { EditorView } from '@codemirror/view'
import { LSPClient, languageServerExtensions } from '@codemirror/lsp-client'

import { allocateArrayBuffer } from 'spsc'
import { SPSCWriter } from 'spsc/writer'
import { SPSCReader } from 'spsc/reader'

import { createReadableByteStream, createWritableByteStream, makeChunkifyStream } from '$lib'
import { myCodeMirrorTheme } from '$lib/codemirror/theme'
import { commit, offsetTracking } from '$lib/codemirror/offsets'
import { agdaHighlight } from '$lib/agda/highlight'
import { agdaDarkSchemeFromEmacs } from '$lib/agda/color-scheme'
import { hoverTooltips } from '$lib/codemirror/lsp-hover'
import { makeLSPTransport } from '$lib/agda/transport'

/** @import { AgdaIOTCMStatus } from '$lib/agda/transport' */

const _worker = new Worker(
  new URL('$lib/worker/index.js?worker&inline', import.meta.url),
  { name: 'LSP Worker', type: 'module' })
/** @type {Comlink.Remote<{init: (initObj: any) => {
 *   start: () => Promise<void>,
 * }}>} */
const worker = Comlink.wrap(_worker)

_worker.addEventListener('error', (evt) => {
  console.error(evt)
  debugger
})

const driveHostWorker = new Worker(new URL('$lib/worker/drive.js?worker&inline', import.meta.url), {
  name: 'Runno drive host',
  type: 'module',
})

const driveHostInSab = new SharedArrayBuffer(4096)
const driveHostOutSab = new SharedArrayBuffer(4096)
driveHostWorker.postMessage({ stdin: driveHostOutSab, stdout: driveHostInSab })

const stdinSab = allocateArrayBuffer(4096)
const stdoutSab = allocateArrayBuffer(4096)

const writer = new SPSCWriter(stdinSab)
const reader = new SPSCReader(stdoutSab)

const msgchan = new MessageChannel()

const initPromise = worker.init(Comlink.transfer({
  port: msgchan.port1,
  stdinSab,
  stdoutSab,
  driveHostInSab,
  driveHostOutSab,
}, [msgchan.port1]))

initPromise.then(async (initRet) => {
  const {start} = initRet

  const startPromise = start()

  const result = await startPromise

  console.warn('exited', result)
})

onDestroy(() => {
  _worker.terminate()
})

const basicTheme = EditorView.theme({
  '.cm-panels': {
    // FIXME: should decouple from this extension
    marginRight: '-4px',
    paddingRight: '4px',
  },
})

/** @type {AgdaIOTCMStatus} */
let agdaIOTCMStatus = $state('init')

const lspClientReadable = createReadableByteStream(reader, msgchan.port2)
const rpcStream = lspClientReadable.pipeThrough(makeChunkifyStream())
const lspClientWritable = createWritableByteStream(writer)

const lspExtsWithoutHover = languageServerExtensions().filter(x => !('active' in x))

const lspClient = new LSPClient({
  timeout: 10000,
  rootUri: '/',
  extensions: [
    ...lspExtsWithoutHover,
    hoverTooltips(),
  ],
})

/**
 * @type {EditorView}
 */
let editorView

const LS_DOC_KEY = 'agda-web-ide-beta:doc'

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
      agdaDarkSchemeFromEmacs,
      agdaHighlight(),
      lspClient.plugin('file:///source.agda'),
    ],
  })

  lspClient.connect(makeLSPTransport(
    ev,
    rpcStream,
    lspClientWritable,
    status => {
      agdaIOTCMStatus = status
    },
  ))
  editorView = ev

  return () => { ev.destroy() }
}

function loadAgdaFile() {
  console.log('will update fs...')
  ;/** @type {any} */(window).worker = driveHostWorker

  const doc = editorView.state.doc.toString()
  localStorage.setItem(LS_DOC_KEY, doc)
  // FIXME: we should invoke Runno internal calls directly
  driveHostWorker.postMessage({method: 'write', content: doc})

  ;/** @type {Promise<void>} */(new Promise(resolve => {
    driveHostWorker.addEventListener('message', () => {
      resolve()
    }, { once: true })
  })).then(() => {
    console.log('file is synced.')

    editorView.dispatch({effects: commit.of()})

    lspClient.notification('textDocument/didSave', {
      textDocument: {
        uri: 'file:///source.agda',
      },
    })
    lspClient.request('agda', {
      tag: 'CmdReq',
      contents: 'IOTCM "/source.agda" NonInteractive Direct (Cmd_load "/source.agda" [])',
    })
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

<SplitPane type="horizontal" min="300px" max="-300px" pos="60%" --color={'#333'} --thickness={'11px'}>
  {#snippet a()}
    <section class="editor-section">
      <header class="header">Agda REPL 2025</header>
      <div class="container" {@attach codeMirror}></div>
    </section>
  {/snippet}
  {#snippet b()}
    <section>
      <SplitPane type="vertical" min="100px" max="-40px" pos="75%" --color={'#333'} --thickness={'11px'}>
        {#snippet a()}
          <section class="info-section">
            <p>Worker status: {agdaIOTCMStatus}</p>
            <button style="padding: 20px" onclick={loadAgdaFile}>Load</button>
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

<style>
.header {
  color: #999;
  letter-spacing: 1px;
  font-size: 16px;
  font-family: monospace;
  padding: 8px;
  border-bottom: 1px solid #333;
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
</style>
