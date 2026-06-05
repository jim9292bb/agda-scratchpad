import { offsetTable, mapUtf8Pos } from '$lib/codemirror/offsets'

/**
 * @typedef AgdaDiagnostic
 * @prop {string} filepath
 * @prop {number} line
 * @prop {number} column
 * @prop {number | undefined} [endLine]
 * @prop {number | undefined} [endColumn]
 * @prop {'error' | 'warning'} severity
 * @prop {string | undefined} [code]
 * @prop {string} message
 */

/**
 * Parse the common Agda diagnostic prefix:
 * `/source.agda:7.16-17: error: [NotInScope] ...`
 *
 * @param {string} message
 * @returns {AgdaDiagnostic | null}
 */
export function parseAgdaDiagnostic(message) {
  const match = message.match(
    /^(.+?):(\d+)\.(\d+)(?:-(?:(\d+)\.)?(\d+))?:\s*(error|warning):\s*(?:\[([^\]]+)\]\s*)?([\s\S]*)$/i,
  )
  if (!match) return null

  const [, filepath, line, column, explicitEndLine, endColumn, severity, code, body] = match
  return {
    filepath,
    line: Number(line),
    column: Number(column),
    endLine: explicitEndLine ? Number(explicitEndLine) : endColumn ? Number(line) : undefined,
    endColumn: endColumn ? Number(endColumn) : undefined,
    severity: severity.toLowerCase() === 'warning' ? 'warning' : 'error',
    code,
    message: body.trim(),
  }
}

/**
 * @param {import('@codemirror/state').EditorState} state
 * @param {number} position
 */
export function clampAgdaUtf8Position(state, position) {
  const maxPosition = state.field(offsetTable).text.utf8len
  return Math.max(0, Math.min(position, maxPosition))
}

/**
 * Convert an Agda diagnostic line/column pair to an absolute Agda/ALS UTF-8
 * document offset. Agda's textual diagnostics use 1-based columns.
 *
 * @param {import('@codemirror/state').EditorState} state
 * @param {AgdaDiagnostic} diagnostic
 */
export function diagnosticToAgdaUtf8Position(state, diagnostic) {
  const { text: utf8Text, doc } = state.field(offsetTable)
  const lineNumber = Math.max(1, Math.min(diagnostic.line, doc.lines))
  const sourceLine = doc.line(lineNumber)
  const utf8Line = utf8Text.lineUTF8(lineNumber)
  const column = Math.max(1, diagnostic.column)
  const prefix = Array.from(sourceLine.text).slice(0, column - 1).join('')
  const prefixUtf8Length = new TextEncoder().encode(prefix).byteLength
  return clampAgdaUtf8Position(state, utf8Line.from + prefixUtf8Length)
}

/**
 * Move the editor selection to an Agda/ALS UTF-8 document offset.
 *
 * @param {import('@codemirror/view').EditorView} editorView
 * @param {number} position
 */
export function focusAgdaUtf8Position(editorView, position) {
  const utf8Position = clampAgdaUtf8Position(editorView.state, position)
  const mappedPosition = mapUtf8Pos(editorView.state, utf8Position)
  const cmPosition = Math.max(0, Math.min(
    mappedPosition ?? editorView.state.doc.length,
    editorView.state.doc.length,
  ))
  editorView.dispatch({
    selection: { anchor: cmPosition },
    scrollIntoView: true,
  })
  editorView.focus()
  return cmPosition
}
