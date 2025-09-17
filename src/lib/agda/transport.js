/** @import { Transport } from '@codemirror/lsp-client' */
/** @import { EditorView } from '@codemirror/view' */

import { Message } from 'vscode-jsonrpc'
import { clearHighlight } from './effects'
import { alsHighlightingInfosDirectSchema } from './schema'
import { buildHighlightEffects } from './highlight'

/** @typedef {'init' | 'ready' | 'requested' | 'processing'} AgdaIOTCMStatus */

/** @import { ResponseMessage, NotificationMessage, RequestMessage } from 'vscode-languageserver-protocol' */
/** @typedef {ResponseMessage | NotificationMessage | RequestMessage} LSPPayload */

class AgdaController {
  /**
   * @param {EditorView} editorView
   * @param {(tag: string, contents: any) => void} msgCallback - The hook that gets called with Agda-method messages
   * @param {(status: AgdaIOTCMStatus) => void} statusCallback  The hook that gets called with worker status changes
   */
  constructor(editorView, msgCallback, statusCallback) {
    /** @type {AgdaIOTCMStatus} */
    this.status = 'init'
    /** @type {((s: string) => void)[]} */
    this.handlers = []

    /** @type {WritableStream<Uint8Array> | null} */
    this.rpcSink = null

    this.editorView = editorView
    this.handleRequest = msgCallback
    this.handleStatusChange = statusCallback

    const ctrl = this

    const encoder = new TextEncoder()

    /** @type {Transport} */
    this.transport = {
      send(message) {
        if (ctrl.rpcSink == null) {
          throw new Error('RPC sink is not set')
        }

        console.log('<--', JSON.parse(message))

        if (ctrl.status === 'init') {
          const pp = JSON.parse(message)
          if (Message.isNotification(pp) && pp.method === 'initialized') {
            ctrl.setStatus('ready')
          }
        } else if (ctrl.status === 'ready') {
          const pp = JSON.parse(message)
          if (Message.isRequest(pp) && pp.method === 'agda') {
            ctrl.setStatus('requested')
          }
        }

        const encoded = encoder.encode(message)
        const header = encoder.encode(`Content-Length: ${encoded.byteLength}\r\n\r\n`)
        const wr = ctrl.rpcSink.getWriter()
        // XXX: does not wait the write to complete, but errors are not handled
        wr.write(header).catch(console.error)
        wr.write(encoded).catch(console.error)
        wr.releaseLock()
      },
      subscribe(hh) {
        ctrl.handlers.push(hh)
      },
      unsubscribe(hh) {
        const idx = ctrl.handlers.indexOf(hh)
        if (idx >= 0) {
          const hhs = ctrl.handlers
          ctrl.handlers = hhs.slice(0, idx)
            .concat(hhs.slice(idx + 1).filter(h => h !== hh))
        }
      },
    }
  }

  /** @param {AgdaIOTCMStatus} s */
  setStatus(s) {
    if (this.status === s) return
    // FIXME: add state transition checks
    this.status = s
    this.handleStatusChange(s)
  }

  /**
   * @param {ReadableStream<string>} rpcStream
   * @param {WritableStream<Uint8Array>} workerWritable
   */
  async listen(rpcStream, workerWritable) {
    /** @type {UnderlyingSink<string>['write']} */
    const write = (msg) => {
      /** @type {LSPPayload} */
      const pp = JSON.parse(msg)
      console.log('-->', pp)

      // We MUST filter out requests from als and reply with our custom ACK to ensure synchronizations
      if (Message.isRequest(pp)) {
        // payload is a request message, and we must not pass it to lsp-client
        this.transport.send(JSON.stringify({
          jsonrpc: '2.0',
          id: pp.id,
          result: null,
        }))
        if (pp.method === 'agda') {
          const tag = /** @type {any} */(pp.params)?.tag
          if (tag === 'ResponseEnd') {
            this.setStatus('ready')
          } else {
            this.handleRequest(tag, /** @type {any} */(pp.params).contents)
          }
        }
      } else {
        if (Message.isResponse(pp) && /** @type {any} */(pp.result)?.tag === 'CmdRes') {
          this.setStatus('processing')
        }
        return this.forwardIncomingMessage(msg)
      }
    }

    this.rpcSink = workerWritable

    return rpcStream.pipeTo(new WritableStream({write}))
  }

  /** @param {string} msg */
  forwardIncomingMessage(msg) {
    for (const h of this.handlers) {
      h(msg)
    }
  }
}

/**
 * @param {EditorView} editorView  The editor the transport will attach to
 * @param {ReadableStream} rpcStream  RPC-messages from language server
 * @param {(status: AgdaIOTCMStatus) => void} statusCallback  The hook that gets called with worker status changes
 * @param {WritableStream<Uint8Array>} writable
 * @returns {Transport}
 */
export function makeLSPTransport(editorView, rpcStream, writable, statusCallback) {
  /**
   * @param {string} tag
   * @param {any} contents
   */
  function msgCallback(tag, contents) {
    if (tag === 'ResponseClearHighlightingNotOnlyTokenBased') {
      editorView.dispatch({
        effects: clearHighlight.of(false),
      })
      // highlightingInfo.length = 0
    } else if (tag === 'ResponseHighlightingInfoDirect') {

      const infos = alsHighlightingInfosDirectSchema.decode(contents)
      if (infos.info.remove) {
        editorView.dispatch({
          effects: clearHighlight.of(false)
        })
      }
      editorView.dispatch({
        effects: buildHighlightEffects(editorView.state, infos.info.payload)
      })
      // highlightingInfo = highlightingInfo.concat(infos.info.payload)
    } else {
      console.warn('Unrecognized resp', {tag, contents})
    }
  }

  const agdaController = new AgdaController(editorView, msgCallback, statusCallback)

  agdaController.listen(rpcStream, writable)

  return agdaController.transport
}
